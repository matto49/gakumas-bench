import type { CatalogCard } from '../lib/api'
import { spriteUrl } from '../lib/catalog'
import { PLAN } from '../lib/game'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CopyId, cx } from './ui'

/** 技能卡的图、标签和详情弹窗：游戏资源一览和题的牌组共用 */

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
  UR: 'bg-[linear-gradient(135deg,oklch(0.8_0.12_330),oklch(0.82_0.12_200),oklch(0.86_0.13_90))] text-ink',
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

/** 解锁 P 等级 */
export function UnlockTag({ lv }: { lv: number }) {
  return <Meta><span title={`制作人等级 ${lv} 解锁`}>PLv {lv}</span></Meta>
}

export function CardTags({ id, c }: { id: string; c: CatalogCard }) {
  return (
    <div className="flex flex-wrap gap-1">
      <RarityTag r={c.rarity} />
      <Meta>{PLAN[c.plan] ?? c.plan}</Meta>
      <Meta>{CATEGORY[c.category] ?? c.category}</Meta>
      {sourceOf(id) !== 'common' && <Meta>{SOURCE[sourceOf(id)]}</Meta>}
      {c.unlock ? <UnlockTag lv={c.unlock} /> : null}
    </div>
  )
}

/** 一张卡的详情：未强化到 +++ 并排（效果一样的档合成一格），比上一档新增或变了的行用浅橙底标出来。
 * 下面列这张卡的定制方向（每张卡不一样）。current：牌组里这张卡的强化档（标「这张」）；customizes：这张卡做了的定制 [方向编号, 档]。
 * 嵌在别的弹窗里时用 open 控制开关、不要直接卸载：直接卸载的话外层弹窗不知道里层已经关了，Esc 关不掉外层 */
export function CardDetail({ id, c, onClose, open = true, current, customizes }: { id: string; c: CatalogCard; onClose: () => void; open?: boolean; current?: number; customizes?: [string, number][] }) {
  const levels = Object.entries(c.up).sort((a, b) => Number(a[0]) - Number(b[0]))
  // 效果文字和前一档完全一样的强化档合成一格（不少卡的 ++、+++ 和 + 相同）；未强化单独一格
  const groups: { lvs: number[]; name: string; text: string }[] = []
  for (const [lv, x] of levels) {
    const last = groups[groups.length - 1]
    if (last && last.lvs[0] > 0 && last.text === x.text) last.lvs.push(Number(lv))
    else groups.push({ lvs: [Number(lv)], name: x.name, text: x.text })
  }
  const merged = groups.some((g) => g.lvs.length > 1)
  const have = new Map(customizes ?? [])
  const unknown = (customizes ?? []).filter(([k]) => !c.custom?.dirs.some((d) => d.id === k))
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-2xl sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <CardImage c={c} size={72} />
            <div className="min-w-0">
              <DialogTitle className="text-[18px] font-bold">{c.name}</DialogTitle>
              <div className="mt-1.5"><CardTags id={id} c={c} /></div>
              <DialogDescription className="mt-1"><CopyId id={id} /></DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {levels.length === 1 && <p className="text-[12.5px] text-ink-3">这张卡不能强化。</p>}
        <div className={cx('grid gap-3', groups.length > 1 && 'sm:grid-cols-2')}>
          {groups.map((g, k) => {
            const prev = k > 0 ? new Set(groups[k - 1].text.split('\n')) : null
            const mine = current != null && g.lvs.includes(current)
            return (
              <div key={g.lvs[0]} className={cx('rounded-xl border p-3', (current != null ? mine : k === groups.length - 1 && groups.length > 1) ? 'border-brand/50' : 'border-line', mine && 'bg-brand-tint')}>
                <p className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="font-bold text-ink">{g.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-ink-3">
                    {mine && <span className="rounded-[3px] bg-brand-deep px-1 text-[10.5px] font-bold text-white">这张</span>}
                    {g.lvs.length > 1 ? `强化 ${'+'.repeat(g.lvs[0])} ～ ${'+'.repeat(g.lvs[g.lvs.length - 1])}` : (UP_LABEL[g.lvs[0]] ?? `强化 ${g.lvs[0]}`)}
                  </span>
                </p>
                <ul className="space-y-0.5 text-[12.5px] leading-relaxed text-ink-2">
                  {g.text.split('\n').map((line, n) => (
                    <li key={n} className={cx('rounded px-1 -mx-1', prev && !prev.has(line) && 'bg-brand-soft text-ink')}>{line}</li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
        {merged && <p className="text-[12px] text-ink-3">主数据里这张卡后面几档的效果和前一档完全一样，合成了一格：再往上强化不会变。</p>}
        {c.custom && c.custom.dirs.length > 0 && (
          <section>
            <h3 className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-[13px] font-bold text-ink">
              定制方向
              <span className="text-[11.5px] font-normal text-ink-3">这张卡能选的 {c.custom.dirs.length} 个方向，合计最多定制 {c.custom.max} 次</span>
            </h3>
            <ul className="space-y-1.5">
              {c.custom.dirs.map((d) => {
                const got = have.get(d.id) ?? 0
                return (
                  <li key={d.id} className={cx('flex flex-wrap items-stretch gap-1.5 rounded-xl border p-2', got ? 'border-brand/50 bg-brand-tint' : 'border-line')}>
                    {d.levels.map((l, n) => (
                      <div key={n} className={cx('min-w-[120px] flex-1 rounded-lg px-2 py-1.5 text-[12.5px] leading-relaxed', got === n + 1 ? 'bg-brand-soft text-ink' : 'text-ink-2')}>
                        <p className="mb-0.5 flex items-center gap-1.5 text-[11px] text-ink-3">
                          {d.levels.length > 1 ? `第 ${n + 1} 档` : '一档'} · {l.pp} P 点
                          {got === n + 1 && <span className="rounded-[3px] bg-brand-deep px-1 text-[10.5px] font-bold text-white">这张</span>}
                        </p>
                        <p className="whitespace-pre-line">{l.text}</p>
                      </div>
                    ))}
                  </li>
                )
              })}
            </ul>
            {unknown.length > 0 && (
              <p className="mt-1.5 font-mono text-[11px] break-all text-ink-3">目录里没有的定制：{unknown.map(([k, n]) => `${k} ×${n}`).join('，')}</p>
            )}
            <p className="mt-1.5 text-[12px] text-ink-3">「+N」是在卡面数值上再加的量；同一方向有多档时，写的是到这一档为止的总量，不和前一档叠加。{current != null && !have.size && '这张卡没有做定制。'}</p>
          </section>
        )}
        {!c.custom && !!customizes?.length && (
          <p className="font-mono text-[11px] break-all text-ink-3">定制：{customizes.map(([k, n]) => `${k} ×${n}`).join('，')}</p>
        )}
        {groups.length > 1 && <p className="text-[12px] text-ink-3"><span className="rounded bg-brand-soft px-1 text-ink">浅橙底</span> 是比上一档新增或变了的行。</p>}
      </DialogContent>
    </Dialog>
  )
}
