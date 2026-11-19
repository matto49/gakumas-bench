# 出牌算法评测：规则与数据

初星攻略站「試験集合 / 算法排行」背后的评测规则。网页上说「牌序」，这里按数据层的叫法说「种子」。数据格式的完整定义见 [format.md](format.md)。

核心规则：**裁判握着种子和完整局面，算法只拿画面上看得到的信息。** 每一步算法交回一个动作，裁判推进引擎，记下结果。看种子的搜索只作「理论上限」当分母，不参与排名。

## 题和答：审查存档格式

题和答都按 **`gkms.audition_save.v2`**（GKMS-STD-001 v2，审查存档格式）存。一个存档是一道题加若干条答：

```
{
 "format": "gkms.audition_save.v2",
 "id": "AS-C3Y5EFGV",                       ← 编号：由题的内容算出，改一个字就变
 "loadout": { … 编成，紧凑写法 … },          ← 不带 seed 是「题模板」，带 seed 是「固定种子题」
 "prefix": "", "objective": {},
 "check": { … },                             ← 固定种子题的起点核对；题模板为 {}
 "meta": { "stage": "hif.main1", "mechanic": "review", "turns": 12,
           "family": "AF-HJK5CKYX",          ← 题族编号：同一开局（不论种子）都一样
           "source": {…}, "tags": ["name:hif-campus-hiro-20261019-r1"], "created": "…" },
 "runs": [ { "algo": "external:uinet", "step_seconds": 5, "rules": 55, "mode": "self", "by": "matto",
             "cols": ["score", "secs", "step_ms", "at", "route"],
             "rows": [[504510, 0.17, [6, 5, …], "20261109T151417Z", "p1 d0 p2 … e"]] } ]
}
```

每条答的核心是**路线**：一串动作记号（`p<i>` 出第 i 张手牌、`d<i>` 喝第 i 瓶饮料、`e` 结束回合、`s<i>,<j>` 选牌）。任何实现了这个格式的引擎，拿编成和种子就能重放核对。完整的字段说明见 [docs/format.md](format.md)。

### 系统里各概念和格式的对应

| 系统里 | 审查存档里 |
|---|---|
| 一道题 | 一个**题模板**（`AS-` 编号，编成不带种子）。题库就是一组题模板，公开 |
| 题集里的固定种子 | **固定种子题**（题模板 + 一个种子，有自己的 `AS-` 编号和起点核对）。种子私有；开发集可设成公开 |
| 同一开局 | **题族**（`AF-` 编号，写在 `meta.family`） |
| 一次运行 | 一张**算法表**：`algo` `params` `budget`/`seconds`/`step_seconds` `rules` `machine` `mode` `by` |
| 一局 | 一条**答**：`score` `secs` `step_ms` `at` `route`，题模板的答再加 `exam_sha`（保密种子的哈希） |
| 方式 | `mode`：`internal` 内置 · `self` 自报 · `hosted` 托管 · `player` 玩家实战 |
| 超时 | 某一步 `step_ms` 超过 `step_seconds × 1200 + 50` |

我们自己的逐局记录（`gkbench.episode.v2`）比答多存了每一步的观测、算法说明和裁判视角的隐藏状态，用来做复盘页；字段名和存档保持一致，随时能转成答。

## 試験集合

所有算法排行和托管评测都按「試験集合」选题。网页上的「試験集合」页列出全部集合（名称、说明、题数、场景分布、提交人、跑过几种算法），点进去能按场景筛选、分组，看每道题的偶像、牌组、P 道具、饮料、回合数和题族编号，下载题模板。

- **官方集合**：管理员维护，算法排行默认展示。2026-11-19 时有 `hif`（H.I.F，505 题，核心题单 120 题 × 8 种牌序）、`nia`（N.I.A，39 题）、`hajime`（初，48 题）、`idolroad`（偶像之路，163 题）。
- **社区集合**：登录用户自己建、自己传题，有自己的算法排行；管理员审核后可以整个升为官方（`PATCH /api/sets/{set} {"status":"official"}`，网页上集合页的「审核通过」按钮）。管理员名单是环境变量 `GKBENCH_ADMINS`，默认 `matto`。
- **场景**全部自动算，不靠手填：考试、轮次读编成的 `produce_id`、`round`，阶段、机制、回合数由引擎算（`meta.stage` / `mechanic` / `turns`），流派按偶像卡。新考试只要在 `web/src/lib/game.ts` 的 `EXAM` 补名字。
- **上传**：用命令行工具 `gkbench` 传开局配置（`gkms.hif_loadout.v1`，服务器替它算编号）或 `.gksave.json`（可多个，可 JSON Lines；网页上只有说明，没有上传按钮）。`curl -fsSL https://hiro.matto.top/gkbench/install.sh | sh` 安装，`gkbench login` 在浏览器里点授权，`gkbench upload exam.json --set <集合>` 上传；源码在 `server/cmd/gkbench`，`build.sh` 出各平台的可执行文件，放到服务器 `$GKBENCH_DATA/static/cli/`。每道题交给引擎核对（编号、题族、起点、能开局；worker 的 `check_problem`），同一集合里题族编号相同的算重复；固定种子题去掉种子收成题模板，种子另记成固定种子。入库后评测时自动配 32 个保密种子。

      python -m gkbench upload-problems --new "我的集合" a.gksave.json b.gksave.json
      python -m gkbench upload-problems --set u-matto-1a2b3c c.gksave.json

  自己出题：按 [docs/format.md](format.md) 的「写一道题」写一份开局配置（`gkms.hif_loadout.v1`；字段表、完整例子、编号去哪查都在那一章，可以直接交给 AI 照着写），
  直接传上去就行（`curl … -F files=@exam.json ".../api/sets/<集合>/problems?wait=1"`，见那一章）。改一份现成的 `.gksave.json` 则要先用 `save make` 重算编号（直接传改过的存档会因「编号不符」被拒），这一步只用格式模块，不需要 GKMS：

      python -m gkbench save make exam.json --name 题名 --out .    # 生成 AS-编号.gksave.json

## 两种评测

网页上不说「种子」，说「牌序」，也只展示保密种子（每题随机 32 种牌序）的排行；固定种子的运行仍然能跑、能上传、能按链接打开，只是不再单列排行，首页和「我的」页也不再放它的入口。下面是命令行和数据层面的说明，仍按种子来讲。

| | 固定种子 | 保密种子（题模板 · 32 个固定种子） |
|---|---|---|
| 种子 | 题集自带，开发集可公开下载，测试集只在服务器 | 每个题模板固定一组 32 个，只在服务器上；所有算法、每次评测都打这一组 |
| 怎么跑 | 本地跑完上传（`self`），或托管跑（`hosted`） | 只能托管跑（`gkbench eval`），算法看不到种子 |
| 怎么比 | 同题同种子逐局配对；有理论上限当分母 | 同样逐局配对（同题同格子就是同一个种子）；平均分先按题平均再对题平均；理论上限由管理员在同一组种子上跑 |
| 公开什么 | 成绩、逐步记录、`exam_sha`、存档里的答 | 只公开成绩；逐步记录登录后才能看；`exam_sha` 和存档里的答都不公开 |
| 排行 | 「固定种子」 | 「保密种子」 |

保密种子怎么来：`HMAC-SHA256(私钥, "<题族编号>:<i>")` 前 8 字节 mod (2³¹−2) + 1，i 从 0 数，跳过重复的和固定种子题用过的，取满 32 个（`server/tseeds.go`）。题族编号是公开的，所以必须带私钥 `private/template-seed.key`；生成结果存在 `private/seeds/<题集>.template.json`，以后这道题永远用这一组。种子空间只有约 21 亿，`exam_sha`（种子十进制串的 SHA-256）和固定种子题编号都能穷举反推出种子，所以保密种子和测试集的这两样都不下发。

**核心题单**（2026-11-12 起，目前只有 hif）：集合可以定一份核心题单和每题牌序数（`private/sets.json` 的 `core` / `core_seeds`，管理员 `PATCH /api/sets/{集合}` 设）。评测缺省只跑核心题、每题前 `core_seeds` 个保密种子（托管、管理员本机跑、评测机都一样；`--full` 跑全部题 × 32），排行缺省也只按这些格子算（`?scope=all` 看全部），没跑全核心题的行排在后面、不排名次。依据：同一道题换牌序的分差（对数 σ≈0.4）远大于相近算法在不同题上的差别（σ≈0.1～0.2），同样局数多放题、少几个牌序更准；hif 从 505 题 × 32（16160 局）减到 120 题 × 8（960 局），相近算法对比的标准误约 ±1.9%。题单用 `python -m gkbench.pick_core --set hif --n 120 --seeds 8` 分层挑（实战题全留、每张偶像卡至少一道、每个「机制 × 关卡」至少两道、其余按「偶像 × 关卡」题量分），再从多次随机里取和全量成绩最接近的一份；`--apply` 写到服务器。

2026-11-09 以前的题模板评测是每次临时抽种子，各算法种子不同，和现在的成绩不可比；运行里没有 `template_seeds` 字段，排行里单独列在「旧版评测」（`kind=legacy`）。

在哪台机器上跑：算法总在跑评测的那台机器上算。托管时裁判（推进对局、生成「可能的世界」）在服务器上，每一步都要来回一次网络；所以**管理员默认在自己机器上整局跑完再上传**：本机有 `private/seeds/<题集>.template.json` 时，`gkbench eval` 直接在本机跑保密种子（不受网络和服务器重启影响），跑完上传，服务器按它自己的保密种子逐局重放核对，记为「内置」（`mode=internal`）。要托管跑加 `--hosted`；没有种子文件的普通用户只能托管。只有管理员能上传保密种子运行和理论上限。

理论上限（管理员）：把服务器的 `private/template-seed.key` 和 `private/seeds/<题集>.template.json` 拷到本机（600），`gkbench run --set <题集> --algo oracle:seconds=30 --template --label oracle-30s`，再把运行目录放到服务器的 `runs/` 下。

游戏官方 AI（管理员）：`gkbench eval --set <题集> --algo official-ai`，本机有保密种子时在本机跑完上传，照常排名，网页上名字显示为「asahi老师策略」（算法的 `title`），标「游戏官方 AI」「看牌序」。它的决策代码在 GKMS 的 `GKMSContest/official_ai`（稀疏检出要 `git sparse-checkout add GKMSContest`），第一次跑会用本机的 `c++` 编一个核心扩展（`gkbench/algos/native/official_ai_ext.cpp`，缓存在 `~/.cache/gkbench`）。

托管跑时，需要「可能的世界」的算法（PIMC 等）可以向服务器要：服务器把山札顺序、随机数、种子都重抽后导出发给客户端（约 3 KB / 个）；`tests/test_worlds.py` 检查导出数据里没有真种子。

## 接自己的算法（完整说明）

**进排行看耗时**：把算法提交到 [`submissions/`](../submissions/README.md)（开 PR）。合并后由固定的评测机（作者的 Mac：Apple M4，16 GB）
在空闲时用保密种子跑完、上传，排行标「固定机器」：所有提交同一台机器、同一个 Python 环境，算法在 `sandbox-exec` 沙盒的单独进程里跑
（断网、读不到种子和机器上的其他文件，裁判在另一个进程，见 `gkbench/sandbox.py`），所以耗时可以互相比。
评测机：`python -m gkbench runner --once --pull`，launchd 每 15 分钟叫一次（`--install-launchd` 装），见 `gkbench/bench_runner.py`。

**自己跑（托管评测，耗时不可比）**：不用改本仓库，也不需要 GKMS：写一个 `.py` 文件，装好本包、拿到令牌，就能托管评测进排行。

1. 装包：`pip install "gkbench @ git+https://github.com/matto49/gakumas-bench"`（Python 3.10+，只装 httpx、zstandard）。
2. 令牌：网页「我的」页生成，存到 `~/.config/gkbench/token`（或设 `GKBENCH_TOKEN`）。
3. 写算法：继承 `gkbench.algos.base.Algorithm`，实现 `decide(ctx) -> Decision(action, meta)`。
   `ctx.obs` 是公开观测（UIObs v1，字段见 `docs/format.md`「公开观测」），返回的动作必须在 `ctx.obs["legal"]` 里。
   最小例子是 [`examples/first_playable.py`](../examples/first_playable.py)。
4. 跑：`python -m gkbench eval --set hif --algo my_algo.py:MyAlgo --parallel 3`
   （带参数写 `my_algo.py:MyAlgo:depth=2,k=8`；已安装的模块写 `mypkg.algo:MyAlgo`）。断了用 `--resume <评测编号>`。

- **要「可能的世界」的算法**（PIMC 这类）：`ctx.worlds(k)` 向服务器要 k 个重抽了隐藏信息的世界，在本机导入成 GKMS 会话，
  这一步要本机有 GKMS（`GKMS_ROOT`）。这类算法在类上写 `needs_gkms = True`，开局前就能报出缺什么；只看 `ctx.obs` 的算法保持缺省 `False`，
  全程不加载 GKMS。内置的贪心、PIMC、UINet、理论上限都是 `True`。
- **算法说明**：网站的运行页和算法排行会显示算法的大致思路、看得到什么（只看画面 / 看种子）和实现链接。本仓库内置的 random / greedy / pimc / uinet / oracle 由服务器按名字给（`server/algos.go`）；自己的算法在类上写 `about = {"summary": "一句话", "detail": ["分条说明"], "sees": "screen", "links": [{"title": "代码", "url": "https://…"}]}`，托管（`play`）和评测（`eval`）时会随运行提交（接口字段 `about`），没写就显示「提交人未提供」。
- **别的语言**：从网站下载题集的审查存档（首页「审查存档」），自己的程序打完后，把每局的路线写进存档的算法表，用 `save check` 在本地核对，再 `upload-saves` 或在网页「我的」页上传。服务器按存档编号找题和种子，逐条重放、核对分数，生成完整记录。
