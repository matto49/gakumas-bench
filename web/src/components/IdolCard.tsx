import type { Catalog, CatalogIdol, CatalogThing } from '../lib/api'
import { spriteUrl, useTerms } from '../lib/catalog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AttrChip, CopyId, cx, IdolThumb } from './ui'
import { CardImage, Meta, RarityTag } from './CardDetail'

/** 偶像卡的格子和详情：游戏资源一览用。数据是 catalog.json 的 idols（流派、初始参数、成长率、固有技能卡和 P 道具） */

/** 成长率千分比 → 「20%」「4.5%」 */
const rate = (permil: number) => `${permil % 10 === 0 ? permil / 10 : (permil / 10).toFixed(1)}%`

export function IdolTags({ d }: { d: CatalogIdol }) {
  const terms = useTerms()
  return (
    <span className="flex flex-wrap items-center gap-1">
      <RarityTag r={d.rarity} />
      {d.plan && <Meta>{terms.plan[d.plan] ?? d.plan}</Meta>}
      {d.style && <Meta>{terms.style[d.style] ?? d.style}</Meta>}
    </span>
  )
}

/** 初始 Vo / Da / Vi 和成长率，再加初始体力。成长率最高的那项加粗 */
export function IdolParams({ d, size = 'sm' }: { d: CatalogIdol; size?: 'sm' | 'lg' }) {
  if (!d.params) return null
  const top = Math.max(...(d.growth ?? [0]))
  return (
    <span className={cx('flex flex-wrap items-center', size === 'lg' ? 'gap-x-5 gap-y-2' : 'gap-x-3 gap-y-1')}>
      {d.params.map((v, i) => {
        const g = d.growth?.[i] ?? 0
        return (
          <span key={i} className="inline-flex items-center gap-1.5">
            <AttrChip t={i + 1} size={size === 'lg' ? 'sm' : 'xs'} />
            <span className={cx('num text-ink', size === 'lg' ? 'text-[15px] font-semibold' : 'text-[12.5px] font-semibold')}>{v}</span>
            {g > 0 && <span className={cx('num', size === 'lg' ? 'text-[12.5px]' : 'text-[11.5px]', g === top ? 'font-semibold text-ink' : 'text-ink-3')}>+{rate(g)}</span>}
          </span>
        )
      })}
      {d.stamina ? (
        <span className={cx('num text-ink-2', size === 'lg' ? 'text-[13px]' : 'text-[12px]')}>
          体力 <span className="font-semibold text-ink">{d.stamina}</span>
        </span>
      ) : null}
    </span>
  )
}

function ThingIcon({ t, size }: { t?: CatalogThing; size: number }) {
  return (
    <span className="shrink-0 overflow-hidden rounded-md bg-surface-2 ring-1 ring-line" style={{ width: size, height: size }}>
      {t?.asset && <img src={spriteUrl(t.asset)} alt="" width={size} height={size} loading="lazy" className="size-full object-contain" />}
    </span>
  )
}

/** 资源一览里的一格。整格点开详情；编号的复制按钮单独可点 */
export function IdolTile({ id, d, cat, onOpen }: { id: string; d: CatalogIdol; cat: Catalog; onOpen: () => void }) {
  const card = d.card ? cat.cards[d.card] : undefined
  const item = d.item ? cat.items[d.item] : undefined
  return (
    <article className="group relative flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-3 transition-colors duration-150 hover:border-line-strong">
      <div className="flex items-center gap-3">
        <IdolThumb id={id} size={52} title={false} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold text-ink" title={d.name}>
            <button type="button" onClick={onOpen} className="cursor-pointer rounded-sm text-left after:absolute after:inset-0 after:rounded-xl group-hover:text-brand-ink">
              {d.name}
            </button>
          </h3>
          <div className="mt-1"><IdolTags d={d} /></div>
        </div>
      </div>
      <IdolParams d={d} />
      <div className="grid grid-cols-2 gap-2 border-t border-line pt-2.5">
        <span className="flex min-w-0 items-center gap-2" title={card?.name}>
          {card ? <CardImage c={card} size={30} /> : <span className="size-[30px] shrink-0" />}
          <span className="min-w-0 leading-tight">
            <span className="block text-[11px] text-ink-3">固有技能卡</span>
            <span className="block truncate text-[12.5px] text-ink">{card?.name ?? '—'}</span>
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2" title={item?.name}>
          <ThingIcon t={item} size={30} />
          <span className="min-w-0 leading-tight">
            <span className="block text-[11px] text-ink-3">固有 P 道具</span>
            <span className="block truncate text-[12.5px] text-ink">{item?.name ?? '—'}</span>
          </span>
        </span>
      </div>
      <CopyId id={id} className="relative z-10 self-start" />
    </article>
  )
}

function ItemBox({ label, id, t, highlight }: { label: string; id?: string; t?: CatalogThing; highlight?: boolean }) {
  return (
    <div className={cx('rounded-xl border p-3', highlight ? 'border-brand/50' : 'border-line')}>
      <p className="mb-2 text-[11.5px] text-ink-3">{label}</p>
      <div className="flex gap-3">
        <ThingIcon t={t} size={44} />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink">{t?.name ?? id ?? '—'}</p>
          {t?.text && <p className="mt-1 text-[12.5px] leading-relaxed whitespace-pre-line text-ink-2">{t.text}</p>}
          {id && <CopyId id={id} className="mt-1" />}
        </div>
      </div>
    </div>
  )
}

export function IdolDetail({ id, d, cat, onClose, onOpenCard }: { id: string; d: CatalogIdol; cat: Catalog; onClose: () => void; onOpenCard: (card: string) => void }) {
  const card = d.card ? cat.cards[d.card] : undefined
  const item = d.item ? cat.items[d.item] : undefined
  const itemUp = d.item_up ? cat.items[d.item_up] : undefined
  const sameItem = !itemUp || d.item === d.item_up || (item?.name === itemUp.name && item?.text === itemUp.text)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-2xl sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <IdolThumb id={id} size={72} title={false} />
            <div className="min-w-0">
              <DialogTitle className="text-[18px] font-bold">{d.name}</DialogTitle>
              <div className="mt-1.5"><IdolTags d={d} /></div>
              <DialogDescription className="mt-1"><CopyId id={id} /></DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <section>
          <h3 className="mb-2 text-[13px] font-bold text-ink">初始参数和成长率</h3>
          <div className="rounded-xl border border-line px-3 py-2.5"><IdolParams d={d} size="lg" /></div>
        </section>

        <section>
          <h3 className="mb-2 text-[13px] font-bold text-ink">固有 P 道具</h3>
          {sameItem ? (
            <ItemBox label="特训前后相同" id={d.item} t={item} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <ItemBox label="特训前" id={d.item} t={item} />
              <ItemBox label="特训后（潜在能力解放）" id={d.item_up} t={itemUp} highlight />
            </div>
          )}
        </section>

        {card && d.card && (
          <section>
            <h3 className="mb-2 text-[13px] font-bold text-ink">固有技能卡</h3>
            <div className="flex gap-3 rounded-xl border border-line p-3">
              <CardImage c={card} size={56} />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-ink">{card.name}</p>
                {card.up['0']?.text && <p className="mt-1 text-[12.5px] leading-relaxed whitespace-pre-line text-ink-2">{card.up['0'].text}</p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <CopyId id={d.card} />
                  <button type="button" onClick={() => onOpenCard(d.card!)} className="cursor-pointer text-[12.5px] font-semibold text-brand-ink hover:underline">
                    看强化前后
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** 回忆能力的一格：游戏里的图标（彩色方底 + 图案）、效果文字、稀有度和计划 */
export function MemoryTile({ id, d }: { id: string; d: CatalogThing }) {
  const terms = useTerms()
  return (
    <div className="flex gap-3 rounded-xl border border-line bg-surface p-3">
      {d.asset ? (
        <img src={spriteUrl(d.asset)} alt="" width={40} height={40} loading="lazy" className="size-10 shrink-0 rounded-lg" />
      ) : (
        <span className="size-10 shrink-0 rounded-lg bg-surface-2" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-relaxed whitespace-pre-line text-ink">{d.text || d.name || '（无说明）'}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <RarityTag r={d.rarity} />
          <Meta>{d.plan ? (terms.plan[d.plan] ?? d.plan) : '通用'}</Meta>
          <CopyId id={id} className="min-w-0" />
        </div>
      </div>
    </div>
  )
}
