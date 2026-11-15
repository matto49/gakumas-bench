"""Game-play evaluation (plan section 5): the held-out sets, the arms, and the bars.

    python -B -m uinet.evaluate run OUT.jsonl --arm T|K|N|R --set H1|H2|H3|H4 [--model M.pt] [--workers W]
        [--worlds-T 16 --trans-T 10000 --worlds-K 6 --trans-K 20000] [--worlds-R 16 --threads-R 4 --device-R cuda]
        [--limit N]
        [--every K]   (every K-th game of the set)
    python -B -m uinet.evaluate summary OUT.jsonl [OUT2.jsonl ...]
    python -B -m uinet.evaluate compare A.jsonl B.jsonl [--set H4] [--arm-a N --arm-b N]   (paired, same games)

Sets (fixed by their definition here, before any run):
  H1  every held-out round of the pool (uinet.loadouts: split by run / record).  Seeds: the round's own exam seed
      and two more drawn from its key.
  H2  60 generated decks around the held-out templates (20 per plan type, uinet.loadouts.Generator, stream
      "H2"), three seeds each, drawn from the deck's index.
  H3  held-out history rounds continued from the player's own states: the recorded actions replayed to decision
      round(n/3) and round(2n/3), then the arm plays on (the real seed).
  H4  (SX-04-09) arm N only, for ranking networks against each other: 200 generated decks per plan type around the
      held-out templates (stream "H4", disjoint from H2's draws), four seeds each -- 2,400 games.  A network plays one
      in about a second, so the standard error of a paired ratio is about 0.31 / sqrt(2400) = 0.6% (H1 + H2: 1.9%).
  H5  (SX-04-15) the characters new in pool.v2 (no round in pool.v1: 雨夜燕 atbm, 紫雲清夏 ssmk, 花海咲季 hski,
      月村手毬 ttmr at GKMSCorpus 302c99b): each of their
      rounds with its own seed and three more, and H5_PER_CHAR generated decks around each one's own rounds
      (Generator over that character's rounds alone, stream "H5/<char>"), four seeds each.  These rounds are train
      side in pool.v2, so H5 measures the decks the network trains around (fresh seeds and swaps), not unseen ones.
  H6  (SX-04-19) Campus mode!! 篠澤広 (i_card-shro-3-007, ロジック / やる気), an idol card with no round in the corpus:
      the held-out やる気 rounds of the pool (11: 莉波 hrnm-3-004 4, 星南 jsna-3-015 7) with the idol card swapped to
      it (``loadouts.swap_identity``: her own card エウレカ！ at the round's upgrade, her P item 選びとった熱), her
      P item's card えいえいおー held 0..3 times and a max stamina of 篠澤広's pool rounds (stream "H6/<key>"), its
      own seed and three more; and H6_GEN decks generated around those held-out templates for her
      (Generator(target=...), stream "H6"), four seeds each -- 44 + 240 games.  No training template is in it.
  HC  (SX-04-19) H6's definition for any idol card (--idol ID): HC/<card>, the per-card training's paired set.
      H6 = HC for i_card-shro-3-007.
  H7  (SX-04-19) every SSR idol card with H.I.F rows (113 at master 2026-11) on the held-out templates of pool.v3 of
      its archetype: H7_TPL of them (sha1 of card + template key; fewer when the archetype has fewer), the idol card
      swapped in as in H6 (its P-item cards held 0..3 times, its character's stamina), H7_SEEDS seeds each -- 864 games
      at pool.v3 (好調 has 3 held-out templates).
      The HELD_IDOLS (12, two per archetype, no round in pool.v3) are never trained on in G0 / G1 (uinet.gen
      --exclude-idols): their games are the unseen-card measure; summary reports H7 seen / unseen apart.
  H8  (SX-04-19) the real held-out rounds added in pool.v3 (uinet.loadouts.hold_new: 20% of the rounds after pool.v1,
      per archetype, every archetype on both sides), each with its own seed and three more -- real decks of every
      archetype, never a training template.
Selection (SX-04-19): checkpoints, iteration rounds and the release candidate are chosen on H4, H5, H7 seen and HC;
H8, H7 unseen and H1 + H2 + H3 are reported for the chosen model and are not used to choose it.
Arms: T the UI teacher (mode "ui", 16 worlds x 10,000: SX-04-01 measured it closer to a 32 x 20,000 reference than
8 x 20,000 at 1.3x the time), K the known-RNG teacher (mode "rng"; every ratio is arm / K on the same game),
N the network (argmax of the logits; --model A.pt,B.pt is an ensemble: the mean of the members' log-softmax),
P the recorded player (H1 history rounds only: the recorded score; no play),
R (SX-04-12 probe) the network improved by its own rollouts: at a decision, WORLDS-R worlds as teacher T draws them
(the draw pile reshuffled, the RNG state random), every legal action stepped in each, then the network (--model, an
ONNX file; an ensemble model from tools/build_preview.py too) plays every copy to the end, all copies in lockstep with
one batched onnxruntime call per step; the action with the highest mean final score is played.  No perfect-information
search anywhere; R / T in the summary.

Bars (plan section 5, fixed before training):
  G1       N >= 0.95 x T  (geometric mean of N/K over H1 + H2, against T/K on the same games)
  release  N >= 1.05 x T, N above T on >= 65% of held-out loadouts (each loadout's mean over its seeds),
           <= 20 ms per decision (onnxruntime, one observation, 4-core desktop CPU)
  stretch  N >= 1.15 x T
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import sys
import time
from collections import Counter, defaultdict
from multiprocessing import Pool
from pathlib import Path

from . import engine, loadouts, states

H2_PER_PLAN = 20
SEEDS = 3
H4_PER_PLAN = 200
H4_SEEDS = 4
H5_PER_CHAR = 30
H6_IDOL = "i_card-shro-3-007"
H6_GEN = 60
H7_TPL = 4
H7_SEEDS = 2
# SX-04-19, fixed before G0: two SSR idol cards per archetype with no round in pool.v3, by sha1("H7/held/" + id)
HELD_IDOLS = ("i_card-kcna-3-002", "i_card-fktn-3-013", "i_card-atbm-3-012", "i_card-hski-3-019",
              "i_card-ttmr-3-018", "i_card-kcna-3-007", "i_card-ttmr-3-015", "i_card-hski-3-002",
              "i_card-jsna-3-000", "i_card-kllj-3-008", "i_card-hume-3-006", "i_card-fktn-3-019")
INFO = {}                                        # game id -> {"idol", "tpl", "real"} (summary / compare groups)


def _hc(idol, held, pool, tag):
    """H6's construction for IDOL: the held-out rounds of its archetype swapped to it, and H6_GEN generated decks."""
    arch = loadouts.archetype(idol)
    tpl = [it for it in held if loadouts.archetype(it["idol"]) == arch]
    gen = loadouts.Generator(tpl, group="archetype", target=idol, watched=(0, 3), stamina_pool=pool)
    out = []
    for it in tpl:
        r = random.Random(f"{tag}/{it['key']}")
        lo = gen._fit(loadouts.swap_identity(it["loadout"], idol), r, {}) if it["idol"] != idol else it["loadout"]
        for s in _seeds(it["key"], it["loadout"].get("seed"), H4_SEEDS):
            gid = f"{tag}/r/{it['key']}/{s}"
            INFO[gid] = {"idol": idol, "tpl": it["key"], "real": it["idol"] == idol}
            out.append((gid, dict(lo, seed=s), None))
    rng = random.Random(tag)
    for j in range(H6_GEN):
        lo, origin = gen.sample(rng)
        for s in _seeds(f"{tag}/{j}", None, H4_SEEDS):
            gid = f"{tag}/g{j}/{s}"
            INFO[gid] = {"idol": idol, "tpl": origin["template"], "real": False}
            out.append((gid, dict(lo, seed=s), None))
    return out


def _seeds(key, own, n=SEEDS):
    r = random.Random(f"seeds/{key}")
    extra = [r.randrange(1, 2 ** 31 - 1) for _ in range(n - (1 if own else 0))]
    return ([int(own)] if own else []) + extra


def games(set_name, pool=None, idol=None):
    """[(game id, loadout, start)] of a set; start = None or (history item key, decision index).  IDOL: HC's card."""
    pool = pool or loadouts.load()
    held = [it for it in pool if it["held_out"]]
    out = []
    if set_name in ("H7", "H8", "HC"):
        v3 = loadouts.load(loadouts.POOL_V3)
        held3 = [it for it in v3 if it["held_out"]]
    if set_name == "H7":
        stamina = v3
        for iid, r in sorted(loadouts.idol_cards().items()):
            if not (r["ssr"] and r["hif"]):
                continue
            arch = "/".join(r["archetype"])
            tpl = sorted((it for it in held3 if loadouts.archetype(it["idol"]) == arch),
                         key=lambda it: hashlib.sha1(f"H7/{iid}/{it['key']}".encode()).hexdigest())[:H7_TPL]
            gen = loadouts.Generator(tpl, group="archetype", target=iid, watched=(0, 3), stamina_pool=stamina)
            for it in tpl:
                rr = random.Random(f"H7/{iid}/{it['key']}")
                lo = gen._fit(loadouts.swap_identity(it["loadout"], iid), rr, {}) if it["idol"] != iid \
                    else it["loadout"]
                for s in _seeds(f"H7/{iid}/{it['key']}", None, H7_SEEDS):
                    gid = f"H7/{iid}/{it['key']}/{s}"
                    INFO[gid] = {"idol": iid, "tpl": it["key"], "real": it["idol"] == iid,
                                 "unseen": iid in HELD_IDOLS}
                    out.append((gid, dict(lo, seed=s), None))
        return out
    if set_name == "H8":
        for it in held3:
            if not it.get("added"):
                continue
            for s in _seeds(it["key"], it["loadout"].get("seed"), H4_SEEDS):
                gid = f"H8/{it['key']}/{s}"
                INFO[gid] = {"idol": it["idol"], "tpl": it["key"], "real": True}
                out.append((gid, dict(it["loadout"], seed=s), None))
        return out
    if set_name == "HC":
        return _hc(idol, held3, v3, f"HC/{idol}")
    if set_name == "H1":
        for it in held:
            for s in _seeds(it["key"], it["loadout"].get("seed")):
                INFO[f"H1/{it['key']}/{s}"] = {"idol": it["idol"], "tpl": it["key"], "real": True}
                out.append((f"H1/{it['key']}/{s}", dict(it["loadout"], seed=s), None))
    elif set_name == "H2":
        gen = loadouts.Generator(held)
        rng = random.Random("H2")
        for plan in gen.plans:
            for j in range(H2_PER_PLAN):
                lo, origin = gen.sample(rng, plan)
                for s in _seeds(f"H2/{plan}/{j}", None):
                    INFO[f"H2/{plan}/{j}/{s}"] = {"idol": lo["idol_card_id"], "tpl": origin["template"], "real": False}
                    out.append((f"H2/{plan}/{j}/{s}", dict(lo, seed=s), None))
    elif set_name == "H4":
        gen = loadouts.Generator(held)
        rng = random.Random("H4")
        for plan in gen.plans:
            for j in range(H4_PER_PLAN):
                lo, origin = gen.sample(rng, plan)
                for s in _seeds(f"H4/{plan}/{j}", None, H4_SEEDS):
                    INFO[f"H4/{plan}/{j}/{s}"] = {"idol": lo["idol_card_id"], "tpl": origin["template"], "real": False}
                    out.append((f"H4/{plan}/{j}/{s}", dict(lo, seed=s), None))
    elif set_name == "H5":
        old = {it["idol"].split("-")[1] for it in pool}
        new = [it for it in loadouts.load(loadouts.POOL_V2) if it["idol"].split("-")[1] not in old]
        for ch in sorted({it["idol"].split("-")[1] for it in new}):
            mine = [it for it in new if it["idol"].split("-")[1] == ch]
            for it in mine:
                for s in _seeds(it["key"], it["loadout"].get("seed"), H4_SEEDS):
                    INFO[f"H5/{ch}/{it['key']}/{s}"] = {"idol": it["idol"], "tpl": it["key"], "real": True}
                    out.append((f"H5/{ch}/{it['key']}/{s}", dict(it["loadout"], seed=s), None))
            gen = loadouts.Generator(mine)
            rng = random.Random(f"H5/{ch}")
            for j in range(H5_PER_CHAR):
                lo, origin = gen.sample(rng)
                for s in _seeds(f"H5/{ch}/{j}", None, H4_SEEDS):
                    INFO[f"H5/{ch}/g{j}/{s}"] = {"idol": lo["idol_card_id"], "tpl": origin["template"], "real": False}
                    out.append((f"H5/{ch}/g{j}/{s}", dict(lo, seed=s), None))
    elif set_name == "H6":
        out += _hc(H6_IDOL, held, pool, "H6")
    elif set_name == "H3":
        for it in held:
            if it["source"] != "history":
                continue
            _b, n, exact = states.replay(it)
            if not exact or n < 3:
                continue
            for d in sorted({round(n / 3), round(2 * n / 3)}):
                out.append((f"H3/{it['key']}/{d}", it["loadout"], (it["key"], d)))
    else:
        raise ValueError(set_name)
    return out


# ----------------------------------------------------------------------------- arms
class TeacherArm:
    def __init__(self, mode, worlds, trans):
        from .teacher import Teacher
        self.t = Teacher(worlds=worlds, transitions=trans, mode=mode)

    def __call__(self, battle, rng):
        from .teacher import best
        legal, vals = self.t.values(battle.session, rng)
        return legal[best(vals)]


class NetArm:
    def __init__(self, model_path):
        import torch
        from .model import from_checkpoint
        from .spec import encoder
        torch.set_num_threads(1)
        self.models = []
        for path in str(model_path).split(","):
            ck = torch.load(path, map_location="cpu", weights_only=False)
            m = from_checkpoint(ck)
            m.eval()
            self.models.append(m)
        obs = {m.obs for m in self.models}
        if len(obs) != 1:
            raise ValueError(f"an ensemble of one input version only: {sorted(obs)}")
        self.enc = encoder(obs.pop())
        self.torch = torch
        self.seconds = 0.0
        self.calls = 0

    def __call__(self, battle, rng):
        from .model import to_torch
        t0 = time.perf_counter()
        o = battle.obs()
        n = len(o["legal"])
        with self.torch.no_grad():
            x = to_torch(self.enc.encode(o))
            lp = sum(self.torch.log_softmax(m(*x)[0][0, :n], -1) for m in self.models)
        k = int(lp.argmax())
        self.seconds += time.perf_counter() - t0
        self.calls += 1
        return tuple(o["legal"][k])


class RolloutArm:
    """MODEL: one ONNX file (onnxruntime, THREADS intra-op threads), or checkpoints A.pt[,B.pt...] (torch on DEVICE,
    e.g. cuda: every step's batch in one forward pass per member; the members' log-softmax are averaged)."""

    def __init__(self, model, worlds, threads, device="cpu"):
        from .spec import encoder, of_onnx_inputs
        self.worlds = worlds
        paths = str(model).split(",")
        self.sess = None
        if all(x.endswith(".pt") for x in paths):
            import torch
            from .model import from_checkpoint
            torch.set_num_threads(threads)
            self.torch, self.device, self.members = torch, device, []
            for path in paths:
                ck = torch.load(path, map_location="cpu", weights_only=False)
                m = from_checkpoint(ck)
                m.eval()
                self.members.append(m.to(device))
            self.enc = encoder(self.members[0].obs)
        else:
            import onnxruntime as ort
            so = ort.SessionOptions()
            so.intra_op_num_threads = threads
            so.inter_op_num_threads = 1
            self.sess = ort.InferenceSession(paths[0], so, providers=["CPUExecutionProvider"])
            self.enc = encoder(of_onnx_inputs(self.sess.get_inputs()))
            self.inputs = [i.name for i in self.sess.get_inputs()]

    def _logits(self, bt):
        if self.sess is not None:
            return self.sess.run(["logit"], {k: bt[k] for k in self.inputs})[0]
        from .model import to_torch
        with self.torch.no_grad():
            x = to_torch(bt, self.device)
            lp = sum(self.torch.log_softmax(m(*x)[0].float(), -1) for m in self.members)
        return lp.cpu().numpy()

    def _actions(self, battles):
        obs = [b.obs() for b in battles]
        logit = self._logits(self.enc.batch([self.enc.compact(o) for o in obs]))
        return [o["legal"][int(row[:len(o["legal"])].argmax())] for o, row in zip(obs, logit)]

    @staticmethod
    def _advance(battles):
        """Play forced moves; the copies still waiting for a choice."""
        out = []
        for b in battles:
            while not b.finished:
                legal = b.legal()
                if len(legal) > 1:
                    out.append(b)
                    break
                b.step(legal[0])
        return out

    def __call__(self, battle, rng):
        legal, vals = self.values(battle, rng)
        total = [sum(v) for v in vals]
        return legal[max(range(len(legal)), key=total.__getitem__)]

    def values(self, battle, rng):
        """(legal actions, final scores [action][world]) -- the label format of uinet.teacher (uinet.gen --teacher-R)."""
        legal = battle.legal()
        worlds = [(rng.getrandbits(32) or 1, rng.getrandbits(32)) for _ in range(self.worlds)]
        sims = []
        for ai, a in enumerate(legal):
            for state, order in worlds:
                c = battle.clone()
                c.session.deck.rng.state = state
                engine.shuffle_pile(c.session, random.Random(order))
                c.step(tuple(a))
                sims.append((ai, c))
        active = self._advance([c for _, c in sims])
        while active:
            for c, a in zip(active, self._actions(active)):
                c.step(tuple(a))
            active = self._advance(active)
        self.enc.table.reset()
        vals = [[] for _ in legal]
        for ai, c in sims:
            vals[ai].append(c.score)
        return legal, vals


_A = {}


def _init(args):
    engine.setup()
    arm = args["arm"]
    if arm == "T":
        _A["policy"] = TeacherArm("ui", args["worlds_T"], args["trans_T"])
    elif arm == "K":
        _A["policy"] = TeacherArm("rng", args["worlds_K"], args["trans_K"])
    elif arm == "N":
        _A["policy"] = NetArm(args["model"])
    elif arm == "R":
        _A["policy"] = RolloutArm(args["model"], args["worlds_R"], args["threads_R"], args["device_R"])
    _A["items"] = {it["key"]: it for it in loadouts.load()}


def _play(job):
    from .env import Battle
    gid, lo, start = job
    rng = random.Random(f"arm/{gid}")
    t0 = time.perf_counter()
    if start:
        b, _n, _e = states.replay(_A["items"][start[0]], stop_at=start[1])
    else:
        b = Battle(lo)
    n = 0
    while not b.finished:
        legal = b.legal()
        if len(legal) == 1:
            b.step(legal[0])
            continue
        b.step(_A["policy"](b, rng))
        n += 1
    return {"game": gid, "score": b.score, "decisions": n, "seconds": round(time.perf_counter() - t0, 2)}


def read_rows(paths):
    """The rows of evaluation files, skipping a line that does not parse (a row torn by a kill); (rows, skipped)."""
    rows, bad = [], 0
    for p in paths:
        for line in Path(p).read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                bad += 1
    return rows, bad


def arm_identity(args):
    """What decides an arm's scores: the arm, its search budget or its networks by content, and the core's exam
    rules.  A resumed run appends to a file only when its rows of that arm have the same identity."""
    import hashlib
    arm = args["arm"]
    ident = {"arm": arm, "exam_rules": engine.exam_rules_version()}
    if arm == "T":
        ident.update(worlds_T=args["worlds_T"], trans_T=args["trans_T"])
    elif arm == "K":
        ident.update(worlds_K=args["worlds_K"], trans_K=args["trans_K"])
    if arm in ("N", "R") and args.get("model"):
        ident["model_sha256"] = [hashlib.sha256(Path(m).read_bytes()).hexdigest() for m in args["model"].split(",")]
    if arm == "R":
        ident["worlds_R"] = args["worlds_R"]
    return ident


def _row_mismatch(r, ident):
    """The identity keys a stored row disagrees on.  A row from before SX-04-19 has no ``ident``: its search budget and
    the file names of its networks are compared."""
    if "ident" in r:
        old = r["ident"]
        return sorted(k for k in set(old) | set(ident) if old.get(k) != ident.get(k))
    diff = [k for k in ident if k.startswith(("worlds", "trans")) and k in r and r[k] != ident[k]]
    if ident.get("model_sha256") is not None:
        names = lambda m: [Path(x).name for x in (m or "").split(",") if x]          # noqa: E731
        if names(r.get("model")) != names(_A.get("models")):
            diff.append("model")
    return diff


def run(a):
    args = {"arm": a.arm, "model": a.model and ",".join(str(Path(m).resolve()) for m in a.model.split(",")),
            "worlds_T": a.worlds_T, "worlds_R": a.worlds_R, "threads_R": a.threads_R, "device_R": a.device_R,
            "trans_T": a.trans_T, "worlds_K": a.worlds_K, "trans_K": a.trans_K}
    out = Path(a.out).resolve()
    engine.setup()
    _A["models"] = args["model"]
    jobs = games(a.set, idol=getattr(a, "idol", None))
    if a.every:
        jobs = jobs[::a.every]
    if a.limit:
        jobs = jobs[:a.limit]
    ident = arm_identity(args)
    done = set()
    if out.exists():
        raw = out.read_bytes()
        if raw and not raw.endswith(b"\n"):            # a row torn by a kill: cut it, the game is played again
            with out.open("r+b") as fh:
                fh.truncate(raw.rfind(b"\n") + 1)
            print(f"{out.name}: cut a torn last row", flush=True)
        rows, _bad = read_rows([out])
        for r in rows:
            if r["arm"] != a.arm:
                continue
            diff = _row_mismatch(r, ident)
            if diff:
                sys.exit(f"{out}: arm {a.arm} rows were played with other settings ({', '.join(diff)} differ); "
                         "write this run to another file")
            done.add(r["game"])
    jobs = [j for j in jobs if j[0] not in done]
    print(f"{a.set} arm {a.arm}: {len(jobs)} games to play", flush=True)
    meta = {"arm": a.arm, "set": a.set, "commit": engine.project_commit(), "ident": ident,
            "model": args["model"], **{k: v for k, v in args.items() if k.startswith(("worlds", "trans"))}}
    with Pool(a.workers, initializer=_init, initargs=(args,)) as pool, out.open("a") as fh:
        for r in pool.imap_unordered(_play, jobs):
            info = INFO.get(r["game"]) or {}
            fh.write(json.dumps({**meta, **info, **r}) + "\n")
            fh.flush()


SUMMARY_SETS = ("H1", "H2", "H3", "H1+H2", "H4", "H5", "H6", "H7", "H8", "HC")
PAIRS = (("N", "T"), ("N", "K"), ("T", "K"), ("R", "T"), ("R", "N"), ("R", "K"))


def summary(paths):
    """Per set, every pair of arms on the games both finished (SX-04-19: no ratio of ratios over different games):
    the geometric mean ratio, its se_log, the common games ``n`` and how many games only one arm finished
    (``only_<arm>``); no common game, no ratio.  N/T also per archetype with the six-archetype mean (H7: over the seen
    idol cards; the 12 held-out cards are their own part), and N/P on the H1 rounds that have a recorded player."""
    rows, bad = read_rows(paths)
    pool = {it["key"]: it for it in loadouts.load()}
    by = defaultdict(dict)
    for r in rows:
        by[r["game"]][r["arm"]] = r["score"]
    for gid, arms in by.items():                         # the recorded player on H1 history rounds' own seed
        parts = gid.split("/")
        if parts[0] == "H1" and parts[1].startswith("history:"):
            it = pool.get(parts[1])
            if it and str(it["loadout"].get("seed")) == parts[2]:
                arms["P"] = int(it["recorded_score"])
    res = {"unparsed rows": bad} if bad else {}
    if bad:
        print("unparsed rows", bad)
    for set_name in SUMMARY_SETS:
        sets = set_name.split("+")
        games_ = {g: x for g, x in by.items() if g.split("/")[0] in sets}
        if not games_:
            continue
        line = {"games": len(games_), "arms": dict(sorted(Counter(k for x in games_.values() for k in x
                                                                   if k != "P").items()))}
        for a, b in PAIRS:
            has_a = sum(1 for x in games_.values() if a in x)
            has_b = sum(1 for x in games_.values() if b in x)
            if not has_a or not has_b:
                continue
            both = [g for g, x in games_.items() if a in x and b in x]
            ent = {"n": len(both), f"only_{a}": has_a - len(both), f"only_{b}": has_b - len(both)}
            if both:
                d = [math.log(max(games_[g][a], 1) / max(games_[g][b], 1)) for g in both]
                mu, se = _gm(d) if len(d) > 1 else (d[0], float("nan"))
                ent = {"ratio": round(math.exp(mu), 4), "se_log": round(se, 4), **ent}
            line[f"{a}/{b}"] = ent
        both = [g for g, x in games_.items() if "N" in x and "T" in x]
        if both:
            per = defaultdict(list)
            loads = defaultdict(lambda: [0.0, 0.0])
            for g in both:
                x = math.log(max(games_[g]["N"], 1) / max(games_[g]["T"], 1))
                inf = _info(g)
                iid, unseen = inf.get("idol"), inf.get("unseen")
                if not unseen:
                    per[loadouts.archetype(iid) if iid in loadouts.idol_cards() else "?"].append(x)
                if unseen is not None:
                    per["unseen idol" if unseen else "seen idol"].append(x)
                key = "/".join(g.split("/")[:-1])
                loads[key][0] += math.log(max(games_[g]["N"], 1))
                loads[key][1] += math.log(max(games_[g]["T"], 1))
            line["N/T parts"] = {k: round(math.exp(sum(v) / len(v)), 4) for k, v in sorted(per.items())}
            arch = [sum(v) / len(v) for k, v in per.items() if "/" in k]
            if arch:
                line["N/T macro"] = round(math.exp(sum(arch) / len(arch)), 4)
            line["N>T loadouts"] = f"{sum(1 for v in loads.values() if v[0] > v[1])}/{len(loads)}"
        res[set_name] = line
        print(set_name, json.dumps(line, ensure_ascii=False))
    np_ = [math.log(max(a["N"], 1) / max(a["P"], 1)) for g, a in by.items() if "P" in a and "N" in a]
    if np_:                                                   # the recorded players' own rounds and seeds (SX-04-19)
        mu, se = _gm(np_) if len(np_) > 1 else (np_[0], float("nan"))
        res["N/P"] = {"games": len(np_), "N/P": round(math.exp(mu), 4), "se_log": round(se, 4),
                      "N>P": sum(x > 0 for x in np_)}
        print("H1 players", json.dumps(res["N/P"]))
    return res


def _info(gid):
    """INFO of a game id, rebuilding its set's definition once when a row predates the idol / tpl fields."""
    if gid not in INFO:
        set_name = gid.split("/")[0]
        if set_name in ("H1", "H2", "H4", "H5", "H6", "H7", "H8"):
            games(set_name)
        elif set_name == "HC":
            games("HC", idol=gid.split("/")[1])
    return INFO.get(gid) or {}


def _gm(d):
    n = len(d)
    mu = sum(d) / n
    se = math.sqrt(sum((x - mu) ** 2 for x in d) / (n - 1) / n) if n > 1 else float("nan")
    return mu, se


def _cluster_se(d, groups):
    """The standard error of the mean of D with the games of one group (a template or a held-out round: its seeds
    and its swapped decks) counted as one draw: the spread of the group means over sqrt(groups)."""
    by = defaultdict(list)
    for x, g in zip(d, groups):
        by[g].append(x)
    means = [sum(v) / len(v) for v in by.values()]
    k = len(means)
    if k < 2:
        return float("nan"), k
    mu = sum(means) / k
    return math.sqrt(sum((x - mu) ** 2 for x in means) / (k - 1) / k), k


def compare(path_a, path_b, set_name="H4", arm_a="N", arm_b="N", prefix=None, by_arch=True):
    """Arm ARM_A of file A against arm ARM_B of file B on the games both played: the geometric mean of A / B, the
    standard error of its log (per game, and with each template's games as one draw: se_cluster), how often A scored
    higher / lower; and (SX-04-19) the same per archetype, their unweighted mean (macro), and real / generated decks
    apart (H7 also seen / unseen idol cards)."""
    def scores(path, arm):
        out = {}
        for r in read_rows([path])[0]:
            if r["arm"] == arm and r["game"].split("/")[0] in set_name.split("+") \
                    and (not prefix or r["game"].startswith(prefix)):
                out[r["game"]] = r["score"]
        return out
    sa, sb = scores(path_a, arm_a), scores(path_b, arm_b)
    common = sorted(set(sa) & set(sb))
    d = [math.log(max(sa[g], 1) / max(sb[g], 1)) for g in common]
    n = len(d)
    mu, se = _gm(d) if n else (float("nan"), float("nan"))
    info = {g: _info(g) for g in common}
    cse, k = _cluster_se(d, [info[g].get("tpl", "/".join(g.split("/")[:-1])) for g in common])
    line = {"set": set_name + (f" {prefix}" if prefix else ""), "games": n, "A/B": round(math.exp(mu), 4),
            "se_log": round(se, 4), "se_cluster": round(cse, 4), "clusters": k,
            "A>B": sum(x > 0 for x in d), "A<B": sum(x < 0 for x in d), "A": Path(path_a).name, "B": Path(path_b).name}
    if by_arch and n:
        groups = defaultdict(list)
        for g, x in zip(common, d):
            iid = info[g].get("idol")
            arch = loadouts.archetype(iid) if iid in loadouts.idol_cards() else "?"
            groups["arch " + arch].append(x)
            groups["real" if info[g].get("real") else "generated"].append(x)
            if "unseen" in info[g]:
                groups["unseen idol" if info[g]["unseen"] else "seen idol"].append(x)
        parts = {}
        for key in sorted(groups):
            m, e = _gm(groups[key]) if len(groups[key]) > 1 else (groups[key][0], float("nan"))
            parts[key] = {"games": len(groups[key]), "A/B": round(math.exp(m), 4), "se_log": round(e, 4)}
        arch_means = [_gm(v)[0] if len(v) > 1 else v[0] for k2, v in groups.items() if k2.startswith("arch ")]
        line["macro A/B"] = round(math.exp(sum(arch_means) / len(arch_means)), 4)
        line["parts"] = parts
    print(json.dumps(line, ensure_ascii=False))
    return line


def pick(pairs, copy=None, sets=("H4", "H7"), log=print):
    """Choose a checkpoint by game play: PAIRS are ROWS.jsonl[=CHECKPOINT]; each file's arm N rows of SETS, without
    the H7 games of held-out idol cards (``unseen``), on the games every file holds.  The score of a file is the
    geometric mean of max(score, 1) -- a round that scores 0 counts as 1, it does not zero the mean.  The first of
    the best is chosen (so list the earlier epoch first); COPY: its checkpoint is copied there."""
    files = []
    for x in pairs:
        rows, _eq, ckpt = str(x).partition("=")
        got = {r["game"]: r for r in read_rows([rows])[0] if r.get("arm") == "N" and r.get("set") in sets
               and not r.get("unseen")}
        files.append((rows, ckpt, got))
    common = set.intersection(*(set(g) for _r, _c, g in files)) if files else set()
    best = None
    for rows, ckpt, got in files:
        logs = [math.log(max(1, got[g]["score"])) for g in sorted(common)]
        gm = math.exp(sum(logs) / len(logs)) if logs else 0.0
        line = {"file": rows, "checkpoint": ckpt or None, "games": len(logs), "of": len(got), "gm": round(gm, 1),
                "zero": sum(got[g]["score"] <= 0 for g in common)}
        log(json.dumps(line))
        if best is None or gm > best[0]:
            best = (gm, rows, ckpt)
    if best is None or not common:
        raise SystemExit("pick: no common games")
    log(f"BEST {best[1]} {best[2] or '-'} gm {best[0]:.1f} games {len(common)}")
    if copy and best[2]:
        import shutil
        shutil.copyfile(best[2], copy)
        log(f"COPIED {best[2]} -> {copy}")
    return best


def main(argv=None):
    p = argparse.ArgumentParser(prog="uinet.evaluate")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("out")
    r.add_argument("--arm", required=True, choices=("T", "K", "N", "R"))
    r.add_argument("--set", required=True, choices=("H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "HC"))
    r.add_argument("--idol", help="HC: the idol card")
    r.add_argument("--model")
    r.add_argument("--workers", type=int, default=2)
    r.add_argument("--worlds-T", type=int, default=16)
    r.add_argument("--trans-T", type=int, default=10000)
    r.add_argument("--worlds-K", type=int, default=6)
    r.add_argument("--trans-K", type=int, default=20000)
    r.add_argument("--limit", type=int)
    r.add_argument("--every", type=int)
    r.add_argument("--worlds-R", type=int, default=16)
    r.add_argument("--threads-R", type=int, default=4)
    r.add_argument("--device-R", default="cpu", help="arm R with .pt members: the torch device (cuda for the GPU)")
    s = sub.add_parser("summary")
    s.add_argument("out", nargs="+")
    c = sub.add_parser("compare")
    c.add_argument("a")
    c.add_argument("b")
    c.add_argument("--set", default="H4")
    c.add_argument("--arm-a", default="N")
    c.add_argument("--arm-b", default="N")
    c.add_argument("--prefix", help="only games whose id starts with this, e.g. H6/r (H6's swapped rounds)")
    c.add_argument("--idol", help="HC: the idol card (rebuilds HC's game info)")
    k = sub.add_parser("pick", help="choose a checkpoint by its games on H4 + H7 seen cards")
    k.add_argument("pairs", nargs="+", help="ROWS.jsonl[=CHECKPOINT.pt], the earlier epoch first")
    k.add_argument("--copy", help="copy the chosen checkpoint here")
    a = p.parse_args(argv)
    if a.cmd == "run":
        run(a)
    elif a.cmd == "pick":
        pairs = []
        for x in a.pairs:
            rows, eq, ckpt = x.partition("=")
            pairs.append(str(Path(rows).resolve()) + (eq + str(Path(ckpt).resolve()) if eq else ""))
        pick(pairs, str(Path(a.copy).resolve()) if a.copy else None)
    elif a.cmd == "compare":
        a.a, a.b = str(Path(a.a).resolve()), str(Path(a.b).resolve())
        engine.setup()
        compare(a.a, a.b, a.set, a.arm_a, a.arm_b, a.prefix)
    else:
        paths = [str(Path(x).resolve()) for x in a.out]
        engine.setup()
        summary(paths)


if __name__ == "__main__":
    sys.exit(main())
