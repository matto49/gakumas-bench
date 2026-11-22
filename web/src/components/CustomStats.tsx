import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useApi } from '../lib/hooks'
import type { CatalogCard } from '../lib/api'
import { useCatalog } from '../lib/catalog'
import type { CustomCard, CustomStats } from '../lib/guides'
import { CardImage } from './CardDetail'
import { cx } from './ui'

/** 定制优先级（推荐牌组面板里）、页面上下文里的定制统计和「推荐定制」规则。数据见 lib/guides.ts 的 CustomStats */

const pct = (v: number) => `${Math.round(v * 100)}%`
/** 优先级列表只列入选率不低于这个的卡，免得几个人带的冷门卡排到前面 */
const MIN_ADOPT = 0.2
/** 多数人选的那种定制不到做了定制的人的这个比例时，写「分两派」 */
const SPLIT = 0.6

/** 卡牌弹窗的场景：从哪个模式打开（决定定制建议用哪份数据），以及当前是哪张偶像卡（有的话先看这张偶像卡的）。
 * 默认 H.I.F（角色强度榜、游戏资源一览、首页等）。初没有定制功能，弹窗里不出定制方向。
 * 数据按场景取：insights-<模式> 里这张偶像卡的 → 同模式全部偶像卡合起来的（pooled）→ 都没有就只列定制方向、不给建议。不跨模式借数据 */
export type CardMode = 'hif' | 'nia' | 'hajime' | 'idolroad'
export type CardSceneValue = { mode: CardMode; idol?: string }
export const CardSceneContext = createContext<CardSceneValue>({ mode: 'hif' })
export function CardScene({ mode, idol, children }: { mode: CardMode; idol?: string; children: ReactNode }) {
  const value = useMemo(() => ({ mode, idol }), [mode, idol])
  return <CardSceneContext.Provider value={value}>{children}</CardSceneContext.Provider>
}
export const MODE_LABEL: Record<CardMode, string> = { hif: 'H.I.F 排行榜', nia: 'N.I.A 排行榜', hajime: '初', idolroad: '偶像之路' }
export const hasCustomize = (m: CardMode) => m !== 'hajime'
/** 页面上的模式参数 → 场景；认不出来的按默认 H.I.F */
export function cardMode(m?: string | null): CardMode {
  return m === 'nia' || m === 'hajime' || m === 'idolroad' || m === 'hif' ? m : 'hif'
}
/** 题的考试编号 → 场景（produce-001/002/003/006 初，004/005 N.I.A，007/008 H.I.F，tower 偶像之路） */
export function modeOfExam(exam?: string): CardMode {
  if (exam === 'tower') return 'idolroad'
  if (exam === 'produce-004' || exam === 'produce-005') return 'nia'
  if (exam === 'produce-001' || exam === 'produce-002' || exam === 'produce-003' || exam === 'produce-006') return 'hajime'
  return 'hif'
}
type InsightsLike = { idols: Record<string, { custom?: CustomStats }>; pooled?: { n: number; cards: CustomCard[] } }
/** 按当前场景找这张技能卡的定制统计，label 写数据从哪来（弹窗里写成「<label>里带这张卡的 N 份记录」） */
export function useSceneCustom(id: string): { scene: CardSceneValue; s?: CustomCard; label?: string } {
  const scene = useContext(CardSceneContext)
  const path = hasCustomize(scene.mode) ? `api/guides/insights-${scene.mode}` : null
  const d = useApi<InsightsLike>(path)
  const data = path && d.loadedPath === path ? d.data : null
  const own = scene.idol ? data?.idols[scene.idol]?.custom?.cards.find((x) => x.id === id) : undefined
  if (own) return { scene, s: own, label: MODE_LABEL[scene.mode] }
  const pooled = data?.pooled?.cards.find((x) => x.id === id)
  if (pooled) return { scene, s: pooled, label: `${MODE_LABEL[scene.mode]}全部偶像卡` }
  return { scene }
}

/** 「推荐定制」只在数据说得清的时候给：带这张卡的记录够多、多数人做了定制、做了定制的人里多数选同一种 */
export const RECOMMEND = { minN: 20, minShare: 0.5, minTop: 0.6 }
export function recommendOf(s?: CustomCard) {
  if (!s || s.n < RECOMMEND.minN || s.share < RECOMMEND.minShare) return null
  const top = s.combos.find((x) => x.c.length)
  return top && top.share / s.share >= RECOMMEND.minTop ? top : null
}

/** 一种定制（方向编号, 档）→ 短名和完整效果。短名取效果第一行「：」前面的部分（「持续效果+：在之后的…」→「持续效果+」），多档的方向后面写第几档 */
export function customLabel(c: CatalogCard | undefined, dir: string, lv: number) {
  const d = c?.custom?.dirs.find((x) => x.id === dir)
  const text = d?.levels[lv - 1]?.text ?? dir
  const first = text.split('\n')[0]
  const i = first.indexOf('：')
  const short = (i > 0 ? first.slice(0, i) : first) + (d && d.levels.length > 1 ? ` · ${lv} 档` : '')
  return { short, text, detail: i > 0 ? text.slice(text.indexOf('：') + 1).replace(/\n/g, '') : '' }
}
const comboShort = (c: CatalogCard | undefined, combo: [string, number][]) => combo.map(([k, lv]) => customLabel(c, k, lv).short).join(' + ')

function Bar({ v, tone = 'bg-brand' }: { v: number; tone?: string }) {
  return (
    <span className="block h-[6px] overflow-hidden rounded-full bg-surface-3">
      <i className={cx('block h-full rounded-full', tone)} style={{ width: `${Math.max(0, Math.min(100, v * 100))}%` }} />
    </span>
  )
}

/** 推荐牌组面板里的一块：一局定制几张（中位数 + 小直方图），下面按「带这张卡的人里做了定制的比例」排的列表，中位数位置画一道线 */
export function CustomPriority({ cs, onOpen, limit = 8, bare, source }: { cs: CustomStats; onOpen: (id: string) => void; limit?: number; bare?: boolean; source?: string }) {
  const cat = useCatalog()
  const [all, setAll] = useState(false)
  const rows = cs.cards.filter((r) => r.adopt >= MIN_ADOPT && cat?.cards[r.id]?.custom)
  if (!rows.length) return null
  const shown = all ? rows : rows.slice(0, limit)
  const med = cs.per_run.median
  const cut = Math.round(med)
  const hist = cs.per_run.hist
  const top = Math.max(...hist, 1)
  return (
    <div className={bare ? '' : 'mt-3 border-t border-line pt-3'}>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <p className="text-[14px] font-bold text-ink">定制优先级</p>
          <p className="text-[12px] text-ink-3">带这张卡的人里，做了定制的比例{source && <> · <span className="text-brand-ink">数据来自{source}</span></>}</p>
        </div>
        <div className="flex items-end gap-2.5" title={`一局做了定制的卡：平均 ${cs.per_run.mean} 张`}>
          <span className="flex flex-col gap-0.5">
            <span className="flex h-7 items-end gap-[2px]">
              {hist.map((v, k) => <i key={k} className={cx('block w-[7px] rounded-t-[2px]', k === cut ? 'bg-brand' : 'bg-line-strong')} style={{ height: `${Math.max(2, (28 * v) / top)}px` }} />)}
            </span>
            <span className="flex gap-[2px] text-[9px] leading-none text-ink-3">
              {hist.map((_, k) => <span key={k} className="w-[7px] text-center">{k % 2 === 0 ? k : ''}</span>)}
            </span>
          </span>
          <span className="text-right">
            <b className="disp block text-[28px] leading-none text-ink">{med}<span className="text-[14px]"> 张</span></b>
            <span className="text-[11px] text-ink-3">一局定制（中位数）</span>
          </span>
        </div>
      </div>
      <ul>
        {shown.map((r, i) => {
          const c = cat?.cards[r.id]
          const done = r.combos.filter((x) => x.c.length)
          const [a, b] = done
          const line = !a ? '' : b && a.share / r.share < SPLIT
            ? <><span className="text-brand-ink">分两派</span>：{comboShort(c, a.c)} {pct(a.share)} · {comboShort(c, b.c)} {pct(b.share)}</>
            : <>多数选「{comboShort(c, a.c)}」</>
          return (
            <li key={r.id}>
              {cut >= 1 && i === cut && (
                <p className="my-1 ml-8 flex items-center gap-2 text-[11.5px] text-brand-ink before:flex-1 before:border-t before:border-dashed before:border-brand/50 after:flex-1 after:border-t after:border-dashed after:border-brand/50">
                  一局定制 {med} 张 · 往下的一般轮不到
                </p>
              )}
              <button type="button" onClick={() => onOpen(r.id)} className="grid w-full cursor-pointer grid-cols-[16px_32px_minmax(0,1fr)_88px] items-center gap-x-2.5 rounded-lg px-1 py-1.5 text-left hover:bg-brand-tint">
                <span className={cx('disp text-right text-[15px]', i < cut ? 'text-brand-ink' : 'text-ink-3')}>{i + 1}</span>
                {c ? <CardImage c={c} size={32} /> : <span className="size-8" />}
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold text-ink">{c?.name ?? r.id}</span>
                  <span className="line-clamp-2 text-[12px] leading-snug text-ink-2">{line}</span>
                </span>
                <span className="grid grid-cols-[1fr_32px] items-center gap-x-1.5">
                  <Bar v={r.share} />
                  <b className="num text-right text-[13px] text-ink">{pct(r.share)}</b>
                  <span className="num col-span-2 text-[11px] text-ink-3">入选 {pct(r.adopt)}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="mt-1.5 text-[12px] text-ink-3">
        只列能定制、入选率不低于 {pct(MIN_ADOPT)} 的卡
        {rows.length > limit && <> · <button type="button" onClick={() => setAll(!all)} className="cursor-pointer text-brand-ink hover:underline">{all ? '收起' : `展开全部 ${rows.length} 张`}</button></>}
        {' '}· 点一行看各种定制选了多少
      </p>
    </div>
  )
}
