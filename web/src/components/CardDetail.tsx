import { useState } from 'react'
import type { CatalogCard } from '../lib/api'
import { diffLines } from '../lib/textdiff'
import type { CustomCard } from '../lib/guides'
import { RECOMMEND, customLabel, hasCustomize, recommendOf, useSceneCustom } from './CustomStats'
import { spriteUrl, useLang, useTerms } from '../lib/catalog'
import { CATEGORY_JA } from '../lib/game'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CopyId, cx } from './ui'

/** 技能卡的图、标签和详情弹窗：游戏资源一览和题的牌组共用 */

export const CATEGORY = CATEGORY_JA
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
  const terms = useTerms()
  return (
    <div className="flex flex-wrap gap-1">
      <RarityTag r={c.rarity} />
      <Meta>{terms.plan[c.plan] ?? c.plan}</Meta>
      <Meta>{terms.category[c.category] ?? c.category}</Meta>
      {sourceOf(id) !== 'common' && <Meta>{SOURCE[sourceOf(id)]}</Meta>}
      {c.unlock ? <UnlockTag lv={c.unlock} /> : null}
    </div>
  )
}

/** 一张卡的详情：先只放未强化和 +（效果一样的档合成一格），++ / +++ 点「展开」再看；比上一档新增或改动的字用绿色标出来（逐字比，见 lib/textdiff）。
 * 下面列这张卡的定制方向（每张卡不一样）。current：牌组里这张卡的强化档（标「这张」）；customizes：这张卡做了的定制 [方向编号, 档]。
 * stats：这张卡的定制统计；不给时按页面声明的场景（CardScene：模式 + 偶像卡，默认 H.I.F）取对应模式的数据；场景是初时不出定制方向。给了就把「排行榜上的定制选择」放最上面，
 * 顺序固定：强化档效果在上，定制方向在下；有统计时定制方向标题下写一行「几份记录、几成做了定制、数据来源」，每档写选的比例，
 * 数据说得清时标「推荐定制」（规则见 CustomStats.recommendOf）。
 * 嵌在别的弹窗里时用 open 控制开关、不要直接卸载：直接卸载的话外层弹窗不知道里层已经关了，Esc 关不掉外层 */
export function CardDetail({ id, c, onClose, open = true, current, customizes, stats: given }: { id: string; c: CatalogCard; onClose: () => void; open?: boolean; current?: number; customizes?: [string, number][]; stats?: CustomCard }) {
  const { lang } = useLang()
  const levels = Object.entries(c.up).sort((a, b) => Number(a[0]) - Number(b[0]))
  // 普通体力消耗（先扣元气）不在效果文字里，不少卡强化只改它，有的话写成第一行，和效果一起比、一起标绿。
  // 直接扣体力的（force_stamina）效果文字开头本来就写「体力消費N」，集中消費等别的消耗也在效果里，都不另写。
  // 一张卡有一档写了体力消耗、别的档没写 = 那档是 0
  const hasCost = levels.some(([, x]) => x.stamina != null)
  const costLine = (x: CatalogCard['up'][string]) => `${lang === 'zh' ? '体力消耗' : 'コスト'} ${x.stamina ?? 0}`
  // 效果文字（连体力消耗）和前一档完全一样的强化档合成一格（不少卡的 ++、+++ 和 + 相同）；未强化单独一格
  const groups: { lvs: number[]; name: string; text: string }[] = []
  for (const [lv, x] of levels) {
    const text = hasCost ? `${costLine(x)}\n${x.text}` : x.text
    const last = groups[groups.length - 1]
    if (last && last.lvs[0] > 0 && last.text === text) last.lvs.push(Number(lv))
    else groups.push({ lvs: [Number(lv)], name: x.name, text })
  }
  const merged = groups.some((g) => g.lvs.length > 1)
  const have = new Map(customizes ?? [])
  const unknown = (customizes ?? []).filter(([k]) => !c.custom?.dirs.some((d) => d.id === k))
  const sceneCustom = useSceneCustom(id)
  const showCustom = hasCustomize(sceneCustom.scene.mode)
  const stats = showCustom ? given ?? sceneCustom.s : undefined
  const source = given ? undefined : sceneCustom.label
  // 先只放未强化和 +；牌组里这张卡是 ++ / +++ 时直接展开
  const more = groups.filter((g) => g.lvs[0] >= 2)
  // 弹窗常驻、只换卡时（示例牌组）展开状态跟着卡走
  const [toggled, setToggled] = useState<{ id: string; v: boolean } | null>(null)
  const showMore = toggled?.id === id ? toggled.v : current != null && more.some((g) => g.lvs.includes(current))
  const setShowMore = (v: boolean) => setToggled({ id, v })
  const rec = recommendOf(stats)
  const recTiers = new Set((rec?.c ?? []).map(([k, lv]) => `${k}*${lv}`))
  const levelsBlock = (
      <>
        {levels.length === 1 && <p className="text-[12.5px] text-ink-3">这张卡不能强化。</p>}
        <div className={cx('grid gap-3', groups.length > 1 && 'sm:grid-cols-2')}>
          {groups.map((g, k) => {
            if (g.lvs[0] >= 2 && !showMore) return null
            const lines = k > 0 ? diffLines(groups[k - 1].text, g.text) : g.text.split('\n').map((t) => [{ t, add: false }])
            const mine = current != null && g.lvs.includes(current)
            return (
              <div key={g.lvs[0]} className={cx('rounded-xl border p-3', mine ? 'border-brand/50 bg-brand-tint' : 'border-line')}>
                <p className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="font-bold text-ink">{g.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-ink-3">
                    {mine && <span className="rounded-[3px] bg-brand-deep px-1 text-[10.5px] font-bold text-white">这张</span>}
                    {g.lvs.length > 1 ? `强化 ${'+'.repeat(g.lvs[0])} ～ ${'+'.repeat(g.lvs[g.lvs.length - 1])}` : (UP_LABEL[g.lvs[0]] ?? `强化 ${g.lvs[0]}`)}
                  </span>
                </p>
                <ul className="space-y-0.5 text-[12.5px] leading-relaxed text-ink-2">
                  {lines.map((segs, n) => (
                    <li key={n}>{segs.map((x, i) => x.add ? <mark key={i} className="rounded-[3px] bg-up-soft px-[1px] font-semibold text-up">{x.t}</mark> : <span key={i}>{x.t}</span>)}</li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
        {more.length > 0 && (
          <button type="button" onClick={() => setShowMore(!showMore)} className="flex w-full cursor-pointer items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong py-2 text-[12.5px] text-ink-2 hover:border-brand hover:text-brand-ink">
            {showMore ? '收起 ++ / +++' : `展开 ${more.map((g) => g.lvs.length > 1 ? `${'+'.repeat(g.lvs[0])}～${'+'.repeat(g.lvs[g.lvs.length - 1])}` : '+'.repeat(g.lvs[0])).join(' / ')} 强化`}
            <span className={cx('transition-transform', showMore && 'rotate-180')}>▾</span>
          </button>
        )}
        {merged && <p className="text-[12px] text-ink-3">主数据里这张卡后面几档的效果和前一档完全一样，合成了一格：再往上强化不会变。</p>}
      </>
  )
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-2xl sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <CardImage c={c} size={72} />
            <div className="min-w-0">
              <DialogTitle className="text-[18px] font-bold">{c.name}</DialogTitle>
              {rec && (
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-2">
                  <span className="rounded-[3px] bg-brand-deep px-1 text-[10.5px] font-bold text-white">推荐定制</span>
                  {rec.c.map(([k, lv]) => customLabel(c, k, lv).short).join(' + ')}
                </p>
              )}
              <div className="mt-1.5"><CardTags id={id} c={c} /></div>
              <DialogDescription className="mt-1"><CopyId id={id} /></DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {levelsBlock}
        {showCustom && c.custom && c.custom.dirs.length > 0 && (
          <section>
            <h3 className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-[13px] font-bold text-ink">
              定制方向
              <span className="text-[11.5px] font-normal text-ink-3">这张卡能选的 {c.custom.dirs.length} 个方向，合计最多定制 {c.custom.max} 次</span>
            </h3>
            {stats && (
              <p className="mb-2 text-[12px] text-ink-2">
                {source ? `${source}里` : '排行榜上'}带这张卡的 <b className="num text-ink">{stats.n}</b> 份记录，<b className="num text-ink">{Math.round(stats.share * 100)}%</b> 做了定制
                <span className="text-ink-3">
                  {!rec && stats.n < RECOMMEND.minN && ` · 记录不到 ${RECOMMEND.minN} 份，不给推荐`}
                  {!rec && stats.n >= RECOMMEND.minN && stats.share >= RECOMMEND.minShare && ' · 选法分散，不给推荐'}
                </span>
              </p>
            )}
            <ul className="space-y-1.5">
              {c.custom.dirs.map((d) => {
                const got = have.get(d.id) ?? 0
                return (
                  <li key={d.id} className={cx('flex flex-wrap items-stretch gap-1.5 rounded-xl border p-2', got ? 'border-brand/50 bg-brand-tint' : 'border-line')}>
                    {d.levels.map((l, n) => {
                      const key = `${d.id}*${n + 1}`
                      const pick = stats ? stats.tiers[key] ?? 0 : null
                      const isRec = recTiers.has(key)
                      return (
                      <div key={n} className={cx('min-w-[120px] flex-1 rounded-lg px-2 py-1.5 text-[12.5px] leading-relaxed', got === n + 1 || isRec ? 'bg-brand-soft text-ink' : 'text-ink-2', isRec && 'ring-[1.5px] ring-brand ring-inset')}>
                        <p className="mb-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ink-3">
                          <span className="whitespace-nowrap">{d.levels.length > 1 ? `第 ${n + 1} 档` : '一档'} · {l.pp} P 点</span>
                          {got === n + 1 && <span className="rounded-[3px] bg-brand-deep px-1 text-[10.5px] font-bold text-white">这张</span>}
                          {isRec && <span className="rounded-[3px] bg-brand-deep px-1 text-[10.5px] font-bold whitespace-nowrap text-white">推荐定制</span>}
                          {pick != null && <span className={cx('num ml-auto text-[11.5px] whitespace-nowrap', isRec ? 'font-bold text-brand-ink' : pick > 0 ? 'font-semibold text-ink-2' : 'text-ink-3')}>选 {Math.round(pick * 100)}%</span>}
                        </p>
                        <p className="whitespace-pre-line">{l.text}</p>
                      </div>
                      )
                    })}
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
      </DialogContent>
    </Dialog>
  )
}
