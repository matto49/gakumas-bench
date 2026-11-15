"""Decision states to measure on: the recorded human plays of the pool (history rounds) replayed in the engine.

A history round carries the player's actions (``["play", i]``, ``["drink", i]``, ``["end"]`` and ``["select",
[...]]`` picker answers).  As gates/measure70.py does, every picker answer is queued before the replay and the other
actions are stepped; the replay is exact when it ends on the recorded score.
"""
from __future__ import annotations

import random

from .env import Battle


def replay(item, stop_at=None):
    """(battle, decisions, exact): the round replayed to the end, or up to STOP_AT decisions (len(legal) > 1)."""
    b = Battle(item["loadout"])
    acts = item.get("actions") or []
    b.session.state.select_index_queue = [list(a[1]) for a in acts if a[0] == "select"]
    n = 0
    for a in acts:
        if a[0] == "select":
            continue
        if b.finished:
            return b, n, False
        a = tuple(a)
        legal = b.legal()
        if a not in legal:
            return b, n, False
        if len(legal) > 1:
            if stop_at is not None and n >= stop_at:
                return b, n, None
            n += 1
        b.step(a)
    exact = b.finished and item.get("recorded_score") is not None and b.score == int(item["recorded_score"])
    return b, n, exact


def sample_decisions(items, per_round, rng):
    """[(item key, decision index, battle at that decision)] -- PER_ROUND decision points of each exact replay."""
    out = []
    for it in items:
        if not it.get("actions"):
            continue
        _b, n, exact = replay(it)
        if not exact or n == 0:
            continue
        for d in sorted(rng.sample(range(n), min(per_round, n))):
            b, _n, _e = replay(it, stop_at=d)
            out.append((it["key"], d, b))
    return out


def rng_for(*parts):
    return random.Random("/".join(str(p) for p in parts))
