from __future__ import annotations
from dataclasses import dataclass, field
from functools import lru_cache
from typing import List, Optional
import numpy as np

EVENT_TYPES = ["EXAM", "PLACEMENT", "FESTIVAL", "OTHER"]
N_TYPES = len(EVENT_TYPES)
TYPE_IDX = {t: i for i, t in enumerate(EVENT_TYPES)}
HORIZONS = (15, 30, 60)
N_H = len(HORIZONS)
MAX_H = max(HORIZONS)
WINDOW = 60                      # minutes of history, 1-min resolution
QUANTILES = (0.1, 0.5, 0.9)
F_SEQ = 5 + N_TYPES              # util, sin/cos time-of-day, sin/cos day-of-week, per-type event intensity
F_STAT = N_TYPES + N_H           # upcoming event intensity per type + max per horizon


@dataclass
class Event:
    type: str
    start_min: int               # minutes since epoch
    end_min: int
    intensity: float             # expectedIntensity, 0..1
    groups: Optional[frozenset] = None   # affectedGroups; None/empty = all links


@dataclass
class EventFilter:
    include_types: Optional[List[str]] = None
    exclude_types: List[str] = field(default_factory=list)
    min_intensity: float = 0.0
    group_scoped: bool = True    # only events whose affectedGroups overlap the link's groups
    # Types visible BEFORE they start. Campus events are scheduled, so all four by default.
    scheduled_types: List[str] = field(default_factory=lambda: list(EVENT_TYPES))

    def keep(self, ev: Event, link_groups: frozenset) -> bool:
        if self.include_types is not None and ev.type not in self.include_types:
            return False
        if ev.type in self.exclude_types or ev.intensity < self.min_intensity:
            return False
        if self.group_scoped and ev.groups and not (ev.groups & link_groups):
            return False
        return True


def event_channels(events, link_groups: frozenset, flt: EventFilter, tm: np.ndarray) -> np.ndarray:
    """(len(tm), N_TYPES) intensity per event type at each minute in tm."""
    ch = np.zeros((len(tm), N_TYPES), np.float32)
    for ev in events:
        if not flt.keep(ev, link_groups):
            continue
        m = (tm >= ev.start_min) & (tm < ev.end_min)
        if m.any():
            j = TYPE_IDX[ev.type]
            ch[m, j] = np.maximum(ch[m, j], ev.intensity)
    return ch


def time_feats(tm: np.ndarray) -> np.ndarray:
    """tm = LOCAL minutes since epoch (so hour-of-day matches campus time)."""
    mod = (tm % 1440) / 1440.0 * 2 * np.pi
    dow = (((tm // 1440) + 3) % 7) / 7.0 * 2 * np.pi      # epoch day 0 = Thursday, Monday = 0
    return np.stack([np.sin(mod), np.cos(mod), np.sin(dow), np.cos(dow)], 1).astype(np.float32)


@lru_cache(maxsize=16)
def _sched_mask(scheduled: tuple) -> np.ndarray:
    return np.array([1.0 if t in scheduled else 0.0 for t in EVENT_TYPES], np.float32)


def assemble(util_win, tf_win, ch_win, ch_fut, flt: EventFilter):
    """-> seq (WINDOW, F_SEQ), static (F_STAT,)"""
    seq = np.concatenate([util_win[:, None].astype(np.float32), tf_win, ch_win], 1)
    fut = ch_fut * _sched_mask(tuple(flt.scheduled_types))
    per_h = np.array([fut[:h].max() for h in HORIZONS], np.float32)
    return seq, np.concatenate([fut.max(0), per_h]).astype(np.float32)