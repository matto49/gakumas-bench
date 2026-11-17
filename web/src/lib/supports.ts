import { BASE } from './api'
import type { Pair } from './tiers'

/** 支援卡目录（gkbench.supports.v1）：gkbench/supports.py 从完整主数据生成，GET api/supports。日文、中文都在里面 */

export type Bi = { ja: string; zh?: string }
export type SupportType = 'vocal' | 'dance' | 'visual' | 'assist'
export type SupportCard = {
  name: Bi
  rarity: 'SSR' | 'SR' | 'R'
  type: SupportType
  plan: string
  free: boolean
  limited: boolean
  order?: string
  characters: string[]
  /** 课程支援：对应属性的课程里强化手牌的概率（千分比）和游戏里的说法（「/ 確率大」） */
  lesson: { param: 'vocal' | 'dance' | 'visual' | null; permil: number } & Bi
  /** 各突破档（0～4）的等级上限 */
  caps: number[]
  /** 每个技能：解锁等级，和各突破档上限等级时生效的那几档（取「等级 ≤ 上限」的最后一档） */
  abilities: { unlock: number; steps: ({ lv: number } & Bi)[] }[]
  events: ({ level: number; card?: string; item?: string } & Bi)[]
}
export type SupportCatalog = { format: string; source?: { commit?: string; master_date?: string }; characters: Record<string, Bi>; cards: Record<string, SupportCard> }

export const supportThumbUrl = (id: string) => `${BASE}sprites/support-${id}.webp`

export const pick = (b: Bi | undefined, lang: 'ja' | 'zh') => (b ? (lang === 'zh' ? b.zh ?? b.ja : b.ja) : '')
export function pairBi(b: Bi | undefined, lang: 'ja' | 'zh', fallback = ''): Pair {
  if (!b) return { main: fallback }
  const main = pick(b, lang)
  const other = lang === 'zh' ? b.ja : b.zh
  return { main, sub: other && other !== main ? other : undefined }
}

/** 某突破档的等级上限下，这个技能的效果；还没解锁时为 null */
export function abilityAt(a: SupportCard['abilities'][number], cap: number) {
  if (a.unlock > cap) return null
  let got: SupportCard['abilities'][number]['steps'][number] | null = null
  for (const s of a.steps) if (s.lv <= cap) got = s
  return got ?? a.steps[0] ?? null
}

export const SUPPORT_TYPE_LABEL: Record<'ja' | 'zh', Record<SupportType, string>> = {
  ja: { vocal: 'ボーカル', dance: 'ダンス', visual: 'ビジュアル', assist: 'アシスト' },
  zh: { vocal: '声乐', dance: '舞蹈', visual: '视觉', assist: '辅助' },
}
export const TYPE_ATTR: Record<SupportType, number | null> = { vocal: 1, dance: 2, visual: 3, assist: null }
export const LIMIT_LABEL = ['未突破', '1 突', '2 突', '3 突', '满突']
