"""重放校验：拿一局记录里的动作序列，用裁判的种子从头推一遍，逐步核对分数和终局。

上传的成绩（本地跑完再交）都要过这一步；对不上就拒收。它只能证明「这串动作在这个种子上确实打出这个分」，
证明不了算法没偷看种子，所以本地上传的成绩只标「自报」，不进排行榜。
"""
from __future__ import annotations

from .referee import IllegalAction, Referee


def replay(problem, seed, episode):
    ref = Referee(problem["loadout"], int(seed))
    for k, s in enumerate(episode["steps"]):
        try:
            res = ref.step(tuple(s["action"]))
        except IllegalAction as e:
            return {"ok": False, "step": k, "reason": f"第 {k} 步非法：{e}"}
        want = (s.get("result") or {}).get("after", {}).get("score")
        if want is not None and res["after"]["score"] != want:
            return {"ok": False, "step": k, "reason": f"第 {k} 步分数 {res['after']['score']} ≠ 记录 {want}"}
    if ref.score != episode["final"]["score"]:
        return {"ok": False, "step": None, "reason": f"终局 {ref.score} ≠ 记录 {episode['final']['score']}"}
    if bool(ref.finished) != bool(episode["final"]["finished"]):
        return {"ok": False, "step": None, "reason": "是否打完和记录不一致"}
    return {"ok": True, "score": ref.score, "steps": len(episode["steps"])}
