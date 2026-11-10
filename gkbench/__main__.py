"""命令行入口：python -m gkbench <命令>

题库
  problems list
  problems import-loadouts DIR --set NAME [--random-seeds N]   一批 gkms.hif_loadout.v1 开局配置
  problems import-gkms PROBLEMS_JSONL --set NAME               GKMS GakumasCLI.bench.problems build 的输出
  problems import-saves FILE... --set NAME                     审查存档（题模板或固定种子题）
跑分
  run --set NAME --algo SPEC [--budget 秒] [--seeds 0,1] [--only 子串,...] [--label 名字] [--no-obs]
  report RUN_DIR... [--base 标签] [--out 文件]
  show RUN_DIR 题号或名字 [--seed 0]                          一局的逐步记录
交成绩
  upload RUN_DIR                                               固定种子：本地运行整个交上去，服务器重放核对（self）
  upload-saves FILE... [--label 名字]                          审查存档里的答（只要路线），服务器重放生成记录
  hosted --set NAME --algo SPEC [--budget 秒] [...]            固定种子托管跑（hosted）
  eval --set NAME --algo SPEC [--seeds 32] [--parallel 3] [--resume 评测编号]
                                                               保密种子评测：每个题模板 32 个固定种子，只在服务器（hosted）
审查存档（gkms.audition_save.v2）
  save export --set NAME [--runs RUN_DIR...] [--no-fixed] [--no-templates] --out FILE.jsonl
  save check FILE... [--no-replay]                             按第 5 章核对，并重放答
  save share FILE                                              分享码 GKAS1:…
  save unshare CODE [--out FILE]
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
    pi = ps.add_parser("import-saves")
    pi.add_argument("files", nargs="+")
    pi.add_argument("--set", required=True)

    pr = sub.add_parser("run")
    pr.add_argument("--set", required=True)
    pr.add_argument("--algo", required=True)
    pr.add_argument("--budget", type=float, default=5.0, help="每步时间预算（秒），写进表头 step_seconds")
    pr.add_argument("--seeds", default=None, help="只跑这些种子下标，逗号分隔")
    pr.add_argument("--only", default=None, help="只跑题号或名字含这些子串的题，逗号分隔")
    pr.add_argument("--label", default=None)
    pr.add_argument("--by", default=None, help="提交人（表头 by），默认当前用户名")
    pr.add_argument("--no-obs", action="store_true", help="不存每步的完整观测（文件小很多）")
    pr.add_argument("--template", action="store_true",
                    help="在题模板的 32 个固定保密种子上跑（管理员给理论上限用；种子文件要在本机 private/seeds/）")

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

    upp = sub.add_parser("upload-problems", help="往試験集合传考试（题模板 / 分享码）")
    upp.add_argument("files", nargs="*")
    upp.add_argument("--set", default=None, help="传进哪个集合（自己建的社区集合；管理员可传官方集合）")
    upp.add_argument("--new", default=None, metavar="名字", help="先新建一个社区集合再传")
    upp.add_argument("--code", action="append", default=[], help="GKAS1: 分享码，可多次")
    upp.add_argument("--server", default=None)

    us = sub.add_parser("upload-saves")
    us.add_argument("files", nargs="+")
    us.add_argument("--label", default=None)
    us.add_argument("--server", default=None)

    hp = sub.add_parser("hosted")
    hp.add_argument("--set", required=True)
    hp.add_argument("--algo", required=True)
    hp.add_argument("--budget", type=float, default=5.0)
    hp.add_argument("--seeds", default=None)
    hp.add_argument("--only", default=None)
    hp.add_argument("--label", default=None)
    hp.add_argument("--server", default=None)

    ep = sub.add_parser("eval")
    ep.add_argument("--set", required=False)
    ep.add_argument("--algo", required=True)
    ep.add_argument("--seeds", type=int, default=32, help="每道题跑前几个固定种子（默认全部 32 个）")
    ep.add_argument("--parallel", type=int, default=3, help="同时跑几局")
    ep.add_argument("--budget", type=float, default=5.0)
    ep.add_argument("--only", default=None)
    ep.add_argument("--label", default=None)
    ep.add_argument("--resume", default=None, help="接着跑某次评测没打完的局")
    ep.add_argument("--server", default=None)

    sv = sub.add_parser("save")
    ss = sv.add_subparsers(dest="scmd", required=True)
    se = ss.add_parser("export")
    se.add_argument("--set", required=True)
    se.add_argument("--runs", nargs="*", default=[])
    se.add_argument("--no-fixed", action="store_true", help="不导出固定种子题")
    se.add_argument("--no-templates", action="store_true", help="不导出题模板")
    se.add_argument("--out", required=True, help=".jsonl（多个存档）或目录（每个存档一个 <编号>.gksave.json）")
    sc = ss.add_parser("check")
    sc.add_argument("files", nargs="+")
    sc.add_argument("--no-replay", action="store_true")
    sh = ss.add_parser("share")
    sh.add_argument("file")
    su = ss.add_parser("unshare")
    su.add_argument("code")
    su.add_argument("--out", default=None)

    a = ap.parse_args(argv)
    # GKMS 引擎会切换当前目录，参数里的路径先转成绝对路径
    cwd = Path(os.getcwd())

    def absp(p):
        return str((cwd / p).resolve()) if p else p

    if a.cmd == "problems":
        from . import problems as P
        if a.pcmd == "list":
            for s in P.list_sets():
                n = len(list(P.problems_dir(s).glob("*.gksave.json")))
                print(f"{s}\t{n} 个题模板\t{P.problems_dir(s)}")
        elif a.pcmd == "import-loadouts":
            d, n = P.import_loadouts(absp(a.dir), a.set, a.random_seeds)
            print(f"导入 {n} 题 → {d}")
        elif a.pcmd == "import-gkms":
            d, n = P.import_gkms_bench(absp(a.jsonl), a.set)
            print(f"导入 {n} 题 → {d}")
        elif a.pcmd == "import-saves":
            ids = P.import_saves([absp(f) for f in a.files], a.set)
            print(f"导入 {len(ids)} 个存档 → 题模板 {sorted(set(ids))}")
    elif a.cmd == "run":
        from . import algos
        from .runner import run
        algo = algos.make(a.algo)
        seeds = [int(x) for x in a.seeds.split(",")] if a.seeds else None
        only = a.only.split(",") if a.only else None
        out = run(a.set, algo, a.budget, seeds, only, a.label, keep_obs=not a.no_obs, by=a.by, template=a.template)
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
    elif a.cmd == "upload-problems":
        from .client import upload_problems
        if not a.set and not a.new:
            raise SystemExit("要 --set <集合> 或 --new <名字>")
        r = upload_problems(a.set, [absp(f) for f in a.files], a.code, a.server, a.new)
        print(f"集合 {r['set']}：收下 {r['accepted']} 道" + "".join(f"\n  + {x['id']} {x.get('name', '')}" for x in r.get("added") or []))
        for x in r["rejected"]:
            print(f"  没收 {x['id']}：{x['reason']}")
    elif a.cmd == "upload-saves":
        from .client import upload_saves
        r = upload_saves([absp(f) for f in a.files], a.server, a.label)
        print(f"收下 {r['accepted']} 条答 → {r.get('runs') or r.get('run')}" +
              (f"；拒收 {len(r['rejected'])} 条：{r['rejected'][:5]}" if r["rejected"] else ""))
    elif a.cmd == "hosted":
        from . import algos
        from .client import hosted
        hosted(a.set, algos.make(a.algo), a.budget, a.label,
               [int(x) for x in a.seeds.split(",")] if a.seeds else None,
               a.only.split(",") if a.only else None, a.server)
    elif a.cmd == "eval":
        from .client import evaluate
        if not a.set and not a.resume:
            sys.exit("要 --set（新评测）或 --resume（接着跑）")
        evaluate(a.set, a.algo, a.seeds, a.parallel, a.budget, a.label, a.only.split(",") if a.only else None,
                 a.resume, a.server)
    elif a.cmd == "save":
        from . import archive, save
        if a.scmd == "export":
            docs = archive.export(a.set, [absp(r) for r in a.runs], fixed=not a.no_fixed, templates=not a.no_templates)
            out = Path(absp(a.out))
            if out.suffix == ".jsonl":
                out.write_text("".join(json.dumps(d, ensure_ascii=False) + "\n" for d in docs))
            else:
                out.mkdir(parents=True, exist_ok=True)
                for d in docs:
                    (out / f"{d['id']}.gksave.json").write_text(save.dumps(d))
            n_ans = sum(len(r["rows"]) for d in docs for r in d["runs"])
            print(f"导出 {len(docs)} 个存档（{sum(save.is_template(d) for d in docs)} 个题模板），答 {n_ans} 条 → {out}")
        elif a.scmd == "check":
            all_ok = True
            for f in a.files:
                for d in archive.load_docs(absp(f)):
                    lines, ok = archive.check(d, replay_answers=not a.no_replay)
                    all_ok &= ok
                    print("\n".join(lines))
            sys.exit(0 if all_ok else 1)
        elif a.scmd == "share":
            for d in archive.load_docs(absp(a.file)):
                print(save.share_code(d))
        elif a.scmd == "unshare":
            d = save.from_share_code(a.code)
            save.read(d)
            text = save.dumps(d)
            if a.out:
                Path(absp(a.out)).write_text(text)
                print(f"{d['id']} → {a.out}")
            else:
                print(text, end="")
    elif a.cmd == "show":
        from .runner import read_episodes
        for e in read_episodes(absp(a.run)):
            if (a.problem in e["id"] or a.problem in (e.get("name") or "")) and e["seed_index"] == a.seed:
                print(f"{e.get('name') or e['id']}（{e['id']}）#{e['seed_index']}  终局 {e['final']['score']:,}")
                print(f"  路线 {e['route']}")
                for s in e["steps"]:
                    d = s["result"]["delta"]
                    print(f"  T{s['turn']:>2} #{s['i']:>3} {s['token']:<6} {s['step_ms']:>9.1f}ms  "
                          f"分 {s['result']['after']['score']:>9,}  变化 {json.dumps(d, ensure_ascii=False)}")
                break
        else:
            sys.exit("没找到这一局")


if __name__ == "__main__":
    main()
