/** 偶像卡攻略包（gkbench.guides.v1）：python -m gkbench.guides build 生成，GET api/guides/<模式>。格式见 docs/guides.md */

export type GuideStat = {
  share?: number
  share_full?: number
  share_nonfull?: number
  limit_mean?: number | null
  level_mean?: number | null
  copies?: number
  upgraded?: number
  kept?: number
}
export type GuideItemObj = {
  id: string
  role?: string
  weight?: number
  keep?: number
  min_limit?: number
  min_level?: number
  custom?: string[]
  levels?: number
  full?: boolean
  upgrade?: number
  attr?: 'vo' | 'da' | 'vi'
  note?: string
  stat?: GuideStat
}
export type GuideItem = string | GuideItemObj
export type Quartiles = { p25: number; p50: number; p75: number }
export type GuideScope = { mode?: string; difficulty?: string; plan?: string; style?: string; idol_card?: string; layer?: number; pool?: { requires?: GuideItem[] } }
export type GuideEvidence = { kind: 'guide' | 'decision' | 'ranking' | 'live'; ref?: string; url?: string; date?: string; n?: number; fetched?: string; share?: number; low_sample?: boolean }
export type GuideEntry = {
  id: string
  kind: 'written' | 'stat'
  scope: GuideScope
  decision: string
  content: {
    prefer?: GuideItem[]
    avoid?: GuideItem[]
    targets?: Record<string, Quartiles | number> & { ratio?: number[] }
    why?: string
    fallback?: string
    unless?: { when?: unknown; text?: string }
  }
  evidence: GuideEvidence[]
  updated?: string
  by?: string
}
export type IdolSummary = { n: number; score_p10: number; score_p50: number; score_max: number; final_pitems: { id: string; share: number }[] }
/** 上榜不到 N 人时 rN 是 null */
export type TowerIdol = { idol_card_id: string; n: number; top: number; r5: number | null; r10: number | null; r50: number | null; r100: number | null }
export type TowerLayer = { layer: number; idols: TowerIdol[]; conversions: { before: string; after: string; count: number }[]; memories: { id: string; share: number }[]; n_histories: number }
export type TowerSeason = { season: string; towers: Record<string, { character: string; total?: Record<string, number>; layers: TowerLayer[]; decks?: string }> }
/** 偶像之路一层的一条完整编成（ListLayerPlayerHistories）：deck 是按回忆拼出的开局卡组（卡组写法），memories 主回忆在前 */
export type TowerExample = {
  score: number
  clear_rank?: number
  producer_level?: number
  idol: string
  memories: { idol: string; grade: string; vo: number; da: number; vi: number; stamina: number }[]
  params: [number, number, number]
  stamina: number
  deck: string[]
  items: string[]
  conversions: [string, string][]
}
export type TowerDecks = { season: string; tower: string; layers: Record<string, TowerExample[]> }
export type GuidePack = {
  format: string
  schema: number
  mode: string
  version: string
  generated_at: string
  sources: { entries_commit?: string | null; ranking?: { fetch: string; fetched: string; n_idols?: number; n_towers?: number }[] }
  entries: GuideEntry[]
  summary: Record<string, IdolSummary> & { seasons?: Record<string, TowerSeason> }
}

export const GUIDE_MODES = [
  { key: 'hajime', label: '初' },
  { key: 'nia', label: 'N.I.A' },
  { key: 'hif', label: 'H.I.F' },
  { key: 'idolroad', label: '偶像之路' },
] as const
export type GuideMode = (typeof GUIDE_MODES)[number]['key']

/** 目录里偶像卡的 style / plan（主数据枚举）→ 条目里的写法 */
export const STYLE_KEY: Record<string, string> = {
  EXAM_REVIEW: 'review', EXAM_CARD_PLAY_AGGRESSIVE: 'aggressive', EXAM_PARAMETER_BUFF: 'parameter_buff',
  EXAM_LESSON_BUFF: 'lesson_buff', EXAM_CONCENTRATION: 'concentration', EXAM_FULL_POWER: 'full_power',
}
export const PLAN_KEY: Record<string, string> = { PLAN1: 'sense', PLAN2: 'logic', PLAN3: 'anomaly' }

export const item = (i: GuideItem): GuideItemObj => (typeof i === 'string' ? { id: i } : i)

/** 条目的层：scope 里最具体的那个字段（docs/guides.md 1.3） */
export const LAYERS = ['idol', 'style', 'plan', 'difficulty', 'mode', 'common'] as const
export type Layer = (typeof LAYERS)[number]
export const LAYER_LABEL: Record<Layer, string> = { idol: '这张偶像卡', style: '流派', plan: 'プラン', difficulty: '难度', mode: '模式', common: '通用' }
export function layerOf(s: GuideScope): Layer {
  if (s.idol_card) return 'idol'
  if (s.style) return 'style'
  if (s.plan) return 'plan'
  if (s.difficulty) return 'difficulty'
  if (s.mode) return 'mode'
  return 'common'
}

/** 依据级别：evidence 里最高的一级；用户 / 总控定的规则（decision）和社区攻略同级 */
export type Level = 'guide' | 'ranking' | 'live'
const RANK: Record<GuideEvidence['kind'], number> = { guide: 3, decision: 3, ranking: 2, live: 1 }
export function levelOf(e: GuideEntry): Level | null {
  let best: GuideEvidence['kind'] | null = null
  for (const ev of e.evidence ?? []) if (RANK[ev.kind] && (!best || RANK[ev.kind] > RANK[best])) best = ev.kind
  return best === 'decision' ? 'guide' : best
}
export const LEVEL_LABEL: Record<Level, string> = { guide: '攻略', ranking: '排行榜统计', live: '实机记录' }

/** 这条条目对这张偶像卡适不适用（difficulty / pool / unless 留给页面标出来，不在这里过滤） */
export function applies(e: GuideEntry, ctx: { mode: string; idol: string; style?: string; plan?: string }) {
  const s = e.scope ?? {}
  if (s.mode && s.mode !== ctx.mode) return false
  if (s.idol_card && s.idol_card !== ctx.idol) return false
  if (s.style && s.style !== ctx.style) return false
  if (s.plan && s.plan !== ctx.plan) return false
  return true
}

/** 排序：先依据级别，同级按层（偶像卡层在前）——和数字小广的查找顺序一致 */
export function sortEntries(es: GuideEntry[]) {
  return [...es].sort((a, b) => (RANK[evKind(b)] ?? 0) - (RANK[evKind(a)] ?? 0) || LAYERS.indexOf(layerOf(a.scope)) - LAYERS.indexOf(layerOf(b.scope)))
}
const evKind = (e: GuideEntry): GuideEvidence['kind'] => (levelOf(e) ?? 'live') as GuideEvidence['kind']

/** 决策点：页面上的分组和名字；stat = 排行榜能不能出统计 */
export const DECISIONS: { key: string; group: '开局编成' | '培育' | '考试'; label: string; stat: boolean; hint?: string }[] = [
  { key: 'formation.main_attr', group: '开局编成', label: '主属性', stat: true, hint: '终局三维里最高的那一项' },
  { key: 'formation.support', group: '开局编成', label: '支援卡', stat: true },
  { key: 'formation.memory', group: '开局编成', label: '回忆带入的技能卡', stat: true },
  { key: 'formation.pitem', group: '开局编成', label: '回忆带进考试的 P 道具', stat: true },
  { key: 'card_pick', group: '培育', label: '拿哪些技能卡', stat: true, hint: '培育中拿到的；不含偶像固有卡、初始牌组和回忆带入的卡' },
  { key: 'card_remove', group: '培育', label: '删哪些卡', stat: true, hint: '初始牌组里的卡到终局还剩多少' },
  { key: 'card_upgrade', group: '培育', label: '强化哪些卡', stat: true, hint: '排行榜记录没有定制信息，定制要看人写的攻略' },
  { key: 'params_target', group: '培育', label: '三维目标', stat: true },
  { key: 'action', group: '培育', label: '每周行动', stat: false },
  { key: 'drink', group: '培育', label: '饮料', stat: false },
  { key: 'exam_style', group: '考试', label: '考试打法', stat: false },
]

export const ACTION_LABEL: Record<string, string> = {
  lesson_vo: 'Vo 课程', lesson_da: 'Da 课程', lesson_vi: 'Vi 课程', sp_lesson: 'SP 课程', oikomi: '追い込み', class: '授業', outing: '外出',
  consult: '相談', rest: '休息', allowance: '活動支給', gift: '差し入れ', business: '営業', special_guidance: '特別指導',
  vo: 'Vo', da: 'Da', vi: 'Vi', 'class:basic': '基本卡', 'class:trouble': 'トラブル卡', 'class:off_plan': 'プラン不一致的卡', 'class:other_buff': '主打另一种 buff 的卡', 'class:genki_cash': '靠元気出分的卡',
}
