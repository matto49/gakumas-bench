"""UIObs -> the network's input arrays, and batches of them.

The network's inputs (one row per sample, padded per batch):
  g_num   [G] float   score, stamina, turn, the turn colours ahead, permils, criteria, zone sizes, ...
  g_cat   [4] int     plan, round (step), produce, stance
  st_kind [S] int     status kind; st_num [S, 3] (value, turns left, no-limit flag)
  t_kind  [T] int     what a thing token is (KIND_*); hand cards first in screen order, then drinks, then the rest
  t_cat [T, 8] / t_num [T, 20] / s_cat [T, 12, 6] / s_num [T, 12, 14]   the thing's arrays (uinet.feat)
  t_ext   [T, 6]      hand position, can be played, uses left, no-limit uses, turns left, no-limit turns
  a_tok   [A] int     per legal action, the token it acts on: a thing index, or -1 for "end" (-2 = padding)

A sample is kept compact: its things are indices into a ``ThingTable`` (every distinct card / drink / enchant once);
``collate`` gathers the arrays.  The model prepends a global and an "end" token, so thing i sits at 2 + S + i.
"""
from __future__ import annotations

import json
import math

import numpy as np

from .feat import SLOT_CAT, SLOT_NUM, SLOTS, THING_CAT, THING_NUM, Featurizer, slog
from .uiobs import INF, v1_view

KIND_HAND, KIND_DECK, KIND_GRAVE, KIND_HOLD, KIND_LOST, KIND_PLAYED, KIND_ENCH, KIND_DRINK = range(1, 9)
N_KINDS = 9
ZONES = (("deck", KIND_DECK), ("grave", KIND_GRAVE), ("hold", KIND_HOLD), ("lost", KIND_LOST),
         ("played", KIND_PLAYED))
T_EXT = 6
G_NUM = 47
QUANTILES = (0.1, 0.25, 0.5, 0.75, 0.9)   # the value head's outputs
VALUE_SHIFT = 13.0                         # log(final score) is about 10..16 for H.I.F; the value head predicts it minus this
INPUTS = ("g_num", "g_cat", "st_kind", "st_num", "t_kind", "t_cat", "t_num", "s_cat", "s_num", "t_ext", "a_tok")


def _onehot3(t):
    v = [0.0, 0.0, 0.0]
    if t in (1, 2, 3):
        v[t - 1] = 1.0
    return v


def global_features(o):
    ex, nm = o["exam"], o["num"]
    turn, limit = int(ex["turn"]), max(1, int(ex["limit"]))
    types = list(ex.get("types") or [])
    cur = types[turn - 1] if 0 < turn <= len(types) else 0
    ahead = []
    for k in (1, 2, 3):
        t = types[turn - 1 + k] if turn - 1 + k < len(types) else 0
        ahead += _onehot3(t)
    rest = types[turn - 1:] if turn - 1 < len(types) else []
    counts = [sum(1 for t in rest if t == k) / 12.0 for k in (1, 2, 3)]
    permil = [max(0, int(p)) for p in ex.get("permil") or [0, 0, 0]]
    pmax = max(permil) or 1
    crit = [max(0, int(c)) for c in ex.get("crit") or [0, 0, 0]]
    csum = sum(crit) or 1
    ms = max(1, int(nm.get("max_stamina") or 1))
    cur_permil = permil[cur - 1] if cur in (1, 2, 3) else 0
    stance = o.get("stance") or [None, 0]
    zones = [len(o.get(z) or ()) / 20.0 for z in ("hand", "deck", "grave", "hold", "lost", "played")]
    g = ([math.log1p(max(0, int(nm["score"]))) / 15.0, int(nm["stamina"]) / ms, ms / 60.0, slog(nm.get("block")),
          min(4, int(nm.get("playable") or 0)) / 4.0, min(6, int(nm.get("plays") or 0)) / 6.0,
          turn / limit, (limit - turn) / 12.0, limit / 12.0, max(0, limit - len(types)) / 3.0]
         + _onehot3(cur) + ahead + counts
         + [slog(p) for p in permil] + [p / pmax for p in permil] + [math.log1p(cur_permil) / 12.0]
         + [c / csum for c in crit] + [slog(sum(crit))]
         + zones + [min(3, int(stance[1] or 0)) / 3.0, len(o.get("drinks") or ()) / 4.0,
                    len(o.get("ench") or ()) / 20.0, len(o.get("status") or ()) / 12.0,
                    float(int(nm.get("playable") or 0) > 0)])
    g += [0.0] * (G_NUM - len(g))
    return np.asarray(g[:G_NUM], np.float32)


class ThingTable:
    """Every distinct card spec / drink / enchant once, with its arrays (row 0 = padding)."""

    def __init__(self, featurizer=None):
        self.f = featurizer or Featurizer()
        self.index = {}
        self.rows = [(np.zeros(len(THING_CAT), np.int64), np.zeros(len(THING_NUM), np.float32),
                      np.zeros((SLOTS, len(SLOT_CAT)), np.int64), np.zeros((SLOTS, len(SLOT_NUM)), np.float32))]
        self._arrays = None

    def _add(self, key, make):
        i = self.index.get(key)
        if i is None:
            tc, tn, sc, sn = make()
            i = self.index[key] = len(self.rows)
            self.rows.append((tc.astype(np.int64), tn, sc.astype(np.int64), sn))
            self._arrays = None
        return i

    def card(self, c):
        spec = {k: c[k] for k in ("id", "u", "c", "g") if k in c}
        return self._add("c" + json.dumps(spec, sort_keys=True, separators=(",", ":")), lambda: self.f.card(spec))

    def drink(self, d):
        return self._add("d" + d, lambda: self.f.drink(d))

    def enchant(self, e):
        return self._add("e" + str(e), lambda: self.f.enchant(e))

    def arrays(self):
        if self._arrays is None:
            self._arrays = tuple(np.stack([r[k] for r in self.rows]) for k in range(4))
        return self._arrays

    def reset(self):
        """Discard memoized features and rows; invalidates every existing compact sample's t_idx.
        Call only when those samples are discarded or will all be re-encoded (including retained replay rows)."""
        self.index = {}
        del self.rows[1:]
        self._arrays = None
        self.f = Featurizer(master=self.f.m, vocab=self.f.v)


class Encoder:
    def __init__(self, table=None):
        self.table = table or ThingTable()
        self.v = self.table.f.v

    @staticmethod
    def _left(x):
        if x == INF or x is None:
            return 0.0, 1.0
        return min(20, int(x)) / 10.0, 0.0

    def compact(self, o):
        o = v1_view(o)                                   # a v2 document: what v1 shows (SX-04-19)
        v, tb = self.v, self.table
        stance = (o.get("stance") or [None, 0])[0]
        g_cat = np.asarray([v("plan", o["exam"].get("plan")), v("step", o["exam"].get("step")),
                            v("produce", o["exam"].get("produce")), v("stance", stance)], np.int64)
        st = o.get("status") or []
        st_kind = np.asarray([v("status", s[0]) for s in st], np.int64)
        st_num = np.zeros((len(st), 3), np.float32)
        for i, s in enumerate(st):
            left, inf = self._left(s[2])
            st_num[i] = (slog(s[1]), left, inf)
        kinds, idx, ext = [], [], []
        for i, c in enumerate(o["hand"]):
            kinds.append(KIND_HAND)
            idx.append(tb.card(c))
            ext.append((min(i, 9) / 9.0, float(c.get("p", 0)), 0, 0, 0, 0))
        for d in o.get("drinks") or ():
            kinds.append(KIND_DRINK)
            idx.append(tb.drink(d))
            ext.append((0, 1.0, 0, 0, 0, 0))
        for zone, kind in ZONES:
            for c in o.get(zone) or ():
                kinds.append(kind)
                idx.append(tb.card(c))
                ext.append((0, 0, 0, 0, 0, 0))
        for e in o.get("ench") or ():
            ul, ui = self._left(e[1])
            tl, ti = self._left(e[2])
            kinds.append(KIND_ENCH)
            idx.append(tb.enchant(e[0]))
            ext.append((0, 0, ul, ui, tl, ti))
        n_hand = len(o["hand"])
        a_tok = [int(a[1]) if a[0] == "play" else n_hand + int(a[1]) if a[0] == "drink" else -1 for a in o["legal"]]
        return {"g_num": global_features(o), "g_cat": g_cat, "st_kind": st_kind, "st_num": st_num,
                "t_kind": np.asarray(kinds, np.int64), "t_idx": np.asarray(idx, np.int64),
                "t_ext": np.asarray(ext, np.float32).reshape(-1, T_EXT), "a_tok": np.asarray(a_tok, np.int64)}

    def batch(self, samples):
        return collate(samples, self.table)

    def encode(self, o):
        """One observation as a batch of one (inference)."""
        return collate([self.compact(o)], self.table)


def collate(samples, table, gather=True, t_ext=T_EXT):
    """Pad compact samples into batch arrays (numpy), the things gathered from TABLE (GATHER False: keep
    ``t_idx``, for UINet.forward_table).  T_EXT: the width of t_ext (v2: uinet.encode2.T_EXT)."""
    B = len(samples)
    S = max(1, max(len(s["st_kind"]) for s in samples))
    T = max(1, max(len(s["t_kind"]) for s in samples))
    A = max(1, max(len(s["a_tok"]) for s in samples))
    out = {
        "g_num": np.stack([s["g_num"] for s in samples]),
        "g_cat": np.stack([s["g_cat"] for s in samples]),
        "st_kind": np.zeros((B, S), np.int64), "st_num": np.zeros((B, S, 3), np.float32),
        "t_kind": np.zeros((B, T), np.int64), "t_ext": np.zeros((B, T, t_ext), np.float32),
        "a_tok": np.full((B, A), -2, np.int64),
    }
    t_idx = np.zeros((B, T), np.int64)
    for b, s in enumerate(samples):
        ns, nt, na = len(s["st_kind"]), len(s["t_kind"]), len(s["a_tok"])
        out["st_kind"][b, :ns] = s["st_kind"]
        out["st_num"][b, :ns] = s["st_num"]
        out["t_kind"][b, :nt] = s["t_kind"]
        out["t_ext"][b, :nt] = s["t_ext"]
        t_idx[b, :nt] = s["t_idx"]
        out["a_tok"][b, :na] = s["a_tok"]
    if not gather:
        out["t_idx"] = t_idx
        return out
    tc, tn, sc, sn = table.arrays()
    out["t_cat"], out["t_num"], out["s_cat"], out["s_num"] = tc[t_idx], tn[t_idx], sc[t_idx], sn[t_idx]
    return out
