"""命令行入口：python -m gkbench <命令>

  problems list
  problems import-loadouts DIR --set NAME [--random-seeds N]
  problems import-gkms PROBLEMS_JSONL --set NAME        （GKMS GakumasCLI.bench.problems build 的输出）
  run --set NAME --algo SPEC [--budget 秒] [--seeds 0,1] [--only 子串,...] [--label 名字] [--no-obs]
  report RUN_DIR... [--base 标签] [--out 文件]
  show RUN_DIR PROBLEM [--seed 0]                        一局的逐步记录
  upload RUN_DIR [--server URL]                          把本地运行交给服务器（服务器按种子重放核对）
  hosted --set NAME --algo SPEC [--budget 秒] [...]      托管跑：种子留在服务器，每步交动作
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def main(argv=None):
    ap = argparse.ArgumentParser(prog="gkbench")
    sub = ap.add_subparsers(dest="cmd", required=True)

    pp = sub.add_parser("problems")
    ps = pp.add_subparsers(dest="pcmd", required=True)
    ps.add_parser("list")
    pl = ps.add_parser("import-loadouts")
    pl.add_argument("dir")
    pl.add_argument("--set", required=True)
    pl.add_argument("--random-seeds", type=int, default=4)
    pg = ps.add_parser("import-gkms")
    pg.add_argument("jsonl")
    pg.add_argument("--set", required=True)

    pr = sub.add_parser("run")
    pr.add_argument("--set", required=True)
    pr.add_argument("--algo", required=True)
    pr.add_argument("--budget", type=float, default=5.0, help="每步时间预算（秒）")
    pr.add_argument("--seeds", default=None, help="只跑这些种子下标，逗号分隔")
    pr.add_argument("--only", default=None, help="只跑题号含这些子串的题，逗号分隔")
    pr.add_argument("--label", default=None)
    pr.add_argument("--no-obs", action="store_true", help="不存每步的完整观测（文件小很多）")

    rp = sub.add_parser("report")
    rp.add_argument("runs", nargs="+")
    rp.add_argument("--base", default=None)
    rp.add_argument("--out", default=None)

    sp = sub.add_parser("show")
    sp.add_argument("run")
    sp.add_argument("problem")
    sp.add_argument("--seed", type=int, default=0)

    up = sub.add_parser("upload")
    up.add_argument("run")
    up.add_argument("--server", default=None)

    hp = sub.add_parser("hosted")
    hp.add_argument("--set", required=True)
    hp.add_argument("--algo", required=True)
    hp.add_argument("--budget", type=float, default=5.0)
    hp.add_argument("--seeds", default=None)
    hp.add_argument("--only", default=None)
    hp.add_argument("--label", default=None)
    hp.add_argument("--server", default=None)

    a = ap.parse_args(argv)
    # GKMS 引擎会切换当前目录，参数里的路径先转成绝对路径
    cwd = Path(os.getcwd())

    def absp(p):
        return str((cwd / p).resolve()) if p else p

    if a.cmd == "problems":
        from . import problems as P
        if a.pcmd == "list":
            for s in P.list_sets():
                n = len(list(P.problems_dir(s).glob("*.json")))
                print(f"{s}\t{n} 题\t{P.problems_dir(s)}")
        elif a.pcmd == "import-loadouts":
            d, n = P.import_loadouts(absp(a.dir), a.set, a.random_seeds)
            print(f"导入 {n} 题 → {d}")
        elif a.pcmd == "import-gkms":
            d, n = P.import_gkms_bench(absp(a.jsonl), a.set)
            print(f"导入 {n} 题 → {d}")
    elif a.cmd == "run":
        from . import algos
        from .runner import run
        algo = algos.make(a.algo)
        seeds = [int(x) for x in a.seeds.split(",")] if a.seeds else None
        only = a.only.split(",") if a.only else None
        out = run(a.set, algo, a.budget, seeds, only, a.label, keep_obs=not a.no_obs)
        print(f"完成 → {out}")
    elif a.cmd == "report":
        from .report import markdown, summarize
        rows = summarize([absp(r) for r in a.runs], a.base)
        md = markdown(rows, a.base)
        print(md)
        if a.out:
            Path(absp(a.out)).write_text(md + "\n")
    elif a.cmd == "upload":
        from .client import upload
        r = upload(absp(a.run), a.server)
        print(f"收下 {r['accepted']} 局 → {r['run']}" + (f"；拒收 {len(r['rejected'])} 局：{r['rejected'][:5]}" if r["rejected"] else ""))
    elif a.cmd == "hosted":
        from . import algos
        from .client import hosted
        hosted(a.set, algos.make(a.algo), a.budget, a.label,
               [int(x) for x in a.seeds.split(",")] if a.seeds else None,
               a.only.split(",") if a.only else None, a.server)
    elif a.cmd == "show":
        from .runner import read_episodes
        for e in read_episodes(absp(a.run)):
            if a.problem in e["problem"] and e["seed_index"] == a.seed:
                print(f"{e['problem']} #{e['seed_index']}  终局 {e['final']['score']:,}  {e['final']}")
                for s in e["steps"]:
                    d = s["result"]["delta"]
                    print(f"  T{s['turn']:>2} #{s['i']:>3} {str(s['action']):<14} {s['think_ms']:>9.1f}ms  "
                          f"分 {s['result']['after']['score']:>9,}  变化 {json.dumps(d, ensure_ascii=False)}")
                break
        else:
            sys.exit("没找到这一局")


if __name__ == "__main__":
    main()
