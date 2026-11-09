# gakumas-bench

学園アイドルマスター考试出牌算法的 benchmark：同样的题、同样的种子、同样的时间预算，比各个算法打出的分数和耗时。

线上：<https://api.matto.top/gkbench/>（排行、运行、复盘、对比公开只读；上传和托管要令牌）

核心规则：**裁判握着种子和完整局面，算法只拿画面上看得到的信息。** 每一步算法交回一个动作，裁判推进引擎，记下结果。看种子的搜索只作「理论上限」当分母，不参与排名。

## 组成

| 目录 | 技术 | 内容 |
|---|---|---|
| `server/` | Go | 服务器：接口、令牌、上传后台核对、托管对局、排行榜（含分组）、托管网页和小图；`cmd/catalog` 生成卡牌目录 |
| `web/` | Vite + React + TypeScript + Tailwind | 网页：介绍、排行、运行详情、单局复盘、两算法对比、我的（上传管理） |
| `gkbench/` | Python | GKMS 引擎相关的部分（GKMS 和 UINet 本身是 Python 库）：引擎子进程 `worker.py`、裁判、世界采样、算法、本地跑分、上传和托管客户端 |
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

## 跑算法、交成绩

    .venv/bin/python -m gkbench problems list
    .venv/bin/python -m gkbench run --set hif-live --algo uinet
    .venv/bin/python -m gkbench run --set hif-live --algo pimc:worlds=16,mode=vote --budget 2 --label pimc-vote-16w-2s
    .venv/bin/python -m gkbench run --set hif-live --algo oracle:seconds=30 --label oracle-30s
    .venv/bin/python -m gkbench report $GKBENCH_DATA/runs/<运行>... --base greedy

    .venv/bin/python -m gkbench upload $GKBENCH_DATA/runs/<运行>     # 服务器按种子逐局重放核对
    .venv/bin/python -m gkbench hosted --set hif-live --algo uinet    # 托管：种子不离开服务器

令牌放 `~/.config/gkbench/token`（600）；服务器地址 `GKBENCH_SERVER`，默认 `https://api.matto.top/gkbench`。

接自己的算法：继承 `gkbench.algos.base.Algorithm`，实现 `decide(ctx) -> Decision(action, meta)`，在 `gkbench/algos/__init__.py` 注册。

## 服务器和网页

    # 本地开发
    cd server && go run .                 # 127.0.0.1:19150；引擎子进程默认 ../.venv/bin/python -m gkbench.worker
    cd web && pnpm install && pnpm dev    # http://127.0.0.1:5180/gkbench/，接口转给 Go

    # 管理
    gkbench-server add-token <名字> <令牌文件>      # 令牌只写进文件
    gkbench-server public-seeds <题集> on|off     # 开发集种子公开下载（测试集永不公开）

    # 卡牌目录和小图（主数据或素材更新后重跑）
    cd server && go run ./cmd/catalog -master $GKMS_ROOT/GakumasCLI/ro/master/tables \
        -cards <素材>/skill_cards -drinks <素材>/drinks -out $GKBENCH_DATA/static

线上部署（ycy）：`GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o gkbench-server ./server`，放 `/opt/gkbench/bin/`；`web/dist` 放 `/opt/gkbench/web/dist`；Python 部分放 `/opt/gkbench/app`（自带 `.venv`）；systemd `gkbench.service`，nginx `api.matto.top` 的 `/gkbench/` 转到 127.0.0.1:19150。

## 题集

| 题集 | 内容 |
|---|---|
| `hif-live` | 数字小广的实机开局（Campus 広），每题 1 个实机种子 + 4 个随机种子；开发集种子公开 |
| `gkms480` | GKMS `GakumasCLI.bench.problems build` 生成：6 机制 × 4 偶像 × 2 牌组 × 5 阶段，每题 2 个种子；只用主数据 |

## 规矩

- 实战和开源版本不用种子；种子只在这里做离线评测、算理论上限。
- 测试集对局的逐步记录不公开（会暴露抽牌顺序）。
- 仓库里不放读存档、解密、还原种子的代码；题目从存档转出来的那一步在仓库外做。
- GKMS 代码不进本仓库，按路径引用（私有、无许可证，和作者共建）。
