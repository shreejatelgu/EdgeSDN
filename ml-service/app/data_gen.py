from __future__ import annotations
from dataclasses import dataclass
import os
import numpy as np
from .features import EVENT_TYPES, Event

START_MIN = int(np.datetime64("2026-01-05T00:00", "m").astype(np.int64))  # a Monday, campus-local time
GROUPS = ["ACADEMIC", "LAB", "HOSTEL", "LIBRARY", "ADMIN"]

TYPE_GAIN = {"EXAM": 0.25, "PLACEMENT": 0.30, "FESTIVAL": 0.35, "OTHER": 0.10}
TYPE_DUR = {"EXAM": (120, 240), "PLACEMENT": (90, 300), "FESTIVAL": (180, 600), "OTHER": (30, 180)}
TYPE_START_HR = {"EXAM": (9, 14), "PLACEMENT": (9, 16), "FESTIVAL": (10, 20), "OTHER": (8, 20)}


@dataclass
class LinkSeries:
    link_id: str
    start_min: int
    util: np.ndarray             # fraction 0..1, 1-min resolution
    groups: frozenset


def _ar1(rng, n, phi, sigma):
    e = rng.normal(0, sigma, n)
    x = np.empty(n)
    x[0] = e[0]
    for i in range(1, n):
        x[i] = phi * x[i - 1] + e[i]
    return x


def _envelope(tm, ev, ramp_frac=0.15, tau=10.0):
    ramp = max(1.0, ramp_frac * (ev.end_min - ev.start_min))
    inside = np.clip((tm - ev.start_min) / ramp, 0, 1) * (tm < ev.end_min)
    after = np.exp(-np.maximum(tm - ev.end_min, 0) / tau) * (tm >= ev.end_min)
    return inside + after


def _group_profile(group, hour, weekend):
    g = lambda c, w: np.exp(-0.5 * ((hour - c) / w) ** 2)
    if group in ("ACADEMIC", "LAB", "ADMIN"):
        return (g(11, 2.5) + 0.8 * g(15, 2.0)) * np.where(weekend, 0.25, 1.0)
    if group == "HOSTEL":
        return (0.5 * g(8, 1.5) + g(21.5, 2.5)) * np.where(weekend, 1.2, 1.0)
    return (g(13, 3.0) + 0.6 * g(18, 2.0)) * np.where(weekend, 0.5, 1.0)     # LIBRARY / other


def simulate(n_links=20, days=28, events_per_day=3.0, seed=7):
    rng = np.random.default_rng(seed)
    n = days * 1440
    tm = START_MIN + np.arange(n, dtype=np.int64)
    hour = (tm % 1440) / 60.0
    weekend = (((tm // 1440) + 3) % 7) >= 5

    link_groups = []
    for i in range(n_links):                       # every group gets links
        gs = {GROUPS[i % len(GROUPS)]}
        if rng.random() < 0.3:
            gs.add(GROUPS[int(rng.integers(len(GROUPS)))])
        link_groups.append(frozenset(gs))

    events = []
    for d in range(days):
        for _ in range(rng.poisson(events_per_day)):
            typ = EVENT_TYPES[int(rng.integers(len(EVENT_TYPES)))]           # uniform over types
            h0, h1 = TYPE_START_HR[typ]; lo, hi = TYPE_DUR[typ]
            s = START_MIN + d * 1440 + int(rng.uniform(h0, h1) * 60)
            groups = None if rng.random() < 0.25 else frozenset(
                rng.choice(GROUPS, size=int(rng.integers(1, 4)), replace=False).tolist())
            events.append(Event(typ, s, s + int(rng.integers(lo, hi)), float(rng.uniform(0.2, 1.0)), groups))

    series = []
    for i, gs in enumerate(link_groups):
        prof = np.mean([_group_profile(g, hour, weekend) for g in gs], axis=0)
        u = rng.uniform(0.15, 0.40) + rng.uniform(0.15, 0.30) * prof + _ar1(rng, n, 0.95, 0.012)
        sens = {t: float(np.exp(rng.normal(0, 0.25))) for t in EVENT_TYPES}
        for ev in events:
            if ev.groups and not (ev.groups & gs):
                continue
            # expectedIntensity is only a hint: the realised effect is noisy
            u = u + sens[ev.type] * TYPE_GAIN[ev.type] * ev.intensity * rng.uniform(0.6, 1.4) * _envelope(tm, ev)
        series.append(LinkSeries(f"link-{i:02d}", START_MIN, np.clip(u, 0, 1).astype(np.float32), gs))
    return series, events


# ---- real data -------------------------------------------------------------------------
# util CSV:   timestamp,link_id,utilization[,groups]   utilization = 0..1 fraction; groups pipe-separated
# events CSV: type,start,end,intensity[,groups]        groups pipe-separated, empty = all links
# Timestamps should be campus-local. If they are UTC pass tz_offset_min=330 (IST).
def load_csv(util_csv: str, events_csv: str, tz_offset_min: int = 0):
    import pandas as pd
    mins = lambda ts: int(np.datetime64(ts.to_datetime64(), "m").astype(np.int64)) + tz_offset_min
    df = pd.read_csv(util_csv, parse_dates=["timestamp"])
    series = []
    for lid, g in df.groupby("link_id"):
        s = g.set_index("timestamp")["utilization"].sort_index()
        s = s.resample("1min").mean().interpolate(limit=10).ffill().bfill()
        gs = frozenset()
        if "groups" in g and g["groups"].notna().any():
            gs = frozenset(str(g["groups"].dropna().iloc[0]).split("|"))
        series.append(LinkSeries(str(lid), mins(s.index[0]), s.to_numpy(np.float32), gs))
    events = []
    if os.path.exists(events_csv):
        ev = pd.read_csv(events_csv, parse_dates=["start", "end"])
        for r in ev.itertuples():
            t = str(r.type).upper()
            gr = getattr(r, "groups", None)
            events.append(Event(t if t in EVENT_TYPES else "OTHER", mins(r.start), mins(r.end), float(r.intensity),
                                frozenset(str(gr).split("|")) if isinstance(gr, str) and gr else None))
    return series, events