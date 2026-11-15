"""After the lock: a pool of complete routes, the best one kept from decision to decision.

With the seed known the rest of the battle is one deterministic problem, and any complete route (a sequence of
actions to the end) can be replayed and its final score read.  So a decision does not have to be made from nothing:

    pool = RoutePool(net=None, workers=1)
    pool.reset()                                   at the start of a battle
    action = pool.decide(battle, seconds=..)       or transitions=N (a fixed budget, for measurements)
    pool.played(action)                            when the action played was not the one decide() returned (a
                                                   forced move, another decider): the route in hand stays in step

Every decision, proposers each give one complete route from the battle's true state:

  search     the engine's known-seed route search (uinet.teacher.search().policy_search, production prior), WORKERS
             of them side by side with different search seeds -- each runs on its own copy of the core, outside the
             interpreter lock;
  lookahead  (when NET is given) every legal action followed by the network to the end, as UIHorizon 2.0 / 2.1 did;
             the best of those is one more route.
  greedy     (when NET is given and no route is in hand) the network alone to the end: the first route in hand, so
             the pool starts from what the base network would have scored and can only add to it.

Each route is replayed on a copy of the battle; the one with the best final score replaces the route in hand when it
scores more.  The route in hand is the rest of the route followed so far, so its score is already secured: the
final score never goes down from one decision to the next, whatever a later, shorter search finds.  The first
action of the route in hand is played.

SX-05 p3/probe (24 real rounds, exam rules 57): one search of 200,000 transitions a decision with the route kept is
1.047 of the lookahead alone, at a third of its time; five times the transitions add 1%; the better of this and the
lookahead per game is 1.085 -- more proposers, not more budget.
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor


def replay(battle, route):
    """The final score of ROUTE from BATTLE (on a copy), or None when it cannot be played to the end."""
    c = battle.clone()
    try:
        for a in route:
            if c.finished:
                break
            c.step(tuple(a))
    except Exception:                                  # noqa: BLE001 -- not a route of this battle
        return None
    return c.score if c.finished else None


class RoutePool:
    def __init__(self, net=None, workers=1, stabilization=3, seed=182):
        from uinet import engine, teacher
        self.ns, self.prior = teacher.search(), engine.prior()
        self.net = net
        self.workers, self.stabilization, self.seed = max(1, int(workers)), int(stabilization), int(seed)
        self.threads = ThreadPoolExecutor(self.workers) if self.workers > 1 else None
        self.rate = None                               # transitions a second of one search, measured
        self.reset()

    def reset(self):
        self.route, self.target, self.n = [], -1, 0
        self.stats = {"searches": 0, "adopted": 0, "adopted_lookahead": 0, "bad_routes": 0, "transitions": 0}

    # -- proposers
    def _search(self, session, seed, transitions, seconds):
        try:
            path, st = self.ns.policy_search(session, transitions=transitions, deadline=seconds, seed=seed,
                                             prior=self.prior, stabilization=self.stabilization)
        except Exception:                              # noqa: BLE001 -- a state the core refuses: no proposal
            return None, None
        if int(st.get("status", 0)) != 0 or not path:
            return None, st
        return [tuple(a) for a in path], st

    def _jobs(self, battle, transitions, seconds):
        return [(battle.session, self.seed + 1009 * self.n + i, transitions, seconds) for i in range(self.workers)]

    def searches(self, battle, transitions=None, seconds=None):
        """One route per worker: (routes, transitions spent)."""
        jobs = self._jobs(battle, transitions, seconds)
        if self.threads is None:
            res = [self._search(*j) for j in jobs]
        else:
            res = list(self.threads.map(lambda j: self._search(*j), jobs))
        spent = 0 if transitions is None else transitions * len(jobs)
        self.stats["searches"] += len(jobs)
        return [r for r, _st in res if r], spent

    def greedy(self, battle):
        """The network alone from here to the end, as a route."""
        return self._rollout([battle.clone()], [[]], None)

    def lookahead(self, battle, deadline=None):
        """The network's routes: one per legal action, the network playing on; the best one.  None past DEADLINE."""
        sims, routes = [], []
        for a in battle.legal():
            c = battle.clone()
            c.step(tuple(a))
            sims.append(c)
            routes.append([tuple(a)])
        return self._rollout(sims, routes, deadline)

    def _rollout(self, sims, routes, deadline):
        net = self.net
        where = {id(c): i for i, c in enumerate(sims)}

        def forced(cs):
            out = []
            for c in cs:
                while not c.finished:
                    legal = c.legal()
                    if len(legal) > 1:
                        out.append(c)
                        break
                    routes[where[id(c)]].append(tuple(legal[0]))
                    c.step(legal[0])
            return out

        active = forced(list(sims))
        while active:
            if deadline is not None and time.perf_counter() > deadline:
                net.reset()
                return None
            for c, a in zip(active, net.actions(active)):
                routes[where[id(c)]].append(tuple(a))
                c.step(a)
            active = forced(active)
        net.reset()
        best = max(range(len(sims)), key=lambda i: sims[i].score)
        return routes[best]

    def played(self, action):
        """ACTION was played without decide(): the route in hand goes on if that was its next action, else it is
        dropped (its score is no longer secured)."""
        if self.route and tuple(self.route[0]) == tuple(action):
            self.route = self.route[1:]
        else:
            self.route, self.target = [], -1
        self.n += 1

    # -- a decision
    def offer(self, battle, route, source="search"):
        """ROUTE replaces the route in hand when its replayed score is higher."""
        score = replay(battle, route)
        if score is None:
            self.stats["bad_routes"] += 1
        elif score > self.target:
            self.route, self.target = list(route), score
            self.stats["adopted"] += 1
            if source == "lookahead":
                self.stats["adopted_lookahead"] += 1

    def decide(self, battle, transitions=None, seconds=None, lookahead=True):
        """The action to play in BATTLE (a battle in the true world).  TRANSITIONS: a fixed budget for each search;
        SECONDS: the time this decision may take in all."""
        t0 = time.perf_counter()
        use_net = self.net is not None and lookahead
        if self.net is not None and self.target < 0:   # no route in hand: the base network's own first
            r = self.greedy(battle)
            if r:
                self.offer(battle, r, "greedy")
        if self.threads is not None:                   # the searches run beside the network's lookahead
            futs = [self.threads.submit(self._search, *j) for j in self._jobs(battle, transitions, seconds)]
            if use_net:
                r = self.lookahead(battle, None if seconds is None else t0 + 0.9 * seconds)
                if r:
                    self.offer(battle, r, "lookahead")
            res = [f.result() for f in futs]
            routes = [r for r, _st in res if r]
            self.stats["searches"] += len(futs)
            self.stats["transitions"] += 0 if transitions is None else transitions * len(futs)
        else:
            if use_net:
                r = self.lookahead(battle, None if seconds is None else t0 + 0.5 * seconds)
                if r:
                    self.offer(battle, r, "lookahead")
            left = None if seconds is None else max(0.02, t0 + seconds - time.perf_counter())
            routes, spent = self.searches(battle, transitions, left)
            self.stats["transitions"] += spent
        for r in routes:
            self.offer(battle, r)
        if not self.route:                             # nothing could be played to the end
            self.n += 1
            if self.net is not None:
                a = self.net.actions([battle])[0]
                self.net.reset()
                return tuple(a)
            return tuple(battle.legal()[0])
        action, self.route = self.route[0], self.route[1:]
        self.n += 1
        return action
