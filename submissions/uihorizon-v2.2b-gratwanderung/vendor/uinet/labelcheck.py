"""Are old teacher labels still right on the current engine?  (SX-04-19, before they train a v2 network.)

    python -B -m uinet.labelcheck OUT.json LABELS.jsonl.zst [...] [--per-stratum 250] [--workers W]
        [--worlds 16] [--transitions 10000] [--seed 0]

uinet.reobserve checks that a stored episode still replays (its observations rebuilt by the current code); it keeps
the stored per-world values q, computed by the engine of the labelling run.  This draws decisions from label files,
stratified by archetype (the idol card's, uinet.loadouts.archetype) and by whether the decision shows anything only
UIObs v2 has (a reserved effect, a card-cost change, a play-count buff: "v2" vs "v1"), the same number from each
stratum (sha1 of shard / episode / decision, so reruns draw the same), replays each to its decision and lets teacher T
(mode "ui") score it twice with independent world draws.  Per stratum:

  regret_old    1 - m1[best of the stored q] / max m1      (m = an action's mean over worlds; m1 the first rerun)
  regret_noise  1 - m1[best of the second rerun] / max m1  (what T's own world draw costs: the floor)
  agree_old     the stored best equals the first rerun's best

Rule, fixed here before any run: a stratum keeps its old labels when regret_old <= regret_noise + 0.005 or
regret_old <= 1.5 x regret_noise; otherwise it is flagged, and an archetype with a flagged stratum is listed in
"skip" -- uinet.train --skip T:<archetype> leaves those old episodes out.  OUT holds every stratum's numbers,
the decisions drawn, and the verdicts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sys
import time
from collections import defaultdict
from multiprocessing import Pool
from pathlib import Path

from . import engine


def _init():
    engine.setup()


def _shows_v2(o):
    return bool(o.get("timers") or o.get("costs") or o.get("pcount"))


def _job(job):
    from .env import Battle
    from .teacher import Teacher
    lo, actions, worlds, trans, seed = job["loadout"], job["actions"], job["worlds"], job["trans"], job["seed"]
    b = Battle(lo)
    for a in actions:
        while not b.finished and len(b.legal()) == 1:
            b.step(b.legal()[0])
        b.step(b.legal()[a])
    while not b.finished and len(b.legal()) == 1:
        b.step(b.legal()[0])
    if b.finished:
        return None
    t = Teacher(worlds=worlds, transitions=trans, mode="ui")
    legal = b.legal()
    if len(legal) != len(job["q0"]):
        return {**job["key"], "error": f"{len(legal)} legal actions, the label has {len(job['q0'])}"}
    out = []
    for r in range(2):
        _l, vals = t.values(b.session, random.Random(f"{seed}/{job['key']['id']}/{r}"), legal)
        out.append([sum(v) / len(v) for v in vals])
    m0 = [sum(v) / len(v) for v in job["q0"]]
    best0 = max(range(len(m0)), key=m0.__getitem__)
    m1, m2 = out
    top1 = max(m1) or 1.0
    best2 = max(range(len(m2)), key=m2.__getitem__)
    best1 = max(range(len(m1)), key=m1.__getitem__)
    return {**job["key"], "regret_old": 1.0 - m1[best0] / top1, "regret_noise": 1.0 - m1[best2] / top1,
            "agree_old": int(best0 == best1), "agree_noise": int(best2 == best1), "n_actions": len(legal)}


def draw(paths, per_stratum, seed=0):
    """The decisions to check: per (archetype, v1 / v2) stratum, the PER_STRATUM with the lowest sha1."""
    from .gen import read_episodes
    from .loadouts import archetype
    cand = defaultdict(list)
    for path in paths:
        shard = Path(path).name.split(".")[0]
        for ep in read_episodes(path):
            arch = archetype(ep["loadout"]["idol_card_id"])
            for i, d in enumerate(ep["decisions"]):
                h = hashlib.sha1(f"{seed}/{shard}/{ep['idx']}/{i}".encode()).hexdigest()
                st = (arch, "v2" if _shows_v2(d["obs"]) else "v1")
                cand[st].append((h, shard, ep, i))
            # keep memory bounded: only the lowest hashes of each stratum survive
            for st in list(cand):
                if len(cand[st]) > 4 * per_stratum:
                    cand[st] = sorted(cand[st], key=lambda x: x[0])[:per_stratum]
    jobs = []
    for st, xs in sorted(cand.items()):
        for h, shard, ep, i in sorted(xs, key=lambda x: x[0])[:per_stratum]:
            jobs.append({"key": {"id": h[:16], "shard": shard, "ep": ep["idx"], "decision": i, "arch": st[0],
                                 "shows": st[1]},
                         "loadout": ep["loadout"], "actions": [d["a"] for d in ep["decisions"][:i]],
                         "q0": ep["decisions"][i]["q"]})
    return jobs


def verdicts(rows):
    by = defaultdict(list)
    for r in rows:
        if r and "error" not in r:
            by[(r["arch"], r["shows"])].append(r)
    strata, skip = {}, set()
    for (arch, shows), rs in sorted(by.items()):
        n = len(rs)
        old = sum(r["regret_old"] for r in rs) / n
        noise = sum(r["regret_noise"] for r in rs) / n
        keep = old <= noise + 0.005 or old <= 1.5 * noise
        strata[f"{arch} {shows}"] = {"n": n, "regret_old": round(old, 5), "regret_noise": round(noise, 5),
                                     "agree_old": round(sum(r["agree_old"] for r in rs) / n, 4),
                                     "agree_noise": round(sum(r["agree_noise"] for r in rs) / n, 4),
                                     "keep": keep}
        if not keep:
            skip.add(arch)
    return strata, sorted(skip)


def main(argv=None):
    p = argparse.ArgumentParser(prog="uinet.labelcheck")
    p.add_argument("out")
    p.add_argument("labels", nargs="+")
    p.add_argument("--per-stratum", type=int, default=250)
    p.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    p.add_argument("--worlds", type=int, default=16)
    p.add_argument("--transitions", type=int, default=10000)
    p.add_argument("--seed", type=int, default=0)
    a = p.parse_args(argv)
    out = Path(a.out).resolve()
    labels = [str(Path(x).resolve()) for x in a.labels]
    engine.setup()
    t0 = time.time()
    jobs = draw(labels, a.per_stratum, a.seed)
    for j in jobs:
        j.update(worlds=a.worlds, trans=a.transitions, seed=a.seed)
    print(f"{len(jobs)} decisions drawn in {time.time() - t0:.0f} s", flush=True)
    rows = []
    with Pool(a.workers, initializer=_init) as pool:
        for r in pool.imap_unordered(_job, jobs, chunksize=2):
            rows.append(r)
    strata, skip = verdicts(rows)
    doc = {"labels": labels, "commit": engine.project_commit(), "per_stratum": a.per_stratum, "worlds": a.worlds,
           "transitions": a.transitions, "seconds": round(time.time() - t0), "strata": strata, "skip": skip,
           "errors": [r for r in rows if r and "error" in r][:50], "rows": [r for r in rows if r]}
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    for k, v in strata.items():
        print(k, json.dumps(v))
    print("skip:", skip)


if __name__ == "__main__":
    sys.exit(main())
