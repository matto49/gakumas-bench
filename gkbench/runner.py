"""跑分器：一个算法 × 一套题，逐题逐种子打完，写下每一步和终局。

输出 $GKBENCH_DATA/runs/<运行编号>/：
  run.json            gkbench.run.v2：这次运行的表头（algo、params、seconds / step_seconds、rules、machine、mode、by，
                      和审查存档 1.7 的算法表表头同名同义）+ 题集、引擎版本等
  episodes.jsonl.zst  每局一行 gkbench.episode.v2（字段见 docs/format.md；能直接转成审查存档里的一条答）
"""
from __future__ import annotations

import getpass
import io
import json
import platform
import random
import time
from datetime import datetime, timezone
from pathlib import Path

import zstandard

from . import engine, save
from .problems import DATA, load_set
from .referee import Referee

EPISODE_SCHEMA = "gkbench.episode.v2"
RUN_SCHEMA = "gkbench.run.v2"
MAX_DECISIONS = 300


def over_budget(step_ms: float, step_seconds) -> bool:
    """审查存档 1.7 f)：大于 step_seconds × 1200 + 50 毫秒算超时。"""
    return step_seconds is not None and step_ms > float(step_seconds) * 1200 + 50


class Ctx:
    """本机跑时给算法的 ctx，公开字段和托管时的 client.HostedCtx 一样：obs、budget、loadout、meta、rng、worlds(k)。
    裁判（知道种子和真实局面）放在 _ref 里，不是给算法用的；只有理论上限（privileged）和看种子的算法（sees_seed）额外拿到 seed、true_session。"""

    def __init__(self, ref, loadout, budget, rng, world_rng, algo, seed):
        self._ref = ref
        self.loadout, self.budget, self.rng = loadout, budget, rng
        self._world_rng = world_rng
        self.meta = ref.public_meta()
        self.obs = None
        self.worlds_made = 0
        if algo.privileged or getattr(algo, "sees_seed", False):
            self.seed = seed
            self.true_session = ref.battle.session

    def worlds(self, k):
        self.worlds_made += k
        return [self._ref.sample_world(self._world_rng) for _ in range(k)]


def run_header(algo, step_seconds, by=None) -> dict:
    """算法表的表头（审查存档表 6）。我们的算法对 GKMS 来说都是外部算法：external:<名字>。"""
    desc = algo.describe()
    params = {k: v for k, v in (desc.get("params") or {}).items() if v is not None}
    head = {"algo": f"external:{desc['name']}", "rules": int(engine.provenance()["rules_version"]),
            "machine": f"{platform.node()} {platform.machine()}", "mode": "internal" if algo.privileged else "self"}
    if params:
        head["params"] = params
    if algo.privileged and params.get("seconds"):
        head["seconds"] = params["seconds"]          # 理论上限按整局秒数给预算
    else:
        head["step_seconds"] = step_seconds
    if by:
        head["by"] = by
    return head


def episode_record(problem, seed_row, ref, steps, *, begin_s, wall_s, err, step_seconds):
    secs = sum(s["step_ms"] for s in steps) / 1000
    return {"schema": EPISODE_SCHEMA, "id": problem["id"], "family": problem["family"], "set": problem["set"],
            "name": problem.get("name"), "tags": problem.get("tags", {}),
            "fixed_id": seed_row.get("fixed_id"), "seed_index": int(seed_row["index"]),
            "seed_label": seed_row.get("label"), "seed_split": seed_row.get("split"),
            "exam_sha": save.seed_sha(seed_row["seed"]), "meta": ref.public_meta(),
            "route": " ".join(s["token"] for s in steps), "steps": steps,
            "final": {"score": ref.score, "finished": bool(ref.finished), "decisions": len(steps),
                      "turns": int(ref.numbers().get("turn") or 0), "begin_s": round(begin_s, 3),
                      "secs": round(secs, 3), "wall_s": round(wall_s, 3),
                      "over_steps": sum(1 for s in steps if s["over"])},
            "err": err, "at": save.now_ts()}


def play_episode(problem, seed_row, algo, budget, keep_obs=True):
    seed = int(seed_row["seed"])
    ref = Referee(problem["loadout"], seed)
    pid, si = problem["id"], int(seed_row["index"])
    # 世界采样的随机数只由题目和种子下标决定：不同算法在同一步拿到的世界相同（同题配对比较更准）
    ctx = Ctx(ref, ref.loadout_public, budget, random.Random(f"{pid}/{si}/algo"),
              random.Random(f"{pid}/{si}/worlds"), algo, seed)
    steps, err, begin_s = [], None, 0.0
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
            ms = (time.perf_counter() - t0) * 1000
            cpu = (time.process_time() - c0) * 1000
            res = ref.step(d.action)
            steps.append({"i": obs["i"], "turn": obs["exam"]["turn"], "token": save.token_of(d.action),
                          "action": list(d.action), "obs": obs if keep_obs else None, "algo_meta": d.meta,
                          "step_ms": round(ms, 2), "cpu_ms": round(cpu, 2), "worlds": ctx.worlds_made - w0,
                          "over": over_budget(ms, budget), "result": res, "private": priv})
    except Exception as e:                     # 算法出错：记下来，这局按当前分数结束
        err = f"{type(e).__name__}: {e}"
    return episode_record(problem, seed_row, ref, steps, begin_s=begin_s, wall_s=time.time() - t_start, err=err,
                          step_seconds=budget)


def run(set_name, algo, budget=5.0, seed_indices=None, only=None, label=None, keep_obs=True, out_root=None,
        progress=None, by=None, template=False):
    """template=True：在题模板的固定保密种子上跑（只给理论上限这类内部运行用，种子要在本机 private/ 里）"""
    progress = progress or (lambda m: print(m, flush=True))
    probs = load_set(set_name, only, template=template)
    engine.setup()
    desc = algo.describe()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_id = f"{stamp}-{set_name}-{'template-' if template else ''}{label or desc['name']}"
    out = Path(out_root or DATA / "runs") / run_id
    out.mkdir(parents=True, exist_ok=True)
    info = {"schema": RUN_SCHEMA, "run": run_id, "label": label or desc["name"], "set": set_name,
            "kind": "template" if template else "fixed",
            **run_header(algo, budget, by or getpass.getuser()), "privileged": bool(algo.privileged),
            "sees_seed": bool(getattr(algo, "sees_seed", False)),
            "seed_indices": seed_indices, "only": only, "engine": engine.provenance(),
            "started": datetime.now(timezone.utc).isoformat()}
    if template:
        from .problems import TEMPLATE_SEEDS_VERSION
        info.update(template_seeds=TEMPLATE_SEEDS_VERSION, seeds_per_problem=max(len(s) for _, s in probs))
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
                progress(f"{p['name']} #{row['index']}  {f['score']:>10,}  决策 {f['decisions']:>3}  "
                         f"思考 {f['secs']:7.2f}s" + (f"  错误 {ep['err']}" if ep["err"] else ""))
        tw.close()
    info.update(finished=datetime.now(timezone.utc).isoformat(), episodes=n,
                mean_score=round(total / n) if n else None)
    (out / "run.json").write_text(json.dumps(info, ensure_ascii=False, indent=1))
    return out


def read_episodes(run_dir):
    p = Path(run_dir) / "episodes.jsonl.zst"
    with open(p, "rb") as fh:
        r = zstandard.ZstdDecompressor().stream_reader(fh, read_across_frames=True)   # 托管运行是逐局追加的多帧文件
        for line in io.TextIOWrapper(r, encoding="utf-8"):
            if line.strip():
                yield json.loads(line)


# ---------------------------------------------------------------- 和审查存档互转
def answer_of(ep: dict, info: dict, *, template: bool, reveal_seed=None) -> dict:
    """一局 → 审查存档里的一条答（表头 + 列）。template=True 时写 exam / exam_sha（1.7 g)）。"""
    from .save import HEADER
    a = {k: info[k] for k in HEADER if info.get(k) is not None}
    f = ep["final"]
    a.update(score=f["score"], secs=f.get("secs"), at=ep.get("at") or save.now_ts(), route=ep["route"],
             step_ms=[max(0, int(round(s["step_ms"]))) for s in ep["steps"]])
    if ep.get("err"):
        a["err"] = ep["err"]
    elif not f["finished"]:
        a["err"] = "路线没有走完这场审查"
    if template:
        if reveal_seed is not None:
            a["exam"] = int(reveal_seed)
        else:
            a["exam_sha"] = ep["exam_sha"]
    return a
