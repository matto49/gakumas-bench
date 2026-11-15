"""One H.I.F battle as an environment: reset from a loadout and a seed, observe the screen (UIObs), step.

A thin wrapper over the engine's ``ExamSession`` (legal_actions / step / clone, TL-127).  It adds what the session
does not keep: the cards played this turn (the screen shows them; the session log has names only) and the
round's fixed exam context.  Card picks (選択) are the engine's deterministic picker in v1
(``greedy_select_policy``, scenario/hif.py patch DH); ``picks`` counts how often one was needed.
"""
from __future__ import annotations

import random

from . import engine
from .uiobs import card_spec, exam_context, from_session


class Battle:
    def __init__(self, loadout, seed=None):
        self.loadout = loadout
        self.session, self.meta = engine.build(loadout, seed)
        self.exam = exam_context(self.session, self.meta, loadout)
        self.played = []
        self._turn = self.session.turn
        self.steps = 0

    @classmethod
    def random(cls, loadout, rng):
        lo = dict(loadout)
        lo["seed"] = rng.randrange(1, 2 ** 31 - 1)
        return cls(lo)

    # -- the screen
    def obs(self):
        return from_session(self.session, self.exam, self.played)

    @property
    def finished(self):
        return self.session.finished

    @property
    def score(self):
        return int(self.session.state.score)

    def legal(self):
        return self.session.legal_actions()

    def picks(self):
        return len(getattr(self.session.deck, "select_choices", None) or ())

    # -- acting
    def step(self, action):
        action = tuple(action)
        s = self.session
        spec = card_spec(s.deck.hand[action[1]]) if action[0] == "play" else None
        s.step(action, observe=False)
        self.steps += 1
        if s.turn != self._turn or s.finished:
            self._turn = s.turn
            self.played = []
        elif spec is not None:
            self.played.append(spec)

    def clone(self):
        b = object.__new__(Battle)
        b.loadout, b.meta, b.exam = self.loadout, self.meta, self.exam
        b.session = self.session.clone()
        b.played = list(self.played)
        b._turn, b.steps = self._turn, self.steps
        return b


def play_out(battle, policy, rng=None):
    """Run ``policy(battle) -> action`` to the end; the final score."""
    rng = rng or random.Random(0)
    while not battle.finished:
        battle.step(policy(battle))
    return battle.score
