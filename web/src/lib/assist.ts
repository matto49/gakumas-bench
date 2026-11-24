/** 出牌助手（/assist）：编成草稿 ↔ 开局配置（gkms.hif_loadout.v1）、编成码、接口。服务器那边见 server/assist.go、gkbench/assist.py */
import { api } from './api'
import type { Obs } from './api'

// ---------------------------------------------------------------- 审查
/** H.I.F 的五场审查；step_* 字段和题库里同一场的题一致（服务器开局要用），编辑器不让改 */
export const ROUNDS = [
  { key: 'sel1', label: '选拔 1', produce_id: 'produce-007', round: 'mid1', step: { audition_number: 1, step_id: 'AuditionMid1', step_number: 7, step_select_number: 1, step_type: 16 } },
  { key: 'sel2', label: '选拔 2', produce_id: 'produce-007', round: 'mid2', step: { audition_number: 1, step_id: 'AuditionMid2', step_number: 13, step_select_number: 1, step_type: 17 } },
  { key: 'sel3', label: '选拔 3', produce_id: 'produce-007', round: 'final', step: { audition_number: 1, step_id: 'AuditionFinal', step_number: 20, step_select_number: 1, step_type: 18 } },
  { key: 'fin1', label: '本战上半场', produce_id: 'produce-008', round: 'mid1', step: { audition_number: 1, step_id: 'AuditionMid1', step_number: 7, step_select_number: 1, step_type: 16 } },
  { key: 'fin2', label: '本战下半场', produce_id: 'produce-008', round: 'final', step: { audition_number: 1, step_id: 'AuditionFinal', step_number: 9, step_select_number: 1, step_type: 18 } },
] as const
export type RoundKey = (typeof ROUNDS)[number]['key']
export const roundOf = (key: RoundKey) => ROUNDS.find((r) => r.key === key) ?? ROUNDS[0]

// ---------------------------------------------------------------- 草稿
/** 卡组里的一张：强化数、定制 [方向编号, 档数] */
export type DeckCard = { id: string; up: number; cz: [string, number][] }
export type Draft = {
  name: string
  round: RoundKey
  idol: string
  params: [number, number, number]
  stamina: number
  maxStamina: number
  /** 得分加成，千分比（12960 = 1296%）；0 表示不填 */
  bonus: [number, number, number]
  items: string[]
  drinks: string[]
  /** 回忆技能（考试开始时附魔的 enchant 编号） */
  memories: string[]
  /** 定制道具（主道具附魔） */
  mainItems: string[]
  supports: { id: string; v: number }[]
  deck: DeckCard[]
  /** 编辑器不管、但要原样带回去的字段 */
  extra: Record<string, unknown>
}

export const emptyDraft = (): Draft => ({
  name: '', round: 'fin2', idol: '', params: [1000, 1000, 1000], stamina: 30, maxStamina: 30, bonus: [0, 0, 0],
  items: [], drinks: [], memories: [], mainItems: [], supports: [], deck: [], extra: {},
})

/** "p_card-…+1/p_card_custom-…*2" → DeckCard */
export function parseDeckCard(s: string): DeckCard {
  const [head, ...cz] = s.split('/')
  const m = /^(.*?)(?:\+(\d+))?$/.exec(head)!
  return {
    id: m[1], up: Number(m[2] ?? 0),
    cz: cz.map((x) => { const [d, n] = x.split('*'); return [d, Number(n ?? 1)] as [string, number] }),
  }
}

export const deckCardString = (c: DeckCard) => c.id + (c.up ? `+${c.up}` : '') + c.cz.filter(([, n]) => n > 0).map(([d, n]) => `/${d}${n > 1 ? `*${n}` : ''}`).join('')

const KNOWN = new Set(['schema', 'produce_id', 'round', 'audition_number', 'step_id', 'step_number', 'step_select_number', 'step_type',
  'include_produce_default', 'idol_card_id', 'parameters', 'max_stamina', 'starting_stamina', 'score_bonus_permils', 'produce_item_ids',
  'drink_ids', 'lesson_start_enchant_ids', 'main_item_enchant_ids', 'support_cards', 'deck_cards', 'seed'])

const triple = (v: unknown, d: number): [number, number, number] => {
  if (Array.isArray(v) && v.length === 3) return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]
  if (v && typeof v === 'object') { const o = v as Record<string, unknown>; return [Number(o['1']) || 0, Number(o['2']) || 0, Number(o['3']) || 0] }
  return [d, d, d]
}
const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])

export function draftFromLoadout(lo: Record<string, unknown>, name = ''): Draft {
  const r = ROUNDS.find((x) => x.produce_id === lo.produce_id && x.round === lo.round) ?? ROUNDS[4]
  const extra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(lo)) if (!KNOWN.has(k) && !k.startsWith('_')) extra[k] = v
  return {
    name, round: r.key, idol: String(lo.idol_card_id ?? ''),
    params: triple(lo.parameters, 1000), stamina: Number(lo.starting_stamina ?? lo.max_stamina ?? 30), maxStamina: Number(lo.max_stamina ?? 30),
    bonus: triple(lo.score_bonus_permils, 0), items: strs(lo.produce_item_ids), drinks: strs(lo.drink_ids),
    memories: strs(lo.lesson_start_enchant_ids), mainItems: strs(lo.main_item_enchant_ids),
    supports: strs(lo.support_cards).map((s) => { const [id, v] = s.split(':'); return { id, v: Number(v ?? 0) } }),
    deck: strs(lo.deck_cards).map(parseDeckCard), extra,
  }
}

export function loadoutFromDraft(d: Draft): Record<string, unknown> {
  const r = roundOf(d.round)
  const lo: Record<string, unknown> = {
    ...d.extra, schema: 'gkms.hif_loadout.v1', produce_id: r.produce_id, round: r.round, ...r.step, include_produce_default: false,
    idol_card_id: d.idol, parameters: d.params, max_stamina: d.maxStamina, starting_stamina: Math.min(d.stamina, d.maxStamina),
    produce_item_ids: d.items, drink_ids: d.drinks, lesson_start_enchant_ids: d.memories, main_item_enchant_ids: d.mainItems,
    support_cards: d.supports.map((s) => `${s.id}:${s.v}`), deck_cards: d.deck.map(deckCardString),
  }
  if (d.bonus.some((x) => x > 0)) lo.score_bonus_permils = d.bonus
  return lo
}

// ---------------------------------------------------------------- 编成码
export async function deflateRaw(bytes: Uint8Array) {
  const s = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(s).arrayBuffer())
}
export async function inflateRaw(bytes: Uint8Array) {
  const s = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(s).arrayBuffer())
}
export const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))

/** 我们自己的编成码：GA1 + base64url(raw deflate(JSON {v, mode, name, loadout}))，和服务器 gkbench/assist_code.py 一致 */
export async function packGA1(name: string, loadout: Record<string, unknown>) {
  const { seed: _, ...lo } = loadout
  const raw = new TextEncoder().encode(JSON.stringify({ v: 1, mode: 'hif', name, loadout: lo }))
  return 'GA1' + b64url(await deflateRaw(raw))
}

export type ParsedCode = { kind: 'GA' | 'GR'; name: string; loadout: Record<string, unknown>; plays: unknown[] }

/** 读 GA1 编成码或 GKMS 导出的 GR1 对局码（也认 gkmstest 的 #c= 链接）；loadout 不带种子 */
export async function parseCode(input: string): Promise<ParsedCode> {
  let code = input.trim()
  if (code.includes('#c=')) code = code.split('#c=')[1].trim()
  if (code.length < 4 || code[2] !== '1' || (code.slice(0, 2) !== 'GA' && code.slice(0, 2) !== 'GR')) throw new Error('这不是编成码（GA1）或 GKMS 导出的对局码（GR1）')
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(new TextDecoder().decode(await inflateRaw(unb64url(code.slice(3)))))
  } catch {
    throw new Error('码读不出来，可能没复制全')
  }
  const kind = code.slice(0, 2) as 'GA' | 'GR'
  const lo = (kind === 'GA' ? obj.loadout : obj.d) as Record<string, unknown> | undefined
  if (!lo || typeof lo !== 'object') throw new Error('码里没有编成')
  const { seed: _, ...loadout } = lo
  return { kind, name: String((kind === 'GA' ? obj.name : obj.n) ?? ''), loadout, plays: kind === 'GR' ? ((obj.x as unknown[]) ?? []) : [] }
}

// ---------------------------------------------------------------- 本机保存
const SAVES = 'gkb-assist-saves'
export type Saved = { name: string; code: string; at: string }
export function listSaves(): Saved[] {
  try { return JSON.parse(localStorage.getItem(SAVES) ?? '[]') } catch { return [] }
}
export function putSave(s: Saved) {
  const rest = listSaves().filter((x) => x.name !== s.name)
  localStorage.setItem(SAVES, JSON.stringify([s, ...rest].slice(0, 50)))
}
export function dropSave(name: string) {
  localStorage.setItem(SAVES, JSON.stringify(listSaves().filter((x) => x.name !== name)))
}

// ---------------------------------------------------------------- 接口
export type Advice = { probs: number[]; best: number; score_quantiles: Record<string, number> | null }
export type PileCard = [string, number]
export type AssistView = {
  obs: Obs
  piles: { hand: PileCard[]; deck: PileCard[]; grave: PileCard[]; hold: PileCard[]; lost: PileCard[] }
  awaiting_hand: boolean
  practice: boolean
  finished: boolean
  score: number
  turn: number
  limit_turn: number | null
  numbers: { stamina: number; max_stamina: number; block: number; [k: string]: number | null }
  can_undo: boolean
  advice: Advice | null
  imported: { plays: number; total: number } | null
}

const post = <T,>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const openAssist = (body: { loadout?: Record<string, unknown>; code?: string; practice: boolean }) =>
  post<{ session: string; view: AssistView }>('api/assist/sessions', body)
export const assistHand = (id: string, cards: PileCard[]) => post<{ view: AssistView }>(`api/assist/sessions/${id}/hand`, { cards })
export const assistNumbers = (id: string, n: { score?: number; stamina?: number; block?: number }) => post<{ view: AssistView }>(`api/assist/sessions/${id}/numbers`, n)
export const assistStep = (id: string, action: (string | number)[]) => post<{ view: AssistView }>(`api/assist/sessions/${id}/step`, { action })
export const assistUndo = (id: string) => post<{ view: AssistView }>(`api/assist/sessions/${id}/undo`, {})
export const closeAssist = (id: string) => api(`api/assist/sessions/${id}`, { method: 'DELETE' }).catch(() => {})
