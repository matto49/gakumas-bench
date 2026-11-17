/** 首页用的小文件（GET api/site/<名>）：home 由 gkbench.homedata 生成，now、updates 手写在 $DATA/static/site/ */

export type Bi = { ja: string; zh?: string }

export type SiteHome = {
  format: string
  source: { master_date?: string; days?: number }
  birthdays: { id: string; name: Bi; month: number; day: number }[]
  new_cards: { kind: 'idol' | 'support'; id: string; date: string; rarity: string; name: Bi; character?: string; character_name?: Bi }[]
  counts: { idols: number; supports: number }
}

/** 卡池、活动：start / end 是日本时间「YYYY-MM-DD HH:MM」 */
export type NowItem = { kind: 'gacha' | 'event'; title: string; start?: string; end?: string; cards?: string[]; note?: string; link?: string }
export type SiteNow = { updated?: string; items: NowItem[] }

export type SiteUpdates = { items: { date: string; text: string; link?: string }[] }

/** 日本时间字符串 → 时间戳 */
export const jst = (s: string) => Date.parse(s.replace(' ', 'T') + ':00+09:00')

/** 今天起往后的生日，今天的排最前；days 是还有几天（0 = 今天） */
export function upcomingBirthdays(list: SiteHome['birthdays'], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return list
    .map((b) => {
      let d = new Date(today.getFullYear(), b.month - 1, b.day)
      if (d < today) d = new Date(today.getFullYear() + 1, b.month - 1, b.day)
      return { ...b, days: Math.round((d.getTime() - today.getTime()) / 86400000) }
    })
    .sort((a, b) => a.days - b.days)
}
