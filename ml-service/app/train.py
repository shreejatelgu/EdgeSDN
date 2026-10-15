"""python -m app.train --util-csv data/util.csv --events-csv data/events.csv --tz-offset-min 330 --epochs 25"""
import argparse, copy, json, os, sys, time
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
from dataclasses import asdict

from .data_gen import load_csv, simulate
from .features import (EVENT_TYPES, HORIZONS, MAX_H, QUANTILES, WINDOW, EventFilter,
                       assemble, event_channels, time_feats)
from .net import Net


class WindowDataset(Dataset):
    def __init__(self, series, events, flt, lo, hi, stride, thr):
        self.flt = flt
        self.data, self.idx = [], []
        link, dom, hb, cong = [], [], [], []
        for li, s in enumerate(series):
            n = len(s.util)
            tm = s.start_min + np.arange(n, dtype=np.int64)
            ch = event_channels(events, s.groups, flt, tm)                  # what the model sees
            truth = event_channels(events, s.groups, EventFilter(), tm)     # ground truth, for slicing only
            self.data.append((s.util, ch, time_feats(tm)))
            for i in range(max(WINDOW - 1, int(n * lo)), min(n - MAX_H - 1, int(n * hi)), stride):
                m = truth[i:i + MAX_H + 1].max(0)
                dom.append(0 if m.max() < 1e-6 else 1 + int(m.argmax()))
                hb.append(int((tm[i] % 1440) // 360))
                cong.append(int(s.util[i + MAX_H] >= thr))
                self.idx.append((li, i)); link.append(li)
        self.link, self.dom, self.hb, self.cong = map(np.array, (link, dom, hb, cong))
        self.stratum = self.dom * 8 + self.hb * 2 + self.cong

    def __len__(self):
        return len(self.idx)

    def __getitem__(self, k):
        li, i = self.idx[k]
        u, ch, tf = self.data[li]
        a = i - WINDOW + 1
        seq, stat = assemble(u[a:i + 1], tf[a:i + 1], ch[a:i + 1], ch[i + 1:i + 1 + MAX_H], self.flt)
        y = np.array([u[i + h] for h in HORIZONS], np.float32)
        return torch.from_numpy(seq), torch.from_numpy(stat), torch.from_numpy(y)


def balance_weights(strata, power=0.5):
    """power 0 = natural distribution, 1 = every (event x time-of-day x congested) stratum equally likely."""
    _, inv, c = np.unique(strata, return_inverse=True, return_counts=True)
    w = c[inv].astype(float) ** -power
    w = np.minimum(w, np.median(w) * 20)
    return w / w.mean()


def pinball(pred, y):
    q = torch.tensor(QUANTILES).view(1, 1, 3)
    e = y.unsqueeze(-1) - pred
    return torch.maximum(q * e, (q - 1) * e)


@torch.no_grad()
def predict(model, ds, bs=1024):
    model.eval()
    P, Y, L = [], [], []
    for seq, stat, y in DataLoader(ds, batch_size=bs):
        P.append(model(seq, stat).numpy()); Y.append(y.numpy()); L.append(seq[:, -1, 0].numpy())
    return np.concatenate(P), np.concatenate(Y), np.concatenate(L)


def stats(p, y, last, thr):
    med = p[..., 1]; err = med - y; pos = y >= thr; pred_pos = med >= thr
    return dict(n=int(len(y)), mae=float(np.abs(err).mean()), bias=float(err.mean()),
                coverage=float(((y >= p[..., 0]) & (y <= p[..., 2])).mean()),
                congestion_recall=float(pred_pos[pos].mean()) if pos.any() else None,
                congestion_precision=float(pos[pred_pos].mean()) if pred_pos.any() else None,
                persistence_mae=float(np.abs(last[:, None] - y).mean()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--links", type=int, default=25); ap.add_argument("--days", type=int, default=28)
    ap.add_argument("--seed", type=int, default=7); ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--samples-per-epoch", type=int, default=100000)
    ap.add_argument("--hidden", type=int, default=32)
    ap.add_argument("--lr", type=float, default=5e-4); ap.add_argument("--weight-decay", type=float, default=1e-4)
    ap.add_argument("--balance", type=float, default=0.5,
                    help="0 = natural sampling, 1 = fully balanced strata")
    ap.add_argument("--threshold", type=float, default=0.8, help="congestion threshold")
    ap.add_argument("--util-csv"); ap.add_argument("--events-csv", default="events.csv")
    ap.add_argument("--tz-offset-min", type=int, default=0, help="add to CSV timestamps to get campus-local time (IST=330)")
    # event filters
    ap.add_argument("--event-types", nargs="*", help="only use these event types (EXAM PLACEMENT FESTIVAL OTHER)")
    ap.add_argument("--exclude-types", nargs="*", default=[])
    ap.add_argument("--min-intensity", type=float, default=0.0)
    ap.add_argument("--no-group-scope", action="store_true", help="events affect every link regardless of affectedGroups")
    # bias gates (skill = model MAE / persistence MAE in the same slice)
    ap.add_argument("--max-ratio", type=float, default=1.25,
                    help="flag a slice whose skill is this many times worse than the overall skill")
    ap.add_argument("--min-slice", type=int, default=200)
    ap.add_argument("--out", default="models/lstm.pt"); ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()
    torch.manual_seed(args.seed); rng = np.random.default_rng(args.seed)

    series, events = load_csv(args.util_csv, args.events_csv, args.tz_offset_min) if args.util_csv else \
        simulate(args.links, args.days, seed=args.seed)
    flt = EventFilter(include_types=args.event_types, exclude_types=args.exclude_types,
                      min_intensity=args.min_intensity, group_scoped=not args.no_group_scope)

    # some links never seen in training -> measures generalisation to new links
    perm = rng.permutation(len(series)); n_test = max(1, int(0.2 * len(series)))
    unseen_ids = {series[i].link_id for i in perm[:n_test]}
    train_s = [s for s in series if s.link_id not in unseen_ids]
    ds_tr = WindowDataset(train_s, events, flt, 0.00, 0.70, 2, args.threshold)
    ds_va = WindowDataset(train_s, events, flt, 0.72, 0.85, 5, args.threshold)   # later in time
    ds_te = WindowDataset(series, events, flt, 0.85, 1.00, 5, args.threshold)    # ALL links, latest time
    print(f"train {len(ds_tr)}  val {len(ds_va)}  test {len(ds_te)}  (unseen links: {sorted(unseen_ids)})")

    model = Net(args.hidden)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)
    w = balance_weights(ds_tr.stratum, args.balance)
    best, best_state, bad = 1e9, None, 0
    for ep in range(args.epochs):
        model.train()
        sampler = WeightedRandomSampler(w, num_samples=args.samples_per_epoch, replacement=True)
        for seq, stat, y in DataLoader(ds_tr, batch_size=256, sampler=sampler):
            loss = pinball(model(seq, stat), y).mean()
            opt.zero_grad(); loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step()
        sched.step()
        P, Y, _ = predict(model, ds_va)
        vl = pinball(torch.from_numpy(P), torch.from_numpy(Y)).mean().item()
        print(f"epoch {ep + 1:02d}  val pinball {vl:.5f}")
        if vl < best - 1e-5:
            best, best_state, bad = vl, copy.deepcopy(model.state_dict()), 0
        else:
            bad += 1
            if bad >= 5: break
    model.load_state_dict(best_state)

    # ---- bias report ----
    P, Y, L = predict(model, ds_te); thr = args.threshold
    is_unseen = np.array([s.link_id in unseen_ids for s in series])
    masks = {"overall": np.ones(len(Y), bool),
             "links=unseen": is_unseen[ds_te.link], "links=seen": ~is_unseen[ds_te.link]}
    for li, s in enumerate(series):
        masks[f"link={s.link_id}{'*' if s.link_id in unseen_ids else ''}"] = ds_te.link == li
    for g in sorted({g for s in series for g in s.groups}):
        has = np.array([g in s.groups for s in series]); masks[f"group={g}"] = has[ds_te.link]
    for d in np.unique(ds_te.dom):
        masks[f"event={'NONE' if d == 0 else EVENT_TYPES[d - 1]}"] = ds_te.dom == d
    for b in range(4): masks[f"hours={b * 6:02d}-{b * 6 + 6:02d}"] = ds_te.hb == b
    masks["congested=1"] = ds_te.cong == 1; masks["congested=0"] = ds_te.cong == 0
    rep = {k: stats(P[m], Y[m], L[m], thr) for k, m in masks.items() if m.any()}

    ov = rep["overall"]; ov_skill = ov["mae"] / ov["persistence_mae"]; flags = []
    if ov_skill >= 1.0: flags.append("model does not beat persistence baseline overall")
    for k, h in enumerate(HORIZONS):
        m_h, p_h = np.abs(P[:, k, 1] - Y[:, k]).mean(), np.abs(L - Y[:, k]).mean()
        if m_h > 1.10 * p_h: flags.append(f"+{h} min horizon worse than persistence ({m_h:.4f} vs {p_h:.4f})")
    for k, v in rep.items():
        if k == "overall" or v["n"] < args.min_slice: continue
        skill = v["mae"] / max(v["persistence_mae"], 1e-9)
        if skill > 1.10:
            flags.append(f"{k}: worse than persistence (MAE {v['mae']:.4f} vs {v['persistence_mae']:.4f})")
        elif skill > ov_skill * args.max_ratio:
            flags.append(f"{k}: relative skill {skill:.2f} vs overall {ov_skill:.2f}")
        if k.startswith("congested="):      # selected by the outcome -> bias/coverage are biased by construction
            continue
        if abs(v["coverage"] - 0.8) > 0.10: flags.append(f"{k}: 80% interval coverage {v['coverage']:.2f}")
        if abs(v["bias"]) > 0.03: flags.append(f"{k}: systematic error {v['bias']:+.3f}")
    print(f"\n{'slice':24s}{'n':>7s}{'MAE':>8s}{'pers':>8s}{'bias':>8s}{'cov80':>7s}{'c.rec':>7s}{'c.prec':>7s}   (* = unseen link)")
    fmt = lambda x: "-" if x is None else f"{x:.2f}"
    for k, v in rep.items():
        print(f"{k:24s}{v['n']:7d}{v['mae']:8.4f}{v['persistence_mae']:8.4f}{v['bias']:+8.3f}{v['coverage']:7.2f}"
              f"{fmt(v['congestion_recall']):>7s}{fmt(v['congestion_precision']):>7s}")
    print("\nper horizon (model MAE vs persistence MAE):")
    for k, h in enumerate(HORIZONS):
        print(f"  +{h:2d} min   model {np.abs(P[:, k, 1] - Y[:, k]).mean():.4f}   persistence {np.abs(L - Y[:, k]).mean():.4f}")
    print("\nBIAS FLAGS:\n  " + "\n  ".join(flags) if flags else "\nno bias flags")

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    torch.save({"state": model.state_dict(), "filter": asdict(flt), "cfg": {"hidden": args.hidden},
                "threshold": float(thr), "version": f"lstm-{time.strftime('%Y%m%d-%H%M')}"}, args.out)
    with open(os.path.join(os.path.dirname(args.out) or ".", "report.json"), "w") as f:
        json.dump({"slices": rep, "flags": flags}, f, indent=2)
    if flags and args.strict: sys.exit(1)


if __name__ == "__main__":
    main()