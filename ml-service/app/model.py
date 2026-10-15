"""Forecaster plug-in point. LstmForecaster = trained PyTorch LSTM (quantile outputs, exact Shapley
explanations, model-based counterfactuals). Falls back to PlaceholderForecaster (persistence) if
no trained model file exists, so the service always boots."""
import itertools
import logging
import math
import os
from datetime import datetime, timezone
from typing import List

import numpy as np
import torch

from .features import (EVENT_TYPES, HORIZONS, MAX_H, TYPE_IDX, WINDOW, Event, EventFilter,
                       _sched_mask, assemble, event_channels, time_feats)
from .net import Net
from .schemas import (Counterfactual, Explanation, Factor, Forecast, LinkHistory, PredictionInput)

log = logging.getLogger(__name__)
torch.set_num_threads(int(os.getenv("EDGE_ML_THREADS", "2")))

# Incoming timestamps are instants (UTC); the daily pattern the model learned is campus-local time.
TZ_OFFSET_MIN = int(os.getenv("EDGE_ML_TZ_OFFSET_MIN", "330"))   # IST


class Forecaster:
    version = "abstract"

    def predict(self, inp: PredictionInput) -> List[Forecast]:
        raise NotImplementedError

    def explain(self, inp: PredictionInput, link_id: str, horizon: int, method: str) -> Explanation:
        raise NotImplementedError

    def counterfactual(self, inp: PredictionInput, link_id: str, horizon: int, target: float,
                       max_changes: int) -> List[Counterfactual]:
        raise NotImplementedError


def _risk(pred: float, threshold: float) -> float:
    return 1.0 / (1.0 + math.exp(-(pred - threshold) / 0.04))


class PlaceholderForecaster(Forecaster):
    version = "placeholder-persistence-0"

    @staticmethod
    def _last(link: LinkHistory) -> float:
        return link.history[-1].utilization if link.history else 0.0

    def predict(self, inp: PredictionInput) -> List[Forecast]:
        out = []
        for link in inp.links:
            last = self._last(link)
            for h in inp.horizonsMinutes:
                out.append(Forecast(
                    linkId=link.linkId, horizonMinutes=h, predictedUtilization=last,
                    lower=max(0.0, last - 0.1), upper=last + 0.1,
                    congestionRisk=_risk(last, inp.congestionThreshold),
                    confidence=0.3,  # deliberately low: this is not a trained model
                    explanation=self.explain(inp, link.linkId, h, "NONE"),
                    counterfactuals=[]))
        return out

    def explain(self, inp, link_id, horizon, method) -> Explanation:
        link = next((l for l in inp.links if l.linkId == link_id), None)
        last = self._last(link) if link else 0.0
        return Explanation(method="NONE", summary="Placeholder: persistence of the last observation (no ML model yet)",
                           factors=[Factor(name="lastObservation", value=last, contribution=last,
                                           description=f"Last observed utilisation {last * 100:.0f}%")])

    def counterfactual(self, inp, link_id, horizon, target, max_changes) -> List[Counterfactual]:
        return [Counterfactual(description="Counterfactuals require the trained model (not implemented yet)",
                               predictedUtilization=target)]


# ---------------------------------------------------------------------------------------
def _minutes(x: datetime) -> int:
    if x.tzinfo is None:
        x = x.replace(tzinfo=timezone.utc)
    return int(x.timestamp() // 60)


def _events(inp: PredictionInput) -> List[Event]:
    out = []
    for e in inp.events:
        s = _minutes(e.startTime)
        t = e.type.upper()
        out.append(Event(t if t in TYPE_IDX else "OTHER", s, s + int(e.durationMinutes),
                         float(e.expectedIntensity), frozenset(e.affectedGroups) or None))
    return out


def _at(q: np.ndarray, h: float, k: int) -> float:
    """q: (N_H, 3) -> quantile k at any horizon (linear interpolation, clamped to 15..60 min), bounded to 0..1."""
    return float(np.clip(np.interp(h, HORIZONS, q[:, k]), 0.0, 1.0))


def _shapley(v: np.ndarray, n: int) -> np.ndarray:
    """Exact Shapley values; v[mask] = model output with players in `mask` present."""
    phi = np.zeros(n)
    f = math.factorial
    for i in range(n):
        for m in range(1 << n):
            if (m >> i) & 1:
                continue
            s = bin(m).count("1")
            phi[i] += f(s) * f(n - s - 1) / f(n) * (v[m | (1 << i)] - v[m])
    return phi


class LstmForecaster(Forecaster):
    def __init__(self, path: str):
        ck = torch.load(path, map_location="cpu")
        self.net = Net(ck["cfg"]["hidden"])
        self.net.load_state_dict(ck["state"])
        self.net.eval()
        self.flt = EventFilter(**ck["filter"])        # same filter the model was trained with
        self.version = ck["version"]

    # ---- input preparation ----
    def _prep(self, link: LinkHistory, t_end: int, events: List[Event]):
        grid = np.arange(t_end - WINDOW + 1, t_end + 1)
        pts = sorted(link.history, key=lambda p: p.ts)
        if pts:
            util = np.interp(grid, [_minutes(p.ts) for p in pts], [p.utilization for p in pts])
        else:
            util = np.zeros(WINDOW)
        tm = np.arange(t_end - WINDOW + 1, t_end + MAX_H + 1)
        ch = event_channels(events, frozenset(link.groups), self.flt, tm)
        return {"util": np.clip(util, 0, 1).astype(np.float32), "tf": time_feats(grid + TZ_OFFSET_MIN),
                "ch_win": ch[:WINDOW], "ch_fut": ch[WINDOW:], "t_end": t_end}

    def _build(self, p, util_scale=1.0, type_scale=None, no_time=False, flat_util=False):
        util = np.clip(p["util"] * util_scale, 0, 1)
        if flat_util:
            util = np.full_like(util, util.mean())
        chw, chf = p["ch_win"].copy(), p["ch_fut"].copy()
        for t, f in (type_scale or {}).items():
            chw[:, TYPE_IDX[t]] *= f
            chf[:, TYPE_IDX[t]] *= f
        return assemble(util, p["tf"] * (0.0 if no_time else 1.0), chw, chf, self.flt)

    def _run(self, feats) -> np.ndarray:
        seq = torch.from_numpy(np.stack([s for s, _ in feats]))
        stat = torch.from_numpy(np.stack([s for _, s in feats]))
        with torch.no_grad():
            return self.net(seq, stat).numpy()

    def _active(self, p):
        mask = _sched_mask(tuple(self.flt.scheduled_types))
        out = {}
        for t in EVENT_TYPES:
            j = TYPE_IDX[t]
            x = max(float(p["ch_win"][:, j].max()), float((p["ch_fut"][:, j] * mask[j]).max()))
            if x > 0:
                out[t] = x
        return out

    # ---- SHAP: exact Shapley over grouped features ----
    def _coalitions(self, p):
        """Players: recent utilisation, time of day, each active event type. A player that is 'absent' is
        replaced by a neutral baseline (flat load, no time info, event intensity 0)."""
        hour = ((p["t_end"] + TZ_OFFSET_MIN) % 1440) / 60.0
        players = [("recentUtilization", float(p["util"][-1]),
                    f"Current load {p['util'][-1] * 100:.0f}% (window average {p['util'].mean() * 100:.0f}%)"),
                   ("timeOfDay", hour, f"Daily/weekly traffic pattern at {hour:.1f}h local")]
        types = list(self._active(p))
        players += [(f"event:{t}", self._active(p)[t], f"{t} event, expected intensity {self._active(p)[t]:.2f}")
                    for t in types]
        n = len(players)
        feats = []
        for m in range(1 << n):
            feats.append(self._build(
                p, flat_util=not (m & 1), no_time=not (m >> 1 & 1),
                type_scale={t: 0.0 for j, t in enumerate(types) if not (m >> (2 + j) & 1)}))
        return players, np.clip(self._run(feats)[:, :, 1], 0.0, 1.0)          # (2^n, N_H) median forecasts

    @staticmethod
    def _explanation(players, v, h) -> Explanation:
        n = len(players)
        vh = np.array([np.interp(h, HORIZONS, row) for row in v])
        phi = _shapley(vh, n)
        factors = [Factor(name=nm, value=float(val), contribution=float(c), description=d)
                   for (nm, val, d), c in zip(players, phi)]
        factors.sort(key=lambda f: -abs(f.contribution))
        top = factors[0]
        return Explanation(method="SHAP", factors=factors[:6],
                           summary=f"Forecast {vh[-1] * 100:.0f}% at +{h}m (neutral baseline {vh[0] * 100:.0f}%); "
                                   f"main driver: {top.name} ({top.contribution * 100:+.1f} pts)")

    # ---- API ----
    def predict(self, inp: PredictionInput) -> List[Forecast]:
        t_end, evs = _minutes(inp.generatedAt), _events(inp)
        preps = [self._prep(l, t_end, evs) for l in inp.links]
        out = self._run([self._build(p) for p in preps])
        res = []
        for link, p, q in zip(inp.links, preps, out):
            players, v = self._coalitions(p)
            for h in inp.horizonsMinutes:
                med = max(0.0, _at(q, h, 1))
                lo = max(0.0, min(_at(q, h, 0), med))
                up = max(_at(q, h, 2), med)
                sigma = max((up - lo) / 2.563, 1e-3)                # 80% interval -> sigma
                risk = 0.5 * (1 - math.erf((inp.congestionThreshold - med) / (sigma * math.sqrt(2))))
                res.append(Forecast(
                    linkId=link.linkId, horizonMinutes=h, predictedUtilization=med, lower=lo, upper=up,
                    congestionRisk=float(min(1.0, max(0.0, risk))),
                    confidence=float(np.clip(1 - (up - lo) / 0.4, 0.05, 0.95)),
                    explanation=self._explanation(players, v, h), counterfactuals=[]))
        return res

    def explain(self, inp, link_id, horizon, method) -> Explanation:
        link = next((l for l in inp.links if l.linkId == link_id), None)
        if link is None:
            return PlaceholderForecaster().explain(inp, link_id, horizon, method)
        p = self._prep(link, _minutes(inp.generatedAt), _events(inp))
        players, v = self._coalitions(p)                              # LIME requests also get SHAP
        return self._explanation(players, v, horizon)

    def counterfactual(self, inp, link_id, horizon, target, max_changes) -> List[Counterfactual]:
        link = next((l for l in inp.links if l.linkId == link_id), None)
        if link is None:
            return []
        p = self._prep(link, _minutes(inp.generatedAt), _events(inp))
        levers = {t: [(f"Reduce {t} event intensity to {int(f * 100)}%", dict(type_scale={t: f})) for f in (0.0, 0.5)]
                  for t in self._active(p)}
        levers["load"] = [(f"Reduce baseline load by {round((1 - f) * 100)}%", dict(util_scale=f)) for f in (0.9, 0.8, 0.7)]
        cands = []
        for n in range(1, max(1, min(int(max_changes or 2), 3)) + 1):
            for ks in itertools.combinations(levers, n):
                for choice in itertools.product(*[levers[k] for k in ks]):
                    kw = {"type_scale": {}, "util_scale": 1.0}
                    for _, c in choice:
                        kw["type_scale"].update(c.get("type_scale", {}))
                        kw["util_scale"] *= c.get("util_scale", 1.0)
                    cands.append((n, " + ".join(d for d, _ in choice), kw))
        outs = self._run([self._build(p, **kw) for _, _, kw in cands])
        scored = sorted(((n, _at(o, horizon, 1), d) for (n, d, _), o in zip(cands, outs)), key=lambda x: (x[0], x[1]))
        hits = [s for s in scored if s[1] <= target][:5]
        if not hits:
            best = min(scored, key=lambda x: x[1])
            return [Counterfactual(description=f"No combination of <= {max_changes} changes reaches {target:.2f}; "
                                               f"closest: {best[2]}", predictedUtilization=float(best[1]))]
        return [Counterfactual(description=d, predictedUtilization=float(v)) for _, v, d in hits]


MODEL_PATH = os.getenv("FORECASTER_MODEL_PATH",
                       os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "models", "lstm.pt")))


def _load() -> Forecaster:
    if os.path.exists(MODEL_PATH):
        try:
            m = LstmForecaster(MODEL_PATH)
            log.info("loaded %s", m.version)
            return m
        except Exception:
            log.exception("could not load %s, falling back to placeholder", MODEL_PATH)
    else:
        log.warning("%s not found, using PlaceholderForecaster", MODEL_PATH)
    return PlaceholderForecaster()


MODEL: Forecaster = _load()