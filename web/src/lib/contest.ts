// 竞技场（/contest）：赛季、模拟任务接口（server/contest.go）、编成码 GC1、本机保存和历史
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { useApi } from './hooks'
import { b64url, deflateRaw, inflateRaw, unb64url, type DeckCard } from './assist'

// ---------------------------------------------------------------- 赛季
export type ContestStage = {
  stageType: string
  /** ProducePlanType_Common / _Plan1（感性）/ _Plan2（理性）/ _Plan3（非凡） */
  planType: string
  turn: number
  produceItemIds: string[]
  vocal: number
  dance: number
  visual: number
}
export type ContestSeason = { id: string; description: string; stages: ContestStage[] }
export type ContestSeasons = { package: string; seasons: ContestSeason[] }

export const useContestSeasons = () => useApi<ContestSeasons>('api/contest/seasons')

/** 目录里的计划（PLAN1 / PLAN2 / PLAN3 / COMMON）；Common 舞台是 null，表示哪个计划都能上 */
export function stagePlan(st: ContestStage | undefined): string | null {
  const m = st?.planType.match(/Plan(\d)$/)
  return m ? `PLAN${m[1]}` : null
}

/** 偶像卡的计划能不能上这个舞台 */
export const planFits = (stage: ContestStage | undefined, idolPlan: string | undefined) => {
  const need = stagePlan(stage)
  return !need || need === idolPlan
}

export const seasonLabel = (s: ContestSeason) => `第 ${s.id.split('-').pop()} 赛季`

// ---------------------------------------------------------------- 编成
/** 页面上的一份编成（不含局数以外的运行设置）。support 是百分数（1.88 = 1.88%） */
export type ContestLoadout = {
  name: string
  season: string
  stage: number
  idol: string
  params: [number, number, number]
  stamina: number
  support: number
  items: string[]
  main: DeckCard[]
  sub: DeckCard[]
}

export const emptyLoadout = (season = '', stage = 0): ContestLoadout => ({
  name: '', season, stage, idol: '', params: [0, 0, 0], stamina: 0, support: 0, items: [], main: [], sub: [],
})

/** 主副回忆的数值合成最终参数：floor(主 + 副 ÷ 5)（模拟包 formation.py 的规则） */
export const combine = (main: number, sub: number) => Math.floor(main + sub / 5)

const cardJob = (c: DeckCard) => ({
  id: c.id,
  upgrade_count: c.up,
  ...(c.cz.some(([, n]) => n > 0) ? { customizes: c.cz.filter(([, n]) => n > 0).map(([id, n]) => ({ id, customize_count: n })) } : {}),
})

/** 交给 /api/contest/sims 的任务体 */
export function jobOf(l: ContestLoadout, runs: number) {
  return {
    season_id: l.season, stage: l.stage, runs, support_permyriad: Math.round(l.support * 100),
    loadout: {
      idol_card_id: l.idol, stamina: l.stamina,
      params: { vocal: l.params[0], dance: l.params[1], visual: l.params[2] },
      items: l.items, main_cards: l.main.map(cardJob), sub_cards: l.sub.map(cardJob),
    },
  }
}

/** 模拟能不能点：缺什么就回一句话，齐了回 null */
export function missing(l: ContestLoadout, stage: ContestStage | undefined, idolPlan: string | undefined): string | null {
  if (!l.season || !stage) return '先选赛季和舞台'
  if (!l.idol) return '先选偶像卡'
  if (!planFits(stage, idolPlan)) return '这张偶像卡的计划上不了这个舞台'
  if (l.params.some((x) => !(x >= 0 && x <= 6000))) return '参数要在 0–6000 之间'
  if (!(l.stamina >= 1 && l.stamina <= 200)) return '体力要在 1–200 之间'
  if (!(l.support >= 0 && l.support <= 20)) return '支援加成要在 0–20% 之间'
  if (l.main.length + l.sub.length === 0) return '至少放一张技能卡'
  return null
}

// ---------------------------------------------------------------- 编成码 GC1
/** GC1 + base64url(raw deflate(JSON {v, l}))：编成和舞台一起带 */
export async function packGC1(l: ContestLoadout) {
  return 'GC1' + b64url(await deflateRaw(new TextEncoder().encode(JSON.stringify({ v: 1, l }))))
}

const num = (x: unknown, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d)
const str = (x: unknown) => (typeof x === 'string' ? x : '')
const strs = (x: unknown, max: number) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(0, max) : [])
const cards = (x: unknown): DeckCard[] =>
  (Array.isArray(x) ? x : []).slice(0, 6).flatMap((c) => {
    if (!c || typeof c !== 'object' || typeof (c as DeckCard).id !== 'string') return []
    const d = c as DeckCard
    const cz = Array.isArray(d.cz) ? d.cz.filter((p): p is [string, number] => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'number') : []
    return [{ id: d.id, up: num(d.up), cz }]
  })

/** 读 GC1；坏码抛一句话的错误。字段逐个过一遍，坏数据不会带进页面 */
export async function parseGC1(input: string): Promise<ContestLoadout> {
  const code = input.trim()
  if (!code.startsWith('GC1') || code.length < 8) throw new Error('这不是竞技场编成码（GC1 开头）')
  let o: { l?: Record<string, unknown> }
  try {
    o = JSON.parse(new TextDecoder().decode(await inflateRaw(unb64url(code.slice(3)))))
  } catch {
    throw new Error('码读不出来，可能没复制全')
  }
  const l = sanitizeLoadout(o?.l)
  if (!l) throw new Error('码里没有编成')
  return l
}

/** 任何来源（编成码、本机草稿）的编成都逐个字段过一遍；不是对象回 null */
export function sanitizeLoadout(x: unknown): ContestLoadout | null {
  if (!x || typeof x !== 'object') return null
  const l = x as Record<string, unknown>
  const p = Array.isArray(l.params) ? l.params : []
  return {
    name: str(l.name).slice(0, 40), season: str(l.season), stage: Math.max(0, Math.min(2, Math.trunc(num(l.stage)))), idol: str(l.idol),
    params: [num(p[0]), num(p[1]), num(p[2])], stamina: num(l.stamina), support: num(l.support),
    items: strs(l.items, 4), main: cards(l.main), sub: cards(l.sub),
  }
}

// ---------------------------------------------------------------- 模拟任务
export type SimStats = { n: number; min: number; p10: number; p25: number; mean: number; median: number; p75: number; p90: number; max: number; sd: number }
export type SimPlay = { turn: number; card_id: string; up: number; ptype: number; score: number; stamina: number; block: number }
export type SimLog = { seed: number; score: number; plays: SimPlay[] }
export type SimResult = {
  stats: SimStats
  scores: number[]
  errors: number
  turns: { turn: number; mean: number; p10: number; p90: number }[]
  by_param: { vocal: number; dance: number; visual: number }
  cards: { card: string; per_game: number; share: number }[]
  logs: { min: SimLog; median: SimLog; max: SimLog }
  player: { params: number[]; permils: number[]; max_stamina: number }
  criteria: number[]
  turns_limit: number
  timing: { load: number; games: number; workers: number }
}
export type SimProgress = { done?: number; total?: number; phase?: string; partial?: Partial<SimStats> }
export type SimState =
  | { id: string; state: 'queued'; position: number }
  | { id: string; state: 'running'; progress?: SimProgress }
  | { id: string; state: 'done'; result: SimResult }
  | { id: string; state: 'failed' | 'canceled'; error: string }

const post = <T,>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const submitSim = (l: ContestLoadout, runs: number) => post<{ id: string; position: number }>('api/contest/sims', jobOf(l, runs))
export const cancelSim = (id: string) => api(`api/contest/sims/${id}`, { method: 'DELETE' }).catch(() => {})

/** 一个模拟任务：排队 / 运行时每 0.7 秒取一次，结束后不再取 */
export function useSim(id: string | null) {
  return useQuery({
    queryKey: ['contest-sim', id],
    queryFn: () => api<SimState>(`api/contest/sims/${id}`),
    enabled: !!id,
    refetchInterval: (q) => {
      const s = q.state.data?.state
      return s === 'queued' || s === 'running' || s === undefined ? 700 : false
    },
    staleTime: Infinity,
  })
}

/** 结果里的卡牌 id 末尾的 + 表示强化次数 */
export function splitCardId(raw: string): [string, number] {
  const m = raw.match(/^(.*?)(\+*)$/)
  return m ? [m[1], m[2].length] : [raw, 0]
}

// ---------------------------------------------------------------- 本机保存和历史
const SAVES = 'gkb-contest-saves'
const HISTORY = 'gkb-contest-history'
export type ContestSaved = { name: string; code: string; season: string; stage: number; idol: string; at: string }
export type ContestHistory = { at: string; code: string; season: string; stage: number; idol: string; name: string; runs: number; stats: Pick<SimStats, 'n' | 'mean' | 'median' | 'p10' | 'p90'> }

function readList<T>(key: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
function writeList(key: string, xs: unknown[]) {
  try {
    localStorage.setItem(key, JSON.stringify(xs))
    return true
  } catch {
    return false // 存满了或者浏览器不让存
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object'
export const listSaved = () =>
  readList<unknown>(SAVES).filter((s): s is ContestSaved => isObj(s) && typeof s.name === 'string' && typeof s.code === 'string' && typeof s.season === 'string')
export async function saveLoadout(l: ContestLoadout, name: string) {
  const s: ContestSaved = { name, code: await packGC1({ ...l, name }), season: l.season, stage: l.stage, idol: l.idol, at: new Date().toISOString() }
  return writeList(SAVES, [s, ...listSaved().filter((x) => x.name !== name)].slice(0, 50))
}
export const dropSaved = (name: string) => writeList(SAVES, listSaved().filter((x) => x.name !== name))

export const listHistory = () =>
  readList<unknown>(HISTORY).filter((h): h is ContestHistory =>
    isObj(h) && typeof h.code === 'string' && typeof h.season === 'string' && typeof h.at === 'string' && isObj(h.stats) && typeof h.stats.mean === 'number' && typeof h.stats.p10 === 'number' && typeof h.stats.p90 === 'number')
export async function pushHistory(l: ContestLoadout, runs: number, s: SimStats) {
  const h: ContestHistory = {
    at: new Date().toISOString(), code: await packGC1(l), season: l.season, stage: l.stage, idol: l.idol, name: l.name, runs,
    stats: { n: s.n, mean: s.mean, median: s.median, p10: s.p10, p90: s.p90 },
  }
  writeList(HISTORY, [h, ...listHistory()].slice(0, 30))
}
export const clearHistory = () => writeList(HISTORY, [])
