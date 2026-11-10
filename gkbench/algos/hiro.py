"""hiro：hiro-gakumas-hero（开源版数字小广）的考试决策层，只用规则（不调 LLM、不用模拟器预演）。

每一步把 UIObs 公开观测转成 hiro 的 BattleState（和 hiro 离线模拟 hiro.sim.env.SimGame.state 同一套写法），
交给 BattleBrain：攻略打法规则（HIRO_EXAM_PLAYBOOK）→ 本回合计划 → 规则兜底，再过一遍硬规则（guard_llm），
然后把「打第几张 / 喝第几瓶 / 结束回合」换回 GKMS 动作。卡牌文本从公开主数据（KAA game.db）现查。

依赖（不在本仓库）：
  HIRO_SRC             hiro-gakumas-hero 的 src 目录（缺省 ~/github/digital-hiro-oss/src）
  HIRO_KAA_GAME_DATA   KAA 公开游戏数据目录（含 game.db）
参数：playbook=0 关掉攻略打法规则（缺省开，同作者实机配置）。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from .base import Algorithm, Decision

ATTR = {1: "Vo", 2: "Da", 3: "Vi"}
STATUS_FIELD = {"aggressive": "motivation", "review": "impression"}   # UIObs 状态 → BattleState 字段


def _import_hiro(playbook: bool):
    os.environ["HIRO_EXAM_PLAYBOOK"] = "1" if playbook else "0"
    os.environ.pop("HIRO_LLM", None)
    src = Path(os.environ.get("HIRO_SRC", Path.home() / "github/digital-hiro-oss/src")).expanduser()
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))


def exam_label(produce: str | None, step: str | None) -> str:
    step = str(step or "")
    if produce == "produce-008":
        return "r2" if step.endswith("2") else "r1"
    digits = [ch for ch in step if ch.isdigit()]
    return f"qualify-{digits[-1] if digits else 1}"


class HiroRulesAlgo(Algorithm):
    name = "hiro-rules"
    about = {
        "summary": "hiro-gakumas-hero 的考试决策层，只用规则：社区攻略打法 + 本回合计划 + 硬规则兜底，不调 LLM、不用预演",
        "detail": ["局面只用公开观测（手牌、状态、饮料、无序牌堆、回合属性），和实机看画面一致",
                   "实机配置同作者 Windows 夺冠局的 HIRO_EXAM_PLAYBOOK=1；实战另有 LLM 和 R2 模拟预演，这里都没开"],
        "sees": "screen",
        "links": [{"title": "hiro-gakumas-hero", "url": "https://github.com/matto49/hiro-gakumas-hero"}],
    }

    def __init__(self, **params):
        super().__init__(**params)
        self.playbook = bool(int(params.get("playbook", 1)))
        _import_hiro(self.playbook)
        from hiro.brain.battle import BattleBrain
        self._BattleBrain = BattleBrain
        self.brain = None
        self.memory = None

    def begin(self, ctx):
        from hiro.brain.state import profile_for
        ex = ctx.obs["exam"]
        self.profile = profile_for(ex.get("idol"))
        self.brain = self._BattleBrain(self.profile, None)
        self.memory = self.brain.new_memory(exam_label(ex.get("produce"), ex.get("step")))
        rivals = (ctx.meta or {}).get("rival_scores") or []
        self.target = max((r.get("score_max") or 0 for r in rivals), default=None) or None

    # -- UIObs → BattleState
    def state(self, obs):
        from types import SimpleNamespace

        from hiro.brain.cards import CardView, card_view, drink_view, kaa_cards, parse_tags, select
        from hiro.brain.state import BattleState
        ex, num = obs["exam"], obs["num"]
        legal = [tuple(a) for a in obs["legal"]]
        plays = {a[1] for a in legal if a[0] == "play"}
        drinkable = [a[1] for a in legal if a[0] == "drink"]
        hand = []
        for i, c in enumerate(obs["hand"]):
            kaa = kaa_cards().get((c["id"], c.get("u", 0)))
            if kaa is None:
                v = CardView(i, c["id"], c["id"], c.get("u", 0), i in plays, "unknown", 0, 0, None, "", parse_tags(c["id"], ""))
            else:
                v = card_view(i, kaa, available=i in plays)
            if c.get("c"):
                v.name += "（定制）"
            hand.append(v)
        drinks = []
        for slot, idx in enumerate(drinkable):
            did = obs["drinks"][idx]
            row = select("SELECT name FROM ProduceDrink WHERE id = ?;", did)
            drinks.append(drink_view(slot, SimpleNamespace(id=did, name=row[0] if row else did)))
        types, permil = ex.get("types") or [], ex.get("permil") or [0, 0, 0]
        turn, limit = ex.get("turn") or 1, ex.get("limit") or len(types)
        remaining = max(0, limit - turn + 1)
        self.memory.observe_turn(remaining)
        t = types[turn - 1] if 0 < turn <= len(types) else None
        observed = dict(remaining_turns=remaining, hp=num.get("stamina"), genki=num.get("block"),
                        score=num.get("score"), motivation=0, impression=0)
        buffs, statuses = {}, []
        for kind, value, turns in obs.get("status") or []:
            if kind in STATUS_FIELD:
                observed[STATUS_FIELD[kind]] = int(value)
            else:
                buffs[kind] = value
                statuses.append({"type": kind, "name": kind, "value": value, "unit": None if turns == -1 else f"{turns}T"})

        def names(zone):
            out = []
            for c in obs.get(zone) or []:
                k = kaa_cards().get((c["id"], c.get("u", 0)))
                out.append(k.name if k is not None else c["id"])
            return sorted(out)

        deck, grave = names("deck"), names("grave")
        piles = {"deck": deck, "grave": grave, "draw": 3}
        info = f"本回合属性 {ATTR.get(t)}；山札 {len(deck)} 张（无序）：{'、'.join(deck)}；弃牌 {len(grave)} 张：{'、'.join(grave)}"
        attr_permil = {ATTR[i + 1]: int(p) for i, p in enumerate(permil[:3]) if p}
        st = BattleState.build(self.memory, self.profile, hand=hand, drinks=drinks, public_info=info, piles=piles,
                               attr=ATTR.get(t), attr_permil=attr_permil,
                               now_turn_permil=permil[t - 1] if t else None,
                               final_turn_permil=permil[types[-1] - 1] if types else None,
                               target_score=self.target, buffs=buffs, statuses=statuses, deck_count=len(deck),
                               **observed)
        return st, drinkable

    def decide(self, ctx):
        from hiro.produce.exam_policy import guard_llm
        legal = [tuple(a) for a in ctx.obs["legal"]]
        if not any(a[0] in ("play", "drink", "end") for a in legal):   # 选牌等 hiro 不管的决策：取第一个
            return Decision(legal[0], {"why": "非出牌决策，取第一个合法动作"})
        state, drinkable = self.state(ctx.obs)
        d = guard_llm(state, self.memory, self.brain, self.brain.decide(state, self.memory))
        if d.kind == "play" and ("play", d.slot) in legal:
            action = ("play", d.slot)
        elif d.kind == "drink" and d.slot is not None and d.slot < len(drinkable):
            action = ("drink", drinkable[d.slot])
        else:
            action = ("end",) if ("end",) in legal else legal[0]
        if action[0] != d.kind and not (action == ("end",) and d.kind == "skip"):
            meta_note = f"hiro 选了 {d.kind}:{d.slot}，不合法，改成 {action}"
        else:
            meta_note = None
        if meta_note is None:
            self.brain.commit(state, self.memory, d)
        return Decision(action, {"source": d.source, "why": (d.reason or "")[:160], **({"note": meta_note} if meta_note else {})})
