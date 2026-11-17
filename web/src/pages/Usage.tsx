import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApi } from '../lib/hooks'
import { cardName, idolShort, spriteUrl, useCatalog, useLang, useTerms } from '../lib/catalog'
import { aggregate, avg, charOf, type Agg, type CardUse, type ItemUse, type MemCardUse, type SupportUse, type UsageData, type UsageRow } from '../lib/usage'
import { pairBi } from '../lib/supports'
import { IDOL_STYLE } from '../lib/game'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select } from '../components/Select'
import { cx, Empty, ErrorState, Help, IdolThumb, PageHeader, Skeleton, Tip } from '../components/ui'
import { CardDetail, CardImage, Meta, RarityTag, sourceOf } from '../components/CardDetail'
import { ItemDetail } from '../components/ItemDetail'
import { SupportThumb, TypeChip } from '../components/SupportCard'

/** 配置强度榜：排行榜上每张偶像卡前 100 名的配置里，各支援卡 / 技能卡 / P 道具出现的比例。
 * 方法照花吹雪また一年P 的强度榜：出现得越多，说明和这张偶像卡越合得来。选几张偶像卡（按偶像、流派）时每张权重相同，求平均 */

const MODES = [
  { key: 'hif', label: 'H.I.F' },
  { key: 'nia', label: 'N.I.A' },
  { key: 'hajime', label: '初' },
] as const

function Chip({ on, disabled, children, onClick, hint }: { on?: boolean; disabled?: boolean; children: React.ReactNode; onClick?: () => void; hint?: string }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={hint}
      className={cx('h-8 rounded-full border px-3 text-[13px] transition-colors',
        on ? 'border-ink bg-ink font-semibold text-white' : disabled ? 'cursor-not-allowed border-dashed border-line-strong text-ink-3' : 'cursor-pointer border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink')}>
      {children}
    </button>
  )
}

function Bar({ v }: { v: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-[6px] w-28 overflow-hidden rounded-full bg-surface-3"><i className="block h-full rounded-full bg-da" style={{ width: `${Math.min(100, v * 100)}%` }} /></span>
      <span className="num w-11 text-right font-semibold text-ink">{Math.round(v * 100)}%</span>
    </span>
  )
}

export function Usage() {
  const cat = useCatalog()
  const terms = useTerms()
  const { lang } = useLang()
  const [q, setQ] = useSearchParams()
  const get = (k: string) => q.get(k) ?? ''
  const set = (patch: Record<string, string>) => {
    const n = new URLSearchParams(q)
    for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k))
    setQ(n, { replace: true })
  }
  const mode = get('mode') || 'hif'
  const tab = get('tab') || 'supports'
  const data = useApi<UsageData>(mode === 'hif' ? `api/usage/${mode}` : null)
  const [openCard, setOpenCard] = useState<string | null>(null)
  const [openItem, setOpenItem] = useState<string | null>(null)

  const d = data.data
  // 有数据的偶像卡，及其流派、角色
  const idolIds = useMemo(() => Object.keys(d?.idols ?? {}).sort(), [d])
  const styleOf = (id: string) => cat?.idols[id]?.style ?? ''
  const stylesWithData = useMemo(() => new Set(idolIds.map((id) => cat?.idols[id]?.style ?? '')), [idolIds, cat])
  const style = get('style') || [...stylesWithData][0] || ''
  const inStyle = idolIds.filter((id) => !style || styleOf(id) === style)
  const chars = [...new Set(inStyle.map(charOf))]
  const char = chars.includes(get('idol')) ? get('idol') : ''
  const inChar = inStyle.filter((id) => !char || charOf(id) === char)
  const card = inChar.includes(get('card')) ? get('card') : ''
  const scope = card ? [card] : inChar

  const supports = useMemo(() => (d ? aggregate<SupportUse>(scope.map((i) => d.idols[i].supports)) : []), [d, scope.join()])
  const items = useMemo(() => (d ? aggregate<ItemUse>(scope.map((i) => d.idols[i].items)) : []), [d, scope.join()])
  const cards = useMemo(() => (d ? aggregate<CardUse>(scope.map((i) => d.idols[i].cards)).filter((c) => sourceOf(c.id) !== 'idol') : []), [d, scope.join()])
  const memCards = useMemo(() => (d ? aggregate<MemCardUse>(scope.map((i) => d.idols[i].mem_cards ?? [])) : []), [d, scope.join()])
  const memItems = useMemo(() => (d ? aggregate<UsageRow>(scope.map((i) => d.idols[i].mem_items ?? [])) : []), [d, scope.join()])
  const records = scope.reduce((s, i) => s + (d?.idols[i]?.n ?? 0), 0)

  const scopeText = card ? `${cat?.idols[card]?.name ?? card} 的 ${records} 份记录`
    : `${scope.length} 张偶像卡（${records} 份记录）各自的比例取平均`

  return (
    <div>
      <PageHeader
        title="配置强度榜"
        sub={<>排行榜上每张偶像卡前 100 名的配置里，各支援卡、技能卡、P 道具出现的比例。出现得越多，说明和这张偶像卡越合得来。</>}
      />

      <div className="mb-5 space-y-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-12 text-[12.5px] text-ink-3">模式</span>
          {MODES.map((m) => <Chip key={m.key} on={mode === m.key} disabled={m.key !== 'hif'} hint={m.key !== 'hif' ? '游戏里只有 H.I.F 有排行榜，初和 N.I.A 没有可统计的记录' : undefined} onClick={() => set({ mode: m.key === 'hif' ? '' : m.key })}>{m.label}</Chip>)}
          <span className="text-[12px] text-ink-3">初和 N.I.A 游戏里没有排行榜</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-12 text-[12.5px] text-ink-3">流派</span>
          {Object.keys(IDOL_STYLE).map((s) => (
            <Chip key={s} on={style === s} disabled={!stylesWithData.has(s)} hint={!stylesWithData.has(s) ? '还没有数据' : undefined} onClick={() => set({ style: s, idol: '', card: '' })}>{terms.style[s]}</Chip>
          ))}
          {stylesWithData.size < Object.keys(IDOL_STYLE).length && <span className="text-[12px] text-ink-3">虚线的还没有数据</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-12 text-[12.5px] text-ink-3">偶像</span>
          <Select label="偶像" value={char} onChange={(v) => set({ idol: v, card: '' })} width="12rem"
            options={[{ value: '', label: `全部（${chars.length} 位）` }, ...chars.map((c) => {
              const ids = inStyle.filter((i) => charOf(i) === c)
              return { value: c, label: idolShort(cat, ids[0]), icon: <IdolThumb id={ids[0]} size={20} title={false} />, hint: `${ids.length} 张` }
            })]} />
          <span className="ml-3 text-[12.5px] text-ink-3">偶像卡</span>
          <Select label="偶像卡" value={card} onChange={(v) => set({ card: v })} width="18rem"
            options={[{ value: '', label: `全部（${inChar.length} 张）` }, ...inChar.map((i) => ({ value: i, label: cat?.idols[i]?.name ?? i, icon: <IdolThumb id={i} size={20} title={false} /> }))]} />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => set({ tab: v === 'supports' ? '' : String(v) })}>
        <TabsList className="mb-3">
          <TabsTrigger value="supports">支援卡</TabsTrigger>
          <TabsTrigger value="cards">技能卡</TabsTrigger>
          <TabsTrigger value="items">P 道具</TabsTrigger>
          <TabsTrigger value="memories">回忆</TabsTrigger>
        </TabsList>
      </Tabs>

      {data.error && <ErrorState error={data.error} onRetry={data.reload} />}
      {mode === 'hif' && !d && !data.error && <Skeleton className="h-96 rounded-2xl" />}
      {d && (
        <>
          <p className="mb-3 text-[12.5px] text-ink-3">
            {scopeText}。数据：{d.source.author}，{d.source.note}。
            {!card && <Help tip="每张偶像卡权重相同：某张卡在 A 偶像卡里 98%、B 偶像卡里没带，平均就是 49%。「常用的偶像卡」是比例 ≥ 50% 的偶像卡有几张。" />}
          </p>
          {tab === 'supports' && <SupportTable rows={supports} d={d} single={!!card} lang={lang} />}
          {tab === 'cards' && <CardTable rows={cards} single={!!card} onOpen={setOpenCard} />}
          {tab === 'items' && <ItemTable rows={items} single={!!card} onOpen={setOpenItem} />}
          {tab === 'memories' && (memCards.length === 0 ? <Empty>这批记录没有回忆数据。</Empty> : (
            <div className="space-y-6">
              <section>
                <h3 className="mb-2 text-[14px] font-bold text-ink">回忆带进来的技能卡 <span className="font-normal text-ink-3">· 编成的 4 张回忆里有没有带这张卡</span></h3>
                <MemCardTable rows={memCards} single={!!card} onOpen={setOpenCard} />
              </section>
              <section>
                <h3 className="mb-2 text-[14px] font-bold text-ink">回忆带进考试的 P 道具</h3>
                <ItemTable rows={memItems.map((r) => ({ ...r, rows: r.rows.map((x) => ({ ...x, up: 0 })) }))} single={!!card} onOpen={setOpenItem} noUp />
              </section>
              <p className="text-[12px] text-ink-3">记录里只有回忆带的卡和 P 道具，没有游戏里随机的回忆能力。</p>
            </div>
          ))}
        </>
      )}
      {openCard && cat?.cards[openCard] && <CardDetail id={openCard} c={cat.cards[openCard]} onClose={() => setOpenCard(null)} />}
      {openItem && cat && <ItemDetail id={openItem} cat={cat} onClose={() => setOpenItem(null)} />}
    </div>
  )
}

function Head({ cols }: { cols: React.ReactNode[] }) {
  return <thead className="bg-surface-2 text-[12px] text-ink-3"><tr>{cols.map((c, i) => <th key={i} className={cx('px-3 py-2 font-semibold', i < 2 ? 'text-left' : 'text-right')}>{c}</th>)}</tr></thead>
}

function SupportTable({ rows, d, single, lang }: { rows: Agg<SupportUse>[]; d: UsageData; single: boolean; lang: 'ja' | 'zh' }) {
  if (!rows.length) return <Empty>没有记录。</Empty>
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[640px] text-[13.5px]">
        <Head cols={['#', '支援卡', '出现比例', <>平均突破<Help tip="带这张卡的记录里，突破档（0–4）的平均" /></>, ...(single ? [] : ['常用的偶像卡'])]} />
        <tbody>
          {rows.slice(0, 40).map((r, i) => {
            const s = d.supports[r.id]
            const name = pairBi(s?.name, lang, r.id)
            return (
              <tr key={r.id} className="border-t border-line hover:bg-brand-tint">
                <td className="num w-10 px-3 py-1.5 text-ink-3">{i + 1}</td>
                <td className="px-3 py-1.5">
                  <Link to={`/cards?tab=supports&support=${r.id}`} className="flex items-center gap-2.5 hover:text-brand-ink">
                    <SupportThumb id={r.id} size={34} />
                    <span className="min-w-0">
                      <span className="block truncate">{name.main}</span>
                      <span className="flex items-center gap-1 text-[11px] text-ink-3">{s && <><RarityTag r={s.rarity} /><TypeChip t={s.type as never} /></>}{name.sub && <span className="truncate">{name.sub}</span>}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-1.5"><span className="flex justify-end"><Bar v={r.mean} /></span></td>
                <td className="num px-3 py-1.5 text-right text-ink-2">{avg(r.rows.map((x) => x.limit))?.toFixed(1) ?? '—'}</td>
                {!single && <td className="num px-3 py-1.5 text-right text-ink-2">{r.strong} / {r.cards}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CardTable({ rows, single, onOpen }: { rows: Agg<CardUse>[]; single: boolean; onOpen: (id: string) => void }) {
  const cat = useCatalog()
  if (!rows.length) return <Empty>没有记录。</Empty>
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[720px] text-[13.5px]">
        <Head cols={['#', '技能卡', '出现比例', <>带的话几张</>, <>回忆带入<Help tip="带的这张卡里，由回忆带进来（不是培育中拿的）的比例" /></>,
          <>权重<Help tip="强度榜 V 模型：这张卡在牌组里时本戦总分的相对变化（多张偶像卡时取平均）" /></>, ...(single ? [] : ['常用的偶像卡'])]} />
        <tbody>
          {rows.slice(0, 60).map((r, i) => {
            const c = cat?.cards[r.id]
            const w = avg(r.rows.map((x) => x.w))
            return (
              <tr key={r.id} className="border-t border-line hover:bg-brand-tint">
                <td className="num w-10 px-3 py-1.5 text-ink-3">{i + 1}</td>
                <td className="px-3 py-1.5">
                  <button type="button" onClick={() => onOpen(r.id)} className="flex cursor-pointer items-center gap-2.5 text-left hover:text-brand-ink">
                    {c ? <CardImage c={c} size={32} /> : <span className="size-8 rounded-lg bg-surface-3" />}
                    <span className="min-w-0">
                      <span className="block truncate">{cardName(cat, r.id)}</span>
                      {c && <span className="flex gap-1"><RarityTag r={c.rarity} /></span>}
                    </span>
                  </button>
                </td>
                <td className="px-3 py-1.5"><span className="flex justify-end"><Bar v={r.mean} /></span></td>
                <td className="num px-3 py-1.5 text-right text-ink-2">{avg(r.rows.map((x) => x.copies))?.toFixed(1)}</td>
                <td className="num px-3 py-1.5 text-right text-ink-2">{Math.round((avg(r.rows.map((x) => x.from_memory)) ?? 0) * 100)}%</td>
                <td className={cx('num px-3 py-1.5 text-right', w == null ? 'text-ink-3' : w >= 0 ? 'text-ink' : 'text-critical')}>{w == null ? '—' : `${w >= 0 ? '+' : ''}${w.toFixed(2)}`}</td>
                {!single && <td className="num px-3 py-1.5 text-right text-ink-2">{r.strong} / {r.cards}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="border-t border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-3">不含偶像固有卡（每张偶像卡自带）。</p>
    </div>
  )
}

function ItemTable({ rows, single, onOpen, noUp }: { rows: Agg<ItemUse>[]; single: boolean; onOpen: (id: string) => void; noUp?: boolean }) {
  const cat = useCatalog()
  const terms = useTerms()
  if (!rows.length) return <Empty>没有记录。</Empty>
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[600px] text-[13.5px]">
        <Head cols={['#', 'P 道具', '出现比例', ...(noUp ? [] : [<>特训后<Help tip="带的是特训后（名字带「+」）版本的比例" /></>]), ...(single ? [] : ['常用的偶像卡'])]} />
        <tbody>
          {rows.slice(0, 40).map((r, i) => {
            const it = cat?.items[r.id]
            return (
              <tr key={r.id} className="border-t border-line hover:bg-brand-tint">
                <td className="num w-10 px-3 py-1.5 text-ink-3">{i + 1}</td>
                <td className="px-3 py-1.5">
                  <Tip tip={<span className="whitespace-pre-line">{it?.text}</span>} wide>
                    <button type="button" onClick={() => onOpen(r.id)} className="flex cursor-pointer items-center gap-2.5 text-left hover:text-brand-ink">
                      <span className="size-8 shrink-0 overflow-hidden rounded-md bg-surface-2 ring-1 ring-line">{it?.asset && <img src={spriteUrl(it.asset)} alt="" className="size-full object-contain" />}</span>
                      <span className="truncate">{(it?.name ?? r.id).replace(/\+$/, '')}</span>
                      {it?.rarity && <RarityTag r={it.rarity} />}
                      {it?.plan && it.plan !== 'COMMON' && <Meta>{terms.plan[it.plan] ?? it.plan}</Meta>}
                    </button>
                  </Tip>
                </td>
                <td className="px-3 py-1.5"><span className="flex justify-end"><Bar v={r.mean} /></span></td>
                {!noUp && <td className="num px-3 py-1.5 text-right text-ink-2">{Math.round((avg(r.rows.map((x) => x.up)) ?? 0) * 100)}%</td>}
                {!single && <td className="num px-3 py-1.5 text-right text-ink-2">{r.strong} / {r.cards}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
      {!noUp && <p className="border-t border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-3">不含 H.I.F 人人都有的固定道具；特训前后算同一件。</p>}
    </div>
  )
}


function MemCardTable({ rows, single, onOpen }: { rows: Agg<MemCardUse>[]; single: boolean; onOpen: (id: string) => void }) {
  const cat = useCatalog()
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[600px] text-[13.5px]">
        <Head cols={['#', '技能卡', '出现比例', <>强化过<Help tip="回忆带进来的这张卡是强化版的比例" /></>, ...(single ? [] : ['常用的偶像卡'])]} />
        <tbody>
          {rows.slice(0, 40).map((r, i) => {
            const c = cat?.cards[r.id]
            return (
              <tr key={r.id} className="border-t border-line hover:bg-brand-tint">
                <td className="num w-10 px-3 py-1.5 text-ink-3">{i + 1}</td>
                <td className="px-3 py-1.5">
                  <button type="button" onClick={() => onOpen(r.id)} className="flex cursor-pointer items-center gap-2.5 text-left hover:text-brand-ink">
                    {c ? <CardImage c={c} size={32} /> : <span className="size-8 rounded-lg bg-surface-3" />}
                    <span className="truncate">{cardName(cat, r.id)}</span>
                    {c && <RarityTag r={c.rarity} />}
                  </button>
                </td>
                <td className="px-3 py-1.5"><span className="flex justify-end"><Bar v={r.mean} /></span></td>
                <td className="num px-3 py-1.5 text-right text-ink-2">{Math.round((avg(r.rows.map((x) => x.upgraded)) ?? 0) * 100)}%</td>
                {!single && <td className="num px-3 py-1.5 text-right text-ink-2">{r.strong} / {r.cards}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
