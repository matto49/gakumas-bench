"""P1 labels: the UI teacher plays H.I.F battles; every decision it meets is a training sample.

    python -B -m uinet.gen OUT_DIR --shard NAME --episodes N [--workers W] [--worlds 16] [--transitions 10000]
        [--generated 0.5] [--tau 0.005] [--eps 0.1] [--max-hours H] [--progress FILE] [--policy NET.onnx --beta 0.2]
        [--teacher-R A.pt[,B.pt...] --worlds-R 16 --device-R cuda]

An episode: a loadout -- a train-side round of the pool, or (fraction GENERATED) a generated deck around one
(uinet.loadouts.Generator) -- with a fresh exam seed, played to the end.  At each decision with more than one legal
action the teacher (uinet.teacher, mode "ui", WORLDS x TRANSITIONS) scores every action; the action played is the
teacher's best, a softmax(log-ratio / TAU) draw, or with probability EPS a uniform one, so states off the teacher's
line are covered too.  Everything is seeded by (shard, episode index): the same command reproduces the same episodes.

With --teacher-R A.pt[,B.pt...] (SX-04-12b): the labels are arm R's (uinet.evaluate.RolloutArm): every legal action
in WORLDS-R worlds drawn as teacher T draws them, then the network A[,B...] (torch on --device-R) plays every copy
to the end; q[a][k] is copy (a, k)'s final score.  No native search.

SX-04-19: --archetype limits templates and real rounds to one archetype (a label budget per archetype);
--target-idol takes its real rounds (the share 1 - GENERATED) from that idol card's own rounds only, and when the
pool has none every episode is generated; --exclude-idols keeps the given idol cards out entirely.

With --policy (DAgger, SX-04-03): the network (an ONNX export, uinet.infer.Policy, greedy as arm N plays) picks the
action played, the teacher's draw with probability BETA, a uniform one with probability EPS; the teacher still scores
every legal action, so the labels are the teacher's on the states the network itself reaches.  Each decision then
records who picked ("by": "n" network, "t" teacher, "r" uniform).

Output: OUT_DIR/<shard>.jsonl.zst, one JSON line per episode, each line its own zstd frame (a killed run loses at
most the episode in flight; a rerun skips the episodes the file holds), and OUT_DIR/<shard>.meta.json (commit,
parameters).  A line: {"idx", "origin" (template / swaps / plan), "seed", "final", "picks", "fallbacks",
"seconds", "decisions": [{"obs": UIObs, "q": [[value per world] per legal action], "a": index played}]}.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
from multiprocessing import Pool
from pathlib import Path

from . import engine, loadouts

_G = {}


def _init(args):
    engine.setup()
    pool = loadouts.load(args["pool"])
    exclude = set(args.get("exclude_chars") or ())
    ex_idols = set(args.get("exclude_idols") or ())
    train = [it for it in pool if not it["held_out"] and loadouts.char_of(it["idol"]) not in exclude
             and it["idol"] not in ex_idols]
    arch = args.get("archetype")
    if arch:                                           # SX-04-19: one archetype's templates only
        train = [it for it in train if loadouts.archetype(it["idol"]) == arch]
    target = args.get("target_idol")
    # the real rounds an episode may take as they are: the target idol card's own when there is one (SX-04-19: a
    # card's training uses its real decks, never another card's), else every train-side round
    _G["real"] = [it for it in train if it["idol"] == target] if target else train
    _G["train"] = train
    _G["gen"] = loadouts.Generator(train, max_swaps=args["max_swaps"], group=args.get("group", "plan"),
                                   swap_idol=args.get("swap_idol", 0.0), exclude=exclude,
                                   target=target, target_share=args.get("target_share", 1.0),
                                   watched=tuple(args.get("watched") or (0, 0)),
                                   stamina_pool=pool if args.get("char_stamina") else None,
                                   extra=bool(args.get("extra_cards")), exclude_idols=ex_idols)
    _G["args"] = args
    if args.get("policy"):
        from .infer import Policy
        _G["policy"] = Policy(args["policy"], threads=1)
    if args.get("teacher_R"):
        from .evaluate import RolloutArm
        _G["rteacher"] = RolloutArm(args["teacher_R"], args["worlds_R"], 1, args["device_R"])


def choose(means, rng, tau, eps):
    if rng.random() < eps:
        return rng.randrange(len(means))
    top = max(means)
    if tau <= 0 or top <= 0:
        return max(range(len(means)), key=means.__getitem__)
    w = [math.exp((math.log(max(m, 1.0)) - math.log(top)) / tau) for m in means]
    return rng.choices(range(len(means)), w)[0]


def roll_in(policy, obs, means, rng, a):
    """(index played, who picked) for a DAgger episode: uniform with probability EPS, the teacher's draw with
    probability BETA, else the network's greedy choice."""
    u = rng.random()
    if u < a["eps"]:
        return rng.randrange(len(means)), "r"
    if u < a["eps"] + a["beta"]:
        return choose(means, rng, a["tau"], 0.0), "t"
    probs = policy.decide(obs)["probs"]
    return max(range(len(probs)), key=probs.__getitem__), "n"


def episode(idx):
    from .env import Battle
    from .teacher import Teacher
    a = _G["args"]
    rng = random.Random(f"{a['shard']}/{idx}")
    if rng.random() < a["generated"] or not _G["real"]:
        lo, origin = _G["gen"].sample(rng)
    else:
        it = rng.choice(_G["real"])
        lo, origin = it["loadout"], {"template": it["key"], "plan": it["plan"], "swaps": 0, "real": True}
    lo = dict(lo)
    lo["seed"] = rng.randrange(1, 2 ** 31 - 1)
    t0 = time.perf_counter()
    b = Battle(lo)
    rteacher = _G.get("rteacher")
    teacher = None if rteacher else Teacher(worlds=a["worlds"], transitions=a["transitions"], mode="ui")
    decisions = []
    while not b.finished:
        legal = b.legal()
        if len(legal) == 1:
            b.step(legal[0])
            continue
        obs = b.obs()
        _legal, vals = rteacher.values(b, rng) if rteacher else teacher.values(b.session, rng, legal)
        means = [sum(v) / len(v) for v in vals]
        policy = _G.get("policy")
        if policy is None:
            k = choose(means, rng, a["tau"], a["eps"])
            decisions.append({"obs": obs, "q": vals, "a": k})
        else:
            k, by = roll_in(policy, obs, means, rng, a)
            decisions.append({"obs": obs, "q": vals, "a": k, "by": by})
        b.step(legal[k])
    return {"idx": idx, "origin": origin, "seed": lo["seed"], "loadout": lo, "final": b.score, "picks": b.picks(),
            "fallbacks": teacher.fallbacks if teacher else 0, "seconds": round(time.perf_counter() - t0, 1),
            "decisions": decisions}


ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"


def iter_frames(data, report=None, chunk=32768):
    """The complete zstd frames of a label file's bytes, one at a time, as (start, end, text).  A frame that does not
    decode (torn by a kill and then followed by frames a resumed run appended) is skipped up to the next frame magic;
    an incomplete frame at the end stops the scan.  REPORT (a dict) receives, once the scan ends, the frames, the bytes
    skipped in the middle and the torn bytes at the end (``tail``)."""
    import zstandard
    dctx = zstandard.ZstdDecompressor()
    nf, skipped, pos, n, tail = 0, 0, 0, len(data), 0
    while pos < n:
        d = dctx.decompressobj()
        parts, q, end = [], pos, None
        try:
            while q < n:
                piece = data[q:q + chunk]
                parts.append(d.decompress(piece))
                q += len(piece)
                if d.eof:
                    end = q - len(d.unused_data)
                    break
        except zstandard.ZstdError:
            end = None
        if end is not None:
            nf += 1
            yield pos, end, b"".join(parts).decode("utf-8", "replace")
            pos = end
            continue
        nxt = data.find(ZSTD_MAGIC, pos + 1)
        if nxt < 0:                                    # a torn frame at the end
            tail = n - pos
            break
        skipped += nxt - pos
        pos = nxt
    if report is not None:
        report.update(frames=nf, skipped_bytes=skipped, tail=tail)


def scan_frames(data):
    """(end of the last complete frame, iter_frames' report) of a label file's bytes."""
    rep, end = {}, 0
    for _s, e, _t in iter_frames(data, rep):
        end = e
    return end, rep


def read_episodes(path, report=None):
    """Every episode of a .jsonl.zst written by this module (one frame per episode), in file order and one at a time;
    a torn or corrupt frame is skipped and reading goes on (iter_frames), and an episode index seen before is dropped
    (a resumed run that could not read past a torn frame played those indices again: the first copy stays).  REPORT
    (a dict) receives, once all is read, the scan counts plus ``episodes``, ``duplicates`` and ``bad_lines``."""
    data = Path(path).read_bytes()
    rep = {}
    seen, dup, bad = set(), 0, 0
    for _s, _e, text in iter_frames(data, rep):
        for line in text.splitlines():
            if not line.strip():
                continue
            try:
                ep = json.loads(line)
            except ValueError:
                bad += 1
                continue
            if ep.get("idx") in seen:
                dup += 1
                continue
            seen.add(ep.get("idx"))
            yield ep
    if report is not None:
        report.update(rep, episodes=len(seen), duplicates=dup, bad_lines=bad)


def check(paths):
    """python -B -m uinet.gen --check FILE...: per label file, the frames, episodes, decisions, duplicates dropped,
    bytes skipped and torn tail, and whether its progress file (FILE without .jsonl.zst + .progress.jsonl, when
    there is one) lists more distinct episodes than the file holds."""
    for f in paths:
        rep = {}
        dec = sum(len(ep["decisions"]) for ep in read_episodes(f, rep))
        prog = Path(str(f).replace(".jsonl.zst", ".progress.jsonl"))
        if prog.exists():
            rep["progress_episodes"] = len({json.loads(l)["idx"] for l in prog.read_text().splitlines() if l.strip()})
        print(json.dumps({"file": str(f), "decisions": dec, **rep}), flush=True)


def _identity(args):
    """What decides a shard's episodes: every argument except where files sit, the files by content (pool, policy,
    rollout networks), and the exam rules of the native core.  A resumed run must match it."""
    import hashlib
    ident = {k: v for k, v in args.items() if k not in ("pool", "policy", "teacher_R", "policy_sha256")}
    ident["pool_sha256"] = hashlib.sha256(Path(args["pool"]).read_bytes()).hexdigest()
    if args.get("policy"):
        ident["policy_sha256"] = hashlib.sha256(Path(args["policy"]).read_bytes()).hexdigest()
    if args.get("teacher_R"):
        ident["teacher_R_sha256"] = [hashlib.sha256(Path(x).read_bytes()).hexdigest()
                                     for x in args["teacher_R"].split(",")]
    ident["exam_rules"] = engine.exam_rules_version()
    return ident


def _same_identity(old, new):
    """The keys whose values differ.  A meta file from before SX-04-19 has no ``identity``: its own fields are compared
    where both have them (paths and the commit left out)."""
    ref = old.get("identity")
    if ref is None:
        ref = {k: v for k, v in old.items() if k in new}
    return sorted(k for k in set(ref) | set(new) if k in ref and k in new and ref[k] != new[k]
                  or (old.get("identity") is not None and (k in ref) != (k in new)))


def replay_episode(ep):
    """Replay a stored episode on the engine: yields (battle at the decision, its stored record), so the observation
    of a later schema can be rebuilt from labels made under an earlier one.  Forced steps (one legal action) and the
    picker are deterministic, so the stored choices reproduce the episode."""
    from .env import Battle
    b = Battle(ep["loadout"])
    for d in ep["decisions"]:
        while not b.finished and len(b.legal()) == 1:
            b.step(b.legal()[0])
        yield b, d
        b.step(b.legal()[d["a"]])


def _v1_status(obs):
    """The status list as payloads up to d935b9f wrote it: every timed gain under the one kind "timed_gain"."""
    from .uiobs import TIMED_GAIN_KIND
    back = set(TIMED_GAIN_KIND.values())
    return [["timed_gain", *s[1:]] if s[0] in back else s for s in obs["status"]]


def reobserved(ep):
    """The episode's decisions with the observation rebuilt by the current code, or None when the replay leaves the
    stored line (anything but the status kinds differs: the engine changed the battle)."""
    from .uiobs import v1_view
    out = []
    for b, d in replay_episode(ep):
        obs = b.obs()
        old, now = v1_view(d["obs"]), v1_view(obs)
        if {k: v for k, v in now.items() if k not in ("status", "v")} != \
                {k: v for k, v in old.items() if k not in ("status", "v")} or _v1_status(now) != _v1_status(old):
            return None
        out.append(dict(d, obs=obs))
    return out


def done_indices(path):
    if not Path(path).exists():
        return set()
    out = set()
    try:
        for ep in read_episodes(path):
            out.add(ep["idx"])
    except Exception:                                  # noqa: BLE001 -- a torn last frame: keep what reads
        pass
    return out


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "--check":
        return check(argv[1:])
    p = argparse.ArgumentParser(prog="uinet.gen")
    p.add_argument("out")
    p.add_argument("--shard", required=True)
    p.add_argument("--episodes", type=int, required=True)
    p.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    p.add_argument("--worlds", type=int, default=16)
    p.add_argument("--transitions", type=int, default=10000)
    p.add_argument("--generated", type=float, default=0.5)
    p.add_argument("--max-swaps", type=int, default=10)
    p.add_argument("--tau", type=float, default=0.005)
    p.add_argument("--eps", type=float, default=0.1)
    p.add_argument("--max-hours", type=float, default=None)
    p.add_argument("--pool", default=str(loadouts.POOL))
    p.add_argument("--group", choices=("plan", "archetype"), default="plan",
                   help="generated decks: a plan type, or one of the 6 archetypes (plan x mechanic), drawn uniformly")
    p.add_argument("--swap-idol", type=float, default=0.0,
                   help="share of generated decks whose idol card is replaced by another SSR card of its archetype")
    p.add_argument("--exclude-chars", default="", help="characters left out entirely, e.g. atbm (held out)")
    p.add_argument("--target-idol", help="SX-04-19: generated decks built for this idol card (its archetype's "
                   "templates), TARGET_SHARE of them swapped to it")
    p.add_argument("--target-share", type=float, default=1.0)
    p.add_argument("--archetype", help="SX-04-19: only this archetype's templates and real rounds, e.g. "
                   "PLAN3/EXAM_FULL_POWER (a per-archetype label budget)")
    p.add_argument("--exclude-idols", default="", help="idol cards never swapped in and whose rounds are not "
                   "templates (held out for the unseen-card measure, uinet.evaluate HELD_IDOLS)")
    p.add_argument("--watched", default="0,0", help="LO,HI: a swapped-in idol's P-item cards held LO..HI times")
    p.add_argument("--char-stamina", action="store_true",
                   help="a swapped deck takes a max stamina of its new character's pool rounds")
    p.add_argument("--extra-cards", action="store_true",
                   help="the plan's offer support set joins the card pool (deck_value.extra_cards, PD-10)")
    p.add_argument("--progress", help="append one JSON row per finished episode here (for the cloud kit's check)")
    p.add_argument("--policy", help="DAgger: an ONNX export of the network that plays (uinet.export)")
    p.add_argument("--beta", type=float, default=0.2, help="DAgger: share of decisions the teacher picks")
    p.add_argument("--teacher-R", help="SX-04-12b: arm R's labels, rollouts of these checkpoints (comma-separated)")
    p.add_argument("--worlds-R", type=int, default=16)
    p.add_argument("--device-R", default="cpu")
    a = p.parse_args(argv)
    import zstandard
    out = Path(a.out).resolve()
    progress = Path(a.progress).resolve() if a.progress else None
    policy = str(Path(a.policy).resolve()) if a.policy else None
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{a.shard}.jsonl.zst"
    args = {k: getattr(a, k) for k in ("shard", "worlds", "transitions", "generated", "max_swaps", "tau", "eps")}
    args["pool"] = str(Path(a.pool).resolve())         # the workers' engine.setup() changes directory
    args.update(group=a.group, swap_idol=a.swap_idol,
                exclude_chars=[c for c in a.exclude_chars.split(",") if c],
                target_idol=a.target_idol, target_share=a.target_share, archetype=a.archetype,
                exclude_idols=[x for x in a.exclude_idols.split(",") if x],
                watched=[int(x) for x in a.watched.split(",")], char_stamina=a.char_stamina,
                extra_cards=a.extra_cards)
    if a.teacher_R:
        args.update(teacher_R=",".join(str(Path(x).resolve()) for x in a.teacher_R.split(",")), worlds_R=a.worlds_R,
                    device_R=a.device_R)
    if policy:
        import hashlib
        args.update(policy=policy, beta=a.beta,
                    policy_sha256=hashlib.sha256(Path(policy).read_bytes()).hexdigest())
    ident = _identity(args)
    meta_path = out / f"{a.shard}.meta.json"
    now = {"commit": engine.project_commit(), "at": time.strftime("%Y-%m-%d %H:%M:%S"), "episodes": a.episodes}
    if path.exists() and path.stat().st_size and meta_path.exists():
        old = json.loads(meta_path.read_text(encoding="utf-8"))
        diff = _same_identity(old, ident)
        if diff:
            sys.exit(f"{path}: written with other settings ({', '.join(diff)} differ); use a new --shard")
        meta = dict(old, identity=old.get("identity") or ident, runs=list(old.get("runs") or ()) + [now])
    else:
        meta = dict(args, identity=ident, commit=now["commit"], episodes=a.episodes, started=now["at"], runs=[now])
    if path.exists():                                  # cut a torn last frame, so appended frames follow a whole one
        data = path.read_bytes()
        end, rep = scan_frames(data)
        if end < len(data) and rep["tail"]:
            with path.open("r+b") as fh:
                fh.truncate(end)
            print(f"{a.shard}: cut a torn last frame ({len(data) - end} bytes)", flush=True)
    meta_path.write_text(json.dumps(meta, indent=1), encoding="utf-8")
    done = done_indices(path)                          # read once (inside the comprehension it reread the file per i)
    todo = [i for i in range(a.episodes) if i not in done]
    print(f"{a.shard}: {a.episodes - len(todo)} done, {len(todo)} to play, {a.workers} workers", flush=True)
    deadline = time.time() + a.max_hours * 3600 if a.max_hours else None
    n = dec = 0
    t0 = time.time()
    cctx = zstandard.ZstdCompressor(level=10)
    with Pool(a.workers, initializer=_init, initargs=(args,)) as pool, open(path, "ab") as fh:
        for ep in pool.imap_unordered(episode, todo):
            fh.write(cctx.compress((json.dumps(ep, separators=(",", ":")) + "\n").encode("utf-8")))
            fh.flush()
            if progress:
                with progress.open("a") as pf:
                    pf.write(json.dumps({"idx": ep["idx"], "decisions": len(ep["decisions"]), "final": ep["final"],
                                         "seconds": ep["seconds"]}) + "\n")
            n += 1
            dec += len(ep["decisions"])
            if n % 10 == 0 or n == len(todo):
                el = time.time() - t0
                print(f"{a.shard}: {n}/{len(todo)} episodes, {dec} decisions, {dec / el * 3600:.0f} decisions/h",
                      flush=True)
            if deadline and time.time() > deadline:
                pool.terminate()
                break
    print(f"{a.shard}: finished, {n} episodes / {dec} decisions this run", flush=True)


if __name__ == "__main__":
    sys.exit(main())
