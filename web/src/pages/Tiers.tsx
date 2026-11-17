import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ChevronLeft, ExternalLink } from 'lucide-react'
import { useApi } from '../lib/hooks'
import { cardName, idolName, useCatalog, useLang, useTerms } from '../lib/catalog'
import { DEFAULT_BOARD, DIM_HELP, DIM_LABEL, mayCross, pairOf, splitIdol, tierLine, TIER_STYLE, type Dim, type Pair, type Tier, type TierBoard, type TierCard } from '../lib/tiers'
import { cx, Empty, ErrorState, Help, IdolThumb, PageHeader, SectionTitle, Skeleton } from '../components/ui'

/** 强度榜：一张榜按 S～D 分档，每张卡点进单卡页（TierCardPage）。数据见 lib/tiers.ts */

export function useTierBoard(id: string | undefined) {
  return useApi<TierBoard>(`api/tiers/${id ?? DEFAULT_BOARD}`)
}

/** 榜上各种名字：主名跟着「日 / 中」开关，另一种语言做对照（board.names）；榜里没有的退回目录或原始名 */
export function useTierNames(board: TierBoard | null) {
  const { lang } = useLang()
  const cat = useCatalog()
  const terms = useTerms()
  const n = board?.names
  return {
    idol(c: TierCard) {
      const p = pairOf(n?.idols[c.id], lang, idolName(cat, c.id) === c.id ? `【${c.name}】${c.character}` : idolName(cat, c.id))
      const m = splitIdol(p.main)
      const s = p.sub ? splitIdol(p.sub) : undefined
      return { name: m.name, character: m.character || c.character, nameSub: s && s.name !== m.name ? s.name : undefined }
    },
    card(id: string, u = 0): Pair {
      const e = n?.cards[id]
      return pairOf({ ja: e?.ja?.[u], zh: e?.zh?.[u] }, lang, cardName(cat, id, u))
    },
    item: (id: string) => pairOf(n?.items[id], lang, cat?.items[id]?.name ?? id),
    drink: (id: string) => pairOf(n?.drinks[id], lang, cat?.drinks[id]?.name ?? id),
    support: (id: string) => pairOf(n?.supports[id] ?? { ja: board?.supports[id]?.name, zh: board?.supports[id]?.zh ?? undefined }, lang, id),
    plan: (c: TierCard) => { const k = cat?.idols[c.id]?.plan; return (k && terms.plan[k]) || c.plan_label },
    style: (c: TierCard) => { const k = cat?.idols[c.id]?.style; return (k && terms.style[k]) || c.style_label },
  }
}

/** 主名 + 灰色小字的另一种语言 */
export function Bi({ p, className, subClass, inline = true }: { p: Pair; className?: string; subClass?: string; inline?: boolean }) {
  return (
    <span className={className}>
      {p.main}
      {p.sub && (inline ? <span className={cx('ml-1.5 font-normal text-ink-3', subClass ?? 'text-[0.85em]')}>{p.sub}</span> : <span className={cx('block font-normal text-ink-3', subClass ?? 'text-[0.85em]')}>{p.sub}</span>)}
    </span>
  )
}

export function TierBadge({ t, size = 'md' }: { t: Tier; size?: 'sm' | 'md' | 'lg' }) {
  const s = size === 'lg' ? 'size-16 text-[40px] rounded-2xl' : size === 'md' ? 'size-9 text-[22px] rounded-lg' : 'size-6 text-[14px] rounded-md'
  return <span className={cx('disp inline-grid shrink-0 place-items-center leading-none', s, TIER_STYLE[t])}>{t}</span>
}

function DimBars({ c, dims }: { c: TierCard; dims: Dim[] }) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
      {dims.map((d) => (
        <div key={d} className="contents">
          <span className="text-[11.5px] text-ink-3">{DIM_LABEL[d]}</span>
          <span className="h-[5px] overflow-hidden rounded-full bg-surface-3">
            <i className="block h-full rounded-full bg-da" style={{ width: `${c.score[d]}%` }} />
          </span>
          <span className="num w-9 text-right text-[12px] font-semibold text-ink">{c.score[d].toFixed(1)}</span>
        </div>
      ))}
    </div>
  )
}

function RankDot({ c }: { c: TierCard }) {
  return (
    <span className="relative">
      <span className="disp grid size-6 place-items-center rounded-full bg-ink text-[13px] leading-none text-white">{c.rank}</span>
      {mayCross(c) && (
        <span title="换一批编成重算时可能跨档" className="absolute -top-0.5 -right-1 size-2.5 rounded-full border-2 border-ink-3 bg-surface" />
      )}
    </span>
  )
}

/** S、A 档：大卡，带六维条 */
function BigCard({ c, board }: { c: TierCard; board: TierBoard }) {
  const label = useTierNames(board).idol(c)
  return (
    <Link
      to={`/tiers/${board.id}/${c.id}`}
      className="group flex gap-3 rounded-xl border border-line bg-surface p-3 transition-colors duration-150 hover:border-line-strong"
    >
      <div className="relative shrink-0">
        <IdolThumb id={c.id} size={72} title={false} />
        <span className="absolute -top-2 -left-2"><RankDot c={c} /></span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] text-ink-3">{label.character}</p>
        <p className="truncate font-bold text-ink group-hover:text-brand-ink">{label.name}</p>
        {label.nameSub && <p className="-mt-0.5 truncate text-[11.5px] text-ink-3">{label.nameSub}</p>}
        <p className="mt-0.5 flex items-baseline gap-2">
          <span className="disp text-[30px] leading-none text-ink">{c.total.toFixed(1)}</span>
          <span className="text-[11.5px] text-ink-3">{mayCross(c) ? '可能跨档' : `区间 ${c.rank_interval[0]}–${c.rank_interval[1]}`}</span>
        </p>
      </div>
      <div className="hidden w-[44%] shrink-0 sm:block"><DimBars c={c} dims={board.dims} /></div>
    </Link>
  )
}

/** B 档以下：小格 */
function SmallCard({ c, board }: { c: TierCard; board: TierBoard }) {
  const label = useTierNames(board).idol(c)
  return (
    <Link
      to={`/tiers/${board.id}/${c.id}`}
      title={label.nameSub ? `${label.name}（${label.nameSub}）` : label.name}
      className="group flex w-[104px] flex-col items-center rounded-xl px-1 py-2 text-center transition-colors duration-150 hover:bg-surface-2"
    >
      <span className="relative">
        <IdolThumb id={c.id} size={64} title={false} />
        <span className="absolute -top-2 -left-2"><RankDot c={c} /></span>
      </span>
      <span className="disp mt-1.5 text-[20px] leading-none text-ink">{c.total.toFixed(1)}</span>
      <span className="mt-1 w-full truncate text-[11.5px] text-ink-2">{label.character}</span>
      <span className="w-full truncate text-[11px] text-ink-3 group-hover:text-brand-ink">{label.name}</span>
    </Link>
  )
}

function SortTable({ board }: { board: TierBoard }) {
  const names = useTierNames(board)
  const [sort, setSort] = useState<{ k: 'total' | Dim | 'real'; desc: boolean }>({ k: 'total', desc: true })
  const val = (c: TierCard) => (sort.k === 'total' ? c.total : sort.k === 'real' ? c.real.median : c.score[sort.k])
  const rows = useMemo(() => [...board.cards].sort((a, b) => (sort.desc ? val(b) - val(a) : val(a) - val(b))), [board, sort])
  const head = (k: typeof sort.k, text: string) => (
    <th key={k} className="px-2 py-2 text-right font-semibold">
      <button type="button" onClick={() => setSort((s) => ({ k, desc: s.k === k ? !s.desc : true }))} className="inline-flex cursor-pointer items-center gap-0.5 hover:text-ink">
        {text}
        {sort.k === k && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  )
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[760px] text-[13px]">
        <thead className="bg-surface-2 text-[12px] text-ink-3">
          <tr>
            <th className="px-2 py-2 text-left font-semibold">名次</th>
            <th className="px-2 py-2 text-left font-semibold">偶像卡</th>
            {head('total', '总分')}
            {board.dims.map((d) => head(d, DIM_LABEL[d]))}
            {head('real', '实录中位')}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const l = names.idol(c)
            return (
              <tr key={c.id} className="border-t border-line hover:bg-brand-tint">
                <td className="px-2 py-1.5"><span className="inline-flex items-center gap-1.5"><span className="num w-5 text-ink-2">{c.rank}</span><TierBadge t={c.tier} size="sm" /></span></td>
                <td className="px-2 py-1.5">
                  <Link to={`/tiers/${board.id}/${c.id}`} className="inline-flex items-center gap-2 hover:text-brand-ink">
                    <IdolThumb id={c.id} size={26} title={false} />
                    <span className="truncate">{l.character} <span className="text-ink-2">{l.name}</span>{l.nameSub && <span className="ml-1.5 text-[11.5px] text-ink-3">{l.nameSub}</span>}</span>
                  </Link>
                </td>
                <td className="num px-2 py-1.5 text-right font-semibold">{c.total.toFixed(1)}</td>
                {board.dims.map((d) => <td key={d} className="num px-2 py-1.5 text-right text-ink-2">{c.score[d].toFixed(1)}</td>)}
                <td className="num px-2 py-1.5 text-right text-ink-2">{Math.round(c.real.median / 10000).toLocaleString()} 万</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function DimsExplain({ board }: { board: TierBoard }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {board.dims.map((d) => {
        const xs = board.cards.map((c) => c.score[d])
        return (
          <div key={d} className="rounded-xl border border-line p-3">
            <p className="flex items-baseline justify-between">
              <span className="font-bold text-ink">{DIM_LABEL[d]}</span>
              <span className="num text-[12px] text-ink-3">权重 {Math.round(board.weights[d] * 100)}%</span>
            </p>
            <p className="mt-1 text-[13px] text-ink">{DIM_HELP[d][0]}</p>
            <p className="mt-1 text-[12px] text-ink-3">{DIM_HELP[d][1]}</p>
            <p className="num mt-1.5 text-[12px] text-ink-3">{board.cards.length} 张卡的范围 {Math.min(...xs).toFixed(1)} – {Math.max(...xs).toFixed(1)}</p>
          </div>
        )
      })}
    </div>
  )
}

export function SourceLine({ board }: { board: TierBoard }) {
  const s = board.source
  return (
    <p className="text-[12.5px] text-ink-3">
      数据和方法：{s.author ?? '—'}
      {s.video && (
        <> · <a href={s.video} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-ink hover:underline">原视频<ExternalLink className="size-3" /></a></>
      )}
      {s.date && <> · 导入于 {s.date}</>}
    </p>
  )
}

export function Tiers() {
  const { board: id } = useParams()
  const { data: board, error, reload } = useTierBoard(id)
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!board) return <div className="space-y-3"><Skeleton className="h-10 w-80" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
  return <TiersBoard board={board} />
}

function TiersBoard({ board }: { board: TierBoard }) {
  const names = useTierNames(board)
  const klass = board.cards.length ? `${names.plan(board.cards[0])} · ${names.style(board.cards[0])}` : board.class
  const tiers = (['S', 'A', 'B', 'C', 'D'] as Tier[]).map((t) => ({ t, cards: board.cards.filter((c) => c.tier === t) })).filter((x) => x.cards.length)
  return (
    <div className="space-y-8">
      <PageHeader
        title={board.title}
        sub={<>{klass} · {board.cards.length} 张偶像卡 · 六维总分 · 收集的对局 {board.counts.records.toLocaleString()} 份 · 模拟 {Math.round((board.counts.games + board.counts.sim_games) / 10000).toLocaleString()} 万局</>}
        right={<SourceLine board={board} />}
      />
      <div className="space-y-3">
        {tiers.map(({ t, cards }) => (
          <section key={t} className="flex gap-3">
            <div className="flex w-[72px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-surface-2 py-3">
              <TierBadge t={t} />
              <span className="num text-[11.5px] text-ink-3">{tierLine(board, t)}</span>
              <span className="text-[11.5px] text-ink-3">{cards.length} 张</span>
            </div>
            <div className={cx('min-w-0 flex-1', t === 'S' || t === 'A' ? 'grid gap-2 lg:grid-cols-3' : 'flex flex-wrap gap-1 rounded-xl border border-line p-2')}>
              {cards.map((c) => (t === 'S' || t === 'A' ? <BigCard key={c.id} c={c} board={board} /> : <SmallCard key={c.id} c={c} board={board} />))}
            </div>
          </section>
        ))}
        <p className="text-[12px] text-ink-3">档位 = 六维总分 ÷ 第一名 · 黑底数字是名次 · 右上角空心圆点：换一批编成重算时可能跨档 · 只代表 {board.scenario}，其他模式不适用</p>
      </div>

      <section>
        <SectionTitle right={<Help tip="六维总分 = 各维得分 × 权重，满分 100。本戦总分 = 前战 × 1.2 + 后战；模拟成绩来自同一套打法，各卡之间可比。" />}>六个维度怎么算</SectionTitle>
        <DimsExplain board={board} />
      </section>

      <section>
        <SectionTitle>全部数据</SectionTitle>
        <SortTable board={board} />
      </section>
    </div>
  )
}

/** /tiers：现在只有一张榜，直接显示它 */
export function TiersIndex() {
  return <Tiers />
}

export function TierMissing() {
  return (
    <div className="space-y-4">
      <Link to="/tiers" className="inline-flex items-center gap-1 text-[13px] text-brand-ink hover:underline"><ChevronLeft className="size-4" />回强度榜</Link>
      <Empty>这张榜里没有这张偶像卡。</Empty>
    </div>
  )
}
