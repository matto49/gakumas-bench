"""Export a checkpoint to ONNX and check that onnxruntime gives PyTorch's outputs.

    python -B -m uinet.export MODEL.pt OUT.onnx [--check N]

Inputs and outputs keep the names of uinet.model.INPUTS / ("logit", "adv", "value"), with batch, status, thing and
action counts dynamic.  The check encodes N observations of random play on pool loadouts, runs both, and reports the
largest absolute difference and the onnxruntime milliseconds for one observation.
"""
from __future__ import annotations

import argparse
import random
import sys
import time
from pathlib import Path

import numpy as np

from . import engine
from .model import INPUTS, from_checkpoint, to_torch

DYN = {"g_num": {0: "B"}, "g_cat": {0: "B"}, "st_kind": {0: "B", 1: "S"}, "st_num": {0: "B", 1: "S"},
       "t_kind": {0: "B", 1: "T"}, "t_cat": {0: "B", 1: "T"}, "t_num": {0: "B", 1: "T"}, "s_cat": {0: "B", 1: "T"},
       "s_num": {0: "B", 1: "T"}, "t_ext": {0: "B", 1: "T"}, "a_tok": {0: "B", 1: "A"}, "t_rel": {0: "B", 1: "T", 2: "T"},
       "logit": {0: "B", 1: "A"}, "adv": {0: "B", 1: "A"}, "value": {0: "B"}}


def load(path):
    import torch
    from .spec import encoder
    ck = torch.load(path, map_location="cpu", weights_only=False)
    model = from_checkpoint(ck)
    model.eval()
    return model, encoder(model.obs), ck


def sample_obs(n, seed=0):
    from . import loadouts
    from .env import Battle
    rng = random.Random(seed)
    pool = loadouts.load()
    obs = []
    while len(obs) < n:
        b = Battle.random(rng.choice(pool)["loadout"], rng)
        while not b.finished and len(obs) < n:
            o = b.obs()
            if len(o["legal"]) > 1:
                obs.append(o)
            b.step(rng.choice(o["legal"]))
    return obs


def _padded(batch):
    """A batch of two with at least two statuses, things and actions: torch.export fixes a dimension seen as 1."""
    out = {}
    for k, v in batch.items():
        out[k] = np.concatenate([v, v], 0)
    pads = {"st_kind": (1, 0), "st_num": (1, 0.0), "t_kind": (1, 0), "t_cat": (1, 0), "t_num": (1, 0.0),
            "s_cat": (1, 0), "s_num": (1, 0.0), "t_ext": (1, 0.0), "a_tok": (1, -2)}
    if "t_rel" in out:
        pads["t_rel"] = (1, 0)
    for k, (axis, value) in pads.items():
        shape = list(out[k].shape)
        shape[axis] = 1
        out[k] = np.concatenate([out[k], np.full(shape, value, out[k].dtype)], axis)
    if "t_rel" in out:                                  # [B, T, T]: the second thing axis too
        shape = list(out["t_rel"].shape)
        shape[2] = 1
        out["t_rel"] = np.concatenate([out["t_rel"], np.zeros(shape, out["t_rel"].dtype)], 2)
    return out


def input_names(batch):
    return list(INPUTS) + (["t_rel"] if "t_rel" in batch else [])


def export(model, enc, out, example):
    import torch
    from torch.export import Dim
    batch = _padded(enc.encode(example))
    B, S, T, A = Dim("B", min=1, max=4096), Dim("S", min=1, max=256), Dim("T", min=1, max=1024), Dim("A", min=1, max=128)
    ds = {"g_num": {0: B}, "g_cat": {0: B}, "st_kind": {0: B, 1: S}, "st_num": {0: B, 1: S}, "t_kind": {0: B, 1: T},
          "t_cat": {0: B, 1: T}, "t_num": {0: B, 1: T}, "s_cat": {0: B, 1: T}, "s_num": {0: B, 1: T},
          "t_ext": {0: B, 1: T}, "a_tok": {0: B, 1: A}}
    if "t_rel" in batch:
        ds["t_rel"] = {0: B, 1: T, 2: T}
    torch.onnx.export(model, tuple(to_torch(batch)), str(out), input_names=input_names(batch),
                      output_names=["logit", "adv", "value"], dynamic_shapes=ds, dynamo=True, external_data=False)


def check(model, enc, onnx_path, obs):
    import onnxruntime as ort
    import torch
    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    sess = ort.InferenceSession(str(onnx_path), so, providers=["CPUExecutionProvider"])
    worst, times = 0.0, []
    for o in obs:
        batch = enc.encode(o)
        with torch.no_grad():
            ref = [x.numpy() for x in model(*to_torch(batch))]
        feed = {k: batch[k] for k in input_names(batch)}
        t0 = time.perf_counter()
        got = sess.run(["logit", "adv", "value"], feed)
        times.append(time.perf_counter() - t0)
        n = len(o["legal"])
        worst = max(worst, float(np.abs(ref[0][0, :n] - got[0][0, :n]).max()),
                    float(np.abs(ref[2] - got[2]).max()))
    times.sort()
    return worst, 1000 * times[len(times) // 2]


def main(argv=None):
    p = argparse.ArgumentParser(prog="uinet.export")
    p.add_argument("model")
    p.add_argument("out")
    p.add_argument("--check", type=int, default=50)
    a = p.parse_args(argv)
    src, out = Path(a.model).resolve(), Path(a.out).resolve()
    engine.setup()
    model, enc, _ck = load(src)
    obs = sample_obs(max(1, a.check))
    export(model, enc, out, obs[0])
    worst, ms = check(model, enc, out, obs)
    print(f"{out}: max |torch - onnxruntime| {worst:.2e}; onnxruntime median {ms:.2f} ms per observation "
          f"({len(obs)} observations)")


if __name__ == "__main__":
    sys.exit(main())
