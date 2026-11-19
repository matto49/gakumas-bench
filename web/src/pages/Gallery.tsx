import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { useApi } from '../lib/hooks'
import { useLang } from '../lib/catalog'
import { pick } from '../lib/supports'
import {
  ART_LABEL, bustupUrl, cardArtUrl, costumeUrl, headUrl, standUrl, supportArtUrl,
  type Gallery as GalleryData, type GalleryCard, type GalleryChar, type GalleryOutfit,
} from '../lib/gallery'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cx, Empty, ErrorState, PageHeader, Skeleton } from '../components/ui'

/** 图鉴：每个偶像的立绘、偶像卡卡面（含「光景」换装卡面）、支援卡卡面、衣装、发型。
 * 数据 api/site/gallery（gkbench/gallery.py），图在 sprites/gallery/（gkmas-assets/tools/export_gallery.py 导出）。
 * 不选角色时是立绘墙；选了角色（?c=）按标签页看；点任何一张图放大，左右键翻 */

type Tab = 'cards' | 'supports' | 'costumes' | 'heads'
const TABS: { key: Tab; label: string }[] = [
  { key: 'cards', label: '卡面' },
  { key: 'supports', label: '支援卡' },
  { key: 'costumes', label: '衣装' },
  { key: 'heads', label: '发型' },
]

/** 放大看的一张图。arts：偶像卡卡面可以切特训前 / 后 */
type ViewItem = { key: string; title: string; sub?: string; note?: string; src: (v: number) => string; arts?: number[]; wide?: boolean; plain?: boolean }

export function Gallery() {
  const g = useApi<GalleryData>('api/site/gallery')
  const { lang } = useLang()
  const [q, setQ] = useSearchParams()
  const c = q.get('c') ?? ''
  const tab = (TABS.some((t) => t.key === q.get('tab')) ? q.get('tab') : 'cards') as Tab
  const art = q.get('v') === '0' ? 0 : 1 // 卡面网格默认看特训后
  const [view, setView] = useState<{ list: ViewItem[]; i: number; v: number } | null>(null)
  const update = (patch: Record<string, string>) => {
    const n = new URLSearchParams(q)
    for (const [k, val] of Object.entries(patch)) (val ? n.set(k, val) : n.delete(k))
    setQ(n, { replace: true })
  }

  const data = g.data
  const char = data?.characters.find((x) => x.id === c)
  const counts = useMemo(() => {
    const m = new Map<string, { cards: number; costumes: number }>()
    for (const x of data?.cards ?? []) m.set(x.char, { cards: (m.get(x.char)?.cards ?? 0) + 1, costumes: m.get(x.char)?.costumes ?? 0 })
    for (const x of data?.costumes ?? []) m.set(x.char, { cards: m.get(x.char)?.cards ?? 0, costumes: (m.get(x.char)?.costumes ?? 0) + 1 })
    return m
  }, [data])

  if (g.error) return <ErrorState error={g.error} onRetry={g.reload} />
  const total = data && `${data.characters.length} 位偶像 · 卡面 ${data.cards.reduce((s, x) => s + x.arts.length, 0)} 张 · 支援卡 ${data.supports.length} 张 · 衣装 ${data.costumes.length} 套 · 发型 ${data.heads.length} 个`

  return (
    <div>
      <PageHeader
        title="图鉴"
        sub={<>立绘、卡面、衣装和发型，从游戏资源里导出{total && <>：{total}</>}。点图放大，左右键翻页。</>}
        right={data?.source?.master_date && <span className="text-[12px] text-ink-3">游戏数据 {data.source.master_date}</span>}
      />

      {!data ? (
        <Skeleton className="h-[480px] rounded-2xl" />
      ) : (
        <>
          <CharPicker chars={data.characters} cur={c} lang={lang} onPick={(id) => update({ c: id, tab: '' })} />
          {!char ? (
            <StandWall chars={data.characters} counts={counts} lang={lang} onPick={(id) => update({ c: id })} />
          ) : (
            <CharView
              g={data} ch={char} tab={tab} art={art} lang={lang}
              onTab={(t) => update({ tab: t === 'cards' ? '' : t })}
              onArt={(v) => update({ v: v === 1 ? '' : String(v) })}
              onView={(list, i, v) => setView({ list, i, v })}
            />
          )}
        </>
      )}

      {view && <Viewer view={view} onChange={setView} onClose={() => setView(null)} />}
    </div>
  )
}

/** 角色一排：小头像 + 名字，第一个是「全部」（回到立绘墙） */
function CharPicker({ chars, cur, lang, onPick }: { chars: GalleryChar[]; cur: string; lang: 'ja' | 'zh'; onPick: (id: string) => void }) {
  const chip = (on: boolean) => cx(
    'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-[13px] font-semibold transition-colors duration-150',
    on ? 'bg-ink text-white' : 'bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink',
  )
  return (
    <div className="mb-6 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]" role="tablist" aria-label="选偶像">
      <button type="button" role="tab" aria-selected={!cur} onClick={() => onPick('')} className={cx(chip(!cur), 'pl-3')}>全部</button>
      {chars.map((x) => (
        <button key={x.id} type="button" role="tab" aria-selected={cur === x.id} onClick={() => onPick(x.id)} className={chip(cur === x.id)}>
          {/* 半身像只取头部：放大两倍、从顶上对齐 */}
          <span className="size-7 shrink-0 overflow-hidden rounded-full bg-white ring-1 ring-line">
            {x.bustup && <img src={bustupUrl(x.id)} alt="" loading="lazy" className="size-full origin-[50%_8%] scale-[2.3] object-cover object-top" />}
          </span>
          {pick(x.name, lang)}
        </button>
      ))}
    </div>
  )
}

/** 立绘墙：每位偶像一格全身立绘（没有全身的用半身像），点进去看她的卡面和衣装 */
function StandWall({ chars, counts, lang, onPick }: { chars: GalleryChar[]; counts: Map<string, { cards: number; costumes: number }>; lang: 'ja' | 'zh'; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
      {chars.map((x) => {
        const n = counts.get(x.id)
        return (
          <button key={x.id} type="button" onClick={() => onPick(x.id)}
            className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-surface-2 text-left ring-1 ring-line transition-shadow duration-150 hover:ring-line-strong hover:shadow-[0_12px_30px_-18px_rgba(20,16,30,.45)]">
            <div className="relative h-[300px] overflow-hidden bg-gradient-to-b from-surface-2 to-surface-3">
              {(x.stand || x.bustup) && (
                <img src={x.stand ? standUrl(x.id) : bustupUrl(x.id)} alt="" loading="lazy"
                  className={cx('absolute inset-x-0 mx-auto transition-transform duration-300 group-hover:scale-[1.03]', x.stand ? 'bottom-0 h-[290px] w-auto max-w-none' : 'bottom-0 w-full')} />
              )}
            </div>
            <div className="bg-surface px-3 py-2.5">
              <p className="font-bold text-ink">{pick(x.name, lang)}</p>
              <p className="num text-[12px] text-ink-3">{n ? `卡面 ${n.cards} 套 · 衣装 ${n.costumes} 套` : '只有半身像'}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function CharView({ g, ch, tab, art, lang, onTab, onArt, onView }: {
  g: GalleryData; ch: GalleryChar; tab: Tab; art: number; lang: 'ja' | 'zh'
  onTab: (t: Tab) => void; onArt: (v: number) => void; onView: (list: ViewItem[], i: number, v: number) => void
}) {
  const cards = g.cards.filter((x) => x.char === ch.id)
  const sups = g.supports.filter((x) => x.chars.includes(ch.id))
  const costumes = g.costumes.filter((x) => x.char === ch.id)
  const heads = g.heads.filter((x) => x.char === ch.id)
  const skinOf = new Map(g.cards.map((x) => [x.id, x]))
  const cardTitle = (x: GalleryCard) => `【${pick(x.name, lang)}】${pick(ch.name, lang)}`
  const cardItems: ViewItem[] = cards.map((x) => ({
    key: x.id, title: cardTitle(x), sub: [x.rarity, x.skin && `光景 ${pick(x.skin, lang)}`].filter(Boolean).join(' · '),
    src: (v) => cardArtUrl(x.asset, x.arts.includes(v) ? v : x.arts[0]), arts: x.arts,
  }))
  const outfitItems = (xs: GalleryOutfit[], url: (id: string) => string): ViewItem[] => xs.map((x) => ({
    key: x.id, title: pick(x.name, lang), note: pick(x.desc, lang), src: () => url(x.id), plain: true,
    sub: x.skin && skinOf.get(x.skin) ? `来自卡面 ${cardTitle(skinOf.get(x.skin)!)}` : undefined,
  }))
  const n = { cards: cards.length, supports: sups.length, costumes: costumes.length, heads: heads.length }

  return (
    <div>
      <section className="mb-6 grid gap-5 rounded-2xl bg-surface-2 p-4 ring-1 ring-line sm:grid-cols-[220px_1fr] sm:p-5">
        <button type="button" disabled={!ch.stand} onClick={() => onView([{ key: 'stand', title: pick(ch.name, lang), sub: '立绘', src: () => standUrl(ch.id), plain: true }], 0, 0)}
          className="relative h-[320px] cursor-zoom-in overflow-hidden rounded-xl bg-gradient-to-b from-white to-surface-3 disabled:cursor-default">
          {ch.stand ? <img src={standUrl(ch.id)} alt={`${pick(ch.name, lang)} 立绘`} className="absolute bottom-0 left-1/2 h-[310px] w-auto max-w-none -translate-x-1/2" />
            : ch.bustup && <img src={bustupUrl(ch.id)} alt="" className="absolute bottom-0 w-full" />}
        </button>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-[26px] font-black tracking-tight text-ink">{pick(ch.name, lang)}</h2>
          {lang === 'zh' && ch.name.zh && <p className="text-ink-3">{ch.name.ja}</p>}
          <p className="num mt-3 text-ink-2">卡面 {n.cards} 套 · 支援卡 {n.supports} 张 · 衣装 {n.costumes} 套 · 发型 {n.heads} 个</p>
          {ch.bustup && (
            <button type="button" onClick={() => onView([{ key: 'bustup', title: pick(ch.name, lang), sub: '半身像', src: () => bustupUrl(ch.id), plain: true }], 0, 0)}
              className="mt-auto hidden w-fit cursor-zoom-in items-end gap-3 pt-4 sm:flex">
              <img src={bustupUrl(ch.id)} alt="" loading="lazy" className="size-24 rounded-xl bg-white object-cover object-top ring-1 ring-line" />
              <span className="pb-1 text-[12.5px] text-ink-3">半身像</span>
            </button>
          )}
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => onTab(v as Tab)}>
          <TabsList>
            {TABS.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}<span className="num ml-1 text-ink-3">{n[t.key]}</span></TabsTrigger>)}
          </TabsList>
        </Tabs>
        {tab === 'cards' && (
          <div role="group" aria-label="卡面" className="flex rounded-full bg-surface-2 p-0.5 text-[13px] font-semibold">
            {[0, 1].map((v) => (
              <button key={v} type="button" aria-pressed={art === v} onClick={() => onArt(v)}
                className={cx('cursor-pointer rounded-full px-3 py-1', art === v ? 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line)]' : 'text-ink-3 hover:text-ink')}>{ART_LABEL[v]}</button>
            ))}
          </div>
        )}
      </div>

      {tab === 'cards' && (cards.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-3 gap-y-4">
          {cards.map((x, i) => {
            const v = x.arts.includes(art) ? art : x.arts[0]
            return (
              <button key={x.id} type="button" onClick={() => onView(cardItems, i, v)} className="group cursor-zoom-in text-left">
                <div className="aspect-[1/2] overflow-hidden rounded-xl bg-surface-3 ring-1 ring-line">
                  <img src={cardArtUrl(x.asset, v, true)} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
                </div>
                <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug font-semibold text-ink">{pick(x.name, lang)}</p>
                <p className="text-[11.5px] text-ink-3">{x.rarity}{x.skin && <> · 光景 {pick(x.skin, lang)}</>}{x.arts.length > 2 && ' · 有第三张'}</p>
              </button>
            )
          })}
        </div>
      ) : <Empty>还没有她的卡面。</Empty>)}

      {tab === 'supports' && (sups.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-3 gap-y-4">
          {sups.map((x, i) => (
            <button key={x.id} type="button" className="group cursor-zoom-in text-left"
              onClick={() => onView(sups.map((s) => ({ key: s.id, title: pick(s.name, lang), sub: `${s.rarity} 支援卡`, src: () => supportArtUrl(s.id), wide: true })), i, 0)}>
              <div className="aspect-[2/1] overflow-hidden rounded-xl bg-surface-3 ring-1 ring-line">
                <img src={supportArtUrl(x.id, true)} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
              </div>
              <p className="mt-1.5 truncate text-[12.5px] font-semibold text-ink">{pick(x.name, lang)}</p>
              <p className="text-[11.5px] text-ink-3">{x.rarity}{x.chars.length > 1 && ` · 和 ${x.chars.length - 1} 位一起`}</p>
            </button>
          ))}
        </div>
      ) : <Empty>还没有她的支援卡。</Empty>)}

      {(tab === 'costumes' || tab === 'heads') && (() => {
        const xs = tab === 'costumes' ? costumes : heads
        const url = tab === 'costumes' ? costumeUrl : headUrl
        const items = outfitItems(xs, url)
        return xs.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3">
            {xs.map((x, i) => (
              <button key={x.id} type="button" onClick={() => onView(items, i, 0)}
                className="group flex cursor-zoom-in flex-col rounded-xl bg-surface p-2 text-left ring-1 ring-line transition-shadow duration-150 hover:ring-line-strong">
                <div className="aspect-square overflow-hidden rounded-lg bg-surface-2">
                  <img src={url(x.id)} alt="" loading="lazy" className="size-full object-contain p-1.5 transition-transform duration-300 group-hover:scale-[1.05]" />
                </div>
                <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug font-semibold text-ink">{pick(x.name, lang)}</p>
                <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-3">{pick(x.desc, lang)}</p>
              </button>
            ))}
          </div>
        ) : <Empty>还没有。</Empty>
      })()}
    </div>
  )
}

/** 放大看：左右键 / 按钮翻；偶像卡卡面能切特训前 / 后 / 第三张；「原图」在新标签页打开 */
function Viewer({ view, onChange, onClose }: { view: { list: ViewItem[]; i: number; v: number }; onChange: (v: { list: ViewItem[]; i: number; v: number }) => void; onClose: () => void }) {
  const it = view.list[view.i]
  const go = (d: number) => {
    const i = (view.i + d + view.list.length) % view.list.length
    const nx = view.list[i]
    onChange({ ...view, i, v: nx.arts ? (nx.arts.includes(view.v) ? view.v : nx.arts[0]) : 0 })
  }
  // 左右键翻页：挂在弹窗自己身上（焦点在弹窗里，按键不一定冒泡到 window）
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') (e.preventDefault(), go(-1))
    if (e.key === 'ArrowRight') (e.preventDefault(), go(1))
  }
  const src = it.src(view.v)
  const many = view.list.length > 1
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onKeyDown={onKey} className="max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto p-3 sm:max-w-[min(1100px,calc(100%-2rem))] sm:p-4">
        <div className="pr-8">
          <DialogTitle className="text-[16px] font-bold">{it.title}</DialogTitle>
          <DialogDescription className="mt-0.5">{[it.sub, many && `${view.i + 1} / ${view.list.length}`].filter(Boolean).join(' · ')}</DialogDescription>
        </div>
        <div className="relative flex min-h-[200px] items-center justify-center rounded-lg bg-surface-2">
          <img key={src} src={src} alt={it.title}
            className={cx('max-h-[72dvh] w-auto max-w-full object-contain', it.plain && 'p-3', it.wide && 'w-full')} />
          {many && (
            <>
              <button type="button" aria-label="上一张" onClick={() => go(-1)} className="absolute top-1/2 left-2 grid size-9 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/85 text-ink shadow ring-1 ring-line hover:bg-white"><ChevronLeft size={18} /></button>
              <button type="button" aria-label="下一张" onClick={() => go(1)} className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/85 text-ink shadow ring-1 ring-line hover:bg-white"><ChevronRight size={18} /></button>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {it.arts && it.arts.length > 1 ? (
            <div role="group" aria-label="卡面" className="flex rounded-full bg-surface-2 p-0.5 text-[13px] font-semibold">
              {it.arts.map((v) => (
                <button key={v} type="button" aria-pressed={view.v === v} onClick={() => onChange({ ...view, v })}
                  className={cx('cursor-pointer rounded-full px-3 py-1', view.v === v ? 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line)]' : 'text-ink-3 hover:text-ink')}>{ART_LABEL[v]}</button>
              ))}
            </div>
          ) : <p className="text-[12.5px] text-ink-2">{it.note}</p>}
          <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-ink hover:underline">原图 <ExternalLink size={13} aria-hidden /></a>
        </div>
      </DialogContent>
    </Dialog>
  )
}
