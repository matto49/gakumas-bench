"""What a card, a status enchant (P item, memory, a card's lasting effect) or a drink does, as fixed-size arrays.

The network never learns a card by its id alone (SX-02 / L2 lesson: 26 decks and id features did not transfer).
Every object is described by its effects, read from master: each effect becomes a *slot* (effect type, values,
count, turns, the condition that gates it, the zone it searches or moves to), and an effect that installs an
enchant or chains another effect adds the installed effects as nested slots.  A card unseen in training is
encoded from effect types that were seen.

One layout serves the three kinds (a ``Thing``): object-level categoricals and numbers, plus up to SLOTS effect
slots.  Categorical values are indices into the frozen vocabulary ``schema/vocab.v1.json``: 0 = none, 1 = unknown
(a value the master of a later client build adds), 2.. = known.

The card's *current* form is what the screen shows: its upgrade count (base, in-exam and support upgrades) with
its customizes and in-exam grows applied -- the engine's resolved card for that instance.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from . import engine

SLOTS = 12
SLOT_CAT = ("etype", "phase", "fstat", "spos", "prange", "mpos")
SLOT_NUM = ("present", "v1", "v2", "count", "turn", "enchant", "target", "once", "nested", "cond", "fsval",
            "phval", "pickmax", "chain")
THING_CAT = ("category", "rarity", "plan", "ctype", "mpos", "cfstat", "cphase", "origin")
THING_NUM = ("cost", "stamina", "force", "upgrade", "nodup", "initial", "ncust", "c_lesson", "c_cost_red",
             "c_cost_add", "c_count", "c_fpp", "c_pen", "c_turn", "ngrow", "senchant", "cfsval", "nfx",
             "phval", "fsval2")
VOCAB_PATH = engine.TREE / "schema" / "vocab.v1.json"
VOCAB_FIELDS = ("etype", "phase", "fstat", "spos", "prange", "mpos", "category", "rarity", "plan", "ctype",
                "origin", "status", "stance", "step", "produce")


def num_of(v):
    if isinstance(v, dict):
        return v.get("number")
    return v


def slog(x):
    """Signed log scale for the wide-range master values (1 .. 10^5)."""
    if x is None:
        return 0.0
    x = float(x)
    return math.copysign(math.log1p(abs(x)), x) / 4.0


def card_origin(card_id):
    if "-ido-" in card_id:
        return "idol"
    if "-sup-" in card_id:
        return "support"
    if "-acc-" in card_id:
        return "trouble"
    return "pool"


# ----------------------------------------------------------------------------- vocabulary
def build_vocab(master):
    """The values each categorical field takes in this master (sorted), plus the fixed name lists."""
    from .uiobs import STATUS_KINDS, STANCES, STEPS, PRODUCES, ORIGINS
    vals = {f: set() for f in VOCAB_FIELDS}
    for e in master.effects.values():
        vals["etype"].add(num_of(e.get("effectType")))
        if e.get("pickRangeType") is not None:
            vals["prange"].add(num_of(e.get("pickRangeType")))
        if e.get("movePositionType") is not None:
            vals["mpos"].add(num_of(e.get("movePositionType")))
    for t in master.triggers.values():
        for x in t.get("phaseTypes") or ():
            vals["phase"].add(num_of(x))
        for x in t.get("fieldStatusTypes") or ():
            vals["fstat"].add(num_of(x))
    for s in master.searches.values():
        if s.get("cardPositionType") is not None:
            vals["spos"].add(num_of(s.get("cardPositionType")))
    for c in master.cards.values():
        vals["category"].add(num_of(c.get("category")))
        vals["rarity"].add(num_of(c.get("rarity")))
        vals["plan"].add(num_of(c.get("planType")))
        vals["ctype"].add(num_of(c.get("costType")) if c.get("costType") is not None else 0)
        vals["mpos"].add(num_of(c.get("playMovePositionType")))
    for d in master.drinks.values():
        vals["rarity"].add(100 + int(num_of(d.get("rarity")) or 0))      # drink rarities kept apart from cards'
        vals["plan"].add(num_of(d.get("planType")))
    out = {f: sorted(x for x in vals[f] if x is not None) for f in VOCAB_FIELDS
           if f not in ("status", "stance", "step", "produce", "origin")}
    out["status"] = list(STATUS_KINDS)
    out["stance"] = list(STANCES)
    out["step"] = list(STEPS)
    out["produce"] = list(PRODUCES)
    out["origin"] = list(ORIGINS)
    return out


class Vocab:
    def __init__(self, data):
        self.data = data
        self.ix = {f: {v: i + 2 for i, v in enumerate(vs)} for f, vs in data.items()}

    def __call__(self, field, value):
        if value is None:
            return 0
        return self.ix[field].get(value, 1)

    def size(self, field):
        return len(self.data[field]) + 2

    @classmethod
    def load(cls, path=VOCAB_PATH):
        return cls(json.loads(Path(path).read_text(encoding="utf-8"))["fields"])


def write_vocab(master, path=VOCAB_PATH):
    data = build_vocab(master)
    doc = {"schema": "gkms.uinet.vocab.v1", "master_dir": str(engine.MASTER_DIR.relative_to(engine.PROJECT)),
           "fields": data}
    Path(path).write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return Vocab(data)


# ----------------------------------------------------------------------------- slots
class Featurizer:
    """Arrays for cards (by their on-screen spec), enchants and drinks, cached by spec."""

    def __init__(self, master=None, vocab=None):
        self.m = master or engine.master()
        self.v = vocab or Vocab.load()
        self._cards, self._ench, self._drinks = {}, {}, {}
        self._deck = None

    def clear_memo(self):
        """Discard per-episode feature memo without changing the master or vocabulary."""
        self._cards.clear()
        self._ench.clear()
        self._drinks.clear()

    # -- one effect and what it installs or chains
    def _trigger_cats(self, trigger_id):
        t = self.m.triggers.get(trigger_id) if trigger_id else None
        if not t:
            return 0, 0, 0.0, 0.0
        ph = [num_of(x) for x in t.get("phaseTypes") or ()]
        fs = [num_of(x) for x in t.get("fieldStatusTypes") or ()]
        fsv = list(t.get("fieldStatusValues") or ())
        phv = list(t.get("phaseValues") or ())
        return (self.v("phase", ph[0]) if ph else 0, self.v("fstat", fs[0]) if fs else 0,
                slog(fsv[0]) if fsv else 0.0, slog(phv[0]) if phv else 0.0)

    def _slot(self, effect_id, out, nested=0, cond_trigger=None, once=False, value_adds=None, turn_adds=None):
        if len(out) >= SLOTS:
            return
        e = self.m.effects.get(effect_id)
        if e is None:
            out.append(([1, 0, 0, 0, 0, 0], [1.0] + [0.0] * (len(SLOT_NUM) - 1)))
            return
        et = num_of(e.get("effectType"))
        v1 = e.get("effectValue1")
        if v1 is None and e.get("targetUpgradeCount") is not None:
            v1 = e.get("targetUpgradeCount")
        if value_adds and v1 is not None:
            v1 = int(v1) + int(value_adds.get(et, value_adds.get(str(et), 0)) or 0)
        turn = e.get("effectTurn")
        if turn_adds and turn is not None:
            turn = int(turn) + int(turn_adds.get(et, turn_adds.get(str(et), 0)) or 0)
        ph, fs, fsv, phv = self._trigger_cats(cond_trigger)
        search = self.m.searches.get(e.get("produceCardSearchId")) if e.get("produceCardSearchId") else None
        spos = num_of(search.get("cardPositionType")) if search else None
        prange = num_of(e.get("pickRangeType")) if e.get("pickRangeType") is not None else None
        mpos = num_of(e.get("movePositionType")) if e.get("movePositionType") is not None else None
        chain = bool(e.get("chainProduceExamEffectId") or e.get("chainProduceExamEffectIds"))
        cat = [self.v("etype", et), ph, fs, self.v("spos", spos), self.v("prange", prange), self.v("mpos", mpos)]
        numv = [1.0, slog(v1), slog(e.get("effectValue2")), slog(e.get("effectCount")), slog(turn),
                float(bool(e.get("produceExamStatusEnchantId"))), float(bool(e.get("targetProduceCardId"))),
                float(bool(once)), nested / 3.0, float(cond_trigger is not None), fsv, phv,
                min(5.0, float(e.get("pickCountMax") or 0)) / 5.0, float(chain)]
        out.append((cat, numv))
        if nested < 2:
            enchant = e.get("produceExamStatusEnchantId")
            if enchant:
                self._enchant_slots(enchant, out, nested + 1)
            for chained in ([e["chainProduceExamEffectId"]] if e.get("chainProduceExamEffectId") else []) + list(
                    e.get("chainProduceExamEffectIds") or ()):
                self._slot(chained, out, nested + 1)

    def _enchant_slots(self, enchant_id, out, nested):
        en = self.m.enchants.get(enchant_id)
        if not en:
            return
        trig = en.get("produceExamTriggerId")
        for eid in en.get("produceExamEffectIds") or ():
            self._slot(eid, out, nested, cond_trigger=trig)

    @staticmethod
    def _pack(cat, numv, slots):
        sc = np.zeros((SLOTS, len(SLOT_CAT)), np.int16)
        sn = np.zeros((SLOTS, len(SLOT_NUM)), np.float32)
        for i, (c, n) in enumerate(slots[:SLOTS]):
            sc[i] = c
            sn[i] = n
        return (np.asarray(cat, np.int16), np.asarray(numv, np.float32), sc, sn)

    # -- cards
    def card(self, spec):
        """Arrays of a card spec {"id", "u", optional "c" customizes [[id, count]], "g" grow ids}."""
        key = json.dumps([spec["id"], spec.get("u", 0), spec.get("c"), spec.get("g")], separators=(",", ":"))
        hit = self._cards.get(key)
        if hit is None:
            hit = self._cards[key] = self._card(spec)
        return hit

    def _resolved(self, spec):
        from GakumasCLI.engine.card_data import resolve_card_customizes
        cid, up = spec["id"], int(spec.get("u", 0) or 0)
        row = self.m.cards.get((cid, up))
        if row is None:                                  # past the top tier: the engine resolves at the top one
            tiers = [u for (c, u) in self.m.cards if c == cid]
            if not tiers:
                return None
            row = self.m.cards[(cid, max(t for t in tiers if t <= up) if any(t <= up for t in tiers) else min(tiers))]
        inst = {"produce_card_id": cid,
                "customizes": [{"id": c[0], "customize_count": int(c[1])} for c in spec.get("c") or ()],
                "dynamic_grow_effect_ids": list(spec.get("g") or ())}
        try:
            return resolve_card_customizes(inst, row, self.m.customizes, self.m.grow_effects)
        except MemoryError:
            raise
        except Exception:                                # noqa: BLE001 -- an unknown customize: show the base row
            return dict(row)

    def _card(self, spec):
        rc = self._resolved(spec)
        if rc is None:
            cat = [0] * len(THING_CAT)
            cat[THING_CAT.index("origin")] = self.v("origin", card_origin(spec["id"]))
            return self._pack(cat, [0.0] * len(THING_NUM), [([1, 0, 0, 0, 0, 0], [1.0] + [0.0] * 13)])
        slots = []
        value_adds = rc.get("customize_value_adds") or {}
        turn_adds = rc.get("customize_turn_adds") or {}
        lesson_add = int(rc.get("customize_lesson_add") or 0)
        if lesson_add:
            value_adds = dict(value_adds)
            for t in (1, 56, 23):                       # the lesson-type effects the customize lesson add reaches
                value_adds[t] = int(value_adds.get(t, 0) or 0) + lesson_add
        for link in rc.get("playEffects") or ():
            self._slot(link.get("produceExamEffectId"), slots, 0, link.get("produceExamTriggerId"),
                       link.get("isOncePlayEffect"), value_adds, turn_adds)
        senchant = rc.get("produceCardStatusEnchantId")
        if senchant:
            self._enchant_slots(senchant, slots, 1)
        ph, fs, fsv, _phv = self._trigger_cats(rc.get("playProduceExamTriggerId"))
        ctype = num_of(rc.get("costType")) if rc.get("costType") is not None else 0
        deltas = rc.get("customize_status_cost_deltas") or {}
        cat = [self.v("category", num_of(rc.get("category"))), self.v("rarity", num_of(rc.get("rarity"))),
               self.v("plan", num_of(rc.get("planType"))), self.v("ctype", ctype),
               self.v("mpos", num_of(rc.get("playMovePositionType"))), fs, ph,
               self.v("origin", card_origin(spec["id"]))]
        numv = [slog(int(rc.get("costValue") or 0) + sum(int(x) for x in deltas.values())),
                slog(rc.get("stamina")), slog(rc.get("forceStamina")), float(spec.get("u", 0) or 0) / 3.0,
                float(bool(rc.get("noDeckDuplication"))), float(bool(rc.get("isInitial"))),
                len(spec.get("c") or ()) / 3.0, slog(lesson_add), slog(rc.get("customize_cost_reduce")),
                slog(rc.get("customize_cost_add")), slog(rc.get("customize_lesson_count_add")),
                slog(int(rc.get("customize_cost_full_power_point_add") or 0)
                     - int(rc.get("customize_cost_full_power_point_reduce") or 0)),
                slog(int(rc.get("customize_cost_penetrate_add") or 0)
                     - int(rc.get("customize_cost_penetrate_reduce") or 0)),
                slog(sum(int(x) for x in turn_adds.values())), len(spec.get("g") or ()) / 3.0,
                float(bool(senchant)), fsv, len(rc.get("playEffects") or ()) / 6.0, 0.0, 0.0]
        return self._pack(cat, numv, slots)

    # -- enchants (P items, memories, a card's lasting effect, gimmicks)
    def enchant(self, enchant_id):
        hit = self._ench.get(enchant_id)
        if hit is None:
            hit = self._ench[enchant_id] = self._enchant(enchant_id)
        return hit

    def _enchant(self, enchant_id):
        en = self.m.enchants.get(enchant_id) or {}
        trig = self.m.triggers.get(en.get("produceExamTriggerId")) or {}
        ph = [num_of(x) for x in trig.get("phaseTypes") or ()]
        fs = [num_of(x) for x in trig.get("fieldStatusTypes") or ()]
        fsv = list(trig.get("fieldStatusValues") or ())
        phv = list(trig.get("phaseValues") or ())
        slots = []
        for eid in en.get("produceExamEffectIds") or ():
            self._slot(eid, slots, 0)
        cat = [0, 0, 0, 0, 0, self.v("fstat", fs[0]) if fs else 0, self.v("phase", ph[0]) if ph else 0, 0]
        numv = [0.0] * len(THING_NUM)
        numv[THING_NUM.index("cfsval")] = slog(fsv[0]) if fsv else 0.0
        numv[THING_NUM.index("phval")] = slog(phv[0]) if phv else 0.0
        numv[THING_NUM.index("fsval2")] = slog(fsv[1]) if len(fsv) > 1 else 0.0
        numv[THING_NUM.index("nfx")] = len(en.get("produceExamEffectIds") or ()) / 6.0
        if not en:
            cat[0] = 1
        return self._pack(cat, numv, slots)

    # -- drinks
    def drink(self, drink_id):
        hit = self._drinks.get(drink_id)
        if hit is None:
            hit = self._drinks[drink_id] = self._drink(drink_id)
        return hit

    def _drink(self, drink_id):
        d = self.m.drinks.get(drink_id) or {}
        slots = []
        for deid in d.get("produceDrinkEffectIds") or ():
            de = self.m.drink_effects.get(deid) or {}
            self._slot(de.get("produceExamEffectId"), slots, 0)
        cat = [0, self.v("rarity", 100 + int(num_of(d.get("rarity")) or 0)), self.v("plan", num_of(d.get("planType"))),
               0, 0, 0, 0, 0]
        if not d:
            cat[0] = 1
        numv = [0.0] * len(THING_NUM)
        numv[THING_NUM.index("nfx")] = len(d.get("produceDrinkEffectIds") or ()) / 6.0
        return self._pack(cat, numv, slots)
