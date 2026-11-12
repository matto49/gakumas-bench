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
        raise SystemExit(f"没有令牌：登录 {SERVER}/me （GitHub 或注册账号），在「命令行令牌」里生成一个，存到 {TOKEN_FILE}（或设 GKBENCH_TOKEN）")
    return httpx.Client(base_url=(server or SERVER), headers={"Authorization": f"Bearer {tok}"}, timeout=600)


TEMPLATE_SEEDS = 32


def scope_from(cfg, seeds=None, full=False, only=None):
    """一次评测跑哪些题、每题前几个保密牌序，和服务器 evalScope 一致：
    缺省按集合的核心题单（core × core_seeds）；full 时全部题 × 32；给了 only 时按 only 筛题、牌序数照核心；
    seeds 只能往少里调。返回 (牌序下标列表, only 列表或 None)。"""
    core = None if full else (cfg.get("core") or None)
    n = TEMPLATE_SEEDS if full or not core else min(TEMPLATE_SEEDS, cfg.get("core_seeds") or TEMPLATE_SEEDS)
    if seeds and 0 < seeds < n:
        n = seeds
    return list(range(n)), (list(only) if only else core)


def set_scope(set_name, seeds=None, full=False, only=None, server=None):
    """向服务器要集合配置（公开接口，不要令牌），换算成本机跑的 (牌序下标, only)。"""
    r = httpx.get(f"{server or SERVER}/api/sets", timeout=60)
    r.raise_for_status()
    cfg = next((x for x in r.json() if x.get("set") == set_name), None) or {"set": set_name}
    return scope_from(cfg, seeds, full, only)


# 服务器一次最多收这么多局（server/uploadcap.go）；多了按题分批，几批在排行里按算法合成一行
MAX_UPLOAD_EPISODES = 1000


def split_by_problem(eps, limit=MAX_UPLOAD_EPISODES):
    """按题切成每批不超过 limit 局；同一道题的局放在同一批（一道题本身超过 limit 时单独一批）。"""
    groups: dict[str, list] = {}
    for e in eps:
        groups.setdefault(str(e.get("id")), []).append(e)
    chunks, cur = [], []
    for lst in groups.values():
        if cur and len(cur) + len(lst) > limit:
            chunks.append(cur)
            cur = []
        cur.extend(lst)
    if cur:
        chunks.append(cur)
    return chunks


def upload(run_dir, server=None):
    """上传一次运行。局数超过服务器上限时自动按题分批，每批是一次单独的运行（名字加 -p1、-p2…）。"""
    import io
    import json

    import zstandard

    from .runner import read_episodes
    d = Path(run_dir)
    eps = list(read_episodes(d))
    if len(eps) <= MAX_UPLOAD_EPISODES:
        return _upload_one((d / "run.json").read_bytes(), (d / "episodes.jsonl.zst").read_bytes(), server)
    info = json.loads((d / "run.json").read_text())
    chunks = split_by_problem(eps)
    out = {"status": "done", "accepted": 0, "rejected": [], "runs": []}
    for i, chunk in enumerate(chunks, 1):
        part = dict(info, run=f"{info['run']}-p{i}", episodes=len(chunk))
        buf = io.BytesIO()
        with zstandard.ZstdCompressor(level=6).stream_writer(buf, closefd=False) as w:
            for e in chunk:
                w.write((json.dumps(e, ensure_ascii=False) + "\n").encode())
        print(f"  分批上传 {i}/{len(chunks)}：{len(chunk)} 局", flush=True)
        j = _upload_one(json.dumps(part, ensure_ascii=False).encode(), buf.getvalue(), server)
        out["accepted"] += j.get("accepted", 0)
        out["rejected"] += j.get("rejected") or []
        out["runs"].append(j.get("run"))
    out["run"] = ", ".join(str(r) for r in out["runs"])
    return out


def _upload_one(run_json: bytes, episodes_zst: bytes, server=None):
    with _client(server) as c:
        r = c.post("/api/runs", files={"run_json": ("run.json", run_json, "application/json"),
                                       "episodes": ("episodes.jsonl.zst", episodes_zst, "application/zstd")})
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
        from . import engine
        from .worlds import import_world
        engine.setup()                          # 导入世界要本机的 GKMS（只在算法真的要世界时）
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
    if getattr(algo, "needs_gkms", False):
        engine.setup()
    progress = progress or (lambda m: print(m, flush=True))
    desc = algo.describe()
    label = label or desc["name"]
    if algo.privileged or getattr(algo, "sees_seed", False):
        raise SystemExit("理论上限和看牌序的算法（官方 AI）不能托管跑：托管时服务器不给牌序")
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
                                                      "params": desc.get("params"),
                                                      "about": getattr(algo, "about", None)}).raise_for_status().json()
                f = _play(c, start, algo, budget, random.Random(f"{p['id']}/{srow['index']}/algo"))
                progress(f"{p.get('name', p['id'])} #{srow['index']}  {f['score']:>10,}  决策 {f['decisions']:>3}  服务器计时 {f['secs']:7.2f}s")


def evaluate(set_name, algo_spec, seeds=None, parallel=3, budget=5.0, label=None, only=None, resume=None, server=None,
             progress=None, full=False):
    """题模板评测：每道题打服务器上那组固定的保密种子，算法托管跑、看不到种子。
    缺省按集合的核心题单（服务器定：哪些题、每题前几个牌序）；full=True 跑全部题 × 32；seeds 只能往少里调。
    parallel 局同时跑，每个线程一个算法实例。
    resume 给评测编号时接着跑没打完的格子。"""
    import threading
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from . import algos, engine
    progress = progress or (lambda m: print(m, flush=True))
    probe = algos.make(algo_spec)
    if getattr(probe, "needs_gkms", False):
        engine.setup()                          # 贪心、PIMC、UINet 等要用本地的 GKMS；只看观测的算法不加载
    if probe.privileged or getattr(probe, "sees_seed", False):
        raise SystemExit("理论上限和看牌序的算法（官方 AI）不能托管跑；管理员在本机跑（有保密牌序时 gkbench eval 会自动在本机跑）")
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
                                           "about": getattr(probe, "about", None), "seeds": seeds or 0, "only": only or [],
                                           "full": bool(full)})
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


def upload_problems(set_name, paths=(), server=None, new_title=None):
    """往試験集合传考试：题模板 / 固定种子题的 .gksave.json（或 JSON Lines）。
    new_title 给了就先建一个自己的社区集合，再往里传。返回上传任务的结果（added / rejected）。"""
    with _client(server) as c:
        if new_title:
            r = c.post("/api/sets", json={"title": new_title})
            if r.status_code >= 400:
                raise SystemExit(f"建集合失败 {r.status_code}：{r.text[:500]}")
            set_name = r.json()["set"]
        files = [("files", (Path(p).name, Path(p).read_bytes(), "application/json")) for p in paths]
        r = c.post(f"/api/sets/{set_name}/problems", files=files)
        if r.status_code >= 400:
            raise SystemExit(f"上传失败 {r.status_code}：{r.text[:2000]}")
        j = r.json()
        while j["status"] in ("queued", "running"):
            time.sleep(1.5)
            j = c.get(f"/api/jobs/{j['job']}").raise_for_status().json()
    j["set"] = set_name
    return j


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
