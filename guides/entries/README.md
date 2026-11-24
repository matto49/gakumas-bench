# 人写攻略条目

格式、决策点、ID 规则见 [docs/guides.md](../../docs/guides.md)，机器版是 [schema/entry.schema.json](../schema/entry.schema.json)。

- 一个 YAML 文件是一个条目列表；文件放哪一层由路径决定：`common.yaml`、`<模式>/mode.yaml`、`<模式>/difficulty-<难度>.yaml`、`<模式>/plan-<プラン>.yaml`、`<模式>/style-<流派>.yaml`、`<模式>/idol/<偶像卡>.yaml`、`any/style-<流派>.yaml`、`any/idol/<偶像卡>.yaml`。
- `why` 用自己的话转述，每条都要有出处（`evidence`）；不抄攻略原文。
- `card_remove` 的写法和别的决策点相反：`avoid` 是先删的卡，`prefer` 是保护不删的卡。
- 提 PR 前跑 `python -m gkbench.guides check`（加 `--static $GKBENCH_DATA/static` 会顺带核对卡 ID）。
- 统计条目（`kind: stat`）是排行榜抓完后自动生成的，不放在这里，也不要手改。
