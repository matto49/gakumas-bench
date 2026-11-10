"""重放：拿一局的路线，用裁判的种子从头推一遍。

- replay(problem, seed, episode)：核对上传的一局记录（逐步分数、终局、是否打完）。只能证明「这串动作在这个种子上
  确实打出这个分」，证明不了算法没偷看种子，所以本地上传的成绩只标 self（自报）。
- replay_route(loadout, seed, route)：只给路线（审查存档里的一条答），由裁判重放出完整的逐步记录。
"""
from __future__ import annotations

from . import save
from .referee import IllegalAction, Referee


def _actions(episode):
    if episode.get("route") is not None:
        return save.parse_route(episode["route"])
    return [tuple(s["action"]) for s in episode["steps"]]


def replay(problem, seed, episode):
    ref = Referee(problem["loadout"], int(seed))
    steps = episode.get("steps") or []
    try:
        actions = _actions(episode)
    except save.SaveError as e:
        return {"ok": False, "step": None, "reason": f"路线不合法：{e}"}
    if steps and len(steps) != len(actions):
        return {"ok": False, "step": None, "reason": f"路线有 {len(actions)} 个记号，逐步记录有 {len(steps)} 步"}
    for k, a in enumerate(actions):
        try:
            res = ref.step(a)
        except (IllegalAction, Exception) as e:
            return {"ok": False, "step": k, "reason": f"第 {k} 步走不通：{e}"}
        want = ((steps[k].get("result") or {}).get("after") or {}).get("score") if steps else None
        if want is not None and res["after"]["score"] != want:
            return {"ok": False, "step": k, "reason": f"第 {k} 步分数 {res['after']['score']} ≠ 记录 {want}"}
    if ref.score != episode["final"]["score"]:
        return {"ok": False, "step": None, "reason": f"终局 {ref.score} ≠ 记录 {episode['final']['score']}"}
    if bool(ref.finished) != bool(episode["final"]["finished"]):
        return {"ok": False, "step": None, "reason": "是否打完和记录不一致"}
    return {"ok": True, "score": ref.score, "steps": len(actions)}


def replay_route(loadout, seed, route, step_ms=None):
    """返回 {"ok", "score", "finished", "steps": [...], "err"}：steps 和跑分器的逐步记录同形（没有算法说明）。"""
    ref = Referee(loadout, int(seed))
    try:
        actions = save.parse_route(route)
    except save.SaveError as e:
        return {"ok": False, "err": f"路线不合法：{e}", "steps": [], "score": ref.score, "finished": False}
    if step_ms is not None and len(step_ms) != len(actions):
        return {"ok": False, "err": f"step_ms 有 {len(step_ms)} 个，路线有 {len(actions)} 个记号", "steps": [],
                "score": ref.score, "finished": False}
    steps, err = [], None
    for k, a in enumerate(actions):
        obs, priv = ref.obs(), ref.private_state()
        try:
            res = ref.step(a)
        except Exception as e:
            err = f"第 {k} 步走不通：{e}"
            break
        steps.append({"i": obs["i"], "turn": obs["exam"]["turn"], "token": save.token_of(a), "action": list(a),
                      "obs": obs, "algo_meta": None, "step_ms": float(step_ms[k]) if step_ms is not None else 0.0,
                      "cpu_ms": None, "worlds": 0, "over": False, "result": res, "private": priv})
    if err is None and not ref.finished:
        err = "路线没有走完这场审查"
    return {"ok": err is None, "err": err, "steps": steps, "score": ref.score, "finished": bool(ref.finished),
            "turns": int(ref.numbers().get("turn") or 0), "meta": ref.public_meta()}
