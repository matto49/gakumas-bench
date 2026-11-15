"""Behaviour cloning on the UI teacher's labels (plan P1), and the held-out diagnostics.

    python -B -m uinet.train OUT.pt LABELS.jsonl.zst [...] [--size S] [--epochs 20] [--batch 256] [--lr 3e-4]
        [--limit N] [--val-frac 0.1] [--train-frac 1.0] [--tau 0.01] [--threads T] [--device cpu|cuda]
        [--worlds-max N]   (train targets from each action's first N worlds; validation keeps all)
        [--table-device cpu]   (keep the fixed feature table in host RAM; network and gradients stay on --device)
        [--teacher A.pt,B.pt,... --w-distill 0.5]   (SX-04-10: distil an ensemble of networks)
    A label file written ``PATH*N`` (SX-04-14) puts its training decisions in N times (its validation ones once):
    the weight of a small label set beside a large one.
    SX-04-19: a label file written ``SRC@PATH`` belongs to label source SRC (default T; e.g. R for rollout labels, G for
    a general replay set beside a card's own).  The training decisions of an epoch are then drawn, not shuffled:
        [--mix T=0.5,R=0.5]   each source's share of the epoch (default: its share of the decisions)
        [--arch-alpha A]      within a source, archetype c gets a share proportional to n_c ** A (1: as the labels
                              have it, 0: the six archetypes equal; default 1)
        [--max-rep 4]         no (source, archetype) group is drawn more than this many times its size per epoch
                              (its share capped, the rest spread over the others)
        [--epoch-samples N]   decisions per epoch (default: the training decisions)
    The log prints every group's decisions, share and repetition.
    [--value-target q|final]  (SX-04-19, default q) the value head's target: q, the best action's per-world values
        (its quantiles are then the spread over the hidden draw order / RNG of the teacher's continuation); final,
        the episode's final score as before (the roll-in mixes network, teacher and uniform choices)
    [--save-epochs]   also save every epoch's weights as OUT.e<N>.pt (checkpoint choice by game play)
    [--skip SRC:ARCHETYPE,...]   leave a source's episodes of those archetypes out (uinet.labelcheck's "skip")

Targets of a decision, from the teacher's per-world values q[a][k]:
  m[a]    the action's mean over worlds;  A[a] = log m[a] - log max m   (<= 0, the plan's advantage)
  policy  softmax(A / TAU)                 (cross-entropy against the logits)
  adv     A                                (Huber against the adv head)
  value   q: log(q[best][k]) - VALUE_SHIFT for every world k (pinball loss of each quantile against every world);
          final: log(final score of the episode) - VALUE_SHIFT
Distillation (--teacher): the policy target of a training decision becomes (1 - W) x the label target above + W x
  the teachers' ensemble, softmax(mean of the members' log-softmax) -- uinet.evaluate's ensemble rule; the members
  run in eval mode under no_grad in the first epoch, and their targets are kept (float16, per training decision) for
  the later epochs.  adv / value targets and the validation metrics stay the labels'.
Validation: episodes whose index hashes into VAL_FRAC are held out.  Reported: top-1 agreement with the teacher's
best, mean regret (m[best] - m[chosen]) / m[best], value MAE.  Episodes come from train-side loadouts only;
generalisation to unseen loadouts is the game-play evaluation's job (uinet.evaluate).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import multiprocessing
import os
import pickle
import random
import sys
import time
from pathlib import Path

import numpy as np

from . import engine
from .encode import QUANTILES, VALUE_SHIFT, collate
from .gen import read_episodes

if multiprocessing.parent_process() is None:
    from .model import UINet, n_params, table_tensors, to_torch_compact, vocab_sizes  # noqa: F401
# else: a build worker (--build-workers, spawned): it encodes label files and needs none of torch.  With the CUDA
# torch every process reserves several GB on Windows -- SX-04-19's 14 evaluation processes ran out of memory so.


def is_val(shard, idx, frac):
    return hashlib.sha1(f"{shard}/{idx}".encode()).digest()[0] < int(frac * 256)


def in_frac(shard, idx, frac):
    return frac >= 1.0 or hashlib.sha1(f"train/{shard}/{idx}".encode()).digest()[0] < int(frac * 256)


class DiskSamples:
    """Append-only compact samples; shuffle their offsets instead of holding all arrays in RAM.
    A fresh file is required. Values and order are identical to a list, including slice reads."""

    def __init__(self, path):
        self.file = open(path, "x+b")
        self.offsets = []

    def append(self, sample):
        self.offsets.append(self.file.tell())
        pickle.dump(sample, self.file, protocol=5)

    def __len__(self):
        return len(self.offsets)

    def __getitem__(self, index):
        if isinstance(index, slice):
            return [self[i] for i in range(*index.indices(len(self)))]
        self.file.seek(self.offsets[index])
        return pickle.load(self.file)

    def shuffle(self, rng):
        rng.shuffle(self.offsets)

    def close(self):
        self.file.close()


def _label_arg(x):
    """(source, path, repeat) of a label argument [SRC@]PATH[*N]."""
    src, at, rest = str(x).partition("@")
    if not at:
        src, rest = "T", str(x)
    path, _star, rep = rest.partition("*")
    return src, path, int(rep) if rep else 1


def _arch_of(ep, cache={}):
    idol = (ep.get("loadout") or {}).get("idol_card_id")
    if idol not in cache:
        from .loadouts import archetype
        try:
            cache[idol] = archetype(idol)
        except KeyError:
            cache[idol] = "?"
    return cache[idol]


def _decision_targets(d, ep, worlds_max, is_validation, value_target):
    """(adv, value target) of a labelled decision, or None when no action of it scores."""
    rows = d["q"] if worlds_max is None or is_validation else [v[:worlds_max] for v in d["q"]]
    means = [sum(v) / len(v) for v in rows]
    top = max(means)
    if top <= 0:
        return None
    adv = np.asarray([math.log(max(m, 1.0)) - math.log(max(top, 1.0)) for m in means], np.float32)
    if value_target == "q":
        best = max(range(len(means)), key=means.__getitem__)
        vt = np.asarray([math.log(max(1, x)) - VALUE_SHIFT for x in rows[best]], np.float32)
    else:
        vt = np.asarray([math.log(max(1, ep["final"])) - VALUE_SHIFT], np.float32)
    return adv, vt


_PART = {}                                               # a build worker's encoder and settings


def _part_init(obs, settings):
    engine.setup()
    from .spec import encoder
    _PART.update(settings, enc=encoder(obs))


def _part(job):
    """One label file encoded by a worker with a table of its own: the samples (t_idx local) pickled to PART in
    file order, each preceded by its (is validation, group name); the table's keys in row order and its arrays."""
    k, arg, part = job
    a, enc = _PART, _PART["enc"]
    enc.table.reset()
    skip = a["skip"]
    src, path, _rep = _label_arg(arg)
    shard = Path(path).name.split(".")[0]
    n_ep, n, names = 0, 0, []
    with open(part, "wb") as fh:
        for ep in read_episodes(path):
            n_ep += 1
            if is_val(shard, ep["idx"], a["val_frac"]):
                v = True
            elif in_frac(shard, ep["idx"], a["train_frac"]):
                v = False
            else:
                continue
            if ep["final"] <= 0 or (src, _arch_of(ep)) in skip:
                continue
            name = (src, _arch_of(ep))
            if name not in names:
                names.append(name)
            for d in ep["decisions"]:
                t = _decision_targets(d, ep, a["worlds_max"], v, a["value_target"])
                if t is None:
                    continue
                s = dict(enc.compact(d["obs"]))
                s["adv"], s["value"] = t
                pickle.dump((v, name, s), fh, protocol=5)
                n += 1
            enc.table.f.clear_memo()
    keys = [None] * len(enc.table.rows)
    for key, i in enc.table.index.items():
        keys[i] = key
    np.savez(part + ".table.npz", *(np.stack([r[j] for r in enc.table.rows]) for j in range(4)))
    with open(part + ".keys", "wb") as fh:
        pickle.dump(keys, fh, protocol=5)
    return k, n_ep, n, names


def _build_parallel(paths, enc, train, val, groups, workers, cache_dir, settings, obs):
    """build_samples over PATHS with one worker per label file; the parent merges the files in order, so the table,
    the samples and their order are those of the one-process build."""
    import multiprocessing as mp
    import tempfile
    from concurrent.futures import ProcessPoolExecutor
    tmp = Path(tempfile.mkdtemp(prefix="parts_", dir=cache_dir))
    jobs = [(k, arg, str(tmp / f"{k}.bin")) for k, arg in enumerate(paths)]
    table, n_ep = enc.table, 0
    with ProcessPoolExecutor(min(workers, len(jobs)), mp_context=mp.get_context("spawn"), initializer=_part_init,
                             initargs=(obs, settings)) as pool:         # a worker that dies raises here
        for k, eps, n, names in pool.map(_part, jobs):
            n_ep += eps
            _src, _path, rep = _label_arg(paths[k])
            part = jobs[k][2]
            with open(part + ".keys", "rb") as fh:
                keys = pickle.load(fh)
            with np.load(part + ".table.npz") as z:
                arrs = [z[f"arr_{j}"] for j in range(4)]
            to = np.zeros(len(keys), np.int64)           # the worker's row -> the merged table's row (0 = padding)
            for i in range(1, len(keys)):
                g = table.index.get(keys[i])
                if g is None:
                    g = table.index[keys[i]] = len(table.rows)
                    table.rows.append(tuple(a[i] for a in arrs))
                to[i] = g
            table._arrays = None
            for name in names:
                groups.setdefault(name, len(groups))
            with open(part, "rb") as fh:
                for _ in range(n):
                    v, name, s = pickle.load(fh)
                    s["t_idx"] = to[s["t_idx"]].astype(s["t_idx"].dtype)
                    dst = val if v else train
                    for _r in range(1 if v else rep):
                        s = dict(s)
                        s["_k"], s["_g"] = len(dst), groups[name]
                        dst.append(s)
            for f in (part, part + ".keys", part + ".table.npz"):
                os.remove(f)
    tmp.rmdir()
    return n_ep


def build_samples(paths, enc, val_frac, limit=None, log=print, train_frac=1.0, cache_dir=None, worlds_max=None,
                  value_target="final", skip=(), workers=1, obs=None):
    """WORKERS > 1 (with OBS, and without LIMIT): the label files are encoded by that many processes and merged in
    order; the result is the one-process build's."""
    if cache_dir is None:
        train, val = [], []
    else:
        cache_dir = Path(cache_dir)
        cache_dir.mkdir(parents=True, exist_ok=False)
        train, val = DiskSamples(cache_dir / "train.bin"), DiskSamples(cache_dir / "val.bin")
    groups = {}                                          # (source, archetype) -> group index
    n_ep = 0
    if workers > 1 and obs and not limit and len(paths) > 1:
        settings = {"val_frac": val_frac, "train_frac": train_frac, "worlds_max": worlds_max,
                    "value_target": value_target, "skip": set(skip)}
        n_ep = _build_parallel(paths, enc, train, val, groups, workers, cache_dir, settings, obs)
        log(f"{n_ep} episodes: {len(train)} train / {len(val)} val decisions; things {len(enc.table.rows) - 1}")
        return train, val, {v: k for k, v in groups.items()}
    for arg in paths:
        src, path, rep = _label_arg(arg)
        shard = Path(path).name.split(".")[0]
        for ep in read_episodes(path):
            n_ep += 1
            if is_val(shard, ep["idx"], val_frac):
                dst = val
            elif in_frac(shard, ep["idx"], train_frac):
                dst = train
            else:
                continue
            if ep["final"] <= 0:                         # a round that cannot score (pool v1 had one): no signal
                continue
            if (src, _arch_of(ep)) in skip:              # uinet.labelcheck flagged this source's archetype
                continue
            g = groups.setdefault((src, _arch_of(ep)), len(groups))
            for d in ep["decisions"]:
                t = _decision_targets(d, ep, worlds_max, dst is val, value_target)
                if t is None:
                    continue
                adv, vt = t
                s = enc.compact(d["obs"])
                for _r in range(rep if dst is train else 1):
                    s = dict(s)
                    s["adv"], s["value"], s["_k"], s["_g"] = adv, vt, len(dst), g
                    dst.append(s)
            enc.table.f.clear_memo()
            if limit and len(train) >= limit:
                break
        if limit and len(train) >= limit:
            break
    log(f"{n_ep} episodes: {len(train)} train / {len(val)} val decisions; things {len(enc.table.rows) - 1}")
    return train, val, {v: k for k, v in groups.items()}


def draw_weights(gidx, names, mix=None, alpha=1.0, max_rep=4.0, epoch=None, log=print):
    """Per-decision probabilities of the epoch draw (see the module docstring).  GIDX: the group index of every
    training decision; NAMES: group index -> (source, archetype)."""
    gidx = np.asarray(gidx)
    n = np.bincount(gidx, minlength=len(names)).astype(np.float64)
    epoch = epoch or len(gidx)
    sources = sorted({names[g][0] for g in range(len(names))})
    tot = {s: sum(n[g] for g in range(len(names)) if names[g][0] == s) for s in sources}
    share_s = dict(mix) if mix else {s: tot[s] / n.sum() for s in sources}
    z = sum(share_s.get(s, 0.0) for s in sources)
    w = np.zeros(len(names))
    for g in range(len(names)):
        s = names[g][0]
        if n[g] == 0 or share_s.get(s, 0.0) <= 0:
            continue
        den = sum(n[h] ** alpha for h in range(len(names)) if names[h][0] == s and n[h] > 0)
        w[g] = share_s[s] / z * n[g] ** alpha / den
    capped = np.zeros(len(names), bool)
    for _ in range(len(names)):
        cap = max_rep * n / epoch
        over = (w > cap + 1e-12) & ~capped
        if not over.any():
            break
        excess = (w[over] - cap[over]).sum()
        w[over] = cap[over]
        capped |= over
        free = ~capped & (w > 0)
        if not free.any():
            break
        w[free] += excess * w[free] / w[free].sum()
    w /= w.sum()
    for g in sorted(range(len(names)), key=lambda g: names[g]):
        if n[g]:
            log(f"  draw {names[g][0]:>2} {names[g][1]:<34} {int(n[g]):>9} decisions  share {w[g]:.4f}  "
                f"x{w[g] * epoch / n[g]:.2f} per epoch")
    return (w / np.maximum(n, 1))[gidx]


def batch_targets(samples, tau):
    A = max(len(s["adv"]) for s in samples)
    K = max(len(np.atleast_1d(s["value"])) for s in samples)
    adv = np.zeros((len(samples), A), np.float32)
    mask = np.zeros((len(samples), A), bool)
    value = np.zeros((len(samples), K), np.float32)
    vmask = np.zeros((len(samples), K), bool)
    for b, s in enumerate(samples):
        adv[b, :len(s["adv"])] = s["adv"]
        mask[b, :len(s["adv"])] = True
        v = np.atleast_1d(s["value"])
        value[b, :len(v)] = v
        vmask[b, :len(v)] = True
    pol = np.where(mask, adv / tau, -1e9)
    pol = np.exp(pol - pol.max(1, keepdims=True)) * mask
    pol /= pol.sum(1, keepdims=True)
    return adv, mask, pol, value, vmask


_DATA = {}                                               # a data worker's sample file and settings


def _data_init(path, obs, tau):
    from .spec import collate as collate_of
    _DATA.update(fh=open(path, "rb"), collate=collate_of(obs), tau=tau)


def _data_batch(offsets):
    """One padded batch and its targets from the sample cache, read at OFFSETS (in order)."""
    fh, chunk = _DATA["fh"], []
    for o in offsets:
        fh.seek(o)
        chunk.append(pickle.load(fh))
    batch = _DATA["collate"](chunk, None, gather=False)
    if "t_rel" in batch:
        batch["t_rel"] = batch["t_rel"].astype(np.uint8)  # 6 bits; the parent widens it again
    return batch, batch_targets(chunk, _DATA["tau"])


def batches_ahead(pool, train, order, n_epoch, size, ahead):
    """The epoch's (batch, targets) in order, prepared by the pool's processes AHEAD batches in advance."""
    from collections import deque
    off = np.asarray(train.offsets, np.int64)
    starts = iter(range(0, n_epoch, size))
    queue = deque()

    def submit():
        i = next(starts, None)
        if i is not None:
            idx = off[i:i + size] if order is None else off[order[i:i + size]]
            queue.append(pool.submit(_data_batch, idx))

    for _ in range(ahead):
        submit()
    while queue:
        batch, tg = queue.popleft().result()
        submit()
        if "t_rel" in batch:
            batch["t_rel"] = batch["t_rel"].astype(np.int64)
        yield batch, tg


def teacher_probs(teachers, batch, torch, table_t, device="cpu", amp="off"):
    """softmax(mean of the teachers' log-softmax) over the actions (padding has logit -1e9, so probability 0)."""
    x = to_torch_compact(batch, device)
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16, enabled=(amp == "bf16")):
        lp = sum(torch.log_softmax(m.forward_table(table_t, *x)[0].float(), -1) for m in teachers) / len(teachers)
    return torch.softmax(lp, -1)


def losses(model, batch, targets, torch, table_t, device="cpu", amp="off", teach=None, w_distill=0.0):
    adv_t, mask, pol_t, val_t, vmask = (torch.as_tensor(x, device=device) for x in targets)
    if teach is not None:
        pol_t = (1.0 - w_distill) * pol_t + w_distill * teach * mask
    with torch.autocast("cuda", dtype=torch.bfloat16, enabled=(amp == "bf16")):
        logit, adv, value = model.forward_table(table_t, *to_torch_compact(batch, device))
        logp = torch.log_softmax(logit, -1)
        l_pol = -(pol_t * logp.masked_fill(~mask, 0)).sum(-1).mean()
        l_adv = torch.nn.functional.huber_loss(adv[mask], adv_t[mask], delta=0.1)
        q = torch.as_tensor(QUANTILES, device=device).view(1, -1, 1)
        err = val_t.unsqueeze(1) - value.float().unsqueeze(-1)              # [B, quantiles, worlds]
        pin = torch.maximum(q * err, (q - 1) * err) * vmask.unsqueeze(1)
        l_val = (pin.sum(-1) / vmask.sum(-1, keepdim=True).clamp(min=1)).mean()
    return l_pol, l_adv, l_val, logit, value


def evaluate(model, samples, table, tau, torch, table_t, device="cpu", bs=512, names=None):
    """NAMES (group index -> (source, archetype)): also ``groups``, per "SRC ARCHETYPE" its [decisions, top1,
    regret]."""
    model.eval()
    n = top1 = 0
    regret = mae = lp = 0.0
    per = {}
    with torch.no_grad():
        for i in range(0, len(samples), bs):
            chunk = samples[i:i + bs]
            batch = collate(chunk, table, gather=False)
            tg = batch_targets(chunk, tau)
            l_pol, _l_adv, _l_val, logit, value = losses(model, batch, tg, torch, table_t, device)
            pick = logit.argmax(-1).cpu().numpy()
            for b, s in enumerate(chunk):
                adv = s["adv"]
                hit, reg = int(adv[pick[b]] == 0.0), 1.0 - math.exp(float(adv[pick[b]]))
                top1 += hit
                regret += reg
                if names is not None:
                    g = per.setdefault(s["_g"], [0, 0, 0.0])
                    g[0] += 1
                    g[1] += hit
                    g[2] += reg
            med = torch.as_tensor(np.asarray([np.median(np.atleast_1d(s["value"])) for s in chunk], np.float32))
            mae += float((value[:, 2].float().cpu() - med).abs().sum())
            lp += float(l_pol) * len(chunk)
            n += len(chunk)
    model.train()
    out = {"n": n, "top1": top1 / n, "regret": regret / n, "value_mae": mae / n, "pol_loss": lp / n}
    if names is not None:
        out["groups"] = {" ".join(names[g]): [v[0], round(v[1] / v[0], 4), round(v[2] / v[0], 4)]
                         for g, v in sorted(per.items())}
    return out


def main(argv=None):
    import torch
    p = argparse.ArgumentParser(prog="uinet.train")
    p.add_argument("out")
    p.add_argument("labels", nargs="+")
    p.add_argument("--size", default="S")
    p.add_argument("--epochs", type=int, default=20)
    p.add_argument("--batch", type=int, default=256)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--wd", type=float, default=0.01)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--val-frac", type=float, default=0.1)
    p.add_argument("--train-frac", type=float, default=1.0, help="keep this share of the train episodes (scaling)")
    p.add_argument("--tau", type=float, default=0.01)
    p.add_argument("--worlds-max", type=int, default=None,
                   help="train targets from each action's first N worlds only (validation keeps all): a label-noise ablation")
    p.add_argument("--w-adv", type=float, default=1.0)
    p.add_argument("--w-val", type=float, default=0.5)
    p.add_argument("--threads", type=int, default=None)
    p.add_argument("--device", default="cpu")
    p.add_argument("--table-device", choices=("cpu", "cuda"), default=None,
                   help="fixed feature-table storage (default: --device); cpu reduces persistent CUDA memory")
    p.add_argument("--amp", default="off", choices=("off", "bf16"), help="cuda autocast for the forward/backward")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--init", help="initialize model weights from a checkpoint; use a fresh optimizer")
    p.add_argument("--patience", type=int, default=0,
                   help="select best validation policy loss and stop after N non-improving epochs (0: save final epoch)")
    p.add_argument("--sample-cache", help="fresh directory for disk-backed samples, preserving the original split and shuffle")
    p.add_argument("--teacher", help="comma-separated checkpoints: distil their ensemble (see the module docstring)")
    p.add_argument("--w-distill", type=float, default=0.5, help="weight of the teachers' target in the policy loss")
    p.add_argument("--obs", choices=("v1", "v2"), default=None,
                   help="input version (uinet.spec); default: --init's, else v1")
    p.add_argument("--mix", help="SRC=share,...: each label source's share of an epoch (default: its share of the data)")
    p.add_argument("--arch-alpha", type=float, default=1.0,
                   help="archetype shares within a source proportional to n ** A (0: equal, 1: as labelled)")
    p.add_argument("--max-rep", type=float, default=4.0, help="cap on a (source, archetype) group's draws per epoch")
    p.add_argument("--epoch-samples", type=int, default=None, help="decisions drawn per epoch (default: all)")
    p.add_argument("--value-target", choices=("q", "final"), default="q")
    p.add_argument("--save-epochs", action="store_true", help="also save every epoch as OUT.e<N>.pt")
    p.add_argument("--skip", default="", help="SRC:ARCHETYPE,...: leave those episodes out (uinet.labelcheck's skip)")
    p.add_argument("--build-workers", type=int, default=1,
                   help="processes that encode the label files before the first epoch (same samples as 1)")
    p.add_argument("--data-workers", type=int, default=0,
                   help="processes that read and pad the batches ahead of the training step (needs --sample-cache; "
                        "same batches in the same order; not used when distilling)")
    a = p.parse_args(argv)
    if a.patience < 0:
        p.error("--patience must be non-negative")
    if a.threads:
        torch.set_num_threads(a.threads)
    torch.manual_seed(a.seed)
    labels = []
    for x in a.labels:
        src, path, rep = _label_arg(x)
        path = Path(path).resolve()
        files = sorted(path.glob("*.jsonl.zst")) if path.is_dir() else [path]     # SRC@DIR: every label file in it
        if not files:
            p.error(f"no *.jsonl.zst in {path}")
        labels += [f"{src}@{f}" + (f"*{rep}" if rep != 1 else "") for f in files]
    out = Path(a.out).resolve()
    cache_dir = Path(a.sample_cache).resolve() if a.sample_cache else None
    init_ckpt = None
    if a.init:
        a.init = str(Path(a.init).resolve())
        init_ckpt = torch.load(a.init, map_location="cpu", weights_only=False)
        if init_ckpt["size"] != a.size:
            p.error(f"--init size {init_ckpt['size']} differs from --size {a.size}")
    engine.setup()
    from .spec import collate as collate_of, encoder
    obs = a.obs or (init_ckpt.get("obs", "v1") if init_ckpt is not None else "v1")
    if init_ckpt is not None and init_ckpt.get("obs", "v1") != obs:
        p.error(f"--init is a {init_ckpt.get('obs', 'v1')} model, --obs {obs}")
    global collate
    collate = collate_of(obs)
    enc = encoder(obs)
    print(f"input version {obs}", flush=True)
    train, val, gnames = build_samples(labels, enc, a.val_frac, a.limit, train_frac=a.train_frac,
                                       cache_dir=cache_dir, worlds_max=a.worlds_max, value_target=a.value_target,
                                       skip={tuple(x.split(":", 1)) for x in a.skip.split(",") if x},
                                       workers=a.build_workers, obs=obs)
    mix = {k: float(v) for k, v in (x.split("=") for x in a.mix.split(","))} if a.mix else None
    draw = None
    if mix or a.arch_alpha != 1.0 or a.epoch_samples or len(gnames) > 1:
        gidx = [s["_g"] for s in (train[i] for i in range(len(train)))] if isinstance(train, DiskSamples) \
            else [s["_g"] for s in train]
        draw = draw_weights(gidx, gnames, mix, a.arch_alpha, a.max_rep, a.epoch_samples)
    n_epoch = a.epoch_samples or len(train)
    if a.patience and not val:
        p.error("--patience requires a non-empty validation split")
    sizes = vocab_sizes(enc.v, obs)
    table_t = table_tensors(enc.table, a.table_device or a.device, consume=True)
    print(f"feature table: {table_t[0].device}; {sum(t.numel() * t.element_size() for t in table_t)} bytes", flush=True)
    del enc                                              # fixed dataset: table_t owns all features from here on
    table = None                                         # collate(gather=False) does not read a ThingTable
    model = UINet(sizes, a.size, obs=obs).to(a.device)
    if init_ckpt is not None:
        model.load_state_dict(init_ckpt["state_dict"])
        del init_ckpt
        print(f"initialized weights from {a.init}; optimizer starts fresh", flush=True)
    print(f"model {a.size}: {n_params(model) / 1e6:.2f}M parameters", flush=True)
    teachers = []
    if a.teacher:
        a.teacher = ",".join(str(Path(x).resolve()) for x in a.teacher.split(","))
        for path in a.teacher.split(","):
            ck = torch.load(path, map_location="cpu", weights_only=False)
            if ck.get("obs", "v1") != obs:
                p.error(f"--teacher {path} is a {ck.get('obs', 'v1')} model, the student {obs}")
            m = UINet(sizes, ck["size"], obs=obs).to(a.device)
            m.load_state_dict(ck["state_dict"])
            m.eval()
            teachers.append(m)
        print(f"distilling {len(teachers)} teachers, w {a.w_distill}: {a.teacher}", flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=a.wd)
    steps = a.epochs * math.ceil(n_epoch / a.batch)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=max(1, steps), pct_start=0.05)
    rng = random.Random(a.seed)
    nrng = np.random.default_rng(a.seed)
    history = []
    tcache = {}                                          # training decision -> the teachers' target (float16)
    best_state, best_pol, best_epoch, stale_epochs = None, float("inf"), 0, 0
    data_pool = None
    if a.data_workers and isinstance(train, DiskSamples) and not teachers:
        from concurrent.futures import ProcessPoolExecutor
        train.file.flush()
        data_pool = ProcessPoolExecutor(a.data_workers, mp_context=multiprocessing.get_context("spawn"),
                                        initializer=_data_init, initargs=(train.file.name, obs, a.tau))
        print(f"data workers: {a.data_workers}", flush=True)
    t0 = time.time()
    for epoch in range(a.epochs):
        if draw is not None:
            order = nrng.choice(len(train), size=n_epoch, replace=True, p=draw)
        else:
            order = None
            if isinstance(train, DiskSamples):
                train.shuffle(rng)
            else:
                rng.shuffle(train)
        tot = [0.0, 0.0, 0.0]
        t_data, t_epoch = 0.0, time.perf_counter()
        ahead = batches_ahead(data_pool, train, order, n_epoch, a.batch, 4 * a.data_workers) if data_pool else None
        for i in range(0, n_epoch, a.batch):
            t_b = time.perf_counter()
            if ahead is not None:
                chunk = None
                batch, tg = next(ahead)
            else:
                chunk = train[i:i + a.batch] if order is None else [train[int(j)] for j in order[i:i + a.batch]]
                batch = collate(chunk, table, gather=False)
                tg = batch_targets(chunk, a.tau)
            t_data += time.perf_counter() - t_b
            teach = None
            if teachers:
                ks = [s["_k"] for s in chunk]
                if all(k in tcache for k in ks):
                    arr = np.zeros((len(chunk), max(len(s["adv"]) for s in chunk)), np.float32)
                    for b, k in enumerate(ks):
                        arr[b, :len(tcache[k])] = tcache[k]
                    teach = torch.as_tensor(arr, device=a.device)
                else:
                    teach = teacher_probs(teachers, batch, torch, table_t, a.device, a.amp)
                    tn = teach.float().cpu().numpy()
                    for b, s in enumerate(chunk):
                        tcache[s["_k"]] = tn[b, :len(s["adv"])].astype(np.float16)
            l_pol, l_adv, l_val, _lg, _v = losses(model, batch, tg, torch, table_t, a.device, a.amp, teach,
                                                  a.w_distill)
            loss = l_pol + a.w_adv * l_adv + a.w_val * l_val
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            for k, v in enumerate((l_pol, l_adv, l_val)):
                tot[k] += float(v.detach()) * len(tg[0])
        tr = [x / max(1, n_epoch) for x in tot]
        t_train = time.perf_counter() - t_epoch
        ev = evaluate(model, val, table, a.tau, torch, table_t, a.device, names=gnames) if val else {}
        groups = ev.pop("groups", None)
        row = {"epoch": epoch + 1, "train_pol": round(tr[0], 4), "train_adv": round(tr[1], 5),
               "train_val": round(tr[2], 4), **{f"val_{k}": round(v, 4) for k, v in ev.items()},
               "seconds": round(time.time() - t0),
               # of this epoch: reading and padding the batches / the whole training loop / validation
               "data_s": round(t_data), "train_s": round(t_train),
               "val_s": round(time.perf_counter() - t_epoch - t_train)}
        if groups:
            row["val_groups"] = groups                   # "SRC ARCHETYPE": [decisions, top1, regret]
        history.append(row)
        print(json.dumps(row), flush=True)
        if a.save_epochs:
            ep_out = out.with_name(f"{out.stem}.e{epoch + 1}.pt")
            torch.save({"state_dict": {k: v.detach().cpu() for k, v in model.state_dict().items()}, "size": a.size,
                        "obs": obs, "args": vars(a), "epoch": epoch + 1, "row": row,
                        "commit": engine.project_commit()}, ep_out)
        if a.patience:
            if not math.isfinite(ev["pol_loss"]):
                raise RuntimeError("non-finite validation policy loss; no checkpoint selected")
            if ev["pol_loss"] < best_pol:
                best_pol, best_epoch, stale_epochs = ev["pol_loss"], epoch + 1, 0
                best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            else:
                stale_epochs += 1
            if stale_epochs >= a.patience:
                print(f"early stop: {stale_epochs} epochs without lower validation policy loss", flush=True)
                break
    state = best_state if best_state is not None else {k: v.detach().cpu() for k, v in model.state_dict().items()}
    ckpt = {"state_dict": state, "size": a.size, "obs": obs,
            "vocab": str(engine.TREE / "schema" / ("vocab.v1.json" if obs == "v1" else "vocab.v2.json")),
            "args": vars(a), "history": history, "commit": engine.project_commit(),
            "n_train": len(train), "n_val": len(val)}
    if a.patience:
        ckpt.update(selected_epoch=best_epoch, selection_metric="val_pol_loss")
        print(f"selected epoch {best_epoch}: validation policy loss {best_pol:.6f}", flush=True)
    torch.save(ckpt, out)
    print(f"saved {out}", flush=True)
    if isinstance(train, DiskSamples):
        if data_pool is not None:
            data_pool.shutdown()
        train.close()
        val.close()


if __name__ == "__main__":
    sys.exit(main())
