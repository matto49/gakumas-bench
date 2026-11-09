"""客户端：把本地运行上传到服务器；或者托管跑（种子留在服务器，每一步交动作）。

  GKBENCH_SERVER   服务器地址，默认 https://api.matto.top/gkbench
  GKBENCH_TOKEN    令牌；不设时读 ~/.config/gkbench/token
"""
from __future__ import annotations

import os
import random
import time
from pathlib import Path

import httpx

SERVER = os.environ.get("GKBENCH_SERVER", "https://api.matto.top/gkbench").rstrip("/")
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
    """托管模式下给算法的 ctx：只有观测、预算、开局配置和公开信息，没有世界采样（种子和完整局面都在服务器上）。"""

    def __init__(self, obs, budget, loadout, meta, rng):
        self.obs, self.budget, self.loadout, self.meta, self.rng = obs, budget, loadout, meta, rng

    def worlds(self, k):
        raise NotImplementedError("托管模式还不支持世界采样；需要采样的算法先用本地跑 + 上传")


def hosted(set_name, algo, budget=5.0, label=None, seed_indices=None, only=None, server=None, progress=None):
    progress = progress or (lambda m: print(m, flush=True))
    desc = algo.describe()
    label = label or desc["name"]
    if algo.privileged:
        raise SystemExit("特权算法（理论上限）不能托管跑")
    with _client(server) as c:
        probs = c.get(f"/api/sets/{set_name}/problems").raise_for_status().json()
        for p in probs:
            if only and not any(o in p["id"] for o in only):
                continue
            for srow in p["seeds"]:
                if seed_indices is not None and srow["index"] not in seed_indices:
                    continue
                r = c.post("/api/episodes", json={"set": set_name, "problem": p["id"], "seed_index": srow["index"],
                                                  "label": label, "budget": budget,
                                                  "params": desc.get("params")}).raise_for_status().json()
                eid = r["episode"]
                ctx = HostedCtx(r["obs"], budget, r["loadout"], r["meta"],
                                random.Random(f"{p['id']}/{srow['index']}/algo"))
                algo.begin(ctx)
                while True:
                    t = time.perf_counter()
                    d = algo.decide(ctx)
                    think = (time.perf_counter() - t) * 1000
                    s = c.post(f"/api/episodes/{eid}/step", json={"action": list(d.action), "think_ms": round(think, 2),
                                                                  "meta": d.meta}).raise_for_status().json()
                    if s["done"]:
                        f = s["final"]
                        progress(f"{p['id']} #{srow['index']}  {f['score']:>10,}  决策 {f['decisions']:>3}  "
                                 f"服务器计时 {f['think_s']:7.2f}s")
                        break
                    ctx.obs = s["obs"]
