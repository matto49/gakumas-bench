import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import type { CatalogCard, CatalogThing } from '../lib/api'
import { spriteUrl, useCatalog } from '../lib/catalog'
import { PLAN } from '../lib/game'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select } from '../components/Select'
import { Empty, PageHeader, Skeleton } from '../components/ui'
import { CardDetail, CardImage, CardTags, Meta, RarityTag, SOURCE, sourceOf, UP_LABEL } from '../components/CardDetail'

/** 牌库：游戏里的技能卡、饮料、P 道具图鉴。数据是 GKMS 主数据生成的 catalog.json */

const RARITY_ORDER = ['LEGEND', 'SSR', 'SR', 'R', 'N']
const PLAN_ORDER = ['PLAN1', 'PLAN2', 'PLAN3', 'COMMON']
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
