import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, GitCompareArrows } from 'lucide-react'
import type { Card, Episode, Obs, Step } from '../lib/api'
import { useApi } from '../lib/hooks'
import { useCatalog, idolName, cardName } from '../lib/catalog'
import { int, ms } from '../lib/format'
import { PLAN, PRODUCE, STANCE, ROUND } from '../lib/game'
import { ScoreChart } from '../components/Charts'
import { actionText, DrinkChip, EnchantChip, SkillCard, StatusChip } from '../components/GameBits'
import { AttrChip, cx, ErrorState, Help, PageHeader, TableSkeleton } from '../components/ui'

const DELTA_LABEL: Record<string, string> = {
  score: '分数', stamina: '体力', max_stamina: '最大体力', block: '元気', review: '好印象', aggressive: 'やる気',
  lesson_buff: '集中', full_power_point: '全力値', playable: '可出张数', turn_play_count: '本回合已出', extra_turns: '追加回合', turn: '回合', stance_step: '指針段数',
}

function parseAction(s: string): (string | number)[] | null {
  try {
    return JSON.parse(s.replace(/\(/g, '[').replace(/\)/g, ']').replace(/'/g, '"').replace(/,\s*\]/g, ']'))
  } catch {
    return null
  }
}

function sameAction(a: (string | number)[], b: (string | number)[] | null) {
  return !!b && a.length === b.length && a.every((x, i) => String(x) === String(b[i]))
}

export function Replay() {
  const { run = '', problem = '', seed = '0' } = useParams()
  const [q, setQ] = useSearchParams()
  const cat = useCatalog()
  const ep = useApi<Episode>(`api/runs/${encodeURIComponent(run)}/episodes/${encodeURIComponent(problem)}/${seed}`)
  const steps = ep.data?.steps ?? []
  const cur = Math.max(0, Math.min(steps.length - 1, Number(q.get('i') ?? 0)))
  const go = useCallback(
    (i: number) => {
      const n = new URLSearchParams(q)
      n.set('i', String(Math.max(0, Math.min(steps.length - 1, i))))
      setQ(n, { replace: true })
    },
    [q, setQ, steps.length],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowLeft' || e.key === 'k') { go(cur - 1); e.preventDefault() }
      if (e.key === 'ArrowRight' || e.key === 'j') { go(cur + 1); e.preventDefault() }
      if (e.key === 'Home') go(0)
      if (e.key === 'End') go(steps.length - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cur, go, steps.length])

  const series = useMemo(
    () => [{ name: '分数', color: 'var(--color-ink)', points: steps.map((s) => ({ x: s.i, y: Number(s.result.after.score ?? 0), label: actionText(s.action, s.obs?.hand ?? s.result.hand_before, s.obs?.drinks, cat) })) }],
    [steps, cat],
  )

  if (ep.error) return <ErrorState error={ep.error} onRetry={ep.reload} />
  if (!ep.data) return <TableSkeleton rows={12} />
  const e = ep.data
  const s = steps[cur]
  const obs0 = steps[0]?.obs
  const types = obs0?.exam.types

  return (
    <div>
      <p className="mb-2 text-[12.5px] text-muted">
        <Link to={`/sets/${e.set}`} className="hover:text-ink">排行</Link> / <Link to={`/runs/${run}`} className="hover:text-ink">{run}</Link> / 复盘
      </p>
      <PageHeader
        title={<span className="break-all">{problem} <span className="text-ink-2">#{seed}</span></span>}
        sub={
          <span className="text-ink-2">
            {obs0 && <>{idolName(cat, obs0.exam.idol)} · {PLAN[String(obs0.exam.plan)] ?? ''} · {PRODUCE[obs0.exam.produce] ?? obs0.exam.produce} </>}
            {e.meta.round_label && `· ${ROUND[e.meta.round_label] ?? e.meta.round_label} `}
            · 终局 <span className="num font-semibold text-ink">{int(e.final.score)}</span> · {e.final.decisions} 个决策 · 思考 {e.final.think_s.toFixed(1)} s
            {e.error && <span className="ml-2 text-critical">算法出错：{e.error}</span>}
          </span>
        }
        right={
          <Link to={`/compare?a=${encodeURIComponent(run)}&problem=${encodeURIComponent(problem)}&seed=${seed}`} className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-ink hover:bg-surface-2">
            <GitCompareArrows size={15} aria-hidden /> 和别的算法对比
          </Link>
        }
      />

      <section className="mb-5 rounded-lg border border-line px-3 pt-3 pb-1">
        <ScoreChart series={series} turnOf={steps.map((x) => x.turn)} types={types} current={cur} onPick={go} />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <StepNav cur={cur} total={steps.length} go={go} />
          {s && <StepState step={s} />}
        </div>
        <MoveList steps={steps} cur={cur} go={go} />
      </div>
    </div>
  )
}

function StepNav({ cur, total, go }: { cur: number; total: number; go: (i: number) => void }) {
  const btn = 'inline-grid size-8 place-items-center rounded-md border border-line-strong text-ink-2 hover:bg-surface-2 disabled:opacity-40'
  return (
    <div className="mb-3 flex items-center gap-1.5">
      <button className={btn} onClick={() => go(0)} disabled={cur === 0} aria-label="第一步"><ChevronsLeft size={16} /></button>
      <button className={btn} onClick={() => go(cur - 1)} disabled={cur === 0} aria-label="上一步"><ChevronLeft size={16} /></button>
      <span className="num min-w-24 text-center text-ink">第 {cur + 1} / {total} 步</span>
      <button className={btn} onClick={() => go(cur + 1)} disabled={cur >= total - 1} aria-label="下一步"><ChevronRight size={16} /></button>
      <button className={btn} onClick={() => go(total - 1)} disabled={cur >= total - 1} aria-label="最后一步"><ChevronsRight size={16} /></button>
      <span className="ml-2 text-[12px] text-muted">键盘 ← → 翻步</span>
    </div>
  )
}

function Section({ title, children, help }: { title: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="border-t border-line py-3 first:border-0 first:pt-0">
      <h3 className="mb-2 inline-flex items-center text-[12px] font-medium tracking-wide text-muted">{title}{help && <Help tip={help} />}</h3>
      {children}
    </div>
  )
}

function StepState({ step }: { step: Step }) {
  const cat = useCatalog()
  const o: Obs | null = step.obs
  const act = step.action
  const playIdx = act[0] === 'play' ? Number(act[1]) : -1
  const drinkIdx = act[0] === 'drink' ? Number(act[1]) : -1
  const hand: Card[] = o?.hand ?? step.result.hand_before.map((id) => ({ id }))
  const attr = o ? o.exam.types[o.exam.turn - 1] : undefined
  const deltas = Object.entries(step.result.delta).filter(([k]) => k !== 'turn_play_count')
  return (
    <div className="rounded-lg border border-line px-4 py-3">
      {o && (
        <Section title="局面（这一步之前）">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="inline-flex items-center gap-2 text-ink">
              <span className="num font-semibold">回合 {o.exam.turn} / {o.exam.limit}</span>
              {attr && <AttrChip t={attr} />}
              <span className="num text-[12px] text-muted">倍率 {o.exam.permil.map((p) => (p / 1000).toFixed(1)).join(' / ')}</span>
            </span>
            <Num label="分数" v={o.num.score} />
            <Num label="体力" v={`${o.num.stamina} / ${o.num.max_stamina}`} />
            <Num label="元気" v={o.num.block} />
            <Num label="还能出" v={`${o.num.playable} 张`} />
            {o.stance[0] && <Num label="指針" v={`${STANCE[o.stance[0]] ?? o.stance[0]} ${o.stance[1]}`} />}
          </div>
          {o.status.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {o.status.map(([k, v, t]) => <StatusChip key={k} kind={k} value={v} turns={t} />)}
            </div>
          )}
        </Section>
      )}

      <Section title="手牌">
        <div className="flex flex-wrap gap-2">
          {hand.map((c, i) => <SkillCard key={i} card={c} size={56} mark={i === playIdx ? 'chosen' : undefined} dim={c.p === 0} />)}
          {hand.length === 0 && <span className="text-ink-2">没有手牌</span>}
        </div>
      </Section>

      {o && o.drinks.length > 0 && (
        <Section title="饮料">
          <div className="flex flex-wrap gap-1.5">{o.drinks.map((d, i) => <DrinkChip key={i} id={d} mark={i === drinkIdx} />)}</div>
        </Section>
      )}

      <Section title="这一步">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
          <span className="text-[15px] font-semibold text-ink">{actionText(act, o?.hand ?? step.result.hand_before, o?.drinks, cat)}</span>
          <span className={cx('num text-[12.5px]', step.over_budget ? 'font-medium text-critical' : 'text-ink-2')}>
            思考 {ms(step.think_ms)}{step.over_budget && '（超时）'}
          </span>
          {step.worlds ? <span className="num text-[12.5px] text-ink-2">采样 {step.worlds} 个世界</span> : null}
        </div>
        {deltas.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {deltas.map(([k, v]) => (
              <span key={k} className="num inline-flex items-center gap-1 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[12px]">
                <span className="text-ink-2">{DELTA_LABEL[k] ?? k}</span>
                <span className="font-semibold text-ink">{v > 0 ? `+${int(v)}` : int(v)}</span>
              </span>
            ))}
          </div>
        )}
        <AlgoMeta meta={step.algo_meta} step={step} />
      </Section>

      {o && o.ench.length > 0 && (
        <Section title="持续效果" help="P 道具、回忆和卡牌留下的持续效果。">
          <div className="flex flex-wrap gap-1.5">{o.ench.map(([id, u, t], i) => <EnchantChip key={`${id}-${i}`} id={id} uses={u} turns={t} />)}</div>
        </Section>
      )}

      {o && (
        <Section title="牌区" help="山札只给有哪些牌，不给顺序；这正是算法能看到的信息。">
          <Piles obs={o} />
        </Section>
      )}
    </div>
  )
}

function Num({ label, v }: { label: string; v: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="num font-semibold text-ink">{typeof v === 'number' ? int(v) : v}</span>
    </span>
  )
}

function Piles({ obs }: { obs: Obs }) {
  const piles: [string, typeof obs.deck][] = [['山札', obs.deck], ['捨て札', obs.grave], ['保留', obs.hold], ['除外', obs.lost], ['本回合已出', obs.played]]
  return (
    <div className="space-y-1">
      {piles.map(([name, cards]) => (
        <details key={name} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded px-1 py-1 text-ink-2 hover:bg-surface-2">
            <ChevronRight size={13} className="transition-transform duration-150 group-open:rotate-90" aria-hidden />
            <span className="text-ink">{name}</span>
            <span className="num text-muted">{cards.length} 张</span>
          </summary>
          <div className="flex flex-wrap gap-2 py-2 pl-6">
            {cards.length ? cards.map((c, i) => <SkillCard key={i} card={c} size={40} />) : <span className="text-[12px] text-muted">空</span>}
          </div>
        </details>
      ))}
    </div>
  )
}

/** 算法对这一步的说明：PIMC 的投票 / 期望分、UINet 的概率、上限的路线信息 */
function AlgoMeta({ meta, step }: { meta: Step['algo_meta']; step: Step }) {
  const cat = useCatalog()
  if (!meta || Object.keys(meta).length === 0) return null
  const hand = step.obs?.hand ?? step.result.hand_before
  const drinks = step.obs?.drinks
  const label = (a: (string | number)[] | null) => (a ? actionText(a, hand, drinks, cat) : '?')
  const rows: { a: (string | number)[] | null; main: string; sub?: string; w: number }[] = []
  if (meta.votes && typeof meta.votes === 'object') {
    const v = meta.votes as Record<string, [number, number]>
    const total = Object.values(v).reduce((s, x) => s + x[0], 0) || 1
    for (const [k, [n, sc]] of Object.entries(v)) rows.push({ a: parseAction(k), main: `${n} 票`, sub: `均 ${int(sc)}`, w: n / total })
  } else if (meta.expected && typeof meta.expected === 'object') {
    const v = meta.expected as Record<string, number>
    const max = Math.max(...Object.values(v))
    for (const [k, sc] of Object.entries(v)) rows.push({ a: parseAction(k), main: int(sc), w: max ? sc / max : 0 })
  } else if (Array.isArray(meta.top)) {
    for (const [a, p] of meta.top as [(string | number)[], number][]) rows.push({ a, main: `${(p * 100).toFixed(1)}%`, w: p })
  }
  rows.sort((x, y) => y.w - x.w)
  const rest = Object.entries(meta).filter(([k]) => !['votes', 'expected', 'top'].includes(k))
  return (
    <div className="mt-3 rounded-md bg-surface-2 px-3 py-2.5">
      <p className="mb-1.5 text-[12px] font-medium text-muted">算法的说明</p>
      {rows.length > 0 && (
        <table className="w-full max-w-[560px] text-[12.5px]">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={cx(sameAction(step.action, r.a) && 'font-semibold')}>
                <td className="py-0.5 pr-3 text-ink">{label(r.a)}{sameAction(step.action, r.a) && <span className="ml-1 text-accent-ink">← 选了</span>}</td>
                <td className="w-24 py-0.5 pr-3"><span className="block h-1.5 rounded-full bg-da/70" style={{ width: `${Math.max(2, r.w * 100)}%` }} aria-hidden /></td>
                <td className="num py-0.5 text-right text-ink">{r.main}</td>
                {r.sub && <td className="num py-0.5 pl-3 text-right text-muted">{r.sub}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rest.length > 0 && (
        <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          {rest.map(([k, v]) => (
            <div key={k} className="inline-flex gap-1.5">
              <dt className="text-muted">{k}</dt>
              <dd className="num text-ink">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function MoveList({ steps, cur, go }: { steps: Step[]; cur: number; go: (i: number) => void }) {
  const cat = useCatalog()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector(`[data-i="${cur}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cur])
  const turns: { t: number; idx: number[] }[] = []
  steps.forEach((s, i) => {
    const last = turns[turns.length - 1]
    if (last && last.t === s.turn) last.idx.push(i)
    else turns.push({ t: s.turn, idx: [i] })
  })
  const types = steps[0]?.obs?.exam.types
  return (
    <div ref={ref} className="max-h-[calc(100dvh-140px)] overflow-y-auto rounded-lg border border-line lg:sticky lg:top-16">
      {turns.map((g) => (
        <div key={`${g.t}-${g.idx[0]}`}>
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-ink-2">
            回合 {g.t} {types?.[g.t - 1] && <AttrChip t={types[g.t - 1]} size="xs" />}
          </div>
          {g.idx.map((i) => {
            const s = steps[i]
            const d = s.result.delta.score ?? 0
            return (
              <button
                key={i}
                data-i={i}
                onClick={() => go(i)}
                aria-current={i === cur ? 'step' : undefined}
                className={cx('flex w-full items-baseline gap-2 border-b border-line px-3 py-1.5 text-left text-[12.5px] last:border-0', i === cur ? 'bg-accent-soft' : 'hover:bg-surface-2')}
              >
                <span className="num w-6 shrink-0 text-right text-muted">{i + 1}</span>
                <span className={cx('min-w-0 flex-1 truncate', i === cur ? 'font-medium text-ink' : 'text-ink')}>
                  {s.action[0] === 'play' && s.obs ? cardName(cat, s.obs.hand[Number(s.action[1])]?.id ?? '', s.obs.hand[Number(s.action[1])]?.u ?? 0) : actionText(s.action, s.obs?.hand ?? s.result.hand_before, s.obs?.drinks, cat)}
                </span>
                <span className={cx('num shrink-0', d > 0 ? 'text-ink' : 'text-muted')}>{d > 0 ? `+${int(d)}` : ''}</span>
                <span className={cx('num w-14 shrink-0 text-right text-[11.5px]', s.over_budget ? 'text-critical' : 'text-muted')}>{ms(s.think_ms)}</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
