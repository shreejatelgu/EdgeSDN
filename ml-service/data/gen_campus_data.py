"""Generate simulated campus telemetry + institutional events for the EDGE-SDN LSTM.

    python gen_campus_data.py --days 42 --seed 11 --out data/

Writes (all timestamps ISO-8601 UTC, campus-local time = UTC + 330 min):
  util.csv           timestamp,link_id,utilization,groups     <- trainer input (--util-csv)
  events.csv         type,start,end,intensity,groups          <- trainer input (--events-csv)
  events_import.csv  name,type,startTime,durationMinutes,expectedIntensity,affectedGroups,description
                     (the CSV format EventService imports; groups separated by ';')
  link_groups.csv    link_id,groups,capacityMbps,role

SIMULATED data: group demand -> access links -> distribution links -> core -> server uplink,
with saturation at link capacity. Replace with real counters when you have them.
"""
import argparse
import os

import numpy as np
import pandas as pd

IST_MIN = 330
GROUPS = ["ADMIN", "EXAM_HALL", "HOSTEL", "LAB", "LIBRARY"]

# ---- topology (ASSUMED: edit to match your Mininet script) ---------------------------------
ACCESS = {  # access link -> (client group behind it, distribution switch)
    "a1-d1": ("LIBRARY", "d1"), "a2-d1": ("ADMIN", "d1"),
    "a3-d2": ("LAB", "d2"), "a4-d2": ("HOSTEL", "d2"),
    "a5-d3": ("EXAM_HALL", "d3"),
}
CAP = {"a1-d1": 20, "a2-d1": 20, "a3-d2": 20, "a4-d2": 20, "a5-d3": 20, "a6-d4": 50,
       "c1-c2": 50, "c1-d1": 30, "c1-d2": 30, "c1-d3": 30, "c1-d4": 30}
# c2-d1..d4 are standby paths (always idle) -> excluded, they carry no signal.

# ---- demand model (offered Mbps at peak of the daily pattern) ------------------------------
def g(h, c, s):
    return np.exp(-0.5 * ((h - c) / s) ** 2)


def base_profile(group, h, wk):
    """Offered Mbps for a group at local hour h; wk = weekend mask."""
    if group == "ADMIN":
        x = 4.0 * (0.7 * g(h, 11, 2.2) + 0.6 * g(h, 15, 1.8)) + 0.3
        return np.where(wk, 0.3 + 0.15 * (x - 0.3), x)
    if group == "LAB":
        x = 6.0 * (g(h, 11.5, 2.0) + 0.8 * g(h, 15.5, 2.0)) + 0.4
        return np.where(wk, 0.4 + 0.25 * (x - 0.4), x)
    if group == "HOSTEL":
        x = 8.0 * (0.35 * g(h, 8, 1.2) + g(h, 21.5, 2.5)) + 0.8
        return np.where(wk, 1.25 * x, x)
    if group == "LIBRARY":
        x = 5.0 * (g(h, 13, 3.0) + 0.5 * g(h, 19, 1.8)) + 0.3
        return np.where(wk, 0.3 + 0.5 * (x - 0.3), x)
    x = 1.0 * g(h, 12, 4.0) + 0.2                      # EXAM_HALL idle baseline
    return np.where(wk, 0.5 * x, x)


# Extra Mbps a type adds to a group at intensity 1.0
GAIN = {
    "EXAM": {"EXAM_HALL": 15.0, "LAB": 4.0, "LIBRARY": 3.0},
    "PLACEMENT": {"ADMIN": 7.0, "LAB": 6.0, "EXAM_HALL": 5.0, "LIBRARY": 2.0},
    "FESTIVAL": {"HOSTEL": 10.0, "LIBRARY": 6.0, "LAB": 3.0, "ADMIN": 2.0, "EXAM_HALL": 2.0},
    "OTHER": {},
}
OTHER_DEFAULT = 3.0
BASE_SCALE = 1.4      # tuned so congestion (>=80% util) is neither absent nor constant
GAIN_SCALE = 1.7


def ar1(rng, n, phi, sigma):
    e = rng.normal(0, sigma, n)
    x = np.empty(n)
    x[0] = e[0]
    for i in range(1, n):
        x[i] = phi * x[i - 1] + e[i]
    return x


def sat(x, c, knee=0.85):
    """Throughput that can be carried: linear up to knee*c, then smoothly saturating at c."""
    k = knee * c
    over = np.maximum(x - k, 0.0)
    return np.where(x <= k, x, k + (c - k) * (1 - np.exp(-over / (c - k))))


def make_events(rng, days, start_local_day0, counts):
    """Spread each type evenly over the period (stratified), so every type appears late too."""
    wk = np.array([(d % 7) >= 5 for d in range(days)])      # day 0 is a Monday
    weekdays = np.where(~wk)[0]
    all_days = np.arange(days)
    plan = {"EXAM": (weekdays, (9.0, 14.0), (120, 180), 0.3, 1.0),
            "PLACEMENT": (weekdays, (9.5, 13.0), (120, 300), 0.3, 1.0),
            "FESTIVAL": (all_days, (16.0, 19.0), (180, 300), 0.3, 1.0),
            "OTHER": (all_days, (8.0, 20.0), (30, 120), 0.2, 0.8)}
    pools = {"PLACEMENT": ["ADMIN", "LAB", "EXAM_HALL", "LIBRARY"],
             "FESTIVAL": ["HOSTEL", "LIBRARY", "LAB", "ADMIN"], "OTHER": GROUPS}
    out = []
    for typ, n in counts.items():
        valid, (h0, h1), (d0, d1), i0, i1 = plan[typ]
        for chunk in np.array_split(valid, n):
            day = int(rng.choice(chunk))
            if typ == "EXAM":
                hr = float(rng.choice([9.0, 14.0]))
            else:
                hr = float(rng.uniform(h0, h1))
            start = start_local_day0 + day * 1440 + int(hr * 60)
            dur = int(rng.integers(d0, d1 + 1))
            if typ == "EXAM":
                groups = ["EXAM_HALL"] + (["LAB"] if rng.random() < 0.3 else [])
            else:
                k = int(rng.integers(1, 4 if typ != "OTHER" else 3))
                groups = sorted(rng.choice(pools[typ], size=k, replace=False).tolist())
            out.append(dict(type=typ, start=start, dur=dur, intensity=round(float(rng.uniform(i0, i1)), 2),
                            groups=sorted(groups)))
    return sorted(out, key=lambda e: e["start"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=42)
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--start", default="2026-08-03", help="a Monday, campus-local date")
    ap.add_argument("--out", default="data")
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    os.makedirs(a.out, exist_ok=True)

    n = a.days * 1440
    local0 = int(np.datetime64(a.start + "T00:00", "m").astype(np.int64))   # local minutes since epoch
    lm = local0 + np.arange(n, dtype=np.int64)
    hour = (lm % 1440) / 60.0
    weekend = (((lm // 1440) + 3) % 7) >= 5
    day_idx = ((lm - local0) // 1440).astype(int)

    # ---- events ----
    scale = a.days / 42.0
    counts = {"EXAM": max(4, round(14 * scale)), "PLACEMENT": max(4, round(10 * scale)),
              "FESTIVAL": max(4, round(10 * scale)), "OTHER": max(4, round(12 * scale))}
    events = make_events(rng, a.days, local0, counts)

    # ---- offered load per group (Mbps) ----
    offered = {}
    for grp in GROUPS:
        daily = np.exp(rng.normal(0, 0.12, a.days))[day_idx]
        noise = np.exp(ar1(rng, n, 0.97, 0.03))
        x = BASE_SCALE * base_profile(grp, hour, weekend) * daily * noise
        for _ in range(int(rng.poisson(2 * a.days))):                      # short unexplained bursts
            s = int(rng.integers(0, n - 30)); d = int(rng.integers(5, 21))
            x[s:s + d] *= rng.uniform(1.2, 1.5)
        offered[grp] = x

    for ev in events:
        s = ev["start"] - local0; e = s + ev["dur"]
        ramp = max(5.0, 0.15 * ev["dur"])
        t = np.arange(n) - s
        env = np.clip(t / ramp, 0, 1) * (np.arange(n) < e) + np.exp(-np.maximum(np.arange(n) - e, 0) / 8.0) * (np.arange(n) >= e)
        for grp in ev["groups"]:
            gain = GAIN[ev["type"]].get(grp, OTHER_DEFAULT)
            # expectedIntensity is only a hint: the realised effect varies per event and group
            offered[grp] = offered[grp] + GAIN_SCALE * gain * ev["intensity"] * rng.uniform(0.7, 1.3) * env

    # ---- push demand through the topology with saturation ----
    meas = {}
    for link, (grp, dist) in ACCESS.items():
        meas[link] = sat(offered[grp], CAP[link])
    for d in ("d1", "d2", "d3"):
        under = sum(meas[l] for l, (_, dd) in ACCESS.items() if dd == d)
        meas[f"c1-{d}"] = sat(under, CAP[f"c1-{d}"])
    meas["c1-d4"] = sat(meas["c1-d1"] + meas["c1-d2"] + meas["c1-d3"], CAP["c1-d4"])
    meas["a6-d4"] = sat(1.4 * meas["c1-d4"], CAP["a6-d4"])                    # requests + responses
    meas["c1-c2"] = sat(1.0 + 0.25 * meas["c1-d4"], CAP["c1-c2"])

    grp_of = {l: {gr} for l, (gr, _) in ACCESS.items()}
    below = {"d1": {"LIBRARY", "ADMIN"}, "d2": {"LAB", "HOSTEL"}, "d3": {"EXAM_HALL"}}
    for d, s in below.items():
        grp_of[f"c1-{d}"] = set(s)
    for l in ("c1-d4", "a6-d4", "c1-c2"):
        grp_of[l] = set(GROUPS)

    # ---- write util.csv (timestamps in UTC) ----
    utc = (lm - IST_MIN).astype("datetime64[m]")
    ts = pd.Series(utc).dt.strftime("%Y-%m-%dT%H:%M:00Z")
    frames, rows = [], []
    for link in CAP:
        u = np.clip(meas[link] * rng.normal(1.0, 0.01, n) / CAP[link], 0, 1)
        frames.append(pd.DataFrame({"timestamp": ts, "link_id": link, "utilization": np.round(u, 4),
                                    "groups": "|".join(sorted(grp_of[link]))}))
        rows.append((link, "|".join(sorted(grp_of[link])), CAP[link],
                     "access" if link in ACCESS else ("server-uplink" if link == "a6-d4" else
                                                      "core-dist" if link.startswith("c1-d") else "core-core")))
    pd.concat(frames).to_csv(os.path.join(a.out, "util.csv"), index=False)
    pd.DataFrame(rows, columns=["link_id", "groups", "capacityMbps", "role"]).to_csv(
        os.path.join(a.out, "link_groups.csv"), index=False)

    # ---- events ----
    to_iso = lambda lmin: np.datetime64(int(lmin) - IST_MIN, "m").astype(str) + ":00Z"
    ev_rows, imp_rows = [], []
    labels = {"EXAM": "Exam session", "PLACEMENT": "Placement drive", "FESTIVAL": "Cultural fest", "OTHER": "Campus event"}
    for i, ev in enumerate(events, 1):
        ev_rows.append(dict(type=ev["type"], start=to_iso(ev["start"]), end=to_iso(ev["start"] + ev["dur"]),
                            intensity=ev["intensity"], groups="|".join(ev["groups"])))
        imp_rows.append(dict(name=f"{labels[ev['type']]} #{i}", type=ev["type"], startTime=to_iso(ev["start"]),
                             durationMinutes=ev["dur"], expectedIntensity=ev["intensity"],
                             affectedGroups=";".join(ev["groups"]), description="Simulated training event"))
    pd.DataFrame(ev_rows).to_csv(os.path.join(a.out, "events.csv"), index=False)
    pd.DataFrame(imp_rows).to_csv(os.path.join(a.out, "events_import.csv"), index=False)

    # ---- summary ----
    print(f"{a.days} days, {len(CAP)} links, {n} min each; events: {pd.Series([e['type'] for e in events]).value_counts().to_dict()}")
    for link in CAP:
        u = np.clip(meas[link] / CAP[link], 0, 1)
        print(f"{link:7s} cap {CAP[link]:3d}  mean {u.mean():.2f}  p95 {np.quantile(u, .95):.2f}  >=0.8: {(u >= .8).mean():6.1%}")


if __name__ == "__main__":
    main()
