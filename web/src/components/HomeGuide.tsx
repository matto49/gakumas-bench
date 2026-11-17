import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useTierNames, TierBadge } from '../pages/Tiers'
import { mayCross, tierLine, type Tier, type TierBoard, type TierCard } from '../lib/tiers'
import { useApi } from '../lib/hooks'
import { useCatalog, useLang } from '../lib/catalog'
import type { SetInfo } from '../lib/api'
import { jst, upcomingBirthdays, type SiteHome, type SiteNow, type SiteUpdates } from '../lib/site'
import { pick } from '../lib/supports'
import { SupportThumb } from './SupportCard'
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
export function HomeTierBoard({ board, only }: { board: TierBoard | null; only?: Tier[] }) {
  if (!board) return <Skeleton className="h-[260px] rounded-2xl" />
  const tiers = (['S', 'A', 'B', 'C', 'D'] as Tier[]).filter((t) => !only || only.includes(t)).map((t) => ({ t, cards: board.cards.filter((c) => c.tier === t) })).filter((x) => x.cards.length)
  const rest = board.cards.filter((c) => only && !only.includes(c.tier))
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
      {rest.length > 0 && (
        <Link to={`/tiers/${board.id}`} className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-brand-ink">
          <span>还有 {[...new Set(rest.map((c) => c.tier))].join('、')} 档 {rest.length} 张</span>
          <ArrowRight size={14} aria-hidden />
        </Link>
      )}
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

/** 资料入口：标题、一句玩家会问的话、里面有什么 */
const DATA_TILES = [
  { tab: '', title: '技能卡', ask: '强化以后变成什么样？', body: '效果、强化和定制方向' },
  { tab: 'supports', title: '支援卡', ask: '满突有多强？', body: '每个突破档的技能数值和事件' },
  { tab: 'idols', title: '偶像卡', ask: '专属卡和 P 道具是什么？', body: '初始参数、成长率、固有卡和 P 道具' },
  { tab: 'items', title: 'P 道具', ask: '什么时候触发？', body: '效果和触发条件' },
  { tab: 'drinks', title: '饮料', ask: '要几级才能拿到？', body: '效果和解锁等级' },
  { tab: 'memories', title: '回忆能力', ask: '考试里有用吗？', body: '考试里和培育中的效果' },
] as const

export function DataTiles() {
  return (
    <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(170px,1fr))]">
      {DATA_TILES.map((d) => (
        <li key={d.title}>
          <Link to={d.tab ? `/cards?tab=${d.tab}` : '/cards'} className="group block h-full rounded-xl border border-line bg-surface p-3.5 hover:border-line-strong">
            <p className="flex items-center justify-between font-bold text-ink group-hover:text-brand-ink">{d.title}<ArrowRight size={14} className="text-ink-3 group-hover:text-brand-ink" aria-hidden /></p>
            <p className="mt-1 text-[13px] text-ink-2">「{d.ask}」</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{d.body}</p>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** 资料的数据日期：支援卡取自社区同步的游戏数据（gakumasu-diff），写它的版本日期 */
export function DataDate() {
  const meta = useApi<{ source?: { master_date?: string }; cards?: number }>('api/supports/meta')
  const d = meta.data?.source?.master_date
  return d ? <>游戏数据同步于 <span className="num">{d}</span>，新卡会跟着补上。</> : <>数据直接取自游戏。</>
}

export { MoreLink }

function Box({ title, right, children, className }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-2xl border border-line bg-surface p-4', className)}>
      <h3 className="mb-3 flex items-baseline justify-between gap-3 text-[15px] font-bold text-ink">{title}{right && <span className="text-[12px] font-normal text-ink-3">{right}</span>}</h3>
      {children}
    </section>
  )
}

/** 某位偶像的一张头像：她编号最小的偶像卡 */
function useCharThumb() {
  const cat = useCatalog()
  return (cid: string) => Object.keys(cat?.idols ?? {}).filter((k) => k.startsWith(`i_card-${cid}-`)).sort()[0] ?? `i_card-${cid}-1-000`
}

const md = (d: string) => d.slice(5).replace('-', '-')

/** 「现在」：进行中的卡池和活动（手写，空的就不出现）、最近加入游戏数据的新卡、接下来的生日 */
export function NowSection({ home, now, board }: { home: SiteHome | null; now: SiteNow | null; board: TierBoard | null }) {
  const { lang } = useLang()
  const cat = useCatalog()
  const thumb = useCharThumb()
  const t = Date.now()
  const live = (now?.items ?? []).filter((x) => !x.end || jst(x.end) > t)
  if (!home) return <Skeleton className="h-[220px] rounded-2xl" />
  const dates = [...new Set(home.new_cards.map((c) => c.date))].slice(0, 3)
  const births = upcomingBirthdays(home.birthdays).slice(0, 3)
  const inBoard = new Set(board?.cards.map((c) => c.id))
  const cardLink = (c: SiteHome['new_cards'][number]) =>
    c.kind === 'support' ? `/cards?tab=supports&support=${c.id}`
      : inBoard.has(c.id) && board ? `/tiers/${board.id}/${c.id}`
      : cat?.idols[c.id] ? `/cards?tab=idols&idol=${c.id}` : `/cards?tab=idols&q=${encodeURIComponent(pick(c.character_name, lang))}`
  return (
    <div className={cx('grid gap-4', live.length ? 'lg:grid-cols-[1fr_1.4fr_0.9fr]' : 'lg:grid-cols-[1.6fr_1fr]')}>
      {live.length > 0 && (
        <Box title="进行中" right={now?.updated && `整理于 ${now.updated}`}>
          <ul className="space-y-3">
            {live.map((x, i) => {
              const left = x.end ? Math.ceil((jst(x.end) - t) / 86400000) : null
              const body = (
                <>
                  <p className="flex items-center gap-2">
                    <span className="rounded-[4px] bg-brand-soft px-1.5 text-[11px] font-semibold text-brand-ink">{x.kind === 'gacha' ? '卡池' : '活动'}</span>
                    <span className="min-w-0 truncate font-semibold text-ink">{x.title}</span>
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-3">{x.end ? `到 ${x.end.slice(5)}（日本时间）· 还有 ${left} 天` : ''}{x.note ? ` · ${x.note}` : ''}</p>
                  {x.cards && x.cards.length > 0 && (
                    <span className="mt-1.5 flex gap-1.5">
                      {x.cards.map((c) => (c.startsWith('s_card') ? <SupportThumb key={c} id={c} size={40} /> : <IdolThumb key={c} id={c} size={40} title={false} />))}
                    </span>
                  )}
                </>
              )
              return <li key={i}>{x.link ? <Link to={x.link} className="block hover:text-brand-ink">{body}</Link> : body}</li>
            })}
          </ul>
        </Box>
      )}

      <Box title="新卡" right={`加入游戏数据的日期 · 最近 ${home.source.days ?? 60} 天`}>
        <div className="space-y-3">
          {dates.map((d) => (
            <div key={d} className="flex gap-3">
              <span className="num w-12 shrink-0 pt-1 text-[12.5px] font-semibold whitespace-nowrap text-ink-2">{md(d)}</span>
              <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {home.new_cards.filter((c) => c.date === d).map((c) => (
                  <Link key={c.id} to={cardLink(c)} title={c.kind === 'idol' ? `【${pick(c.name, lang)}】${pick(c.character_name, lang)}` : pick(c.name, lang)}
                    className="group flex w-[148px] items-center gap-2 rounded-lg p-1 hover:bg-surface-2">
                    {c.kind === 'idol' ? <IdolThumb id={c.id} size={40} title={false} /> : <SupportThumb id={c.id} size={40} />}
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-[12.5px] text-ink group-hover:text-brand-ink">{c.kind === 'idol' ? pick(c.character_name, lang) : pick(c.name, lang)}</span>
                      <span className="block truncate text-[11px] text-ink-3">{c.rarity} {c.kind === 'idol' ? `偶像卡 · ${pick(c.name, lang)}` : '支援卡'}</span>
                    </span>
                  </Link>
                ))}
              </span>
            </div>
          ))}
        </div>
      </Box>

      <Box title="生日">
        <ul className="space-y-2">
          {births.map((b) => (
            <li key={b.id} className={cx('flex items-center gap-3 rounded-xl p-1.5', b.days === 0 && 'bg-brand-soft')}>
              <IdolThumb id={thumb(b.id)} size={40} title={false} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink">{pick(b.name, lang)}</span>
                <span className="num block text-[12px] text-ink-3">{b.month} 月 {b.day} 日</span>
              </span>
              <span className={cx('num shrink-0 text-[12.5px]', b.days === 0 ? 'font-bold text-brand-ink' : 'text-ink-2')}>{b.days === 0 ? '今天' : `还有 ${b.days} 天`}</span>
            </li>
          ))}
        </ul>
      </Box>
    </div>
  )
}

/** 站内更新：日期 + 一句话，有链接的整行可点 */
export function UpdateList({ items, limit }: { items: SiteUpdates['items']; limit?: number }) {
  const list = limit ? items.slice(0, limit) : items
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {list.map((u, i) => {
        const body = (
          <span className="flex items-baseline gap-4 px-4 py-2.5">
            <span className="num w-12 shrink-0 text-[12.5px] text-ink-3">{u.date.slice(5)}</span>
            <span className="min-w-0 flex-1 text-[14px] text-ink">{u.text}</span>
            {u.link && <ArrowRight size={14} className="shrink-0 text-ink-3" aria-hidden />}
          </span>
        )
        return <li key={i}>{u.link ? <Link to={u.link} className="block hover:bg-surface-2">{body}</Link> : body}</li>
      })}
    </ul>
  )
}

/** 按培育模式：每个模式现在有什么（强度榜、考试题库），没有的照实写 */
export function ModeEntries({ sets, board }: { sets: SetInfo[] | null; board: TierBoard | null }) {
  const count = (k: string) => sets?.find((s) => s.set === k)?.problems
  const modes = [
    { key: 'hif', name: 'H.I.F', tier: board ? <Link to={`/tiers/${board.id}`} className="font-semibold text-brand-ink hover:underline">好印象 · {board.cards.length} 张</Link> : null },
    { key: 'nia', name: 'N.I.A', tier: null },
    { key: 'hajime', name: '初', tier: null },
  ]
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {modes.map((m) => (
        <li key={m.key} className="rounded-2xl border border-line bg-surface">
          <p className="disp border-b border-line px-4 py-2.5 text-[24px] leading-none text-ink">{m.name}</p>
          <dl className="divide-y divide-line px-4 text-[13px]">
            <div className="flex justify-between py-2"><dt className="text-ink-2">强度榜</dt><dd>{m.tier ?? <span className="text-ink-3">还没有</span>}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-ink-2">打法指南</dt><dd className="text-ink-3">还没有</dd></div>
            <div className="flex justify-between py-2"><dt className="text-ink-2">考试题库</dt><dd><Link to={`/exams/${m.key}`} className="num font-semibold text-ink hover:text-brand-ink">{count(m.key) ?? '—'} 题</Link></dd></div>
          </dl>
        </li>
      ))}
    </ul>
  )
}

const TOOLS = [
  { to: '/sets', title: '出牌算法排行', body: '各种出牌算法打同一批实机开局的考试，比分数和每步用时' },
  { to: '/exams', title: '考试题库', body: '收集来的考试开局，每一局都能逐步回放' },
] as const

export function ToolTiles() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {TOOLS.map((d) => (
        <li key={d.to}>
          <Link to={d.to} className="group block h-full rounded-xl border border-line bg-surface p-3.5 hover:border-line-strong">
            <p className="flex items-center justify-between font-bold text-ink group-hover:text-brand-ink">{d.title}<ArrowRight size={14} className="text-ink-3 group-hover:text-brand-ink" aria-hidden /></p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{d.body}</p>
          </Link>
        </li>
      ))}
    </ul>
  )
}
