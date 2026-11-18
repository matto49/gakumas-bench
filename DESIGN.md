# Design

网页的视觉规范。变量在 `web/src/index.css`。组件库是 **shadcn/ui**（底层 Base UI），源码在 `web/src/components/ui/`，按学マス风格改过，可以直接改；项目自己的组件在 `web/src/components/ui.tsx`、`Select.tsx`、`GameBits.tsx`。方向见 PRODUCT.md：学マス游戏风、数据严谨、文案平实。

## 颜色

shadcn 的语义变量（`background` `foreground` `primary` `muted` `accent` `border` `ring`……）都映射到下表的学マス配色上，`shadcn add` 进来的新组件直接就是这套颜色。注意名字不一样的地方：shadcn 的 `accent` 是悬停浅底、`muted` 是浅灰底；我们的品牌橙叫 `brand*`，第三档灰字叫 `ink-3`。只做浅色：`dark:` 只在祖先带 `.dark` 时生效，我们不加。

| 角色 | 变量 | 用在哪 |
|---|---|---|
| 底 | `surface` / `surface-2` / `surface-3` | 纯白；`surface-2`、`surface-3` 是中性浅灰，用在表头、页脚、次级面板。字和线（`ink*`、`line*`）也是中性灰 |
| 字 | `ink` / `ink-2` / `ink-3` | 正文、次要文字、说明（`ink-3` 对底 4.5:1，= shadcn `muted-foreground`） |
| 学マス橙（浅） | `brand` | 只做装饰：标题牌的斜标记、进度条、下划线、选中描边。白字放上面不够对比度 |
| 学マス橙（深） | `brand-deep` / `brand-deeper`（= shadcn `primary`） | 主按钮和小标签（「这张」「走岔」）。白字 4.6:1。不铺大块底色：顶栏、复盘页头都是白底；首页头图是官方卡面，不是橙色块 |
| 橙色文字 | `brand-ink` | 链接、可点的文字 |
| 浅橙底 | `brand-soft` / `brand-tint`（tint = shadcn `accent`） | 选中的行、行悬停 |
| 回合属性 | `vo` / `da` / `vi`，`*-strong` | 图表用浅的；带字的色块用 `-strong`（Vo、Da 白字，Vi 深字） |
| 名次 | `gold` / `silver` / `bronze` | 只给 1–3 名的数字 |

颜色从不单独表意：回合属性色块里写 Vo / Da / Vi，评级徽章有字母，图表里两条线一实一虚。

## 字

- 正文、标签、按钮：系统字体（苹方 / Hiragino / Noto CJK）。
- 分数、名次、百分比大数字：`.disp`，Barlow Condensed 粗斜体，只放拉丁数字。
- 标题：`PageHeader` 24px 粗体，`SectionTitle` 16px 粗体，左边一道斜的橙色标记。

## 组件

| 组件 | 说明 |
|---|---|
| `TurnStrip` | 一排回合属性色块，`current` 高亮当前回合 |
| `Grade` | 游戏的培育评级徽章，按相对上限划线（`lib/game.ts` 的 `GRADES`，悬停写明划线） |
| `IdolThumb` | 偶像卡方形缩略图（`sprites/idol-<编号>.webp`），只用小尺寸，不放立绘 |
| `RankNum` | 名次数字 |
| `ModeBadge` | 自报 / 托管 / 上限 |
| `Button`（shadcn） | 圆角胶囊；`default` 深橙底白字，底下一道深色阴影像游戏按钮；`outline` 白底细边，悬停变橙；`size="sm"` 小号。链接要长成按钮用 `btn.primary` / `btn.secondary` / `btn.small`（同一套样式的类名） |
| `Select` | 全站下拉框（`components/Select.tsx`），包了 shadcn 的 Select：传 `options` 数组，选项可带小图（偶像头像）和右侧灰字说明；靠右的用 `align="end"`。不要再用原生 `<select>` |
| `Tip` / `Help` | 悬停说明，底层 shadcn Tooltip，弹层挂在 body 上，不会被表格滚动区裁掉 |
| `Checkbox` | 勾选框（排行页原来的「固定种子」开关已去掉，暂时没用到） |
| `ToggleGroup variant="segment"` | 分段切换（暂时没用到） |
| `Badge` | `ModeBadge` 用它：`outline` 自报、`brand` 托管、`quiet` 上限 |
| `Input` | 文本输入框；文件选择框仍用原生 |
| `toast`（sonner） | 操作结果提示（上传收下 / 失败），右下角 |
| 首页头图 | `components/HomeHero.tsx`：最新 SSR 偶像卡的特训后横版卡面（`lib/site.ts` 的 `heroCard`，没有就用 `HERO_FALLBACK`）。宽屏上卡面占右边 76%，左边渐隐到 `#17141C` 暗底放站名和两个按钮；手机上卡面占上面六成，字在下面。右下角胶囊写「日期 新卡【卡名】偶像名」，点开原地看详情。「现在」做成白色浮层压在头图下沿（`NowSection flat`：各栏不带框，栏间一道分隔线） |
| 首页底色 | `components/HomeBackdrop.tsx`：头图以下铺满视口宽的暖白底 `#F7F4F0`，一层 18px 细网点，Vo / Da / Vi 三团很淡的光斑（左上、右中、左下，透明度 .12–.16）。只在首页用，内容卡片仍是白底 |
| 进站动画 | `components/BootSplash.tsx` + `index.css` 的 `.boot*`：白底，Vo / Da / Vi 三道斜杠依次落下，站名滑出，最少停 1.2 秒，然后斜着擦走。首页等头图加载完（`gkb-ready` 事件）再擦，最多 2.6 秒。同一个标签页会话只播一次（`sessionStorage`），系统开了「减少动态效果」不播 |
| 首页（初星攻略站） | 头图下面照一般攻略站的骨架：「现在」（进行中的卡池活动，手写、空了就不出现；新卡；生日）→ 本站最近更新 → 强度榜（只放 S、A 档，下面一行写还有几张）→ 按模式（每个模式现在有什么，没有的写「还没有」）→ 游戏资料 → 工具 → 关于本站一小段。组件在 `components/HomeGuide.tsx`。原来首页上的算法排行说明、现在的排行、题集、交成绩搬到 `/about`（`pages/About.tsx`） |
| 首页「数量级标尺」 | `Home.tsx` 的 `ScaleFigure`：对数横轴（10 的 0 到 24 次方）上的范围条和点，说明一局的打法有多少、30 秒搜得了多少。条用 `brand`，「搜得了的」用 `ink` 的圆点；每个标记旁边直接写数值，悬停有说明 |
| 首页节标题、重点数字 | `Home.tsx` 的 `HomeTitle`（21px，比内页的 `SectionTitle` 大一号，可带一行说明和右侧链接）；正文里的重点数字用 `N`：加粗，下半截垫一道 `brand` 40% 的荧光笔。只在首页的说明段落用 |
| 首页「现在的排行」和题集列表 | `Home.tsx` 的 `NowBoard`：真实记录测试集的榜，相对上限旁边带一根 `brand` 的条，最后一行是理论上限。`SetRow`：题集一行一个，写题数、每题几种牌序、现在的第一名，整行点进排行。两者都用 `useBoard(set)` 取榜 |
| 排行的算法家族行 | `Leaderboard.tsx`：同家族的各版本合成一行，名次和成绩取当前排序下最好的版本；展开键是名字左边空白里的灰色箭头（18px，相对整行垂直居中，不加边框，名字和其他行对齐），「N 个版本 · 成绩取 …」写在副标题；铅笔改名键只在悬停时出现。子项不排名次，左边一道 `line-strong` 竖线挂在家族下，只写版本部分（`uinet-2.0beta-x` 写 `2.0beta-x`，和家族同名的写「初版」），字号、评级徽章、平均分都小一号 |
| 强度榜 | `pages/Tiers.tsx`（总榜）、`pages/TierCard.tsx`（单卡页），版式照原视频：S、A 档大卡带六维条，B 档以下小格；名次是黑底圆，右上角空心圆点表示换一批编成可能跨档。档位色块 `TIER_STYLE`（lib/tiers.ts），字母写在色块里，不单靠颜色。单卡页的分布图：最优饮料用 `da`，自带饮料用 `line-strong` |
| `Empty` | 空状态：`surface-2` 浅灰底、虚线框 + 一句话说该做什么 |
| 顶栏 | `Layout.tsx`：白底、底边一条 `line`；首页没滚过头图时透明叠在卡面上，字和胶囊变白（`useOnArt`）；logo 前是 Vo 粉、Da 蓝、Vi 黄三道小斜杠；当前页是 `surface-2` 的浅灰胶囊。斜纹底（`.stripes`）已经去掉，不要再加 |

## 素材

首页头图的卡面：`digital-hiro-research/gkmas-assets/tools/export_card_art.py <输出目录> --home home.json` 导出新卡里全部 SSR 偶像卡的特训后横版大图（`thumb-landscape-large`），每张两份 `art-<编号>.webp`（1600 宽）和 `art-<编号>-m.webp`（800 宽，手机），放进 `$GKBENCH_DATA/static/sprites/`。有新卡时跟着 homedata 一起导。

偶像缩略图和评级徽章从游戏缓存导出（`digital-hiro-research/gkmas-assets/tools/export_bench_icons.py`），转成 96px webp 放在 `$GKBENCH_DATA/static/sprites/`。卡牌、饮料小图由 `server/cmd/catalog` 生成。

## 文案

网页上不说「种子」，说「牌序」：一道题的一局，洗牌和随机结果定下来就是一种牌序。排行是每题随机 32 种牌序，所有算法打同一组。

平实、短。不写三连排比标语、编号卡片、两栏对仗；能用数字或例子就不解释；说明放在需要它的地方（表头的 ? 提示），不堆在页首。
