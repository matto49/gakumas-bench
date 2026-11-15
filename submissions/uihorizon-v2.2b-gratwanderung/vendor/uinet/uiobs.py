"""UIObs v2: what the exam screen shows the player at a decision, and nothing else.

Built from an engine session for training (``from_session``); a capture of the real client fills the same document
(``uinet.capture``), and so can a developer reading the screen.  It holds:

  exam    which exam (produce, round, the idol's plan), the turn, the turn count, the colour of every turn
          (the 審査 schedule shown on top), the per-colour score multipliers (permil) and the criteria
  num     score, stamina / max, 元気, the card plays left this turn and the plays made
  stance  the 指針 and its step
  status  every status icon: [kind, value, turns left (-1 = no limit)]
  ench    every lasting effect icon -- P items, memories, a card's lasting effect: [enchant id, uses left
          (-1 = no limit), turns left (-1 = no limit)]
  hand    the hand in screen order, each card with "p" = can be played now
  deck / grave / hold / lost   the other zones as multisets (the screen lists the draw pile without its order)
  played  the cards played this turn, in order (user 2026-10-23 22:27: counts as screen information)
  drinks  the drinks held, in screen order
  legal   the actions the screen offers: ["play", hand index], ["drink", drink index], ["end"]

v2 (SX-04-19) adds what the screen shows and v1 left out:
  timers  every reserved effect (予約効果) icon: [turns until it fires (0 = this turn), effect id, 1 = at the turn's
          end]; the engine's effect_timer_queue and end_turn_timer_queue
  costs   every card-cost change in force (「スキルカードのコスト…」, shown on the card faces): [card search id, the
          cost it sets, uses left]
  pcount  every play-count buff (「次に使用する…の効果をもう1回発動」): [card search id, extra plays, uses left, turns
          left (-1 = no limit)]
  status  the kind "full_power_point_gain_permil" (全力値獲得量増加, permil)
``v1_view`` gives the v1 document of a v2 one (what a v1 network reads).

Never in it: the RNG, the draw order, the client's effect preview (computed with the live RNG), counters the
screen does not show (sums of consumed 好印象 / 元気, stance change counts, ...).

A card is {"id", "u" (upgrade count now), "c" (customizes [[id, count]], when any), "g" (in-exam grow ids, when
any)}; hand cards add "p".
"""
from __future__ import annotations

SCHEMA = "uiobs.v2"
V2_KEYS = ("timers", "costs", "pcount")

# Status icons, by engine attribute.  Kept in this order: the vocabulary (schema/vocab.v1.json) is built from it,
# so a new kind goes at the end.
STATUS_KINDS = (
    "lesson_buff",                    # 集中
    "review",                         # 好印象
    "aggressive",                     # やる気
    "full_power_point",               # 全力値
    "enthusiastic",                   # 熱意
    "anti_debuff",                    # 低下状態無効 (count)
    "parameter_buff",                 # 好調 (turns)
    "parameter_buff_multiple",        # 絶好調 (turns)
    "stance_lock",                    # 指針固定 (turns)
    "lesson_debuff",                  # 集中減少 / 弱気 value
    "stamina_consumption_down",       # 消費体力減少 (turns)
    "stamina_consumption_add",        # 消費体力増加 (turns)
    "stamina_consumption_down_fix",   # 消費体力削減 (value)
    "stamina_consumption_add_fix",    # 消費体力追加 (value, layers)
    "block_restriction",              # 元気増加無効 (turns)
    "block_add_down",                 # 元気増加量減少 (turns)
    "block_add_down_fix",             # 元気増加量減少 (value)
    "stamina_recover_restriction",    # 体力回復無効 (turns)
    "stamina_recover_add",            # 体力回復量増加
    "buff_consumption_add",           # 強化状態コスト増加 (turns)
    "slump",                          # スランプ (turns)
    "gimmick_parameter_debuff",       # 審査ギミック: パラメータ低下 (turns)
    "panic",                          # パニック (turns)
    "card_draw_down",                 # 手札減少 (this turn)
    "play_card_limit",                # スキルカード使用制限 (one per limit)
    "lesson_parameter_multiple",      # パラメータ上昇量増加 (layer)
    "lesson_parameter_multiple_down", # パラメータ上昇量減少 (layer)
    "lesson_buff_multiple",           # 集中効果増加 (layer)
    "review_multiple",                # 好印象効果増加 (layer)
    "review_count_add",               # 好印象強化 (layer)
    "full_power_lesson_multiple_add", # 全力の効果増加 (layer)
    "concentration_lesson_multiple_add",  # 強気の効果増加 (layer)
    "full_power_point_add",           # 全力値獲得量増加 (layer)
    "enthusiastic_add",               # 熱意獲得量増加 (layer)
    "lesson_parameter_depend",        # パラメータ上昇量が好印象/やる気に依存 (turns)
    "timed_gain",                     # 時限の獲得量増加 of a kind not listed below (layer)
    "extra_turn",                     # 追加ターン
    # the timed 獲得量 layers by what they raise (ExamState._TIMED_GAIN_KINDS), appended in SX-04-01
    "lesson_buff_gain_multiple",      # 集中獲得量増加 (multiplier)
    "parameter_buff_gain_multiple",   # 好調獲得量増加
    "aggressive_gain_multiple",       # やる気獲得量増加
    "review_gain_multiple",           # 好印象獲得量増加
    "lesson_buff_gain_fix",           # 集中獲得量 +n
    "aggressive_gain_fix",            # やる気獲得量 +n
    "parameter_buff_gain_fix",        # 好調獲得量 +n
    "enthusiastic_gain_permil",       # 熱意増加 (permil)
    # v2 (SX-04-19)
    "full_power_point_gain_permil",   # 全力値獲得量増加 (permil)
)
N_STATUS_V1 = STATUS_KINDS.index("enthusiastic_gain_permil") + 1
TIMED_GAIN_KIND = {
    "lesson_buff_additive_multiple": "lesson_buff_gain_multiple",
    "parameter_buff_additive_multiple": "parameter_buff_gain_multiple",
    "aggressive_additive_multiple": "aggressive_gain_multiple",
    "review_additive_multiple": "review_gain_multiple",
    "lesson_buff_additive_fix": "lesson_buff_gain_fix",
    "aggressive_additive_fix": "aggressive_gain_fix",
    "parameter_buff_additive_fix": "parameter_buff_gain_fix",
    "enthusiastic_multiple_permil": "enthusiastic_gain_permil",
}
STANCES = ("Preservation", "OverPreservation", "Leisurely", "Concentration", "FullPower")
STEPS = ("AUDITION_MID1", "AUDITION_MID2", "AUDITION_FINAL")
PRODUCES = ("produce-007", "produce-008")
ORIGINS = ("pool", "idol", "support", "trouble")

_SCALARS = (                               # kind, attribute (value only, no turn limit)
    ("lesson_buff", "lesson_buff"),
    ("review", "review"),
    ("aggressive", "aggressive"),
    ("full_power_point", "full_power_point"),
    ("enthusiastic", "enthusiastic_buff"),
    ("anti_debuff", "anti_debuff"),
    ("stamina_consumption_down_fix", "stamina_consumption_down_fix"),
    ("block_add_down_fix", "block_add_down_fix"),
    ("stamina_recover_add", "stamina_recover_add"),
    ("extra_turn", "extra_turns"),
    ("full_power_point_gain_permil", "full_power_point_additive_permil"),
)
_UNTIL = (                                 # kind, flag attribute (None: the until alone decides), until attribute
    ("parameter_buff_multiple", "parameter_buff_multiple_per_turn", "parameter_buff_multiple_until_turn"),
    ("stamina_consumption_down", "stamina_consumption_down", "stamina_consumption_down_until_turn"),
    ("stamina_consumption_add", "stamina_consumption_add", "stamina_consumption_add_until_turn"),
    ("block_restriction", "block_restriction", "block_restriction_until_turn"),
    ("block_add_down", "block_add_down", "block_add_down_until_turn"),
    ("stamina_recover_restriction", "stamina_recover_restriction", "stamina_recover_restriction_until_turn"),
    ("buff_consumption_add", "buff_consumption_add", "buff_consumption_add_until_turn"),
    ("slump", "slump", "slump_until_turn"),
    ("gimmick_parameter_debuff", "gimmick_parameter_debuff", "gimmick_parameter_debuff_until_turn"),
    ("panic", None, "panic_until_turn"),
    ("lesson_parameter_depend", "lesson_parameter_multiple_depend_review_or_aggressive",
     "lesson_parameter_multiple_depend_until_turn"),
)
_LAYERS = (
    ("lesson_parameter_multiple", "lesson_parameter_multiple_layers"),
    ("lesson_parameter_multiple_down", "lesson_parameter_multiple_down_layers"),
    ("lesson_buff_multiple", "lesson_buff_multiple_layers"),
    ("review_multiple", "review_multiple_layers"),
    ("review_count_add", "review_count_add_layers"),
    ("full_power_lesson_multiple_add", "full_power_lesson_multiple_additive_layers"),
    ("concentration_lesson_multiple_add", "concentration_lesson_multiple_additive_layers"),
    ("full_power_point_add", "full_power_point_additive_layers"),
    ("enthusiastic_add", "enthusiastic_additive_layers"),
    ("stamina_consumption_add_fix", "stamina_consumption_add_fix_layers"),
    ("lesson_debuff", "lesson_debuff_layers"),
)
INF = -1


def card_spec(inst, playable=None):
    d = {"id": inst["produce_card_id"], "u": int(inst.get("current_upgrade_count") or 0)}
    cz = inst.get("customizes") or ()
    if cz:
        d["c"] = [[c["id"], int(c.get("customize_count", c.get("count", 1)) or 1)] for c in cz]
    g = inst.get("dynamic_grow_effect_ids") or ()
    if g:
        d["g"] = list(g)
    if playable is not None:
        d["p"] = int(bool(playable))
    return d


def _sort_key(c):
    return (c["id"], c["u"], str(c.get("c")), str(c.get("g")))


def _multiset(cards):
    return sorted((card_spec(c) for c in cards), key=_sort_key)


def _turns_left(state, until):
    """Turns a status still lasts as the screen counts them; INF for a permanent one, None when it is over."""
    if until is None:
        return None
    if until == -1 or until == float("inf"):
        return INF
    left = int(until) - int(state.turn) + 1
    return left if left > 0 else None


def _layer(state, layer):
    """(value, turns left) of one timed layer, tuple or dict shaped."""
    if isinstance(layer, dict):
        value = layer.get("value", 0)
        until, fresh = layer.get("expire", layer.get("until_turn")), layer.get("fresh", 0)
    else:
        value, until = layer[0], layer[1] if len(layer) > 1 else None
        fresh = layer[2] if len(layer) > 2 else 0
    if until is None or until == -1 or until == float("inf"):
        return value, INF
    # the client's count (engine rev168, HIF-130 G1): a layer created after this turn's passing mark (fresh = this
    # turn) is not spent yet -- until - turn; any other one is spent at this turn's end -- until - turn + 1.  The
    # Python state's _layer_left did this; the native state view (rev294b) has no such method.
    turn = int(state.turn)
    left = int(until) - turn + (0 if int(fresh or 0) == turn else 1)
    return value, left


def statuses(state, turn):
    out = []
    for kind, attr in _SCALARS:
        v = getattr(state, attr, 0) or 0
        if v:
            out.append([kind, float(v), INF])
    if getattr(state, "parameter_buff_remaining", 0):
        out.append(["parameter_buff", float(state.parameter_buff_remaining), int(state.parameter_buff_remaining)])
    if getattr(state, "stance_lock_turns", 0):
        out.append(["stance_lock", 1.0, int(state.stance_lock_turns)])
    for kind, flag, until_attr in _UNTIL:
        if flag is not None and not getattr(state, flag, False):
            continue
        left = _turns_left(state, getattr(state, until_attr, None))
        if left is None:
            if flag is None:
                continue
            left = INF
        out.append([kind, 1.0, left])
    for kind, attr in _LAYERS:
        for layer in getattr(state, attr, None) or ():
            value, left = _layer(state, layer)
            if left is not None and (left == INF or left > 0):
                out.append([kind, float(value), left])
    for name, layers in sorted((getattr(state, "_timed_gain_layers", None) or {}).items()):
        for layer in layers:
            value, left = _layer(state, layer)
            if left is not None and (left == INF or left > 0):
                out.append([TIMED_GAIN_KIND.get(name, "timed_gain"), float(value), left])
    down = state.card_draw_down_for(turn) if hasattr(state, "card_draw_down_for") else 0
    if down:
        out.append(["card_draw_down", float(down), 1])
    for _search, until in getattr(state, "play_card_limits", None) or ():
        left = _turns_left(state, until)
        out.append(["play_card_limit", 1.0, INF if left is None else left])
    return out


def enchants(state):
    out = []
    for ts in state.trigger_effect_states:
        limit = int(ts.get("limit_count", -1) if ts.get("limit_count") is not None else -1)
        left = INF if limit < 0 else max(0, limit - int(ts.get("spent_total") or 0))
        if limit >= 0 and left == 0:
            continue                               # used up: the icon is gone
        turns = ts.get("remaining_turns")
        out.append([ts.get("enchant_id"), left, INF if turns is None else int(turns)])
    return out


def timers(state):
    """[turns until it fires, effect id, at the turn's end] of every queued effect, soonest first."""
    out = []
    turn = int(state.turn)
    for name, at_end in (("effect_timer_queue", 0), ("end_turn_timer_queue", 1)):
        q = getattr(state, name, None) or {}
        for t, ids in sorted((int(k), v) for k, v in dict(q).items()):
            for x in ids or ():
                out.append([max(0, t - turn), str(x).lstrip("~"), at_end])
    return out


def costs(state):
    return [[c.get("search"), int(c["value"]), int(c["remaining"])]
            for c in getattr(state, "play_card_cost_changes", None) or () if int(c.get("remaining") or 0) > 0]


def play_counts(state):
    out, turn = [], int(state.turn)
    for b in getattr(state, "effect_play_count_buffs", None) or ():
        until = b.get("until_turn")
        if until is not None and int(until) != -1 and turn > int(until):
            continue
        left = INF if until is None or int(until) == -1 else int(until) - turn + 1
        out.append([b.get("search_id"), int(b["repeat_count"]), int(b["remaining_uses"]), left])
    return out


def v1_view(o):
    """The v1 document of a v2 one: the v2 keys dropped, the status kinds v1 lacks dropped."""
    if o.get("v") == "uiobs.v1":
        return o
    v1 = set(STATUS_KINDS[:N_STATUS_V1])
    out = {k: v for k, v in o.items() if k not in V2_KEYS}
    out["status"] = [s for s in o.get("status") or () if s[0] in v1]
    out["v"] = "uiobs.v1"
    return out


def from_session(session, exam, played=()):
    """The UIObs of a live engine session.  ``exam`` holds what the round's builder knows (``exam_context``);
    ``played`` the specs of the cards played this turn (the caller tracks them, see uinet.env)."""
    st, deck = session.state, session.deck
    turn = int(session.turn)
    legal = session.legal_actions()
    playable = {a[1] for a in legal if a[0] == "play"}
    hand = [card_spec(c, i in playable) for i, c in enumerate(deck.hand)]
    return {
        "v": SCHEMA,
        "exam": dict(exam, turn=turn, limit=int(session.config.limit_turn) + int(getattr(st, "extra_turns", 0) or 0)),
        "num": {"score": int(st.score), "stamina": int(st.stamina), "max_stamina": int(st.max_stamina),
                "block": int(st.block), "playable": int(st.playable), "plays": int(st.turn_play_count)},
        "stance": [st.idol_status_type, int(st.idol_status_step_count or 0)],
        "status": statuses(st, turn),
        "ench": enchants(st),
        "hand": hand,
        "deck": _multiset(deck.deck),
        "grave": _multiset(deck.grave),
        "hold": _multiset(deck.hold),
        "lost": _multiset(deck.lost),
        "played": list(played),
        "drinks": list(session.drinks),
        "legal": [list(a) for a in legal],
        "timers": timers(st),
        "costs": costs(st),
        "pcount": play_counts(st),
    }


def exam_context(session, meta, loadout):
    """The fixed part of ``exam`` for one round."""
    types = list(getattr(session.deck, "turn_parameter_types", None) or ())
    permils = session.config.audition_permils or {}
    crit = meta.get("criteria") or {}
    return {"produce": meta.get("produce_id"), "step": meta.get("step_type"), "plan": int(meta.get("plan_type") or 0),
            "idol": loadout.get("idol_card_id"), "types": [int(t) for t in types],
            "permil": [int(permils.get(k, 0) or 0) for k in (1, 2, 3)],
            "crit": [int(crit.get(k, crit.get(str(k), 0)) or 0) for k in (1, 2, 3)]}
