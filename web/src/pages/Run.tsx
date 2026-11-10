import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, type RunInfo } from '../lib/api'
import { useApi } from '../lib/hooks'
import { useCatalog, idolName, idolShort } from '../lib/catalog'
import { int, secs, shortCommit, when } from '../lib/format'
import { KIND_INFO, TAG_LABEL, tagValueLabel } from '../lib/game'
import { useSetTitle } from '../lib/sets'
import { StripPlot } from '../components/Charts'
import { AlgoAbout } from '../components/AlgoAbout'
import { Select } from '../components/Select'
import { cx, ErrorState, Grade, Help, IdolThumb, ModeBadge, PageHeader, TableSkeleton, TurnStrip } from '../components/ui'

type RunListItem = { run: string; label: string; set: string; kind?: string; privileged?: boolean; template_seeds?: string }

/** 同一套题、同一种种子上理论上限各局的分数（多个上限运行取最高）。固定种子和保密种子的下标是两套编号，不能混 */
export function useOracle(set: string | undefined, kind: string | undefined, tseeds: string | undefined) {
  const [oracle, setOracle] = useState<Map<string, number> | null>(null)
  useEffect(() => {
    if (!set) return
    let live = true
    api<RunListItem[]>(`api/runs?set=${encodeURIComponent(set)}`)
      .then(async (runs) => {
        const m = new Map<string, number>()
        for (const r of runs.filter((r) => r.privileged && (r.kind ?? 'fixed') === (kind ?? 'fixed') && r.template_seeds === tseeds)) {
          const info = await api<RunInfo>(`api/runs/${r.run}`)
          for (const e of info.episodes) {
            const k = `${e.id}#${e.seed_index}`
            m.set(k, Math.max(m.get(k) ?? 0, e.score))
          }
        }
        if (live) setOracle(m)
      })
      .catch(() => live && setOracle(new Map()))
    return () => {
      live = false
    }
  }, [set, kind, tseeds])
  return oracle
}

export function RunPage() {
  const setTitle = useSetTitle()
  const { run = '' } = useParams()
  const nav = useNavigate()
  const cat = useCatalog()
  const [q, setQ] = useSearchParams()
  const info = useApi<RunInfo>(`api/runs/${encodeURIComponent(run)}`)
  const oracle = useOracle(info.data?.set, info.data?.kind, info.data?.template_seeds)
  const sort = q.get('sort') ?? 'problem'
  const filters = Object.fromEntries([...q.entries()].filter(([k]) => k.startsWith('t.')).map(([k, v]) => [k.slice(2), v]))

  const eps = useMemo(() => {
    const list = (info.data?.episodes ?? []).map((e) => {
      const o = oracle?.get(`${e.id}#${e.seed_index}`)
      return { ...e, ratio: o ? e.score / o : null }
    })
    const filtered = list.filter((e) => Object.entries(filters).every(([k, v]) => String(e.tags?.[k] ?? '') === v))
    filtered.sort((a, b) =>
      sort === 'score' ? b.score - a.score :
      sort === 'ratio' ? (a.ratio ?? 9) - (b.ratio ?? 9) :
      sort === 'think' ? b.secs - a.secs :
      (a.name ?? a.id).localeCompare(b.name ?? b.id) || a.seed_index - b.seed_index,
    )
    return filtered
  }, [info.data, oracle, sort, JSON.stringify(filters)])

  if (info.error) return <ErrorState error={info.error} onRetry={info.reload} />
  if (!info.data) return <TableSkeleton rows={10} />
  const r = info.data
  const privileged = !!r.privileged
  const tagKeys = Array.from(new Set(r.episodes.flatMap((e) => Object.keys(e.tags ?? {})))).filter((k) => k !== 'source' && k !== 'produce')
  const tagValues = (k: string) => Array.from(new Set(r.episodes.map((e) => String(e.tags?.[k] ?? '')))).filter(Boolean).sort()
  const setFilter = (k: string, v: string) => {
    const n = new URLSearchParams(q)
    v ? n.set(`t.${k}`, v) : n.delete(`t.${k}`)
    setQ(n, { replace: true })
  }
  const params = r.params ? Object.entries(r.params).filter(([, v]) => v != null && v !== '') : []
  const strip = eps.filter((e) => e.ratio != null).map((e) => ({ v: e.ratio!, key: `${e.id}/${e.seed_index}`, title: `${e.name ?? e.id} #${e.seed_index}：${(e.ratio! * 100).toFixed(1)}%` }))
  const mean = eps.length ? eps.reduce((s, e) => s + e.score, 0) / eps.length : 0
  const rated = eps.filter((e) => e.ratio != null && e.ratio > 0)
  const overall = rated.length ? Math.exp(rated.reduce((s, e) => s + Math.log(e.ratio!), 0) / rated.length) : null
  const secret = !!r.template_seeds

  return (
    <div>
      <PageHeader
        crumb={<><Link to={`/sets/${r.set}${r.kind === 'template' ? (r.template_seeds ? '' : '?kind=legacy') : '?kind=fixed'}`} className="hover:text-brand-ink">算法排行 · {setTitle(r.set)}</Link> / 运行</>}
        title={<span className="inline-flex flex-wrap items-center gap-2.5">{r.label}<ModeBadge mode={r.mode} privileged={privileged} /><span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-2">{KIND_INFO[r.kind === 'template' ? (r.template_seeds ? 'template' : 'legacy') : 'fixed'].title}</span></span>}
        sub={<span className="font-mono text-[12px] text-ink-3">{r.run}</span>}
        right={!privileged && overall != null && (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2">
            <Grade ratio={overall} size={44} />
            <div>
              <p className="text-[12px] text-ink-3">相对上限</p>
              <p className="disp text-[24px] leading-none text-ink">{(overall * 100).toFixed(1)}%</p>
            </div>
          </div>
        )}
      />

      <dl className="mb-6 grid rounded-xl border border-line bg-surface px-4 py-3 grid-cols-2 gap-x-8 gap-y-3 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
        <div><dt className="text-ink-3">算法</dt><dd className="mt-0.5 font-mono text-[12px] text-ink">{r.algo}</dd></div>
        <div className="col-span-2"><dt className="text-ink-3">参数</dt><dd className="mt-0.5 font-mono text-[12px] text-ink">{params.length ? params.map(([k, v]) => `${k}=${v}`).join('  ') : '—'}</dd></div>
        <div><dt className="text-ink-3">预算</dt><dd className="num mt-0.5 text-ink">{r.step_seconds != null ? `每步 ${r.step_seconds} s` : r.seconds != null ? `开局求解 ${r.seconds} s` : r.budget != null ? `${r.budget.toLocaleString()} 步` : '—'}</dd></div>
        <div><dt className="text-ink-3">引擎</dt><dd className="num mt-0.5 text-ink">规则 v{r.engine?.rules_version ?? '?'} · {shortCommit(r.engine?.gkms_commit)}</dd></div>
        <div>
          <dt className="text-ink-3">提交（by）</dt>
          <dd className="mt-0.5 text-ink">{r.by ?? '—'} · {when(r.uploaded ?? r.finished ?? r.started)}
            {(r.claimed_mode || r.claimed_by) && (
              <Help tip={`上传时自称 ${[r.claimed_mode && `mode=${r.claimed_mode}`, r.claimed_by && `by=${r.claimed_by}`].filter(Boolean).join('、')}；服务器以令牌和核对方式为准，记为 ${r.mode}。`} />
            )}
          </dd>
        </div>
      </dl>

      <AlgoAbout about={r.about} />

      <section className="mb-6 rounded-xl border border-line bg-surface px-4 pt-3 pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-bold text-ink">
            每局相对上限
            <Help tip="每个点是一局：这局分数 ÷ 同题同种子理论上限的分数。点一下看复盘。" />
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
          <p className="py-6 text-center text-ink-2">{privileged ? '这次运行就是理论上限。' : '这套题还没有理论上限，算不出比值。'}</p>
        )}
      </section>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {tagKeys.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-ink-2">
            {TAG_LABEL[k] ?? k}
            <Select label={TAG_LABEL[k] ?? k} value={filters[k] ?? ''} onChange={(v) => setFilter(k, v)} width="16rem"
              options={[{ value: '', label: '全部' }, ...tagValues(k).map((v) => ({
                value: v,
                label: tagValueLabel(k, v, (id) => idolName(cat, id)),
                short: k === 'idol' ? idolShort(cat, v) : undefined,
                icon: k === 'idol' ? <IdolThumb id={v} size={22} title={false} className="rounded-full" /> : undefined,
              }))]} />
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-1.5 text-ink-2">
          排序
          <Select label="排序" align="end" value={sort} onChange={(v) => { const n = new URLSearchParams(q); n.set('sort', v); setQ(n, { replace: true }) }}
            options={[
              { value: 'problem', label: '按题号' },
              { value: 'ratio', label: '相对上限', hint: '低的在前' },
              { value: 'score', label: '分数', hint: '高的在前' },
              { value: 'think', label: '思考时间', hint: '长的在前' },
            ]} />
        </span>
      </div>

      {secret && <p className="mb-3 text-[12.5px] text-ink-3">保密种子：逐局复盘登录后才能看，种子和它的哈希都不公开。</p>}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[900px] border-collapse text-[13px]">
          <thead className="border-b border-line bg-surface-2 text-[12.5px] text-ink-2">
            <tr>
              <th scope="col" className="px-3 py-2.5 text-left font-semibold">题</th>
              <th scope="col" className="px-3 py-2.5 text-left font-semibold">种子 · 回合属性</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">分数</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">相对上限</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">决策</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">思考</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">超时</th>
              <th scope="col" className="px-3 py-2.5 text-left font-semibold">状态</th>
            </tr>
          </thead>
          <tbody>
            {eps.map((e) => (
              <tr key={`${e.id}#${e.seed_index}`} className="border-b border-line last:border-0 hover:bg-brand-tint">
                <td className="max-w-[360px] px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    <IdolThumb id={e.tags?.idol} size={30} />
                    <div className="min-w-0">
                      <Link to={`/runs/${run}/${e.id}/${e.seed_index}`} className="block truncate font-semibold text-ink hover:text-brand-ink">{e.name ?? e.id}</Link>
                      <div className="truncate text-[11.5px] text-ink-3">
                        {Object.entries(e.tags ?? {}).filter(([k]) => tagKeys.includes(k) && k !== 'idol').map(([k, v]) => tagValueLabel(k, String(v), (id) => idolName(cat, id))).join(' · ')}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-ink-2">
                  <div className="flex items-center gap-2.5">
                    <span className="num w-7">#{e.seed_index}</span>
                    <TurnStrip types={e.types} size="xs" />
                  </div>
                </td>
                <td className="px-3 py-2 text-right"><span className="disp text-[16px] text-ink">{int(e.score)}</span></td>
                <td className="num px-3 py-2 text-right">
                  {e.ratio != null ? <span className="inline-flex items-center justify-end gap-2"><Grade ratio={e.ratio} size={24} />{(e.ratio * 100).toFixed(1)}%</span> : <span className="text-ink-3">—</span>}
                </td>
                <td className="num px-3 py-2 text-right">{e.decisions}</td>
                <td className="num px-3 py-2 text-right">{secs(e.secs)}</td>
                <td className={cx('num px-3 py-2 text-right', e.over_steps ? 'text-ink' : 'text-ink-3')}>{e.over_steps}</td>
                <td className="px-3 py-2">
                  {e.err ? <span className="text-critical">出错</span> : e.finished ? <span className="text-ink-2">打完</span> : <span className="text-critical">没打完</span>}
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
