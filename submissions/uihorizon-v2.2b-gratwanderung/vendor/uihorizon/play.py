"""Playing with the true future.

  Net          one network (an ONNX file, or checkpoints A.pt[,B.pt] on a torch device) and whether it reads the pile
               order -- read from the file itself: a checkpoint's ``horizon`` key, an ONNX file's ``horizon`` metadata
               (uihorizon.train / uihorizon.export write them).
  HorizonArm   the policy of a battle: before FROM_TURN (the seed is not locked yet) the base network alone; from
               FROM_TURN on NET alone, or with LOOKAHEAD: every legal action is played in the TRUE world (the
               battle's own RNG state and draw pile, no resampling), NET plays each copy to the end, and the action
               with the best final score is taken (SX-05 E1's arm F1).  ``values`` returns those final scores in the
               label format of uinet.gen: q[action] = [final score].
"""
from __future__ import annotations

from uinet.evaluate import RolloutArm

from . import MARK, hobs


def reads_order(model):
    """Whether the network file(s) MODEL read the pile order; the members of an ensemble must agree."""
    marks = set()
    for path in str(model).split(","):
        if path.endswith(".pt"):
            import torch
            marks.add(bool(torch.load(path, map_location="cpu", weights_only=False).get(MARK)))
        else:
            import onnxruntime as ort
            so = ort.SessionOptions()
            so.intra_op_num_threads = 1
            meta = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"]).get_modelmeta()
            marks.add((meta.custom_metadata_map or {}).get(MARK) == "1")
    if len(marks) != 1:
        raise ValueError(f"members disagree on reading the pile order: {model}")
    return marks.pop()


class Net:
    def __init__(self, model, threads=1, device="cpu"):
        self.model = str(model)
        self.arm = RolloutArm(model, 1, threads, device)
        self.order = reads_order(model)
        if self.order:
            from .encode import HorizonEncoder
            self.arm.enc = HorizonEncoder()
        self.calls = 0

    def obs(self, battle):
        return hobs(battle) if self.order else battle.obs()

    def actions(self, battles):
        """The greedy action of every battle, one batched forward."""
        enc = self.arm.enc
        obs = [self.obs(b) for b in battles]
        logit = self.arm._logits(enc.batch([enc.compact(o) for o in obs]))
        self.calls += 1
        return [tuple(o["legal"][int(row[:len(o["legal"])].argmax())]) for o, row in zip(obs, logit)]

    def reset(self):
        self.arm.enc.table.reset()


class HorizonArm:
    def __init__(self, base, net=None, lookahead=False, from_turn=3, threads=1, device="cpu"):
        self.base = Net(base, threads, device)
        self.net = self.base if not net or str(net) == str(base) else Net(net, threads, device)
        self.lookahead, self.from_turn = bool(lookahead), int(from_turn)

    def locked(self, battle):
        return int(battle.session.turn) >= self.from_turn

    def values(self, battle, deadline=None):
        """(legal actions, [[final score]] per action): each action in the true world, the network plays on.
        DEADLINE (a time.perf_counter() value): past it the rollouts are dropped and the scores are None."""
        import time
        legal = battle.legal()
        sims = []
        for a in legal:
            c = battle.clone()                         # the true RNG state and draw pile stay
            c.step(tuple(a))
            sims.append(c)
        active = RolloutArm._advance(list(sims))
        while active:
            if deadline is not None and time.perf_counter() > deadline:
                self.net.reset()
                return legal, None
            for c, a in zip(active, self.net.actions(active)):
                c.step(a)
            active = RolloutArm._advance(active)
        self.net.reset()
        return legal, [[int(c.score)] for c in sims]

    def greedy(self, battle):
        """The action of the network in charge at this turn, without lookahead."""
        n = self.net if self.locked(battle) else self.base
        a = n.actions([battle])[0]
        n.reset()
        return a

    def __call__(self, battle, rng=None):
        if not self.locked(battle) or not self.lookahead:
            return self.greedy(battle)
        legal, vals = self.values(battle)
        return tuple(legal[max(range(len(legal)), key=lambda i: vals[i][0])])
