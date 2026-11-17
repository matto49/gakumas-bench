import { BASE } from './api'

/** 强度榜（gkbench.tierboard.v1）：gkbench/tierboard.py 从「六维强度榜」数据包导入，GET api/tiers/<id> */

export type Dim = 'ceiling' | 'practice' | 'stability' | 'card_dep' | 'formation' | 'play'
export type Tier = 'S' | 'A' | 'B' | 'C' | 'D'
export type Quant = { p10: number; p50: number; p90: number; mean: number }

export type Battle = {
  label: string
  best_drinks?: string[]
  best: Quant
  own: Quant
  gain?: number
  hist?: { edges: number[]; best: number[]; own: number[] }
  templates?: number
  play?: { budget: number; mean: number; keeps: number }
}

export type DeckRow = { id: string; name: string; kind: string; upgrade: number; customized: boolean; w: number; in_best: number; copies_best: number; adoption: number }
export type KeyCard = { id: string | null; name: string; kind: string; customized: boolean; w: number; se: number; gain: number }
type Stat = { min: number; max: number; mean: number }

export type TierCard = {
  id: string
  name: string
  character: string
  character_id: string
  rarity: string
  plan_label: string
  style_label: string
  rank: number
  total: number
  ratio: number
  tier: Tier
  rank_interval: [number, number]
  tier_share: Partial<Record<Tier, number>>
  first_share?: number | null
  score: Record<Dim, number>
  raw: Record<Dim, number>
  sim: { templates: number; spike: number; human: number; luck: number }
  low_confidence: boolean
  confident: boolean
  model: { held_spearman: number; r2_cv: number; train_games: number; vocabulary: number }
  counts: { templates: number; records: number; games: number }
  real: { n: number; median: number; p90?: number; max: number; score_first?: number; score_median?: number; potential?: Record<string, number>; rank?: number; tier?: Tier }
  deck: { arm: string; arm_label: string; measured: Record<'vbest' | 'local', { mean: number; ci95: [number, number]; pairs: number }>; rows: DeckRow[] }
  key_cards: { top: KeyCard[]; bottom: KeyCard[] }
  battles: { mid1: Battle; final: Battle; total: Battle }
  records: { best: number; own: number; recorded: number }[]
  usage: {
    n: number
    supports: { id: string; share: number }[]
    items: { id: string; share: number }[]
    deck_size: [number, number] | null
    support_limit: number | null
    params: Record<'vocal' | 'dance' | 'visual', Stat>
    growth: Record<'vocal' | 'dance' | 'visual', number>
    stamina: number
  } | null
}

export type TierBoard = {
  format: 'gkbench.tierboard.v1'
  id: string
  title: string
  scenario: string
  class: string
  source: { author?: string; video?: string; date?: string }
  weights: Record<Dim, number>
  tier_bars: number[]
  class_best: { ceiling: number; practice: number }
  counts: { cards: number; records: number; templates: number; games: number; sim_games: number }
  dims: Dim[]
  supports: Record<string, { name: string; zh?: string | null; asset?: string; rarity?: string }>
  names?: TierNames
  cards: TierCard[]
}

export type TierIndex = { boards: { id: string; title: string; scenario: string; class: string; source: TierBoard['source']; cards: number; top: string[] }[] }

/** 现在只有一张榜；以后按模式、流派加榜时改成读 index */
export const DEFAULT_BOARD = 'hif-koinsho-202611'

export const DIM_LABEL: Record<Dim, string> = {
  ceiling: '上限',
  practice: '实战',
  stability: '稳定',
  card_dep: '抗卡依赖',
  formation: '编成宽容',
  play: '操作容错',
}

/** 六维各自量的是什么（参考视频「六个维度怎么算」那一页） */
export const DIM_HELP: Record<Dim, [string, string]> = {
  ceiling: ['最好的牌组配上最优饮料，能打到多高', '最优牌组的本戦总分均值，本类最高记 100'],
  practice: ['玩家自己的牌组和饮料，正常能打多少', '每份编成模拟的期望成绩取中位，本类最高记 100'],
  stability: ['运气不好的那几把，还剩多少分', '同一编成换牌序，较差一成 ÷ 中位'],
  card_dep: ['少了最关键的 2 张卡，还剩多少分', '换掉贡献最大的 2 张卡后的保持率'],
  formation: ['编成练得一般，和练得好差多少', '各编成期望成绩的较差一成 ÷ 较好一成'],
  play: ['出牌想得浅一些，还剩多少分', '思考量降到约十二分之一后的保持率'],
}

export const TIER_STYLE: Record<Tier, string> = {
  S: 'bg-[oklch(0.76_0.16_75)] text-ink',
  A: 'bg-[oklch(0.62_0.17_35)] text-white',
  B: 'bg-[oklch(0.55_0.15_252)] text-white',
  C: 'bg-[oklch(0.55_0.1_180)] text-white',
  D: 'bg-[oklch(0.58_0.02_260)] text-white',
}

/** 档位线：第一名的 95 / 85 / 75 / 65% */
export function tierLine(board: TierBoard, t: Tier) {
  const i = ['S', 'A', 'B', 'C'].indexOf(t)
  return i < 0 ? `< ${Math.round(board.tier_bars[board.tier_bars.length - 1] * 100)}%` : `≥ ${Math.round(board.tier_bars[i] * 100)}%`
}

/** 换一批编成重采样时，落在本档的比例不到 95%：可能跨档 */
export const mayCross = (c: TierCard) => (c.tier_share[c.tier] ?? 0) < 0.95

export const supportThumbUrl = (id: string) => `${BASE}sprites/support-${id}.webp`

/** 本戦分数：412 万 */
export const wan = (n: number, digits = 0) => `${(n / 10000).toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits })} 万`

/** 榜里带的日文和中文名（tierboard.py 的 names）。技能卡按强化档存一串 */
export type BiName = { ja?: string; zh?: string }
export type TierNames = {
  idols: Record<string, BiName>
  cards: Record<string, { ja?: string[]; zh?: string[] }>
  items: Record<string, BiName>
  drinks: Record<string, BiName>
  supports: Record<string, BiName>
}

/** 主名跟着「日 / 中」开关，另一种语言做对照；两种一样或缺一种时 sub 为空 */
export type Pair = { main: string; sub?: string }
export function pairOf(n: BiName | undefined, lang: 'ja' | 'zh', fallback: string): Pair {
  const main = (lang === 'zh' ? n?.zh ?? n?.ja : n?.ja ?? n?.zh) ?? fallback
  const other = lang === 'zh' ? n?.ja : n?.zh
  return { main, sub: other && other !== main ? other : undefined }
}

/** 「【卡名】人名」拆成卡名和人名 */
export function splitIdol(full: string) {
  return full.includes('】') ? { name: full.slice(1, full.indexOf('】')), character: full.slice(full.indexOf('】') + 1) } : { name: full, character: '' }
}
