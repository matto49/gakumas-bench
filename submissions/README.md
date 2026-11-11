# 提交算法

算法以 PR 的形式提交到这个目录。PR 合进 `develop` 后，固定的一台评测机（作者的 Mac：Apple M4，16 GB）会在空闲时自动跑完、上传成绩。
所有提交都在同一台机器、同一个 Python 环境里跑，所以排行上的「每步耗时」可以互相比较；托管评测（`gkbench eval`）和自己上传的成绩不算固定机器计时。

## 怎么交

1. 复制 `_example/` 成 `submissions/<你的算法名>/`，改 `algo.py` 和 `submission.json`。
2. 本地自查：`python -m gkbench submissions check`，再用托管评测试跑几局：
   `python -m gkbench eval --set hif --algo submissions/<名字>/algo.py:类名 --seeds 2`
3. 开 PR。

`submission.json`：

| 字段 | 说明 |
|---|---|
| `label` | 排行上的名字，3–40 位小写字母、数字、`-`，全仓库唯一 |
| `entry` | `本目录里的文件.py:类名` |
| `params` | 构造参数（可选） |
| `author` | 你的 GitHub 用户名 |
| `sets` | 跑哪些题集：`hif`（缺省）、`nia`、`hajime`、`idolroad` |
| `step_seconds` | 每步时间预算，缺省 5，最多 10；超过 1.2 倍记超时 |

## 算法能用什么

- 类继承 `gkbench.algos.base.Algorithm`，实现 `decide(ctx)`；只能看 `ctx.obs`（公开观测，格式见 `docs/format.md`），要「可能的世界」用 `ctx.worlds(k)`（类上写 `needs_gkms = True`）。
- 环境：本仓库的 Python 环境（Python 3.12，numpy、onnxruntime、pyyaml，以及 GKMS 引擎）。不能自己装包；需要别的包在 PR 里说明。
- 可以带模型等数据文件（放在你的目录里，单个不超过 50 MB）。
- 评测时算法在 macOS 沙盒（`sandbox-exec`）的单独进程里跑：不能联网，读不到种子和评测机上的其他文件，只能写临时目录。
  裁判在另一个进程里，每步只把公开观测发给算法。
- 改了提交目录里的任何文件，合并后会重新跑一遍。
- 同一个算法的不同版本在排行上合成一个「家族」行（左边按钮展开看各版本）。家族默认按名字认（`my-algo-2.0` → `my-algo`）；
  想指定，在类的 `about` 里写 `"family": "my-algo"`，起显示名写 `"family_name": "My Algo"`（也可以在排行页家族行上点铅笔改）。
