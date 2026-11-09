"""裁判：握着种子和完整局面推进一场考试，对外只给公开观测。

公开观测 = GKMS UIObs v1（uinet.uiobs.from_session），外加 bench 字段 ``i``（第几个决策）。
完整状态（山札顺序、随机数、快照哈希）只写进裁判这边的记录，不交给算法。
"""
from __future__ import annotations

import hashlib
import random

from . import engine

# 每一步前后记下来比较的数值（GKMS observe() 的字段）
TRACKED = ("turn", "score", "stamina", "max_stamina", "block", "review", "aggressive", "lesson_buff",
           "full_power_point", "playable", "turn_play_count", "extra_turns", "stance", "stance_step")


def _card_ids(cards):
    return [c["produce_card_id"] for c in cards]


class Referee:
    def __init__(self, loadout: dict, seed: int):
        engine.setup()
        from uinet.env import Battle
        lo = {k: v for k, v in loadout.items() if not k.startswith("_") and k != "source"}
        lo["seed"] = int(seed)
        self.loadout_public = {k: v for k, v in lo.items() if k != "seed"}
        self.battle = Battle(lo)
        self.meta = self.battle.meta
        self.decisions = 0
        self._log_len = len(self._log())

    # -- 公开
    @property
    def finished(self) -> bool:
        return bool(self.battle.finished)

    @property
    def score(self) -> int:
        return self.battle.score

    def obs(self) -> dict:
        o = self.battle.obs()
        o["i"] = self.decisions
        return o

    def legal(self):
        return [tuple(a) for a in self.battle.legal()]

    def public_meta(self) -> dict:
        """这场考试开考就公开的信息。"""
        m = self.meta
        return {"produce_id": m.get("produce_id"), "step_type": m.get("step_type"), "plan_type": m.get("plan_type"),
                "limit_turn": m.get("limit_turn"), "criteria": m.get("criteria"), "score_cap": m.get("score_cap"),
                "rival_scores": m.get("rival_scores"), "round_label": m.get("round_label")}

    # -- 只给裁判
    def private_state(self) -> dict:
        s = self.battle.session
        try:
            blob = s.portable_bytes()
            h = hashlib.sha1(blob).hexdigest()[:16]
        except Exception:                       # 快照导不出来时不影响对局
            h = None
        return {"deck_order": _card_ids(s.deck.deck), "rng": int(s.deck.rng.state), "state_hash": h}

    def numbers(self) -> dict:
        o = self.battle.session.observe()
        return {k: o.get(k) for k in TRACKED}

    def _log(self):
        try:
            return list(self.battle.session.log or ())
        except Exception:
            return []

    # -- 推进
    def step(self, action) -> dict:
        action = tuple(action)
        legal = self.legal()
        if action not in legal:
            raise IllegalAction(action, legal)
        before = self.numbers()
        hand_before = _card_ids(self.battle.session.deck.hand)
        self.battle.step(action)
        self.decisions += 1
        after = self.numbers()
        log = self._log()
        events = log[self._log_len:]
        self._log_len = len(log)
        delta = {k: after[k] - before[k] for k in after
                 if isinstance(after[k], (int, float)) and isinstance(before[k], (int, float)) and after[k] != before[k]}
        return {"after": after, "delta": delta, "hand_before": hand_before,
                "hand_after": _card_ids(self.battle.session.deck.hand),
                "events": [_jsonable(e) for e in events][:64]}

    # -- 给 PIMC 这类算法用的世界采样
    def sample_world(self, rng: random.Random):
        """复制当前局面，把看不见的部分重新随机：山札顺序、随机数状态、种子。
        手牌、弃牌、保留、除外、状态、回合属性、已打出的牌都是公开的，原样保留。"""
        from .worlds import sample_world
        return sample_world(self.battle.session, rng)


class IllegalAction(ValueError):
    def __init__(self, action, legal):
        super().__init__(f"非法动作 {action}，合法动作 {legal}")
        self.action, self.legal = action, legal


def _jsonable(x):
    if isinstance(x, (str, int, float, bool)) or x is None:
        return x
    if isinstance(x, dict):
        return {str(k): _jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_jsonable(v) for v in x]
    return str(x)
