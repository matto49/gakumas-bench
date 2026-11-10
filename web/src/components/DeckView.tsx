import { useState } from 'react'
import type { Card, Problem } from '../lib/api'
import { enchantName, idolName, spriteUrl, useCatalog } from '../lib/catalog'
import { examLine, MECHANIC, PLAN } from '../lib/game'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CardDetail } from './CardDetail'
import { DrinkChip, SkillCard } from './GameBits'
import { AttrChip, IdolThumb, Tip } from './ui'

/** 题模板编成里的一张卡 → SkillCard 用的 Card。紧凑写法「卡编号+强化/定制编号*次数/…」或展开的对象都认 */
export function parseDeckCard(x: unknown): Card | null {
  if (typeof x === 'string') {
    const [head, ...cus] = x.split('/')
    const [id, n] = head.split('+')
    return { id, u: n ? Number(n) : 0, c: cus.map((c) => { const [k, m] = c.split('*'); return [k, m ? Number(m) : 1] as [string, number] }) }
  }
  if (x && typeof x === 'object') {
    const o = x as { produce_card_id?: string; id?: string; current_upgrade_count?: number; upgrade_count?: number; customizes?: { id: string; customize_count: number }[] }
    const id = o.produce_card_id ?? o.id
    if (!id) return null
    return { id, u: o.current_upgrade_count ?? o.upgrade_count ?? 0, c: (o.customizes ?? []).map((c) => [c.id, c.customize_count] as [string, number]) }
  }
  return null
}

const list = (v: unknown) => (Array.isArray(v) ? v : [])
const triple = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number) : v && typeof v === 'object' ? ['1', '2', '3'].map((k) => Number((v as Record<string, number>)[k])) : [])

function Block({ title, n, children }: { title: string; n?: number; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-bold text-ink-2">
        <span className="inline-block h-3 w-[3px] -skew-x-12 rounded-sm bg-brand" aria-hidden />
        {title}{n != null && <span className="font-normal text-ink-3">{n}</span>}
      </h3>
      {children}
    </section>
  )
}

/** 一道题的完整编成：牌组、P 道具、饮料、支援卡、回忆、三维 */
export function DeckView({ p, onClose }: { p: Problem; onClose: () => void }) {
  const cat = useCatalog()
  const lo = (p.archive.loadout ?? {}) as Record<string, unknown>
  const sc = p.scene ?? {}
  const deck = list(lo.deck_cards).map(parseDeckCard).filter((c): c is Card => !!c)
  const items = list(lo.produce_item_ids).map(String)
  const drinks = list(lo.drink_ids).map(String)
  const supports = list(lo.support_cards).map((s) => (typeof s === 'string' ? s.split(':') : [String((s as { support_card_id?: string }).support_card_id), String((s as { permil?: number }).permil)]))
  const memories = list(lo.memory_ability_ids).map(String)
  const enchants = list(lo.main_item_enchant_ids).map(String)
  const params = triple(lo.parameters)
  const bonus = triple(lo.score_bonus_permils)
  const idol = String(lo.idol_card_id ?? '')
  const [card, setCard] = useState<Card | null>(null)
  const [cardOpen, setCardOpen] = useState(false)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <IdolThumb id={idol} size={56} />
            <div className="min-w-0">
              <DialogTitle className="text-[17px] font-bold">{idol ? idolName(cat, idol) : p.name}</DialogTitle>
              <DialogDescription className="mt-0.5 text-[12.5px]">
                {[examLine(sc.exam, sc.stage, sc.round), sc.plan && (PLAN[sc.plan] ?? sc.plan), sc.mechanic && (MECHANIC[sc.mechanic] ?? sc.mechanic), sc.turns && `${sc.turns} 回合`].filter(Boolean).join(' · ')}
              </DialogDescription>
              <p className="mt-0.5 font-mono text-[11px] text-ink-3">{p.name} · {p.id} · {p.family}</p>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px]">
          {params.length === 3 && (
            <span className="inline-flex items-center gap-2">
              {params.map((v, i) => <span key={i} className="inline-flex items-center gap-1"><AttrChip t={i + 1} size="xs" /><span className="disp text-[15px] text-ink">{v}</span></span>)}
            </span>
          )}
          {bonus.length === 3 && (
            <Tip tip="审查里 Vo / Da / Vi 回合的分数倍率（编成里的 score_bonus_permils ÷ 1000）">
              <span tabIndex={0} className="text-ink-2">倍率 <span className="num text-ink">{bonus.map((b) => (b / 1000).toFixed(1)).join(' / ')}</span></span>
            </Tip>
          )}
          {lo.starting_stamina != null && <span className="text-ink-2">体力 <span className="num text-ink">{String(lo.starting_stamina)} / {String(lo.max_stamina ?? lo.starting_stamina)}</span></span>}
        </div>

        <Block title="牌组" n={deck.length}>
          {lo.include_produce_default === true && <p className="mb-2 text-[12px] text-ink-3">另外还有培育的默认卡（编成里写了 include_produce_default，开局时由引擎补上）。</p>}
          <div className="flex flex-wrap gap-2">
            {deck.map((c, i) => (
              <button key={i} type="button" onClick={() => { setCard(c); setCardOpen(true) }} aria-label="看这张卡强化前后的效果" className="relative cursor-pointer rounded-md">
                <SkillCard card={c} size={52} />
                {c.c && c.c.length > 0 && (
                  <span className="absolute top-0.5 left-[9px] rounded-[3px] bg-brand-deep px-0.5 text-[9px] leading-tight font-bold text-white">定制</span>
                )}
              </button>
            ))}
          </div>
        </Block>

        <div className="grid gap-5 md:grid-cols-2">
          <Block title="P 道具" n={items.length}>
            <ul className="space-y-1.5">
              {items.map((id, i) => {
                const it = cat?.items[id]
                return (
                  <li key={i} className="flex gap-2">
                    {it?.asset ? <img src={spriteUrl(it.asset)} alt="" width={32} height={32} className="size-8 shrink-0 object-contain" /> : <span className="size-8 shrink-0 rounded bg-surface-3" />}
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-ink">{it?.name ?? id}</p>
                      {it?.text && <p className="text-[12px] leading-relaxed whitespace-pre-line text-ink-2">{it.text}</p>}
                    </div>
                  </li>
                )
              })}
            </ul>
            {enchants.length > 0 && (
              <div className="mt-2 rounded-lg bg-surface-2 px-2.5 py-2 text-[12px]">
                <p className="mb-1 text-ink-3">P 道具定制</p>
                {enchants.map((e, i) => <p key={i} className="whitespace-pre-line text-ink-2">{cat?.enchants[e]?.text ?? enchantName(cat, e)}</p>)}
              </div>
            )}
          </Block>
          <div className="space-y-5">
            <Block title="饮料" n={drinks.length}>
              <div className="flex flex-wrap gap-1.5">{drinks.map((d, i) => <DrinkChip key={i} id={d} />)}</div>
            </Block>
            {supports.length > 0 && (
              <Block title="支援卡" n={supports.length}>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11.5px] text-ink-2">
                  {supports.map(([id, permil], i) => <li key={i}>{id} <span className="text-ink-3">{permil}‰</span></li>)}
                </ul>
              </Block>
            )}
            {memories.length > 0 && (
              <Block title="回忆" n={memories.length}>
                <ul className="space-y-1.5">
                  {memories.map((m, i) => (
                    <li key={i} className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px] leading-relaxed whitespace-pre-line text-ink-2">
                      {cat?.memories?.[m]?.text || <span className="font-mono text-[11px] break-all text-ink-3">{m}</span>}
                    </li>
                  ))}
                </ul>
              </Block>
            )}
          </div>
        </div>
        {card && cat?.cards[card.id] && <CardDetail open={cardOpen} id={card.id} c={cat.cards[card.id]} current={card.u ?? 0} customizes={card.c} onClose={() => setCardOpen(false)} />}
      </DialogContent>
    </Dialog>
  )
}
