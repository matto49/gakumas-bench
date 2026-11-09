import { useMemo } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { useApi } from '../lib/hooks'
import type { Row, SetInfo } from '../lib/api'
import { useCatalog, idolName } from '../lib/catalog'
import { compact, int, ms, secs } from '../lib/format'
import { SET_INFO, TAG_LABEL, tagValueLabel } from '../lib/game'
import { cx, ErrorState, Help, ModeBadge, PageHeader, RatioBar, RatioText, TableSkeleton, Tip } from '../components/ui'

type SortKey = 'oracle' | 'base' | 'mean' | 'p50' | 'n' | 'label'

const GROUPS_BY_SET: Record<string, string[]> = {
  gkms480: ['mechanic', 'stage', 'idol', 'deck'],
  'hif-live': ['round', 'produce'],
}

// 顺序色阶（单一蓝色，浅到深），只作格子底色；数字始终用正文色
const SEQ = ['#eef4fd', '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef']

function sortValue(r: Row, k: SortKey): number | string {
  switch (k) {
    case 'oracle':
      return r.vs_oracle?.geo ?? -1
    case 'base':
      return r.vs_base?.geo ?? -1
    case 'mean':
      return r.mean
    case 'p50':
      return r.p50_ms
    case 'n':
      return r.n
    case 'label':
      return r.label
  }
}

function SortHead({ k, children, sort, dir, onSort, align = 'right', help }: { k: SortKey; children: React.ReactNode; sort: SortKey; dir: 'asc' | 'desc'; onSort: (k: SortKey) => void; align?: 'left' | 'right'; help?: React.ReactNode }) {
  const active = sort === k
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown
  return (
    <th scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cx('px-3 py-2 font-medium', align === 'right' ? 'text-right' : 'text-left')}>
      <span className={cx('inline-flex items-center', align === 'right' && 'justify-end')}>
        <button type="button" onClick={() => onSort(k)} className={cx('inline-flex items-center gap-1 rounded hover:text-ink', active ? 'text-ink' : 'text-ink-2')}>
          {children}
          <Icon size={12} className={active ? 'text-accent-ink' : 'text-muted'} aria-hidden />
        </button>
        {help && <Help tip={help} />}
      </span>
    </th>
  )
}

export function Leaderboard() {
  const { set } = useParams()
  const [q, setQ] = useSearchParams()
  const cat = useCatalog()
  const sets = useApi<SetInfo[]>('api/sets')
  const base = q.get('base') ?? ''
  const group = q.get('group') ?? ''
  const sort = (q.get('sort') as SortKey) ?? 'oracle'
  const dir = (q.get('dir') as 'asc' | 'desc') ?? (sort === 'p50' || sort === 'label' ? 'asc' : 'desc')
  const lb = useApi<Row[]>(set ? `api/leaderboard?set=${encodeURIComponent(set)}&base=${encodeURIComponent(base)}&group=${encodeURIComponent(group)}` : null)

  const update = (patch: Record<string, string>) => {
    const n = new URLSearchParams(q)
    for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k))
    setQ(n, { replace: true })
  }
  const onSort = (k: SortKey) => {
    const nextDir = sort === k ? (dir === 'asc' ? 'desc' : 'asc') : k === 'p50' || k === 'label' ? 'asc' : 'desc'
    update({ sort: k, dir: nextDir })
  }

  const rows = useMemo(() => {
    const rs = [...(lb.data ?? [])]
    const sign = dir === 'asc' ? 1 : -1
    rs.sort((a, b) => {
      if (a.privileged !== b.privileged) return a.privileged ? 1 : -1
      const va = sortValue(a, sort)
      const vb = sortValue(b, sort)
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * sign
      return (va - vb) * sign
    })
    return rs
  }, [lb.data, sort, dir])

  if (!set) {
    if (sets.data?.length) return <Navigate to={`/sets/${sets.data[0].set}`} replace />
    if (sets.error) return <ErrorState error={sets.error} onRetry={sets.reload} />
    return <TableSkeleton />
  }

  const info = sets.data?.find((s) => s.set === set)
  const hasOracle = rows.some((r) => r.privileged)
  const groups = GROUPS_BY_SET[set] ?? ['idol']
  const labels = Array.from(new Set(rows.filter((r) => !r.privileged).map((r) => r.label)))
  let rank = 0

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-line" role="tablist" aria-label="题集">
        {sets.data?.map((s) => (
          <Link
            key={s.set}
            to={`/sets/${s.set}`}
            role="tab"
            aria-selected={s.set === set}
            className={cx('-mb-px border-b-2 px-3 py-2 text-[13.5px]', s.set === set ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink')}
          >
            {SET_INFO[s.set]?.title ?? s.set}
            <span className="ml-1.5 text-[12px] text-muted">{s.set}</span>
          </Link>
        ))}
      </div>

      <PageHeader
        title={`排行 · ${SET_INFO[set]?.title ?? set}`}
        sub={
          <>
            {SET_INFO[set]?.blurb}
            {info && (
              <span className="num ml-1 text-muted">
                {info.problems} 题，开发集 {info.seeds.dev} 个种子{info.seeds.test ? `、测试集 ${info.seeds.test} 个` : ''}。
                {info.public_seeds ? '开发集种子公开下载。' : ''}
              </span>
            )}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="inline-flex items-center gap-2 text-ink-2">
          基准
          <select value={base} onChange={(e) => update({ base: e.target.value })} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-ink">
            <option value="">不比较</option>
            {labels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <Help tip="选一个算法作基准，表里多出「相对基准」和胜率：同题同种子对它的分数比。" />
        </label>
        <label className="inline-flex items-center gap-2 text-ink-2">
          分组
          <select value={group} onChange={(e) => update({ group: e.target.value })} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-ink">
            <option value="">不分组</option>
            {groups.map((g) => (
              <option key={g} value={g}>按{TAG_LABEL[g] ?? g}</option>
            ))}
          </select>
        </label>
      </div>

      {lb.error && <ErrorState error={lb.error} onRetry={lb.reload} />}
      {lb.loading && !lb.data && <TableSkeleton />}
      {lb.data && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
          <p className="font-medium text-ink">这套题还没有成绩。</p>
          <p className="mt-1 text-ink-2">
            跑一次并上传：<code className="font-mono text-[12px]">python -m gkbench run --set {set} --algo greedy</code>，详见 <Link to="/#join" className="text-accent-ink underline underline-offset-2">怎么参与</Link>。
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[980px] border-collapse text-[13px]">
            <thead className="border-b border-line bg-surface-2 text-[12.5px]">
              <tr>
                <th scope="col" className="w-10 px-3 py-2 text-right font-medium text-ink-2">#</th>
                <SortHead k="label" sort={sort} dir={dir} onSort={onSort} align="left">算法</SortHead>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink-2">方式</th>
                {hasOracle && (
                  <SortHead k="oracle" sort={sort} dir={dir} onSort={onSort} help="同题同种子，对「看种子」理论上限的分数比，取几何平均；± 是标准误。100% 表示和知道答案的搜索打得一样高。">
                    相对上限
                  </SortHead>
                )}
                {base && (
                  <SortHead k="base" sort={sort} dir={dir} onSort={onSort} help={`同题同种子对 ${base} 的分数比（几何平均 ± 标准误），后面是胜率（平局算半场）。`}>
                    相对 {base}
                  </SortHead>
                )}
                <SortHead k="mean" sort={sort} dir={dir} onSort={onSort}>平均分</SortHead>
                <SortHead k="p50" sort={sort} dir={dir} onSort={onSort} help="每一步思考时间的中位数，斜杠后是 95 分位。托管跑以服务器计时为准。理论上限在开局一次算完，所以每步接近 0。">
                  每步耗时
                </SortHead>
                <th scope="col" className="px-3 py-2 text-right font-medium text-ink-2">每局思考</th>
                <SortHead k="n" sort={sort} dir={dir} onSort={onSort}>局数</SortHead>
                <th scope="col" className="px-3 py-2 text-right font-medium text-ink-2">
                  <span className="inline-flex items-center">超时 / 出错<Help tip="超时：这一步思考超过预算的 1.2 倍再加 50 ms。出错：算法抛了异常，这局按当时的分数结束。" /></span>
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-ink-2">规则</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                if (!r.privileged) rank++
                const params = r.algo?.params ? Object.entries(r.algo.params).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${v}`).join(' ') : ''
                return (
                  <tr key={r.run} className={cx('border-b border-line last:border-0 hover:bg-surface-2', r.privileged && 'bg-surface-2/60 text-ink-2')}>
                    <td className="num px-3 py-2.5 text-right text-muted">{r.privileged ? '' : rank}</td>
                    <td className="max-w-[300px] px-3 py-2.5">
                      <Link to={`/runs/${r.run}`} className="font-medium text-ink hover:text-accent-ink hover:underline hover:underline-offset-2">
                        {r.label}
                      </Link>
                      <div className="truncate text-[11.5px] text-muted">
                        {r.algo?.name}
                        {params && ` · ${params}`}
                        {r.uploader && ` · ${r.uploader}`}
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><ModeBadge mode={r.mode} privileged={r.privileged} /></td>
                    {hasOracle && <td className="px-3 py-2.5 text-right">
                      {r.privileged ? <span className="text-muted">分母</span> : (
                        <span className="inline-flex items-center gap-2.5">
                          <RatioBar r={r.vs_oracle} />
                          <RatioText r={r.vs_oracle} strong />
                        </span>
                      )}
                    </td>}
                    {base && (
                      <td className="px-3 py-2.5 text-right">
                        <RatioText r={r.vs_base} />
                        {r.vs_base && <span className="num ml-2 text-[12px] text-muted">胜 {(r.vs_base.win * 100).toFixed(0)}%</span>}
                      </td>
                    )}
                    <td className="num px-3 py-2.5 text-right text-ink">{int(r.mean)}</td>
                    <td className="num px-3 py-2.5 text-right whitespace-nowrap">
                      {ms(r.p50_ms)} <span className="text-muted">/ {ms(r.p95_ms)}</span>
                    </td>
                    <td className="num px-3 py-2.5 text-right">{secs(r.ep_think_s)}</td>
                    <td className="num px-3 py-2.5 text-right">{r.n}</td>
                    <td className="num px-3 py-2.5 text-right">
                      <span className={r.over ? 'text-ink' : 'text-muted'}>{r.over}</span>
                      <span className="text-muted"> / </span>
                      <span className={r.errors + r.unfinished ? 'font-medium text-critical' : 'text-muted'}>{r.errors + r.unfinished}</span>
                    </td>
                    <td className="num px-3 py-2.5 text-right text-muted">
                      <Tip tip={`GKMS ${r.engine?.gkms_commit?.slice(0, 8) ?? '?'}，规则版本 ${r.engine?.rules_version ?? '?'}`}>
                        <span tabIndex={0}>v{r.engine?.rules_version ?? '?'}</span>
                      </Tip>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {group && rows.length > 0 && <GroupMatrix rows={rows} group={group} hasOracle={hasOracle} base={base} idol={(id) => idolName(cat, id)} />}

      <section className="mt-8 grid max-w-[980px] gap-x-10 gap-y-3 text-[12.5px] leading-relaxed text-ink-2 sm:grid-cols-2">
        <p><span className="font-medium text-ink">配对比较。</span>所有比值都是同一道题、同一个种子上两局的分数比，再取几何平均；不是平均分之比。样本数和标准误跟着数字走。</p>
        <p><span className="font-medium text-ink">三种方式。</span>托管：种子不离开服务器；自报：本地跑完上传、服务器重放核对过；上限：看种子的搜索，只作分母。</p>
        <p><span className="font-medium text-ink">引擎版本。</span>规则版本不同的成绩不能直接比；引擎更新后，旧成绩可以按新规则重放重算。</p>
        <p><span className="font-medium text-ink">时间预算。</span>每次运行声明每步预算，超过预算 1.2 倍的步数单独记在「超时」里，不扣分，但会显示。</p>
      </section>
    </div>
  )
}

function GroupMatrix({ rows, group, hasOracle, base, idol }: { rows: Row[]; group: string; hasOracle: boolean; base: string; idol: (id: string) => string }) {
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r.groups ?? {})))).sort()
  const metric = hasOracle ? 'vs_oracle' : base ? 'vs_base' : 'mean'
  const vals = rows.filter((r) => !r.privileged).flatMap((r) => keys.map((k) => {
    const g = r.groups?.[k]
    return metric === 'mean' ? g?.mean ?? null : (g?.[metric as 'vs_oracle'] as { geo: number } | null | undefined)?.geo ?? null
  })).filter((v): v is number => v != null)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const tint = (v: number | null) => (v == null || hi === lo ? undefined : SEQ[Math.min(SEQ.length - 1, Math.floor(((v - lo) / (hi - lo)) * SEQ.length))])
  return (
    <section className="mt-8">
      <h2 className="mb-1 text-[15px] font-semibold text-ink">按{TAG_LABEL[group] ?? group}分组</h2>
      <p className="mb-3 text-[12.5px] text-ink-2">
        格子里是{metric === 'vs_oracle' ? '相对上限' : metric === 'vs_base' ? `相对 ${base}` : '平均分'}，底色越深越高（只作辅助，以数字为准）。悬停看局数和标准误。
      </p>
      <div className="inline-block max-w-full overflow-x-auto rounded-lg border border-line align-top">
        <table className="border-collapse text-[12.5px]">
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className="sticky left-0 bg-surface-2 px-3 py-2 text-left font-medium text-ink-2">算法</th>
              {keys.map((k) => (
                <th key={k} scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap text-ink-2">{tagValueLabel(group, k, idol)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.filter((r) => !r.privileged).map((r) => (
              <tr key={r.run} className="border-t border-line">
                <th scope="row" className="sticky left-0 bg-surface px-3 py-2 text-left font-medium whitespace-nowrap text-ink">{r.label}</th>
                {keys.map((k) => {
                  const g = r.groups?.[k]
                  const ratio = metric === 'mean' ? null : (g?.[metric as 'vs_oracle'] ?? null)
                  const v = metric === 'mean' ? g?.mean ?? null : ratio?.geo ?? null
                  return (
                    <td key={k} className="num border-l border-surface px-3 py-2 text-right text-ink" style={{ background: tint(v) }}>
                      {v == null ? <span className="text-muted">—</span> : (
                        <Tip tip={ratio ? `${ratio.n} 局，±${(ratio.se * 100).toFixed(1)}%` : `${g?.n ?? 0} 局`}>
                          <span tabIndex={0}>{metric === 'mean' ? compact(v) : `${(v * 100).toFixed(1)}%`}</span>
                        </Tip>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
