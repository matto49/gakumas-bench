"""2026-11-11 集合按模式合并：hif / nia / hajime / idolroad 四个，gkms480 删掉（移进 trash）。在服务器上跑一次。

  /opt/gkbench/app/.venv/bin/python tools/merge_sets_20261111.py            # 只打印要做什么
  /opt/gkbench/app/.venv/bin/python tools/merge_sets_20261111.py --apply    # 先整体备份，再改

做的事（$GKBENCH_DATA，默认 /srv/gkbench-data）：
  1. 备份 problems/、private/sets.json、private/seeds/、runs/*/run.json 到 trash/<时间>-set-merge-backup.tgz
  2. 旧集合的题搬进新集合，每道题写 meta.by（提交人）和 meta.source.kind（来源）；偶像之路补 meta.stage = tower.<层>
  3. 牌序文件（<集>.json 固定种子、<集>.template.json 保密种子）按题号合并进新集合；种子只和题族、私钥有关，不重算
  4. 成绩 runs/*/run.json 的 set 改成新集合名（rules 等其他字段不动，排行照旧按规则版本分行）
  5. gkms480 的题、牌序、成绩整个移进 trash/<时间>-gkms480/
  6. private/sets.json：删旧集合，加四个新集合
旧集合名之后由服务器 server/setalias.go 自动指向新集合。
"""
import json
import os
import shutil
import sys
import tarfile
import time
from pathlib import Path

DATA = Path(os.environ.get("GKBENCH_DATA", "/srv/gkbench-data"))
APPLY = "--apply" in sys.argv
STAMP = time.strftime("%Y%m%d-%H%M%S")

# 新集合 → [(旧集合, 提交人, 来源)]
GROUPS = {
    "hif": [("hif-live", "matto", "live"), ("hif-history", "matto", "history"), ("hif-yuzeis", "yuzeis", "capture")],
    "nia": [("nia-history", "matto", "history"), ("nia-yuzeis", "yuzeis", "capture")],
    "hajime": [("hajime-history", "matto", "history"), ("hajime-yuzeis", "yuzeis", "capture"),
               ("hajime-lesson-yuzeis", "yuzeis", "capture")],
    "idolroad": [("idolroad-yuzeis", "yuzeis", "capture")],
}
DROP = "gkms480"
NEW_SETS = {
    "hif": ("H.I.F", "H.I.F 实战开局：選抜 1～3、本戦两轮。来源有实战存档、育成履歴和 GKMS 采集站实录，按提交人、来源可筛选。"),
    "nia": ("N.I.A", "N.I.A（プロ、マスター）实战开局：中间审查 1、2 和最终审查，都是开考时的实际状态。"),
    "hajime": ("初", "初（レギュラー、レジェンド）实战开局：中间审查、最终审查和培育课程，都是开考时的实际状态。"),
    "idolroad": ("偶像之路", "偶像之路 8～27 层的实战开局，都是开考时的实际状态。"),
}
OLD = {old: new for new, olds in GROUPS.items() for old, _, _ in olds}

try:
    from gkbench.save import dumps as save_dumps          # 和服务器收题写盘同一种排版
except Exception:  # noqa: BLE001
    def save_dumps(doc):
        return json.dumps(doc, ensure_ascii=False, indent=1) + "\n"


def log(*a):
    print(("" if APPLY else "[试跑] ") + " ".join(str(x) for x in a))


def read(p):
    return json.loads(Path(p).read_text())


def write_json(p, obj, mode=None, like=None):
    if not APPLY:
        return
    p = Path(p)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1))
    if mode is not None:
        os.chmod(tmp, mode)
    if like is not None and Path(like).exists():
        st = os.stat(like)
        os.chown(tmp, st.st_uid, st.st_gid)
    os.replace(tmp, p)


def move(src, dst):
    log("移走", src, "→", dst)
    if APPLY:
        Path(dst).parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))


def backup():
    out = DATA / "trash" / f"{STAMP}-set-merge-backup.tgz"
    log("备份", out)
    if not APPLY:
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(out, "w:gz") as t:
        t.add(DATA / "problems", arcname="problems")
        t.add(DATA / "private" / "sets.json", arcname="private/sets.json")
        t.add(DATA / "private" / "seeds", arcname="private/seeds")
        for rj in sorted((DATA / "runs").glob("*/run.json")):
            t.add(rj, arcname=f"runs/{rj.parent.name}/run.json")
    os.chmod(out, 0o600)


def merge_problems():
    for new, olds in GROUPS.items():
        nd = DATA / "problems" / new
        if nd.exists() and any(nd.glob("*.gksave.json")):
            raise SystemExit(f"{nd} 已经有题，不重复合并")
        first_old = DATA / "problems" / olds[0][0]
        log("建集合目录", nd)
        if APPLY:
            nd.mkdir(parents=True, exist_ok=True)
            st = os.stat(first_old)
            os.chown(nd, st.st_uid, st.st_gid)
        seen = {}
        for old, by, kind in olds:
            od = DATA / "problems" / old
            files = sorted(f for f in od.glob("AS-*.gksave.json"))
            log(f"  {old} → {new}：{len(files)} 道（提交人 {by}，来源 {kind}）")
            for f in files:
                doc = read(f)
                meta = doc.setdefault("meta", {})
                fam = meta.get("family")
                if fam in seen:
                    raise SystemExit(f"题族重复：{fam} 在 {seen[fam]} 和 {old}")
                seen[fam] = old
                meta["by"] = by
                src = meta.get("source") if isinstance(meta.get("source"), dict) else {}
                meta["source"] = {"kind": kind, **({"note": src["note"]} if src.get("note") else {})}
                lo = doc.get("loadout") or {}
                if not meta.get("stage") and lo.get("produce_id") == "tower" and lo.get("layer"):
                    meta["stage"] = f"tower.{int(lo['layer'])}"
                if APPLY:
                    dst = nd / f.name
                    dst.write_text(save_dumps(doc))
                    st = os.stat(f)
                    os.chown(dst, st.st_uid, st.st_gid)
                    os.chmod(dst, st.st_mode & 0o777)
            move(od, DATA / "trash" / f"{STAMP}-set-merge" / "problems" / old)


def merge_seeds():
    sd = DATA / "private" / "seeds"
    for new, olds in GROUPS.items():
        for suffix in (".json", ".template.json"):
            merged, base, like = {}, None, None
            for old, _, _ in olds:
                p = sd / f"{old}{suffix}"
                if not p.is_file():
                    continue
                doc = read(p)
                base = base or doc
                like = like or p
                for pid, rows in (doc.get("problems") or {}).items():
                    if pid in merged:
                        raise SystemExit(f"牌序重复：{pid}（{p}）")
                    merged[pid] = rows
            if base is None:
                continue
            out = dict(base, set=new, problems=merged)
            log(f"牌序 {new}{suffix}：{len(merged)} 道")
            write_json(sd / f"{new}{suffix}", out, mode=0o600, like=like)
            for old, _, _ in olds:
                p = sd / f"{old}{suffix}"
                if p.is_file():
                    move(p, DATA / "trash" / f"{STAMP}-set-merge" / "seeds" / p.name)


def fix_runs():
    for rj in sorted((DATA / "runs").glob("*/run.json")):
        info = read(rj)
        s = info.get("set")
        if s in OLD:
            log(f"成绩 {rj.parent.name}：set {s} → {OLD[s]}")
            info["set"] = OLD[s]
            write_json(rj, info, mode=os.stat(rj).st_mode & 0o777, like=rj)
        elif s == DROP:
            move(rj.parent, DATA / "trash" / f"{STAMP}-{DROP}" / "runs" / rj.parent.name)


def drop_gkms480():
    p = DATA / "problems" / DROP
    if p.exists():
        move(p, DATA / "trash" / f"{STAMP}-{DROP}" / "problems" / DROP)
    for f in sorted((DATA / "private" / "seeds").glob(f"{DROP}.*")):
        move(f, DATA / "trash" / f"{STAMP}-{DROP}" / "seeds" / f.name)


def fix_sets_json():
    p = DATA / "private" / "sets.json"
    m = read(p)
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for old in list(OLD) + [DROP]:
        if old in m:
            log("集合配置删除", old)
            m.pop(old)
    for new, (title, blurb) in NEW_SETS.items():
        log("集合配置新增", new, title)
        m[new] = {"public_seeds": False, "title": title, "blurb": blurb, "owner": "matto",
                  "status": "official", "created": now}
    write_json(p, m, mode=0o600, like=p)


if __name__ == "__main__":
    for new, olds in GROUPS.items():
        for old, _, _ in olds:
            if not (DATA / "problems" / old).is_dir():
                raise SystemExit(f"缺旧集合 {old}")
    backup()
    merge_problems()
    merge_seeds()
    fix_runs()
    drop_gkms480()
    fix_sets_json()
    log("完成" if APPLY else "试跑完成，加 --apply 真改")
