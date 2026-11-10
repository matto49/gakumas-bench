// 接口：和 Go 服务器（server/）一一对应
export const BASE = import.meta.env.BASE_URL // '/gkbench/'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path.replace(/^\//, ''), { credentials: 'same-origin', ...init })
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try {
      const j = await r.json()
      if (j?.detail) msg = j.detail
    } catch {
      /* 不是 JSON */
    }
    throw new ApiError(r.status, msg)
  }
  return r.json() as Promise<T>
}

export type Ratio = { n: number; geo: number; se: number; win: number }

export type SetInfo = {
  set: string
  problems: number
  seeds: { dev: number; test: number }
  runs: number
  public_seeds: boolean
  template_seeds?: number
  idols?: string[]
  title?: string
  blurb?: string
  owner?: string
  /** official 官方；community 社区（用户自己建、自己传） */
  status?: 'official' | 'community'
  created?: string
  /** 场景分布：exam / stage / round / plan / mechanic / idol → 值 → 题数 */
  scenes?: Record<string, Record<string, number>>
  /** 跑过的算法（不含理论上限） */
  algos?: string[]
  can_edit?: boolean
}

export type Engine = { engine?: string; gkms_commit?: string; rules_version?: number; master_version?: string | null }

export type Group = { n: number; mean: number; vs_oracle: Ratio | null; vs_base?: Ratio | null }

/** 审查存档表 6 的表头 mode：internal 内置、self 自报、hosted 托管、player 玩家实战 */
export type Mode = 'internal' | 'self' | 'hosted' | 'player'

/** 算法说明：内置算法由服务器按名字给；外部算法托管 / 评测时可以自己提交 */
export type AlgoDoc = {
  summary: string
  detail?: string[]
  sees?: 'screen' | 'seed'
  links?: { title: string; url: string }[]
  private?: string[]
  source: 'builtin' | 'submitter'
}

export type Row = {
  /** 最新那次运行；同一算法的多次运行在服务器合成一行，runs 是全部（新的在前，只有一次时没有） */
  run: string
  runs?: string[]
  label: string
  algo: string
  params?: Record<string, unknown>
  mode: Mode
  kind: 'fixed' | 'template'
  by: string
  privileged: boolean
  step_seconds: number | null
  n: number
  problems: number
  seeds_per_problem?: number
  mean: number
  errors: number
  unfinished: number
  over: number
  p50_ms: number
  p95_ms: number
  max_ms: number
  ep_think_s: number
  vs_oracle: Ratio | null
  vs_base?: Ratio | null
  groups?: Record<string, Group>
  engine: Engine
  about?: AlgoDoc
}

export type EpisodeSummary = {
  id: string
  name?: string
  fixed_id?: string
  seed_index: number
  exam_sha?: string
  score: number
  finished: boolean
  decisions: number
  secs: number
  over_steps: number
  err?: string
  at?: string
  route?: string
  tags?: Record<string, string>
  types?: number[]
}

export type RunInfo = {
  run: string
  label: string
  set: string
  kind: 'fixed' | 'template'
  algo: string
  params?: Record<string, unknown>
  budget?: number
  seconds?: number
  step_seconds?: number
  rules?: number
  machine?: string
  mode: Mode
  by?: string
  privileged?: boolean
  claimed_mode?: string
  claimed_by?: string
  engine: Engine
  started?: string
  uploaded?: string
  finished?: string
  verified?: { accepted: number; rejected?: number }
  seeds_per_problem?: number
  template_seeds?: string
  episodes: EpisodeSummary[]
  mean_score?: number
  about?: AlgoDoc
}

export type Card = { id: string; u?: number; c?: [string, number][]; g?: string[]; p?: number }

export type Obs = {
  v: string
  i: number
  exam: { produce: string; step: string; plan: number; idol: string; turn: number; limit: number; types: number[]; permil: number[]; crit: number[] }
  num: { score: number; stamina: number; max_stamina: number; block: number; playable: number; plays: number }
  stance: [string | null, number]
  status: [string, number, number][]
  ench: [string, number, number][]
  hand: Card[]
  deck: Card[]
  grave: Card[]
  hold: Card[]
  lost: Card[]
  played: Card[]
  drinks: string[]
  legal: (string | number)[][]
}

export type Step = {
  i: number
  turn: number
  token: string
  obs: Obs | null
  action: (string | number)[]
  algo_meta: Record<string, unknown> | null
  step_ms: number
  cpu_ms?: number | null
  client_ms?: number | null
  worlds?: number
  over: boolean
  result: {
    after: Record<string, number | string | null>
    delta: Record<string, number>
    hand_before: string[]
    hand_after: string[]
    events: Record<string, unknown>[]
  }
}

export type Episode = {
  id: string
  name?: string
  family?: string
  fixed_id?: string
  set: string
  tags: Record<string, string>
  seed_index: number
  seed_label?: string
  seed_split?: string
  exam_sha?: string
  exam?: number
  meta: { produce_id?: string; step_type?: string; plan_type?: number; limit_turn?: number; criteria?: Record<string, number>; score_cap?: number; rival_scores?: number[]; round_label?: string }
  route: string
  steps: Step[]
  final: { score: number; finished: boolean; decisions: number; turns: number; secs: number; wall_s: number | null; over_steps: number; begin_s?: number }
  err: string | null
  at?: string
  run: string
}

export type Job = { job: string; run: string; status: 'queued' | 'running' | 'done' | 'rejected' | 'error'; done: number; total: number; accepted: number; rejected: { id: string; seed_index?: number; answer?: number; reason: string }[]; error?: string }

/** 卡的定制（カスタマイズ）：每张卡有自己的几个方向，每个方向 1～3 档（pp 是这一档花的 P 点，text 是到这一档为止的效果），一张卡总共能定制 max 次 */
export type CardCustom = { max: number; dirs: { id: string; levels: { pp: number; text: string }[] }[] }
export type CatalogCard = { name: string; rarity: string; plan: string; category: string; asset?: string; up: Record<string, { name: string; text: string }>; custom?: CardCustom; unlock?: number }
/** unlock：解锁 P 等级（技能卡、饮料才有；没有 = 不靠等级解锁） */
export type CatalogThing = { name: string; rarity?: string; plan?: string; text?: string; asset?: string; unlock?: number }
export type Catalog = {
  cards: Record<string, CatalogCard>
  drinks: Record<string, CatalogThing>
  items: Record<string, CatalogThing>
  enchants: Record<string, CatalogThing>
  idols: Record<string, CatalogThing>
  /** 回忆（memory_ability_ids）→ 效果文字 */
  memories?: Record<string, CatalogThing>
}

/** /api/sets/{set}/problems 的一项：题模板（审查存档原样）+ 便于展示的字段 + 自测牌序的公开信息 */
export type Problem = {
  id: string
  name: string
  family: string
  tags: Record<string, string>
  archive: Record<string, unknown>
  seeds: { index: number; split: string; label: string; exam_sha?: string; fixed_id?: string }[]
  scene?: Scene
}

/** 一道题的场景（服务器从编成和 meta 自动算） */
export type Scene = { exam?: string; stage?: string; round?: string; plan?: string; mechanic?: string; idol?: string; turns?: number; deck?: number; items?: string[]; drinks?: string[] }
