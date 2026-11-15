"""The v2 encoder plus the draw pile's order.

Encoder2 leaves t_ext columns 0-5 of a pile card at zero (they are the hand position / playable flag of a hand card
and the uses / turns left of an enchant or a reserved effect); columns 6-14 carry the card relations for every card
and stay as they are.  For an observation with ``order`` (uihorizon.hobs: ``deck`` listed in draw order), the pile
card at draw position p (0 = the next card drawn) gets

    col 0   1 / (1 + p)              nearness of the draw
    col 2   min(p, 30) / 10          the position itself
    col 3   1                        the order is known
    col 4   min(p // 3, 20) / 10     turns until it is drawn at three cards a turn (0 = the next draw)

The array widths do not change, so a GKMSUINet v2 checkpoint (G2) loads as the initial weights.  Without ``order``
the output is Encoder2's.
"""
from __future__ import annotations

import numpy as np

from uinet.encode2 import KIND_DECK, Encoder2

DRAW = 3                              # cards drawn at a turn's start


class HorizonEncoder(Encoder2):
    def compact(self, o):
        s = super().compact(o)
        if o.get("order"):
            ext = s["t_ext"]
            for p, t in enumerate(np.nonzero(s["t_kind"] == KIND_DECK)[0]):
                ext[t, 0] = 1.0 / (1.0 + p)
                ext[t, 2] = min(p, 30) / 10.0
                ext[t, 3] = 1.0
                ext[t, 4] = min(p // DRAW, 20) / 10.0
        return s
