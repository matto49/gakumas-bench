import { useCatalog, useTerms, spriteUrl, cardName, drinkName, enchantName } from '../lib/catalog'
import type { Card } from '../lib/api'
import { STATUS } from '../lib/game'
import { cx, Tip } from './ui'

const RARITY_RING: Record<string, string> = {
  SSR: 'ring-[oklch(0.78_0.12_85)]',
  SR: 'ring-[oklch(0.75_0.08_250)]',
  R: 'ring-line-strong',
  N: 'ring-line',
}

/** 一张技能卡：小图 + 日文名；悬停显示效果文字。没有小图时用名字的首字。 */
export function SkillCard({ card, size = 44, dim, mark }: { card: Card; size?: number; dim?: boolean; mark?: 'played' | 'chosen' }) {
  const cat = useCatalog()
  const terms = useTerms()
  const c = cat?.cards[card.id]
  const u = card.u ?? 0
  const name = cardName(cat, card.id, u)
  const text = c?.up[String(u)]?.text
  return (
    <Tip
      tip={
        <span className="block">
          <span className="block font-medium text-ink">{name}</span>
          {c && <span className="mt-0.5 block text-[11px] text-ink-3">{c.rarity} · {terms.category[c.category] ?? c.category}</span>}
          {text && <span className="mt-1 block whitespace-pre-line">{text}</span>}
          {card.c && card.c.length > 0 && <span className="mt-1 block text-brand-ink">定制 {card.c.map((x) => `×${x[1]}`).join(' ')}</span>}
          {card.g && card.g.length > 0 && <span className="mt-1 block text-brand-ink">考试中成长 {card.g.length} 次</span>}
          {card.p === 0 && <span className="mt-1 block text-critical">现在打不出</span>}
        </span>
      }
    >
      <span
        tabIndex={0}
        className={cx('inline-flex flex-col items-center gap-1 rounded-md outline-none', dim && 'opacity-45')}
        style={{ width: size + 14 }}
      >
        <span
          className={cx(
            'relative grid place-items-center overflow-hidden rounded-[6px] bg-surface-3 ring-1',
            RARITY_RING[c?.rarity ?? 'N'] ?? 'ring-line',
            mark === 'chosen' && 'ring-2 ring-brand',
          )}
          style={{ width: size, height: size }}
        >
          {c?.asset ? (
            <img src={spriteUrl(c.asset)} alt="" width={size} height={size} loading="lazy" className="size-full object-cover" />
          ) : (
            <span className="text-[13px] font-semibold text-ink-2">{name.slice(0, 2)}</span>
          )}
          {u > 0 && (
            <span className="absolute right-0.5 bottom-0.5 rounded-[3px] bg-ink/75 px-0.5 text-[9px] leading-tight font-bold text-surface">{'+'.repeat(u)}</span>
          )}
        </span>
        <span className="w-full truncate text-center text-[10.5px] leading-tight text-ink-2">{name}</span>
      </span>
    </Tip>
  )
}

export function DrinkChip({ id, mark }: { id: string; mark?: boolean }) {
  const cat = useCatalog()
  const d = cat?.drinks[id]
  return (
    <Tip tip={<span className="block"><span className="block font-medium text-ink">{drinkName(cat, id)}</span>{d?.text && <span className="mt-1 block whitespace-pre-line">{d.text}</span>}</span>}>
      <span tabIndex={0} className={cx('inline-flex items-center gap-1.5 rounded-md border bg-surface px-1.5 py-1', mark ? 'border-brand ring-1 ring-brand' : 'border-line')}>
        {d?.asset ? <img src={spriteUrl(d.asset)} alt="" width={22} height={22} className="size-[22px]" /> : <span className="size-[22px] rounded bg-surface-3" />}
        <span className="max-w-32 truncate text-[12px] text-ink">{drinkName(cat, id)}</span>
      </span>
    </Tip>
  )
}

export function EnchantChip({ id, uses, turns }: { id: string; uses: number; turns: number }) {
  const cat = useCatalog()
  const e = cat?.enchants[id]
  const meta = [uses >= 0 ? `剩 ${uses} 次` : null, turns >= 0 ? `剩 ${turns} 回合` : null].filter(Boolean).join(' · ')
  return (
    <Tip tip={<span className="block"><span className="block font-medium text-ink">{enchantName(cat, id)}</span>{e?.text && <span className="mt-1 block whitespace-pre-line">{e.text}</span>}</span>} wide>
      <span tabIndex={0} className="inline-flex max-w-full items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[11.5px] text-ink-2">
        <span className="truncate">{enchantName(cat, id)}</span>
        {meta && <span className="shrink-0 text-ink-3">{meta}</span>}
      </span>
    </Tip>
  )
}

export function StatusChip({ kind, value, turns }: { kind: string; value: number; turns: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[11.5px]">
      <span className="text-ink-2">{STATUS[kind] ?? kind}</span>
      <span className="num font-semibold text-ink">{Number.isInteger(value) ? value : value.toFixed(1)}</span>
      {turns >= 0 && <span className="text-ink-3">{turns}T</span>}
    </span>
  )
}

/** 动作的文字描述 */
export function actionText(action: (string | number)[], hand: (string | Card)[] | undefined, drinks: string[] | undefined, cat: ReturnType<typeof useCatalog>) {
  const [kind, idx] = action
  if (kind === 'play') {
    const c = hand?.[Number(idx)]
    if (!c) return `打第 ${Number(idx) + 1} 张`
    return typeof c === 'string' ? `打 ${cardName(cat, c)}` : `打 ${cardName(cat, c.id, c.u ?? 0)}`
  }
  if (kind === 'drink') {
    const id = drinks?.[Number(idx)]
    return id ? `喝 ${drinkName(cat, id)}` : `喝第 ${Number(idx) + 1} 瓶`
  }
  if (kind === 'end') return '结束回合'
  if (kind === 'select') return `选牌 ${action.slice(1).join(',')}`
  return action.join(' ')
}
