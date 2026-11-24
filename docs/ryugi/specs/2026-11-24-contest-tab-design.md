# 竞技场 tab 设计

2026-11-24。仓库 gakumas-bench（初星攻略站），页面路径 `/contest`。

## 为什么做

用户要在攻略站做一个「竞技场」tab，功能参考 gakumas-tools（gktools.ris.moe，BSD-3）的竞技场工具。

模拟用 GKMS 作者提供的竞技场模拟运行包：竞技场自动出牌用的是游戏官方 AI 的还原版，所以模拟出来的出牌就是游戏里 AI 会打的那样，这是攻略站比 gakumas-tools（用自己写的出牌策略）强的地方。

这个包不公开源码，只在服务器上用。完整设计稿（含包的细节）在私有仓库 `gakumas-bench-private` 的 `docs/contest-tab-design-full.md`，这里是公开版。

## 目标

1. 顶栏加「竞技场」，`/contest` 下第一版有三页：模拟器、舞台一览、比较。
2. 模拟器：选赛季和舞台，填编成，跑 N 局官方 AI，看分数分布、每回合分数、各属性平均分、卡牌使用统计，以及最低、中位、最高三局的出牌记录。
3. 舞台一览：每个赛季每个舞台的计划类型、回合数、审查基准（Vo / Da / Vi 权重）和舞台自带的 P 道具。
4. 比较：本机保存过的编成和最近的模拟记录，同一舞台下并排看平均分、中位数，能载入回模拟器。
5. 编成能分享：生成链接，打开就是同一份编成和舞台。
6. 手机和电脑都能用。

## 不做（第一版）

参考 gakumas-tools 有、这次先不做的，按以后可能的顺序排：

- 大家的记录（公开展示别人的编成）：要登录和审核，等模拟器稳定后再说。
- 排练对比：上传排练截图识别分数、和模拟平均分对比。要做截图识别，单独立项。
- 从游戏截图导入编成。
- 回忆管理、回忆计算器、编成求解：包里有编成求解（optimize），但它要账号的回忆列表，访客交不出来；等回忆的导入方式定了再做。
- 手动出牌（自己一张张点着打）：出牌助手已经覆盖考试场景，竞技场先只做自动。
- 自定义舞台（自己改回合数、审查基准、场地效果）。
- 计算器类（制作评级、N.I.A、H.I.F、训练）、收集册、梯队表：不属于竞技场 tab。

## 绝不做

- 模拟器代码、AI 评价表、`contest.json` 不进公开的 gakumas-bench 仓库，也不经接口原样吐给浏览器。公开仓库里只有网页、Go 接口和调用约定。
- 不读、不收账号数据（回忆列表、抓包），第一版只用访客自己填的编成。
- 模拟任务不跑在 Go 服务进程或现有引擎子进程里：每个任务一个独立子进程。

## 约束

- 服务器 ycy：4 核、8 GB，同时跑着 Go 服务、3 个引擎子进程（出牌助手、托管评测共用）和 nginx 上别的站。竞技场模拟同一时间只跑一个任务，任务内 2 个进程，`nice 10`。
- 包要 Python 3.12 / 3.13、只用标准库；服务器 venv 是 3.13，可以直接用。原生库在服务器上 `sh GKMSContest/native/build.sh` 编（Ivy Bridge，脚本会自动选 x86-64-v2）。
- 局数 10–2000（包的上限）。2000 局在本机连加载约几秒。
- 新赛季每月出：要换新版的包。第一版靠作者发新包、我们手动替换。
- 网页沿用 `DESIGN.md` / `PRODUCT.md`：浅色、学マス橙只做强调，不照搬 gakumas-tools 的暗色橙顶栏。中日名照常走「日 / 中」开关和现有目录（`api/catalog`）。

## 结构

### 私有部分（不进公开仓库）

- 服务器：`/opt/gkbench/GKMSContest/`，放解压后的整个包（`GKMSContest/`、`GakumasCLI/`、`example/` 等，目录结构不变），在服务器上编 `GKMSContest/native/libgkmscontest.so`。包的版本记在 `/opt/gkbench/GKMSContest/PACKAGE`（如 `3ad8f9b rev431 S56`）。
- 本机开发：私有 GitHub 仓库 `gakumas-bench-private`（用户 11-24 定），克隆在 `~/github/gakumas-bench-private/`，包放在 `contest/` 下，目录结构不变；服务器上的包从这个仓库取。
- Go 只认环境变量 `GKBENCH_CONTEST_ROOT`（包根目录）、`GKBENCH_CONTEST_PYTHON`（解释器）。没设时竞技场接口回 503「竞技场模拟暂不可用」，页面显示同一句话，网站其他部分不受影响。

### 公开部分（gakumas-bench）

**Go 接口（`server/contest.go`）**

| 接口 | 做什么 |
|---|---|
| `GET /api/contest/seasons` | 赛季和舞台列表（见下面「赛季数据」），带 `package` 版本 |
| `POST /api/contest/sims` | 提交一个模拟任务，回 `{id, position}`（排在第几） |
| `GET /api/contest/sims/:id` | 任务状态：`queued` / `running`（带 progress：done、total、partial 统计）/ `done`（带 result）/ `failed`（一句话错误） |
| `DELETE /api/contest/sims/:id` | 取消排队中或运行中的任务 |

- 任务目录 `$GKBENCH_DATA/contest/jobs/<id>/`：`job.json`、`result.json`、`progress.jsonl`、`worker.log`。结果保留 7 天后清理。Go 重启时，残留的排队中、运行中任务一律标失败，错误写「服务重启了，请重新模拟」，不恢复排队（我的判断）。
- 子进程：`nice -n 10 $GKBENCH_CONTEST_PYTHON -B GKMSContest/contest/worker.py job.json result.json --workers 2 --progress progress.jsonl`，工作目录是包根。超时 120 秒杀掉记失败。
- 队列：全站同一时间 1 个任务在跑，排队最多 20 个，满了回 429。同一 IP 同时最多 1 个排队或运行中的任务、每分钟最多提交 6 个。
- 不用登录。
- 校验：Go 先按白名单收字段（见下），数值范围卡住（参数 0–6000、体力 1–200、支援加成 0–2000 万分比、局数 10–2000、卡最多 6+6 张、道具最多 4 个、id 只收 `[A-Za-z0-9_-]`），再交给子进程。

**赛季数据**

`contest.json` 不出服务器，Go 启动时（和包版本变化时）读一次，只把网页需要的字段做成接口：赛季 `id`、`description`（S56）、每个舞台的 `stageType`、`planType`、`turn`、`produceItemIds`、`vocal` / `dance` / `visual`。赛季的开放时间主数据里没有；网页按 id 数字倒序排，最新赛季在最上面，模拟器默认选最新赛季。56 个赛季全部列出，但旧赛季的结果用的是包里现在的卡牌效果（11-16 主数据），赛季下拉和舞台一览里旧赛季旁标一句「卡牌效果按现在的版本」（我的判断）。

**任务格式**：直接用包的 `kind: "sim"`（包 README「任务格式」一节）：`season_id`、`stage`（0 起）、`runs`、`seed_base`、`support_permyriad`、`loadout`（`idol_card_id`、`params`、`stamina`、可选 `bonus_permils`、`items`、`main_cards`、`sub_cards`，每张卡 `{id, upgrade_count, customizes}`）。网页提交的就是这个形状，Go 只加 `kind` 和缺省 `seed_base`。

**结果**：子进程的 `result.json` 原样转给网页（`stats`、`scores`、`turns`、`by_param`、`cards`、`logs`、`player`、`criteria`、`timing`）。这些是模拟结果，不含引擎代码或评价表，可以公开。

**网页（`web/src/pages/Contest*.tsx`、`web/src/components/contest/`）**

- 顶栏加「竞技场」，`/contest` 下用页内分段切换：模拟器（`/contest`）、舞台（`/contest/stages`）、比较（`/contest/compare`）。
- **模拟器**，布局参考 gakumas-tools 的单列卡片，从上到下：
  1. 舞台选择：赛季下拉 + 三个舞台按钮，按钮上写计划类型、回合数，下面一条 Vo / Da / Vi 审查基准比例条。
  2. 偶像卡（必填）：决定角色、培育计划和推荐效果。选择弹窗只列能上这个舞台的：舞台计划是 Common 的列全部，Plan1 / Plan2 / Plan3 分别只列感性 / 理性 / 非凡的偶像卡（我的判断：游戏里回忆只能上同计划或 Common 的舞台）。选偶像卡不自动加卡或道具：竞技场的卡和道具来自回忆，不是偶像卡的固有卡。换舞台后偶像卡计划对不上时，偶像卡标红、「模拟」按钮不可点，旁边一句说明。
  3. 数值：只填最终参数 Vo、Da、Vi、体力，和支援加成 %。下面一个可展开的小算器「从主副回忆算」：填主回忆、副回忆各自的 Vo / Da / Vi / 体力，按 `floor(主 + 副 ÷ 5)` 算好填进上面（例：主 2630、副 3163 → 3262）。编成码只存最终参数。不做 gakumas-tools 的体力计算器。
  4. P 道具（最多 4 个）、主回忆技能卡 6 格、副回忆技能卡 6 格：点格子开选择弹窗（复用出牌助手的 `Picker`），按偶像卡的计划筛（本计划 + 通用），带强化和定制。目录（`api/catalog`）已核对：包主数据里的 479 张技能卡、166 个舞台 P 道具都在。
  5. 局数滑块（默认 1000，10–2000）、「模拟」按钮；跑的时候显示排队位置和进度，边跑边出临时分布。
  6. 底部操作：清空、保存到本机、复制分享链接、复制编成码。
- **结果**（模拟器下方）：
  - 统计卡：平均、中位数、P10–P90、最低、最高、标准差、局数。
  - 分数分布直方图（按 `scores`）。
  - 每回合分数曲线：均值线 + P10–P90 区间带，横轴标每回合的属性色。
  - Vo / Da / Vi 各自的平均分。
  - 卡牌统计表：每局平均打出次数、打出过的局占比，可排序。
  - 三局出牌记录（最低 / 中位 / 最高）切换，逐回合列出打出的卡（含强化）、这一回合的属性、打完后的分数、体力和元气。记录里没有手牌和抽牌，所以不显示手牌。
- **舞台一览**：赛季倒序列表，每个赛季三行舞台，写计划、回合数、审查基准比例条、舞台 P 道具；点一行跳到模拟器并选好这个舞台。
- **比较**：本机（`localStorage`）保存的编成和最近 30 次模拟记录（只存编成、舞台和统计，不存每局分数），按舞台筛，同一舞台的并排比较平均和中位数，「载入」回模拟器。
- **分享**：编成码 `GC1`（JSON → deflate → base64url，和出牌助手的 GA1 同一种做法），链接 `/contest?c=<码>&season=&stage=`。

### 部署

- 服务器：包解压到 `/opt/gkbench/GKMSContest/`，`sh GKMSContest/native/build.sh`，systemd 加 `GKBENCH_CONTEST_ROOT`、`GKBENCH_CONTEST_PYTHON=/opt/gkbench/app/.venv/bin/python`。先在服务器上跑一次包里的 `example/job.json`，结果和本机一致再开页面。
- 网页走 `tools/deploy-web.sh`；首页「本站最近更新」加一条。
- 运维手册（`docs/operations.md`）写包的位置、怎么换新赛季的包、怎么回滚，但不写包的内部细节。

## 测试与验收

- Go：任务队列（排队、单任务、取消、超时、按 IP 限制、队列满 429）、字段白名单和数值范围、包缺失时 503。子进程用一个假的 worker 脚本代替，测试不依赖私有包。
- 本机联调：用真的包跑 `example/job.json` 的编成，接口结果和包直接运行的 `stats` 一致。
- 网页：tsc、构建；在浏览器里按手机（390×844）和电脑（1440×900）各走一遍：选舞台 → 填编成 → 模拟 → 看结果 → 保存 → 比较页载入 → 分享链接打开。
- 线上：部署后在浏览器里跑一次 2000 局，看排队、进度和结果。

## 待确认（用户）

1. 包的使用授权：在确认之前照常开发和本机联调，只是不部署上线（我的判断）。
2. ~~本机私有目录用普通目录还是私有仓库~~：用私有 GitHub 仓库（11-24 定）。

## 留给实现者决定的

- 直方图分几桶、曲线和表格的具体样式（按 `DESIGN.md`）。
- 选择弹窗里卡牌的筛选和排序细节。
- 编成码的字段顺序和压缩细节。

## 用到的资料

- gakumas-tools：源码 github.com/gakumas-tools/gakumas-tools（BSD-3），中文界面文案 `gakumas-tools/messages/zh-Hans.json`；线上页面截图在本机 `~/github/gakumas-bench/.temp/jjc-ref/`（simulator、stages、rehearsal）。只参考功能和布局，不搬代码。
- 竞技场模拟运行包：在私有仓库里，它自带的说明（任务格式、结果、接进网站）是这份设计的依据。
