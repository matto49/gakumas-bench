import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import type { CatalogCard, CatalogThing } from '../lib/api'
import { spriteUrl, useCatalog, useLang, useTerms } from '../lib/catalog'
import { useApi } from '../lib/hooks'
import { SUPPORT_TYPE_LABEL, type SupportCatalog } from '../lib/supports'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select } from '../components/Select'
import { CopyId, Empty, PageHeader, Skeleton } from '../components/ui'
import { CardDetail, CardImage, CardTags, Meta, RarityTag, SOURCE, sourceOf, UnlockTag, UP_LABEL } from '../components/CardDetail'
import { IdolDetail, IdolTile, MemoryTile } from '../components/IdolCard'
import { SupportDetail, SupportTile } from '../components/SupportCard'
import { ItemDetail } from '../components/ItemDetail'

/** 游戏资源一览（原「牌库」）：游戏里的技能卡、饮料、P 道具、偶像卡、回忆能力图鉴，带编号（上传编成时要填）。数据是 GKMS 主数据生成的 catalog.json */

const RARITY_ORDER = ['LEGEND', 'UR', 'SSR', 'SR', 'R', 'N']
const PLAN_ORDER = ['PLAN1', 'PLAN2', 'PLAN3', 'COMMON']
/** P 等级筛选：只看到这个制作人等级为止能拿到的（解锁等级不超过它，或不靠等级解锁） */
const LV_STEPS = [10, 20, 30, 40, 50, 60, 70]
const withinLv = (unlock: number | undefined, lv: number) => !lv || !unlock || unlock <= lv
/** 技能卡分三组：基础卡（通用，按解锁 P 等级，开局就有的算 0）→ 角色卡（偶像固有）→ 特殊卡（支援卡事件、传说、トラブル） */
const GROUPS = [
  { key: 'base', title: '基础卡', note: '按解锁 P 等级排，开局就有的在最前' },
  { key: 'idol', title: '角色卡', note: '偶像固有' },
  { key: 'special', title: '特殊卡', note: '支援卡事件、传说、トラブル' },
] as const
function groupOf(id: string, c: CatalogCard): { g: number; sub: number } {
  if (c.category === 'TROUBLE') return { g: 2, sub: 2 }
  if (c.rarity === 'LEGEND') return { g: 2, sub: 1 }
  const src = sourceOf(id)
  if (src === 'support') return { g: 2, sub: 0 }
  if (src === 'idol') return { g: 1, sub: 0 }
  return { g: 0, sub: 0 }
}
const opt = (all: string, entries: [string, string][]) => [{ value: '', label: all }, ...entries.map(([value, label]) => ({ value, label }))]

export function Cards() {
  const cat = useCatalog()
  const terms = useTerms()
  const { lang } = useLang()
  const [q, setQ] = useSearchParams()
  const tab = q.get('tab') ?? 'cards'
  // 支援卡目录单独一份（完整主数据生成，约 700 KB），只在用到时取
  // P 道具详情要列「哪些支援卡事件给它」，也用这份
  const sup = useApi<SupportCatalog>(tab === 'supports' || q.get('support') || q.get('item') ? 'api/supports' : null)
  const get = (k: string) => q.get(k) ?? ''
  // flushSync：搜索框的值来自 URL，同步更新才不会打断输入法组字（默认走 startTransition，React 会把输入框值改回旧值）
  const update = (patch: Record<string, string>, flushSync = false) => {
    const n = new URLSearchParams(q)
    for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k))
    setQ(n, { replace: true, flushSync })
  }
  const text = get('q').trim().toLowerCase()

  const cards = useMemo(() => {
    if (!cat) return []
    const up = Number(get('up') || 0)
    const lv = Number(get('lv') || 0)
    return Object.entries(cat.cards)
      .filter(([, c]) => c.category !== 'TROUBLE' || get('cat') === 'TROUBLE')
      .filter(([id, c]) =>
        (!get('plan') || c.plan === get('plan')) &&
        (!get('rarity') || c.rarity === get('rarity')) &&
        (!get('cat') || c.category === get('cat')) &&
        (!get('src') || sourceOf(id) === get('src')) &&
        withinLv(c.unlock, lv),
      )
      .map(([id, c]) => {
        const lv = c.up[String(up)] ?? c.up['0'] ?? { name: c.name, text: '' }
        return { id, c, name: lv.name, text: lv.text, ...groupOf(id, c) }
      })
      .filter((x) => !text || x.name.toLowerCase().includes(text) || x.text.toLowerCase().includes(text))
      .sort((a, b) =>
        a.g - b.g || a.sub - b.sub ||
        (a.g === 0 ? (a.c.unlock ?? 0) - (b.c.unlock ?? 0) : 0) ||
        PLAN_ORDER.indexOf(a.c.plan) - PLAN_ORDER.indexOf(b.c.plan) ||
        RARITY_ORDER.indexOf(b.c.rarity) - RARITY_ORDER.indexOf(a.c.rarity) ||
        a.id.localeCompare(b.id),
      )
  }, [cat, q])

  const things = (m: Record<string, CatalogThing> | undefined) =>
    Object.entries(m ?? {})
      .filter(([, d]) => (!get('plan') || d.plan === get('plan')) && (!get('rarity') || d.rarity === get('rarity')) && withinLv(d.unlock, Number(get('lv') || 0)))
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

  // 偶像卡：按编号排（同一角色的卡排在一起）。名字、编号、固有技能卡和 P 道具的名字都能搜
  const idols = useMemo(() => Object.entries(cat?.idols ?? {})
    .filter(([, d]) => (!get('plan') || d.plan === get('plan')) && (!get('rarity') || d.rarity === get('rarity')) && (!get('style') || d.style === get('style')))
    .filter(([id, d]) => {
      if (!text) return true
      const hay = [d.name, id, d.card && cat?.cards[d.card]?.name, d.item && cat?.items[d.item]?.name, d.item_up && cat?.items[d.item_up]?.name]
      return hay.some((x) => x && x.toLowerCase().includes(text))
    })
    .sort(([a], [b]) => a.localeCompare(b)), [cat, q])
  // 回忆能力：只有效果文字，没有名字。通用的计划是空，筛选里叫 COMMON
  const memories = useMemo(() => Object.entries(cat?.memories ?? {})
    .filter(([, d]) => (!get('plan') || (d.plan || 'COMMON') === get('plan')) && (!get('rarity') || d.rarity === get('rarity')))
    .filter(([id, d]) => !text || (d.text ?? '').toLowerCase().includes(text) || id.includes(text))
    .sort(([a], [b]) => a.localeCompare(b)), [cat, q])

  // 支援卡：SSR 在前，同稀有度里新卡在前（编号大的新）。名字（日、中）、技能、事件文字都能搜
  const supports = useMemo(() => Object.entries(sup.data?.cards ?? {})
    .filter(([, d]) => (!get('plan') || d.plan === get('plan')) && (!get('rarity') || d.rarity === get('rarity')) && (!get('type') || d.type === get('type')))
    .filter(([id, d]) => {
      if (!text) return true
      const hay = [id, d.name.ja, d.name.zh, ...d.abilities.flatMap((a) => a.steps.flatMap((s) => [s.ja, s.zh])), ...d.events.flatMap((e) => [e.ja, e.zh, e.card && cat?.cards[e.card]?.name, e.item && cat?.items[e.item]?.name])]
      return hay.some((x) => x && x.toLowerCase().includes(text))
    })
    .sort(([a, x], [b, y]) => RARITY_ORDER.indexOf(x.rarity) - RARITY_ORDER.indexOf(y.rarity) || b.localeCompare(a)), [sup.data, cat, q])

  const counts = { cards: cards.length, drinks: drinks.length, items: items.length, idols: idols.length, supports: supports.length, memories: memories.length }
  const open = get('card')
  const openIdol = get('idol')
  const openSupport = get('support')
  const openItem = get('item')
  const planOpts = opt('全部计划', PLAN_ORDER.map((p) => [p, p === 'COMMON' ? '通用' : terms.plan[p]]))
  const rarities = tab === 'cards' ? ['LEGEND', 'SSR', 'SR', 'R', 'N'] : tab === 'memories' ? ['UR', 'SSR', 'SR', 'R'] : tab === 'idols' || tab === 'supports' ? ['SSR', 'SR', 'R'] : ['SSR', 'SR', 'R', 'N']
  const rarityOpts = opt('全部稀有度', rarities.map((r) => [r, r]))

  return (
    <div>
      <PageHeader title="游戏资源一览" sub="技能卡、饮料、P 道具、偶像卡、支援卡和回忆能力，数据直接取自游戏。编号可以复制，上传编成时要填。" />

      <Tabs value={tab} onValueChange={(v) => update({ tab: v === 'cards' ? '' : String(v), rarity: '', cat: '', src: '', up: '', style: '', type: '' })}>
        <TabsList className="mb-4">
          <TabsTrigger value="cards">技能卡</TabsTrigger>
          <TabsTrigger value="drinks">饮料</TabsTrigger>
          <TabsTrigger value="items">P 道具</TabsTrigger>
          <TabsTrigger value="idols">偶像卡</TabsTrigger>
          <TabsTrigger value="supports">支援卡</TabsTrigger>
          <TabsTrigger value="memories">回忆能力</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative w-64 max-w-full">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input value={get('q')} onChange={(e) => update({ q: e.target.value }, true)} placeholder={tab === 'idols' ? '搜名字、编号或固有卡 / P 道具' : tab === 'supports' ? '搜名字、技能或事件，如 SP レッスン' : tab === 'memories' ? '搜效果，如 体力回復' : '搜名字或效果，如 好印象'} aria-label="搜索" className="h-8 rounded-full pl-8" />
        </div>
        <Select label="培育计划" value={get('plan')} onChange={(v) => update({ plan: v })} options={tab === 'idols' ? planOpts.filter((o) => o.value !== 'COMMON') : planOpts} />
        <Select label="稀有度" value={get('rarity')} onChange={(v) => update({ rarity: v })} options={rarityOpts} />
        {tab === 'supports' && <Select label="属性" value={get('type')} onChange={(v) => update({ type: v })} options={opt('全部属性', Object.entries(SUPPORT_TYPE_LABEL[lang]))} />}
        {tab === 'idols' && <Select label="流派" value={get('style')} onChange={(v) => update({ style: v })} options={opt('全部流派', Object.entries(terms.style))} />}
        {(tab === 'cards' || tab === 'drinks') && (
          <Select label="P 等级" value={get('lv')} onChange={(v) => update({ lv: v })}
            options={[{ value: '', label: '全部 P 等级' }, ...LV_STEPS.map((n) => ({ value: String(n), label: `到 PLv ${n} 能拿到的` }))]} />
        )}
        {tab === 'cards' && (
          <>
            <Select label="类型" value={get('cat')} onChange={(v) => update({ cat: v })} options={opt('全部类型', Object.entries(terms.category))} />
            <Select label="来源" value={get('src')} onChange={(v) => update({ src: v })} options={opt('全部来源', Object.entries(SOURCE))} />
            <Select label="强化" value={get('up')} onChange={(v) => update({ up: v })} options={UP_LABEL.map((l, i) => ({ value: i ? String(i) : '', label: l }))} />
          </>
        )}
        <span className="num ml-auto text-[12.5px] text-ink-3">{counts[tab as keyof typeof counts]} 条</span>
      </div>

      {!cat && <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>}

      {cat && tab === 'cards' && (
        cards.length === 0 ? <Empty>没有符合条件的技能卡，换个关键词或放宽筛选。</Empty> : (
          <div className="space-y-6">
            {GROUPS.map((grp, gi) => {
              const list = cards.filter((x) => x.g === gi)
              if (list.length === 0) return null
              return (
                <section key={grp.key} aria-labelledby={`grp-${grp.key}`}>
                  <h2 id={`grp-${grp.key}`} className="mb-2 flex items-baseline gap-2 text-[14px] font-bold text-ink">
                    {grp.title}<span className="num text-[12px] font-normal text-ink-3">{list.length} 张 · {grp.note}</span>
                  </h2>
                  <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
                    {list.map(({ id, c, name, text: t }) => <CardTile key={id} id={id} c={c} name={name} text={t} onOpen={() => update({ card: id })} />)}
                  </div>
                </section>
              )
            })}
          </div>
        )
      )}

      {cat && open && cat.cards[open] && <CardDetail id={open} c={cat.cards[open]} onClose={() => update({ card: '' })} />}

      {cat && tab === 'idols' && (
        idols.length === 0 ? <Empty>没有符合条件的偶像卡。</Empty> : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {idols.map(([id, d]) => <IdolTile key={id} id={id} d={d} cat={cat} onOpen={() => update({ idol: id })} />)}
          </div>
        )
      )}

      {cat && openIdol && cat.idols[openIdol] && (
        <IdolDetail id={openIdol} d={cat.idols[openIdol]} cat={cat} onClose={() => update({ idol: '' })} onOpenCard={(c) => update({ idol: '', card: c })} />
      )}

      {tab === 'supports' && (
        sup.error ? <Empty>支援卡目录没取到：{sup.error.message}</Empty>
          : !sup.data || !cat ? <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
          : supports.length === 0 ? <Empty>没有符合条件的支援卡。</Empty> : (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
              {supports.map(([id, d]) => <SupportTile key={id} id={id} d={d} cat={cat} onOpen={() => update({ support: id })} />)}
            </div>
          )
      )}

      {cat && sup.data && openSupport && sup.data.cards[openSupport] && (
        <SupportDetail id={openSupport} d={sup.data.cards[openSupport]} all={sup.data} cat={cat} onClose={() => update({ support: '' })} />
      )}

      {cat && openItem && cat.items[openItem] && <ItemDetail id={openItem} cat={cat} supports={sup.data} onClose={() => update({ item: '' })} />}

      {cat && tab === 'memories' && (
        memories.length === 0 ? <Empty>没有符合条件的回忆能力。</Empty> : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
            {memories.map(([id, d]) => <MemoryTile key={id} id={id} d={d} />)}
          </div>
        )
      )}

      {cat && (tab === 'drinks' || tab === 'items') && (
        (tab === 'drinks' ? drinks : items).length === 0 ? <Empty>没有符合条件的{tab === 'drinks' ? '饮料' : 'P 道具'}。</Empty> : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
            {(tab === 'drinks' ? drinks : items).map(([id, d]) => <ThingTile key={id} id={id} d={d} onOpen={tab === 'items' ? () => update({ item: id }) : undefined} />)}
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

function ThingTile({ id, d, onOpen }: { id: string; d: CatalogThing; onOpen?: () => void }) {
  const terms = useTerms()
  return (
    <div className="group relative flex gap-3 rounded-xl border border-line bg-surface p-3 transition-colors duration-150 hover:border-line-strong">
      {d.asset && (
        <img src={spriteUrl(d.asset)} alt="" width={48} height={48} loading="lazy" className="size-12 shrink-0 rounded-lg bg-surface-2 object-contain p-0.5 ring-1 ring-line" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-bold text-ink">
          {onOpen ? <button type="button" onClick={onOpen} className="cursor-pointer text-left after:absolute after:inset-0 after:rounded-xl group-hover:text-brand-ink">{d.name}</button> : d.name}
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          <RarityTag r={d.rarity} />
          {d.plan && <Meta>{terms.plan[d.plan] ?? d.plan}</Meta>}
          {d.unlock ? <UnlockTag lv={d.unlock} /> : null}
        </div>
        {d.text && <p className="mt-1.5 text-[12.5px] leading-relaxed whitespace-pre-line text-ink-2">{d.text}</p>}
        <CopyId id={id} className="relative z-10 mt-1" />
      </div>
    </div>
  )
}
