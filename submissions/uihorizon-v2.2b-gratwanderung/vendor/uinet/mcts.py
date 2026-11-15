"""P3: a search over what the screen shows (single-observer information-set MCTS), the improvement operator of
expert iteration.  Used only in training; the released network never searches.

Each simulation starts from the root's screen with a freshly drawn hidden state -- the draw pile reshuffled, the RNG
random, what the screen leaves open -- and walks down a tree whose nodes are *screens* (UIObs, canonical JSON), not
engine states.  A draw that differs leads to a different child, so every choice in the tree depends only on what
the player would see: no strategy fusion (the per-world teacher T searches each world as if its future were known).

Selection is PUCT with the network's policy as prior; a new screen is evaluated by the network's value head
(median quantile, log(final score) - VALUE_SHIFT); a finished battle by its real score.  Q values are min-max
normalised over the tree.  The root's visit counts are the policy target.
"""
from __future__ import annotations

import json
import math
import random

import numpy as np

from . import engine

C_PUCT = 1.25


def obs_key(o):
    return json.dumps({k: o[k] for k in o if k != "legal"}, sort_keys=True, separators=(",", ":"))


class Node:
    __slots__ = ("prior", "n", "w", "children", "value")

    def __init__(self, prior, value):
        self.prior = prior            # np.array over legal actions
        self.n = np.zeros(len(prior), np.float64)
        self.w = np.zeros(len(prior), np.float64)
        self.children = {}            # action index -> {screen key: Node}
        self.value = value


class Searcher:
    def __init__(self, net, sims=32, rng=None, dirichlet=0.3, noise=0.25):
        """``net(obs) -> (prior over obs['legal'], value)``."""
        self.net, self.sims, self.rng = net, sims, rng or random.Random(0)
        self.dirichlet, self.noise = dirichlet, noise
        self.lo, self.hi = math.inf, -math.inf

    def _norm(self, q):
        if self.hi <= self.lo:
            return 0.5
        return (q - self.lo) / (self.hi - self.lo)

    def _see(self, v):
        self.lo, self.hi = min(self.lo, v), max(self.hi, v)

    def _expand(self, battle):
        from .encode import VALUE_SHIFT
        if battle.finished:
            return None, math.log(max(1, battle.score)) - VALUE_SHIFT
        o = battle.obs()
        prior, value = self.net(o)
        return Node(np.asarray(prior, np.float64), float(value)), float(value)

    def _select(self, node):
        total = node.n.sum()
        q = np.where(node.n > 0, node.w / np.maximum(node.n, 1), node.value)
        qn = np.array([self._norm(x) for x in q])
        u = C_PUCT * node.prior * math.sqrt(total + 1) / (1 + node.n)
        return int(np.argmax(qn + u))

    def _world(self, root_battle):
        b = root_battle.clone()
        b.session.deck.rng.state = self.rng.getrandbits(32) or 1
        engine.shuffle_pile(b.session, self.rng)
        return b

    @staticmethod
    def _advance(battle, k):
        """Play legal action k, then every forced step (one legal action)."""
        battle.step(battle.legal()[k])
        while not battle.finished and len(battle.legal()) == 1:
            battle.step(battle.legal()[0])

    def run(self, battle):
        """(visit counts over battle.legal(), root value estimate)."""
        root, v0 = self._expand(battle)
        self._see(v0)
        if self.noise and len(root.prior) > 1:
            d = np.asarray([self.rng.gammavariate(self.dirichlet, 1) for _ in root.prior])
            root.prior = (1 - self.noise) * root.prior + self.noise * d / d.sum()
        for _ in range(self.sims):
            b = self._world(battle)
            node, path = root, []
            while True:
                k = self._select(node)
                path.append((node, k))
                self._advance(b, k)
                key = "END" if b.finished else obs_key(b.obs())
                child = node.children.setdefault(k, {}).get(key)
                if child is None or b.finished:
                    if b.finished:
                        from .encode import VALUE_SHIFT
                        value = math.log(max(1, b.score)) - VALUE_SHIFT
                    else:
                        child, value = self._expand(b)
                        node.children[k][key] = child
                    break
                node = child
            self._see(value)
            for nd, k in path:
                nd.n[k] += 1
                nd.w[k] += value
        return root.n.copy(), (root.w.sum() / max(1, root.n.sum()))


def torch_net(model, enc):
    """The ``net`` callable of a UINet: softmax prior over the legal actions and the median value."""
    import torch
    from .model import to_torch

    def net(o):
        with torch.no_grad():
            logit, _adv, value = model(*to_torch(enc.encode(o)))
        n = len(o["legal"])
        return torch.softmax(logit[0, :n], -1).numpy(), float(value[0, 2])
    return net
