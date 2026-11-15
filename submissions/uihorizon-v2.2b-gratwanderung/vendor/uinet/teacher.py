"""The search teachers: per legal action, the mean final score over sampled worlds.

    mode "ui"   a world is what the screen leaves open: the draw pile reshuffled, the RNG state random
                (norng's ``shuffle_pa``: 0.683 of the known-RNG play on 5 loadouts, GKMSResearch
                research/norng_20261023/README.md).  This is teacher T and arm T of the plan (section 5).
    mode "rng"  the true state in every world, only the search seed differs (norng's ``true_pa``): arm K, the
                normaliser of every score ratio.

Every action of one decision is scored in the same K worlds (common random numbers).  A world's value is the
native GNRPA search (production prior, ``transitions`` per search, search seed 182 + k) from the state after the
action, or the score when the action ended the battle.  A state the native core refuses is played out by the
engine's greedy policy instead and counted in ``fallbacks``.
"""
from __future__ import annotations

import random
import time

from . import engine


class _CachedPriorSearch:
    """NativeSearch whose prior table is built once per (round, drinks held): it reads only the master, the
    round's cards and the drinks, and rebuilding it for every world was a large share of a label's time."""

    def __init__(self, ns):
        self.ns = ns
        self._orig = ns.prior_table
        self._tables = {}
        ns.prior_table = self._prior_table

    def _prior_table(self, session, prior, nat=None):
        """NativeSearch.prior_table(session, prior, nat=None); NAT (a search on another core, engine rev29x) is not
        part of the key -- the table reads the master, the round's cards and the drinks only."""
        key = (session.config.segment_id, session.config.seed, tuple(session.drinks), id(prior))
        hit = self._tables.get(key)
        if hit is None:
            if len(self._tables) > 64:
                self._tables.clear()
            hit = self._tables[key] = self._orig(session, prior) if nat is None else self._orig(session, prior, nat)
        return hit


_SEARCH = None


def search():
    global _SEARCH
    if _SEARCH is None:
        nat = engine.native()
        if nat is None:
            raise RuntimeError(f"native core missing: {engine.native_lib_path()} (run GakumasCLI/native/build.sh)")
        # the master's reference map is the same for every search of the process (master tables never change)
        from GakumasCLI.native import portable as P
        orig, cache = P.master_refmap, {}

        def master_refmap(master):
            hit = cache.get(id(master))
            if hit is None:
                hit = cache[id(master)] = orig(master)
            return hit
        P.master_refmap = master_refmap
        _SEARCH = _CachedPriorSearch(nat[1])
    return _SEARCH.ns


def _greedy_value(session):
    from GakumasCLI.scenario.exam_session import greedy_policy
    s = session.clone()
    while not s.finished:
        choice = greedy_policy(s, list(s.deck.hand))
        s.step(("end",) if choice is None else ("play", int(choice)), observe=False)
    return int(s.state.score)


class Teacher:
    def __init__(self, worlds=8, transitions=20000, mode="ui", stabilization=3):
        if mode not in ("ui", "rng"):
            raise ValueError(mode)
        self.worlds, self.transitions, self.mode, self.stabilization = worlds, transitions, mode, stabilization
        self.fallbacks = 0
        self.searches = 0
        self.seconds = 0.0

    def params(self):
        return {"mode": self.mode, "worlds": self.worlds, "transitions": self.transitions,
                "stabilization": self.stabilization, "prior": str(engine.PRIOR.relative_to(engine.PROJECT))}

    def _world(self, session, state, order):
        c = session.clone()
        if self.mode == "ui":
            c.deck.rng.state = state
            engine.shuffle_pile(c, random.Random(order))
        return c

    def _value(self, session, k):
        ns = search()
        ns._cache = None
        _path, st = ns.policy_search(session, transitions=self.transitions, seed=182 + k,
                                     prior=engine.prior(), stabilization=self.stabilization)
        self.searches += 1
        if int(st.get("status", 0)) != 0:
            self.fallbacks += 1
            return _greedy_value(session)
        return max(int(st["best_score"]), int(session.state.score))

    def values(self, session, rng, legal=None):
        """(legal actions, values[a][k]) for the session's current decision; the session is not touched."""
        t0 = time.perf_counter()
        legal = list(legal if legal is not None else session.legal_actions())
        worlds = [(rng.getrandbits(32) or 1, rng.getrandbits(32)) for _ in range(self.worlds)]
        out = []
        for a in legal:
            row = []
            for k, (state, order) in enumerate(worlds):
                c = self._world(session, state, order)
                c.step(tuple(a), observe=False)
                row.append(int(c.state.score) if c.finished else self._value(c, k))
            out.append(row)
        self.seconds += time.perf_counter() - t0
        return legal, out


def best(values):
    """Index of the action with the highest mean."""
    means = [sum(v) / len(v) for v in values]
    return max(range(len(means)), key=means.__getitem__)
