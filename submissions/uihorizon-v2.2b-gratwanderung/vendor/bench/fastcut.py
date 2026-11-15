"""A scan's survivors tested in the engine against the hands the screen has shown, a few milliseconds a seed.

    cut = FastCut(master, loadout)         the round's loading, built once (it does not depend on the seed)
    cut.follows(seed, actions, hands)      True when the battle of SEED, played with ACTIONS, shows the hand
                                           HANDS[i] before ACTIONS[i] and HANDS[-1] after the last one
    cut.battle(seed, actions)              that battle as a uinet.env.Battle (its screen with .obs()), or None when
                                           it cannot take ACTIONS

A scan started with few draws (the pile changed in turn 1, or the deck holds many copies) leaves thousands of
seeds.  Rebuilding each as a uinet.env.Battle takes about 100 ms, most of it the master's reference map
(GakumasCLI.native.portable.master_refmap, the same for every seed) and the loadout's loading.  Here the loading is
built once and opened under each seed, with that map computed once: about 3 ms a seed.  The test reads the hand
only, so it can pass a wrong seed but not fail the true one; the seeds it leaves are rebuilt and compared on the
whole screen by the adapter as before (only such a battle is locked).

The opening is the engine's own (GakumasCLI.native.native_session.open_loading): what is reused are values that
do not depend on the seed.  The map is replaced for the duration of one open and put back, because the bench's
referee runs in the same process.

A second step (2.2) takes the Python packing out of an open as well.  The loading packed for the core is one block
of bytes; packed under two seeds it differs only where the seed is written.  FastCut finds those places, checks on
a third seed that writing the seed there gives the very bytes the engine packs, and from then on opens a seed by
copying the block and writing the seed in (the round's compiled description is shared, as a battle's copies share
it): about 0.4 ms a seed.  When the check does not hold (another engine, a layout with pointers) the first way
stays in use.
"""
from __future__ import annotations

import copy


class FastCut:
    def __init__(self, master, loadout):
        from GakumasCLI.native import native_session, portable
        from GakumasCLI.scenario.exam_session import deferred_open
        from GakumasCLI.scenario.hif import build_hif_loadout_session
        self.ns, self.portable, self.lo = native_session, portable, dict(loadout)
        with deferred_open():
            self.loading, self.meta = build_hif_loadout_session(master, dict(self.lo, seed=1))
        self.config = self.loading.config
        self.refmap = portable.master_refmap(master)
        self.master = master
        self.tested = 0
        self.block = None                              # (round, packed type, bytes, places of the seed)
        try:
            self._prepare()
        except Exception:                              # noqa: BLE001 -- the first way stays in use
            self.block = None

    def _seeded(self, seed):
        ld = self.loading
        ld.deck.rng.state = seed & 0xFFFFFFFF
        ld.config = copy.copy(self.config)             # the session keeps its config: one of its own
        ld.config.seed = seed
        return ld

    def _packed(self, seed):
        """(the round, the packed loading, its bytes) under SEED, the engine's way."""
        import ctypes
        P, ns = self.portable, self.ns
        ld = self._seeded(seed)
        orig = P.master_refmap
        P.master_refmap = lambda master: self.refmap if master is self.master else orig(master)
        try:
            rnd = ns._Round(ld)
            g = ns._pack_unopened(ld, rnd)
        finally:
            P.master_refmap = orig
        return rnd, g, ctypes.string_at(ctypes.addressof(g), ctypes.sizeof(g))

    def _prepare(self):
        sa, sb, sc = 0x12345678, 0x6ABCDEF1, 0x4E3779B9
        rnd, g, a = self._packed(sa)
        _r, _g, b = self._packed(sb)
        if len(a) != len(b):
            return
        places, i = [], 0
        while i < len(a):
            if a[i] == b[i]:
                i += 1
                continue
            o = i - i % 4                              # the seed is written as a 32-bit value on a 4-byte boundary
            if int.from_bytes(a[o:o + 4], "little") != sa or int.from_bytes(b[o:o + 4], "little") != sb:
                return
            places.append(o)
            i = o + 4
        if not places:
            return
        self.block = (rnd, type(g), a, places)
        if self._block(sc)[1] != self._packed(sc)[2]:  # the third seed: the same bytes as the engine packs
            self.block = None

    def _block(self, seed):
        rnd0, kind, data, places = self.block
        buf = bytearray(data)
        for o in places:
            buf[o:o + 4] = (seed & 0xFFFFFFFF).to_bytes(4, "little")
        rnd = copy.copy(rnd0)
        rnd.ctx = copy.copy(rnd0.ctx)
        rnd.ctx.round_seed = seed
        return rnd, bytes(buf), kind

    def open(self, seed):
        """The round opened under SEED: the session the engine builds for dict(loadout, seed=SEED)."""
        seed = int(seed)
        P, ns = self.portable, self.ns
        ld = self._seeded(seed)
        if self.block is not None:
            rnd, data, kind = self._block(seed)
            g = kind.from_buffer_copy(data)
            o_round, o_pack = ns._Round, ns._pack_unopened
            ns._Round, ns._pack_unopened = (lambda session: rnd), (lambda session, r: g)
            try:
                return ns.open_loading(ld, dict(self.lo, seed=seed), seed)
            finally:
                ns._Round, ns._pack_unopened = o_round, o_pack
        orig = P.master_refmap
        P.master_refmap = lambda master: self.refmap if master is self.master else orig(master)
        try:
            return ns.open_loading(ld, dict(self.lo, seed=seed), seed)
        finally:
            P.master_refmap = orig

    def follows(self, seed, actions, hands):
        self.tested += 1
        try:
            s = self.open(seed)
            for a, hand in zip(actions, hands):
                if [c["produce_card_id"] for c in s.deck.hand] != hand:
                    return False
                s.step(tuple(a), observe=False)
            return [c["produce_card_id"] for c in s.deck.hand] == hands[len(actions)]
        except Exception:                              # noqa: BLE001 -- an action this seed's battle cannot take
            return False

    def battle(self, seed, actions=()):
        from uinet.env import Battle
        from uinet.uiobs import exam_context
        try:
            b = object.__new__(Battle)
            b.loadout, b.meta = dict(self.lo, seed=int(seed)), self.meta
            b.session = self.open(seed)
            b.exam = exam_context(b.session, b.meta, b.loadout)
            b.played, b._turn, b.steps = [], b.session.turn, 0
            for a in actions:
                b.step(tuple(a))
            return b
        except Exception:                              # noqa: BLE001
            return None
