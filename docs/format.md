# 数据格式

题和答按**审查存档格式 `gkms.audition_save.v2`**（GKMS-STD-001 v2）组织；本仓库自己的文件（运行、逐局记录）在它之上补充逐步细节，字段名和存档保持一致。

所有文件都是 UTF-8 JSON。带 `schema` / `format` 的文档按版本号区分，只加字段不改含义；要改含义就升版本号。

## 1. 审查存档（题）

实现在 `gkbench/save.py`（Python）和 `server/saves.go`（Go）。要点：

| 概念 | 规定 |
|---|---|
| 存档 | 一个 JSON 对象，顶层恰好有 `format id loadout prefix objective check meta runs` 八个成员 |
| 编号 `id` | `AS-` + 8 位：`{"loadout": 展开后的编成, "prefix", "objective"}` 的规范化 JSON 的 SHA-256，按 30 进制字母表取 8 位（4.1） |
| 题模板 | 编成**不含** `seed`；`prefix` 为空串，`check` 为空对象；可以公开发放（1.8） |
| 固定种子题 | 编成含 `seed`；`check` 是起点核对：回合、分数、体力、手牌、规则版本、引擎提交号（1.5） |
| 题族编号 | `AF-` + 8 位：编成去掉 `seed`、只取 `{"loadout", "objective"}` 算出；同一开局的所有题相同，写在 `meta.family` |
| 紧凑写法 | 卡 `p_card-…+强化/定制*次数`、支援卡 `s_card-…:千分比`、三元组 `[Vo, Da, Vi]`；写不成的保留对象（第 2 章） |
| 动作记号 | `p<i>` 出第 i 张手牌、`d<i>` 喝第 i 瓶饮料、`e` 结束回合、`s<i>,<j>` 选牌；路线是记号用单个空格连起来（第 3 章） |
| 算法表 `runs` | 表头（`algo params budget seconds step_seconds rules machine mode by`）相同的答合成一张表，`cols` 按表 7 次序：`seed exam exam_sha score value err client secs step_ms at route`（1.7） |
| `mode` | `internal` 内置、`self` 自报（本地跑完提交）、`hosted` 托管（裁判握种子、逐步交动作）、`player` 玩家实战 |
| `exam` / `exam_sha` | 题模板的答记所用的考试种子；保密时只写 `exam_sha`（十进制种子串的 SHA-256 前 12 位），这样的答第三方无法重放 |
| `step_ms` / `step_seconds` | 每一步的思考毫秒数 / 每步预算；超过 `step_seconds × 1200 + 50` 毫秒的步算超时（1.7 f）） |
| 分享码 | `GKAS1:` + zlib(9) + base64url（4.2） |
| 时间 | `YYYYMMDDThhmmssZ`，UTC 整秒（4.3） |

## 2. 题库

| 文件 | 内容 |
|---|---|
| `$GKBENCH_DATA/problems/<题集>/<AS-编号>.gksave.json` | 题模板，公开。`meta.tags` 约定 `name:<人读的名字>`、`deck:<牌组类型>` |
| `$GKBENCH_DATA/private/seeds/<题集>.json` | `gkbench.seeds.v2`，私有（600）：`{"problems": {"<题模板编号>": [{"index", "seed", "split", "label", "fixed_id", "check"}]}}` |

`$GKBENCH_DATA/private/sets.json` 是集合信息：`{"<集合>": {title, blurb, owner, status, created, public_seeds}}`，`status` 是 `official` 或 `community`（没写当 `official`）。

`split` 是 `dev`（开发集，可公开）或 `test`（测试集，只托管跑）。`fixed_id` 是这个种子对应的固定种子题编号，`check` 是它的起点核对（都在入库时用引擎算好）。

系统里认题一律用**题模板编号**；一局在哪个种子上打，用 `seed_index`（题集里的固定种子下标，或保密种子的格子号）+ `exam_sha` 标明。

## 3. 运行 `gkbench.run.v2`

`$DATA/runs/<运行>/run.json`。前半是算法表的表头，和存档同名同义：

| 字段 | 含义 |
|---|---|
| `algo` | 算法名（附录 A）。本仓库的算法对 GKMS 来说都是外部算法：`external:<名字>` |
| `params` | 影响结果的参数 |
| `budget` / `seconds` / `step_seconds` | 预算：步数 / 整局墙钟秒 / 每步秒 |
| `rules` | 裁判的规则版本 |
| `machine` / `mode` / `by` | 运行的机器 / 来源方式 / 提交人。上传的运行一律记 `self`，`by` 以令牌为准；提交方自称的值存在 `claimed_mode` / `claimed_by` |

其余：`run` 运行编号、`label` 展示名、`set` 题集、`kind`（`fixed` 固定种子题 / `template` 题模板评测）、`template_seeds`（`fixed32.v1`：保密种子；没有这个字段的题模板运行是旧版）、`privileged`（看种子的理论上限，只作分母）、`engine`（GKMS 提交、规则版本）、`eval` / `seeds_per_problem`（保密种子评测）、`verified`、时间、局数、均分。

## 4. 一局 `gkbench.episode.v2`

`episodes.jsonl.zst`，每局一行（托管、保密种子评测是逐局追加的多帧文件，同一局重打以最后一次为准）。一局可以直接转成存档里的一条答（`runner.answer_of`）。

| 字段 | 含义 |
|---|---|
| `id` `family` `name` `set` `tags` | 题模板编号、题族编号、人读的名字、题集、分组标签 |
| `fixed_id` | 固定种子题编号（固定种子局才有） |
| `seed_index` `seed_label` `seed_split` `exam_sha` | 用的哪个种子（`seed_split`：`dev` / `test` / `template` 保密种子）；`exam` 只在种子由提交方自己给出（上传的题模板答）时出现；保密种子和测试集的 `exam_sha` 不下发 |
| `meta` | 开考就公开的信息：考试、轮次、方针、总回合、审查基准、分数上限、对手分 |
| `route` | 路线，动作记号串 |
| `steps` | 每个决策一条，见下 |
| `final` | `score` `finished` `decisions` `turns` `secs`（思考总秒数）`wall_s` `begin_s` `over_steps`（超时步数） |
| （摘要）`types` | 服务器给每局做的摘要里额外带每回合属性（1 Vo / 2 Da / 3 Vi），取自第一步的观测 |
| `err` | 算法出错或路线没走完时的说明 |
| `at` | 记录时间（`YYYYMMDDThhmmssZ`） |

一步：

| 字段 | 含义 |
|---|---|
| `i` `turn` | 第几个决策、第几回合 |
| `token` `action` | 动作记号和引擎元组 |
| `obs` | 公开观测（UIObs v1，见下）；`--no-obs` 时为 null |
| `algo_meta` | 算法自己附的说明（候选期望分、投票、网络概率……） |
| `step_ms` `cpu_ms` `client_ms` | 这一步的墙钟毫秒（托管时以服务器计时为准）、进程 CPU 毫秒、托管时客户端自报的毫秒 |
| `worlds` `worlds_ms` | 这一步要了几个「可能的世界」；托管时服务器生成它们花的毫秒数（这段时间不算进 `step_ms`） |
| `over` | 是否超时 |
| `result` | `after` 这一步之后的数值、`delta` 变化、`hand_before` / `hand_after`、`events` 引擎日志 |
| `private` | 只给裁判看的：这一步之前的山札顺序、随机数、快照哈希。接口不下发 |

## 5. 公开观测 = GKMS UIObs v1

和 GKMS UINet 的输入完全一样（`GKMSUINet/schema/uiobs.v1.schema.json`），另加一个 `i`。

| 字段 | 内容 |
|---|---|
| `exam` | `produce` `step` `plan` `idol` `turn` `limit`（含追加回合）`types` 每回合属性 `permil` 三项倍率 `crit` 审查基准 |
| `num` | `score` `stamina` `max_stamina` `block`（元気）`playable` `plays` |
| `stance` | `[指針, 段数]` |
| `status` | 状态图标 `[种类, 数值, 剩余回合]` |
| `ench` | 持续效果 `[编号, 剩余次数, 剩余回合]`，`-1` 表示无限 |
| `hand` | 手牌，按画面顺序：`{id, u 强化次数, c 定制, g 考试中成长, p 能否打出}` |
| `deck` `grave` `hold` `lost` | 山札、弃牌、保留、除外：只有哪些牌，**没有顺序** |
| `played` | 本回合已打出的牌 |
| `drinks` | 持有的饮料 |
| `legal` | 合法动作 |

不在里面的：随机数、抽牌顺序、游戏自带的效果预览（它用了实时随机数），以及画面上不显示的累计计数。

## 6. 世界

多世界类算法（PIMC 等）通过 `ctx.worlds(k)` 拿到 k 个 GKMS 会话：公开部分和真局面一致，山札顺序、随机数状态、种子重新随机。

- 本地跑：同一题同一种子，不同算法在同一步拿到的世界一样，配对比较更准。
- 托管跑：`POST /api/episodes/<局>/worlds {k}` 返回 k 个 `worlds.export_world` 的输出（zlib 压缩的 GKMS native_dump，约 3 KB），客户端用 `worlds.import_world` 导入。会话里记着种子的三处（`config.seed`、`_seed` / `_loadout`、核心状态头 `round_seed`）都换成了假种子，`tests/test_worlds.py` 检查导出数据里找不到真种子。

## 7. 保密种子评测

每个题模板固定一组 32 个保密种子（生成方法见 README「两种评测」），存在 `$DATA/private/seeds/<题集>.template.json`（`gkbench.template_seeds.v1`，私有）：`{"problems": {"<题模板编号>": {"family", "seeds": [...]}}}`。

`POST /api/evals` 开一次评测：服务器把每个题模板的那组种子（或前 `seeds` 个）抄进 `$DATA/private/evals/<编号>.json`，返回格子 `{id, slot}`，格子号就是种子在这组里的下标。每个格子用 `POST /api/evals/<编号>/episodes` 开局，之后和托管对局一样走 `/api/episodes/<局>/step`。成绩写进运行 `template-<题集>-<标签>-<用户>-<编号>`：`kind` 为 `template`，`template_seeds` 为 `fixed32.v1`；每局的 `seed_index` 是格子号，`seed_split` 是 `template`，`seed_label` 是「保密」。

因为所有算法打同一组种子，排行按 (题模板, 格子号) 配对，和固定种子题一样算几何平均比值；平均分先按题平均再对题平均。理论上限由管理员用 `gkbench run --template` 在同一组种子上跑。

保密种子局的 `exam_sha` 不出现在任何接口里，逐步记录要登录才能看，存档下载也不带这些答。没有 `template_seeds` 的题模板运行是 11 月 9 日以前每次临时抽种子的旧评测，排行里用 `kind=legacy` 单独看。

## 8. 旧数据

v1（`gkbench.problem.v1` / `seeds.v1` / `run.v1` / `episode.v1`）用 `python -m gkbench.migrate` 转换，原文件先复制到 `$GKBENCH_DATA/backup-v1/`。
