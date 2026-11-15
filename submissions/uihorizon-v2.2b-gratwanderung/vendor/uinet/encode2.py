"""UIObs v2 -> the v2 network's input arrays (SX-04-19).  Same inputs as ``uinet.encode`` (v1), wider, plus t_rel:

  t_cat / t_num / s_cat / s_num   the v2 thing arrays (uinet.feat2)
  t_kind   v1's kinds + KIND_TIMER: a reserved effect (UIObs "timers"), encoded as that effect's slots
  t_ext    [T, 18]  v1's six (hand position, can be played, uses left, no-limit uses, turns left, no-limit turns) +
           what the screen shows of the relations, from the card search rule (uinet.feat2.Matcher):
             cards     ptrig  lasting effects in view whose card-play trigger watches this card (/3)
                       mtrig  ... whose card-move trigger watches it (/3)
                       cost   a card-cost change applies to it (1), the cost it sets (slog), its uses left (/10)
                       rep    a play-count buff's extra plays for it (/2), the buff's uses left (/10), turns left
                              (/10) and its no-limit flag
             enchants  hand / view   cards in the hand / anywhere in view its trigger watches (/5, /10)
             timers    at_end (fires at the turn's end), turns left in "turns left"
  g_num    [52]  v1's 47 + reserved effects, cost changes, play-count buffs, the soonest timer, any watched card in hand
  g_cat    [5]   v1's plan, round, produce, stance + the idol card's archetype (plan x exam effect type, from
                 exam["idol"]: the 6 classes 好調 / 集中 / 好印象 / やる気 / 強気 / 全力)
  t_rel    [T, T] int64 bitmask: which thing acts on which (row i, column j), the edges the counts above summarise --
             bit 0  enchant i's card-play trigger watches card j        (trigger reading: any one effect group)
             bit 1  enchant i's card-move trigger watches card j
             bit 2  an effect of enchant i reaches card j through its card search  (zone reading, j's upgrade)
             bit 3  an effect of card i (its play effects, its status enchant) reaches card j
             bit 4  card i's play condition counts card j (a zone search of its trigger)
             bit 5  reserved effect i reaches card j
           The model adds a learned per-head bias for each bit (and one for the reverse direction) to the attention
           logits between the two tokens (uinet.model), so "this P item fires on that card" is an edge, not a count.

A card's effect groups for every match include those its customizes and in-exam grows add (feat2.extra_groups), as
the core's card_has_eg reads them.
"""
from __future__ import annotations

import numpy as np

from .encode import QUANTILES, VALUE_SHIFT, global_features  # noqa: F401 -- QUANTILES / VALUE_SHIFT re-exported
from .encode import ThingTable as _ThingTableV1
from .encode import collate as _collate
from .feat import slog
from .feat2 import SLOT_CAT, SLOT_NUM, SLOTS, THING_CAT, Featurizer2, card_key
from .uiobs import INF

KIND_HAND, KIND_DECK, KIND_GRAVE, KIND_HOLD, KIND_LOST, KIND_PLAYED, KIND_ENCH, KIND_DRINK, KIND_TIMER = range(1, 10)
N_KINDS = 10
ZONES = (("deck", KIND_DECK), ("grave", KIND_GRAVE), ("hold", KIND_HOLD), ("lost", KIND_LOST),
         ("played", KIND_PLAYED))
T_EXT = 18
G_NUM = 52
G_CAT = ("plan", "step", "produce", "stance", "arch")
REL_BITS = 6
INPUTS = ("g_num", "g_cat", "st_kind", "st_num", "t_kind", "t_cat", "t_num", "s_cat", "s_num", "t_ext", "a_tok",
          "t_rel")


class Rows:
    """The table's rows in blocks of CHUNK: four arrays per block instead of four small arrays per row.  A training
    table has millions of rows (every state of a card that grows during the exam is one), and as a list of tuples
    a row took 4.2 KB for 2.4 KB of data.  Reads as the list did: len, rows[i] (a tuple of views), slices, iteration,
    append, ``del rows[1:]``."""
    CHUNK = 16384

    def __init__(self, first):
        self._like = [(a.shape, a.dtype) for a in first]
        self._blocks = [[] for _ in first]
        self._n = 0
        self.append(first)

    def __len__(self):
        return self._n

    def append(self, row):
        c, o = divmod(self._n, self.CHUNK)
        if o == 0 and len(self._blocks[0]) == c:
            for k, (shape, dtype) in enumerate(self._like):
                self._blocks[k].append(np.zeros((self.CHUNK,) + shape, dtype))
        for k, x in enumerate(row):
            self._blocks[k][c][o] = x
        self._n += 1

    def __getitem__(self, i):
        if isinstance(i, slice):
            return [self[j] for j in range(*i.indices(self._n))]
        if i < 0:
            i += self._n
        if not 0 <= i < self._n:
            raise IndexError(i)
        c, o = divmod(i, self.CHUNK)
        return tuple(b[c][o] for b in self._blocks)

    def __iter__(self):
        return (self[i] for i in range(self._n))

    def __delitem__(self, i):
        if not (isinstance(i, slice) and i.start == 1 and i.stop is None and i.step is None):
            raise TypeError("only `del rows[1:]`")
        first = tuple(x.copy() for x in self[0])
        self._blocks = [[] for _ in first]
        self._n = 0
        self.append(first)

    def blocks(self):
        return -(-self._n // self.CHUNK)

    def block(self, k, c, take=False):
        """The filled part of block C of array K; TAKE drops the table's own reference (the rows are gone then)."""
        b = self._blocks[k][c]
        if take:
            self._blocks[k][c] = None
        return b[:min(self.CHUNK, self._n - c * self.CHUNK)]


class ThingTable2(_ThingTableV1):
    """Every distinct card spec / drink / enchant / reserved effect once, with its v2 arrays (row 0 = padding).  The
    categoricals are kept as int16 and the slot numbers as float16 (a v2 row is about 2 KB); ``collate`` and
    UINet.forward_table widen them."""

    def __init__(self, featurizer=None):
        self.f = featurizer or Featurizer2()
        self.index = {}
        self.rows = Rows((np.zeros(len(THING_CAT), np.int16), np.zeros(len(self.f.thing_num), np.float32),
                          np.zeros((SLOTS, len(SLOT_CAT)), np.int16), np.zeros((SLOTS, len(SLOT_NUM)), np.float16)))
        self._arrays = None

    def arrays(self):
        if self._arrays is None:
            r = self.rows
            self._arrays = tuple(np.concatenate([r.block(k, c) for c in range(r.blocks())]) for k in range(4))
        return self._arrays

    def _add(self, key, make):
        i = self.index.get(key)
        if i is None:
            tc, tn, sc, sn = make()
            i = self.index[key] = len(self.rows)
            self.rows.append((tc.astype(np.int16), tn, sc.astype(np.int16), sn.astype(np.float16)))
            self._arrays = None
        return i

    def effect(self, e):
        return self._add("x" + str(e), lambda: self.f.effect(e))

    def card(self, c):
        spec = {k: c[k] for k in ("id", "u", "c", "g") if k in c}
        return self._add(("c",) + card_key(c), lambda: self.f.card(spec))

    def reset(self):
        self.index = {}
        del self.rows[1:]
        self._arrays = None
        self.f = Featurizer2(master=self.f.m, vocab=self.f.v, card_groups=self.f.groups)


def _left(x):
    if x == INF or x is None:
        return 0.0, 1.0
    return min(20, int(x)) / 10.0, 0.0


class Encoder2:
    obs = "v2"

    def __init__(self, table=None):
        self.table = table or ThingTable2()
        self.v = self.table.f.v
        self._arch = {}

    def arch(self, idol):
        """'PLAN1/EXAM_EFFECT_TYPE_...' of an idol card (uinet.loadouts.archetype), None when unknown."""
        if idol not in self._arch:
            try:
                from .loadouts import archetype
                self._arch[idol] = archetype(idol) if idol else None
            except (KeyError, OSError):
                self._arch[idol] = None
        return self._arch[idol]

    def compact(self, o):
        v, tb = self.v, self.table
        f, mt = tb.f, tb.f.matcher
        stance = (o.get("stance") or [None, 0])[0]
        g_cat = np.asarray([v("plan", o["exam"].get("plan")), v("step", o["exam"].get("step")),
                            v("produce", o["exam"].get("produce")), v("stance", stance),
                            v("arch", self.arch(o["exam"].get("idol")))], np.int64)
        st = o.get("status") or []
        st_kind = np.asarray([v("status", s[0]) for s in st], np.int64)
        st_num = np.zeros((len(st), 3), np.float32)
        for i, s in enumerate(st):
            left, inf = _left(s[2])
            st_num[i] = (slog(s[1]), left, inf)

        # -- tokens
        kinds, idx, ext, cards = [], [], [], []           # cards: (token, card) of every card in view
        for i, c in enumerate(o["hand"]):
            kinds.append(KIND_HAND)
            idx.append(tb.card(c))
            ext.append([min(i, 9) / 9.0, float(c.get("p", 0)), 0, 0, 0, 0] + [0.0] * 12)
            cards.append((len(kinds) - 1, c))
        for d in o.get("drinks") or ():
            kinds.append(KIND_DRINK)
            idx.append(tb.drink(d))
            ext.append([0, 1.0] + [0.0] * (T_EXT - 2))
        for zone, kind in ZONES:
            for c in o.get(zone) or ():
                kinds.append(kind)
                idx.append(tb.card(c))
                ext.append([0.0] * T_EXT)
                cards.append((len(kinds) - 1, c))
        ench_tok = []
        for e in o.get("ench") or ():
            ul, ui = _left(e[1])
            tl, ti = _left(e[2])
            kinds.append(KIND_ENCH)
            idx.append(tb.enchant(e[0]))
            ext.append([0, 0, ul, ui, tl, ti] + [0.0] * 12)
            ench_tok.append((len(kinds) - 1, e))
        timer_tok = []
        soonest = None
        for turns, effect_id, at_end in o.get("timers") or ():
            kinds.append(KIND_TIMER)
            idx.append(tb.effect(effect_id))
            tl, ti = _left(turns)
            ext.append([0, 0, 0, 0, tl, ti] + [0.0] * 11 + [float(at_end)])
            timer_tok.append((len(kinds) - 1, effect_id))
            soonest = turns if soonest is None else min(soonest, turns)

        # -- the card search rule over the cards in view, once per distinct card and search
        distinct = {}
        for t, c in cards:
            k = card_key(c)
            if k not in distinct:
                distinct[k] = (c, f.extra_groups(c), [])
            distinct[k][2].append(t)
        memo = {}

        def matched(sid, any_group, zone):
            key = (sid, any_group, zone)
            hit = memo.get(key)
            if hit is None:
                hit = []
                for c, xg, toks in distinct.values():
                    up = int(c.get("u", 0) or 0)
                    if mt.match(sid, c["id"], up, any_group, up if zone else None, xg):
                        hit.extend(toks)
                memo[key] = hit
            return hit

        hand_toks = {t for t, _c in cards[:len(o["hand"])]}
        not_played = {t for t, _c in cards} - {t for t, k in zip(range(len(kinds)), kinds) if k == KIND_PLAYED}
        edges = []
        ptrig, mtrig = {}, {}
        any_watched = 0.0
        for t, e in ench_tok:
            sid, kind = f.trigger_search(e[0])
            if sid and kind:
                hit = matched(sid, True, False)
                for j in hit:
                    edges.append((t, j, 0 if kind == "play" else 1))
                    (ptrig if kind == "play" else mtrig)[j] = (ptrig if kind == "play" else mtrig).get(j, 0) + 1
                nh = sum(1 for j in hit if j in hand_toks)
                nv = sum(1 for j in hit if j in not_played)
                ext[t][15], ext[t][16] = min(5, nh) / 5.0, min(10, nv) / 10.0
                any_watched = max(any_watched, float(nh > 0))
            for sid in f.effect_searches("enchant", e[0]):
                for j in matched(sid, False, True):
                    edges.append((t, j, 2))
        for t, c in cards:
            for sid in f.effect_searches("card", c):
                for j in matched(sid, False, True):
                    edges.append((t, j, 3))
            for sid in f.condition_searches(c):
                for j in matched(sid, False, False):
                    edges.append((t, j, 4))
        for t, eid in timer_tok:
            for sid in f.effect_searches("effect", eid):
                for j in matched(sid, False, True):
                    edges.append((t, j, 5))

        # -- cost changes and play-count buffs on each card, with their lifetimes
        costs = [(sid, value, left) for sid, value, left in o.get("costs") or ()]
        pcount = [(sid, extra, uses, turns) for sid, extra, uses, turns in o.get("pcount") or ()]
        cost_hit = [None if sid is None else set(matched(sid, False, True)) for sid, _v, _l in costs]
        rep_hit = [set(matched(sid, False, False)) for sid, _x, _u, _t in pcount]
        for t, c in cards:
            row = ext[t]
            row[6], row[7] = min(3, ptrig.get(t, 0)) / 3.0, min(3, mtrig.get(t, 0)) / 3.0
            for (sid, value, left), hit in zip(costs, cost_hit):
                if hit is None or t in hit:
                    row[8], row[9], row[10] = 1.0, slog(value), min(20, int(left)) / 10.0
                    break
            best = None
            for (sid, extra, uses, turns), hit in zip(pcount, rep_hit):
                if t in hit and (best is None or int(extra) > int(best[1])):
                    best = (sid, extra, uses, turns)
            if best is not None:
                tl, ti = _left(best[3])
                row[11], row[12], row[13], row[14] = min(2, int(best[1])) / 2.0, min(20, int(best[2])) / 10.0, tl, ti

        n_hand = len(o["hand"])
        a_tok = [int(a[1]) if a[0] == "play" else n_hand + int(a[1]) if a[0] == "drink" else -1 for a in o["legal"]]
        g = list(global_features(o)) + [len(o.get("timers") or ()) / 4.0, len(costs) / 2.0, len(pcount) / 2.0,
                                        0.0 if soonest is None else 1.0 / (1.0 + soonest), any_watched]
        rel = np.asarray(sorted(set(edges)), np.int16).reshape(-1, 3)
        return {"g_num": np.asarray(g[:G_NUM], np.float32), "g_cat": g_cat, "st_kind": st_kind, "st_num": st_num,
                "t_kind": np.asarray(kinds, np.int64), "t_idx": np.asarray(idx, np.int64),
                "t_ext": np.asarray(ext, np.float32).reshape(-1, T_EXT), "a_tok": np.asarray(a_tok, np.int64),
                "t_rel": rel}

    def batch(self, samples):
        return collate(samples, self.table)

    def encode(self, o):
        return collate([self.compact(o)], self.table)


def collate(samples, table, gather=True):
    """uinet.encode.collate with the v2 widths, and t_rel as a dense [B, T, T] bitmask."""
    out = _collate(samples, table, gather=gather, t_ext=T_EXT)
    if gather:
        out["t_cat"], out["s_cat"] = out["t_cat"].astype(np.int64), out["s_cat"].astype(np.int64)
        out["s_num"] = out["s_num"].astype(np.float32)
    T = out["t_kind"].shape[1]
    rel = np.zeros(len(samples) * T * T, np.int64)
    parts = [(b, s["t_rel"]) for b, s in enumerate(samples) if s.get("t_rel") is not None and len(s["t_rel"])]
    if parts:
        e = np.concatenate([x for _b, x in parts]).astype(np.int64)
        base = np.concatenate([np.full(len(x), b * T * T, np.int64) for b, x in parts])
        flat = base + e[:, 0] * T + e[:, 1]
        for bit in range(REL_BITS):                     # a sample's edges are unique per (i, j, bit)
            m = e[:, 2] == bit
            if m.any():
                rel[flat[m]] |= 1 << bit
    out["t_rel"] = rel.reshape(len(samples), T, T)
    return out
