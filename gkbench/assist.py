"""出牌助手（网页 /assist）的一局：GKMS 引擎推进，UINet 给建议。

两种用法：
  实战同步（practice=False）：引擎每次往手牌里加了牌（回合开始抽牌、卡牌效果抽牌、生成卡），都停下来等玩家把手牌
      核对成画面上的那一手（set_hand），才给建议、才接受出牌。引擎自己抽到的牌不算数，所以建议只依赖画面上的信息。
  练习模拟（practice=True）：引擎按随机种子自己抽，玩家照建议或自己选，打到结束。

选牌（卡牌效果要你从几张里挑）由引擎默认挑法自动完成；挑完手牌有新牌也会进核对。
每次改局面前存一份快照，undo 退回上一步，最多留 MAX_UNDO 步。
"""
from __future__ import annotations

import secrets
from collections import Counter

from . import engine

MAX_UNDO = 300
PILES = ("hand", "deck", "grave", "hold", "lost")
NUMBERS = ("stamina", "max_stamina", "block", "review", "aggressive", "lesson_buff", "full_power_point")


class AssistError(ValueError):
    pass


def _card(c) -> list:
    return [c.get("produce_card_id"), int(c.get("current_upgrade_count", 0) or 0)]


class AssistSession:
    def __init__(self, loadout: dict, practice: bool = False, seed: int | None = None, policy=None):
        engine.setup()
        from uinet.env import Battle
        from .save import expand_loadout
        lo = {k: v for k, v in expand_loadout(loadout).items() if not k.startswith("_") and k not in ("source", "seed")}
        lo["seed"] = int(seed) if seed else secrets.randbelow(2 ** 31 - 2) + 1
        self.battle = Battle(lo)
        self.practice = bool(practice)
        self.policy = policy
        self.awaiting = not self.practice and not self.battle.finished
        self.history: list = []
        self.imported = None                              # GR1 导入：{"plays": 重放成功几步, "total": 码里几步}

    @classmethod
    def from_code(cls, code: str, practice: bool = False, policy=None) -> "AssistSession":
        """GA1 编成码：按编成开新局。GR1 对局码（GKMS「导出 GKMSUINet」）：用码里的种子把局面重放到玩家现在的位置，
        再把隐藏信息（山札顺序、随机数、三处种子）全换掉——之后的建议和练习不再依赖真种子。
        重放到某一步走不下去（客户端版本不同等）就停在上一步，view 的 imported 写明走了几步。"""
        from .assist_code import parse_code
        c = parse_code(code)
        if c["kind"] == "GA" or c["seed"] is None:
            return cls(c["loadout"], practice=practice, policy=policy)
        s = cls(c["loadout"], practice=practice, seed=c["seed"], policy=policy)
        done = 0
        for a in c["plays"]:
            try:
                act = ("select", [int(i) for i in a[1]]) if a[0] == "select" else tuple(a)
                if act[0] != "select" and act not in [tuple(x) for x in s.battle.legal()]:
                    break
                s.battle.step(act)
            except Exception:
                break
            done += 1
            if s.battle.finished:
                break
        s._scrub()
        s.awaiting = False                                # 重放出来的手牌就是玩家画面上的那一手
        s.imported = {"plays": done, "total": len(c["plays"])}
        return s

    def _scrub(self):
        import random
        from .worlds import _scrub_seed
        rng = random.Random(secrets.randbits(64))
        sess = self.session

        def reshuffle(view):
            rng.shuffle(view.deck.deck)

        if getattr(sess, "native", False):
            sess.edit(reshuffle)
        else:
            reshuffle(sess)
        sess.deck.rng.state = rng.getrandbits(32) or 1
        _scrub_seed(sess, rng)
        self.battle.loadout = dict(self.battle.loadout, seed=(getattr(sess, "_loadout", None) or {}).get("seed")
                                   or rng.randrange(1, 2 ** 31 - 1))

    # -- 读
    @property
    def session(self):
        return self.battle.session

    def piles(self) -> dict:
        d = self.session.deck
        out = {}
        for name in PILES:
            pile = getattr(d, name, None)
            cards = [_card(c) for c in pile] if isinstance(pile, list) else []
            out[name] = sorted(cards) if name == "deck" else cards      # 牌堆不给顺序
        return out

    def view(self) -> dict:
        b, s = self.battle, self.session
        obs = b.obs()
        st = s.state
        advice = None
        if self.policy is not None and not self.awaiting and not b.finished and obs.get("legal"):
            out = self.policy(obs)
            probs = [float(p) for p in out["probs"]]
            advice = {"probs": probs, "best": max(range(len(probs)), key=probs.__getitem__),
                      "score_quantiles": out.get("score_quantiles")}
        return {"obs": obs, "piles": self.piles(), "awaiting_hand": self.awaiting, "practice": self.practice,
                "finished": bool(b.finished), "score": int(st.score), "turn": int(s.turn),
                "limit_turn": (b.meta or {}).get("limit_turn"),
                "numbers": {k: getattr(st, k, None) for k in NUMBERS},
                "can_undo": bool(self.history), "advice": advice, "imported": self.imported}

    # -- 改
    def _push(self):
        self.history.append((self.battle.clone(), self.awaiting))
        if len(self.history) > MAX_UNDO:
            del self.history[0]

    def set_hand(self, cards) -> dict:
        """把手牌改成玩家点的这一手：[[卡 id, 强化数], ...]。先从手牌、牌堆里找，都没有就按考试中生成的卡处理；
        引擎原来手里、玩家没点的牌放回牌堆（它们其实没被抽到）。"""
        if self.battle.finished:
            raise AssistError("这一局已经打完了")
        want = [(str(c[0]), int(c[1] or 0)) for c in cards]
        master = self.session.deck.card_master        # {(卡 id, 强化数): 定义}
        for cid, up in want:
            if (cid, up) not in master:
                raise AssistError(f"没有这张卡：{cid}（强化 {up}）")
        from GakumasCLI.session.hif_degraded import realign
        d = self.session.deck
        hand_now = [(c.get("produce_card_id"), int(c.get("current_upgrade_count", 0) or 0)) for c in d.hand]
        if hand_now == want:                             # 画面上就是引擎这手牌：不动局面
            self.awaiting = False
            return self.view()
        # 牌堆保持原来的顺序，玩家点走的拿掉；引擎手里、玩家没点的放回牌堆末尾。牌堆里的牌不指定强化数：
        # 支援卡给的强化只在手牌里有效，回到牌堆就没了（clear_support 清掉）
        need = Counter(want)
        deck = []
        for c in d.deck:
            key = (c.get("produce_card_id"), int(c.get("current_upgrade_count", 0) or 0))
            if need[key] > 0:
                need[key] -= 1
            else:
                deck.append(key[0])
        for key in hand_now:
            if need[key] > 0:
                need[key] -= 1
            else:
                deck.append(key[0])
        self._push()
        try:
            realign(self.session, [c for c, _ in want], [u for _, u in want], deck=deck)
            self._clear_support_in_deck()
        except Exception as e:
            self.battle = self.history.pop()[0]
            raise AssistError(f"手牌改不过去：{e}") from None
        self.awaiting = False
        return self.view()

    def _clear_support_in_deck(self):
        def clear(view):
            d = view.deck
            for c in d.deck:
                if c.get("support_upgrade_ids"):
                    c["support_upgrade_ids"] = []
                    d.refresh_card(c)
        if getattr(self.session, "native", False):
            self.session.edit(clear)
        else:
            clear(self.session)

    def set_numbers(self, score=None, stamina=None, block=None) -> dict:
        from GakumasCLI.session.hif_degraded import set_numbers
        self._push()
        set_numbers(self.session, score=score, stamina=stamina)
        if block is not None:
            def put_block(view, value=int(block)):
                view.state.block = value
            if getattr(self.session, "native", False):
                self.session.edit(put_block)
            else:
                put_block(self.session)
        return self.view()

    def step(self, action) -> dict:
        b = self.battle
        if b.finished:
            raise AssistError("这一局已经打完了")
        if self.awaiting:
            raise AssistError("先把这回合的手牌点进来")
        action = tuple(action)
        if action not in [tuple(a) for a in b.legal()]:
            raise AssistError(f"现在不能这样出：{list(action)}")
        before = {c.get("guid") for c in self.session.deck.hand}
        self._push()
        b.step(action)
        if not self.practice and not b.finished:
            after = {c.get("guid") for c in self.session.deck.hand}
            self.awaiting = bool(after - before)          # 手里多了引擎刚放进去的牌：等玩家核对
        return self.view()

    def undo(self) -> dict:
        if not self.history:
            raise AssistError("已经退到开局了")
        self.battle, self.awaiting = self.history.pop()
        return self.view()
