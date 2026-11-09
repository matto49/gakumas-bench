"""汇总：多次运行放在一起比。

- 每个算法：局数、平均分、相对理论上限（同题同种子的 oracle 局）的比值、每步耗时、超时步数、出错局数
- 配对比较：对基准算法，同题同种子的分数比，报几何平均、标准误、胜率
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

from .runner import read_episodes


def _pct(xs, q):
    if not xs:
        return None
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * (len(xs) - 1) + 0.5))]


def load(run_dirs):
    runs = []
    for d in run_dirs:
        d = Path(d)
        info = json.loads((d / "run.json").read_text())
        eps = {(e["problem"], e["seed_index"]): e for e in read_episodes(d)}
        runs.append((info, eps))
    return runs


def _ratio_stats(pairs):
    """pairs: [(a, b)]，返回 a/b 的几何平均、对数比的标准误换算、a 胜率。"""
    logs = [math.log(a / b) for a, b in pairs if a > 0 and b > 0]
    if not logs:
        return None
    m = sum(logs) / len(logs)
    se = (math.sqrt(sum((x - m) ** 2 for x in logs) / (len(logs) - 1)) / math.sqrt(len(logs))) if len(logs) > 1 else 0.0
    wins = sum(1 for a, b in pairs if a > b) + 0.5 * sum(1 for a, b in pairs if a == b)
    return {"n": len(logs), "geo": math.exp(m), "se": math.exp(m) * se, "win": wins / len(pairs)}


def summarize(run_dirs, base=None):
    runs = load(run_dirs)
    oracle = {}
    for info, eps in runs:
        if info["algo"].get("privileged"):
            for k, e in eps.items():
                oracle[k] = max(oracle.get(k, 0), e["final"]["score"])
    base_eps = None
    if base:
        for info, eps in runs:
            if info["label"] == base or info["run"] == base:
                base_eps = eps
        if base_eps is None:
            raise SystemExit(f"找不到基准运行 {base}")
    rows = []
    for info, eps in runs:
        scores = [e["final"]["score"] for e in eps.values()]
        think = [s["think_ms"] for e in eps.values() for s in e["steps"]]
        per_ep = [e["final"]["think_s"] for e in eps.values()]
        row = {"label": info["label"], "run": info["run"], "privileged": bool(info["algo"].get("privileged")),
               "budget_s": info.get("budget_s"), "n": len(eps), "mean": sum(scores) / len(scores) if scores else 0,
               "errors": sum(1 for e in eps.values() if e["error"]),
               "unfinished": sum(1 for e in eps.values() if not e["final"]["finished"]),
               "over": sum(e["final"]["over_budget_steps"] for e in eps.values()),
               "p50_ms": _pct(think, 0.5), "p95_ms": _pct(think, 0.95), "max_ms": max(think) if think else None,
               "ep_think_s": sum(per_ep) / len(per_ep) if per_ep else 0}
        pairs = [(e["final"]["score"], oracle[k]) for k, e in eps.items() if k in oracle]
        row["vs_oracle"] = _ratio_stats(pairs)
        if base_eps is not None:
            row["vs_base"] = _ratio_stats([(e["final"]["score"], base_eps[k]["final"]["score"])
                                           for k, e in eps.items() if k in base_eps])
        rows.append(row)
    rows.sort(key=lambda r: (r["privileged"], -(r["vs_oracle"] or {}).get("geo", r["mean"] / 1e9)))
    return rows


def markdown(rows, base=None):
    def f_ratio(x):
        return "—" if not x else f"{x['geo'] * 100:.1f}% ±{x['se'] * 100:.1f}（{x['n']} 局）"

    def f_ms(v):
        return "—" if v is None else (f"{v / 1000:.2f}s" if v >= 1000 else f"{v:.1f}ms")
    head = ["算法", "局数", "平均分", "相对上限"] + ([f"相对 {base}", "胜率"] if base else []) + \
           ["每步中位", "每步 95%", "每步最长", "每局思考", "超时步", "出错/没打完"]
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for r in rows:
        name = r["label"] + ("（上限，不排名）" if r["privileged"] else "")
        cells = [name, str(r["n"]), f"{r['mean']:,.0f}", f_ratio(r["vs_oracle"])]
        if base:
            vb = r.get("vs_base")
            cells += [f_ratio(vb), "—" if not vb else f"{vb['win'] * 100:.0f}%"]
        cells += [f_ms(r["p50_ms"]), f_ms(r["p95_ms"]), f_ms(r["max_ms"]), f"{r['ep_think_s']:.1f}s", str(r["over"]),
                  f"{r['errors']}/{r['unfinished']}"]
        out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out)
