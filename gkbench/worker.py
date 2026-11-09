"""GKMS 引擎子进程：Go 服务器拉起它，按行收发 JSON（stdin 一行请求，stdout 一行回复）。

GKMS 的引擎是 Python + C++，这一层只做转接，不放业务逻辑。

请求 {"op": ..., "rid": 请求号, ...}，回复 {"rid": 请求号, "ok": true, ...} 或 {"rid": ..., "ok": false, "error": "..."}
  provenance                                   引擎来源（GKMS 提交、规则版本）
  open    {sid, loadout, seed}                 开一局，回 obs、meta、loadout（不含种子）
  step    {sid, action}                        推进一步，回 result、private（这一步之前）、obs（没结束时）、done、final
  close   {sid}                                丢掉一局
  replay  {problem, seed, episode}             重放核对一局记录，回 ok / reason
"""
from __future__ import annotations

import json
import sys
import traceback

from . import engine
from .referee import Referee
from .verify import replay

MAX_DECISIONS = 300


def main():
    out = sys.stdout
    sys.stdout = sys.stderr              # GKMS 里的打印不能混进协议
    sessions: dict[str, Referee] = {}
    engine.setup()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid, op = req.get("rid"), req["op"]
            if op == "provenance":
                rep = {"engine": engine.provenance()}
            elif op == "open":
                ref = Referee(req["loadout"], int(req["seed"]))
                sessions[req["sid"]] = ref
                rep = {"obs": ref.obs(), "meta": ref.public_meta(), "loadout": ref.loadout_public}
            elif op == "step":
                ref = sessions[req["sid"]]
                priv = ref.private_state()
                res = ref.step(tuple(req["action"]))
                done = bool(ref.finished) or ref.decisions >= MAX_DECISIONS
                rep = {"result": res, "private": priv, "done": done, "obs": None if done else ref.obs()}
                if done:
                    rep["final"] = {"score": ref.score, "finished": bool(ref.finished),
                                    "turns": int(ref.numbers().get("turn") or 0)}
            elif op == "close":
                sessions.pop(req["sid"], None)
                rep = {}
            elif op == "replay":
                rep = replay(req["problem"], int(req["seed"]), req["episode"])
                rep["verdict"] = rep.pop("ok")
            else:
                raise ValueError(f"未知操作 {op}")
            rep.update(rid=rid, ok=True)
        except Exception as e:
            rep = {"rid": rid, "ok": False, "error": f"{type(e).__name__}: {e}",
                   "trace": traceback.format_exc(limit=3)}
        out.write(json.dumps(rep, ensure_ascii=False) + "\n")
        out.flush()


if __name__ == "__main__":
    main()
