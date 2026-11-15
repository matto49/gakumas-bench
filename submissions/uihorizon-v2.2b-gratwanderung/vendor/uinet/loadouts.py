"""The loadout pool: every H.I.F round of GKMSCorpus, the train / held-out split, and generated decks.

Two sources, both read only from a GKMSCorpus clone:

  live     the workbench's own rounds: ``hif/loadout_Audition*_<seed>.json`` of every ``live-runs`` entry
           (produce-007 選抜試験, produce-008 本戦).  A run and its ``.aN`` snapshots hold the same loadout; one
           is kept per (seed, round).
  history  other players' records opened from the H.I.F ranking (Produce/History payloads, read by
           GakumasCLI/produce/hif_histories.py): the recorded deck, the player's actions and score.  These
           are human plays, so they are also the reference arm and the held-out mid-game states.

The user's ruling 2026-10-21 「不要用老师周和强化周的数据 切记」, read per produce (rules PD-12): a live round whose
produce was started in an event mode (the Produce/Start request's ``is_research`` ゼミ / ``is_high_score_rush``
強化月間, read from the run's frames.jsonl.gz) is left out; one started in normal mode stays even inside an event
window; only a round whose Start was not recorded (and every history) falls back to the window table
(GakumasCLI/produce/deck_eval.py EVENT_WINDOWS).  A live run's time is its id (tl179-YYYYMMDD-HHMMSS, the station's
clock, UTC+8); a history's is its cleared time.

Split: by group (the live run, or the history record), so the two rounds of one produce never sit on both sides,
and per plan type, so every plan is on both sides: within a plan, the groups sorted by sha1(group), the first
ceil(HELD_FRACTION x groups) are held out.

Generated decks (``Generator``): a template's loadout with k ~ U{0..max_swaps} of its deck's cards replaced from
the pool of every template deck of the same plan type -- P6's deck space (deck_value.Space: the idol's own cards and
trouble cards stay, a support event card only with its support card, 重複不可 / legend / per-card caps kept).
"""
from __future__ import annotations

import hashlib
from functools import lru_cache
import json
import random
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import engine

HIF_PRODUCES = ("produce-007", "produce-008")
HELD_FRACTION = 0.2
LIVE_FILE = re.compile(r"^hif/loadout_(Audition(?:Mid1|Mid2|Final))_(\d+)\.json$")
STEP_OF_FILE = {"AuditionMid1": "AUDITION_MID1", "AuditionMid2": "AUDITION_MID2", "AuditionFinal": "AUDITION_FINAL"}
STEP_OF_ROUND = {"mid1": "AUDITION_MID1", "mid2": "AUDITION_MID2", "final": "AUDITION_FINAL",
                 "r1": "AUDITION_MID1", "r2": "AUDITION_FINAL"}
STATION_TZ = timezone(timedelta(hours=8))
POOL = engine.TREE / "data" / "loadouts" / "pool.v1.jsonl"          # H1-H4 are defined on this one
POOL_V2 = engine.TREE / "data" / "loadouts" / "pool.v2.jsonl"       # v1 + the rounds collected since (train side)
POOL_V3 = engine.TREE / "data" / "loadouts" / "pool.v3.jsonl"       # v2 + GKMSArchive to 2026-11-09; the added rounds
                                                                     # split 80 / 20 per archetype (hold_new)


def _tools():
    engine.setup(chdir=False)


def event_of_ms(ms):
    _tools()
    from GakumasCLI.produce.deck_eval import event_of
    return event_of(ms)


def run_time_ms(run_id):
    m = re.match(r"^tl\d+-(\d{8})-(\d{6})", run_id)
    if not m:
        return None
    t = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(tzinfo=STATION_TZ)
    return int(t.timestamp() * 1000)


def held_groups(items):
    """The held-out groups: per plan type, the first ceil(HELD_FRACTION x n) groups by sha1."""
    import math
    by_plan = defaultdict(set)
    for it in items:
        by_plan[it["plan"]].add(it["group"])
    held = set()
    for groups in by_plan.values():
        ranked = sorted(groups, key=lambda g: hashlib.sha1(g.encode("utf-8")).hexdigest())
        held.update(ranked[:math.ceil(HELD_FRACTION * len(ranked))])
    return held


def _plan(loadout):
    from GakumasCLI.scenario.idol_road import plan_type_for_idol_card
    return int(plan_type_for_idol_card(engine.MASTER_DIR, loadout["idol_card_id"]))


# ----------------------------------------------------------------------------- collect
def produce_modes(frames):
    """(seeds of rounds whose produce was started in an event mode, seeds of rounds started in normal mode) from a
    run's decoded frames: the out-frame of Produce/Start carries is_research / is_high_score_rush, a StepAuditionStart
    reply the round's exam seed (GakumasCLI/produce/audition_eval.py check reads them the same way)."""
    from GakumasCLI.produce import hif_advice as HA
    tr, mode = HA.Tracker(), None
    event, normal = set(), set()
    for f in frames:
        f.setdefault("status", "decoded")
        dec = f.get("decoded") or {}
        rpc = f.get("rpc") or ""
        if f.get("dir") == "out" and rpc.endswith("/Start") and "produce_id" in dec:
            mode = bool(dec.get("is_research") or dec.get("is_high_score_rush"))
        if not tr.feed(f) or f.get("dir") == "out" or not rpc.endswith("/StepAuditionStart") or mode is None:
            continue
        seed = (tr.current.progress or {}).get("exam_seed_value") if tr.current else None
        if seed is not None:
            (event if mode else normal).add(int(seed))
    return event, normal


def _frames(store, entry):
    import gzip
    import io
    f = next((f for f in entry.get("files") or () if f["path"] == "frames.jsonl.gz"), None)
    if f is None:
        return None
    try:
        data = store.read(entry, f["path"])
        return [json.loads(x) for x in gzip.open(io.BytesIO(data)) if x.strip()]
    except (OSError, ValueError, KeyError):
        return None


def collect_live(root, log=print):
    _tools()
    from GakumasCLI.corpus.corpus_store import CorpusStore
    store = CorpusStore(root)
    best = {}
    skipped = Counter()
    for e in store.entries():
        if e.get("family") != "live-runs" or "manifest" not in e:
            continue
        entry = store.entry(e["id"])
        base = entry["id"].split(".a")[0]
        snap = int(entry["id"].split(".a")[1]) if ".a" in entry["id"] else 10 ** 6   # the base id beats its .aN
        ms = run_time_ms(base)
        window = event_of_ms(ms) if ms else None
        frames = _frames(store, entry)
        ev_seeds, ok_seeds = produce_modes(frames) if frames else (set(), set())
        for f in entry["files"]:
            m = LIVE_FILE.match(f["path"])
            if not m:
                continue
            seed = int(m.group(2))
            if seed in ev_seeds:
                skipped["event-mode produce"] += 1
                continue
            if seed not in ok_seeds and window:
                skipped[window] += 1
                continue
            try:
                lo = json.loads(store.read(entry, f["path"]))
            except (OSError, ValueError, KeyError) as exc:
                skipped[f"unreadable:{type(exc).__name__}"] += 1
                continue
            produce = lo.get("produce_id") or "produce-008"
            if produce not in HIF_PRODUCES or lo.get("schema") != "gkms.hif_loadout.v1":
                skipped["not hif"] += 1
                continue
            key = (int(m.group(2)), STEP_OF_FILE[m.group(1)])
            item = {"key": f"live:{key[0]}_{key[1]}", "source": "live", "group": base, "run": entry["id"],
                    "time_ms": ms, "step": key[1], "produce": produce, "idol": lo["idol_card_id"], "loadout": lo,
                    "recorded_score": None, "actions": None}
            old = best.get(key)
            if old is None or snap > old[0]:
                best[key] = (snap, item)
    log(f"live: {len(best)} rounds; left out {dict(skipped)}")
    return [it for _s, it in best.values()]


def history_mode(data):
    """True when a Produce/History record was produced in an event mode (its is_high_score_rush, field 100, or a
    research_id, field 110: GKMSNet produce_history), False when the record reads without them, None when it does
    not read (the window table decides)."""
    from GakumasCLI.scenario.hif_replay_import import one, walk
    try:
        history = walk(one(walk(data), 1))
    except Exception:                                   # noqa: BLE001
        return None
    if not history:
        return None
    return bool(one(history, 100, 0)) or bool(one(history, 110, b""))


def collect_history(root, log=print):
    _tools()
    import GakumasCLI.produce.hif_histories as HH
    from GakumasCLI.scenario.hif_replay_import import extract, to_loadout      # rev269: moved from GakumasCLI/tools
    hist = HH.histories(root)
    cleared = {r["capture"]: r.get("cleared_time_ms") for r in hist}
    again = {c for r in hist for c in r.get("also") or ()}
    rows, skipped = {}, Counter()
    for cap, data in HH.captures(root):
        if cap in again:
            continue
        ms = cleared.get(cap)
        mode = history_mode(data)
        event = "event-mode produce" if mode else (event_of_ms(ms) if ms and mode is None else None)
        for r in extract(data):
            if event:
                skipped[event] += 1
                continue
            r["record"] = cap
            r["cleared_ms"] = ms
            rows[(r["seed"], r["step_type"])] = r
    out = []
    for (seed, _st), r in sorted(rows.items()):
        lo = to_loadout(r)
        produce = lo.get("produce_id") or "produce-008"
        if produce not in HIF_PRODUCES:
            continue
        step = STEP_OF_ROUND[str(lo.get("round", "final")).lower()]
        actions = [list(a) if a[0] != "select" else ["select", list(a[1])] for a in r.get("actions") or ()]
        out.append({"key": f"history:{seed}_{step}", "source": "history", "group": r["record"], "run": r["record"],
                    "time_ms": r.get("cleared_ms"), "step": step, "produce": produce, "idol": lo["idol_card_id"],
                    "loadout": lo, "recorded_score": r.get("recorded_score"), "actions": actions})
    log(f"history: {len(out)} rounds; left out {dict(skipped)}")
    return out


def collect(root, out_path, log=print):
    """Write the pool (one JSON line per round, held-out flag set), and check every loadout builds."""
    engine.setup()
    items = collect_live(root, log) + collect_history(root, log)
    seen, kept, bad = set(), [], Counter()
    for it in sorted(items, key=lambda x: (x["source"] != "history", x["key"])):
        sk = (it["loadout"].get("seed"), it["step"])
        if sk in seen:                       # a history of the user's own round: keep the history (it has actions)
            continue
        seen.add(sk)
        try:
            s, meta = engine.build(it["loadout"])
            if not any((s.config.audition_permils or {}).values()):
                bad["score multipliers all 0 (capture)"] += 1      # live:1319343901_AUDITION_FINAL: every score 0
                continue
            it["plan"] = int(meta["plan_type"])
            it["limit_turn"] = int(meta["limit_turn"])
            if s.state.unresolved_effects:
                it["unresolved"] = [str(x)[:120] for x in s.state.unresolved_effects]
        except Exception as exc:                                          # noqa: BLE001
            bad[f"{type(exc).__name__}: {str(exc)[:80]}"] += 1
            continue
        kept.append(it)
    held = held_groups(kept)
    for it in kept:
        it["held_out"] = it["group"] in held
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        for it in kept:
            fh.write(json.dumps(it, ensure_ascii=False, separators=(",", ":")) + "\n")
    by = Counter((it["source"], it["held_out"]) for it in kept)
    log(f"pool: {len(kept)} rounds {dict(by)}; not buildable {dict(bad)}")
    return kept


def load(path=POOL):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def extend(base_path, root, out_path, log=print, drop_gone=False):
    """BASE's rounds unchanged (same order, same held-out flags), then every round of a fresh collect whose key BASE
    lacks, train side (``held_out`` false, ``added`` = OUT's file name).  H1-H4 stay on BASE (pool.v1); new rounds
    only add training templates.  SX-04-15: pool.v2 = pool.v1 + the rounds after the 2026-10-28 event window
    (雨夜燕 and 紫雲清夏 new to the pool).  DROP_GONE (SX-04-19): a BASE round added after pool.v1 that the fresh
    collect no longer yields (pool.v2 held 5 rounds of produces started in an event mode, which the per-produce reading
    now leaves out) is dropped."""
    base_path, out_path = Path(base_path).resolve(), Path(out_path).resolve()      # collect changes directory
    base = load(base_path)
    tmp = Path(out_path).with_suffix(".fresh.jsonl")
    fresh = collect(root, tmp, log)
    tmp.unlink()
    if drop_gone:
        now = {it["key"] for it in fresh}
        gone = [it["key"] for it in base if it.get("added") and it["key"] not in now]
        base = [it for it in base if not (it.get("added") and it["key"] not in now)]
        log(f"dropped {len(gone)} rounds of {Path(base_path).name} the fresh collect leaves out: {gone}")
    keys = {it["key"] for it in base}
    new = []
    for it in fresh:
        if it["key"] in keys:
            continue
        it["held_out"] = False
        it["added"] = Path(out_path).name
        new.append(it)
    with open(out_path, "w", encoding="utf-8") as fh:
        for it in base + new:
            fh.write(json.dumps(it, ensure_ascii=False, separators=(",", ":")) + "\n")
    log(f"{Path(out_path).name}: {len(base)} from {Path(base_path).name} + {len(new)} new "
        f"{dict(Counter((it['idol'], it['produce']) for it in new))}")
    return base + new


def hold_new(items, frac=HELD_FRACTION):
    """SX-04-19 (pool.v3): the rounds added after pool.v1 (an ``added`` mark) get a held-out side of their own, per
    archetype: within one, the (archetype, group) keys sorted by sha1(group), the first ceil(FRAC x n) held out --
    so 全力 / 好調 have held-out templates too, and one produce's rounds sit on one side.  pool.v1's rounds keep their
    split (H1-H4 unchanged)."""
    import math
    by = defaultdict(set)
    for it in items:
        if it.get("added"):
            by[archetype(it["idol"])].add(it["group"])
    held = set()
    for arch, groups in by.items():
        ranked = sorted(groups, key=lambda g: hashlib.sha1(g.encode("utf-8")).hexdigest())
        held.update((arch, g) for g in ranked[:math.ceil(frac * len(ranked))])
    for it in items:
        if it.get("added"):
            it["held_out"] = (archetype(it["idol"]), it["group"]) in held
    return items


# ----------------------------------------------------------------------------- generated decks
def char_of(idol_card_id):
    """The character of an idol card: i_card-atbm-3-018 -> atbm."""
    return str(idol_card_id).split("-")[1]


@lru_cache(maxsize=1)
def idol_cards():
    """IdolCard rows of the master by id, with the archetype ``(plan, exam effect type)`` and whether the card has
    H.I.F 本戦 rows (ProduceStepAuditionDifficulty produce-008): the 3 plans x 2 mechanics, 好調 / 集中 / 好印象 /
    やる気 / 強気 / 全力."""
    def name(x):
        return x.get("name", "") if isinstance(x, dict) else str(x or "")
    hif = set()
    for line in (engine.MASTER_DIR / "ProduceStepAuditionDifficulty.jsonl").read_text(encoding="utf-8").splitlines():
        d = json.loads(line).get("decoded") or {}
        if d.get("produceId") == "produce-008":
            hif.add(str(d.get("id", "")).split("difficulty-")[-1])
    out = {}
    for line in (engine.MASTER_DIR / "IdolCard.jsonl").read_text(encoding="utf-8").splitlines():
        d = json.loads(line).get("decoded") or {}
        if not d.get("id"):
            continue
        r = dict(d)
        r["archetype"] = (name(d.get("planType")).replace("PRODUCE_PLAN_TYPE_", ""),
                          name(d.get("examEffectType")).replace("PRODUCE_EXAM_EFFECT_TYPE_", ""))
        r["hif"] = any(h == d["id"] or h.startswith(d["id"] + "-") for h in hif)
        r["ssr"] = (d.get("rarity") or {}).get("number") == 3 if isinstance(d.get("rarity"), dict) else d.get("rarity") == 3
        out[d["id"]] = r
    return out


def archetype(idol_card_id):
    """'PLAN3/EXAM_FULL_POWER' and the like."""
    return "/".join(idol_cards()[idol_card_id]["archetype"])


def swap_identity(lo, new_id):
    """LO with its idol card replaced by NEW_ID: the old idol card's own skill cards (produceCardId,
    secondProduceCardId) become the new card's at the same upgrade (customizes dropped; a second card the new idol
    lacks is removed, one it has and the old lacks is added at the first card's upgrade), and its two P items
    (beforeProduceItemId / afterProduceItemId) become the new card's.  Parameters, stamina, the rest of the deck,
    the other P items, drinks, supports and memories stay."""
    rows = idol_cards()
    old, new = rows[lo["idol_card_id"]], rows[new_id]
    first_up = 0
    deck = []
    for c in lo["deck_cards"]:
        cid = c["produce_card_id"]
        if cid == old.get("produceCardId"):
            first_up = int(c.get("current_upgrade_count") or 0)
            deck.append({"produce_card_id": new["produceCardId"], "current_upgrade_count": first_up})
        elif old.get("secondProduceCardId") and cid == old["secondProduceCardId"]:
            if new.get("secondProduceCardId"):
                deck.append({"produce_card_id": new["secondProduceCardId"],
                             "current_upgrade_count": int(c.get("current_upgrade_count") or 0)})
        else:
            deck.append(c)
    if new.get("secondProduceCardId") and not any(c["produce_card_id"] == new["secondProduceCardId"] for c in deck):
        deck.append({"produce_card_id": new["secondProduceCardId"], "current_upgrade_count": first_up})
    pmap = {old.get("beforeProduceItemId"): new.get("beforeProduceItemId"),
            old.get("afterProduceItemId"): new.get("afterProduceItemId")}
    items = [pmap.get(i, i) or i for i in lo.get("produce_item_ids") or ()]
    out = dict(lo, idol_card_id=new_id, deck_cards=deck, produce_item_ids=items)
    return out


def watched_cards(idol_card_id):
    """The skill cards an idol card's P items watch: the produceCardIds of a card-play trigger's search (選びとった熱
    of Campus mode!! 篠澤広: 「えいえいおー使用時」 -> p_card-02-men-1_031)."""
    m = engine.master()
    r = idol_cards()[idol_card_id]
    out = []
    for pid in (r.get("beforeProduceItemId"), r.get("afterProduceItemId")):
        for ie in (m.items.get(pid) or {}).get("produceItemEffectIds") or ():
            en = m.enchants.get((m.item_effects.get(ie) or {}).get("produceExamStatusEnchantId")) or {}
            t = m.triggers.get(en.get("produceExamTriggerId")) or {}
            phases = {(x or {}).get("number") if isinstance(x, dict) else x for x in t.get("phaseTypes") or ()}
            s = m.searches.get(t.get("produceCardSearchId")) or {}
            if phases & {2, 3}:
                out += [c for c in s.get("produceCardIds") or () if c not in out]
    return out


def with_watched(lo, cards, k, up, rng, keep=()):
    """LO's deck holding at least K copies of each of CARDS (at upgrade UP): each missing copy replaces a random deck
    card that is neither one of CARDS nor the idol's own (KEEP) nor a starter, else it is added."""
    deck = [dict(c) for c in lo["deck_cards"]]
    for cid in cards:
        have = sum(1 for c in deck if c["produce_card_id"] == cid)
        for _ in range(max(0, k - have)):
            free = [i for i, c in enumerate(deck) if c["produce_card_id"] not in cards
                    and c["produce_card_id"] not in keep and "-0_" not in c["produce_card_id"]]
            new = {"produce_card_id": cid, "current_upgrade_count": up}
            if free:
                deck[rng.choice(free)] = new
            else:
                deck.append(new)
    return dict(lo, deck_cards=deck)


class Generator:
    """Decks drawn around the templates of one side of the split, per plan type (GROUP "plan") or per archetype
    (GROUP "archetype": the 6 plan x mechanic classes, drawn uniformly).

    SWAP_IDOL (SX-04-20): with this probability a drawn deck also changes its idol card for another SSR idol card of
    the same archetype that has H.I.F rows (``swap_identity``): characters of one archetype differ mostly by their
    P item and their own skill card, so the network sees those of every idol card of the master, not only the ones
    the corpus holds.  EXCLUDE: characters whose rounds are not templates and whose idol cards are never swapped in
    (a held-out character)."""

    def __init__(self, items, max_swaps=10, group="plan", swap_idol=0.0, exclude=(), target=None, target_share=1.0,
                 watched=(0, 0), stamina_pool=None, extra=False, exclude_idols=()):
        """TARGET (SX-04-19): an idol card the decks are built for -- its archetype's templates only, and the share
        TARGET_SHARE of decks swapped to it (the rest to another idol card of the archetype, as SWAP_IDOL).
        WATCHED (lo, hi): a swapped-in idol card's P-item cards (``watched_cards``) held lo..hi times (upgrade +1 in
        70%).  STAMINA_POOL: rounds (pool items) whose character's max stamina a swapped deck takes (one drawn, the
        template's start / max ratio kept); None keeps the template's.  EXTRA: the plan's offer support set
        (deck_value.extra_cards, PD-10) joins each group's card pool."""
        _tools()
        from GakumasCLI.produce.deck_value import Space, extra_cards
        self.max_swaps, self.group, self.swap_idol = max_swaps, group, float(swap_idol)
        self.exclude = set(exclude or ())
        self.exclude_idols = set(exclude_idols or ())
        self.target, self.target_share = target, float(target_share)
        self.watched = tuple(watched)
        by = defaultdict(list)
        for it in items:
            if char_of(it["idol"]) in self.exclude or it["idol"] in self.exclude_idols:
                continue
            if target and archetype(it["idol"]) != archetype(target):
                continue
            key = it["plan"] if group == "plan" else archetype(it["idol"])
            by[key].append({"loadout": it["loadout"], "item": it})
        self.spaces = {k: Space(tpls, extra=extra_cards(tpls, "auto") if extra else None) for k, tpls in by.items()}
        self.plans = sorted(self.spaces)
        self.idols = defaultdict(list)
        if self.swap_idol or target:
            for iid, r in sorted(idol_cards().items()):
                if r["ssr"] and r["hif"] and char_of(iid) not in self.exclude and iid not in self.exclude_idols:
                    self.idols["/".join(r["archetype"])].append(iid)
        self.stamina = defaultdict(list)
        for it in stamina_pool or ():
            self.stamina[char_of(it["idol"])].append(int(it["loadout"]["max_stamina"]))

    def sample(self, rng, plan=None):
        """(loadout, origin): a template of PLAN (or a group drawn uniformly) with a deck of k random swaps, and with
        probability SWAP_IDOL another idol card of its archetype."""
        plan = plan if plan is not None else rng.choice(self.plans)
        sp = self.spaces[plan]
        t, deck = sp.sample(rng, self.max_swaps)
        tpl = sp.tpls[t]
        lo = dict(tpl["loadout"])
        lo["deck_cards"] = [dict(sp.proto[i]) for i in deck]
        own = Counter(sp.own[t])
        swaps = sum((Counter(deck) - own).values())
        origin = {"template": tpl["item"]["key"], "plan": plan, "swaps": swaps}
        new_id = None
        if self.target and rng.random() < self.target_share:
            new_id = self.target if self.target != lo["idol_card_id"] else None
        elif self.swap_idol and rng.random() < self.swap_idol:
            cand = [i for i in self.idols[archetype(lo["idol_card_id"])] if i not in (lo["idol_card_id"], self.target)]
            if cand:
                new_id = rng.choice(cand)
        if new_id:
            lo = swap_identity(lo, new_id)
            origin["idol"] = new_id
            lo = self._fit(lo, rng, origin)
        return lo, origin

    def _fit(self, lo, rng, origin):
        """A swapped deck made to fit its new idol: the P-item cards (WATCHED) and the character's stamina."""
        lo_k, hi_k = self.watched
        cards = watched_cards(lo["idol_card_id"]) if hi_k > 0 else []
        if cards:
            k = rng.randint(lo_k, hi_k)
            if k:
                r = idol_cards()[lo["idol_card_id"]]
                lo = with_watched(lo, cards, k, 1 if rng.random() < 0.7 else 0, rng,
                                  keep={r.get("produceCardId"), r.get("secondProduceCardId")})
            origin["watched"] = k
        pool = self.stamina.get(char_of(lo["idol_card_id"]))
        if pool:
            ms = rng.choice(pool)
            old = max(1, int(lo["max_stamina"]))
            lo = dict(lo, max_stamina=ms, starting_stamina=max(1, min(ms, round(int(lo["starting_stamina"]) * ms / old))))
            origin["stamina"] = ms
        return lo

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(prog="uinet.loadouts")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect", help="a fresh pool from a GKMSCorpus clone")
    c.add_argument("out")
    c.add_argument("--corpus", required=True)
    e = sub.add_parser("extend", help="BASE + the rounds a fresh collect adds, train side")
    e.add_argument("base")
    e.add_argument("out")
    e.add_argument("--corpus", required=True)
    e.add_argument("--hold-new", action="store_true",
                   help="SX-04-19: hold out 20%% of every round added after pool.v1, per archetype (hold_new)")
    a = ap.parse_args()
    if a.cmd == "collect":
        collect(a.corpus, a.out)
    else:
        a.out = str(Path(a.out).resolve())
        items = extend(a.base, a.corpus, a.out, drop_gone=a.hold_new)
        if a.hold_new:
            hold_new(items)
            with open(a.out, "w", encoding="utf-8") as fh:
                for it in items:
                    fh.write(json.dumps(it, ensure_ascii=False, separators=(",", ":")) + "\n")
            print(f"held out: {dict(Counter((archetype(it['idol']), it['held_out']) for it in items if it.get('added')))}")
