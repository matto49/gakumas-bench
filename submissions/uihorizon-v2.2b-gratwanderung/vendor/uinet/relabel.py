"""Sharper labels where the teacher could not tell its leading actions apart (SX-04-09).

    python -B -m uinet.relabel run OUT_DIR IN.jsonl.zst [IN2 ...] [--workers W] [--worlds 16] [--rounds 1]
        [--transitions 10000] [--max-turn 5] [--z 2.0] [--top 3] [--max-hours H] [--progress FILE]
    python -B -m uinet.relabel merge OUT_DIR PART_DIR IN.jsonl.zst [IN2 ...] [--workers W]

Why: on held-out round-two decisions the network's regret against the teacher is largest in turns 1-5 (60% of it),
and there the teacher's own labels are least certain: with the 16 worlds split in halves, an 8-world teacher judged by
the other 8 loses 3.1% a decision in turns 1-5 and 1.1% later, and in turns 1-5 the best and the second action are
within 2 paired standard errors on 81% of the decisions (Claude's sandbox, uil_ea / eb / ec, 2026-10-25).

run: every episode of the IN files is replayed (uinet.gen.replay_episode) and its observations are rebuilt by the
current UIObs code, as uinet.reobserve does (an episode whose replay leaves the stored line is dropped and counted).
At a decision of turn <= MAX_TURN whose best and second action (by mean over the stored worlds) are within Z paired
standard errors (log score, the stored worlds are common to all actions), the TOP leading actions get WORLDS fresh
worlds (uinet.teacher mode "ui", TRANSITIONS per search) per round, up to ROUNDS rounds, stopping once the two leading
ones among them are Z apart.  The other actions keep their stored worlds; q rows may then differ in length (uinet.train
takes each row's mean).  The decision gets "rl": {"z0", "z1", "added", "top"}.  Worlds are seeded by
(shard, episode, decision), so a rerun reproduces them.  OUT_DIR/<shard>.jsonl.zst per IN file, the uinet.gen format;
a rerun skips the episodes the output already holds; MAX_HOURS stops with what is done.

merge: OUT_DIR/<shard>.jsonl.zst for every IN file, each episode taken from PART_DIR/<shard>.jsonl.zst (a run's
output) when it is there, otherwise re-observed only.  The result is what uinet.train reads.
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

from . import engine

_G = {}


def _init(args):
    engine.setup()
    _G["args"] = args


def _z(q, i, j):
    """Paired z of action i over action j on the worlds they share (the stored worlds come first in every row)."""
    n = min(len(q[i]), len(q[j]))
    d = [math.log(max(q[i][k], 1)) - math.log(max(q[j][k], 1)) for k in range(n)]
    mu = sum(d) / n
    var = sum((x - mu) ** 2 for x in d) / (n - 1) if n > 1 else 0.0
    return mu / math.sqrt(var / n) if var > 0 else (math.inf if mu > 0 else 0.0)


def _order(q):
    means = [sum(v) / len(v) for v in q]
    return sorted(range(len(q)), key=lambda a: -means[a])


def sharpen(b, d, shard, idx, j, teacher, a):
    """The decision record with sharper q (or unchanged when it is not a target)."""
    q = [list(v) for v in d["q"]]
    if d["obs"]["exam"]["turn"] > a["max_turn"] or len(q) < 2:
        return d
    o = _order(q)
    z0 = _z(q, o[0], o[1])
    if z0 >= a["z"]:
        return d
    rng = random.Random(f"relabel/{shard}/{idx}/{j}")
    legal = b.legal()
    top = sorted(o[:a["top"]])
    added, z1 = 0, z0
    for _ in range(a["rounds"]):
        _l, vals = teacher.values(b.session, rng, [legal[c] for c in top])
        for c, v in zip(top, vals):
            q[c].extend(v)
        added += a["worlds"]
        ot = [c for c in _order(q) if c in top]
        z1 = _z(q, ot[0], ot[1]) if len(ot) > 1 else math.inf
        if z1 >= a["z"]:
            break
    return dict(d, q=q, rl={"z0": round(z0, 3), "z1": round(min(z1, 99.0), 3), "added": added, "top": top})


def _one(job):
    from .gen import _v1_status, replay_episode
    from .teacher import Teacher
    shard, line = job
    a = _G["args"]
    ep = json.loads(line)
    t0 = time.perf_counter()
    teacher = Teacher(worlds=a["worlds"], transitions=a["transitions"], mode="ui") if a else None
    out, n_rl, n_add = [], 0, 0
    for j, (b, d) in enumerate(replay_episode(ep)):
        obs, old = b.obs(), d["obs"]
        if {k: v for k, v in obs.items() if k != "status"} != {k: v for k, v in old.items() if k != "status"} \
                or _v1_status(obs) != _v1_status(old):
            return shard, ep["idx"], None, {}
        d = dict(d, obs=obs)
        if teacher is not None:
            d = sharpen(b, d, shard, ep["idx"], j, teacher, a)
            if "rl" in d:
                n_rl += 1
                n_add += d["rl"]["added"]
        out.append(d)
    rec = {"shard": shard, "idx": ep["idx"], "decisions": len(out), "relabeled": n_rl, "added_worlds": n_add,
           "seconds": round(time.perf_counter() - t0, 1)}
    return shard, ep["idx"], json.dumps(dict(ep, decisions=out), separators=(",", ":")), rec


def _jobs(paths, skip):
    """The files' episodes round-robin, so a run stopped by MAX_HOURS has sharpened every file about equally."""
    from .gen import read_episodes
    its = [(p.name.split(".")[0], read_episodes(p)) for p in paths]
    while its:
        alive = []
        for shard, it in its:
            ep = next(it, None)
            if ep is None:
                continue
            alive.append((shard, it))
            if ep["idx"] not in skip.get(shard, ()):
                yield shard, json.dumps(ep, separators=(",", ":"))
        its = alive


def _write_all(pool, jobs, out_dir, progress=None, deadline=None, log_every=20):
    import zstandard
    cctx = zstandard.ZstdCompressor(level=10)
    handles, n, dropped, totals = {}, 0, {}, {"decisions": 0, "relabeled": 0, "added_worlds": 0}
    t0 = time.time()
    try:
        for shard, idx, line, rec in pool.imap_unordered(_one, jobs, chunksize=1):
            n += 1
            if line is None:
                dropped.setdefault(shard, []).append(idx)
                continue
            fh = handles.get(shard)
            if fh is None:
                fh = handles[shard] = open(out_dir / f"{shard}.jsonl.zst", "ab")
            fh.write(cctx.compress((line + "\n").encode("utf-8")))
            fh.flush()
            for k in totals:
                totals[k] += rec[k]
            if progress:
                with progress.open("a") as pf:
                    pf.write(json.dumps(rec) + "\n")
            if n % log_every == 0:
                print(f"{n} episodes, {totals}, {time.time() - t0:.0f} s", flush=True)
            if deadline and time.time() > deadline:
                pool.terminate()
                print("max-hours reached", flush=True)
                break
    finally:
        for fh in handles.values():
            fh.close()
    print(f"finished: {n} episodes this run, {totals}, dropped "
          f"{ {s: sorted(v)[:20] for s, v in dropped.items()} }, {time.time() - t0:.0f} s", flush=True)
    return dropped


def main(argv=None):
    p = argparse.ArgumentParser(prog="uinet.relabel")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("out")
    r.add_argument("src", nargs="+")
    r.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    r.add_argument("--worlds", type=int, default=16)
    r.add_argument("--rounds", type=int, default=1)
    r.add_argument("--transitions", type=int, default=10000)
    r.add_argument("--max-turn", type=int, default=5)
    r.add_argument("--z", type=float, default=2.0)
    r.add_argument("--top", type=int, default=3)
    r.add_argument("--max-hours", type=float)
    r.add_argument("--progress")
    m = sub.add_parser("merge")
    m.add_argument("out")
    m.add_argument("part")
    m.add_argument("src", nargs="+")
    m.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    a = p.parse_args(argv)
    from .gen import done_indices, read_episodes
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    src = [Path(x).resolve() for x in a.src]
    if a.cmd == "run":
        args = {k: getattr(a, k) for k in ("worlds", "rounds", "transitions", "max_turn", "z", "top")}
        meta = dict(args, commit=engine.project_commit(), src=[s.name for s in src],
                    started=time.strftime("%Y-%m-%d %H:%M:%S"))
        (out / "relabel.meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
        skip = {s.name.split(".")[0]: done_indices(out / s.name) for s in src}
        print(f"run: {len(src)} files, {sum(len(v) for v in skip.values())} episodes already done, "
              f"{a.workers} workers, {args}", flush=True)
        deadline = time.time() + a.max_hours * 3600 if a.max_hours else None
        progress = Path(a.progress).resolve() if a.progress else None
        with Pool(a.workers, initializer=_init, initargs=(args,)) as pool:
            _write_all(pool, _jobs(src, skip), out, progress, deadline)
        return 0
    part = Path(a.part).resolve()
    import zstandard
    cctx = zstandard.ZstdCompressor(level=10)
    with Pool(a.workers, initializer=_init, initargs=({},)) as pool:
        for s in src:
            shard = s.name.split(".")[0]
            have = {}
            if (part / s.name).exists():
                have = {ep["idx"]: json.dumps(ep, separators=(",", ":")) for ep in read_episodes(part / s.name)}
            jobs = ((shard, have.get(ep["idx"]) or json.dumps(ep, separators=(",", ":")), ep["idx"] in have)
                    for ep in read_episodes(s))
            n = n_part = n_rl = 0
            dropped = []
            with open(out / s.name, "wb") as fh:                 # the source's episode order, so training is unchanged
                for _shard, idx, line, rec in pool.imap(_merge_one, jobs, chunksize=4):
                    n += 1
                    if line is None:
                        dropped.append(idx)
                        continue
                    n_part += rec.get("from_part", 0)
                    n_rl += rec.get("relabeled", 0)
                    fh.write(cctx.compress((line + "\n").encode("utf-8")))
            print(f"{s.name}: {n} episodes, {n_part} from {part.name}/ ({n_rl} sharpened decisions), "
                  f"{n - n_part - len(dropped)} re-observed, {len(dropped)} dropped {sorted(dropped)[:20]}", flush=True)
    return 0


def _merge_one(job):
    shard, line, from_part = job
    if from_part:
        ep = json.loads(line)
        return shard, ep["idx"], line, {"from_part": 1, "relabeled": sum(1 for d in ep["decisions"] if "rl" in d)}
    return _one((shard, line))


if __name__ == "__main__":
    sys.exit(main())
