# 数据格式

所有文件都是 UTF-8 JSON。带 `schema` 字段的文档按版本号区分，只加字段不改含义；要改含义就升版本号。

## 题目 `gkbench.problem.v1`

`$GKBENCH_DATA/problems/<题集>/<题号>.json`，公开。

| 字段 | 含义 |
|---|---|
| `id` | 题号，题集内唯一 |
| `set` | 题集名 |
| `loadout` | 开局配置，GKMS `gkms.hif_loadout.v1` 去掉 `seed`（字段见 GKMS `GakumasCLI/scenario/hif.py`） |
| `tags` | 偶像、考试、轮次、机制、牌组类型、阶段等，用于分组统计 |
| `source` | 从哪来的 |

## 种子 `gkbench.seeds.v1`

`$GKBENCH_DATA/private/seeds/<题集>.json`，私有（权限 600），只有裁判读。

每道题一组：`{index, seed, split, label}`。`split` 是 `dev`（开发集）或 `test`（测试集，只在服务器上用）；`label` 说明来源，例如「实机」「随机」「gkms」。记录里只写 `index` 和 `seed_sha`（种子的 sha256 前 12 位），不写种子本身。

## 运行 `gkbench.run.v1`

`$GKBENCH_DATA/runs/<运行编号>/run.json`：标签、算法描述（名字、参数、是否特权）、每步预算、题集、引擎来源（GKMS 提交、规则版本、主数据版本）、机器、起止时间、局数和平均分。

## 一局 `gkbench.episode.v1`

`episodes.jsonl.zst`，每局一行。

| 字段 | 含义 |
|---|---|
| `problem` `set` `tags` | 题目 |
| `seed_index` `seed_label` `seed_split` `seed_sha` | 用的哪个种子 |
| `meta` | 开考就公开的信息：考试、轮次、方针、总回合、审查基准、分数上限、对手分 |
| `steps` | 每个决策一条，见下 |
| `final` | `score` 终局分、`finished` 是否打完、`decisions` 决策数、`turns`、`begin_s` 开局准备耗时、`think_s` 思考总耗时、`wall_s` 整局耗时、`over_budget_steps` 超时步数 |
| `error` | 算法出错时的信息；出错的局按当时的分数结束 |

### 一步

| 字段 | 含义 |
|---|---|
| `i` `turn` | 第几个决策、第几回合 |
| `obs` | 公开观测（见下）；`--no-obs` 时为 null |
| `action` | 算法选的动作：`["play", 手牌序号]` `["drink", 饮料序号]` `["end"]` |
| `algo_meta` | 算法自己附的说明，内容由算法定（候选期望分、投票、网络概率……） |
| `think_ms` `cpu_ms` | 这一步的墙钟耗时、进程 CPU 耗时 |
| `worlds` | 这一步采了几个世界 |
| `over_budget` | 是否超过预算（> 预算 × 1.2 + 50 ms） |
| `result.after` | 这一步之后的数值：回合、分数、体力、上限、元気、好印象、やる気、集中、全力值、还能出几张、本回合已出、追加回合、指针 |
| `result.delta` | 和这一步之前比变了的数值 |
| `result.hand_before` `hand_after` | 前后手牌 |
| `result.events` | 引擎日志里这一步新增的事件 |
| `private` | 只给裁判看的：这一步之前的山札顺序 `deck_order`、随机数 `rng`、完整快照哈希 `state_hash` |

## 公开观测 = GKMS UIObs v1

和 GKMS UINet 的输入完全一样（`GKMSUINet/schema/uiobs.v1.schema.json`），另加一个 `i`。所以 UINet 不用转换就能接。

| 字段 | 内容 |
|---|---|
| `exam` | `produce`、`step`、`plan`、`idol`、`turn`、`limit`（含追加回合）、`types` 每回合属性、`permil` 三项倍率、`crit` 审查基准 |
| `num` | `score` `stamina` `max_stamina` `block`（元気）`playable` `plays` |
| `stance` | `[指针, 段数]` |
| `status` | 状态图标 `[种类, 数值, 剩余回合]` |
| `ench` | 持续效果 `[编号, 剩余次数, 剩余回合]`，`-1` 表示无限 |
| `hand` | 手牌，按画面顺序：`{id, u 强化次数, c 定制, g 考试中成长, p 能否打出}` |
| `deck` `grave` `hold` `lost` | 山札、弃牌、保留、除外：只有哪些牌，**没有顺序** |
| `played` | 本回合已打出的牌 |
| `drinks` | 持有的饮料 |
| `legal` | 合法动作 |

不在里面的：随机数、抽牌顺序、游戏自带的效果预览（它用了实时随机数），以及画面上不显示的累计计数。

## 世界

PIMC 这类算法通过 `ctx.worlds(k)` 拿到 k 个 GKMS 会话：公开部分和真局面一致，山札顺序、随机数状态、种子重新随机。同一题同一种子，不同算法在同一步拿到的世界一样，配对比较更准。
