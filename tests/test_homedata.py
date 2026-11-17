"""首页数据：新卡按 git 历史里第一次出现的日期算，起点之前就有的不算新"""
import subprocess

from gkbench.homedata import first_seen


def commit(repo, text, day):
    (repo / "IdolCard.yaml").write_text(text, encoding="utf-8")
    env = {"GIT_AUTHOR_DATE": f"{day}T12:00:00", "GIT_COMMITTER_DATE": f"{day}T12:00:00", "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin"}
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True, env=env)
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", day], check=True, env=env)


def test_first_seen(tmp_path):
    from datetime import date
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    commit(tmp_path, "- id: a\n  name: A\n", "2026-09-01")
    commit(tmp_path, "- id: a\n- id: b\n  nested:\n  - id: not-top\n", "2026-10-01")
    commit(tmp_path, "- id: a\n- id: b\n- id: c\n", "2026-11-01")
    got = first_seen(tmp_path, "IdolCard.yaml", date(2026, 9, 15))
    assert got == {"b": "2026-10-01", "c": "2026-11-01"}
