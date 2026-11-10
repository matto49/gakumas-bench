import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, GitCompareArrows } from 'lucide-react'
import { BASE, type Card, type Episode, type Obs, type RunInfo, type Step } from '../lib/api'
import { useApi } from '../lib/hooks'
import { useCatalog, idolName, cardName } from '../lib/catalog'
import { int, ms } from '../lib/format'
import { PLAN, PRODUCE, STANCE, ROUND } from '../lib/game'
import { ScoreChart } from '../components/Charts'
import { actionText, DrinkChip, EnchantChip, SkillCard, StatusChip } from '../components/GameBits'
import { AttrChip, btn, cx, ErrorState, Grade, Help, IdolThumb, TableSkeleton, TurnStrip } from '../components/ui'
import { useOracle } from './Run'

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
  const runInfo = useApi<RunInfo>(`api/runs/${encodeURIComponent(run)}`)
  const oracle = useOracle(runInfo.data?.set, runInfo.data?.kind, runInfo.data?.template_seeds)
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
    () => [{ name: '分数', color: 'var(--color-brand-deep)', points: steps.map((s) => ({ x: s.i, y: Number(s.result.after.score ?? 0), label: actionText(s.action, s.obs?.hand ?? s.result.hand_before, s.obs?.drinks, cat) })) }],
    [steps, cat],
  )

  if (ep.error) return <ErrorState error={ep.error} onRetry={ep.reload} />
  if (!ep.data) return <TableSkeleton rows={12} />
  const e = ep.data
  const s = steps[cur]
  const obs0 = steps[0]?.obs
  const types = obs0?.exam.types

  const idol = obs0?.exam.idol ?? e.tags?.idol
  const best = oracle?.get(`${e.id}#${e.seed_index}`)
  const ratio = best ? e.final.score / best : null
  return (
    <div>
      <p className="mb-3 text-[12.5px] text-ink-3">
        <Link to={`/sets/${e.set}`} className="hover:text-brand-ink">算法排行</Link> / <Link to={`/runs/${run}`} className="hover:text-brand-ink">{runInfo.data?.label ?? run}</Link> / 复盘
      </p>
      <header className="mb-5 overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="stripes flex flex-wrap items-center gap-4 bg-brand-deep px-5 py-3.5 text-white">
          <IdolThumb id={idol} size={52} className="ring-2 ring-white/70" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[19px] font-bold">{idol ? idolName(cat, idol) : e.name ?? problem}</h1>
            <p className="text-[12.5px] text-white/90">
              {[obs0 && PLAN[String(obs0.exam.plan)], obs0 && (PRODUCE[obs0.exam.produce] ?? obs0.exam.produce), e.meta.round_label && (ROUND[e.meta.round_label] ?? e.meta.round_label), `${e.name ?? problem} #${seed}`].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {ratio != null && <Grade ratio={ratio} size={48} />}
            <div className="text-right">
              <p className="text-[11.5px] text-white/85">{runInfo.data?.label ?? '终局'}{best ? ` · 上限 ${int(best)}` : ''}</p>
              <p className="disp text-[32px] leading-none">{int(e.final.score)}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-2.5 text-[12.5px] text-ink-2">
          <TurnStrip types={types} current={s?.turn} />
          <span className="num">{e.final.decisions} 个决策 · 思考 {(e.final.secs ?? 0).toFixed(1)} s</span>
          {e.err && <span className="text-critical">{e.err}</span>}
          <Link to={`/compare?a=${encodeURIComponent(run)}&problem=${encodeURIComponent(problem)}&seed=${seed}`} className={cx(btn.small, 'ml-auto')}>
            <GitCompareArrows size={14} aria-hidden /> 和别的算法对比
          </Link>
        </div>
      </header>

      <SaveInfo e={e} />

      <section className="mb-5 rounded-xl border border-line bg-surface px-3 pt-3 pb-1">
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
  const b = 'inline-grid size-8 place-items-center rounded-full border border-line-strong bg-surface text-ink-2 transition-colors duration-150 hover:border-brand hover:text-brand-ink disabled:opacity-40'
  return (
    <div className="mb-3 flex items-center gap-1.5">
      <button className={b} onClick={() => go(0)} disabled={cur === 0} aria-label="第一步"><ChevronsLeft size={16} /></button>
      <button className={b} onClick={() => go(cur - 1)} disabled={cur === 0} aria-label="上一步"><ChevronLeft size={16} /></button>
      <span className="num min-w-24 text-center text-ink">第 {cur + 1} / {total} 步</span>
      <button className={b} onClick={() => go(cur + 1)} disabled={cur >= total - 1} aria-label="下一步"><ChevronRight size={16} /></button>
      <button className={b} onClick={() => go(total - 1)} disabled={cur >= total - 1} aria-label="最后一步"><ChevronsRight size={16} /></button>
      <span className="ml-2 text-[12px] text-ink-3">键盘 ← → 翻步</span>
    </div>
  )
}

function Section({ title, children, help }: { title: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="border-t border-line py-3 first:border-0 first:pt-0">
      <h3 className="mb-2 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-ink-2"><span className="inline-block h-3 w-[3px] -skew-x-12 rounded-sm bg-brand" aria-hidden />{title}{help && <Help tip={help} />}</h3>
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
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      {o && (
        <Section title="局面（这一步之前）">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="inline-flex items-center gap-2 text-ink">
              <span className="num font-semibold">回合 {o.exam.turn} / {o.exam.limit}</span>
              {attr && <AttrChip t={attr} />}
              <span className="num text-[12px] text-ink-3">倍率 {o.exam.permil.map((p) => (p / 1000).toFixed(1)).join(' / ')}</span>
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
          <span className="font-mono text-[12px] text-ink-3">{step.token}</span>
          <span className={cx('num text-[12.5px]', step.over ? 'font-medium text-critical' : 'text-ink-2')}>
            思考 {ms(step.step_ms)}{step.over && '（超时）'}
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
      <span className="text-[12px] text-ink-3">{label}</span>
      <span className="num font-semibold text-ink">{typeof v === 'number' ? int(v) : v}</span>
    </span>
  )
}

function Piles({ obs }: { obs: Obs }) {
  const piles: [string, typeof obs.deck][] = [['山札', obs.deck], ['捨て札', obs.grave], ['保留', obs.hold], ['除外', obs.lost], ['本回合已出', obs.played]]
  return (
    <div className="space-y-1">
      {piles.map(([name, cards]) => (
        <details key={name} className="group/pile">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded px-1 py-1 text-ink-2 hover:bg-surface-2">
            <ChevronRight size={13} className="transition-transform duration-150 group-open/pile:rotate-90" aria-hidden />
            <span className="text-ink">{name}</span>
            <span className="num text-ink-3">{cards.length} 张</span>
          </summary>
          <div className="flex flex-wrap gap-2 py-2 pl-6">
            {cards.length ? cards.map((c, i) => <SkillCard key={i} card={c} size={40} />) : <span className="text-[12px] text-ink-3">空</span>}
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
    <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2.5">
      <p className="mb-1.5 text-[12px] font-medium text-ink-3">算法的说明</p>
      {rows.length > 0 && (
        <table className="w-full max-w-[560px] text-[12.5px]">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={cx(sameAction(step.action, r.a) && 'font-semibold')}>
                <td className="py-0.5 pr-3 text-ink">{label(r.a)}{sameAction(step.action, r.a) && <span className="ml-1 text-brand-ink">← 选了</span>}</td>
                <td className="w-24 py-0.5 pr-3"><span className="block h-1.5 rounded-full bg-brand" style={{ width: `${Math.max(2, r.w * 100)}%` }} aria-hidden /></td>
                <td className="num py-0.5 text-right text-ink">{r.main}</td>
                {r.sub && <td className="num py-0.5 pl-3 text-right text-ink-3">{r.sub}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rest.length > 0 && (
        <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          {rest.map(([k, v]) => (
            <div key={k} className="inline-flex gap-1.5">
              <dt className="text-ink-3">{k}</dt>
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
    <div ref={ref} className="max-h-[calc(100dvh-140px)] overflow-y-auto rounded-xl border border-line bg-surface lg:sticky lg:top-20">
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
                className={cx('flex w-full items-baseline gap-2 border-b border-line px-3 py-1.5 text-left text-[12.5px] last:border-0', i === cur ? 'bg-brand-soft' : 'hover:bg-surface-2')}
              >
                <span className="num w-6 shrink-0 text-right text-ink-3">{i + 1}</span>
                <span className={cx('min-w-0 flex-1 truncate', i === cur ? 'font-medium text-ink' : 'text-ink')}>
                  {s.action[0] === 'play' && s.obs ? cardName(cat, s.obs.hand[Number(s.action[1])]?.id ?? '', s.obs.hand[Number(s.action[1])]?.u ?? 0) : actionText(s.action, s.obs?.hand ?? s.result.hand_before, s.obs?.drinks, cat)}
                </span>
                <span className={cx('num shrink-0', d > 0 ? 'text-ink' : 'text-ink-3')}>{d > 0 ? `+${int(d)}` : ''}</span>
                <span className={cx('num w-14 shrink-0 text-right text-[11.5px]', s.over ? 'text-critical' : 'text-ink-3')}>{ms(s.step_ms)}</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** 这一局在审查存档里的位置：题模板、指定牌序的题（存档格式里叫固定种子题）、题族，路线记号串，存档下载 */
function SaveInfo({ e }: { e: Episode }) {
  const saveId = e.fixed_id ?? e.id
  return (
    <section className="mb-5 rounded-xl border border-line bg-surface px-4 py-3 text-[12.5px]">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
        <span className="inline-flex items-center text-ink-3">
          审查存档
          <Help tip="题和答按 gkms.audition_save.v2 存：题模板只有开局，不定牌序；指定了牌序的题另有编号；同一开局共用题族编号。这一局的路线是第 3 章的记号串，能在任何实现了这个格式的引擎上重放。" />
        </span>
        <span>题模板 <code className="font-mono text-ink">{e.id}</code></span>
        {e.fixed_id && <span>指定牌序的题 <code className="font-mono text-ink">{e.fixed_id}</code></span>}
        {e.family && <span>题族 <code className="font-mono text-ink">{e.family}</code></span>}
        {e.exam_sha && <span>exam_sha <code className="font-mono text-ink-2">{e.exam_sha}</code></span>}
        <a href={`${BASE}api/saves/${saveId}?download=1`} className="ml-auto inline-flex items-center gap-1 font-semibold text-brand-ink hover:underline">
          <Download size={13} aria-hidden /> 下载存档（含所有答）
        </a>
      </div>
      <p className="mt-2 break-all font-mono text-[12px] leading-relaxed text-ink-2">
        <span className="mr-2 font-sans text-ink-3">路线</span>{e.route}
      </p>
    </section>
  )
}
