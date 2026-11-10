import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Episode, RunInfo, SetInfo } from '../lib/api'
import { useApi } from '../lib/hooks'
import { useCatalog, idolName } from '../lib/catalog'
import { int, ms } from '../lib/format'
import { tagValueLabel } from '../lib/game'
import { useSetTitle } from '../lib/sets'
import { ScoreChart } from '../components/Charts'
import { actionText } from '../components/GameBits'
import { Select } from '../components/Select'
import { Button } from '@/components/ui/button'
import { cx, Empty, ErrorState, Help, IdolThumb, PageHeader, TableSkeleton } from '../components/ui'

type RunItem = { run: string; label: string; set: string; mode?: string; kind?: string; privileged?: boolean; template_seeds?: string }

const A_COLOR = 'var(--color-series-a)'
const B_COLOR = 'var(--color-series-b)'

export function Compare() {
  const setTitle = useSetTitle()
  const [q, setQ] = useSearchParams()
  const a = q.get('a') ?? ''
  const b = q.get('b') ?? ''
  const problem = q.get('problem') ?? ''
  const seed = q.get('seed') ?? ''
  const runA = useApi<RunInfo>(a ? `api/runs/${encodeURIComponent(a)}` : null)
  const set = q.get('set') ?? runA.data?.set ?? ''
  const sets = useApi<SetInfo[]>('api/sets')
  const runs = useApi<RunItem[]>(set ? `api/runs?set=${encodeURIComponent(set)}` : null)
  const update = (patch: Record<string, string>) => {
    const n = new URLSearchParams(q)
    for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k))
    setQ(n)
  }
  const label = (r: string) => runs.data?.find((x) => x.run === r)?.label ?? r

  return (
    <div>
      <PageHeader title="对比" sub="同一道题、同一种牌序，看两个算法从哪一步走岔。" />
      <div className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3">
        <Picker label="题集">
          <Select label="题集" value={set} placeholder="选题集" onChange={(v) => update({ set: v, a: '', b: '', problem: '', seed: '' })}
            options={(sets.data ?? []).map((s) => ({ value: s.set, label: setTitle(s.set), icon: <IdolThumb id={s.idols?.[0]} size={22} title={false} className="rounded-full" /> }))} />
        </Picker>
        <Picker label={<span className="inline-flex items-center gap-1.5"><Swatch c={A_COLOR} />算法 A</span>}>
          <RunSelect label="算法 A" runs={runs.data} value={a} onChange={(v) => update({ a: v })} />
        </Picker>
        <Picker label={<span className="inline-flex items-center gap-1.5"><Swatch c={B_COLOR} dashed />算法 B</span>}>
          <RunSelect label="算法 B" runs={runs.data} value={b} onChange={(v) => update({ b: v })} />
        </Picker>
        {problem && (
          <Button variant="outline" size="sm" onClick={() => update({ problem: '', seed: '' })}>
            ← 回到局列表
          </Button>
        )}
      </div>

      {!set && <Empty>先选题集，再选两个算法。</Empty>}
      {set && (!a || !b) && <Empty>选两个运行。不知道选哪个？去 <Link to={`/sets/${set}`} className="text-brand-ink underline underline-offset-2">算法排行</Link> 看看。</Empty>}
      {a && b && !problem && <PairList a={a} b={b} labelA={label(a)} labelB={label(b)} onPick={(p, s) => update({ problem: p, seed: String(s) })} />}
      {a && b && problem && seed !== '' && <PairDetail a={a} b={b} labelA={label(a)} labelB={label(b)} problem={problem} seed={seed} />}
    </div>
  )
}

function Picker({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-[12.5px] text-ink-2">
      <span>{label}</span>
      {children}
    </div>
  )
}

function Swatch({ c, dashed }: { c: string; dashed?: boolean }) {
  return (
    <svg width="16" height="6" aria-hidden>
      <line x1="1" x2="15" y1="3" y2="3" stroke={c} strokeWidth="2" strokeDasharray={dashed ? '4 2' : undefined} strokeLinecap="round" />
    </svg>
  )
}

function RunSelect({ runs, value, onChange, label }: { runs: RunItem[] | null; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Select label={label} value={value} onChange={onChange} placeholder="选运行" width="18rem"
      options={(runs ?? []).map((r) => ({
        value: r.run,
        label: r.label,
        hint: [r.kind === 'template' ? (r.template_seeds ? '32 种牌序' : '旧版') : '自测', r.privileged ? '上限' : r.mode === 'hosted' ? '托管' : ''].filter(Boolean).join(' · '),
      }))} />
  )
}

function PairList({ a, b, labelA, labelB, onPick }: { a: string; b: string; labelA: string; labelB: string; onPick: (p: string, s: number) => void }) {
  const cat = useCatalog()
  const ra = useApi<RunInfo>(`api/runs/${encodeURIComponent(a)}`)
  const rb = useApi<RunInfo>(`api/runs/${encodeURIComponent(b)}`)
  const pairs = useMemo(() => {
    if (!ra.data || !rb.data) return []
    const mb = new Map(rb.data.episodes.map((e) => [`${e.id}#${e.seed_index}`, e]))
    return ra.data.episodes
      .filter((e) => mb.has(`${e.id}#${e.seed_index}`))
      .map((e) => {
        const o = mb.get(`${e.id}#${e.seed_index}`)!
        return { problem: e.id, name: e.name ?? e.id, seed: e.seed_index, tags: e.tags, sa: e.score, sb: o.score, ratio: o.score > 0 ? e.score / o.score : null }
      })
      .sort((x, y) => Math.abs(Math.log((y.ratio ?? 1) || 1e-9)) - Math.abs(Math.log((x.ratio ?? 1) || 1e-9)))
  }, [ra.data, rb.data])
  if (ra.error || rb.error) return <ErrorState error={(ra.error ?? rb.error)!} />
  if (!ra.data || !rb.data) return <TableSkeleton />
  const kindOf = (r: RunInfo) => (r.kind === 'template' ? (r.template_seeds ? 'template' : 'legacy') : 'fixed')
  if (kindOf(ra.data) === 'legacy' || kindOf(rb.data) === 'legacy') {
    return (
      <Empty>
        旧版评测每个算法打的牌序不同，同一个格子号不是同一局，没法逐局对比。
        看 <Link to={`/sets/${ra.data.set}?kind=legacy&base=${encodeURIComponent(rb.data.label)}`} className="text-brand-ink underline underline-offset-2">旧版排行</Link> 里按题平均后的比较。
      </Empty>
    )
  }
  if (kindOf(ra.data) !== kindOf(rb.data)) {
    return <Empty>一个是自测成绩、一个是排行成绩，打的不是同一批牌序。选两个同一种的运行。</Empty>
  }
  const winA = pairs.filter((p) => p.sa > p.sb).length
  const winB = pairs.filter((p) => p.sb > p.sa).length
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-xl border border-line bg-surface px-5 py-3">
        <span className="inline-flex items-baseline gap-2"><Swatch c={A_COLOR} /><span className="font-semibold text-ink">{labelA}</span> 赢 <span className="disp text-[24px] leading-none text-ink">{winA}</span> 局</span>
        <span className="inline-flex items-baseline gap-2"><Swatch c={B_COLOR} dashed /><span className="font-semibold text-ink">{labelB}</span> 赢 <span className="disp text-[24px] leading-none text-ink">{winB}</span> 局</span>
        <span className="text-ink-2">平 {pairs.length - winA - winB} 局，共 {pairs.length} 局。下面按分差从大到小排。</span>
      </div>
      {pairs.length === 0 ? <Empty>这两个运行没有同题同牌序的局。</Empty> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[760px] border-collapse text-[13px]">
            <thead className="border-b border-line bg-surface-2 text-[12.5px] text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">题</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">牌序</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{labelA}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{labelB}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">A ÷ B</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p) => (
                <tr key={`${p.problem}#${p.seed}`} onClick={() => onPick(p.problem, p.seed)} className="cursor-pointer border-b border-line last:border-0 hover:bg-brand-tint">
                  <td className="max-w-[360px] px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <IdolThumb id={p.tags?.idol} size={28} />
                      <div className="min-w-0">
                        <button className="block max-w-full truncate text-left font-semibold text-ink hover:text-brand-ink">{p.name}</button>
                        <div className="truncate text-[11.5px] text-ink-3">{Object.entries(p.tags ?? {}).filter(([k]) => k !== 'source' && k !== 'idol').map(([k, v]) => tagValueLabel(k, String(v), (id) => idolName(cat, id))).join(' · ')}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num px-3 py-2 text-ink-2">#{p.seed}</td>
                  <td className={cx('disp px-3 py-2 text-right text-[16px]', p.sa > p.sb ? 'text-ink' : 'text-ink-3')}>{int(p.sa)}</td>
                  <td className={cx('disp px-3 py-2 text-right text-[16px]', p.sb > p.sa ? 'text-ink' : 'text-ink-3')}>{int(p.sb)}</td>
                  <td className="num px-3 py-2 text-right text-ink">{p.ratio != null ? `${(p.ratio * 100).toFixed(0)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function PairDetail({ a, b, labelA, labelB, problem, seed }: { a: string; b: string; labelA: string; labelB: string; problem: string; seed: string }) {
  const cat = useCatalog()
  const ea = useApi<Episode>(`api/runs/${encodeURIComponent(a)}/episodes/${encodeURIComponent(problem)}/${seed}`)
  const eb = useApi<Episode>(`api/runs/${encodeURIComponent(b)}/episodes/${encodeURIComponent(problem)}/${seed}`)
  if (ea.error || eb.error) return <ErrorState error={(ea.error ?? eb.error)!} />
  if (!ea.data || !eb.data) return <TableSkeleton rows={10} />
  const A = ea.data.steps
  const B = eb.data.steps
  const n = Math.max(A.length, B.length)
  let fork = -1
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    if (JSON.stringify(A[i].action) !== JSON.stringify(B[i].action)) { fork = i; break }
  }
  if (fork < 0 && A.length !== B.length) fork = Math.min(A.length, B.length)
  const series = [
    { name: labelA, color: A_COLOR, points: A.map((s) => ({ x: s.i, y: Number(s.result.after.score ?? 0) })) },
    { name: labelB, color: B_COLOR, dash: true, points: B.map((s) => ({ x: s.i, y: Number(s.result.after.score ?? 0) })) },
  ]
  const types = A[0]?.obs?.exam.types
  const act = (s: (typeof A)[number] | undefined) => (s ? actionText(s.action, s.obs?.hand ?? s.result.hand_before, s.obs?.drinks, cat) : '')
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h2 className="flex items-center gap-2.5 text-[16px] font-bold break-all text-ink"><IdolThumb id={ea.data.tags?.idol} size={32} />{ea.data.name ?? problem} <span className="text-ink-2">#{seed}</span></h2>
        <span className="inline-flex items-center gap-1.5 text-ink-2"><Swatch c={A_COLOR} />{labelA} <span className="disp text-[20px] text-ink">{int(ea.data.final.score)}</span></span>
        <span className="inline-flex items-center gap-1.5 text-ink-2"><Swatch c={B_COLOR} dashed />{labelB} <span className="disp text-[20px] text-ink">{int(eb.data.final.score)}</span></span>
        <span className="text-ink-2">
          {fork < 0 ? '两边每一步都一样。' : <>第 <span className="num font-semibold text-ink">{fork + 1}</span> 步开始走岔（回合 {A[fork]?.turn ?? B[fork]?.turn}）。</>}
        </span>
      </div>
      <div className="mb-5 rounded-xl border border-line bg-surface px-3 pt-3 pb-1">
        <ScoreChart series={series} turnOf={(A.length >= B.length ? A : B).map((s) => s.turn)} types={types} current={fork >= 0 ? fork : undefined} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
          <thead className="border-b border-line bg-surface-2 text-ink-2">
            <tr>
              <th scope="col" className="w-10 px-3 py-2 text-right font-medium">步</th>
              <th scope="col" className="px-3 py-2 text-left font-medium"><span className="inline-flex items-center gap-1.5"><Swatch c={A_COLOR} />{labelA}</span></th>
              <th scope="col" className="px-3 py-2 text-right font-medium">分数</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">耗时</th>
              <th scope="col" className="px-3 py-2 text-left font-medium"><span className="inline-flex items-center gap-1.5"><Swatch c={B_COLOR} dashed />{labelB}</span></th>
              <th scope="col" className="px-3 py-2 text-right font-medium">分数</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">耗时</th>
              <th scope="col" className="px-3 py-2 text-right font-medium"><span className="inline-flex items-center">分差<Help tip="这一步之后 A 的分数减 B 的分数。走岔以后两边的局面已经不同，同一行只是同一个步数，不是同一个局面。" /></span></th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: n }, (_, i) => {
              const sa = A[i]
              const sb = B[i]
              const pa = Number(sa?.result.after.score ?? A[A.length - 1]?.result.after.score ?? 0)
              const pb = Number(sb?.result.after.score ?? B[B.length - 1]?.result.after.score ?? 0)
              const after = fork >= 0 && i > fork
              return (
                <tr key={i} className={cx('border-b border-line last:border-0', i === fork && 'bg-brand-soft', after && 'text-ink-2')}>
                  <td className="num px-3 py-1.5 text-right text-ink-3">{i + 1}</td>
                  <td className="px-3 py-1.5">
                    {sa ? <Link to={`/runs/${a}/${problem}/${seed}?i=${i}`} className="hover:text-brand-ink">{act(sa)}</Link> : <span className="text-ink-3">（已结束）</span>}
                    {i === fork && <span className="ml-2 rounded-full bg-brand-deep px-1.5 py-0.5 text-[10.5px] font-bold text-white">走岔</span>}
                  </td>
                  <td className="num px-3 py-1.5 text-right">{sa ? int(pa) : ''}</td>
                  <td className="num px-3 py-1.5 text-right text-ink-3">{sa ? ms(sa.step_ms) : ''}</td>
                  <td className="px-3 py-1.5">{sb ? <Link to={`/runs/${b}/${problem}/${seed}?i=${i}`} className="hover:text-brand-ink">{act(sb)}</Link> : <span className="text-ink-3">（已结束）</span>}</td>
                  <td className="num px-3 py-1.5 text-right">{sb ? int(pb) : ''}</td>
                  <td className="num px-3 py-1.5 text-right text-ink-3">{sb ? ms(sb.step_ms) : ''}</td>
                  <td className={cx('num px-3 py-1.5 text-right', pa - pb !== 0 ? 'text-ink' : 'text-ink-3')}>{pa - pb > 0 ? '+' : ''}{int(pa - pb)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
