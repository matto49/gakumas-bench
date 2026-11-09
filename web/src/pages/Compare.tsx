import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Episode, RunInfo, SetInfo } from '../lib/api'
import { useApi } from '../lib/hooks'
import { useCatalog, idolName } from '../lib/catalog'
import { int, ms } from '../lib/format'
import { SET_INFO, tagValueLabel } from '../lib/game'
import { ScoreChart } from '../components/Charts'
import { actionText } from '../components/GameBits'
import { cx, ErrorState, Help, PageHeader, TableSkeleton } from '../components/ui'

type RunItem = { run: string; label: string; set: string; mode?: string; algo?: { privileged?: boolean } }

const A_COLOR = 'var(--color-series-a)'
const B_COLOR = 'var(--color-series-b)'

export function Compare() {
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
      <PageHeader title="对比两个算法" sub="同一道题、同一个种子，两个算法从哪一步开始走岔、分数差在哪里。" />
      <div className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3">
        <Picker label="题集">
          <select value={set} onChange={(e) => update({ set: e.target.value, a: '', b: '', problem: '', seed: '' })} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-ink">
            <option value="">选题集</option>
            {sets.data?.map((s) => <option key={s.set} value={s.set}>{SET_INFO[s.set]?.title ?? s.set}（{s.set}）</option>)}
          </select>
        </Picker>
        <Picker label={<span className="inline-flex items-center gap-1.5"><Swatch c={A_COLOR} />算法 A</span>}>
          <RunSelect runs={runs.data} value={a} onChange={(v) => update({ a: v })} />
        </Picker>
        <Picker label={<span className="inline-flex items-center gap-1.5"><Swatch c={B_COLOR} dashed />算法 B</span>}>
          <RunSelect runs={runs.data} value={b} onChange={(v) => update({ b: v })} />
        </Picker>
        {problem && (
          <button onClick={() => update({ problem: '', seed: '' })} className="h-8 rounded-md border border-line-strong px-3 text-ink-2 hover:bg-surface-2">
            ← 回到局列表
          </button>
        )}
      </div>

      {!set && <Hint>先选一套题，再选两个算法。</Hint>}
      {set && (!a || !b) && <Hint>选两个运行。没有想比的？去 <Link to={`/sets/${set}`} className="text-accent-ink underline underline-offset-2">排行</Link> 看看有哪些。</Hint>}
      {a && b && !problem && <PairList a={a} b={b} labelA={label(a)} labelB={label(b)} onPick={(p, s) => update({ problem: p, seed: String(s) })} />}
      {a && b && problem && seed !== '' && <PairDetail a={a} b={b} labelA={label(a)} labelB={label(b)} problem={problem} seed={seed} />}
    </div>
  )
}

function Picker({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[12.5px] text-ink-2">
      {label}
      {children}
    </label>
  )
}

function Swatch({ c, dashed }: { c: string; dashed?: boolean }) {
  return (
    <svg width="16" height="6" aria-hidden>
      <line x1="1" x2="15" y1="3" y2="3" stroke={c} strokeWidth="2" strokeDasharray={dashed ? '4 2' : undefined} strokeLinecap="round" />
    </svg>
  )
}

function RunSelect({ runs, value, onChange }: { runs: RunItem[] | null; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 max-w-72 rounded-md border border-line-strong bg-surface px-2 text-ink">
      <option value="">选运行</option>
      {runs?.map((r) => <option key={r.run} value={r.run}>{r.label}{r.algo?.privileged ? '（上限）' : r.mode === 'hosted' ? '（托管）' : ''}</option>)}
    </select>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line-strong px-6 py-8 text-center text-ink-2">{children}</div>
}

function PairList({ a, b, labelA, labelB, onPick }: { a: string; b: string; labelA: string; labelB: string; onPick: (p: string, s: number) => void }) {
  const cat = useCatalog()
  const ra = useApi<RunInfo>(`api/runs/${encodeURIComponent(a)}`)
  const rb = useApi<RunInfo>(`api/runs/${encodeURIComponent(b)}`)
  const pairs = useMemo(() => {
    if (!ra.data || !rb.data) return []
    const mb = new Map(rb.data.episodes.map((e) => [`${e.problem}#${e.seed_index}`, e]))
    return ra.data.episodes
      .filter((e) => mb.has(`${e.problem}#${e.seed_index}`))
      .map((e) => {
        const o = mb.get(`${e.problem}#${e.seed_index}`)!
        return { problem: e.problem, seed: e.seed_index, tags: e.tags, sa: e.score, sb: o.score, ratio: o.score > 0 ? e.score / o.score : null }
      })
      .sort((x, y) => Math.abs(Math.log((y.ratio ?? 1) || 1e-9)) - Math.abs(Math.log((x.ratio ?? 1) || 1e-9)))
  }, [ra.data, rb.data])
  if (ra.error || rb.error) return <ErrorState error={(ra.error ?? rb.error)!} />
  if (!ra.data || !rb.data) return <TableSkeleton />
  const winA = pairs.filter((p) => p.sa > p.sb).length
  const winB = pairs.filter((p) => p.sb > p.sa).length
  return (
    <section>
      <p className="mb-3 text-ink-2">
        共有 <span className="num font-medium text-ink">{pairs.length}</span> 局同题同种子：{labelA} 高 <span className="num font-medium text-ink">{winA}</span> 局，{labelB} 高 <span className="num font-medium text-ink">{winB}</span> 局，打平 {pairs.length - winA - winB} 局。按分差从大到小排。
      </p>
      {pairs.length === 0 ? <Hint>这两个运行没有同题同种子的局。</Hint> : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[760px] border-collapse text-[13px]">
            <thead className="border-b border-line bg-surface-2 text-[12.5px] text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">题</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">种子</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{labelA}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{labelB}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">A ÷ B</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p) => (
                <tr key={`${p.problem}#${p.seed}`} onClick={() => onPick(p.problem, p.seed)} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2">
                  <td className="max-w-[360px] px-3 py-2">
                    <button className="block max-w-full truncate text-left text-ink hover:text-accent-ink">{p.problem}</button>
                    <div className="truncate text-[11.5px] text-muted">{Object.entries(p.tags ?? {}).filter(([k]) => k !== 'source').map(([k, v]) => tagValueLabel(k, String(v), (id) => idolName(cat, id))).join(' · ')}</div>
                  </td>
                  <td className="num px-3 py-2 text-ink-2">#{p.seed}</td>
                  <td className={cx('num px-3 py-2 text-right', p.sa > p.sb ? 'font-semibold text-ink' : 'text-ink-2')}>{int(p.sa)}</td>
                  <td className={cx('num px-3 py-2 text-right', p.sb > p.sa ? 'font-semibold text-ink' : 'text-ink-2')}>{int(p.sb)}</td>
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
        <h2 className="text-[16px] font-semibold break-all text-ink">{problem} <span className="text-ink-2">#{seed}</span></h2>
        <span className="inline-flex items-center gap-1.5 text-ink-2"><Swatch c={A_COLOR} />{labelA} <span className="num font-semibold text-ink">{int(ea.data.final.score)}</span></span>
        <span className="inline-flex items-center gap-1.5 text-ink-2"><Swatch c={B_COLOR} dashed />{labelB} <span className="num font-semibold text-ink">{int(eb.data.final.score)}</span></span>
        <span className="text-ink-2">
          {fork < 0 ? '两边每一步都一样。' : <>第 <span className="num font-semibold text-ink">{fork + 1}</span> 步开始走岔（回合 {A[fork]?.turn ?? B[fork]?.turn}）。</>}
        </span>
      </div>
      <div className="mb-5 rounded-lg border border-line px-3 pt-3 pb-1">
        <ScoreChart series={series} turnOf={(A.length >= B.length ? A : B).map((s) => s.turn)} types={types} current={fork >= 0 ? fork : undefined} />
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
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
                <tr key={i} className={cx('border-b border-line last:border-0', i === fork && 'bg-accent-soft', after && 'text-ink-2')}>
                  <td className="num px-3 py-1.5 text-right text-muted">{i + 1}</td>
                  <td className="px-3 py-1.5">
                    {sa ? <Link to={`/runs/${a}/${problem}/${seed}?i=${i}`} className="hover:text-accent-ink">{act(sa)}</Link> : <span className="text-muted">（已结束）</span>}
                    {i === fork && <span className="ml-2 text-[11px] font-medium text-accent-ink">走岔</span>}
                  </td>
                  <td className="num px-3 py-1.5 text-right">{sa ? int(pa) : ''}</td>
                  <td className="num px-3 py-1.5 text-right text-muted">{sa ? ms(sa.think_ms) : ''}</td>
                  <td className="px-3 py-1.5">{sb ? <Link to={`/runs/${b}/${problem}/${seed}?i=${i}`} className="hover:text-accent-ink">{act(sb)}</Link> : <span className="text-muted">（已结束）</span>}</td>
                  <td className="num px-3 py-1.5 text-right">{sb ? int(pb) : ''}</td>
                  <td className="num px-3 py-1.5 text-right text-muted">{sb ? ms(sb.think_ms) : ''}</td>
                  <td className={cx('num px-3 py-1.5 text-right', pa - pb !== 0 ? 'text-ink' : 'text-muted')}>{pa - pb > 0 ? '+' : ''}{int(pa - pb)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
