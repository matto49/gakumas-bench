import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import type { CatalogCard, CatalogThing } from '../lib/api'
import { spriteUrl, useCatalog } from '../lib/catalog'
import { PLAN } from '../lib/game'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select } from '../components/Select'
import { cx, Empty, PageHeader, Skeleton } from '../components/ui'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** 牌库：游戏里的技能卡、饮料、P 道具图鉴。数据是 GKMS 主数据生成的 catalog.json */

const CATEGORY: Record<string, string> = { ACTIVE_SKILL: 'アクティブ', MENTAL_SKILL: 'メンタル', TROUBLE: 'トラブル' }
const RARITY_ORDER = ['LEGEND', 'SSR', 'SR', 'R', 'N']
const PLAN_ORDER = ['PLAN1', 'PLAN2', 'PLAN3', 'COMMON']
const UP_LABEL = ['未强化', '强化 +', '强化 ++', '强化 +++']

// 编号 p_card-<计划>-<来源>-…：ido 偶像固有、sup 支援卡、act / men 通用
function sourceOf(id: string) {
  const k = id.split('-')[2] ?? ''
  return k === 'ido' ? 'idol' : k === 'sup' ? 'support' : 'common'
}
const SOURCE: Record<string, string> = { common: '通用', idol: '偶像固有', support: '支援卡' }

const RARITY_STYLE: Record<string, string> = {
  LEGEND: 'bg-[linear-gradient(135deg,oklch(0.8_0.12_330),oklch(0.82_0.12_200),oklch(0.86_0.13_90))] text-ink',
  SSR: 'bg-[oklch(0.85_0.13_85)] text-ink',
  SR: 'bg-[oklch(0.82_0.07_250)] text-ink',
  R: 'bg-surface-3 text-ink-2',
  N: 'bg-surface-2 text-ink-3',
}

function RarityTag({ r }: { r?: string }) {
  if (!r) return null
  return <span className={cx('inline-flex h-[18px] items-center rounded-[4px] px-1.5 text-[10.5px] font-bold italic', RARITY_STYLE[r] ?? 'bg-surface-2 text-ink-2')}>{r}</span>
}

function Meta({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-[18px] items-center rounded-[4px] border border-line px-1.5 text-[11px] text-ink-2">{children}</span>
}

const opt = (all: string, entries: [string, string][]) => [{ value: '', label: all }, ...entries.map(([value, label]) => ({ value, label }))]

export function Cards() {
  const cat = useCatalog()
  const [q, setQ] = useSearchParams()
  const tab = q.get('tab') ?? 'cards'
  const get = (k: string) => q.get(k) ?? ''
  const update = (patch: Record<string, string>) => {
    const n = new URLSearchParams(q)
    for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k))
    setQ(n, { replace: true })
  }
  const text = get('q').trim().toLowerCase()

  const cards = useMemo(() => {
    if (!cat) return []
    const up = Number(get('up') || 0)
    return Object.entries(cat.cards)
      .filter(([, c]) => c.category !== 'TROUBLE' || get('cat') === 'TROUBLE')
      .filter(([id, c]) =>
        (!get('plan') || c.plan === get('plan')) &&
        (!get('rarity') || c.rarity === get('rarity')) &&
        (!get('cat') || c.category === get('cat')) &&
        (!get('src') || sourceOf(id) === get('src')),
      )
      .map(([id, c]) => {
        const lv = c.up[String(up)] ?? c.up['0'] ?? { name: c.name, text: '' }
        return { id, c, name: lv.name, text: lv.text }
      })
      .filter((x) => !text || x.name.toLowerCase().includes(text) || x.text.toLowerCase().includes(text))
      .sort((a, b) =>
        RARITY_ORDER.indexOf(a.c.rarity) - RARITY_ORDER.indexOf(b.c.rarity) ||
        PLAN_ORDER.indexOf(a.c.plan) - PLAN_ORDER.indexOf(b.c.plan) ||
        a.id.localeCompare(b.id),
      )
  }, [cat, q])

  const things = (m: Record<string, CatalogThing> | undefined) =>
    Object.entries(m ?? {})
      .filter(([, d]) => (!get('plan') || d.plan === get('plan')) && (!get('rarity') || d.rarity === get('rarity')))
      .filter(([, d]) => !text || d.name.toLowerCase().includes(text) || (d.text ?? '').toLowerCase().includes(text))
      .sort(([a, x], [b, y]) => RARITY_ORDER.indexOf(x.rarity ?? '') - RARITY_ORDER.indexOf(y.rarity ?? '') || a.localeCompare(b))
  const drinks = useMemo(() => things(cat?.drinks), [cat, q])
  // P 道具：同一个道具按偶像分了很多份，名字和效果都一样，只留一条
  const items = useMemo(() => {
    const seen = new Set<string>()
    return things(cat?.items).filter(([, d]) => {
      const k = `${d.name}\u0000${d.text}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }, [cat, q])

  const counts = { cards: cards.length, drinks: drinks.length, items: items.length }
  const open = get('card')
  const planOpts = opt('全部计划', PLAN_ORDER.map((p) => [p, PLAN[p]]))
  const rarityOpts = opt('全部稀有度', (tab === 'cards' ? RARITY_ORDER : RARITY_ORDER.slice(1)).map((r) => [r, r]))

  return (
    <div>
      <PageHeader title="牌库" sub="游戏里的技能卡、饮料和 P 道具，数据来自 GKMS 读的主数据，和裁判用的是同一份。" />

      <Tabs value={tab} onValueChange={(v) => update({ tab: v === 'cards' ? '' : String(v), rarity: '', cat: '', src: '', up: '' })}>
        <TabsList className="mb-4">
          <TabsTrigger value="cards">技能卡</TabsTrigger>
          <TabsTrigger value="drinks">饮料</TabsTrigger>
          <TabsTrigger value="items">P 道具</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative w-64 max-w-full">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input value={get('q')} onChange={(e) => update({ q: e.target.value })} placeholder="搜名字或效果，如 好印象" aria-label="搜索" className="h-8 rounded-full pl-8" />
        </div>
        <Select label="培育计划" value={get('plan')} onChange={(v) => update({ plan: v })} options={planOpts} />
        <Select label="稀有度" value={get('rarity')} onChange={(v) => update({ rarity: v })} options={rarityOpts} />
        {tab === 'cards' && (
          <>
            <Select label="类型" value={get('cat')} onChange={(v) => update({ cat: v })} options={opt('全部类型', [['ACTIVE_SKILL', 'アクティブ'], ['MENTAL_SKILL', 'メンタル'], ['TROUBLE', 'トラブル']])} />
            <Select label="来源" value={get('src')} onChange={(v) => update({ src: v })} options={opt('全部来源', Object.entries(SOURCE))} />
            <Select label="强化" value={get('up')} onChange={(v) => update({ up: v })} options={UP_LABEL.map((l, i) => ({ value: i ? String(i) : '', label: l }))} />
          </>
        )}
        <span className="num ml-auto text-[12.5px] text-ink-3">{counts[tab as keyof typeof counts]} 条</span>
      </div>

      {!cat && <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>}

      {cat && tab === 'cards' && (
        cards.length === 0 ? <Empty>没有符合条件的技能卡，换个关键词或放宽筛选。</Empty> : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
            {cards.map(({ id, c, name, text: t }) => <CardTile key={id} id={id} c={c} name={name} text={t} onOpen={() => update({ card: id })} />)}
          </div>
        )
      )}

      {cat && open && cat.cards[open] && <CardDetail id={open} c={cat.cards[open]} onClose={() => update({ card: '' })} />}

      {cat && tab !== 'cards' && (
        (tab === 'drinks' ? drinks : items).length === 0 ? <Empty>没有符合条件的{tab === 'drinks' ? '饮料' : 'P 道具'}。</Empty> : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
            {(tab === 'drinks' ? drinks : items).map(([id, d]) => <ThingTile key={id} d={d} />)}
          </div>
        )
      )}
    </div>
  )
}

function CardImage({ c, size }: { c: CatalogCard; size: number }) {
  return (
    <div className="shrink-0 overflow-hidden rounded-lg bg-surface-3 ring-1 ring-line" style={{ width: size, height: size }}>
      {c.asset ? <img src={spriteUrl(c.asset)} alt="" width={size} height={size} loading="lazy" className="size-full object-cover" /> : <span className="grid size-full place-items-center text-[13px] font-semibold text-ink-3">{c.name.slice(0, 2)}</span>}
    </div>
  )
}

function CardTags({ id, c }: { id: string; c: CatalogCard }) {
  return (
    <div className="flex flex-wrap gap-1">
      <RarityTag r={c.rarity} />
      <Meta>{PLAN[c.plan] ?? c.plan}</Meta>
      <Meta>{CATEGORY[c.category] ?? c.category}</Meta>
      {sourceOf(id) !== 'common' && <Meta>{SOURCE[sourceOf(id)]}</Meta>}
    </div>
  )
}

function CardTile({ id, c, name, text, onOpen }: { id: string; c: CatalogCard; name: string; text: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${name}，看强化前后的效果`}
      className="flex cursor-pointer gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-colors duration-150 hover:border-brand focus-visible:border-brand"
    >
      <CardImage c={c} size={64} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold text-ink" title={id}>{name}</p>
        <div className="mt-1"><CardTags id={id} c={c} /></div>
        {text && <p className="mt-1.5 text-[12.5px] leading-relaxed whitespace-pre-line text-ink-2">{text}</p>}
      </div>
    </button>
  )
}

/** 一张卡的详情：未强化到 +++ 并排，比上一档新增或变了的行用浅橙底标出来 */
function CardDetail({ id, c, onClose }: { id: string; c: CatalogCard; onClose: () => void }) {
  const levels = Object.entries(c.up).sort((a, b) => Number(a[0]) - Number(b[0]))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <CardImage c={c} size={72} />
            <div className="min-w-0">
              <DialogTitle className="text-[18px] font-bold">{c.name}</DialogTitle>
              <div className="mt-1.5"><CardTags id={id} c={c} /></div>
              <DialogDescription className="mt-1 font-mono text-[11px]">{id}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {levels.length === 1 && <p className="text-[12.5px] text-ink-3">这张卡不能强化。</p>}
        <div className={cx('grid gap-3', levels.length > 1 && 'sm:grid-cols-2')}>
          {levels.map(([lv, x], k) => {
            const prev = k > 0 ? new Set(levels[k - 1][1].text.split('\n')) : null
            return (
              <div key={lv} className={cx('rounded-xl border p-3', k === levels.length - 1 && levels.length > 1 ? 'border-brand/50' : 'border-line')}>
                <p className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="font-bold text-ink">{x.name}</span>
                  <span className="text-[11.5px] text-ink-3">{UP_LABEL[Number(lv)] ?? `强化 ${lv}`}</span>
                </p>
                <ul className="space-y-0.5 text-[12.5px] leading-relaxed text-ink-2">
                  {x.text.split('\n').map((line, n) => (
                    <li key={n} className={cx('rounded px-1 -mx-1', prev && !prev.has(line) && 'bg-brand-soft text-ink')}>{line}</li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
        {levels.length > 1 && <p className="text-[12px] text-ink-3"><span className="rounded bg-brand-soft px-1 text-ink">浅橙底</span> 是比上一档新增或变了的行。</p>}
      </DialogContent>
    </Dialog>
  )
}

function ThingTile({ d }: { d: CatalogThing }) {
  return (
    <div className="flex gap-3 rounded-xl border border-line bg-surface p-3">
      {d.asset && (
        <img src={spriteUrl(d.asset)} alt="" width={48} height={48} loading="lazy" className="size-12 shrink-0 rounded-lg bg-surface-2 object-contain p-0.5 ring-1 ring-line" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-bold text-ink">{d.name}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          <RarityTag r={d.rarity} />
          {d.plan && <Meta>{PLAN[d.plan] ?? d.plan}</Meta>}
        </div>
        {d.text && <p className="mt-1.5 text-[12.5px] leading-relaxed whitespace-pre-line text-ink-2">{d.text}</p>}
      </div>
    </div>
  )
}
