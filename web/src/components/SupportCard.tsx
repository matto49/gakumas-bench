import { useState } from 'react'
import type { Catalog } from '../lib/api'
import { cardName, spriteUrl, useLang, useTerms } from '../lib/catalog'
import { abilityAt, LIMIT_LABEL, pairBi, pick, SUPPORT_TYPE_LABEL, supportThumbUrl, TYPE_ATTR, type SupportCard, type SupportCatalog, type SupportType } from '../lib/supports'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AttrChip, CopyId, cx, Tip } from './ui'
import { CardImage, Meta, RarityTag } from './CardDetail'

/** 支援卡的格子和详情：游戏资源一览用。数据见 lib/supports.ts */

export function SupportThumb({ id, size = 56, className }: { id: string; size?: number; className?: string }) {
  return (
    <img src={supportThumbUrl(id)} alt="" width={size} height={size} loading="lazy"
      className={cx('shrink-0 rounded-lg bg-surface-3 object-cover ring-1 ring-line', className)} style={{ width: size, height: size }}
      onError={(e) => ((e.currentTarget.style.visibility = 'hidden'))} />
  )
}

export function TypeChip({ t }: { t: SupportType }) {
  const { lang } = useLang()
  const a = TYPE_ATTR[t]
  return a ? <AttrChip t={a} /> : <span className="inline-grid h-5 place-items-center rounded-[4px] bg-surface-3 px-1.5 text-[10.5px] font-bold text-ink-2">{SUPPORT_TYPE_LABEL[lang].assist}</span>
}

function Tags({ d }: { d: SupportCard }) {
  const terms = useTerms()
  return (
    <span className="flex flex-wrap items-center gap-1">
      <RarityTag r={d.rarity} />
      <TypeChip t={d.type} />
      <Meta>{d.plan === 'COMMON' ? '通用' : (terms.plan[d.plan] ?? d.plan)}</Meta>
      {d.free && <Meta>活动奖励</Meta>}
      {d.limited && <Meta>限定</Meta>}
    </span>
  )
}

/** 事件拿到的东西：技能卡 / P 道具带小图，参数之类只写文字 */
function EventThing({ e, cat, size = 28, onOpenCard }: { e: SupportCard['events'][number]; cat: Catalog; size?: number; onOpenCard?: (id: string) => void }) {
  const { lang } = useLang()
  if (e.card && cat.cards[e.card]) {
    const name = cardName(cat, e.card)
    const body = <><CardImage c={cat.cards[e.card]} size={size} /><span className="min-w-0 truncate">获得 {name}</span></>
    return onOpenCard
      ? <button type="button" onClick={() => onOpenCard(e.card!)} className="flex min-w-0 cursor-pointer items-center gap-2 text-left hover:text-brand-ink">{body}</button>
      : <span className="flex min-w-0 items-center gap-2">{body}</span>
  }
  if (e.item && cat.items[e.item]) {
    const it = cat.items[e.item]
    return (
      <Tip tip={<span className="whitespace-pre-line">{it.text}</span>} wide>
        <span tabIndex={0} className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 overflow-hidden rounded-md bg-surface-2 ring-1 ring-line" style={{ width: size, height: size }}>
            {it.asset && <img src={spriteUrl(it.asset)} alt="" width={size} height={size} loading="lazy" className="size-full object-contain" />}
          </span>
          <span className="min-w-0 truncate">获得 {it.name}</span>
        </span>
      </Tip>
    )
  }
  return <span className="min-w-0 truncate">{pick(e, lang)}</span>
}

export function SupportTile({ id, d, cat, onOpen }: { id: string; d: SupportCard; cat: Catalog; onOpen: () => void }) {
  const { lang } = useLang()
  const name = pairBi(d.name, lang)
  const gives = d.events.filter((e) => e.card || e.item)
  return (
    <article className="group relative flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-3 transition-colors duration-150 hover:border-line-strong">
      <div className="flex items-center gap-3">
        <SupportThumb id={id} size={56} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold text-ink" title={name.sub ? `${name.main}（${name.sub}）` : name.main}>
            <button type="button" onClick={onOpen} className="cursor-pointer rounded-sm text-left after:absolute after:inset-0 after:rounded-xl group-hover:text-brand-ink">
              {name.main}
            </button>
          </h3>
          {name.sub && <p className="truncate text-[11.5px] text-ink-3">{name.sub}</p>}
          <div className="mt-1"><Tags d={d} /></div>
        </div>
      </div>
      {gives.length > 0 && (
        <div className="space-y-1 border-t border-line pt-2.5 text-[12.5px] text-ink-2">
          {gives.map((e) => <EventThing key={e.level} e={e} cat={cat} />)}
        </div>
      )}
      <CopyId id={id} className="relative z-10 self-start" />
    </article>
  )
}

export function SupportDetail({ id, d, all, cat, onClose, onOpenCard }: { id: string; d: SupportCard; all: SupportCatalog; cat: Catalog; onClose: () => void; onOpenCard: (card: string) => void }) {
  const { lang } = useLang()
  const [rank, setRank] = useState(4)
  const cap = d.caps[rank] ?? d.caps[d.caps.length - 1] ?? 0
  const name = pairBi(d.name, lang)
  const lessonParam = d.lesson.param ? { vocal: 'Vo', dance: 'Da', visual: 'Vi' }[d.lesson.param] : null
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-2xl sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-4">
            <SupportThumb id={id} size={88} />
            <div className="min-w-0">
              <DialogTitle className="text-[18px] font-bold">{name.main}</DialogTitle>
              {name.sub && <p className="text-[12.5px] text-ink-3">{name.sub}</p>}
              <div className="mt-1.5"><Tags d={d} /></div>
              <DialogDescription className="mt-1"><CopyId id={id} /></DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-bold text-ink">支援技能 <span className="font-normal text-ink-3">· Lv {cap} 时</span></h3>
            <div role="radiogroup" aria-label="突破" className="inline-flex rounded-full bg-surface-2 p-0.5">
              {d.caps.map((c, i) => (
                <button key={i} type="button" role="radio" aria-checked={rank === i} onClick={() => setRank(i)}
                  className={cx('cursor-pointer rounded-full px-2.5 py-1 text-[12px]', rank === i ? 'bg-surface font-semibold text-ink shadow-sm ring-1 ring-line' : 'text-ink-3 hover:text-ink')}>
                  {LIMIT_LABEL[i]}<span className="num ml-1 text-[11px] text-ink-3">{c}</span>
                </button>
              ))}
            </div>
          </div>
          <ol className="divide-y divide-line rounded-xl border border-line">
            {d.abilities.map((a, i) => {
              const now = abilityAt(a, cap)
              return (
                <li key={i} className="flex items-baseline gap-3 px-3 py-2">
                  <span className="num w-[4.5rem] shrink-0 text-[11.5px] whitespace-nowrap text-ink-3">Lv {a.unlock} 解锁</span>
                  {now ? (
                    <span className="text-[13px] text-ink">{pick(now, lang)}</span>
                  ) : (
                    <span className="text-[13px] text-ink-3">{pick(a.steps[0], lang)}（Lv {a.unlock} 才解锁）</span>
                  )}
                </li>
              )
            })}
          </ol>
        </section>

        <section>
          <h3 className="mb-2 text-[13px] font-bold text-ink">课程支援</h3>
          <p className="rounded-xl border border-line px-3 py-2 text-[13px] text-ink">
            {lessonParam ? <>{lessonParam} 课程里，有概率强化手牌中的技能卡</> : <>课程里，有概率强化手牌中的技能卡</>}
            <span className="ml-1 text-ink-2">{pick(d.lesson, lang)}</span>
            <span className="num ml-1.5 text-[12px] text-ink-3">（{(d.lesson.permil / 10).toFixed(1)}%）</span>
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-[13px] font-bold text-ink">支援卡事件</h3>
          <ol className="divide-y divide-line rounded-xl border border-line">
            {d.events.map((e) => (
              <li key={e.level} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <span className="num w-14 shrink-0 text-[11.5px] text-ink-3">Lv {e.level}</span>
                <EventThing e={e} cat={cat} size={32} onOpenCard={onOpenCard} />
              </li>
            ))}
          </ol>
        </section>

        {d.characters.length > 0 && (
          <section>
            <h3 className="mb-2 text-[13px] font-bold text-ink">卡面上的偶像</h3>
            <p className="flex flex-wrap gap-1.5">
              {d.characters.map((c) => <Meta key={c}>{pick(all.characters[c], lang) || c}</Meta>)}
            </p>
          </section>
        )}
      </DialogContent>
    </Dialog>
  )
}
