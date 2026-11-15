"""The draw order as a screen shows it: the deck cards in the order they left the draw pile, from UIObs alone.

    inv = invariant_hand(opening_hands)     the part of the opening hand that does not depend on the seed (cards the
                                            exam places in the hand or creates), from the openings of several seeds
    d = Draws(pre, inv)                     pre: the card ids of the deck before the opening shuffle
    d.update(obs)                           at every observation, the first one included
    d.seen                                  the ids of the cards drawn so far, in draw order
    d.skip                                  deck cards that left the pile without being drawn (placed in the opening
                                            hand, or removed by an effect): the seed scan passes over them
    d.open                                  False once the order can no longer be read: cards went into the pile
                                            (a reshuffle, a created card)

Cards are named by id alone: an exam can upgrade a card it holds, the id stays.  A card that leaves the pile shows
up in the hand; cards drawn together appear in the hand in draw order, after the cards already held.  The pile in an
observation is a set without order, so the order comes from the hand alone.
"""
from collections import Counter


def invariant_hand(hands):
    """The multiset of card ids every one of HANDS (lists of ids) holds."""
    inv = Counter(hands[0])
    for h in hands[1:]:
        inv &= Counter(h)
    return inv


class Draws:
    def __init__(self, pre, inv=None):
        self.pre = Counter(pre)
        self.inv = Counter(inv or ())
        self.left = None
        self.seen = []
        self.skip = Counter()                 # deck cards that left the pile without being drawn
        self.open = True

    def update(self, obs):
        if not self.open:
            return
        left = self.pre - Counter(c["id"] for c in obs["deck"])          # deck cards no longer in the pile
        hand = [c["id"] for c in obs["hand"]]
        if self.left is None:                                            # the opening: placed / created cards first
            skip, order = Counter(self.inv), []
            for x in hand:
                if skip[x] > 0:
                    skip[x] -= 1
                else:
                    order.append(x)
            rest, drawn = Counter(left), []
            for x in order:                                              # a hand card that is not from the deck was
                if rest[x] > 0:                                          # created by the exam: not a draw
                    rest[x] -= 1
                    drawn.append(x)
            self.skip = rest                                             # deck cards the opening took out of the pile
            self.seen += drawn
            self.left = left
            return
        if self.left - left:                                             # cards went back into the pile
            self.open = False
            return
        need = left - self.left
        if need:
            order = []
            for x in reversed(hand):                                     # the newest cards are the last in the hand
                if need[x] > 0:
                    need[x] -= 1
                    order.append(x)
            self.skip += need                                            # left the pile without showing in the hand:
            self.seen += reversed(order)                                 # removed by an effect, passed over in the order
        self.left = left
