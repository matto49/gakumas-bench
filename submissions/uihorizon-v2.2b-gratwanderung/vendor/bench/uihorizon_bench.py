"""UIHorizon as a gakumas-bench algorithm: the screen -> the seed -> the true world -> the route pool.

    python -m gkbench run --set <set> --algo bench.uihorizon_bench:UIHorizon --budget 5
        (with the folder above this one on PYTHONPATH; a path with a drive letter cannot be written as FILE.py:Class)
    parameters (":name=value,..."): model (the base network's ONNX file, or several joined by "+": an ensemble),
        threads (onnxruntime threads, 2), procs (seed scan processes, CPU count - 1), workers (searches side by
        side after the lock, CPU count - 1), scan_min (drawn cards before the scan, 3),
        hi (seeds scanned are [0, hi); 2147483648: the bench draws its seeds below 2^31, and so are the 48 recorded
        seeds of sx05-h1; 4294967296 scans all), max_mirrors (candidate battles followed at once, 48),
        pool (1; 0 = the one-step lookahead of 2.0 / 2.1 after the lock), vote (1; 0 = the base network decides
        until the lock), lookahead (1; 0 = the base network alone, no seed search), report (1: one line a game on
        stderr -- locked or not, when, and where the screen first differed; 0: silent)

It needs GKMS_ROOT at a GKMSProject checkout that has GKMSUINet v2 -- the same checkout the bench's referee runs
on -- and the ``uihorizon`` package beside this folder.

What it reads is what the bench hands every algorithm: ctx.obs (the screen) and ctx.loadout (the round's public
configuration, without the seed).  It does not use ctx.worlds.

  begin   the deck before the shuffle and the RNG calls before it come from the loadout (bench/opening.py: the
          engine's opening under six arbitrary seeds, which agree on both); the cards those six opening hands share
          are the ones the exam places or creates, not draws.
  decide  1. bench/draws.py reads the cards drawn so far, in order, from the observations.
          2. At the first decision (SCAN_MIN drawn cards: the opening hand) bench/seed_scan.c starts over the seeds
             [0, HI) in PROCS processes: a seed survives when its turn attributes are the ones on the screen and
             its shuffle gives the drawn cards.  A step waits for it up to 70% of its budget and plays the base
             network's action; the scan goes on over the next steps until it is back.
          3. The survivors are cut at every step until one is left.  Above MAX_MIRRORS, by bench/fastcut.py in
             the engine against the hands the screen has shown (about 0.2 ms a seed), again whenever cards have
             left the pile.  At MAX_MIRRORS or fewer, each is a battle kept in step with the game and compared on
             the whole screen.  Only the engine cuts: an effect can reorder the pile, and the draws read after
             that no longer follow the opening shuffle.
          4. While several candidate battles are left, they are the worlds this game can still be in, equally
             likely: the engine's known-seed search runs in each (WORKERS at a time) and the first action most of
             them choose is played (ties: the higher mean score).
          5. One left: it is built again the plain way (uinet.env.Battle), replayed and compared on the whole
             screen; the seed is locked.  From there uihorizon.pool.RoutePool decides: WORKERS searches and the
             network's lookahead each propose a complete route, every route is replayed, and the best route in hand
             is followed -- within 80% of the step budget.  A screen that differs from the battle's ends the lock
             for the rest of the game (the base network plays on).

Decision.meta: mode (forced / base / vote / pool / lookahead), seed (none / scanning / candidates / locked / lost /
failed), candidates, lock_turn, scan_s, scan_hits, scan_draws, cut and cut_s (seeds the cuts took out and their
time), and after the lock: target (the final score of the route in hand) and routes (adopted so far).  When the
lock is lost or no candidate is left, ``why`` names the parts of the screen that differed (_differs): a referee
on another engine version shows there -- every game fails the same way.
"""
from __future__ import annotations

import atexit
import os
import sys
import time
from pathlib import Path

try:
    from gkbench.algos.base import Algorithm, Decision
except ImportError:                                    # outside the bench (bench/selftest.py): the same two shapes
    from dataclasses import dataclass, field

    @dataclass
    class Decision:
        action: tuple
        meta: dict = field(default_factory=dict)

    class Algorithm:
        name = "base"
        privileged = False
        needs_gkms = False
        sees_seed = False

        def __init__(self, **params):
            self.params = params

        def describe(self):
            return {"name": self.name, "params": self.params, "privileged": False, "sees_seed": False}

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
for _p in (str(HERE), str(ROOT)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

MODEL_NAME = "UIHorizon-v2.2bPreview-Gratwanderung"
OPENING_SEEDS = (11, 0x9E3779B9, 123456789, 987654321, 55555, 4242424242)


def _default_model():
    for p in (ROOT / "models" / "base.onnx", ROOT / "models" / "G2.onnx",
              ROOT.parent / "sx04" / "p12" / "models" / "G2.onnx"):
        if p.is_file():
            return p
    return ROOT / "models" / "base.onnx"


def _ids(cards):
    return [c["produce_card_id"] for c in cards]


def _v1(mine, obs):
    """(MINE in its v1 view, OBS), both without the turn counts of the status rows.

    A referee on GKMSUINet v1 writes a timed status row's third field (its turns) one higher than the v1 view of a
    v2 observation does; nothing else differs.  Measured between GKMSProject befcd6f8 (v1) and b5dd367e (v2), both
    exam rules 59, 48 real rounds played at random: the final scores are equal in all 48, the screens differ in 43
    of them, at 190 of 1,087 steps, and only in that field (p3/xref).  Compared whole, the lock was lost in the
    middle of nearly every hosted game."""
    from uinet.uiobs import v1_view
    if mine.get("v") != "uiobs.v1":
        mine = v1_view(mine)
    cut = lambda o: dict(o, status=[r[:2] if isinstance(r, (list, tuple)) else r for r in o.get("status") or ()])  # noqa: E731
    return cut(mine), cut(obs)


def _same(mine, obs):
    """The rebuilt battle shows the screen OBS.  A referee on an older GKMSUINet sends UIObs v1: the rebuilt
    battle's observation is then compared in its v1 view, without the status rows' turn counts (_v1)."""
    if obs.get("v") == "uiobs.v1":
        mine, obs = _v1(mine, obs)
    return mine == obs


def _differs(mine, obs, limit=6):
    """Where the rebuilt battle's screen is not the real one: the keys, one level into dicts and lists."""
    if obs.get("v") == "uiobs.v1":
        mine, obs = _v1(mine, obs)
    out = []
    for k in sorted(set(mine) | set(obs)):
        a, b = mine.get(k, "<absent>"), obs.get(k, "<absent>")
        if a == b:
            continue
        if isinstance(a, dict) and isinstance(b, dict):
            out += [f"{k}.{j}" for j in sorted(set(a) | set(b)) if a.get(j, "<absent>") != b.get(j, "<absent>")]
        elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
            for i, (x, y) in enumerate(zip(a, b)):
                if x != y:
                    keys = [j for j in sorted(set(x) | set(y)) if x.get(j) != y.get(j)] \
                        if isinstance(x, dict) and isinstance(y, dict) else []
                    out.append(f"{k}[{i}]" + ("." + "/".join(keys[:3]) if keys else ""))
        else:
            out.append(k if not isinstance(a, list) or not isinstance(b, list) else f"{k} (length {len(a)} / {len(b)})")
    return ", ".join(out[:limit]) + (" ..." if len(out) > limit else "")


class _Game:
    """One game's seed search."""

    def __init__(self):
        self.state = "none"                  # none -> scanning -> candidates -> locked | lost | failed
        self.actions = []
        self.hands = []                      # the hand on the screen before each action, as card ids
        self.scan = None
        self.cands = None                    # seeds not yet a battle
        self.mirrors = {}                    # seed -> its battle, in step with the game
        self.mirror = None
        self.lock_turn = None
        self.scan_s = None
        self.n_cands = None
        self.scan_draws = None               # the draws the scan had
        self.cut_pos = None                  # the engine test's place in cands; None: not running
        self.cut_pile = None                 # the pile size when the engine test last went through them all
        self.cutter = None
        self.cut_n = 0
        self.cut_s = 0.0
        self.why = None
        self.near = None                     # where the last candidates' screens differed from the real one
        self.counts = {}                     # decisions by mode
        self.lost_turn = None


class UIHorizon(Algorithm):
    name = "uihorizon"
    title = MODEL_NAME
    needs_gkms = True
    about = {
        "summary": "从画面信息（回合属性、抽到的牌）和公开编成反推出这一局的牌序种子；锁定后整局是确定的，"
                   "多个已知牌序的搜索和 GKMSUINet 网络的前瞻各出一条完整路线，重放后取终局分最高的一条照着打。",
        "detail": ["只读 ctx.obs 和 ctx.loadout，不用 ctx.worlds，不拿裁判的种子",
                   "种子是从画面反推出来的：通常在第 1–3 回合锁定，之后的抽牌和随机结果对它是已知的",
                   "锁定前，在画面上还说得通的那些候选对局里各搜一遍，按多数出牌；一个候选都没有时由网络出牌",
                   "所以它的成绩和不知道牌序的算法不是同一类，应与看牌序的算法对照"],
        "sees": "seed",
        "family": "uihorizon", "family_name": "UIHorizon",
    }

    def __init__(self, model=None, threads=2, procs=None, workers=None, scan_min=3, lookahead=1, pool=1, vote=1,
                 max_mirrors=48, hi=1 << 31, report=1, **kw):
        model = "+".join(str(Path(m).expanduser().resolve()) for m in str(model).split("+")) if model \
            else str(_default_model())
        workers = max(1, int(workers or (os.cpu_count() or 2) - 1))
        super().__init__(model=model, threads=int(threads), procs=procs, workers=workers, scan_min=int(scan_min),
                         lookahead=int(lookahead), pool=int(pool), vote=int(vote), max_mirrors=int(max_mirrors), **kw)
        self.model, self.threads, self.procs, self.workers = model, int(threads), procs, workers
        self.scan_min, self.lookahead, self.max_mirrors = int(scan_min), bool(int(lookahead)), int(max_mirrors)
        self.use_pool, self.use_vote = bool(int(pool)), bool(int(vote))
        self.hi = int(hi)
        self.report, self.games, self.g = bool(int(report)), 0, None
        self.arm = None
        if self.report:
            atexit.register(self._report)

    def describe(self):
        d = super().describe()
        d["params"] = {"model_file": "+".join(Path(m).name for m in self.model.split("+")), "threads": self.threads,
                       "workers": self.workers, "scan_min": self.scan_min, "lookahead": int(self.lookahead),
                       "pool": int(self.use_pool), "vote": int(self.use_vote), "hi": self.hi}
        return d

    # -- loading (the engine is ready only once the bench has set it up)
    def _load(self):
        if self.arm is not None:
            return
        try:
            from gkbench import engine
            engine.setup()                             # puts GKMS_ROOT's GakumasCLI and GKMSUINet on the path
        except ImportError:
            pass
        from uinet import engine as ue
        ue.setup()
        from uihorizon.play import HorizonArm
        from uihorizon.pool import RoutePool
        import draws
        import fastcut
        import opening
        import seedscan
        self.master, self.opening, self.draws_mod, self.seedscan = ue.master(), opening, draws, seedscan
        self.fastcut = fastcut
        self.arm = HorizonArm(self.model.replace("+", ","), lookahead=True, from_turn=1, threads=self.threads)
        self.pool = RoutePool(net=self.arm.net, workers=self.workers)
        self.kernel = seedscan.kernel()

    def _report(self):
        """One line on stderr for the game just played."""
        g, self.g = self.g, None
        if g is None or not self.report or not g.actions:
            return
        c = g.counts
        if g.lock_turn is None:
            head = f"not locked ({g.state})"
        else:
            head = f"locked turn {g.lock_turn}" + (f", lost turn {g.lost_turn}" if g.state == "lost" else "")
        scan = "" if g.scan_s is None else f"; scan {g.scan_s} s, {g.n_cands} candidates"
        steps = ", ".join(f"{k} {c[k]}" for k in ("pool", "lookahead", "vote", "base", "forced") if c.get(k))
        why = "" if not (g.why or g.near) else "; " + " | ".join(x for x in (g.why, g.near and f"differed in: {g.near}") if x)
        print(f"[uihorizon] game {self.games}: {head}{scan}; steps: {steps}{why}", file=sys.stderr, flush=True)

    # -- a game
    def begin(self, ctx):
        self._load()
        self._report()
        self.games += 1
        g = self.g = _Game()
        self.lo = dict(ctx.loadout)
        self.tracker = None
        self.pool.reset()
        if self.scan is not None:                      # a scan left over from the game before
            self.scan.stop()
        try:
            opens = [self.opening.opening(self.master, self.lo, s) for s in OPENING_SEEDS]
            if any(o[0] != opens[0][0] or o[1] != opens[0][1] for o in opens):
                raise RuntimeError("the opening depends on the seed")
            self.pre, self.k = opens[0][0], opens[0][1]
            self.pool_attr, self.mutable = self.opening.turn_pool(opens[0][2])
            inv = self.draws_mod.invariant_hand([_ids(o[2].deck.hand) for o in opens])
            self.tracker = self.draws_mod.Draws(self.pre, inv)
            if self.kernel is None:
                raise RuntimeError("no seed_scan kernel")
        except Exception as e:                         # noqa: BLE001 -- the base network still plays
            g.state, g.why = "failed", f"{type(e).__name__}: {e}"

    scan = None

    def _start_scan(self, obs):
        g, tr = self.g, self.tracker
        turns = [int(t) for t in obs["exam"]["types"][:self.mutable]] if self.pool_attr else None
        self.scan = g.scan = self.seedscan.Scan(self.k, self.pre, list(tr.seen), list(tr.skip.elements()),
                                                self.pool_attr, turns, procs=self.procs, hi=self.hi)
        g.state, g.scan_draws = "scanning", len(tr.seen)

    def _cutter(self):
        g = self.g
        if g.cutter is None:
            g.cutter = self.fastcut.FastCut(self.master, self.lo)
        return g.cutter

    def _cut(self, obs, deadline):
        """More survivors than battles can be followed: the engine test goes through them until DEADLINE, over as
        many steps as it takes.  The seeds before cut_pos have passed it."""
        g = self.g
        t = time.perf_counter()
        try:
            cutter = self._cutter()
            hands = g.hands + [[c["id"] for c in obs["hand"]]]
            cands, i, kept = g.cands, g.cut_pos, []
            while i < len(cands) and time.perf_counter() < deadline:
                if cutter.follows(cands[i], g.actions, hands):
                    kept.append(cands[i])
                i += 1
            g.cut_n += i - g.cut_pos - len(kept)
            g.cands = cands[:g.cut_pos] + kept + cands[i:]
            g.cut_pos += len(kept)
            if g.cut_pos >= len(g.cands):
                g.cut_pos, g.cut_pile = None, len(obs["deck"])
        except Exception as e:                         # noqa: BLE001 -- another engine: the battles alone go on
            g.cut_pos, g.cut_pile, g.cut_why = None, len(obs["deck"]), f"{type(e).__name__}: {e}"
        g.cut_s += time.perf_counter() - t

    def _search(self, obs, deadline, wait_until):
        """One step of the seed search: waits for a running scan until WAIT_UNTIL, cuts and rebuilds candidates
        until DEADLINE."""
        from uinet.env import Battle
        g, tr = self.g, self.tracker
        turn = int(obs["exam"]["turn"])
        if g.state == "none":
            if len(tr.seen) >= self.scan_min or (not tr.open and len(tr.seen) >= 3):
                self._start_scan(obs)
            elif not tr.open:
                g.state, g.why = "failed", "too few draws read before the pile changed"
        if g.state == "scanning":                      # a game's steps follow each other at once, so the scan is
            seeds = g.scan.poll()                      # waited for here, inside the step budget, over as many steps
            while seeds is None and time.perf_counter() < wait_until:      # as it takes
                time.sleep(0.02)
                seeds = g.scan.poll()
            if seeds is None:
                return
            g.scan_s, g.n_cands, g.cands, g.state = round(g.scan.seconds, 2), len(seeds), seeds, "candidates"
            self.scan = None
            g.cut_pos = 0 if len(seeds) > self.max_mirrors else None
        if g.state != "candidates":
            return
        if g.cut_pos is None and len(g.cands) + len(g.mirrors) > self.max_mirrors and g.cut_pile != len(obs["deck"]):
            g.cut_pos = 0                              # cards have left the pile since the last pass: once more
        if g.cut_pos is not None:
            self._cut(obs, deadline)
            if g.cut_pos is not None:
                return
        cutter = None
        while g.cands and len(g.mirrors) < self.max_mirrors and time.perf_counter() < deadline:
            s = g.cands.pop()
            try:
                cutter = cutter or self._cutter()
                m = cutter.battle(s, g.actions)
            except Exception:                          # noqa: BLE001 -- another engine: the plain way
                try:
                    m = Battle(dict(self.lo, seed=int(s)))
                    for a in g.actions:
                        m.step(a)
                except Exception:                      # noqa: BLE001 -- not this game's seed
                    m = None
            if m is not None:
                g.mirrors[s] = m
        gone = [s for s, m in g.mirrors.items() if m.finished or not _same(m.obs(), obs)]
        if gone and len(gone) == len(g.mirrors) and not g.cands:       # the last ones: where they differed
            m = g.mirrors[gone[-1]]
            g.near = "the battle is over" if m.finished else _differs(m.obs(), obs)
        for s in gone:
            del g.mirrors[s]
        if not g.cands:
            if len(g.mirrors) == 1:
                (seed, _m), = g.mirrors.items()
                try:                                   # the one left, built the plain way and compared once more
                    m = Battle(dict(self.lo, seed=int(seed)))
                    for a in g.actions:
                        m.step(a)
                    ok = not m.finished and _same(m.obs(), obs)
                except Exception:                      # noqa: BLE001
                    ok = False
                if ok:
                    g.mirror, g.mirrors, g.state, g.lock_turn = m, {}, "locked", turn
                else:
                    g.mirrors, g.state, g.why = {}, "failed", "the last candidate does not rebuild to the screen"
            elif not g.mirrors:
                g.state, g.why = "failed", "no seed reproduces the screen"

    def _base(self, obs):
        net = self.arm.base
        enc = net.arm.enc
        logit = net.arm._logits(enc.batch([enc.compact(obs)]))[0]
        net.reset()
        return tuple(obs["legal"][int(logit[:len(obs["legal"])].argmax())])

    def _vote(self, legal, seconds):
        """The candidate battles are the worlds the game can be in: a search in each, the first action most choose."""
        g = self.g
        worlds = list(g.mirrors.values())
        each = max(0.05, seconds / -(-len(worlds) // self.workers))     # the worlds go through in rounds of WORKERS
        jobs = [(m.session, self.pool.seed + i, None, each) for i, m in enumerate(worlds)]
        run = lambda j: self.pool._search(*j)                           # noqa: E731
        res = list(self.pool.threads.map(run, jobs)) if self.pool.threads else [run(j) for j in jobs]
        votes = {}
        for route, st in res:
            if route and tuple(route[0]) in legal:
                v = votes.setdefault(tuple(route[0]), [0, 0])
                v[0] += 1
                v[1] += int(st["best_score"])
        if not votes:
            return None, {}
        best = max(votes, key=lambda a: (votes[a][0], votes[a][1] / votes[a][0]))
        return best, {"worlds": len(worlds), "votes": votes[best][0]}

    def decide(self, ctx):
        t0 = time.perf_counter()
        budget = float(ctx.budget or 5.0)
        g = self.g
        obs = {k: v for k, v in ctx.obs.items() if k != "i"}
        legal = [tuple(a) for a in obs["legal"]]
        meta = {}
        if g.state not in ("failed", "lost"):
            try:
                if g.state != "locked":
                    self.tracker.update(obs)
                    if self.lookahead:
                        # the vote needs its share of the step once the candidates are few enough to be battles
                        few = (g.state == "candidates" and g.cut_pos is None
                               and len(g.cands or ()) + len(g.mirrors) <= self.max_mirrors)
                        voting = few and self.use_vote and self.use_pool
                        self._search(obs, t0 + (0.3 if voting else 0.75) * budget, t0 + 0.7 * budget)
                elif g.mirror.finished or not _same(g.mirror.obs(), obs):
                    g.near = "the battle is over" if g.mirror.finished else _differs(g.mirror.obs(), obs)
                    g.state, g.lost_turn = "lost", int(obs["exam"]["turn"])
                    g.why = f"the screen differs from the solved battle at turn {g.lost_turn}"
            except Exception as e:                     # noqa: BLE001
                g.state, g.why = "failed", f"{type(e).__name__}: {e}"
        action, mode = None, "base"
        left = t0 + 0.8 * budget - time.perf_counter()
        if len(legal) == 1:
            action, mode = legal[0], "forced"
        elif g.state == "locked" and self.lookahead and self.use_pool:
            try:
                a = self.pool.decide(g.mirror, seconds=max(0.05, left))
                if tuple(a) in legal:
                    action, mode = tuple(a), "pool"
                    meta["target"], meta["routes"] = self.pool.target, self.pool.stats["adopted"]
            except Exception as e:                     # noqa: BLE001 -- the base network decides this step
                meta["pool_why"] = f"{type(e).__name__}: {e}"
        elif g.state == "locked" and self.lookahead:
            lg, vals = self.arm.values(g.mirror, deadline=t0 + 0.8 * budget)
            if vals is not None:
                best = max(range(len(lg)), key=lambda i: vals[i][0])
                action, mode = tuple(lg[best]), "lookahead"
                meta["values"] = [[list(a), v[0]] for a, v in zip(lg, vals)]
            else:
                meta["timeout"] = True
        elif (g.state == "candidates" and self.use_vote and self.use_pool and not g.cands and g.cut_pos is None
              and len(g.mirrors) > 1 and left > 0.2):
            try:
                a, info = self._vote(legal, left)
                if a is not None:
                    action, mode = a, "vote"
                    meta.update(info)
            except Exception as e:                     # noqa: BLE001
                meta["vote_why"] = f"{type(e).__name__}: {e}"
        if action is None:
            action = self._base(obs)
        if g.state == "locked" and self.use_pool and mode != "pool":
            self.pool.played(action)                   # a forced move, or the base network's: the route keeps step
        g.actions.append(action)
        g.hands.append([c["id"] for c in obs["hand"]])
        for s, m in list(g.mirrors.items()):
            try:
                m.step(action)
            except Exception:                          # noqa: BLE001
                del g.mirrors[s]
        if g.state == "locked":
            try:
                g.mirror.step(action)
            except Exception as e:                     # noqa: BLE001
                g.state, g.why = "lost", f"{type(e).__name__}: {e}"
        meta.update(mode=mode, seed=g.state)
        g.counts[mode] = g.counts.get(mode, 0) + 1
        if g.state == "candidates":
            meta["candidates"] = len(g.cands or ()) + len(g.mirrors)
        if g.lock_turn is not None:
            meta["lock_turn"] = g.lock_turn
        if g.scan_s is not None:
            meta["scan_s"], meta["scan_hits"], meta["scan_draws"] = g.scan_s, g.n_cands, g.scan_draws
        if g.cut_n or g.cut_pos is not None:
            meta["cut"], meta["cut_s"] = g.cut_n, round(g.cut_s, 2)
        if getattr(g, "cut_why", None):
            meta["cut_why"] = g.cut_why
        if g.why:
            meta["why"] = g.why
        if g.near and g.state in ("lost", "failed"):
            meta["differs"] = g.near
        return Decision(action, meta)
