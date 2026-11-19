# 偶像卡攻略：条目格式、决策点、目录结构（定稿 v1，3940a9 / 协调 c8df260 审过）

2026-11-20，bench 会话（24e086c）起草。依据：digital-hiro `docs/ryugi/specs/2026-11-20-per-idol-strategy-design.md`（c2f954a）4.2–4.5、4.9，和消费方需求 `digital-hiro/.temp/plans-20261120/guides-consumer.md`（3940a9）。
这份是生产方（bench）和消费方（数字小广决策层）的契约：字段名、枚举值、层的判定、查找顺序以这里为准，改动要两边都同意。schema 版本号 `1`。

## 1. 一条攻略长什么样

人写条目用 YAML（能写注释、PR 好审），统计条目和发布包用 JSON，字段完全相同。**数字小广只读发布包（JSON）**，不需要 pyyaml；YAML 只在 bench 打包时读。

```yaml
id: hajime.style-review.card_pick.lovely-wink     # 全局唯一且稳定，规则见第 6 节；数字小广写进决策理由和 trace
kind: written                                     # written（人写）/ stat（统计，自动生成）
scope: {mode: hajime, style: review}              # 不写的字段 = 都适用；层由最具体的字段决定（第 1.3 节）
decision: card_pick
content:
  prefer:                                         # 有序：越靠前越优先
    - {id: p_card-02-men-2_060, role: loop, keep: 2, weight: 1.0}
    - {id: p_card-02-men-2_061, role: loop, note: 没有上一张时拿}
  avoid:
    - {id: p_card-01-act-3_010, role: conflict}
  why: 好印象的循环件，越早拿越好                 # 自己的话转述，不抄原文
  unless:
    when: {deck_count: {ids: [p_card-02-men-2_060, p_card-02-men-2_061], gte: 2}}
    text: 牌组已有 2 张以上循环件
  fallback: 都拿不到时优先保元気、晚点再补循环    # 首选和替代都没有时打法怎么调
evidence:
  - {kind: guide, ref: いおん10, url: "https://…"}
  - {kind: ranking, mode: hajime, n: 100, share: 0.78, fetched: 2026-11-19}
updated: 2026-11-20
by: bench
```

### 1.1 条目字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 全局唯一、稳定（改内容不改 id）。规则见第 6 节 |
| `kind` | `written` / `stat` | 统计条目每次抓完覆盖写；人写条目刷新不碰 |
| `scope` | object | 第 1.2 节 |
| `decision` | string | 第 2 节 |
| `content.prefer` | Item[] | 推荐，有序；同一决策点的替代顺序就是这个顺序 |
| `content.avoid` | Item[] | 不推荐 / 冲突。`card_remove` 里是「先删的」（第 2 节） |
| `content.targets` | object | 只有 `params_target` 用（第 2 节） |
| `content.why` | string | 人写必填；拼进提示词的「偶像」一节 |
| `content.unless` | Unless | 第 1.4 节 |
| `content.fallback` | string | 选填 |
| `evidence` | Evidence[] | 至少一条；统计条目只有 `ranking` |
| `updated` / `by` | 日期 / string | 人写必填 |

**依据级别不单独存**：消费方按 `evidence` 里最高的一级算，避免冗余字段不一致。级别从高到低：`guide` = `decision` > `ranking` > `live`。`decision`（用户 / 总控定的规则，广的手写知识多是这类）暂定和 `guide` 同级，等协调确认（依据级别是用户定的）。

**Item**：字符串（只写 ID）或对象。

| 字段 | 说明 | 用在 |
|---|---|---|
| `id` | 见下面「ID 规范」 | 全部 |
| `role` | 作用标签，一项一个（第 3 节） | 全部 |
| `weight` | 选填，0–100，越大越重要（和流派优先表同刻度：广的 tier 必拿 100、S 90、A 75、B 60） | `card_pick`、`formation.*` |
| `keep` | 同名最多留几张（广的 えいえいおー 是 2） | `card_pick` |
| `min_limit` / `min_level` | 支援卡最低凸数（0–4，4 = 满凸）/ 最低等级 | `formation.support` |
| `custom` | 定制键列表（和 `CUSTOMIZE_PRIORITY` 同一写法，例如 `aggressive_add`、`p_card-02-act-1_037-enc`） | `card_upgrade`、`formation.memory` |
| `levels` | 定制目标级数 | `card_upgrade` |
| `full` | 是否必须做满（不满不如不做） | `card_upgrade` |
| `upgrade` | 技能卡强化次数（0 / 1） | `card_upgrade`、`formation.memory` |
| `attr` | `vo` / `da` / `vi` | `action` 的 `sp_lesson` |
| `note` | 一句话 | 全部 |
| `stat` | 统计数字（只有统计条目有，第 4 节） | 统计条目 |

**ID 规范**：技能卡写不带强化的基础 ID（`p_card-…`），强化写在 `upgrade`；偶像卡写 `i_card-…`（不带 skin）；支援卡 `s_card-…`；P 道具 `pitem_…`；饮料 `pdrink_…`。还有几类不是卡的 ID：
- 行动：课程 `lesson_vo` / `lesson_da` / `lesson_vi`；SP 课 `sp_lesson`（配合 Item 的 `attr: vo|da|vi`）；追い込み `oikomi`；其它 `class`（授業）/ `outing`（外出）/ `consult`（相談）/ `rest`（休息）/ `allowance`（活動支給）/ `gift`（差し入れ）/ `business`（営業）/ `special_guidance`（特別指導）。和 `ProduceStepType` 的映射由数字小广做
- 属性：`vo` / `da` / `vi`
- 卡类：`class:basic`（基本卡）/ `class:trouble`（トラブル）/ `class:off_plan`（プラン不一致）/ `class:other_buff`（同プラン里主打另一种 buff 的卡，例如好印象偶像拿到的やる気卡；和 `off_plan` 不是一回事）

**Evidence**：

| `kind` | 必填 | 选填 |
|---|---|---|
| `guide` | `ref`（出处简称：いおん10、game8、hif-playbook…） | `url`、`date` |
| `ranking` | `mode`、`n`（样本数）、`fetched`（抓取日期） | `share`、`season`、`layer`、`low_sample` |
| `decision` | `ref`（用户 / 总控定的规则：「决策-07」「用户 2026-10-31」） | `date`、`url` |
| `live` | `ref`（实机 trace / 运行名） | `date`、`result` |

### 1.2 适用范围 `scope`

| 字段 | 取值 | 说明 |
|---|---|---|
| `mode` | `hajime` / `nia` / `hif` / `idolroad` | 初 / N.I.A / H.I.F / 偶像之路 |
| `difficulty` | 初：`regular` / `pro` / `master` / `legend`；N.I.A：`pro` / `master` | 和 `hiro.state.modes` 一致；H.I.F、偶像之路不用 |
| `plan` | `sense` / `logic` / `anomaly` | 主数据 `IdolCard.planType` PLAN1 / 2 / 3 |
| `style` | `review` / `aggressive` / `parameter_buff` / `lesson_buff` / `concentration` / `full_power` | **和 `IdolCard.examEffectType` 一对一**（EXAM_REVIEW 好印象、EXAM_CARD_PLAY_AGGRESSIVE やる気、EXAM_PARAMETER_BUFF 好調、EXAM_LESSON_BUFF 集中、EXAM_CONCENTRATION 強気、EXAM_FULL_POWER 全力），和初始牌组 `initial_deck-<style>` 同名。数字小广自己的流派键（review_smile / yaruki / sense_spotlight …）由数字小广映射 |
| `idol_card` | `i_card-…` | |
| `layer` | 1–27 | 只有 `idolroad` |
| `pool` | `{requires: [{id, min_limit?, min_level?}]}` | 卡池条件：都有才适用。回忆没有凸数，只写 `id`（回忆带入的技能卡 ID） |

### 1.3 层的判定

条目属于哪一层，只看 `scope` 里写了的最具体那个字段：

`idol_card`（偶像卡层）> `style`（流派层）> `plan`（プラン层）> `difficulty`（难度层）> `mode`（模式层）> 都没写（通用层）

`layer`、`pool` 只是过滤条件，不决定层。

### 1.4 `unless`：机器判断 + 文字

```yaml
unless:
  when: {any: [{deck_count: {ids: [...], gte: 2}}, {p_point_lt: 100}]}   # 选填，结构化谓词
  text: 牌组已有 2 张以上循环件，或 P 点不够                               # 选填，给人和 LLM 看
```

- 谓词：`deck_count: {ids, gte?, lte?}`（牌组里这些卡合计张数）、`deck_has_any: [ids]`、`deck_has_all: [ids]`、`deck_size_gte: n` / `deck_size_lte: n`（牌组总张数）、`has_pitem: [ids]`（持有其中任一 P 道具）、`p_point_lt: n`、`stamina_lt: n`、`week_gte: n`（培育第几周起）、`next_exam: mid1|mid2|final`（下一场考试），组合用 `all: [...]` / `any: [...]` / `not: {...}`。新谓词两边商量后加，schema 版本不变；消费方遇到不认识的谓词按「判不了」处理。
- **`when` 成立 → 跳过这条。只有 `text`、或 `when` 判不了 → 条目照用，`text` 带进理由作为提醒**（消费方提议的写法）。

## 2. 决策点清单

| `decision` | 做什么 | 内容怎么写 | 统计 |
|---|---|---|---|
| `formation.main_attr` | 开局主属性 | `prefer: [vo / da / vi]` | 能：最终三维最高那一项的占比 |
| `formation.support` | 支援卡 6 张（含租借） | `prefer` 支援卡，带 `min_limit` / `role` | 能：带入占比，分满凸 / 非满凸 |
| `formation.memory` | 回忆 | `prefer` 回忆带入的技能卡 ID，可带 `upgrade` / `custom` | 能：回忆带入技能卡的占比 |
| `formation.pitem` | 回忆带进考试的 P 道具 | `prefer` P 道具 | 能：回忆带入 P 道具的占比 |
| `action` | 每周行动 | `prefer` 行动 ID | 不能，页面标「暂无统计」 |
| `card_pick` | 抓卡三选一 | `prefer`（`role` / `keep` / `weight`）、`avoid` | 能：最终牌组里各卡占比、平均张数（不含固有卡、初始牌组、回忆带入） |
| `card_remove` | 删卡 | **语义和其它决策点相反**：`avoid` = 先删的（卡或卡类），`prefer` = 保护不删的（JSON Schema 的 description 里也写明） | 能：初始牌组每张卡的留存率，留得少的进 `avoid` |
| `card_upgrade` | 强化 / 定制 | `prefer: [{id, custom, levels, full}]` | 只有强化比例；排行榜没有定制信息，定制只靠人写 |
| `drink` | 买 / 换饮料 | `prefer` / `avoid` 饮料 | 不能 |
| `params_target` | 三维目标 | `targets: {vo, da, vi}`，或 `{ratio: [vo, da, vi]}` | 能：三维中位数和四分位 |
| `exam_style` | 考试打法倾向 | `why` + `prefer` 里放打法标签（自由文字） | 不能 |

最终 P 道具（含培育中拿到的）不对应决策点，放在发布包 `summary.<偶像卡>.final_pitems` 做参考。

## 3. 作用标签 `role`

**技能卡**：用数字小广 `hiro.state.knowledge.ROLES` 现成的词：`finisher` 终结、`delayed` 延迟兑现、`sustained` 持续兑现、`loop` 循环 / 抽牌、`compress` 压缩、`extend` 加回合、`cash` 不清零兑现、`motivation` やる気、`genki` 元気、`hp` 控血、`item` 道具触发、`idol` 偶像固有卡、`conflict` 冲突。别的流派要新词时（例如好印象的 `impression`），两边商量后加进这张表。

**支援卡**：`sp_rate` SP 发生率、`param_bonus` 属性加成 / 课程得点、`event_card` 支援事件给卡、`event_item` 给 P 道具、`p_point` P 点、`stamina` 体力回复、`card_trigger` 获得 / 强化 / 删卡时触发。

统计条目第一版不自动打标签（主数据推不准）；替代时消费方在同标签内用自己的库存和估值选。

## 4. 统计条目（自动生成）

- 来源：`gakumas-bench-data/private/ranking-decoded/<抓取>/rec_<偶像卡>.json`（每张偶像卡前 100 名的终局：支援卡含等级和凸数、最终牌组、P 道具、回忆、三维、分数）；偶像之路用 `private/tower-ranking-decoded/<赛季>/<塔>.json`。只发布统计量。
- 每张偶像卡、每个能统计的决策点一条：`id` = `stat.<mode>.<idol_card>.<decision>`（偶像之路加 `.L<层>`），`scope` = `{mode, idol_card}`（偶像之路加 `layer`）。
- `prefer` 按占比从高到低，最多 30 项，占比 < 5% 的不列。每项 `stat`：

| 字段 | 含义 | 用在 |
|---|---|---|
| `share` | 带这一项的记录比例 | 全部 |
| `share_full` / `share_nonfull` | 带这张支援卡且满凸 / 非满凸的记录比例，两者相加 = `share` | `formation.support` |
| `limit_mean` / `level_mean` | 带这张支援卡的平均凸数 / 等级 | `formation.support` |
| `copies` | 带的话平均几张 | `card_pick` |
| `upgraded` | 强化过的比例 | `card_pick`、`card_upgrade` |
| `kept` | 初始牌组里这张卡在终局的留存率（终局张数 / 初始张数，封顶 1） | `card_remove` |
| `p25` / `p50` / `p75` | 三维分位（放在 `content.targets`） | `params_target` |

- **凸数分段**：消费方按自己库存的凸数选段：满凸的卡看 `share_full`，非满凸的看 `share_nonfull`。页面上的「低凸替代顺序」= 按 `share_nonfull` 排，不做数值折算（4.9 第 3 条）。
- 样本：排行榜每张卡最多 100 份；`n < 30` 的 `evidence` 标 `low_sample: true`，页面显示「样本少」。分数段第一版不切。
- 偶像之路：每层只有前 5 名牌组和 10 条编成，按层出 `formation.*`、`card_pick`，`evidence.layer` 标层号。

## 5. 查找顺序（消费方实现，写在这里对齐）

给定（mode、difficulty、idol_card、decision、自己的卡池）：

1. 收集 `decision` 相同、`scope` 每个已写字段都和当前局面相符的条目（`plan` / `style` 由 `idol_card` 从主数据推出）。
2. 去掉 `pool.requires` 不满足的（卡池里没有，或凸数 / 等级不够），去掉 `unless.when` 成立的。
3. 排序：先按依据级别（guide = decision > ranking > live），同级按层（第 1.3 节，偶像卡层在前）。
4. 合并 `prefer` / `avoid`：按 Item 的 `id` 去重，保留排在最前那条的字段和理由。同一张卡在一条的 `prefer`、另一条的 `avoid` 里都出现时，排序在前的那条说了算（另一条里的那一项丢掉）。

## 6. 目录结构和 ID

公开仓库 gakumas-bench：

```
guides/
  schema/entry.schema.json            # JSON Schema（这份文档的机器版），PR 检查用
  entries/                            # 人写条目，每个文件是一个条目列表
    common.yaml                       # 通用层
    <mode>/mode.yaml                  # 模式层
    <mode>/difficulty-<difficulty>.yaml
    <mode>/plan-<plan>.yaml
    <mode>/style-<style>.yaml
    <mode>/idol/<idol_card>.yaml      # 偶像卡层
    any/style-<style>.yaml            # 不分模式的流派条目
gkbench/guides.py                     # 生成统计条目、校验人写条目、合并成发布包
```

- 人写条目 `id` = `<文件路径去掉 guides/entries/ 和扩展名，/ 换成 .>.<decision>.<短名>`，例如 `hajime.style-review.card_pick.lovely-wink`、`hajime.idol.i_card-shro-3-007.card_upgrade.eieiou`。
- 校验 `python -m gkbench.guides check`：字段和枚举合法；所有 ID 在 bench 主数据快照里查得到（新卡数字小广 game.db 可能没有，页面照常显示，数字小广跳过并写日志）；文件路径和 `scope` 一致（`hajime/style-review.yaml` 里的条目必须 `scope.mode=hajime`、`scope.style=review`，可以再加更细的字段）；`id` 不重复。

私有仓库 gakumas-bench-data（发布物，网站服务）：

```
static/guides/
  manifest.json                       # {format: "gkbench.guides.manifest.v1", schema: 1, version, generated_at, packs: {<mode>: {name, sha256, entries}}}
  <mode>-<YYYYMMDD>-<N>.json         # 发布包（不可变；文件名不能带点，版本 20261120.1 写成 20261120-1）
  <mode>.json                         # 最新版的副本，网页直接读
```

- `version` = `YYYYMMDD.N`（同一天第 N 次发布）。发布包：`{"format": "gkbench.guides.v1", "schema": 1, "mode", "version", "generated_at", "sources": {"entries_commit", "ranking": [{fetch, fetched, n_idols}]}, "entries": [...], "summary": {<偶像卡>: {n, score_p10, score_p50, score_max, final_pitems}}}`。
- 网站接口：`GET /gkbench/api/guides/<名字>`（和 `/api/usage/:mode` 同一套静态 JSON 服务，名字只能是小写字母、数字、短横线），例如 `/gkbench/api/guides/manifest`、`/gkbench/api/guides/hajime-20261120-1`。
- 数字小广下载：取 `https://hiro.matto.top/gkbench/api/guides/manifest`，版本比本地新就按 `packs.<mode>.name` 下对应模式的不可变包，核对 sha256 后缓存；`schema` 比自己认得的大时不用新包、写日志。拿不到就用本地缓存，再没有就退回现在的规则。

## 7. 网页

每张偶像卡一页 `/guide/<idol_card>?mode=<mode>`，从图鉴卡片和使用率页的偶像卡行进入。按决策点分区，每区列出各层条目，每条标依据级别和证据（统计显示样本数、抓取日期）；没数据的决策点显示「暂无统计」。三个模式都做，偶像之路按层切换。沿用 `DESIGN.md`。

## 审稿结论（11-20）

- 新 `role` 词由写条目的人提、3940a9 审（好印象可能要 `impression` / `impression_cash`）。
- 回忆带入的卡留在 `formation.memory`，不单独出 `card_pick` 统计；数字小广选卡时算作已有。
- 谓词按 3940a9 补的清单就够。
- 不出小包。

## 原来的待审问题（已结）

1. 技能卡 `role` 直接用 `knowledge.ROLES`，别的流派的新词（好印象、好調、集中…）谁来补：建议人写条目时由写的人提，3940a9 审。
2. `card_pick` 统计排除了固有卡、初始牌组和回忆带入的卡；回忆带入的要不要单独一条（现在归 `formation.memory`）。
3. 谓词清单（1.4）够不够初 / N.I.A 选卡、删卡用。
4. 发布包按模式拆，每包预计 2–4 MB；数字小广只下初 / N.I.A 两个包。要不要再出一个去掉 `summary` 的小包。
