import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useTierNames, TierBadge } from '../pages/Tiers'
import { mayCross, tierLine, type Tier, type TierBoard, type TierCard } from '../lib/tiers'
import { cx, IdolThumb, Skeleton } from './ui'

/** 首页的攻略部分：强度榜（第一屏）、按偶像看、游戏资料入口。强度榜数据见 lib/tiers.ts */

function MoreLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-ink hover:underline">
      {children} <ArrowRight size={13} aria-hidden />
    </Link>
  )
}

export function GuideTitle({ children, sub, right }: { children: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div>
        <h2 className="flex items-center gap-2.5 text-[21px] leading-tight font-bold tracking-tight text-ink">
          <span className="inline-block h-5 w-[5px] shrink-0 -skew-x-12 rounded-sm bg-brand" aria-hidden />
          {children}
        </h2>
        {sub && <p className="mt-2 max-w-[54em] text-ink-2">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

/** 一格偶像卡：头像、名次、总分、人名。S、A 档大一号 */
function Cell({ c, board, big }: { c: TierCard; board: TierBoard; big?: boolean }) {
  const l = useTierNames(board).idol(c)
  return (
    <Link
      to={`/tiers/${board.id}/${c.id}`}
      title={`${l.character} ${l.name}${l.nameSub ? `（${l.nameSub}）` : ''}`}
      className={cx('group flex shrink-0 flex-col items-center rounded-xl px-1 py-1.5 text-center hover:bg-surface-2', big ? 'w-[84px] sm:w-[132px]' : 'w-[68px]')}
    >
      <span className="relative">
        <IdolThumb id={c.id} size={big ? 56 : 48} title={false} className={big ? 'sm:size-[72px]!' : undefined} />
        <span className={cx('disp absolute -top-1.5 -left-1.5 grid place-items-center rounded-full bg-ink leading-none text-white', big ? 'size-5 text-[12px]' : 'size-[18px] text-[11px]')}>{c.rank}</span>
        {mayCross(c) && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full border-2 border-ink-3 bg-surface" />}
      </span>
      <span className={cx('disp mt-1 leading-none text-ink', big ? 'text-[19px]' : 'text-[15px]')}>{c.total.toFixed(1)}</span>
      <span className="mt-0.5 w-full truncate text-[11px] text-ink-2 group-hover:text-brand-ink">{l.character}</span>
      {big && <span className="w-full truncate text-[11px] text-ink-3">{l.name}</span>}
    </Link>
  )
}

/** 首页的强度榜：每档一行，档位色块 + 这一档的卡。完整的六维和单卡页在 /tiers */
export function HomeTierBoard({ board }: { board: TierBoard | null }) {
  if (!board) return <Skeleton className="h-[420px] rounded-2xl" />
  const tiers = (['S', 'A', 'B', 'C', 'D'] as Tier[]).map((t) => ({ t, cards: board.cards.filter((c) => c.tier === t) })).filter((x) => x.cards.length)
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line bg-surface-2 px-4 py-2.5">
        <p className="font-bold text-ink">{board.title}</p>
        <p className="text-[12px] text-ink-3">{board.cards.length} 张偶像卡 · 六维总分 · 数据：{board.source.author}</p>
      </div>
      <ol className="divide-y divide-line">
        {tiers.map(({ t, cards }) => (
          <li key={t} className="flex items-center gap-3 px-3 py-2">
            <span className="flex w-12 shrink-0 flex-col items-center gap-0.5">
              <TierBadge t={t} />
              <span className="num text-[10.5px] text-ink-3">{tierLine(board, t)}</span>
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap gap-0.5">
              {cards.map((c) => <Cell key={c.id} c={c} board={board} big={t === 'S' || t === 'A'} />)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** 按偶像看：每个角色在榜上最好的那张卡，点进单卡页 */
export function IdolEntries({ board }: { board: TierBoard | null }) {
  const names = useTierNames(board)
  if (!board) return <Skeleton className="h-[160px] rounded-2xl" />
  const best = new Map<string, TierCard[]>()
  for (const c of board.cards) best.set(c.character_id, [...(best.get(c.character_id) ?? []), c])
  const rows = [...best.values()].sort((a, b) => a[0].rank - b[0].rank)
  return (
    <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
      {rows.map((cs) => {
        const top = cs[0]
        const l = names.idol(top)
        return (
          <li key={top.character_id} className="group relative flex items-center gap-3 rounded-xl border border-line bg-surface p-3 hover:border-line-strong">
            <IdolThumb id={top.id} size={52} title={false} />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-ink">
                <Link to={`/tiers/${board.id}/${top.id}`} className="after:absolute after:inset-0 after:rounded-xl group-hover:text-brand-ink">{l.character}</Link>
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink-2">
                <TierBadge t={top.tier} size="sm" />
                <span className="min-w-0 truncate">{l.name}</span>
                <span className="num shrink-0 text-ink-3">第 {top.rank} 名</span>
              </p>
              {cs.length > 1 && (
                <p className="mt-1 text-[11.5px] text-ink-3">榜上共 {cs.length} 张：{cs.map((c) => c.tier).join(' · ')}</p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const DATA_TILES = [
  { tab: '', title: '技能卡', body: '效果、强化和定制方向' },
  { tab: 'supports', title: '支援卡', body: '每个突破档的技能数值和事件' },
  { tab: 'idols', title: '偶像卡', body: '初始参数、成长率、固有卡和 P 道具' },
  { tab: 'items', title: 'P 道具', body: '效果和触发条件' },
  { tab: 'drinks', title: '饮料', body: '效果和解锁等级' },
  { tab: 'memories', title: '回忆能力', body: '考试里和培育中的效果' },
] as const

export function DataTiles() {
  return (
    <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(170px,1fr))]">
      {DATA_TILES.map((d) => (
        <li key={d.title}>
          <Link to={d.tab ? `/cards?tab=${d.tab}` : '/cards'} className="group block h-full rounded-xl border border-line bg-surface p-3.5 hover:border-line-strong">
            <p className="flex items-center justify-between font-bold text-ink group-hover:text-brand-ink">{d.title}<ArrowRight size={14} className="text-ink-3 group-hover:text-brand-ink" aria-hidden /></p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{d.body}</p>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export { MoreLink }
