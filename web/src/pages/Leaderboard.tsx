import { useMemo } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { useApi } from '../lib/hooks'
import type { Row, SetInfo } from '../lib/api'
import { useCatalog, idolShort } from '../lib/catalog'
import { compact, int, ms, secs } from '../lib/format'
import { GRADE_HINT, KIND_INFO, SET_INFO, TAG_LABEL, tagValueLabel, type Kind } from '../lib/game'
import { Select } from '../components/Select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Code, cx, Empty, SectionTitle, ErrorState, Grade, Help, IdolThumb, ModeBadge, PageHeader, RankNum, RatioText, TableSkeleton, Tip } from '../components/ui'

type SortKey = 'oracle' | 'base' | 'mean' | 'p50' | 'n' | 'label'

const GROUPS_BY_SET: Record<string, string[]> = {
  gkms480: ['mechanic', 'stage', 'idol', 'deck'],
  'hif-live': ['round', 'produce'],
}

// 顺序色阶（单一橙色，浅到深），只作格子底色；数字始终用正文色
const SEQ = ['oklch(0.975 0.02 66)', 'oklch(0.95 0.045 62)', 'oklch(0.92 0.07 58)', 'oklch(0.89 0.095 55)', 'oklch(0.86 0.115 52)']

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
    <th scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cx('px-3 py-2.5 font-semibold', align === 'right' ? 'text-right' : 'text-left')}>
      <span className={cx('inline-flex items-center', align === 'right' && 'justify-end')}>
        <button type="button" onClick={() => onSort(k)} className={cx('inline-flex items-center gap-1 rounded hover:text-ink', active ? 'text-ink' : 'text-ink-2')}>
          {children}
          <Icon size={12} className={active ? 'text-brand-ink' : 'text-ink-3'} aria-hidden />
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
  const rawKind = q.get('kind') ?? (q.get('mode') === 'random' ? 'template' : '')
  const kind: Kind = rawKind === 'template' || rawKind === 'legacy' ? rawKind : 'fixed'
  const base = q.get('base') ?? ''
  const group = q.get('group') ?? ''
  const sort = ((q.get('sort') as SortKey) || 'oracle') as SortKey
  const dir = (q.get('dir') as 'asc' | 'desc') ?? (sort === 'p50' || sort === 'label' ? 'asc' : 'desc')
  const lb = useApi<Row[]>(set ? `api/leaderboard?set=${encodeURIComponent(set)}&kind=${kind}&base=${encodeURIComponent(base)}&group=${encodeURIComponent(group)}` : null)

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
    const key = sort === 'oracle' && !rs.some((r) => r.vs_oracle && !r.privileged) ? 'mean' : sort
    rs.sort((a, b) => {
      if (a.privileged !== b.privileged) return a.privileged ? 1 : -1
      const va = sortValue(a, key)
      const vb = sortValue(b, key)
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
  const hasOracle = rows.some((r) => r.privileged && r.vs_oracle)
  const groups = GROUPS_BY_SET[set] ?? ['idol']
  const labels = Array.from(new Set(rows.filter((r) => !r.privileged).map((r) => r.label)))
  let rank = 0

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="题集">
        {sets.data?.map((s) => (
          <Link
            key={s.set}
            to={`/sets/${s.set}${kind !== 'fixed' ? `?kind=${kind}` : ''}`}
            role="tab"
            aria-selected={s.set === set}
            className={cx(
              'inline-flex items-center gap-2 rounded-full border py-1 pr-3.5 pl-1 text-[13.5px] font-semibold transition-colors duration-150',
              s.set === set ? 'border-brand-deep bg-brand-deep text-white' : 'border-line-strong bg-surface text-ink-2 hover:border-brand hover:text-brand-ink',
            )}
          >
            <IdolThumb id={s.idols?.[0]} size={24} title={false} className="rounded-full ring-0" />
            {SET_INFO[s.set]?.title ?? s.set}
          </Link>
        ))}
      </div>

      <PageHeader
        title={SET_INFO[set]?.title ?? set}
        sub={
          <>
            {SET_INFO[set]?.blurb}
            {info && (
              <span className="num ml-1">
                {info.problems} 题；每题 {Math.round((info.seeds.dev + info.seeds.test) / Math.max(1, info.problems))} 个固定种子{info.public_seeds ? '（公开）' : ''}，另有 {info.template_seeds ?? 32} 个保密种子。
              </span>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <ToggleGroup
          aria-label="种子"
          variant="segment"
          spacing={0}
          value={[kind === 'legacy' ? 'template' : kind]}
          onValueChange={(v) => v[0] && update({ kind: v[0] === 'fixed' ? '' : String(v[0]), mode: '', base: '', sort: '', dir: '' })}
          className="rounded-full border border-input bg-background p-0.5"
        >
          {(['fixed', 'template'] as const).map((m) => (
            <ToggleGroupItem key={m} value={m} className="rounded-full!">
              {KIND_INFO[m].title}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Help tip={KIND_INFO[kind].hint} />
        <span className="inline-flex items-center gap-2 text-ink-2">
          基准
          <Select label="基准" value={base} onChange={(v) => update({ base: v })} width="14rem"
            options={[{ value: '', label: '不比' }, ...labels.map((l) => ({ value: l, label: l }))]} />
          <Help tip="选一个算法当基准，表里多两列：同题同种子对它的分数比，和赢它的局数比例。" />
        </span>
        <span className="inline-flex items-center gap-2 text-ink-2">
          分组
          <Select label="分组" value={group} onChange={(v) => update({ group: v })}
            options={[{ value: '', label: '不分' }, ...groups.map((g) => ({ value: g, label: `按${TAG_LABEL[g] ?? g}` }))]} />
        </span>
        {kind === 'legacy' ? (
          <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-surface-3 px-3 py-1 text-[12.5px] text-ink-2">
            正在看旧版评测，和现在的成绩不可比
            <button onClick={() => update({ kind: 'template', base: '', sort: '', dir: '' })} className="font-semibold text-brand-ink hover:underline">回到保密种子</button>
          </span>
        ) : kind === 'template' ? (
          <button onClick={() => update({ kind: 'legacy', base: '', sort: '', dir: '' })} className="ml-auto text-[12.5px] text-ink-3 hover:text-brand-ink">
            11 月 9 日以前的旧版评测
          </button>
        ) : null}
      </div>

      {lb.error && <ErrorState error={lb.error} onRetry={lb.reload} />}
      {lb.loading && !lb.data && <TableSkeleton />}
      {lb.data && rows.length === 0 && (
        <Empty>
          <p className="font-semibold text-ink">{kind === 'template' ? '保密种子还没有成绩。' : kind === 'legacy' ? '没有旧版评测。' : '这套题还没有成绩。'}</p>
          {kind !== 'legacy' && (
            <p className="mt-1.5">
              跑一次：<Code>{kind === 'template' ? `python -m gkbench eval --set ${set} --algo greedy` : `python -m gkbench run --set ${set} --algo greedy`}</Code>
              ，详见 <Link to="/#join" className="text-brand-ink underline underline-offset-2">交成绩</Link>。
            </p>
          )}
        </Empty>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[960px] border-collapse text-[13px]">
            <thead className="border-b border-line bg-surface-2 text-[12.5px]">
              <tr>
                <th scope="col" className="w-14 px-3 py-2.5 text-center font-semibold whitespace-nowrap text-ink-2">名次</th>
                <SortHead k="label" sort={sort} dir={dir} onSort={onSort} align="left">算法</SortHead>
                {hasOracle && (
                  <SortHead k="oracle" sort={sort} dir={dir} onSort={onSort} help={<>每局分数 ÷ 同题同种子理论上限的分数，取几何平均；± 是标准误。<br />{GRADE_HINT}</>}>
                    相对上限
                  </SortHead>
                )}
                {base && (
                  <SortHead k="base" sort={sort} dir={dir} onSort={onSort} help={kind === 'legacy' ? `每道题先求平均分，再按题对 ${base} 求分数比（几何平均 ± 标准误）；胜率是平均分更高的题所占比例。` : `同题同种子对 ${base} 的分数比（几何平均 ± 标准误），后面是胜率，平局算一半。`}>
                    相对 {base}
                  </SortHead>
                )}
                <SortHead k="mean" sort={sort} dir={dir} onSort={onSort} help={kind === 'fixed' ? '所有局的平均分。' : '每道题先求平均，再对题求平均。'}>平均分</SortHead>
                <SortHead k="p50" sort={sort} dir={dir} onSort={onSort} help="每步思考时间的中位数 / 95 分位。托管按服务器计时。理论上限开局一次算完，所以接近 0。">
                  每步
                </SortHead>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold text-ink-2">每局思考</th>
                <SortHead k="n" sort={sort} dir={dir} onSort={onSort}>局数</SortHead>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold text-ink-2">
                  <span className="inline-flex items-center">超时 / 出错<Help tip="超时：一步想了超过预算 1.2 倍再加 50 ms，只记数不扣分。出错：算法抛了异常，这局按当时的分数结束。" /></span>
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold text-ink-2">规则</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                if (!r.privileged) rank++
                const params = r.params ? Object.entries(r.params).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${v}`).join(' ') : ''
                return (
                  <tr key={r.run} className={cx('border-b border-line last:border-0', r.privileged ? 'bg-surface-2 text-ink-2' : 'hover:bg-brand-tint')}>
                    <td className="px-3 py-3 text-center">{r.privileged ? <span className="text-[12px] whitespace-nowrap text-ink-3">分母</span> : <RankNum n={rank} />}</td>
                    <td className="max-w-[300px] px-3 py-3">
                      <span className="flex items-center gap-2">
                        <Link to={`/runs/${r.run}`} className="truncate text-[14px] font-bold text-ink hover:text-brand-ink">
                          {r.label}
                        </Link>
                        <ModeBadge mode={r.mode} privileged={r.privileged} />
                      </span>
                      <div className="truncate text-[11.5px] text-ink-3">
                        {[params, r.step_seconds != null && `每步 ${r.step_seconds} s`, r.by].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    {hasOracle && (
                      <td className="px-3 py-3 text-right">
                        {r.privileged ? <span className="text-ink-3">100%</span> : (
                          <span className="inline-flex items-center justify-end gap-2.5">
                            <Grade ratio={r.vs_oracle?.geo} size={30} />
                            <RatioText r={r.vs_oracle} strong />
                          </span>
                        )}
                      </td>
                    )}
                    {base && (
                      <td className="px-3 py-3 text-right">
                        <RatioText r={r.vs_base} />
                        {r.vs_base && <span className="num ml-2 text-[12px] text-ink-3">胜 {(r.vs_base.win * 100).toFixed(0)}%</span>}
                      </td>
                    )}
                    <td className="px-3 py-3 text-right"><span className="disp text-[17px] text-ink">{int(r.mean)}</span></td>
                    <td className="num px-3 py-3 text-right whitespace-nowrap">
                      {ms(r.p50_ms)} <span className="text-ink-3">/ {ms(r.p95_ms)}</span>
                    </td>
                    <td className="num px-3 py-3 text-right">{secs(r.ep_think_s)}</td>
                    <td className="num px-3 py-3 text-right">
                      {r.n}
                      {kind !== 'fixed' && <div className="text-[11px] text-ink-3">{r.problems} 题</div>}
                    </td>
                    <td className="num px-3 py-3 text-right">
                      <span className={r.over ? 'text-ink' : 'text-ink-3'}>{r.over}</span>
                      <span className="text-ink-3"> / </span>
                      <span className={r.errors + r.unfinished ? 'font-semibold text-critical' : 'text-ink-3'}>{r.errors + r.unfinished}</span>
                    </td>
                    <td className="num px-3 py-3 text-right text-ink-3">
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

      {group && rows.length > 0 && <GroupMatrix rows={rows} group={group} hasOracle={hasOracle} base={base} idol={(id) => idolShort(cat, id)} />}

      <section className="mt-8 grid max-w-[1040px] gap-x-10 gap-y-2.5 text-[12.5px] leading-relaxed text-ink-2 md:grid-cols-2">
        <p><span className="font-semibold text-ink">成对比。</span>比值都是同题同种子两局的分数比，再取几何平均，不是平均分之比。{kind === 'legacy' && '旧版评测各算法种子不同，只能先按题平均再比。'}</p>
        <p><span className="font-semibold text-ink">上限不排名。</span>理论上限提前知道种子，只当分母。自报的成绩服务器重放核对过，但证明不了没偷看种子；要排除这一点看托管成绩。</p>
        <p><span className="font-semibold text-ink">规则版本。</span>版本不同的成绩不能直接比；引擎更新后，旧成绩可以按新规则重放重算。</p>
        <p><span className="font-semibold text-ink">时间。</span>每次运行声明每步预算，超时只记数、不扣分。</p>
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
      <SectionTitle className="mb-1">按{TAG_LABEL[group] ?? group}分组</SectionTitle>
      <p className="mb-3 text-[12.5px] text-ink-2">
        格子里是{metric === 'vs_oracle' ? '相对上限' : metric === 'vs_base' ? `相对 ${base}` : '平均分'}，底色越深越高（只作辅助，以数字为准）。悬停看局数和标准误。
      </p>
      <div className="inline-block max-w-full overflow-x-auto rounded-xl border border-line bg-surface align-top">
        <table className="border-collapse text-[12.5px]">
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className="sticky left-0 bg-surface-2 px-3 py-2 text-left font-medium text-ink-2">算法</th>
              {keys.map((k) => (
                <th key={k} scope="col" className="px-3 py-2 text-right font-semibold whitespace-nowrap text-ink-2">
                  {group === 'idol' ? <span className="inline-flex items-center gap-1.5"><IdolThumb id={k} size={22} />{idol(k)}</span> : tagValueLabel(group, k, idol)}
                </th>
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
                      {v == null ? <span className="text-ink-3">—</span> : (
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
