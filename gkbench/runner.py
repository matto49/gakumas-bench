"""跑分器：一个算法 × 一套题，逐题逐种子打完，写下每一步和终局。

输出 $GKBENCH_DATA/runs/<运行编号>/：
  run.json            这次运行：算法、参数、预算、题集、引擎版本、机器
  episodes.jsonl.zst  每局一行 gkbench.episode.v1（格式见 docs/format.md）
"""
from __future__ import annotations

import io
import json
import platform
import random
import time
from datetime import datetime, timezone
from pathlib import Path

import zstandard

from . import engine
from .problems import DATA, load_set, seed_sha
from .referee import Referee

EPISODE_SCHEMA = "gkbench.episode.v1"
RUN_SCHEMA = "gkbench.run.v1"
MAX_DECISIONS = 300


class Ctx:
    def __init__(self, ref, loadout, budget, rng, world_rng, algo, seed):
        self.ref, self.loadout, self.budget, self.rng = ref, loadout, budget, rng
        self._world_rng = world_rng
        self.meta = ref.public_meta()
        self.obs = None
        self.worlds_made = 0
        if algo.privileged:
            self.seed = seed
            self.true_session = ref.battle.session

    def worlds(self, k):
        self.worlds_made += k
        return [self.ref.sample_world(self._world_rng) for _ in range(k)]


def play_episode(problem, seed_row, algo, budget, keep_obs=True):
    seed = int(seed_row["seed"])
    ref = Referee(problem["loadout"], seed)
    pid, si = problem["id"], int(seed_row["index"])
    # 世界采样的随机数只由题目和种子下标决定：不同算法在同一步拿到的世界相同（同题配对比较更准）
    ctx = Ctx(ref, ref.loadout_public, budget, random.Random(f"{pid}/{si}/algo"),
              random.Random(f"{pid}/{si}/worlds"), algo, seed)
    steps, err = [], None
    t_start = time.time()
    try:
        ctx.obs = ref.obs()
        t = time.perf_counter()
        algo.begin(ctx)
        begin_s = time.perf_counter() - t
        while not ref.finished and ref.decisions < MAX_DECISIONS:
            obs = ref.obs()
            ctx.obs = obs
            priv = ref.private_state()
            w0 = ctx.worlds_made
            t0, c0 = time.perf_counter(), time.process_time()
            d = algo.decide(ctx)
            think = time.perf_counter() - t0
            cpu = time.process_time() - c0
            res = ref.step(d.action)
            steps.append({"i": obs["i"], "turn": obs["exam"]["turn"], "obs": obs if keep_obs else None,
                          "action": list(d.action), "algo_meta": d.meta,
                          "think_ms": round(think * 1000, 2), "cpu_ms": round(cpu * 1000, 2),
                          "worlds": ctx.worlds_made - w0, "over_budget": think > budget * 1.2 + 0.05,
                          "result": res, "private": priv})
    except Exception as e:                     # 算法出错：记下来，这局按当前分数结束
        err = f"{type(e).__name__}: {e}"
        begin_s = locals().get("begin_s", 0.0)
    think_total = sum(s["think_ms"] for s in steps) / 1000
    return {"schema": EPISODE_SCHEMA, "problem": pid, "set": problem["set"], "tags": problem.get("tags", {}),
            "seed_index": si, "seed_label": seed_row.get("label"), "seed_split": seed_row.get("split"),
            "seed_sha": seed_sha(seed), "meta": ref.public_meta(), "steps": steps,
            "final": {"score": ref.score, "finished": ref.finished, "decisions": len(steps),
                      "turns": int(ref.numbers().get("turn") or 0), "begin_s": round(begin_s, 3),
                      "think_s": round(think_total, 3), "wall_s": round(time.time() - t_start, 3),
                      "over_budget_steps": sum(1 for s in steps if s["over_budget"])},
            "error": err}


def run(set_name, algo, budget=5.0, seed_indices=None, only=None, label=None, keep_obs=True, out_root=None,
        progress=None):
    progress = progress or (lambda m: print(m, flush=True))
    probs = load_set(set_name, only)
    engine.setup()
    desc = algo.describe()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_id = f"{stamp}-{set_name}-{label or desc['name']}"
    out = Path(out_root or DATA / "runs") / run_id
    out.mkdir(parents=True, exist_ok=True)
    info = {"schema": RUN_SCHEMA, "run": run_id, "label": label or desc["name"], "algo": desc, "set": set_name,
            "budget_s": budget, "seed_indices": seed_indices, "only": only, "engine": engine.provenance(),
            "machine": {"host": platform.node(), "system": platform.platform(), "python": platform.python_version()},
            "started": datetime.now(timezone.utc).isoformat()}
    (out / "run.json").write_text(json.dumps(info, ensure_ascii=False, indent=1))
    n, total = 0, 0
    with open(out / "episodes.jsonl.zst", "wb") as fh:
        w = zstandard.ZstdCompressor(level=6).stream_writer(fh)
        tw = io.TextIOWrapper(w, encoding="utf-8")
        for p, seeds in probs:
            for row in seeds:
                if seed_indices is not None and int(row["index"]) not in seed_indices:
                    continue
                ep = play_episode(p, row, algo, budget, keep_obs)
                ep["run"] = run_id
                tw.write(json.dumps(ep, ensure_ascii=False) + "\n")
                tw.flush()
                n += 1
                total += ep["final"]["score"]
                f = ep["final"]
                progress(f"{p['id']} #{row['index']}  {f['score']:>10,}  决策 {f['decisions']:>3}  "
                         f"思考 {f['think_s']:7.2f}s" + (f"  错误 {ep['error']}" if ep["error"] else ""))
        tw.close()
    info.update(finished=datetime.now(timezone.utc).isoformat(), episodes=n,
                mean_score=round(total / n) if n else None)
    (out / "run.json").write_text(json.dumps(info, ensure_ascii=False, indent=1))
    return out


def read_episodes(run_dir):
    p = Path(run_dir) / "episodes.jsonl.zst"
    with open(p, "rb") as fh:
        r = zstandard.ZstdDecompressor().stream_reader(fh)
        for line in io.TextIOWrapper(r, encoding="utf-8"):
            if line.strip():
                yield json.loads(line)
