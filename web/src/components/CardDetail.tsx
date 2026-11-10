import type { CatalogCard } from '../lib/api'
import { spriteUrl } from '../lib/catalog'
import { PLAN } from '../lib/game'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cx } from './ui'

/** 技能卡的图、标签和详情弹窗：牌库和题的牌组共用 */

export const CATEGORY: Record<string, string> = { ACTIVE_SKILL: 'アクティブ', MENTAL_SKILL: 'メンタル', TROUBLE: 'トラブル' }
export const UP_LABEL = ['未强化', '强化 +', '强化 ++', '强化 +++']

// 编号 p_card-<计划>-<来源>-…：ido 偶像固有、sup 支援卡、act / men 通用
export function sourceOf(id: string) {
  const k = id.split('-')[2] ?? ''
  return k === 'ido' ? 'idol' : k === 'sup' ? 'support' : 'common'
}
export const SOURCE: Record<string, string> = { common: '通用', idol: '偶像固有', support: '支援卡' }

const RARITY_STYLE: Record<string, string> = {
  LEGEND: 'bg-[linear-gradient(135deg,oklch(0.8_0.12_330),oklch(0.82_0.12_200),oklch(0.86_0.13_90))] text-ink',
  SSR: 'bg-[oklch(0.85_0.13_85)] text-ink',
  SR: 'bg-[oklch(0.82_0.07_250)] text-ink',
  R: 'bg-surface-3 text-ink-2',
  N: 'bg-surface-2 text-ink-3',
}

export function RarityTag({ r }: { r?: string }) {
  if (!r) return null
  return <span className={cx('inline-flex h-[18px] items-center rounded-[4px] px-1.5 text-[10.5px] font-bold italic', RARITY_STYLE[r] ?? 'bg-surface-2 text-ink-2')}>{r}</span>
}

export function Meta({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-[18px] items-center rounded-[4px] border border-line px-1.5 text-[11px] text-ink-2">{children}</span>
}

export function CardImage({ c, size }: { c: CatalogCard; size: number }) {
  return (
    <div className="shrink-0 overflow-hidden rounded-lg bg-surface-3 ring-1 ring-line" style={{ width: size, height: size }}>
      {c.asset ? <img src={spriteUrl(c.asset)} alt="" width={size} height={size} loading="lazy" className="size-full object-cover" /> : <span className="grid size-full place-items-center text-[13px] font-semibold text-ink-3">{c.name.slice(0, 2)}</span>}
    </div>
  )
}

export function CardTags({ id, c }: { id: string; c: CatalogCard }) {
  return (
    <div className="flex flex-wrap gap-1">
      <RarityTag r={c.rarity} />
      <Meta>{PLAN[c.plan] ?? c.plan}</Meta>
      <Meta>{CATEGORY[c.category] ?? c.category}</Meta>
      {sourceOf(id) !== 'common' && <Meta>{SOURCE[sourceOf(id)]}</Meta>}
    </div>
  )
}

/** 一张卡的详情：未强化到 +++ 并排，比上一档新增或变了的行用浅橙底标出来。
 * current：牌组里这张卡的强化档（标「这张」）；customizes：这张卡的定制 [编号, 次数]。
 * 嵌在别的弹窗里时用 open 控制开关、不要直接卸载：直接卸载的话外层弹窗不知道里层已经关了，Esc 关不掉外层 */
export function CardDetail({ id, c, onClose, open = true, current, customizes }: { id: string; c: CatalogCard; onClose: () => void; open?: boolean; current?: number; customizes?: [string, number][] }) {
  const levels = Object.entries(c.up).sort((a, b) => Number(a[0]) - Number(b[0]))
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="shadow-2xl sm:max-w-3xl">
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
              <div key={lv} className={cx('rounded-xl border p-3', (current != null ? Number(lv) === current : k === levels.length - 1 && levels.length > 1) ? 'border-brand/50' : 'border-line', current != null && Number(lv) === current && 'bg-brand-tint')}>
                <p className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="font-bold text-ink">{x.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-ink-3">
                    {current != null && Number(lv) === current && <span className="rounded-[3px] bg-brand-deep px-1 text-[10.5px] font-bold text-white">这张</span>}
                    {UP_LABEL[Number(lv)] ?? `强化 ${lv}`}
                  </span>
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
        {!!customizes?.length && (
          <div className="rounded-lg bg-surface-2 px-2.5 py-2 text-[12px]">
            <p className="text-ink-2">这张卡做过定制，共 {customizes.reduce((n, x) => n + x[1], 0)} 次。上面是定制前的效果。</p>
            <ul className="mt-1 space-y-0.5 font-mono text-[11px] break-all text-ink-3">
              {customizes.map(([k, n]) => <li key={k}>{k} ×{n}</li>)}
            </ul>
          </div>
        )}
        {levels.length > 1 && <p className="text-[12px] text-ink-3"><span className="rounded bg-brand-soft px-1 text-ink">浅橙底</span> 是比上一档新增或变了的行。</p>}
      </DialogContent>
    </Dialog>
  )
}
