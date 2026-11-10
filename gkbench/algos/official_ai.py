"""游戏官方 AI：学マス客户端自带的出牌 AI（比赛自动打、考试里高亮推荐卡用的同一套搜索和评估）。

GKMS 从安卓 3.2.1 客户端还原了它的决策代码（GKMSProject/GKMSContest/official_ai：往后搜两回合内的出牌顺序、
局面评估、效果选卡），只用这部分算法，局面推进、合法性、随机数全交给我们的引擎（GKMS 原生核心，和裁判同一个）。
official_ai 要求宿主实现 SequenceHost / EvaluationHost 两个接口，这里的 NativeHost 就是这层桥：

- 克隆、出牌、结束回合、合法性：NativeExamSession 原样提供；
- 效果选卡（从山札选卡等）：先在克隆上试打，拿到候选，交给官方选卡评分选好，再排队真打；
- 局面评估要的原始状态（集中、好印象、各状态剩余回合、累计倍率层……）：从原生核心导出的局面读；
- 触发效果预测（已装上的持续效果之后能带来多少）：原生核心没有单独执行一条效果的接口，
  用 native/official_ai_ext.cpp 补了一个（同一份核心代码编进来），在克隆上逐条执行、记前后差值。

和游戏里一样，它在真实牌局上往后搜（山札顺序、随机结果都是真的），所以 sees_seed = True：拿 ctx.true_session，
不能托管跑；照常参与排名，网页上标「游戏官方 AI」「看牌序」。它不喝饮料（比赛 AI 没有饮料）。

和原版的差别（引擎层面，不是算法）：
- 触发预测按每条效果执行前后的净变化记一条差分；原版按引擎内部的每次变化逐条记（链式效果会有细微出入）；
  效果里的卡牌成长（差分类型 20）没记；
- 「效果抽牌总数」（评估第 28 项）原生核心不记，按 0；
- 定时效果的来源只分得出直接（出牌装的）和间接（持续效果、P 道具装的），直接的一律按卡牌来源算。
"""
from __future__ import annotations

import ctypes as C
import hashlib
import subprocess
import sys
import time
from pathlib import Path

from .base import Algorithm, Decision

EXT_SRC = Path(__file__).with_name("native") / "official_ai_ext.cpp"
INF_TURNS = 1 << 20          # 无限期状态的剩余回合（评估里都和剩余回合取小）

_CACHE: dict = {}


def contest_dir() -> Path:
    from .. import engine
    return engine.GKMS_ROOT / "GKMSContest"


def official():
    """official_ai 包和它的配置表（AI 表 ai_master/current）。"""
    if "official" not in _CACHE:
        root = contest_dir()
        if not (root / "official_ai").is_dir():
            raise SystemExit(f"找不到 GKMSContest：{root}（GKMS 仓库稀疏检出时要 git sparse-checkout add GKMSContest）")
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        import official_ai
        config = official_ai.load_official_configuration(root / "ai_master/current")
        _CACHE["official"] = (official_ai, config)
    return _CACHE["official"]


def ext_lib():
    """native/official_ai_ext.cpp 编出来的库（按源码和核心头文件的内容缓存在 ~/.cache/gkbench）。"""
    if "ext" in _CACHE:
        return _CACHE["ext"]
    from .. import engine
    native_dir = engine.GKMS_ROOT / "GakumasCLI/native"
    h = hashlib.sha1(EXT_SRC.read_bytes())
    for p in sorted(native_dir.glob("*.h")) + [native_dir / "api.cpp"]:
        h.update(p.read_bytes())
    suffix = ".dylib" if sys.platform == "darwin" else ".so"
    out = Path.home() / ".cache/gkbench" / f"libofficialai-{h.hexdigest()[:12]}{suffix}"
    if not out.exists():
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(".tmp" + suffix)
        cmd = ["c++", "-O2", "-ffp-contract=off", "-std=c++17", "-w", "-shared", "-fPIC", "-pthread",
               "-I", str(native_dir), "-o", str(tmp), str(EXT_SRC)]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError("编译官方 AI 扩展失败：" + r.stderr[-800:])
        tmp.rename(out)
    lib = C.CDLL(str(out))
    lib.bx_apply_effect.argtypes = [C.c_void_p, C.c_int32]
    core = engine.native()[0].lib
    if lib.bx_core_size() != core.gk_core_size() or lib.bx_state_size() != core.gk_state_size():
        raise RuntimeError("官方 AI 扩展和原生核心的结构体大小不一致（核心更新后要重新编译）")
    _CACHE["ext"] = lib
    return lib


def exam_effect(idol_card_id: str) -> int:
    """偶像卡的推荐效果（examEffectType）：官方 AI 的评估表按它分组。"""
    if "effects" not in _CACHE:
        import json
        from .. import engine
        table = {}
        for line in open(engine.MASTER_DIR / "IdolCard.jsonl", encoding="utf-8"):
            d = json.loads(line)["decoded"]
            v = d.get("examEffectType")
            table[d["id"]] = int((v.get("number") if isinstance(v, dict) else v) or 0)
        _CACHE["effects"] = table
    return _CACHE["effects"][idol_card_id]


def _num(v) -> int:
    return int(v.get("number", 0)) if isinstance(v, dict) else int(v or 0)


# 评估第 33..44 项：按类型分开的累计状态（效果类型 -> 原生局面里的层）
_ACCUMULATED = {33: "lesson_parameter_multiple_layers", 34: "review_multiple_layers",
                35: "enthusiastic_additive_layers", 36: ("timed", "enthusiastic_multiple_permil"),
                37: "full_power_lesson_multiple_additive_layers", 38: "concentration_lesson_multiple_additive_layers",
                39: ("timed", "lesson_buff_additive_multiple"), 40: ("timed", "parameter_buff_additive_multiple"),
                41: ("timed", "aggressive_additive_multiple"), 42: ("timed", "review_additive_multiple"),
                43: "full_power_point_additive_layers", 44: None}
_FLOAT_LAYERS = {33, 34, 37, 38, 39, 40, 41, 42}        # 层里存的是小数倍率（0.5 = 50%），换成千分比
_STANCE = {"Concentration": 1, "Preservation": 2, "FullPower": 3}
# 触发预测的状态差分：效果类型 -> 评估项（official_ai.evaluation.STATUS_EVALUATION_TYPES 的键）
_PAIR_SLOT = {2: 7, 5: 8, 10: 4, 14: 16, 18: 32, 31: 5, 39: 33, 42: 6, 45: 20, 46: 21, 47: 22, 63: 19, 66: 30,
              69: 9, 73: 10, 93: 15, 105: 11, 106: 12, 107: 13, 114: 14, 129: 17, 141: 31, 170: 35, 171: 36,
              172: 37, 173: 38, 174: 39, 175: 40, 176: 41, 177: 42, 178: 43, 179: 44, 181: 45, 182: 34,
              196: 50, 197: 51, 198: 52, 199: 53}
_ZONES = ((2, "hand"), (3, "deck"), (4, "grave"), (5, "lost"), (13, "hold"))


class NativeHost:
    """official_ai 的 SequenceHost + EvaluationHost，局面是 GKMS 原生核心的 NativeExamSession。"""

    def __init__(self, *, main_effect: int, item_ids=()):
        oa, self.configuration = official()
        self.oa = oa
        from official_ai.card_select import OfficialCardSelectCalculator
        from official_ai.search import SearchFrame
        from official_ai.selection import SelectionContext, select_cards_by_auto_evaluation
        self._Frame, self._SelCtx, self._select = SearchFrame, SelectionContext, select_cards_by_auto_evaluation
        self.main_effect = int(main_effect)
        self.item_ids = tuple(item_ids)
        self.card_calculator = OfficialCardSelectCalculator(self.configuration.tables)
        self.ext = ext_lib()
        self.steps = 0

    # -- SequenceHost ------------------------------------------------------------------------------------------
    def clone(self, seq):
        c = seq.clone()
        c._oa_hist = list(getattr(seq, "_oa_hist", ()))
        return c

    def remaining_turns(self, seq):
        if seq.finished:
            return 0
        return int(seq.config.limit_turn) + int(seq.state.extra_turns) - int(seq.turn) + 1

    def frame(self, seq):
        return self._Frame(8 if seq.finished else 6, int(seq.turn), self.remaining_turns(seq),
                           int(seq.state.plan_type), self.main_effect, int(seq.state.score))

    def hand_card_ids(self, seq):
        return tuple(c["produce_card_id"] for c in seq._zone("hand"))

    def is_hand_usable(self, seq, index):
        return ("play", index) in seq.legal_actions()

    def use_hand(self, seq, index, selector):
        self._step(seq, ("play", int(index)), selector)

    def end_turn(self, seq, selector):
        self._step(seq, ("end",), selector)

    def run_to_decision(self, seq, selector):
        """原生核心一步就推进到下一个决策点（回合结束、回合开始的自动效果都在 step 里）。"""

    def _step(self, seq, action, selector):
        """出牌里的效果选卡：在克隆上试打（核心的替身选卡会记下候选和选几张），官方选卡选好排队，
        再试下一次选卡，直到这一步不再有新的选卡；最后按排好的队真打。"""
        picks = []
        for _ in range(16):
            probe = seq.clone()
            probe._queue[:] = [list(p) for p in picks]
            probe._select_choices = []
            probe.step(action, observe=False)
            if not probe._select_choices:
                break
            x = probe._select_choices[0]
            pool = {c["number"]: c for name in ("hand", "deck", "grave", "hold", "lost") for c in seq._zone(name)}
            pool.update({c["number"]: c for name in ("hand", "deck", "grave", "hold", "lost") for c in probe._zone(name)
                         if c["number"] not in pool})
            views = [self.card_view(seq, pool[n]) for n in x["candidate_numbers"]]
            chosen = self._select(views, int(x["pick_min"]), int(x["pick_max"]), self.selection_context(seq),
                                  self.card_calculator.evaluate)
            picks.append(sorted(int(i) for i in chosen))
        seq._queue[:] = [list(p) for p in picks]
        seq.step(action, observe=False)
        self.steps += 1
        seq._oa_hist = list(getattr(seq, "_oa_hist", ())) + [(action, picks, seq.search_key())]

    def card_view(self, seq, inst):
        from official_ai.card_select import CardEffect, CardView
        card = seq._resolved(inst)
        effects_master = seq.master.effects
        lesson_add = int(card.get("customize_lesson_add") or 0)
        count_add = int(card.get("customize_lesson_count_add") or 0)
        value_adds = card.get("customize_value_adds") or {}
        effects, triggers = [], []
        for link in card.get("playEffects", ()):
            e = effects_master[link["produceExamEffectId"]]
            kind = _num(e.get("effectType"))
            v1, v2, cnt = int(e.get("effectValue1", 0)), int(e.get("effectValue2", 0)), int(e.get("effectCount", 0))
            if kind == 1:
                v1 += lesson_add
                cnt = (cnt or 1) + count_add
            v1 += int(value_adds.get(kind, 0))
            effects.append(CardEffect(kind, v1, v2, cnt))
            triggers.append(link.get("produceExamTriggerId") or None)
        return CardView(inst["produce_card_id"], tuple(effects), card.get("playProduceExamTriggerId") or None,
                        tuple(triggers))

    def selection_context(self, seq):
        return self._SelCtx(self.remaining_turns(seq), True, int(seq.state.plan_type),
                            self.configuration.search.version, self.main_effect,
                            int(self.configuration.exam_setting["holdLimit"]),
                            tuple(self.card_view(seq, c) for c in seq._zone("hold")))

    # -- EvaluationHost ----------------------------------------------------------------------------------------
    def _left(self, seq, until):
        if until is None:
            return 0
        if until == -1 or until == float("inf"):
            return INF_TURNS
        return max(0, int(until) - int(seq.turn) + 1)

    def _flag_left(self, seq, flag, until_name):
        st = seq.state
        if flag is not None and not getattr(st, flag):
            return 0
        left = self._left(seq, getattr(st, until_name))
        return INF_TURNS if (left == 0 and flag is not None and getattr(st, until_name) is None) else left

    def _layer_rows(self, seq, slot):
        """一类累计状态的 (千分比, 剩余回合) 列表。"""
        from official_ai.evaluation_types import TimedValue
        spec = _ACCUMULATED[slot]
        if spec is None:
            return ()
        st, turn = seq.state, int(seq.turn)
        if isinstance(spec, tuple):
            layers = (st._timed_gain_layers or {}).get(spec[1], ())
        else:
            layers = getattr(st, spec) or ()
        out = []
        for layer in layers:
            if isinstance(layer, dict):
                value, until, fresh = layer.get("value", 0), layer.get("expire", layer.get("until_turn")), layer.get("fresh", 0)
            else:
                value, until = layer[0], layer[1] if len(layer) > 1 else None
                fresh = layer[2] if len(layer) > 2 else 0
            if until is None or until == -1 or until == float("inf"):
                left = INF_TURNS
            else:
                left = int(until) - turn + (0 if fresh == turn else 1)
                if left <= 0:
                    continue
            permil = round(float(value) * 1000) if slot in _FLOAT_LAYERS else int(value)
            out.append(TimedValue(int(permil), int(left)))
        return tuple(out)

    def _raw(self, seq):
        """评估用的原始状态（evaluation_types.EvaluationState 的字段）。"""
        st = seq.state
        left = self._flag_left
        stance = _STANCE.get(st.idol_status_type, 0)
        bonuses = getattr(seq.config, "audition_permils", None)
        return dict(
            phase=8 if seq.finished else 6, is_battle=bool(bonuses),
            battle_bonus_permils=tuple(int(bonuses[k]) for k in (1, 2, 3)) if bonuses else (1000, 1000, 1000),
            parameter=int(st.score), block=int(st.block), stamina=int(st.stamina),
            remaining_turns=self.remaining_turns(seq),
            lesson_buff=int(st.lesson_buff), review=int(st.review), aggressive=int(st.aggressive),
            parameter_buff_turns=int(st.parameter_buff_remaining or 0),
            stamina_consumption_down_turns=left(seq, "stamina_consumption_down", "stamina_consumption_down_until_turn"),
            stamina_consumption_add_turns=left(seq, "stamina_consumption_add", "stamina_consumption_add_until_turn"),
            block_add_down_turns=left(seq, "block_add_down", "block_add_down_until_turn"),
            parameter_debuff_turns=left(seq, "gimmick_parameter_debuff", "gimmick_parameter_debuff_until_turn"),
            slump_turns=left(seq, "slump", "slump_until_turn"),
            parameter_buff_multiple_per_turn=left(seq, "parameter_buff_multiple_per_turn",
                                                  "parameter_buff_multiple_until_turn"),
            block_restriction_turns=left(seq, "block_restriction", "block_restriction_until_turn"),
            lesson_multiple_depend_review_or_aggressive_turns=left(
                seq, "lesson_parameter_multiple_depend_review_or_aggressive", "lesson_parameter_multiple_depend_until_turn"),
            buff_consumption_add_turns=left(seq, "buff_consumption_add", "buff_consumption_add_until_turn"),
            review_turn_end_reduce_lock_turns=self._left(seq, st.review_turn_end_reduce_lock_turn or None),
            lesson_debuff=int(st.lesson_debuff or 0), block_add_down_fix=int(st.block_add_down_fix or 0),
            stamina_consumption_down_fix=int(st.stamina_consumption_down_fix or 0),
            playable_value_add_count=int(st.playable), is_turn_card_play_end=True,
            extra_turns=int(st.extra_turns),
            idol_status_type=stance, idol_status_step=int(st.idol_status_step_count or 0),
            full_power_point_get_sum_count=int(st.full_power_point_sum or 0),
            stance_concentration_change_count=int(st.concentration_change_count or 0),
            stance_preservation_change_count=int(st.preservation_change_count or 0),
            stance_full_power_change_count=int(st.full_power_change_count or 0),
            hold_count=len(seq._zone("hold")), total_effect_draw_card_count=0,
            anti_debuff_count=int(st.anti_debuff or 0), stance_lock=int(st.stance_lock_turns or 0),
            accumulated_statuses={slot: self._layer_rows(seq, slot) for slot in _ACCUMULATED})

    def evaluation_state(self, seq):
        from official_ai.evaluation_types import CardGrowth, EvaluationState
        grow_effects = seq.master.grow_effects
        ids, growth = [], []
        for position, zone in _ZONES:
            for card in seq._zone(zone):
                ids.append(card["produce_card_id"])
                kinds = tuple(_num(grow_effects[g]["effectType"]) for g in card.get("dynamic_grow_effect_ids") or ())
                growth.append(CardGrowth(position, kinds))
        return EvaluationState(**self._raw(seq), resource_card_ids=tuple(ids), resource_item_ids=self.item_ids,
                               card_growth=tuple(growth))

    def trigger_statuses(self, seq):
        """评估只算来源是技能卡的持续效果（P 道具、回忆装的不算）；定时效果按卡牌来源、只算一次。"""
        out = []
        for row in seq.state.trigger_effect_states:
            if row.get("remaining_turns") == 0:
                continue
            limit = int(row["limit_count"]) if row.get("limit_count") is not None else -1
            left = limit - int(row.get("spent_total") or 0) if limit >= 0 else limit
            if limit >= 0 and left <= 0:
                continue
            enchant = str(row.get("enchant_id") or "")
            card = enchant[len("enchant-"):].rsplit("-enc", 1)[0] if enchant.startswith("enchant-p_card-") else None
            trigger = str(row.get("trigger") or "").split("|", 1)[-1]
            out.append(_Trigger(trigger, 31, card, left, tuple(row.get("effect_ids") or ())))
        for turn, effect_ids in sorted((seq.state.effect_timer_queue or {}).items()):
            # 「~」开头的是持续效果 / P 道具装的间接定时效果，不算技能卡来源
            direct = tuple(e for e in effect_ids if not str(e).startswith("~"))
            if int(turn) >= int(seq.turn) and direct:
                out.append(_Trigger("", 30, "timer", 1, direct))
        return tuple(out)

    def create_prediction_resolver(self, seq):
        return _Resolver(self, seq)


class _Trigger:
    __slots__ = ("trigger_id", "status_type", "trigger_card_id", "limit_count", "effects")

    def __init__(self, trigger_id, status_type, card, limit, effects):
        self.trigger_id, self.status_type, self.trigger_card_id = trigger_id, status_type, card
        self.limit_count, self.effects = limit, effects


class _Resolver:
    """在局面的一份克隆上逐条执行效果（不恢复局面、不触发后续事件），每条记一条差分。"""

    def __init__(self, host, seq):
        self.host = host
        self.work = seq.clone()
        self.broken = False

    def _snap(self):
        h, w = self.host, self.work
        raw = h._raw(w)
        st = w.state
        snap = {"parameter": int(st.score), "stamina": int(st.stamina), "block": int(st.block)}
        slots = {4: raw["lesson_buff"], 5: raw["review"], 6: raw["aggressive"], 7: raw["parameter_buff_turns"],
                 8: raw["stamina_consumption_down_turns"], 9: raw["stamina_consumption_add_turns"],
                 10: raw["block_add_down_turns"], 11: raw["lesson_debuff"], 12: raw["parameter_debuff_turns"],
                 13: raw["block_add_down_fix"], 14: raw["slump_turns"], 15: raw["stamina_consumption_down_fix"],
                 16: raw["playable_value_add_count"], 17: raw["parameter_buff_multiple_per_turn"],
                 19: raw["extra_turns"], 30: raw["anti_debuff_count"], 31: raw["stance_lock"],
                 32: raw["block_restriction_turns"], 45: raw["lesson_multiple_depend_review_or_aggressive_turns"],
                 50: raw["review_turn_end_reduce_lock_turns"], 53: raw["buff_consumption_add_turns"]}
        stance, step = raw["idol_status_type"], raw["idol_status_step"]
        for k, slot in ((1, 20), (2, 21), (3, 22)):
            slots[slot] = step if stance == k else 0
        for slot, rows in raw["accumulated_statuses"].items():
            slots[slot] = sum(r.value for r in rows)
        snap["slots"] = slots
        return snap

    def affect_effect(self, effect_id):
        from official_ai.evaluation_types import EffectDifference
        if self.broken:
            return ()
        try:
            sid = self.work._round.ctx.sid(effect_id)
        except Exception:                            # 这局的核心表里没有这条效果：不预测
            return ()
        before = self._snap()
        rc = self.host.ext.bx_apply_effect(self.work._core, sid)
        self.work._dirty()
        if rc:
            self.broken = True                       # 核心不支持这条效果：这个触发不再往下预测
            return ()
        after = self._snap()
        kinds, pairs = set(), {}
        for kind, name in ((0, "parameter"), (1, "stamina"), (2, "block")):
            if before[name] != after[name]:
                kinds.add(kind)
        for effect_type, slot in _PAIR_SLOT.items():
            a, b = before["slots"].get(slot, 0), after["slots"].get(slot, 0)
            if a != b:
                pairs[effect_type] = ((min(a, INF_TURNS), min(b, INF_TURNS)),)
        return (EffectDifference(difference_types=frozenset(kinds),
                                 parameter=(before["parameter"], after["parameter"]),
                                 stamina=(before["stamina"], after["stamina"]),
                                 block=(before["block"], after["block"]), status_pairs=pairs),)


class OfficialAIAlgo(Algorithm):
    """每个决策点：若上次搜出的整段出牌还在照着走（局面和预期一致），出下一步；否则在真实局面的克隆上重新搜一段。"""
    name = "official-ai"
    sees_seed = True
    needs_gkms = True

    def __init__(self, budget=200000, **kw):
        super().__init__(budget=budget, **kw)
        self.budget = int(budget)

    def begin(self, ctx):
        official()
        self.host = NativeHost(main_effect=exam_effect(ctx.loadout["idol_card_id"]),
                               item_ids=tuple(ctx.loadout.get("produce_item_ids") or ()))
        from official_ai import create_official_search
        self.search = create_official_search(self.host, self.host.configuration)
        self.plan = []          # [(动作, 期望的执行前局面)]

    def _replan(self, ctx):
        t = time.time()
        root = ctx.true_session.clone()
        root._oa_hist = []
        steps0 = self.host.steps
        result = self.search.search(root, command_budget=self.budget)
        hist = result.selected.sequence._oa_hist
        plan, key = [], ctx.true_session.search_key()
        for action, picks, after in hist:
            for p in picks:
                plan.append((("select", list(p)), key))
            plan.append((tuple(action), key))
            key = after
        self.plan = plan
        return {"solve_seconds": round(time.time() - t, 3), "leaves": len(result.candidates),
                "expanded": result.expanded_commands, "steps": self.host.steps - steps0,
                "evaluate": result.selected.evaluate_score, "path_len": len(hist)}

    def decide(self, ctx):
        meta = {}
        key = ctx.true_session.search_key()
        if not self.plan or self.plan[0][1] != key:
            meta = self._replan(ctx)
        if not self.plan:
            raise RuntimeError("官方 AI 没搜出可走的动作")
        action, _ = self.plan.pop(0)
        return Decision(action, meta)
