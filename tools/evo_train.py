"""进化调参（CEM）：调 gkbench/algos/evo.py 的 22 个权重，目标是很多局的平均 log 分数。
用法：evo_train.py [代数=30] [进程=4] [题集=hif-live]   训练用的牌序每代新抽，和题库里的自测 / 排行牌序无关。"""
import json, math, os, random, statistics as st, sys, time
from multiprocessing import get_context
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
_W = {}

def _init(set_name):
    from gkbench import engine, problems
    engine.setup()
    _W["probs"] = [p for p, _ in problems.load_set(set_name)]
    _W["build"] = engine.build

def _eval(job):
    theta, games = job
    from gkbench.algos.evo import EvoPolicy, play_out
    out = []
    for pi, seed in games:
        p = _W["probs"][pi]
        s, meta = _W["build"](p["loadout"], seed)
        out.append(math.log(max(1, play_out(s, EvoPolicy(theta, int(meta["limit_turn"]))))))
    return out

def main():
    gens, procs, set_name = int(sys.argv[1]) if len(sys.argv) > 1 else 30, int(sys.argv[2]) if len(sys.argv) > 2 else 4, sys.argv[3] if len(sys.argv) > 3 else "hif-live"
    from gkbench.algos.evo import THETA0, THETA_FILE
    rng = random.Random(20261110)
    dim, pop, elite = len(THETA0), 24, 6
    mean, sigma = list(THETA0), [0.5] * dim
    ctx = get_context("spawn")
    with ctx.Pool(procs, initializer=_init, initargs=(set_name,)) as pool:
        n_probs = pool.apply(_n_probs)
        val_games = [(i, 900000 + 7 * i + 13 * k) for i in range(n_probs) for k in range(4)]
        base = st.mean(pool.map(_eval, [(list(THETA0), val_games)])[0])
        print(f"题 {n_probs} 道；起点权重的验证分（平均 log）{base:.4f}", flush=True)
        best_val, best = base, list(THETA0)
        for g in range(gens):
            t = time.time()
            games = [(i, rng.randrange(1, 2**31 - 1)) for i in range(n_probs) for _ in range(2)]
            cands = [[rng.gauss(mean[d], sigma[d]) for d in range(dim)] for _ in range(pop - 1)] + [list(mean)]
            fits = [st.mean(x) for x in pool.map(_eval, [(c, games) for c in cands])]
            order = sorted(range(pop), key=lambda i: -fits[i])[:elite]
            for d in range(dim):
                xs = [cands[i][d] for i in order]
                m = st.mean(xs)
                mean[d] = 0.3 * mean[d] + 0.7 * m
                sigma[d] = max(0.03, 0.3 * sigma[d] + 0.7 * st.pstdev(xs))
            val = st.mean(pool.map(_eval, [(list(mean), val_games)])[0])
            if val > best_val:
                best_val, best = val, list(mean)
                THETA_FILE.write_text(json.dumps({"theta": [round(x, 4) for x in best], "set": set_name, "gen": g + 1,
                                                  "val_log": round(val, 4), "val_gain": round(math.exp(val - base), 4)}, indent=1))
            print(f"第 {g+1:2d} 代：这代最好 {max(fits):.4f} 中位 {st.median(fits):.4f}｜均值权重的验证分 {val:.4f}（相对起点 ×{math.exp(val-base):.3f}）｜最好 ×{math.exp(best_val-base):.3f}｜σ 均值 {st.mean(sigma):.3f}｜{time.time()-t:.0f}s", flush=True)
    print("完成，最好权重", [round(x, 3) for x in best])

def _n_probs():
    return len(_W["probs"])

if __name__ == "__main__":
    main()
