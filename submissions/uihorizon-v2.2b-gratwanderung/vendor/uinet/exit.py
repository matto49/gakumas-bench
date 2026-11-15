"""P3: expert iteration -- actors play with the screen-tree search (uinet.mcts), the network learns the search.

    python -B -m uinet.exit OUT_DIR --init NET.pt [--actors 63] [--sims 32] [--games-per-iter 256] [--iters 400]
        [--hours H] [--device cuda] [--window 8]

Actors (CPU processes; several machines can run ``--actor-only`` against a shared OUT_DIR) play whole battles: at
every decision the search runs SIMS simulations from the screen and the action played is drawn from the visit counts
(temperature 1 for the first third of the turns, then the most visited).  A decision's record: the screen, the visit
distribution, the search's root value; the battle's final score is added at the end.  The learner trains on the
records of the last WINDOW iterations:

  policy  cross-entropy against the visit distribution
  value   pinball loss of log(final) - VALUE_SHIFT on the quantiles
  adv     unchanged (not trained here)

Games are written to OUT_DIR/games/<iter>_<actor>.jsonl.zst; weights to OUT_DIR/weights.pt (actors reload it when
its iteration number changes); checkpoints to OUT_DIR/ckpt_<iter>.pt.  A rerun continues from the newest checkpoint.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import multiprocessing as mp
import random
import sys
import time
from pathlib import Path

import numpy as np

from . import engine, loadouts


def _write(path, rows):
    import zstandard
    data = "".join(json.dumps(r, separators=(",", ":")) + "\n" for r in rows).encode("utf-8")
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(zstandard.ZstdCompressor(level=6).compress(data))
    tmp.replace(path)


def _read(path):
    import zstandard
    data = zstandard.ZstdDecompressor().stream_reader(path.read_bytes(), read_across_frames=True)
    return [json.loads(line) for line in io.TextIOWrapper(data, encoding="utf-8") if line.strip()]


def _actor(rank, args):
    import torch
    from .encode import Encoder
    from .env import Battle
    from .mcts import Searcher, torch_net
    from .model import UINet, vocab_sizes
    torch.set_num_threads(1)
    engine.setup()
    out = Path(args["out"])
    pool = [it for it in loadouts.load(args["pool"]) if not it["held_out"]]
    gen = loadouts.Generator(pool, max_swaps=args["max_swaps"])
    enc = Encoder()
    model = UINet(vocab_sizes(enc.v), args["size"])
    model.eval()
    rng = random.Random(f"exit/{args['seed']}/{args['tag']}/{rank}")
    loaded = -1
    while True:
        stop = out / "STOP"
        if stop.exists():
            return
        try:
            meta = json.loads((out / "weights.json").read_text())
        except (OSError, ValueError):
            time.sleep(2)
            continue
        if meta["iter"] != loaded:
            try:
                model.load_state_dict(torch.load(out / "weights.pt", map_location="cpu", weights_only=False))
            except Exception:                                   # noqa: BLE001 -- caught mid-write: try again
                time.sleep(1)
                continue
            loaded = meta["iter"]
        it = loaded
        if rng.random() < args["generated"]:
            lo, _o = gen.sample(rng)
        else:
            lo = rng.choice(pool)["loadout"]
        lo = dict(lo, seed=rng.randrange(1, 2 ** 31 - 1))
        enc.table.reset()                               # no compact indices survive the previous game
        b = Battle(lo)
        searcher = Searcher(torch_net(model, enc), sims=args["sims"], rng=rng)
        recs = []
        while not b.finished:
            legal = b.legal()
            if len(legal) == 1:
                b.step(legal[0])
                continue
            o = b.obs()
            visits, root_v = searcher.run(b)
            pi = visits / visits.sum()
            if b.session.turn <= max(1, int(o["exam"]["limit"]) // 3):
                k = int(rng.choices(range(len(pi)), pi)[0])
            else:
                k = int(np.argmax(visits))
            recs.append({"obs": o, "pi": [round(float(x), 4) for x in pi], "v": round(root_v, 4)})
            b.step(legal[k])
        for r in recs:
            r["final"] = b.score
        _write(out / "games" / f"{it:05d}_{args['tag']}{rank}_{time.time_ns()}.jsonl.zst", recs)


def main(argv=None):
    import torch
    from .encode import Encoder, collate
    from .model import QUANTILES, VALUE_SHIFT, UINet, n_params, table_tensors, to_torch_compact, vocab_sizes
    p = argparse.ArgumentParser(prog="uinet.exit")
    p.add_argument("out")
    p.add_argument("--init")
    p.add_argument("--actors", type=int, default=4)
    p.add_argument("--actor-only", action="store_true", help="run actors against OUT_DIR, no learner")
    p.add_argument("--tag", default="a")
    p.add_argument("--sims", type=int, default=32)
    p.add_argument("--games-per-iter", type=int, default=64)
    p.add_argument("--iters", type=int, default=400)
    p.add_argument("--hours", type=float, default=None)
    p.add_argument("--window", type=int, default=8)
    p.add_argument("--epochs", type=int, default=1)
    p.add_argument("--batch", type=int, default=512)
    p.add_argument("--lr", type=float, default=1e-4)
    p.add_argument("--generated", type=float, default=0.5)
    p.add_argument("--max-swaps", type=int, default=10)
    p.add_argument("--device", default="cpu")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--size", default=None)
    p.add_argument("--pool", default=str(loadouts.POOL))
    a = p.parse_args(argv)
    out = Path(a.out).resolve()
    (out / "games").mkdir(parents=True, exist_ok=True)
    engine.setup()
    size = a.size
    if a.init:
        ck = torch.load(Path(a.init).resolve(), map_location="cpu", weights_only=False)
        size = ck["size"]
    elif (out / "weights.json").exists():
        size = json.loads((out / "weights.json").read_text())["size"]
    args = {"out": str(out), "pool": a.pool, "max_swaps": a.max_swaps, "generated": a.generated, "size": size,
            "sims": a.sims, "seed": a.seed, "tag": a.tag}
    ctx = mp.get_context("spawn")
    actors = [ctx.Process(target=_actor, args=(r, args), daemon=True) for r in range(a.actors)]
    if a.actor_only:
        for pr in actors:
            pr.start()
        for pr in actors:
            pr.join()
        return
    enc = Encoder()
    model = UINet(vocab_sizes(enc.v), size).to(a.device)
    start = 0
    done = sorted(out.glob("ckpt_*.pt"), key=lambda x: int(x.stem.split("_")[1]))
    if done:
        last = torch.load(done[-1], map_location="cpu", weights_only=False)
        model.load_state_dict(last["state_dict"])
        start = int(last["iter"])
    else:
        model.load_state_dict(ck["state_dict"])
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=0.0)

    def publish(it):
        torch.save({k: v.detach().cpu() for k, v in model.state_dict().items()}, out / "weights.tmp")
        (out / "weights.tmp").replace(out / "weights.pt")
        (out / "weights.json").write_text(json.dumps({"iter": it, "size": size}))

    publish(start)
    (out / "STOP").unlink(missing_ok=True)
    for pr in actors:
        pr.start()
    print(f"exit: {size} {n_params(model) / 1e6:.2f}M, iteration {start}, {a.actors} local actors, {a.sims} sims",
          flush=True)
    q = torch.as_tensor(QUANTILES, device=a.device).view(1, -1)
    log = (out / "log.jsonl").open("a")
    deadline = time.time() + a.hours * 3600 if a.hours else None
    t0 = time.time()
    seen, cache = set(), {}
    for it in range(start + 1, a.iters + 1):
        # wait until GAMES_PER_ITER games of the current weights (iteration it - 1) are in
        while True:
            fresh = [f for f in (out / "games").glob(f"{it - 1:05d}_*.jsonl.zst") if f.name not in seen]
            if len(fresh) >= a.games_per_iter or (deadline and time.time() > deadline):
                break
            time.sleep(2)
        files = sorted(f for f in (out / "games").glob("*.jsonl.zst")
                       if int(f.name.split("_")[0]) >= it - a.window)
        seen.update(f.name for f in fresh)
        keep = {f.name for f in files}
        if any(name not in keep for name in cache):
            # Evicted games must not retain feature rows forever. Re-encode the retained window together,
            # since every compact sample's indices are local to this table.
            cache.clear()
            enc.table.reset()
        for f in files:
            if f.name not in cache:
                cs = []
                for r in _read(f):
                    c = enc.compact(r["obs"])
                    c["pi"] = np.asarray(r["pi"], np.float32)
                    c["y"] = math.log(max(1, r["final"])) - VALUE_SHIFT
                    cs.append(c)
                cache[f.name] = cs
        samples = [c for f in files for c in cache[f.name]]
        model.train()
        table_t = table_tensors(enc.table, a.device)
        lp = lv = 0.0
        for _ep in range(a.epochs):
            random.shuffle(samples)
            for i in range(0, len(samples), a.batch):
                chunk = samples[i:i + a.batch]
                batch = collate(chunk, enc.table, gather=False)
                A = batch["a_tok"].shape[1]
                pi = np.zeros((len(chunk), A), np.float32)
                for b_, s in enumerate(chunk):
                    pi[b_, :len(s["pi"])] = s["pi"]
                logit, _adv, value = model.forward_table(table_t, *to_torch_compact(batch, a.device))
                pit = torch.as_tensor(pi, device=a.device)
                mask = torch.as_tensor(batch["a_tok"] != -2, device=a.device)
                l_pol = -(pit * torch.log_softmax(logit, -1).masked_fill(~mask, 0)).sum(-1).mean()
                y = torch.as_tensor([s["y"] for s in chunk], device=a.device).view(-1, 1)
                err = y - value
                l_val = torch.maximum(q * err, (q - 1) * err).mean()
                loss = l_pol + 0.5 * l_val
                opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                opt.step()
                lp += float(l_pol.detach()) * len(chunk)
                lv += float(l_val.detach()) * len(chunk)
        finals = [r["final"] for f in fresh for r in _read(f)[-1:]]
        row = {"iter": it, "new_games": len(fresh), "window_decisions": len(samples),
               "log_final_new": round(float(np.mean([math.log(max(1, x)) for x in finals])), 4) if finals else None,
               "pol": round(lp / max(1, len(samples) * a.epochs), 4), "val": round(lv / max(1, len(samples) * a.epochs), 4),
               "seconds": round(time.time() - t0)}
        log.write(json.dumps(row) + "\n")
        log.flush()
        print(json.dumps(row), flush=True)
        publish(it)
        if it % 10 == 0 or it == a.iters or (deadline and time.time() > deadline):
            torch.save({"state_dict": {k: v.detach().cpu() for k, v in model.state_dict().items()}, "size": size,
                        "iter": it, "args": vars(a), "commit": engine.project_commit()}, out / f"ckpt_{it}.pt")
        if deadline and time.time() > deadline:
            break
    (out / "STOP").write_text("stop\n")
    for pr in actors:
        pr.join(timeout=60)


if __name__ == "__main__":
    sys.exit(main())
