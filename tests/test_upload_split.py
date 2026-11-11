"""gkbench upload 分批：服务器一次最多收 1000 局，多了按题切开，同一道题的局在同一批。"""
from gkbench.client import split_by_problem


def eps(n_problems, per):
    return [{"id": f"AS-{p:03d}", "seed_index": i} for p in range(n_problems) for i in range(per)]


def test_small_run_is_one_batch():
    assert len(split_by_problem(eps(3, 32), 1000)) == 1


def test_batches_keep_problems_whole_and_respect_limit():
    chunks = split_by_problem(eps(100, 32), 1000)      # 3200 局
    assert sum(len(c) for c in chunks) == 3200
    assert all(len(c) <= 1000 for c in chunks)
    seen = {}
    for i, c in enumerate(chunks):
        for e in c:
            assert seen.setdefault(e["id"], i) == i      # 同一道题不跨批
    assert len(chunks) == 4                               # 每批 31 题 = 992 局
