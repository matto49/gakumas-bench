"""GKMS 引擎子进程：Go 服务器拉起它，按行收发 JSON（stdin 一行请求，stdout 一行回复）。

GKMS 的引擎是 Python + C++，这一层只做转接，不放业务逻辑。

请求 {"op": ..., "rid": 请求号, ...}，回复 {"rid": 请求号, "ok": true, ...} 或 {"rid": ..., "ok": false, "error": "..."}
  provenance                                   引擎来源（GKMS 提交、规则版本）
  open    {sid, loadout, seed}                 开一局，回 obs、meta、loadout（不含种子）
  step    {sid, action}                        推进一步，回 result、private（这一步之前）、obs（没结束时）、done、final
  close   {sid}                                丢掉一局
  replay  {problem, seed, episode}             重放核对一局记录，回 ok / reason
  worlds  {sid, k}                             k 个重抽过隐藏信息的世界（export_world，base64），给托管模式的 PIMC 等算法
  replay_route {problem, seed, route, step_ms}  只给路线（审查存档里的一条答），重放出完整的逐步记录
  check_problem {doc, by?, source?}                        上传的一道题：核对、开局、算场景，回能入库的题模板（problems.check_upload）
出牌助手（gkbench/assist.py，网页 /assist）：每个操作回 {view}；访客能看懂的错误只回一句 error，不带 trace
  assist_open    {sid, loadout | code, practice}   开局（code：GA1 编成码或 GKMS 导出的 GR1 对局码）
  assist_hand    {sid, cards: [[卡 id, 强化], ...]} 把手牌核对成画面上的那一手
  assist_numbers {sid, score?, stamina?, block?}   改数值
  assist_step    {sid, action}                     出牌 / 喝饮料 / 结束回合
  assist_undo    {sid}                             退一步
  assist_close   {sid}
"""
from __future__ import annotations

import base64
import json
import random
import secrets
import sys
import traceback

from . import engine
from .referee import Referee
from .verify import replay, replay_route
from .worlds import export_world
from .assist import AssistError, AssistSession
from .assist_code import CodeError

MAX_DECISIONS = 300

_UINET = None


def uinet_policy():
    """出牌助手的建议：UINet（每个子进程加载一次）"""
    global _UINET
    if _UINET is None:
        from .algos.uinet import UinetAlgo
        _UINET = UinetAlgo(threads=1).policy.decide
    return _UINET


def main():
    out = sys.stdout
    sys.stdout = sys.stderr              # GKMS 里的打印不能混进协议
    sessions: dict[str, Referee] = {}
    assists: dict = {}
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
            elif op == "worlds":
                ref = sessions[req["sid"]]
                k = max(1, min(64, int(req.get("k", 16))))
                rng = random.Random(secrets.randbits(64))        # 世界的随机数不可预测，也和种子无关
                rep = {"worlds": [base64.b64encode(export_world(ref.sample_world(rng))).decode() for _ in range(k)]}
            elif op.startswith("assist_"):
                rep = _assist(op, req, assists)
            elif op == "close":
                sessions.pop(req["sid"], None)
                rep = {}
            elif op == "replay_route":
                rep = replay_route(req["problem"]["loadout"], int(req["seed"]), req["route"], req.get("step_ms"))
                rep["verdict"] = rep.pop("ok")
            elif op == "check_problem":
                from .problems import check_upload
                doc = req["doc"]
                if isinstance(doc, dict) and "format" not in doc:   # 没算过编号的开局配置：这里替它算（存档则必须自带对的编号）
                    from .save import make_template
                    doc = make_template(doc, name=(req.get("name") or None))
                rep = check_upload(doc, by=req.get("by") or None, source=req.get("source") or None)
            elif op == "replay":
                rep = replay(req["problem"], int(req["seed"]), req["episode"])
                rep["verdict"] = rep.pop("ok")
            else:
                raise ValueError(f"未知操作 {op}")
            rep.update(rid=rid, ok=True)
        except (AssistError, CodeError) as e:      # 访客能看懂的错误：只回一句
            rep = {"rid": rid, "ok": False, "error": str(e)[:200]}
        except Exception as e:
            rep = {"rid": rid, "ok": False, "error": f"{type(e).__name__}: {e}",
                   "trace": traceback.format_exc(limit=3)}
        out.write(json.dumps(rep, ensure_ascii=False) + "\n")
        out.flush()


def _assist(op, req, assists):
    sid = req["sid"]
    if op == "assist_open":
        if req.get("code"):
            a = AssistSession.from_code(str(req["code"]), practice=bool(req.get("practice")), policy=uinet_policy())
        else:
            a = AssistSession(req.get("loadout"), practice=bool(req.get("practice")), policy=uinet_policy())
        assists[sid] = a
        return {"view": a.view()}
    if op == "assist_close":
        assists.pop(sid, None)
        return {}
    a = assists.get(sid)
    if a is None:
        raise AssistError("这局已经结束或不存在")
    if op == "assist_hand":
        return {"view": a.set_hand(req.get("cards") or [])}
    if op == "assist_numbers":
        return {"view": a.set_numbers(score=req.get("score"), stamina=req.get("stamina"), block=req.get("block"))}
    if op == "assist_step":
        return {"view": a.step(req["action"])}
    if op == "assist_undo":
        return {"view": a.undo()}
    raise ValueError(f"未知操作 {op}")


if __name__ == "__main__":
    main()
