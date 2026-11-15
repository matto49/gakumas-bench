"""P2: PPO from the behaviour-cloned network (plan section 4, SX-04-03).

    python -B -m uinet.ppo OUT_DIR --init BC.pt [--actors 48] [--episodes-per-iter 512] [--iters 2000]
        [--hours H] [--device cuda] [--eval-every 20] [--kl-start 0.05 --kl-half-life 200]

Actors are CPU processes: each holds a copy of the network (synced at every iteration), plays whole battles on the
engine (``uinet.env.Battle``: a train-side round of the pool, or a generated deck around one, a fresh exam seed)
sampling from the policy, and sends back the observations, the actions, their log-probabilities and the value
estimates.  The learner (GPU when given) re-encodes the observations and runs PPO:

  reward     log(final score) at the battle's end, nothing before (the plan: the judging bars are geometric means)
  advantage  GAE (gamma 1, lambda 0.95) on the value head's median, normalised per batch
  loss       clipped surrogate (0.2) + value pinball loss on the quantiles + KL to the BC network (coefficient
             KL_START halving every KL_HALF_LIFE iterations) - entropy bonus 0.003

Every EVAL_EVERY iterations the learner writes OUT_DIR/ckpt_<iter>.pt and a line of training statistics to
OUT_DIR/log.jsonl; the game-play evaluation (uinet.evaluate, arm N) runs on those checkpoints separately.
A rerun with the same OUT_DIR continues from the newest checkpoint.
"""
from __future__ import annotations

import argparse
import json
import math
import multiprocessing as mp
import queue
import random
import sys
import time
from pathlib import Path

import numpy as np

from . import engine, loadouts

GAMMA, LAMBDA, CLIP, ENT = 1.0, 0.95, 0.2, 0.003


# ----------------------------------------------------------------------------- actors
def _actor(rank, args, weights_q, out_q):
    import torch
    from .encode import Encoder
    from .env import Battle
    from .model import UINet, to_torch, vocab_sizes
    torch.set_num_threads(1)
    engine.setup()
    pool = [it for it in loadouts.load(args["pool"]) if not it["held_out"]]
    gen = loadouts.Generator(pool, max_swaps=args["max_swaps"])
    enc = Encoder()
    model = UINet(vocab_sizes(enc.v), args["size"])
    model.eval()
    rng = random.Random(f"ppo/{args['seed']}/{rank}")
    while True:
        msg = weights_q.get()
        if msg is None:
            return
        it, path, n_eps = msg
        model.load_state_dict(torch.load(path, map_location="cpu", weights_only=False))
        for _ in range(n_eps):
            enc.table.reset()                                 # bound the memoised card rows to one episode
            if rng.random() < args["generated"]:
                lo, _o = gen.sample(rng)
            else:
                lo = rng.choice(pool)["loadout"]
            lo = dict(lo, seed=rng.randrange(1, 2 ** 31 - 1))
            b = Battle(lo)
            steps = []
            while not b.finished:
                legal = b.legal()
                if len(legal) == 1:
                    b.step(legal[0])
                    continue
                o = b.obs()
                with torch.no_grad():
                    logit, _adv, value = model(*to_torch(enc.encode(o)))
                lg = logit[0, :len(legal)]
                p = torch.softmax(lg, -1)
                k = int(torch.multinomial(p, 1))
                steps.append({"obs": o, "a": k, "logp": float(torch.log(p[k])), "v": float(value[0, 2])})
                b.step(legal[k])
            out_q.put({"iter": it, "final": b.score, "steps": steps})


# ----------------------------------------------------------------------------- learner
def gae(values, final_value):
    """Advantages and returns of one episode whose only reward is FINAL_VALUE at the end."""
    T = len(values)
    adv = np.zeros(T, np.float32)
    last = 0.0
    for t in reversed(range(T)):
        nxt = final_value if t == T - 1 else values[t + 1]
        r = 0.0
        delta = r + GAMMA * nxt - values[t]
        if t == T - 1:
            delta = final_value - values[t]
        last = delta + GAMMA * LAMBDA * last
        adv[t] = last
    return adv, adv + np.asarray(values, np.float32)


def main(argv=None):
    import torch
    from .encode import Encoder, collate
    from .model import QUANTILES, VALUE_SHIFT, UINet, n_params, table_tensors, to_torch_compact, vocab_sizes
    p = argparse.ArgumentParser(prog="uinet.ppo")
    p.add_argument("out")
    p.add_argument("--init", required=True)
    p.add_argument("--actors", type=int, default=8)
    p.add_argument("--episodes-per-iter", type=int, default=64)
    p.add_argument("--iters", type=int, default=1000)
    p.add_argument("--hours", type=float, default=None)
    p.add_argument("--stop-file", help="finish the current iteration, save a checkpoint and exit when this file exists")
    p.add_argument("--epochs", type=int, default=2)
    p.add_argument("--batch", type=int, default=512)
    p.add_argument("--lr", type=float, default=1e-4)
    p.add_argument("--kl-start", type=float, default=0.05)
    p.add_argument("--kl-half-life", type=float, default=200)
    p.add_argument("--generated", type=float, default=0.5)
    p.add_argument("--max-swaps", type=int, default=10)
    p.add_argument("--eval-every", type=int, default=20)
    p.add_argument("--device", default="cpu")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--pool", default=str(loadouts.POOL))
    a = p.parse_args(argv)
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    init = Path(a.init).resolve()
    stop_file = Path(a.stop_file).resolve() if a.stop_file else None
    engine.setup()
    ck = torch.load(init, map_location="cpu", weights_only=False)
    size = ck["size"]
    enc = Encoder()
    model = UINet(vocab_sizes(enc.v), size).to(a.device)
    ref = UINet(vocab_sizes(enc.v), size).to(a.device)
    ref.load_state_dict(ck["state_dict"])
    ref.eval()
    start_iter = 0
    done = sorted(out.glob("ckpt_*.pt"), key=lambda x: int(x.stem.split("_")[1]))
    if done:
        last = torch.load(done[-1], map_location="cpu", weights_only=False)
        model.load_state_dict(last["state_dict"])
        start_iter = int(last["iter"])
    else:
        model.load_state_dict(ck["state_dict"])
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=0.0)
    print(f"ppo: {size} {n_params(model) / 1e6:.2f}M, from {init.name} at iteration {start_iter}", flush=True)
    args = {"pool": a.pool, "max_swaps": a.max_swaps, "generated": a.generated, "size": size, "seed": a.seed}
    ctx = mp.get_context("spawn")
    weights_q, out_q = ctx.Queue(), ctx.Queue()
    actors = [ctx.Process(target=_actor, args=(r, args, weights_q, out_q), daemon=True) for r in range(a.actors)]
    for pr in actors:
        pr.start()
    deadline = time.time() + a.hours * 3600 if a.hours else None
    q = torch.as_tensor(QUANTILES, device=a.device).view(1, -1)
    log = (out / "log.jsonl").open("a")
    t0 = time.time()
    for it in range(start_iter + 1, a.iters + 1):
        cpu_state = {k: v.detach().cpu() for k, v in model.state_dict().items()}
        wpath = out / f"weights_{it % 2}.pt"            # actors load the file; two names so a slow reader is safe
        torch.save(cpu_state, out / "weights.tmp")
        (out / "weights.tmp").replace(wpath)
        per = [a.episodes_per_iter // a.actors + (1 if r < a.episodes_per_iter % a.actors else 0)
               for r in range(a.actors)]
        for n in per:
            if n:
                weights_q.put((it, str(wpath), n))
        eps = []
        while len(eps) < a.episodes_per_iter:            # an actor that died (e.g. out of memory) must not hang the learner
            try:
                eps.append(out_q.get(timeout=300))
            except queue.Empty:
                raise SystemExit(f"ppo: no episode for 300 s at iteration {it}, actors lost")
        samples, olds, advs, rets = [], [], [], []
        finals = []
        enc.table.reset()                                 # this iteration's samples only; table_t is rebuilt below
        for ep in eps:
            if not ep["steps"]:
                continue
            fv = math.log(max(1, ep["final"])) - VALUE_SHIFT
            finals.append(ep["final"])
            adv, ret = gae([s["v"] for s in ep["steps"]], fv)
            for s, ad, rt in zip(ep["steps"], adv, ret):
                c = enc.compact(s["obs"])
                c["a"], c["logp"], c["adv"], c["ret"] = s["a"], s["logp"], float(ad), float(rt)
                samples.append(c)
        A = np.asarray([s["adv"] for s in samples], np.float32)
        A = (A - A.mean()) / (A.std() + 1e-6)
        for s, v in zip(samples, A):
            s["adv_n"] = float(v)
        table_t = table_tensors(enc.table, a.device)
        kl_coef = a.kl_start * 0.5 ** (it / a.kl_half_life)
        stats = {"pg": 0.0, "v": 0.0, "kl": 0.0, "ent": 0.0, "clip": 0.0, "n": 0}
        model.train()
        for _ep in range(a.epochs):
            random.shuffle(samples)
            for i in range(0, len(samples), a.batch):
                chunk = samples[i:i + a.batch]
                batch = collate(chunk, enc.table, gather=False)
                x = to_torch_compact(batch, a.device)
                logit, _adv, value = model.forward_table(table_t, *x)
                with torch.no_grad():
                    rlogit, _r, _rv = ref.forward_table(table_t, *x)
                logp_all = torch.log_softmax(logit, -1)
                act = torch.as_tensor([s["a"] for s in chunk], device=a.device)
                logp = logp_all.gather(1, act.view(-1, 1)).squeeze(1)
                old = torch.as_tensor([s["logp"] for s in chunk], device=a.device)
                adv = torch.as_tensor([s["adv_n"] for s in chunk], device=a.device)
                ret = torch.as_tensor([s["ret"] for s in chunk], device=a.device)
                ratio = torch.exp(logp - old)
                pg = -torch.min(ratio * adv, ratio.clamp(1 - CLIP, 1 + CLIP) * adv).mean()
                err = ret.view(-1, 1) - value
                lv = torch.maximum(q * err, (q - 1) * err).mean()
                mask = torch.as_tensor(batch["a_tok"] != -2, device=a.device)
                pm = torch.softmax(logit, -1)
                rlogp = torch.log_softmax(rlogit, -1)
                kl = ((pm * (logp_all - rlogp)).masked_fill(~mask, 0)).sum(-1).mean()
                ent = -((pm * logp_all).masked_fill(~mask, 0)).sum(-1).mean()
                loss = pg + 0.5 * lv + kl_coef * kl - ENT * ent
                opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                opt.step()
                n = len(chunk)
                for k_, v_ in (("pg", pg), ("v", lv), ("kl", kl), ("ent", ent)):
                    stats[k_] += float(v_.detach()) * n
                stats["clip"] += float(((ratio - 1).abs() > CLIP).float().mean()) * n
                stats["n"] += n
        row = {"iter": it, "episodes": len(finals), "decisions": len(samples),
               "log_final_mean": round(float(np.mean([math.log(max(1, f)) for f in finals])), 4),
               "kl_coef": round(kl_coef, 5), **{k: round(v / max(1, stats["n"]), 5) for k, v in stats.items()
                                                if k != "n"},
               "seconds": round(time.time() - t0)}
        log.write(json.dumps(row) + "\n")
        log.flush()
        print(json.dumps(row), flush=True)
        stop_requested = bool(stop_file and stop_file.exists())
        timed_out = bool(deadline and time.time() > deadline)
        if it % a.eval_every == 0 or it == a.iters or timed_out or stop_requested:
            checkpoint = out / f"ckpt_{it}.pt"
            temporary = checkpoint.with_suffix(".pt.tmp")
            torch.save({"state_dict": {k: v.detach().cpu() for k, v in model.state_dict().items()}, "size": size,
                        "iter": it, "init": str(init), "args": vars(a), "commit": engine.project_commit()}, temporary)
            temporary.replace(checkpoint)                  # evaluators only see a completed checkpoint
        if timed_out or stop_requested:
            break
    for _ in actors:
        weights_q.put(None)
    for pr in actors:
        pr.join(timeout=30)


if __name__ == "__main__":
    sys.exit(main())
