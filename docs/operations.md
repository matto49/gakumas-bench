# 运维手册

本机开发、命令行、服务器接口、数据生成和线上部署。面向维护者；只想交算法看 [README](../README.md) 和 [evaluation.md](evaluation.md)。

## 组成

| 目录 | 技术 | 内容 |
|---|---|---|
| `server/` | Go + Gin | 服务器：接口、令牌、上传核对、托管对局、保密种子评测（`tseeds.go` 生成种子）、存档下载与上传、排行榜；`cmd/catalog` 生成卡牌目录。路由在 `routes.go`（Gin），接口函数仍是 `(w, r, 用户)` 写法；运行目录和排行结果按文件修改时间缓存（`runcache.go`），启动后后台预热各集合默认排行。每局摘要导入 SQLite（`episodedb.go`，`$DATA/cache/episodes.sqlite`，纯 Go 驱动 modernc.org/sqlite）：运行目录里的文件仍是正本，按修改时间和大小同步；排行只取要用的列，存档按题号查；删掉库会自动重建 |
| `web/` | Vite + React + TypeScript + Tailwind + TanStack Query | 网页：介绍、排行、运行详情、单局复盘、两算法对比、我的。取数据一律 `useApi(地址)`（`lib/hooks.ts`，底下是 TanStack Query：同一地址全站共用缓存，30 秒内不重取）；改了数据用 `invalidateApi(前缀)`（`lib/query.ts`）让相关缓存作废。除首页外各页面单独打包、打开时才下载（`main.tsx` 的 lazy 路由） |
| `gkbench/` | Python | 和 GKMS 引擎打交道的部分（GKMS、UINet 本身是 Python 库）：审查存档（`save.py`）、题库、裁判、世界采样、算法、本地跑分、客户端、引擎子进程 |
| `docs/format.md` | | 数据格式 |
| `PRODUCT.md` | | 产品定位（impeccable 用） |

题库、种子、运行结果、令牌都在仓库外的 `$GKBENCH_DATA`（默认 `~/github/gakumas-bench-data`，线上 `/srv/gkbench-data`）。

## 依赖

**只想交自己的算法（托管评测）**：Python 3.10+，装本包就行，不需要 GKMS：

    pip install "gkbench @ git+https://github.com/matto49/gakumas-bench"

见下面「接自己的算法」。下面这些是跑本地裁判、内置算法（贪心 / PIMC / UINet / 理论上限）和服务器要的：

- GKMSProject 克隆（`GKMS_ROOT`，默认 `~/github/_ext/GKMSProject`，要 `GakumasCLI`、`GKMSUINet`）和编好的原生核心：

      cd $GKMS_ROOT/GakumasCLI/native
      clang++ -O3 -ffp-contract=off -std=c++17 -Wno-unused-function -Wno-misleading-indentation -shared -fPIC -pthread \
          -o build/libgkmscore.dylib api.cpp          # Linux：sh build.sh，产物移到 build/libgkmscore.so

- UINet 公开仓库（`GKMS_UINET_REPO`，默认 `~/github/_ext/GKMSUINet`，MIT）。
- Python 3.12+：`uv venv .venv && uv pip install --python .venv/bin/python -e '.[gkms,test]'`
- Go 1.25+，Node 22+ 和 pnpm。

## 命令

    # 题库（题模板 + 私有种子）
    .venv/bin/python -m gkbench problems list
    .venv/bin/python -m gkbench problems import-loadouts <开局配置目录> --set hif --random-seeds 4
    .venv/bin/python -m gkbench problems import-gkms <GKMS bench problems.jsonl> --set gkms480
    .venv/bin/python -m gkbench problems import-saves <存档>... --set my-set

    # 本地跑固定种子题
    .venv/bin/python -m gkbench run --set hif --algo uinet
    .venv/bin/python -m gkbench run --set hif --algo pimc:worlds=16,mode=vote --budget 2 --label pimc-vote-16w-2s
    .venv/bin/python -m gkbench run --set hif --algo oracle:seconds=30 --label oracle-30s
    .venv/bin/python -m gkbench report $GKBENCH_DATA/runs/<运行>... --base greedy
    .venv/bin/python -m gkbench show $GKBENCH_DATA/runs/<运行> <题名或编号> --seed 0

    # 交成绩
    .venv/bin/python -m gkbench upload $GKBENCH_DATA/runs/<运行>                     # 整次运行（self）
    .venv/bin/python -m gkbench upload-saves my.gksave.jsonl --label my-algo        # 存档里的答（只要路线，self）
    .venv/bin/python -m gkbench hosted --set hif --algo uinet                   # 固定种子托管跑（hosted）
    .venv/bin/python -m gkbench eval --set hif --algo uinet --parallel 3             # 保密种子：缺省按核心题单（hif 120 题 × 8），没有核心题单时每题 32 个（hosted）
    .venv/bin/python -m gkbench eval --resume <评测编号> --algo uinet                  # 中断后接着跑

    # 审查存档
    .venv/bin/python -m gkbench save export --set hif --runs $GKBENCH_DATA/runs/* --out hif.gksave.jsonl
    .venv/bin/python -m gkbench save check hif.gksave.jsonl                   # 第 5 章核对 + 重放每条答
    .venv/bin/python -m gkbench save make 改好的.gksave.json --name 题名            # 自己出题：重算编号，生成可上传的题模板

    .venv/bin/python -m pytest -q tests

账号：网页上「用 GitHub 登录」（推荐，第一次登录自动建账号，用户名取 GitHub 名，只读公开信息），或者用用户名 + 密码注册（没有邮箱，忘了密码找不回；GitHub 账号也能在「我的」页补设密码）。命令行用的令牌在「我的」页自己生成、吊销，存到 `~/.config/gkbench/token`（600）；服务器地址 `GKBENCH_SERVER`，默认 `https://hiro.matto.top/gkbench`。

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

    # 强度榜（网页 /tiers）：「六维强度榜」数据包（gkms.strength.video.v1）导入成 $GKBENCH_DATA/static/tiers/<id>.json
    # 和目录 index.json，接口 api/tiers/<id>。只放汇总，逐份的牌组和支援卡不出数据包（gkbench/tierboard.py）
    .venv/bin/python -m gkbench.tierboard <数据包目录> --id hif-koinsho-202611 --title "H.I.F 模式 · 好印象 强度榜" \
        --author <作者> --video <原视频> --out $GKBENCH_DATA/static/tiers
    # 支援卡缩略图（support-<编号>.webp）：gkmas-assets/tools/export_support_icons.py，导出后拷到 $GKBENCH_DATA/static/sprites/

    # 支援卡目录（网页「游戏资源一览 · 支援卡」，接口 api/supports）：GKMS 的主数据没有支援卡技能和事件，
    # 改读完整主数据 gakumasu-diff（git clone https://github.com/vertesan/gakumasu-diff，YAML），中文取汉化数据；要 pyyaml
    .venv/bin/python -m gkbench.supports --master <gakumasu-diff> --translation <汉化数据>/data --out $GKBENCH_DATA/static/supports.json
    # 新支援卡的缩略图：gkmas-assets/tools/export_support_icons.py <gakumasu-diff>/SupportCard.yaml（清单旧了先 refresh_android_manifest.py）

    # 首页「现在」：生日和新卡由 gkbench.homedata 从 gakumasu-diff 的 git 历史算（要完整历史，先 git fetch --unshallow）；
    # 卡池、活动手写 $GKBENCH_DATA/static/site/now.json，站内更新手写 static/site/updates.json（接口 api/site/<名>）
    .venv/bin/python -m gkbench.homedata --out $GKBENCH_DATA/static/site/home.json
    # 新偶像的卡没有缩略图时：gkmas-assets/tools/export_bench_icons.py <只含新卡编号的 catalog.json>，转 96px webp 存 sprites/idol-<编号>.webp

    # 图鉴（网页 /gallery，数据 api/site/gallery）：立绘、偶像卡卡面（含「光景」换装卡面）、支援卡卡面、衣装、发型。
    # 先从游戏资源导图（约 1,900 个资源包、180 MB，已导出的跳过）：
    #   (gkmas-assets venv) python tools/export_gallery.py $GKBENCH_DATA/static/sprites/gallery
    # 再生成目录（只列导出了图的条目；支援卡名字取 supports.json）：
    .venv/bin/python -m gkbench.gallery --images $GKBENCH_DATA/static/sprites/gallery --supports $GKBENCH_DATA/static/supports.json --out $GKBENCH_DATA/static/site/gallery.json

    # 配置强度榜（网页 /usage，接口 api/usage/<模式>）：排行榜前 100 名记录里各卡出现的比例，只放比例和统计量
    .venv/bin/python -m gkbench.usage <数据包目录> --tierboard $GKBENCH_DATA/static/tiers/<id>.json --out $GKBENCH_DATA/static/usage/hif.json

    # 卡牌目录和小图（主数据或素材更新后重跑）。GKMS 上游的主数据先于引擎更新时，可以只取它的表、不动裁判用的克隆：
    #   git -C <GKMS> fetch && git -C <GKMS> archive origin/main GakumasCLI/ro/master/tables | tar -x -C $GKBENCH_DATA/master-snap/gkms-<提交>
    #   再把 -master 指到这份快照；新卡缺图时先 export_card_icons.py --out=<目录> <资源名>…，把目录加进 -cards
    cd server && go run ./cmd/catalog -master $GKMS_ROOT/GakumasCLI/ro/master/tables \
        -cards <素材>/skill_cards,<补的卡面目录> -drinks <素材>/drinks -out $GKBENCH_DATA/static
    # 新卡没图时：从游戏资源导出（digital-hiro-research/gkmas-assets/tools/export_card_icons.py <资源名>…），
    # 把导出目录加进 -cards；已有的小图不会重做。
    # 回忆能力的图标（memicon-*，游戏里的彩色方底 + 效果图案合成）：gkmas-assets/tools/export_memory_icons.py，
    # 导出到 export/memory_icons，第一次生成时把它加进 -cards。
    # 只更新文字（效果、定制方向）时可以不带 -cards / -drinks：-out 下已有的小图照用。
    # 中文目录：加 -zh <汉化数据目录>，另出 catalog.zh.json（网页右上角「日 / 中」切到中文时读它，接口 api/catalog?lang=zh）。
    # 汉化数据用学マス汉化插件那份：git clone https://github.com/imas-tools/gakumas-master-translation，-zh 指它的 data/
    # （插件 gakumas-local/local-files/masterTrans 是同一种格式）。做法照插件：按表的 primaryKeys 找到同一行，只换文字，
    # 汉化留空或对不上的保留日文；生成时会打印每张表命中多少行（cmd/catalog/zh.go）。上线时两份 json 一起放 $GKBENCH_DATA/static/。
    # 目录里每张卡带它自己的定制方向（custom：各方向各档的 P 点和效果）；主数据没有定制的说明文字，
    # 数值类的按效果类型拼（cmd/catalog 的 growValueText），加 / 换效果的用那条效果自己的说明。

线上 nginx 的 hiro 站点（443 那个 server 块）开了 gzip（JSON / JS / CSS），卡牌目录约 1 MB → 100 KB。

    # 旧数据（v1）转换
    .venv/bin/python -m gkbench.migrate [--dry-run]

## 线上部署

线上部署（ycy）：`GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o gkbench-server ./server`，放 `/opt/gkbench/bin/`；`web/dist` 用 `tools/deploy-web.sh [提交]` 部署到 `/opt/gkbench/web/dist`（干净 worktree 构建，保留旧版本的 hash 分片，免得部署前打开的页面切路由时 404）；Python 部分放 `/opt/gkbench/app`（自带 `.venv`）；systemd `gkbench.service`（`Environment=` 里带空格的值要加引号），nginx 站点 `/etc/nginx/sites-available/hiro`（`hiro.matto.top`，certbot 证书）把 `/gkbench/` 转到 127.0.0.1:19150，根路径跳 `/gkbench/`。旧地址 `api.matto.top/gkbench/` 的网页 308 跳到新域名，`/gkbench/api/` 暂时继续转发，给还没换默认地址的老客户端用。
