/** 配置频率（gkbench.usage.v1）：gkbench/usage.py 生成，GET api/usage/<模式>。
 * 每张偶像卡：排行榜前 100 名的记录里，各支援卡 / 技能卡 / P 道具出现的比例。网页按偶像、流派汇总时每张偶像卡权重相同 */

export type UsageRow = { id: string; share: number }
export type SupportUse = UsageRow & { limit: number | null }
export type CardUse = UsageRow & { copies: number; upgraded: number; from_memory?: number; w?: number; in_best?: number }
export type MemCardUse = UsageRow & { upgraded: number }
export type ItemUse = UsageRow & { up: number }
export type IdolUsage = { n: number; produce: string[]; supports: SupportUse[]; cards: CardUse[]; items: ItemUse[]; mem_cards?: MemCardUse[]; mem_items?: UsageRow[] }

export type UsageData = {
  format: string
  mode: string
  source: { author?: string; note?: string; records: number; built?: string; tierboard?: string | null }
  idols: Record<string, IdolUsage>
  supports: Record<string, { name: { ja: string; zh?: string }; rarity: string; type: string; plan: string }>
}

/** 汇总后的一行：mean = 各偶像卡比例的平均（没带的算 0）；cards = 有多少张偶像卡带过、strong = 比例 ≥ 50% 的偶像卡数 */
export type Agg<T> = { id: string; mean: number; cards: number; strong: number; rows: T[] }

export function aggregate<T extends UsageRow>(lists: T[][]): Agg<T>[] {
  const n = lists.length
  const by = new Map<string, T[]>()
  for (const l of lists) for (const r of l) by.set(r.id, [...(by.get(r.id) ?? []), r])
  return [...by.entries()]
    .map(([id, rows]) => ({ id, rows, mean: rows.reduce((s, r) => s + r.share, 0) / n, cards: rows.length, strong: rows.filter((r) => r.share >= 0.5).length }))
    .sort((a, b) => b.mean - a.mean || a.id.localeCompare(b.id))
}

export const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number')
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/** 偶像卡编号里的角色：i_card-hrnm-3-002 → hrnm */
export const charOf = (idolCard: string) => idolCard.split('-')[1]
