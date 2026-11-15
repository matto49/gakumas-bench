"""What a round's public configuration fixes about its opening, whatever the seed.

The same reading of the engine as GKMSProject GakumasCLI/tools/hif_seed_solve.py (``capture_opening`` /
``turn_pool``), kept here so the adapter needs only the engine itself.
"""
from __future__ import annotations

import math


def opening(master, loadout, seed):
    """(card ids of the deck before the opening shuffle, RNG calls before the shuffle, the opened session)."""
    from GakumasCLI.native.native_session import open_loading
    from GakumasCLI.scenario.exam_session import deferred_open
    from GakumasCLI.scenario.hif import build_hif_loadout_session
    doc = dict(loadout, seed=int(seed))
    with deferred_open():
        loading, _meta = build_hif_loadout_session(master, doc)
    dk = loading.deck
    pre = [c["produce_card_id"] for c in dk.deck]
    if dk.audition_parameter_values is not None:      # the turn attributes (limit_turn - 3 calls), then the NPC's
        k = max(0, int(dk.audition_limit_turn) - 3) + int(dk.audition_npc_rng_advances or 0)
    else:
        k = int(dk.segment_start_rng_advances or 0)
    return pre, k, open_loading(loading, doc)


def turn_pool(session):
    """(the pool the turn attributes are drawn from, in the engine's order; how many turns draw from it), or
    (None, 0) for a round without attributes."""
    from GakumasCLI.engine.card_data import _f32 as f32
    values = session.deck.audition_parameter_values
    if values is None:
        return None, 0
    limit = int(session.deck.audition_limit_turn)
    (t0, p0), (t1, p1), (t2, p2) = sorted(values.items(), key=lambda item: -item[1])
    mutable = limit - 3
    c0 = math.ceil(f32(f32(f32(mutable) * f32(p0)) / f32(p0 + p1 + p2)))
    remaining = mutable - c0
    c1 = round(f32(f32(f32(remaining) * f32(p1)) / f32(p1 + p2)))
    return [t0] * c0 + [t1] * c1 + [t2] * (remaining - c1), mutable
