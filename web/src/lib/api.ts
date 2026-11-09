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
}

export type Engine = { engine?: string; gkms_commit?: string; rules_version?: number; master_version?: string | null }

export type Algo = { name: string; params?: Record<string, unknown>; privileged?: boolean; model_file?: string }

export type Group = { n: number; mean: number; vs_oracle: Ratio | null; vs_base?: Ratio | null }

export type Row = {
  run: string
  label: string
  mode: string
  uploader: string
  privileged: boolean
  budget_s: number | null
  n: number
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
  algo: Algo
}

export type EpisodeSummary = {
  problem: string
  seed_index: number
  score: number
  finished: boolean
  decisions: number
  think_s: number
  over_budget_steps: number
  error?: string
  tags?: Record<string, string>
}

export type RunInfo = {
  run: string
  label: string
  set: string
  mode?: string
  uploader?: string
  algo: Algo
  budget_s: number | null
  engine: Engine
  started?: string
  uploaded?: string
  finished?: string
  machine?: { host?: string; system?: string; python?: string }
  verified?: { accepted: number; rejected: number }
  episodes: EpisodeSummary[]
  mean_score?: number
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
  obs: Obs | null
  action: (string | number)[]
  algo_meta: Record<string, unknown> | null
  think_ms: number
  cpu_ms?: number | null
  client_ms?: number | null
  worlds?: number
  over_budget: boolean
  result: {
    after: Record<string, number | string | null>
    delta: Record<string, number>
    hand_before: string[]
    hand_after: string[]
    events: Record<string, unknown>[]
  }
}

export type Episode = {
  problem: string
  set: string
  tags: Record<string, string>
  seed_index: number
  seed_label?: string
  seed_split?: string
  meta: { produce_id?: string; step_type?: string; plan_type?: number; limit_turn?: number; criteria?: Record<string, number>; score_cap?: number; rival_scores?: number[]; round_label?: string }
  steps: Step[]
  final: { score: number; finished: boolean; decisions: number; turns: number; think_s: number; wall_s: number; over_budget_steps: number; begin_s?: number }
  error: string | null
  run: string
}

export type Job = { job: string; run: string; status: 'queued' | 'running' | 'done' | 'rejected' | 'error'; done: number; total: number; accepted: number; rejected: { problem: string; seed_index: number; reason: string }[]; error?: string }

export type CatalogCard = { name: string; rarity: string; plan: string; category: string; asset?: string; up: Record<string, { name: string; text: string }> }
export type CatalogThing = { name: string; rarity?: string; plan?: string; text?: string; asset?: string }
export type Catalog = {
  cards: Record<string, CatalogCard>
  drinks: Record<string, CatalogThing>
  items: Record<string, CatalogThing>
  enchants: Record<string, CatalogThing>
  idols: Record<string, CatalogThing>
}
