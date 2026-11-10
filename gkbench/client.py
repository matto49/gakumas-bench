"""客户端：把本地运行上传到服务器；或者托管跑（种子留在服务器，每一步交动作）。

  GKBENCH_SERVER   服务器地址，默认 https://hiro.matto.top/gkbench
  GKBENCH_TOKEN    令牌；不设时读 ~/.config/gkbench/token
"""
from __future__ import annotations

import os
import random
import time
from pathlib import Path

import httpx

SERVER = os.environ.get("GKBENCH_SERVER", "https://hiro.matto.top/gkbench").rstrip("/")
TOKEN_FILE = Path(os.environ.get("GKBENCH_TOKEN_FILE", Path.home() / ".config/gkbench/token")).expanduser()


def _client(server=None):
    tok = os.environ.get("GKBENCH_TOKEN") or (TOKEN_FILE.read_text().strip() if TOKEN_FILE.is_file() else None)
    if not tok:
        raise SystemExit(f"没有令牌：设 GKBENCH_TOKEN 或写到 {TOKEN_FILE}")
    return httpx.Client(base_url=(server or SERVER), headers={"Authorization": f"Bearer {tok}"}, timeout=600)


def upload(run_dir, server=None):
    d = Path(run_dir)
    with _client(server) as c:
        r = c.post("/api/runs", files={"run_json": ("run.json", (d / "run.json").read_bytes(), "application/json"),
                                       "episodes": ("episodes.jsonl.zst", (d / "episodes.jsonl.zst").read_bytes(),
                                                    "application/zstd")})
        if r.status_code >= 400:
            raise SystemExit(f"上传失败 {r.status_code}：{r.text[:2000]}")
        j = r.json()
        last = -1
        while j["status"] in ("queued", "running"):
            time.sleep(2)
            j = c.get(f"/api/jobs/{j['job']}").raise_for_status().json()
            if j["done"] != last and j.get("total"):
                print(f"  核对 {j['done']}/{j['total']}", end="\r", flush=True)
                last = j["done"]
    if j["status"] == "error":
        raise SystemExit(f"服务器核对出错：{j.get('error')}")
    if j["status"] == "rejected":
        raise SystemExit(f"全部拒收：{j['rejected'][:5]}")
    return j


class HostedCtx:
    """托管模式下给算法的 ctx：观测、预算、开局配置和公开信息。种子和完整局面都在服务器上；
    要世界（PIMC 等）时向服务器要，服务器重抽隐藏信息后发过来，在本地导入。"""

    def __init__(self, c, eid, obs, budget, loadout, meta, rng):
        self._c, self._eid = c, eid
        self.obs, self.budget, self.loadout, self.meta, self.rng = obs, budget, loadout, meta, rng
        self.worlds_made = 0

    def worlds(self, k):
        import base64
        from .worlds import import_world
        r = self._c.post(f"/api/episodes/{self._eid}/worlds", json={"k": int(k)})
        if r.status_code >= 400:
            raise RuntimeError(f"要世界失败 {r.status_code}：{r.text[:300]}")
        self.worlds_made += k
        return [import_world(base64.b64decode(b)) for b in r.json()["worlds"]]


def _play(c, start, algo, budget, rng):
    """托管跑完一局：start 是开局回复（episode、obs、meta、loadout）。返回服务器给的 final。"""
    eid = start["episode"]
    try:
        return _play_steps(c, eid, start, algo, budget, rng)
    except BaseException:
        try:                                    # 出错就告诉服务器结束这局，别占着托管名额
            c.delete(f"/api/episodes/{eid}")
        except Exception:
            pass
        raise


def _play_steps(c, eid, start, algo, budget, rng):
    ctx = HostedCtx(c, eid, start["obs"], budget, start["loadout"], start["meta"], rng)
    algo.begin(ctx)
    while True:
        t = time.perf_counter()
        d = algo.decide(ctx)
        think = (time.perf_counter() - t) * 1000
        r = c.post(f"/api/episodes/{eid}/step", json={"action": list(d.action), "client_ms": round(think, 2), "meta": d.meta})
        if r.status_code >= 400:
            raise RuntimeError(f"交动作失败 {r.status_code}：{r.text[:300]}")
        s = r.json()
        if s["done"]:
            return s["final"]
        ctx.obs = s["obs"]


def hosted(set_name, algo, budget=5.0, label=None, seed_indices=None, only=None, server=None, progress=None):
    """固定种子托管跑：题集里的种子，种子不离开服务器。"""
    from . import engine
    engine.setup()
    progress = progress or (lambda m: print(m, flush=True))
    desc = algo.describe()
    label = label or desc["name"]
    if algo.privileged:
        raise SystemExit("特权算法（理论上限）不能托管跑")
    with _client(server) as c:
        probs = c.get(f"/api/sets/{set_name}/problems").raise_for_status().json()
        for p in probs:
            if only and not any(o in p["id"] or o in p.get("name", "") for o in only):
                continue
            for srow in p["seeds"]:
                if seed_indices is not None and srow["index"] not in seed_indices:
                    continue
                start = c.post("/api/episodes", json={"set": set_name, "id": p["id"], "seed_index": srow["index"],
                                                      "label": label, "step_seconds": budget, "algo": f"external:{desc['name']}",
                                                      "params": desc.get("params")}).raise_for_status().json()
                f = _play(c, start, algo, budget, random.Random(f"{p['id']}/{srow['index']}/algo"))
                progress(f"{p.get('name', p['id'])} #{srow['index']}  {f['score']:>10,}  决策 {f['decisions']:>3}  服务器计时 {f['secs']:7.2f}s")


def evaluate(set_name, algo_spec, seeds=32, parallel=3, budget=5.0, label=None, only=None, resume=None, server=None,
             progress=None):
    """题模板评测：每道题打服务器上那组固定的保密种子（共 32 个，seeds 只取前几个），算法托管跑、看不到种子。
    parallel 局同时跑，每个线程一个算法实例。
    resume 给评测编号时接着跑没打完的格子。"""
    import threading
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from . import algos, engine
    engine.setup()                              # 贪心、PIMC 等要用本地的 GKMS 代码
    progress = progress or (lambda m: print(m, flush=True))
    probe = algos.make(algo_spec)
    if probe.privileged:
        raise SystemExit("特权算法（理论上限）不能托管跑；管理员用 gkbench run --template 在本机跑")
    desc = probe.describe()
    label = label or desc["name"]
    with _client(server) as c:
        if resume:
            st = c.get(f"/api/evals/{resume}").raise_for_status().json()
            ev, run, n = resume, st["run"], st["seeds_per_problem"]
            done = {(d["id"], d["slot"]) for d in st["done"]}
            probs = c.get(f"/api/sets/{st['set']}/problems").raise_for_status().json()
            slots = [{"id": p["id"], "slot": i} for p in probs for i in range(n)
                     if (p["id"], i) not in done and (not only or any(o in p["id"] or o in p.get("name", "") for o in only))]
            set_name = st["set"]
        else:
            r = c.post("/api/evals", json={"set": set_name, "label": label, "step_seconds": budget,
                                           "algo": f"external:{desc['name']}", "params": desc.get("params"),
                                           "seeds": seeds, "only": only or []})
            if r.status_code >= 400:
                raise SystemExit(f"开评测失败 {r.status_code}：{r.text[:500]}")
            j = r.json()
            ev, run, n, slots = j["eval"], j["run"], j["seeds_per_problem"], j["slots"]
    progress(f"评测 {ev}（运行 {run}）：{len(slots)} 局待跑，每题 {n} 个固定保密种子，并行 {parallel}。中断后用 --resume {ev} 接着跑")
    local = threading.local()

    def worker(slot):
        if not hasattr(local, "algo"):                    # 每个线程一个算法实例、一个连接
            local.algo = algos.make(algo_spec)
            local.c = _client(server)
        c = local.c
        r = c.post(f"/api/evals/{ev}/episodes", json=slot)
        if r.status_code >= 400:
            raise RuntimeError(f"开局失败 {r.status_code}：{r.text[:300]}")
        return slot, _play(c, r.json(), local.algo, budget, random.Random(f"{slot['id']}/{slot['slot']}/algo"))

    ok, failed, streak, total = 0, 0, 0, 0.0
    t0 = time.time()
    stop = threading.Event()

    def guarded(slot):
        if stop.is_set():
            return None
        return worker(slot)

    with ThreadPoolExecutor(max(1, int(parallel))) as pool:
        futs = [pool.submit(guarded, s) for s in slots]
        for f in as_completed(futs):
            try:
                res = f.result()
                if res is None:
                    continue
                slot, fin = res
                streak = 0
                ok += 1
                total += fin["score"]
                if ok % max(1, len(slots) // 40) == 0 or ok == len(slots):
                    rate = ok / max(1e-9, time.time() - t0)
                    progress(f"  {ok}/{len(slots)} 局 · 均分 {total / ok:,.0f} · {rate * 60:.1f} 局/分")
            except Exception as e:
                failed += 1
                streak += 1
                progress(f"  出错：{e}")
                if streak >= 10 and not stop.is_set():
                    stop.set()
                    progress(f"  连续出错 {streak} 局，停下。修好后用 --resume {ev} 接着跑")
    progress(f"完成：{ok} 局，出错 {failed} 局。排行看「题模板」；没跑完的用 --resume {ev}")
    return {"eval": ev, "run": run, "ok": ok, "failed": failed}


def upload_saves(paths, server=None, label=None):
    """把审查存档（.gksave.json 或 JSON Lines）里的答交给服务器：服务器按编号找到题和种子，重放每条路线，
    生成完整的逐步记录。固定种子题的答直接用编成里的种子；题模板的答要带 exam（明文种子）。"""
    files = [("saves", (Path(p).name, Path(p).read_bytes(), "application/json")) for p in paths]
    with _client(server) as c:
        r = c.post("/api/saves", files=files, data={"label": label or ""})
        if r.status_code >= 400:
            raise SystemExit(f"上传失败 {r.status_code}：{r.text[:2000]}")
        j = r.json()
        while j["status"] in ("queued", "running"):
            time.sleep(2)
            j = c.get(f"/api/jobs/{j['job']}").raise_for_status().json()
    if j["status"] in ("error", "rejected"):
        raise SystemExit(f"服务器没收：{j.get('error') or j['rejected'][:5]}")
    return j
