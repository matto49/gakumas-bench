import type { ReactNode } from 'react'
import { cardName, spriteUrl, useCatalog, useLang } from '../lib/catalog'
import { pairBi, type SupportCatalog } from '../lib/supports'
import { item, type CustomStats, type GuideEntry, type GuideInsight, type IdolSummary, type Quartiles } from '../lib/guides'
import { cx, Help, Tip } from './ui'
import { CardImage, RarityTag } from './CardDetail'
import { CustomPriority } from './CustomStats'
import { SupportThumb } from './SupportCard'

/** 偶像卡攻略单卡页顶上的看板：一段结论 + 推荐牌组、技能卡分差、常用搭配、三维四块（版式参考强度榜单卡页）。
 * 牌组和分差来自 api/guides/insights-<模式>（gkbench.guide_insights，整副终局牌组），支援卡、P 道具、三维来自攻略包的统计条目 */

type Open = { card: (id: string) => void; item: (id: string) => void; support: (id: string) => void }

const pct = (v: number) => `${Math.round(v * 100)}%`
const signed = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(d)}%`

function Panel({ title, sub, help, children, className }: { title: ReactNode; sub?: ReactNode; help?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface p-4', className)}>
      <h2 className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-[15px] font-bold text-ink">{title}{help && <Help tip={help} />}</span>
        {sub && <span className="text-[12px] text-ink-3">{sub}</span>}
      </h2>
      {children}
    </section>
  )
}

/** 结论条的一格：小标题 + 内容，格与格之间一道细线 */
function Cell({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cx('min-w-0 bg-surface px-4 py-3', wide && 'col-span-2 lg:col-span-1')}>
      <p className="mb-2 text-[12px] text-ink-3">{label}</p>
      {children}
    </div>
  )
}

function Bar({ v, max = 1, tone = 'bg-da' }: { v: number; max?: number; tone?: string }) {
  return (
    <span className="block h-[6px] overflow-hidden rounded-full bg-surface-3">
      <i className={cx('block h-full rounded-full', tone)} style={{ width: `${Math.max(0, Math.min(100, (100 * v) / max))}%` }} />
    </span>
  )
}

/** 一张技能卡的小图：右上角「+」= 多数强化过，左上角「忆」= 多数是回忆带进来的，右下角 ×N = 平均带好几张 */
function CardChip({ id, upgraded, memory, copies, onOpen, size = 44, children }: { id: string; upgraded?: boolean; memory?: boolean; copies?: number; onOpen: (id: string) => void; size?: number; children?: ReactNode }) {
  const cat = useCatalog()
  const c = cat?.cards[id]
  const many = copies != null && copies >= 1.5
  return (
    <Tip tip={<>{cardName(cat, id, upgraded ? 1 : 0)}{memory ? '（回忆带入）' : ''}{many ? `，平均 ${copies!.toFixed(1)} 张` : ''}</>}>
      <button type="button" onClick={() => onOpen(id)} className="relative flex cursor-pointer flex-col items-center gap-0.5 rounded-lg p-0.5 hover:bg-surface-2">
        {c ? <CardImage c={c} size={size} /> : <span className="rounded-lg bg-surface-3" style={{ width: size, height: size }} />}
        {upgraded && <span className="absolute top-0 right-0 rounded-[3px] bg-brand-deep px-[3px] text-[10px] leading-tight font-bold text-white">+</span>}
        {memory && <span className="absolute top-0 left-0 rounded-[3px] bg-ink px-[3px] text-[9.5px] leading-tight font-bold text-white">忆</span>}
        {many && <span className="num absolute right-0 bottom-[15px] rounded-[3px] bg-surface/90 px-[3px] text-[10px] leading-tight font-bold text-ink ring-1 ring-line">×{Math.round(copies!)}</span>}
        {children}
      </button>
    </Tip>
  )
}

function ItemIcon({ id, size = 40, onOpen, children }: { id: string; size?: number; onOpen: (id: string) => void; children?: ReactNode }) {
  const cat = useCatalog()
  const it = cat?.items[id]
  return (
    <Tip tip={<><b>{it?.name ?? id}</b>{it?.text && <><br /><span className="whitespace-pre-line">{it.text}</span></>}</>} wide>
      <button type="button" onClick={() => onOpen(id)} className="flex cursor-pointer flex-col items-center gap-0.5 rounded-md p-0.5 hover:bg-surface-2">
        <span className="shrink-0 overflow-hidden rounded-md bg-surface-2 ring-1 ring-line" style={{ width: size, height: size }}>
          {it?.asset && <img src={spriteUrl(it.asset)} alt="" width={size} height={size} loading="lazy" className="size-full object-contain" />}
        </span>
        {children}
      </button>
    </Tip>
  )
}

const ATTR = { vo: { label: 'Vo', tone: 'bg-vo', chip: 'bg-vo-strong text-white' }, da: { label: 'Da', tone: 'bg-da', chip: 'bg-da-strong text-white' }, vi: { label: 'Vi', tone: 'bg-vi', chip: 'bg-vi-strong text-ink' } } as const
type Attr = keyof typeof ATTR

type DeckCard = GuideInsight['deck']['cards'][number]

/** 典型牌组：N 卡（初始牌组里没删掉的「〜の基本」、事件塞进来的「眠気」这类）不算推荐，单独记张数；
 * 其余按出现率从高到低取，每张按平均张数（四舍五入）算，凑够「牌组中位数 − 平均留着的 N 卡张数」为止 */
function typicalDeck(ins: GuideInsight, isFiller: (id: string) => boolean) {
  const filler = ins.deck.cards.filter((c) => isFiller(c.id))
  const fillerCount = filler.reduce((s, c) => s + c.share * c.copies, 0)
  const target = Math.max(0, Math.round(ins.deck.size.p50 - fillerCount))
  const out: DeckCard[] = []
  let count = 0
  for (const c of ins.deck.cards) {
    if (isFiller(c.id)) continue
    if (count >= target || c.share < 0.3) break
    out.push(c)
    count += Math.max(1, Math.round(c.copies))
  }
  return { deck: out, filler, fillerCount, target }
}

export function GuideDashboard({ ins, stats, summary, sup, open, modeLabel, fetched, custom, customFrom }: {
  ins?: GuideInsight
  /** 本模式没有定制数据时借来的（偶像之路），customFrom 写来源 */
  custom?: CustomStats
  customFrom?: string
  stats: GuideEntry[]
  summary?: IdolSummary
  sup?: SupportCatalog
  open: Open
  modeLabel: string
  fetched?: string
}) {
  const cat = useCatalog()
  const { lang } = useLang()
  const stat = (d: string) => stats.find((e) => e.kind === 'stat' && e.decision === d)
  const attrs = (stat('formation.main_attr')?.content.prefer ?? []).map(item)
  const mainAttr = attrs[0]
  // 第一名不到七成、第二名也有两成以上：两种主属性都有人走，结论里两个都写
  const split = mainAttr && (mainAttr.stat?.share ?? 0) < 0.7 && (attrs[1]?.stat?.share ?? 0) >= 0.2 ? attrs[1] : undefined
  const supports = (stat('formation.support')?.content.prefer ?? []).map(item).slice(0, 8)
  const pitems = (stat('formation.pitem')?.content.prefer ?? []).map(item).slice(0, 8)
  const targets = stat('params_target')?.content.targets as Record<Attr, Quartiles | undefined> | undefined
  const isFiller = (id: string) => cat?.cards[id]?.rarity === 'N'
  const { deck, filler, fillerCount, target } = ins ? typicalDeck(ins, isFiller) : { deck: [] as DeckCard[], filler: [] as DeckCard[], fillerCount: 0, target: 0 }
  const inDeck = new Set(deck.map((c) => c.id))
  const also = ins ? ins.deck.cards.filter((c) => !inDeck.has(c.id) && !isFiller(c.id) && c.share >= 0.25).slice(0, 10) : []
  const must = ins ? ins.deck.cards.filter((c) => !isFiller(c.id) && c.share >= 0.9).length : 0
  // 分差：两倍标准误以内的算「看不出差别」，不进「该带 / 拖分」
  const sig = (ins?.lift ?? []).filter((l) => Math.abs(l.diff) >= 2 * l.se)
  const best = sig.filter((l) => l.diff > 0).slice(0, 6)
  const worst = sig.filter((l) => l.diff < 0).slice(-3).reverse()
  const topW = Math.max(0.0001, ...[...best, ...worst].map((l) => Math.abs(l.diff)))
  const supName = (id: string) => pairBi(sup?.cards[id]?.name, lang, id).main
  if (!ins && !supports.length && !targets) return null

  const attrKey = mainAttr?.id as Attr | undefined
  return (
    <div className="mb-10 space-y-4">
      {/* 结论：四格一眼看完——主属性、牌组、支援卡首选、终局三维 */}
      <section aria-label="结论" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-[auto_auto_minmax(0,1.3fr)_minmax(0,1fr)]">
        {attrKey && ATTR[attrKey] && (
          <Cell label={split ? `${modeLabel} 主属性 · 分两派` : `${modeLabel} 主属性`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {[mainAttr!, ...(split ? [split] : [])].map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1.5">
                  <span className={cx('inline-grid h-7 min-w-9 place-items-center rounded-md px-2 text-[14px] font-bold', ATTR[a.id as Attr]?.chip)}>{ATTR[a.id as Attr]?.label}</span>
                  <span className="num text-[13px] text-ink-2">{pct(a.stat?.share ?? 0)}</span>
                </span>
              ))}
            </div>
          </Cell>
        )}
        {ins && (
          <Cell label="牌组">
            <p className="text-ink-2"><b className="num text-[22px] leading-none text-ink">{ins.deck.size.p50}</b> 张<span className="mx-2 text-line-strong">·</span>必带 <b className="num text-[16px] text-ink">{must}</b> 张</p>
            {fillerCount >= 0.5 && <p className="mt-1 text-[12px] text-ink-3">含没删掉的基本卡约 {fillerCount.toFixed(1)} 张</p>}
          </Cell>
        )}
        {supports.length > 0 && (
          <Cell label="支援卡首选" wide>
            <div className="flex gap-2.5">
              {supports.slice(0, 5).map((s, i) => (
                <button key={s.id} type="button" onClick={() => open.support(s.id)} title={supName(s.id)} className={cx(i >= 3 && 'max-lg:hidden', 'group flex w-[5.5rem] min-w-0 cursor-pointer flex-col items-center gap-1')}>
                  <span className="relative">
                    <SupportThumb id={s.id} size={44} className="rounded-lg transition-transform group-hover:-translate-y-0.5" />
                    <span className="num absolute -right-1 -bottom-1 rounded-full bg-ink px-1.5 text-[10.5px] leading-[16px] font-semibold text-white">{pct(s.stat?.share ?? 0)}</span>
                  </span>
                  <span className="w-full truncate text-center text-[11.5px] text-ink-2 group-hover:text-brand-ink">{supName(s.id).replace(/[、，,。！!？?]+$/, '')}</span>
                </button>
              ))}
            </div>
          </Cell>
        )}
        {targets && (
          <Cell label="终局三维（中位数）" wide>
            {(() => {
              const vals = (['vo', 'da', 'vi'] as const).map((a) => targets[a]?.p50 ?? 0)
              const sum = vals.reduce((x, y) => x + y, 0) || 1
              return (
                <>
                  <span className="flex h-2 overflow-hidden rounded-full">
                    {(['vo', 'da', 'vi'] as const).map((a, i) => <i key={a} className={ATTR[a].tone} style={{ width: `${(100 * vals[i]) / sum}%` }} />)}
                  </span>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {(['vo', 'da', 'vi'] as const).map((a, i) => (
                      <span key={a} className="min-w-0">
                        <span className={cx('block text-[11.5px]', a === attrKey ? 'font-semibold text-ink' : 'text-ink-3')}>{ATTR[a].label}</span>
                        <b className={cx('num text-[16px]', a === attrKey ? 'text-ink' : 'text-ink-2')}>{vals[i].toLocaleString()}</b>
                      </span>
                    ))}
                  </div>
                </>
              )
            })()}
          </Cell>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {ins && (
          <Panel title="推荐牌组" sub={`排行榜上的典型牌组 · ${target} 张`}
            help="按每张卡在终局牌组里的出现率从高到低取，凑够常见张数为止；百分比是带这张卡的人的比例。「〜の基本」这类初始基本卡和「眠気」不算推荐，单独写在下面。+ = 这张卡多数是强化过的；忆 = 终局牌组里的这张卡，过半是回忆带进来的（排行榜记录里每张卡都标了是不是回忆带入），不是培育中拿的；×2 = 平均带两张。点卡看效果">
            <div className="flex flex-wrap gap-1">
              {deck.map((c) => (
                <CardChip key={c.id} id={c.id} upgraded={c.upgraded >= 0.5} memory={c.memory >= 0.5} copies={c.copies} onOpen={open.card}>
                  <span className={cx('num text-[11px]', c.share >= 0.9 ? 'font-semibold text-ink' : 'text-ink-3')}>{pct(c.share)}</span>
                </CardChip>
              ))}
            </div>
            <p className="mt-3 text-[13px] text-ink-2">
              必带 <b className="num text-ink">{must}</b> 张（≥ 90%）· 整副牌多为 <b className="num text-ink">{ins.deck.size.p25}–{ins.deck.size.p75}</b> 张
              {fillerCount >= 0.5 && <>，其中平均 <b className="num text-ink">{fillerCount.toFixed(1)}</b> 张是没删掉的基本卡和眠気</>}
            </p>
            {fillerCount >= 0.5 && (
              <p className="mt-1 text-[12px] text-ink-3">
                {filler.filter((c) => c.share >= 0.2).map((c, i) => <span key={c.id}>{i > 0 && '、'}{cardName(cat, c.id)} <span className="num">{pct(c.share)}</span>{c.copies >= 1.5 && <> ×{Math.round(c.copies)}</>}</span>)}
                。删卡次数有限，这些多半是来不及删，不是特意留的；先删哪张看下面「删哪些卡」。
              </p>
            )}
            {also.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="mb-1.5 text-[12px] text-ink-3">也常见（替换位）</p>
                <div className="flex flex-wrap gap-1">
                  {also.map((c) => (
                    <CardChip key={c.id} id={c.id} upgraded={c.upgraded >= 0.5} memory={c.memory >= 0.5} copies={c.copies} onOpen={open.card} size={34}>
                      <span className="num text-[10.5px] text-ink-3">{pct(c.share)}</span>
                    </CardChip>
                  ))}
                </div>
              </div>
            )}
            {(ins.custom ?? custom) && <CustomPriority cs={(ins.custom ?? custom)!} onOpen={open.card} source={ins.custom ? undefined : customFrom} />}
          </Panel>
        )}

        {ins && (
          <Panel title="技能卡权重" sub="带 vs 不带的平均分差"
            help="同一张偶像卡的排行榜记录里，牌组带这张卡的平均分比不带的高（低）多少，按平均分的百分比算；± 后是标准误。只比带的人在 10%–90% 之间的卡，差别在两倍标准误以内的不列。这是排行榜上的相关，不是因果：带某张卡的人可能本来练度就高">
            {best.length === 0 && worst.length === 0 ? (
              <p className="text-[13px] text-ink-3">排行榜上带不带哪张卡，分数都看不出明显差别。</p>
            ) : (
              <>
                {best.length > 0 && <p className="mb-1 text-[12px] text-ink-3">带了分更高</p>}
                <div className="space-y-1">
                  {best.map((l) => (
                    <div key={l.id} className="grid grid-cols-[auto_minmax(0,1fr)_16%_auto_auto] sm:grid-cols-[auto_minmax(0,1fr)_32%_auto_auto] items-center gap-2 text-[13px]">
                      <CardChip id={l.id} onOpen={open.card} size={28} />
                      <span className="min-w-0 truncate">{cardName(cat, l.id)}</span>
                      <Bar v={l.diff} max={topW} />
                      <span className="num w-[5.6rem] text-right whitespace-nowrap"><b>{signed(l.diff)}</b><span className="text-[11px] text-ink-3"> ±{(l.se * 100).toFixed(1)}</span></span>
                      <Tip tip="带这张卡的人的比例"><span className="num w-9 text-right text-ink-3">{pct(l.share)}</span></Tip>
                    </div>
                  ))}
                </div>
                {worst.length > 0 && (
                  <>
                    <p className="mt-3 mb-1 text-[12px] text-ink-3">带了分更低</p>
                    <div className="space-y-1">
                      {worst.map((l) => (
                        <div key={l.id} className="grid grid-cols-[auto_minmax(0,1fr)_16%_auto_auto] sm:grid-cols-[auto_minmax(0,1fr)_32%_auto_auto] items-center gap-2 text-[13px]">
                          <CardChip id={l.id} onOpen={open.card} size={28} />
                          <span className="min-w-0 truncate text-ink-2">{cardName(cat, l.id)}</span>
                          <Bar v={Math.abs(l.diff)} max={topW} tone="bg-line-strong" />
                          <span className="num w-[5.6rem] text-right whitespace-nowrap text-ink-2"><b>{signed(l.diff)}</b><span className="text-[11px] text-ink-3"> ±{(l.se * 100).toFixed(1)}</span></span>
                          <span className="num w-9 text-right text-ink-3">{pct(l.share)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </Panel>
        )}

        {(supports.length > 0 || pitems.length > 0) && (
          <Panel title="常用搭配" sub="排行榜上带的比例">
            {supports.length > 0 && (
              <>
                <p className="mb-1.5 text-[12px] text-ink-3">支援卡<Help tip="条的深色段是满凸的人。没满凸怎么选，看下面「支援卡」的明细" /></p>
                <div className="space-y-1.5">
                  {supports.map((s) => (
                    <div key={s.id} className="grid grid-cols-[auto_minmax(0,1fr)_20%_auto] sm:grid-cols-[auto_minmax(0,1fr)_30%_auto] items-center gap-2 text-[13px]">
                      <SupportThumb id={s.id} size={30} className="rounded-md" />
                      <button type="button" onClick={() => open.support(s.id)} className="min-w-0 cursor-pointer truncate text-left hover:text-brand-ink">
                        <RarityTag r={sup?.cards[s.id]?.rarity} /> {supName(s.id)}
                      </button>
                      <span className="relative block h-[6px] overflow-hidden rounded-full bg-surface-3">
                        <i className="absolute inset-y-0 left-0 rounded-full bg-da/45" style={{ width: `${100 * (s.stat?.share ?? 0)}%` }} />
                        <i className="absolute inset-y-0 left-0 rounded-full bg-da" style={{ width: `${100 * (s.stat?.share_full ?? 0)}%` }} />
                      </span>
                      <span className="num w-10 text-right font-semibold">{pct(s.stat?.share ?? 0)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {pitems.length > 0 && (
              <>
                <p className="mt-3 mb-1.5 text-[12px] text-ink-3">回忆带进考试的 P 道具</p>
                <div className="flex flex-wrap gap-2">
                  {pitems.map((it) => (
                    <ItemIcon key={it.id} id={it.id} onOpen={open.item}><span className="num text-[11.5px] font-semibold">{pct(it.stat?.share ?? 0)}</span></ItemIcon>
                  ))}
                </div>
              </>
            )}
          </Panel>
        )}

        {targets && (
          <Panel title="三维" sub="排行榜终局三维">
            <div className="space-y-2.5">
              {(() => {
                const cap = 1.06 * Math.max(...(['vo', 'da', 'vi'] as const).map((a) => targets[a]?.p75 ?? 0))
                return (['vo', 'da', 'vi'] as const).map((a) => {
                  const q = targets[a]
                  if (!q) return null
                  return (
                    <div key={a} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3">
                      <span className={cx('text-[13px] font-semibold', a === attrKey ? 'text-ink' : 'text-ink-2')}>{ATTR[a].label}</span>
                      <span className="relative h-2.5 rounded-full bg-surface-3">
                        <i className={cx('absolute top-0 h-full rounded-full opacity-40', ATTR[a].tone)} style={{ left: `${(100 * q.p25) / cap}%`, width: `${(100 * (q.p75 - q.p25)) / cap}%` }} />
                        <i className={cx('absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface', ATTR[a].tone)} style={{ left: `${(100 * q.p50) / cap}%` }} />
                      </span>
                      <span className="num text-[14px] font-semibold">{q.p50.toLocaleString()} <span className="text-[11.5px] font-normal text-ink-3">{q.p25.toLocaleString()}–{q.p75.toLocaleString()}</span></span>
                    </div>
                  )
                })
              })()}
            </div>
            <p className="mt-2 text-[12px] text-ink-3">
              色带：中间一半的人（25%–75%）· 圆点：中位数 · 合计 <b className="num text-ink">{(['vo', 'da', 'vi'] as const).reduce((s, a) => s + (targets[a]?.p50 ?? 0), 0).toLocaleString()}</b>
            </p>
            {summary && (
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                {[['10% 分位', summary.score_p10], ['分数中位数', summary.score_p50], ['最高', summary.score_max]].map(([k, v]) => (
                  <div key={k as string}><p className="text-[11.5px] text-ink-3">{k}</p><p className="num text-[16px] font-semibold text-ink">{Math.round(v as number).toLocaleString()}</p></div>
                ))}
              </div>
            )}
          </Panel>
        )}
      </div>
      {fetched && <p className="text-[12px] text-ink-3">看板数据：{modeLabel} 排行榜，{fetched} 抓取。下面是每个决策点的完整统计和人写攻略。</p>}
    </div>
  )
}
