# gakumas-bench

学園アイドルマスター考试出牌算法的 benchmark：同样的题、同样的种子、同样的时间预算，比各个算法打出的分数和耗时。

线上：<https://hiro.matto.top/gkbench/>（算法排行、运行、复盘、对比、牌库（技能卡 / 饮料 / P 道具图鉴）公开只读；用 GitHub 登录或注册账号后就能交成绩）

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

每条答的核心是**路线**：一串动作记号（`p<i>` 出第 i 张手牌、`d<i>` 喝第 i 瓶饮料、`e` 结束回合、`s<i>,<j>` 选牌）。任何实现了这个格式的引擎，拿编成和种子就能重放核对。完整的字段说明见 [docs/format.md](docs/format.md)。

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

## 两种评测

| | 固定种子 | 保密种子（题模板 · 32 个固定种子） |
|---|---|---|
| 种子 | 题集自带，开发集可公开下载，测试集只在服务器 | 每个题模板固定一组 32 个，只在服务器上；所有算法、每次评测都打这一组 |
| 怎么跑 | 本地跑完上传（`self`），或托管跑（`hosted`） | 只能托管跑（`gkbench eval`），算法看不到种子 |
| 怎么比 | 同题同种子逐局配对；有理论上限当分母 | 同样逐局配对（同题同格子就是同一个种子）；平均分先按题平均再对题平均；理论上限由管理员在同一组种子上跑 |
| 公开什么 | 成绩、逐步记录、`exam_sha`、存档里的答 | 只公开成绩；逐步记录登录后才能看；`exam_sha` 和存档里的答都不公开 |
| 排行 | 「固定种子」 | 「保密种子」 |

保密种子怎么来：`HMAC-SHA256(私钥, "<题族编号>:<i>")` 前 8 字节 mod (2³¹−2) + 1，i 从 0 数，跳过重复的和固定种子题用过的，取满 32 个（`server/tseeds.go`）。题族编号是公开的，所以必须带私钥 `private/template-seed.key`；生成结果存在 `private/seeds/<题集>.template.json`，以后这道题永远用这一组。种子空间只有约 21 亿，`exam_sha`（种子十进制串的 SHA-256）和固定种子题编号都能穷举反推出种子，所以保密种子和测试集的这两样都不下发。

2026-11-09 以前的题模板评测是每次临时抽种子，各算法种子不同，和现在的成绩不可比；运行里没有 `template_seeds` 字段，排行里单独列在「旧版评测」（`kind=legacy`）。

理论上限（管理员）：把服务器的 `private/template-seed.key` 和 `private/seeds/<题集>.template.json` 拷到本机（600），`gkbench run --set <题集> --algo oracle:seconds=30 --template --label oracle-30s`，再把运行目录放到服务器的 `runs/` 下。

托管跑时，需要「可能的世界」的算法（PIMC 等）可以向服务器要：服务器把山札顺序、随机数、种子都重抽后导出发给客户端（约 3 KB / 个）；`tests/test_worlds.py` 检查导出数据里没有真种子。

## 组成

| 目录 | 技术 | 内容 |
|---|---|---|
| `server/` | Go | 服务器：接口、令牌、上传核对、托管对局、保密种子评测（`tseeds.go` 生成种子）、存档下载与上传、排行榜；`cmd/catalog` 生成卡牌目录 |
| `web/` | Vite + React + TypeScript + Tailwind | 网页：介绍、排行、运行详情、单局复盘、两算法对比、我的 |
| `gkbench/` | Python | 和 GKMS 引擎打交道的部分（GKMS、UINet 本身是 Python 库）：审查存档（`save.py`）、题库、裁判、世界采样、算法、本地跑分、客户端、引擎子进程 |
| `docs/format.md` | | 数据格式 |
| `PRODUCT.md` | | 产品定位（impeccable 用） |

题库、种子、运行结果、令牌都在仓库外的 `$GKBENCH_DATA`（默认 `~/github/gakumas-bench-data`，线上 `/srv/gkbench-data`）。

## 依赖

- GKMSProject 克隆（`GKMS_ROOT`，默认 `~/github/_ext/GKMSProject`，要 `GakumasCLI`、`GKMSUINet`）和编好的原生核心：

      cd $GKMS_ROOT/GakumasCLI/native
      clang++ -O3 -ffp-contract=off -std=c++17 -Wno-unused-function -Wno-misleading-indentation -shared -fPIC -pthread \
          -o build/libgkmscore.dylib api.cpp          # Linux：sh build.sh，产物移到 build/libgkmscore.so

- UINet 公开仓库（`GKMS_UINET_REPO`，默认 `~/github/_ext/GKMSUINet`，MIT）。
- Python 3.12+：`uv venv .venv && uv pip install --python .venv/bin/python numpy zstandard onnxruntime pyyaml httpx pytest`
- Go 1.25+，Node 22+ 和 pnpm。

## 命令

    # 题库（题模板 + 私有种子）
    .venv/bin/python -m gkbench problems list
    .venv/bin/python -m gkbench problems import-loadouts <开局配置目录> --set hif-live --random-seeds 4
    .venv/bin/python -m gkbench problems import-gkms <GKMS bench problems.jsonl> --set gkms480
    .venv/bin/python -m gkbench problems import-saves <存档>... --set my-set

    # 本地跑固定种子题
    .venv/bin/python -m gkbench run --set hif-live --algo uinet
    .venv/bin/python -m gkbench run --set hif-live --algo pimc:worlds=16,mode=vote --budget 2 --label pimc-vote-16w-2s
    .venv/bin/python -m gkbench run --set hif-live --algo oracle:seconds=30 --label oracle-30s
    .venv/bin/python -m gkbench report $GKBENCH_DATA/runs/<运行>... --base greedy
    .venv/bin/python -m gkbench show $GKBENCH_DATA/runs/<运行> <题名或编号> --seed 0

    # 交成绩
    .venv/bin/python -m gkbench upload $GKBENCH_DATA/runs/<运行>                     # 整次运行（self）
    .venv/bin/python -m gkbench upload-saves my.gksave.jsonl --label my-algo        # 存档里的答（只要路线，self）
    .venv/bin/python -m gkbench hosted --set hif-live --algo uinet                   # 固定种子托管跑（hosted）
    .venv/bin/python -m gkbench eval --set hif-live --algo uinet --parallel 3        # 保密种子：每题 32 个固定种子（hosted）
    .venv/bin/python -m gkbench eval --resume <评测编号> --algo uinet                  # 中断后接着跑

    # 审查存档
    .venv/bin/python -m gkbench save export --set hif-live --runs $GKBENCH_DATA/runs/* --out hif-live.gksave.jsonl
    .venv/bin/python -m gkbench save check hif-live.gksave.jsonl                   # 第 5 章核对 + 重放每条答
    .venv/bin/python -m gkbench save share AS-C3Y5EFGV.gksave.json                 # 分享码 GKAS1:…
    .venv/bin/python -m gkbench save unshare 'GKAS1:…' --out problem.gksave.json

    .venv/bin/python -m pytest -q tests

账号：网页上「用 GitHub 登录」（推荐，第一次登录自动建账号，用户名取 GitHub 名，只读公开信息），或者用用户名 + 密码注册（没有邮箱，忘了密码找不回；GitHub 账号也能在「我的」页补设密码）。命令行用的令牌在「我的」页自己生成、吊销，存到 `~/.config/gkbench/token`（600）；服务器地址 `GKBENCH_SERVER`，默认 `https://hiro.matto.top/gkbench`。

### 接自己的算法

- **Python**：继承 `gkbench.algos.base.Algorithm`，实现 `decide(ctx) -> Decision(action, meta)`，在 `gkbench/algos/__init__.py` 注册。`ctx.obs` 是公开观测（UIObs v1），`ctx.worlds(k)` 要「可能的世界」。
- **别的语言**：从网站下载题集的审查存档（首页「审查存档」），自己的程序打完后，把每局的路线写进存档的算法表，用 `save check` 在本地核对，再 `upload-saves` 或在网页「我的」页上传。服务器按存档编号找题和种子，逐条重放、核对分数，生成完整记录。

## 服务器接口

| 接口 | 说明 |
|---|---|
| `GET /api/sets`、`/api/sets/{set}/problems` | 题集；题模板（存档原样）+ 名字、题族、标签、固定种子的公开信息 |
| `GET /api/sets/{set}/seeds` | 开发集种子（题集公开时不要令牌） |
| `GET /api/saves/{AS-编号}` | 一个存档（题模板或固定种子题），默认附上服务器上所有的答 |
| `GET /api/sets/{set}/saves?fixed=1&answers=1` | 整套题，JSON Lines |
| `POST /api/saves` | 上传存档里的答，后台逐条重放核对，`GET /api/jobs/{job}` 查进度 |
| `POST /api/runs` | 上传整次本地运行（run.json + episodes.jsonl.zst） |
| `POST /api/episodes`、`/api/episodes/{局}/step`、`/worlds`、`DELETE /api/episodes/{局}` | 固定种子托管对局 |
| `POST /api/evals`、`GET /api/evals/{编号}`、`POST /api/evals/{编号}/episodes` | 保密种子评测（`seeds` 可选，只跑每题前几个） |
| `GET /api/leaderboard?set=&kind=fixed\|template&base=&group=` | 排行榜 |
| `GET /api/runs`、`/api/runs/{run}`、`/api/runs/{run}/episodes/{id}/{seed}` | 运行、一局（测试集的逐步记录只给登录用户） |

## 服务器和网页

    # 本地开发
    cd server && go run .                 # 127.0.0.1:19150；引擎子进程默认 ../.venv/bin/python -m gkbench.worker
    cd web && pnpm install && pnpm dev    # http://127.0.0.1:5180/gkbench/，接口转给 Go

    # 管理
    gkbench-server add-token <名字> <令牌文件>      # 不走 GitHub、直接发命令行令牌（只写进文件）

    # GitHub 登录（server/auth.go）：在 GitHub 建 OAuth App，回调填 <对外地址>/api/auth/github/callback，
    # 服务器环境变量 GKBENCH_GITHUB_CLIENT_ID、GKBENCH_GITHUB_CLIENT_SECRET、GKBENCH_PUBLIC_URL。
    # 账号存 private/users.json（GitHub id -> 用户名），要把 GitHub 账号绑到已有用户名就预先写一条 {"<id>": {"user": "<名字>"}}
    # 密码账号（server/password.go）存 private/accounts.json（bcrypt）；有人忘了密码，删掉他那条的 hash，他用 GitHub 或令牌登录后重设
    # 防刷：同一 IP 每小时最多注册 5 个；同一 IP + 用户名 15 分钟内输错 8 次就要等（按 nginx 的 X-Real-IP）
    gkbench-server public-seeds <题集> on|off     # 开发集种子（和固定种子题存档）公开下载；测试集永不公开

    # 卡牌目录和小图（主数据或素材更新后重跑）
    cd server && go run ./cmd/catalog -master $GKMS_ROOT/GakumasCLI/ro/master/tables \
        -cards <素材>/skill_cards,<补的卡面目录> -drinks <素材>/drinks -out $GKBENCH_DATA/static
    # 新卡没图时：从游戏资源导出（digital-hiro-research/gkmas-assets/tools/export_card_icons.py <资源名>…），
    # 把导出目录加进 -cards；已有的小图不会重做。

线上 nginx 的 hiro 站点（443 那个 server 块）开了 gzip（JSON / JS / CSS），卡牌目录约 1 MB → 100 KB。

    # 旧数据（v1）转换
    .venv/bin/python -m gkbench.migrate [--dry-run]

线上部署（ycy）：`GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o gkbench-server ./server`，放 `/opt/gkbench/bin/`；`web/dist` 放 `/opt/gkbench/web/dist`；Python 部分放 `/opt/gkbench/app`（自带 `.venv`）；systemd `gkbench.service`（`Environment=` 里带空格的值要加引号），nginx 站点 `/etc/nginx/sites-available/hiro`（`hiro.matto.top`，certbot 证书）把 `/gkbench/` 转到 127.0.0.1:19150，根路径跳 `/gkbench/`。旧地址 `api.matto.top/gkbench/` 的网页 308 跳到新域名，`/gkbench/api/` 暂时继续转发，给还没换默认地址的老客户端用。

## 题集

| 题集 | 内容 |
|---|---|
| `hif-live` | 网页上叫「H.I.F真实记录测试集」。数字小广的实机开局（Campus 広），5 个题模板，每个 1 个实机种子 + 4 个随机抽的种子（开发集，公开）；另有每题 32 个保密种子 |
| `gkms480` | 网页上叫「H.I.F随机牌组测试」。GKMS `GakumasCLI.bench.problems build` 生成：6 机制 × 4 偶像 × 2 牌组 × 5 场次，240 个题模板，每个 2 个固定种子 + 32 个保密种子；只用主数据 |

## 规矩

- 实战和开源版本不用种子；种子只在这里做离线评测、算理论上限。
- 测试集的固定种子题不导出，对局的逐步记录不公开（会暴露抽牌顺序）。
- 上传的成绩一律记为 `self`：服务器核对过分数，但证明不了算法没偷看种子；可信度最高的是 `hosted`。
- 仓库里不放读存档、解密、还原种子的代码；题目从存档转出来的那一步在仓库外做。
- GKMS 代码不进本仓库，按路径引用（私有、无许可证，和作者共建）。
