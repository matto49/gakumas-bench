import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, type RunInfo } from '../lib/api'
import { useApi } from '../lib/hooks'
import { useCatalog, idolName } from '../lib/catalog'
import { int, secs, shortCommit, when } from '../lib/format'
import { SET_INFO, TAG_LABEL, tagValueLabel } from '../lib/game'
import { StripPlot } from '../components/Charts'
import { cx, ErrorState, Help, ModeBadge, PageHeader, TableSkeleton } from '../components/ui'

type RunListItem = { run: string; label: string; set: string; algo?: { privileged?: boolean } }

/** 同一套题上理论上限各局的分数（多个上限运行取最高） */
function useOracle(set: string | undefined) {
  const [oracle, setOracle] = useState<Map<string, number> | null>(null)
  useEffect(() => {
    if (!set) return
    let live = true
    api<RunListItem[]>(`api/runs?set=${encodeURIComponent(set)}`)
      .then(async (runs) => {
        const m = new Map<string, number>()
        for (const r of runs.filter((r) => r.algo?.privileged)) {
          const info = await api<RunInfo>(`api/runs/${r.run}`)
          for (const e of info.episodes) {
            const k = `${e.problem}#${e.seed_index}`
            m.set(k, Math.max(m.get(k) ?? 0, e.score))
          }
        }
        if (live) setOracle(m)
      })
      .catch(() => live && setOracle(new Map()))
    return () => {
      live = false
    }
  }, [set])
  return oracle
}

export function RunPage() {
  const { run = '' } = useParams()
  const nav = useNavigate()
  const cat = useCatalog()
  const [q, setQ] = useSearchParams()
  const info = useApi<RunInfo>(`api/runs/${encodeURIComponent(run)}`)
  const oracle = useOracle(info.data?.set)
  const sort = q.get('sort') ?? 'problem'
  const filters = Object.fromEntries([...q.entries()].filter(([k]) => k.startsWith('t.')).map(([k, v]) => [k.slice(2), v]))

  const eps = useMemo(() => {
    const list = (info.data?.episodes ?? []).map((e) => {
      const o = oracle?.get(`${e.problem}#${e.seed_index}`)
      return { ...e, ratio: o ? e.score / o : null }
    })
    const filtered = list.filter((e) => Object.entries(filters).every(([k, v]) => String(e.tags?.[k] ?? '') === v))
    filtered.sort((a, b) =>
      sort === 'score' ? b.score - a.score :
      sort === 'ratio' ? (a.ratio ?? 9) - (b.ratio ?? 9) :
      sort === 'think' ? b.think_s - a.think_s :
      a.problem.localeCompare(b.problem) || a.seed_index - b.seed_index,
    )
    return filtered
  }, [info.data, oracle, sort, JSON.stringify(filters)])

  if (info.error) return <ErrorState error={info.error} onRetry={info.reload} />
  if (!info.data) return <TableSkeleton rows={10} />
  const r = info.data
  const privileged = !!r.algo?.privileged
  const tagKeys = Array.from(new Set(r.episodes.flatMap((e) => Object.keys(e.tags ?? {})))).filter((k) => k !== 'source' && k !== 'produce')
  const tagValues = (k: string) => Array.from(new Set(r.episodes.map((e) => String(e.tags?.[k] ?? '')))).filter(Boolean).sort()
  const setFilter = (k: string, v: string) => {
    const n = new URLSearchParams(q)
    v ? n.set(`t.${k}`, v) : n.delete(`t.${k}`)
    setQ(n, { replace: true })
  }
  const params = r.algo?.params ? Object.entries(r.algo.params).filter(([, v]) => v != null && v !== '') : []
  const strip = eps.filter((e) => e.ratio != null).map((e) => ({ v: e.ratio!, key: `${e.problem}/${e.seed_index}`, title: `${e.problem} #${e.seed_index}：${(e.ratio! * 100).toFixed(1)}%` }))
  const mean = eps.length ? eps.reduce((s, e) => s + e.score, 0) / eps.length : 0

  return (
    <div>
      <p className="mb-2 text-[12.5px] text-muted">
        <Link to={`/sets/${r.set}`} className="hover:text-ink">排行 · {SET_INFO[r.set]?.title ?? r.set}</Link> / 运行
      </p>
      <PageHeader
        title={<span className="inline-flex items-center gap-2.5">{r.label}<ModeBadge mode={r.mode} privileged={privileged} /></span>}
        sub={<span className="font-mono text-[12px] text-muted">{r.run}</span>}
      />

      <dl className="mb-6 grid grid-cols-2 gap-x-8 gap-y-3 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
        <div><dt className="text-muted">算法</dt><dd className="mt-0.5 text-ink">{r.algo?.name}{r.algo?.model_file ? ` · ${r.algo.model_file}` : ''}</dd></div>
        <div className="col-span-2"><dt className="text-muted">参数</dt><dd className="mt-0.5 font-mono text-[12px] text-ink">{params.length ? params.map(([k, v]) => `${k}=${v}`).join('  ') : '—'}</dd></div>
        <div><dt className="text-muted">每步预算</dt><dd className="num mt-0.5 text-ink">{r.budget_s != null ? `${r.budget_s} s` : '—'}</dd></div>
        <div><dt className="text-muted">引擎</dt><dd className="num mt-0.5 text-ink">规则 v{r.engine?.rules_version ?? '?'} · {shortCommit(r.engine?.gkms_commit)}</dd></div>
        <div>
          <dt className="text-muted">{r.mode === 'hosted' ? '托管' : '上传'}</dt>
          <dd className="mt-0.5 text-ink">{r.uploader ?? '—'} · {when(r.uploaded ?? r.finished ?? r.started)}</dd>
        </div>
      </dl>

      <section className="mb-6 rounded-lg border border-line px-4 pt-3 pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-semibold text-ink">
            每局相对上限
            <Help tip="每个点是一局：这局分数 ÷ 同题同种子理论上限的分数。点一下进入复盘。" />
          </h2>
          <p className="num text-[12.5px] text-ink-2">
            {eps.length} 局 · 平均分 {int(mean)}
            {r.verified && ` · 核对收下 ${r.verified.accepted}，拒收 ${r.verified.rejected}`}
          </p>
        </div>
        {oracle == null ? (
          <div className="skeleton my-3 h-16" />
        ) : strip.length ? (
          <StripPlot values={strip} label="每局相对上限的分布" onPick={(k) => nav(`/runs/${run}/${k}`)} />
        ) : (
          <p className="py-6 text-center text-ink-2">{privileged ? '这次运行本身就是理论上限。' : '这套题还没有理论上限的成绩，暂时算不出比值。'}</p>
        )}
      </section>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {tagKeys.map((k) => (
          <label key={k} className="inline-flex items-center gap-1.5 text-ink-2">
            {TAG_LABEL[k] ?? k}
            <select value={filters[k] ?? ''} onChange={(e) => setFilter(k, e.target.value)} className="h-8 max-w-48 rounded-md border border-line-strong bg-surface px-2 text-ink">
              <option value="">全部</option>
              {tagValues(k).map((v) => <option key={v} value={v}>{tagValueLabel(k, v, (id) => idolName(cat, id))}</option>)}
            </select>
          </label>
        ))}
        <label className="ml-auto inline-flex items-center gap-1.5 text-ink-2">
          排序
          <select value={sort} onChange={(e) => { const n = new URLSearchParams(q); n.set('sort', e.target.value); setQ(n, { replace: true }) }} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-ink">
            <option value="problem">按题号</option>
            <option value="ratio">相对上限，低的在前</option>
            <option value="score">分数，高的在前</option>
            <option value="think">思考时间，长的在前</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead className="border-b border-line bg-surface-2 text-[12.5px] text-ink-2">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">题</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">种子</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">分数</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">相对上限</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">决策</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">思考</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">超时</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {eps.map((e) => (
              <tr key={`${e.problem}#${e.seed_index}`} className="border-b border-line last:border-0 hover:bg-surface-2">
                <td className="max-w-[380px] px-3 py-2">
                  <Link to={`/runs/${run}/${e.problem}/${e.seed_index}`} className="block truncate text-ink hover:text-accent-ink hover:underline hover:underline-offset-2">{e.problem}</Link>
                  <div className="truncate text-[11.5px] text-muted">
                    {Object.entries(e.tags ?? {}).filter(([k]) => tagKeys.includes(k)).map(([k, v]) => tagValueLabel(k, String(v), (id) => idolName(cat, id))).join(' · ')}
                  </div>
                </td>
                <td className="num px-3 py-2 text-ink-2">#{e.seed_index}</td>
                <td className="num px-3 py-2 text-right text-ink">{int(e.score)}</td>
                <td className="num px-3 py-2 text-right">{e.ratio != null ? `${(e.ratio * 100).toFixed(1)}%` : <span className="text-muted">—</span>}</td>
                <td className="num px-3 py-2 text-right">{e.decisions}</td>
                <td className="num px-3 py-2 text-right">{secs(e.think_s)}</td>
                <td className={cx('num px-3 py-2 text-right', e.over_budget_steps ? 'text-ink' : 'text-muted')}>{e.over_budget_steps}</td>
                <td className="px-3 py-2">
                  {e.error ? <span className="text-critical">出错</span> : e.finished ? <span className="text-ink-2">打完</span> : <span className="text-critical">没打完</span>}
                </td>
              </tr>
            ))}
            {eps.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-ink-2">没有符合筛选的局。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
