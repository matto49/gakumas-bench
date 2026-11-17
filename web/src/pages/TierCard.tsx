import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { spriteUrl, useCatalog } from '../lib/catalog'
import { DIM_HELP, DIM_LABEL, supportThumbUrl, wan, type Battle, type Pair, type TierBoard, type TierCard } from '../lib/tiers'
import { cx, ErrorState, Help, IdolThumb, Skeleton, Tip } from '../components/ui'
import { CardDetail, CardImage, Meta, RarityTag } from '../components/CardDetail'
import { ItemDetail } from '../components/ItemDetail'
import { Bi, SourceLine, TierBadge, TierMissing, useTierBoard, useTierNames } from './Tiers'

/** 强度榜的单卡页：一张偶像卡在这张榜里的六维、推荐牌组、常用搭配、分数分布和实际成绩。版式参考原视频的单卡页 */

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

function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11.5px] text-ink-3">{label}</p>
      <p className="num text-[17px] font-semibold text-ink">{value}{sub && <span className="ml-1 text-[12px] font-normal text-ink-3">{sub}</span>}</p>
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

/** 六边形雷达：每维 0–100 */
function Radar({ c, board }: { c: TierCard; board: TierBoard }) {
  const W = 300, H = 284, cx0 = W / 2, cy0 = H / 2, R = 88
  const n = board.dims.length
  const pt = (i: number, f: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n
    return [cx0 + R * f * Math.cos(a), cy0 + R * f * Math.sin(a)] as const
  }
  const ring = (f: number) => board.dims.map((_, i) => pt(i, f).join(',')).join(' ')
  const shape = board.dims.map((d, i) => pt(i, c.score[d] / 100).join(',')).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-[320px]" role="img" aria-label="六维雷达图">
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={ring(f)} fill="none" stroke="var(--color-line-strong)" strokeWidth={f === 1 ? 1.2 : 0.8} />)}
      {board.dims.map((_, i) => { const [x, y] = pt(i, 1); return <line key={i} x1={cx0} y1={cy0} x2={x} y2={y} stroke="var(--color-line)" /> })}
      <polygon points={shape} fill="color-mix(in oklch, var(--color-da) 22%, transparent)" stroke="var(--color-da-strong)" strokeWidth={2} strokeLinejoin="round" />
      {board.dims.map((d, i) => { const [x, y] = pt(i, c.score[d] / 100); return <circle key={d} cx={x} cy={y} r={3.5} fill="var(--color-surface)" stroke="var(--color-da-strong)" strokeWidth={2} /> })}
      {board.dims.map((d, i) => {
        const [x, y] = pt(i, 1.28)
        return (
          <text key={d} x={x} y={y} textAnchor="middle" className="fill-ink-2 text-[11px]">
            <tspan x={x} dy="-0.2em">{DIM_LABEL[d]}</tspan>
            <tspan x={x} dy="1.25em" className="fill-ink text-[13px] font-semibold">{c.score[d].toFixed(1)}</tspan>
          </text>
        )
      })}
    </svg>
  )
}

/** 前战 / 后战分布：最优饮料（深）和自带饮料（浅）两组柱子叠在一起 */
function Hist({ b }: { b: Battle }) {
  if (!b.hist) return null
  const { edges, best, own } = b.hist
  const top = Math.max(...best, ...own, 1)
  const W = 400, H = 110, n = best.length, bw = W / n
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label={`${b.label}分布`}>
        {own.map((v, i) => <rect key={`o${i}`} x={i * bw + 1} y={H - (H * v) / top} width={bw - 2} height={(H * v) / top} rx={2} fill="var(--color-line-strong)" />)}
        {best.map((v, i) => <rect key={`b${i}`} x={i * bw + bw * 0.25} y={H - (H * v) / top} width={bw * 0.5} height={(H * v) / top} rx={2} fill="var(--color-da)" opacity={0.85} />)}
        <line x1={0} x2={W} y1={H} y2={H} stroke="var(--color-line-strong)" />
        {[0, Math.floor(n / 2), n].map((i) => (
          <text key={i} x={Math.min(W - 2, Math.max(2, i * bw))} y={H + 14} textAnchor={i === 0 ? 'start' : i === n ? 'end' : 'middle'} className="fill-ink-3 text-[10.5px]">{wan(edges[Math.min(i, edges.length - 1)])}</text>
        ))}
      </svg>
      <div className="mt-1 flex gap-4 text-[11.5px] text-ink-3">
        <span className="inline-flex items-center gap-1"><i className="size-2.5 rounded-sm bg-da" />最优饮料</span>
        <span className="inline-flex items-center gap-1"><i className="size-2.5 rounded-sm bg-line-strong" />自带饮料</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Stat label="中位" value={wan(b.best.p50)} sub={`对 ${wan(b.own.p50)}`} />
        <Stat label="P10" value={wan(b.best.p10)} sub={`对 ${wan(b.own.p10)}`} />
        <Stat label="P90" value={wan(b.best.p90)} sub={`对 ${wan(b.own.p90)}`} />
        {b.gain != null && <Stat label="最优饮料增益" value={`+${(b.gain * 100).toFixed(1)}%`} />}
        {b.play && <Stat label={<Tip tip="思考量降到约十二分之一的快速搜索，保留了多少分"><span tabIndex={0}>快搜保留</span></Tip>} value={`${(b.play.keeps * 100).toFixed(1)}%`} />}
        {b.templates != null && <Stat label="模板" value={`${b.templates} 个`} />}
      </div>
    </div>
  )
}

/** 逐份记录：每份收集记录一行，实录、原牌组模拟、最优模拟三个点 */
function Dumbbells({ c }: { c: TierCard }) {
  const recs = [...c.records].sort((a, b) => a.recorded - b.recorded)
  if (!recs.length) return null
  const xs = recs.flatMap((r) => [r.best, r.own, r.recorded])
  const lo = Math.min(...xs), hi = Math.max(...xs)
  const W = 400, H = 120, x = (v: number) => 4 + ((W - 8) * (v - lo)) / (hi - lo)
  const y = (i: number) => 4 + ((H - 8) * i) / Math.max(1, recs.length - 1)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full max-w-[460px]" role="img" aria-label="逐份记录">
        {recs.map((r, i) => (
          <g key={i}>
            <line x1={x(Math.min(r.recorded, r.own, r.best))} x2={x(Math.max(r.recorded, r.own, r.best))} y1={y(i)} y2={y(i)} stroke="var(--color-line)" />
            <circle cx={x(r.own)} cy={y(i)} r={2} fill="var(--color-line-strong)" />
            <circle cx={x(r.best)} cy={y(i)} r={2} fill="var(--color-da)" />
            <circle cx={x(r.recorded)} cy={y(i)} r={2} fill="var(--color-ink)" />
          </g>
        ))}
        <text x={2} y={H + 13} className="fill-ink-3 text-[10.5px]">{wan(lo)}</text>
        <text x={W - 2} y={H + 13} textAnchor="end" className="fill-ink-3 text-[10.5px]">{wan(hi)}</text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-[11.5px] text-ink-3">
        <span className="inline-flex items-center gap-1"><i className="size-2.5 rounded-full bg-ink" />实录</span>
        <span className="inline-flex items-center gap-1"><i className="size-2.5 rounded-full bg-line-strong" />原牌组模拟</span>
        <span className="inline-flex items-center gap-1"><i className="size-2.5 rounded-full bg-da" />最优牌组模拟</span>
      </div>
    </div>
  )
}

function CardChip({ id, name, customized, onOpen, size = 44, children }: { id: string; name: Pair; customized: boolean; onOpen: (id: string) => void; size?: number; children?: ReactNode }) {
  const cat = useCatalog()
  const c = cat?.cards[id]
  return (
    <Tip tip={<>{name.main}{customized ? '（改造）' : ''}{name.sub && <><br /><span className="opacity-75">{name.sub}</span></>}</>}>
      <button type="button" onClick={() => onOpen(id)} className="relative flex cursor-pointer flex-col items-center gap-0.5 rounded-lg p-0.5 hover:bg-surface-2">
        {c ? <CardImage c={c} size={size} /> : <span className="rounded-lg bg-surface-3" style={{ width: size, height: size }} />}
        {customized && <span className="absolute top-0 right-0 rounded-[3px] bg-brand-deep px-0.5 text-[9.5px] leading-tight font-bold text-white">改</span>}
        {children}
      </button>
    </Tip>
  )
}

function Thing({ asset, size = 36 }: { asset?: string; size?: number }) {
  return (
    <span className="shrink-0 overflow-hidden rounded-md bg-surface-2 ring-1 ring-line" style={{ width: size, height: size }}>
      {asset && <img src={spriteUrl(asset)} alt="" width={size} height={size} loading="lazy" className="size-full object-contain" />}
    </span>
  )
}

export function TierCardPage() {
  const { board: boardId, card: cardId } = useParams()
  const { data: board, error, reload } = useTierBoard(boardId)
  const cat = useCatalog()
  const names = useTierNames(board)
  const [open, setOpen] = useState<string | null>(null)
  const [item, setItem] = useState<string | null>(null)
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!board) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
  const c = board.cards.find((x) => x.id === cardId)
  if (!c) return <TierMissing />
  const l = names.idol(c)
  const idol = cat?.idols[c.id]
  const u = c.usage
  const parts = board.dims.map((d) => ({ d, got: board.weights[d] * c.score[d], full: board.weights[d] * 100 }))
  const deck = [...c.deck.rows].filter((r) => r.in_best >= 0.005).sort((a, b) => b.in_best - a.in_best || b.w - a.w)
  const must = deck.filter((r) => r.in_best === 1).length
  const vb = c.deck.measured.vbest, lc = c.deck.measured.local
  const weights = [...c.deck.rows].sort((a, b) => b.w - a.w).slice(0, 6)
  const topW = Math.max(...c.deck.rows.map((r) => r.w), 0.01)
  const worst = c.key_cards.bottom.slice(-3).reverse()
  const drinks = c.battles.final.best_drinks ?? []
  const total = c.battles.total
  const pot = c.real.potential ?? {}
  const potSum = Object.values(pot).reduce((a, b) => a + b, 0)
  const idx = board.cards.indexOf(c)
  const prev = board.cards[idx - 1], next = board.cards[idx + 1]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <Link to={`/tiers/${board.id}`} className="inline-flex items-center gap-1 text-brand-ink hover:underline"><ChevronLeft className="size-4" />{board.title}</Link>
        <span className="flex gap-3 text-ink-3">
          {prev && <Link to={`/tiers/${board.id}/${prev.id}`} className="hover:text-brand-ink">← 第 {prev.rank} 名</Link>}
          {next && <Link to={`/tiers/${board.id}/${next.id}`} className="hover:text-brand-ink">第 {next.rank} 名 →</Link>}
        </span>
      </div>

      {/* 头：卡、档位、总分和构成 */}
      <section className="grid gap-4 rounded-xl border border-line bg-surface p-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex items-center gap-4">
          <IdolThumb id={c.id} size={88} title={false} />
          <div className="min-w-0">
            <p className="text-[13px] text-ink-3">{l.character}</p>
            <h1 className="text-[24px] leading-tight font-bold text-ink">{l.name}</h1>
            {l.nameSub && <p className="text-[13px] text-ink-3">{l.nameSub}</p>}
            <p className="mt-1.5 flex flex-wrap gap-1"><RarityTag r={c.rarity} /><Meta>{names.plan(c)}</Meta><Meta>{names.style(c)}</Meta>{c.low_confidence && <Meta>数据偏少</Meta>}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <TierBadge t={c.tier} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] text-ink-3">
              六维总分 · 第 {c.rank} 名 · 名次区间 {c.rank_interval[0]}–{c.rank_interval[1]}
              <Help tip="对编成重采样 1,000 次，取 90% 区间" />
            </p>
            <p className="flex items-baseline gap-2"><span className="disp text-[48px] leading-none text-ink">{c.total.toFixed(1)}</span><span className="text-[12.5px] text-ink-3">满分 100 · 失分 {(100 - c.total).toFixed(1)}</span></p>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-surface-3">
              {parts.map((p, i) => <i key={p.d} className={i % 2 ? 'bg-da/70' : 'bg-da'} style={{ width: `${p.got}%` }} title={`${DIM_LABEL[p.d]} ${p.got.toFixed(1)} / ${p.full}`} />)}
            </div>
            <p className="mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-ink-3">
              {parts.map((p) => <span key={p.d}>{DIM_LABEL[p.d]} <b className="num text-ink">{p.got.toFixed(1)}</b>/{p.full}</span>)}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="六维" sub="本小类最高 = 100">
          <Radar c={c} board={board} />
        </Panel>
        <Panel title="六维明细" sub="原始值 → 分数" className="lg:col-span-2">
          <table className="w-full text-[13px]">
            <thead className="text-[11.5px] text-ink-3"><tr><th className="pb-1 text-left font-normal">维度</th><th className="pb-1 text-right font-normal">原始值</th><th className="w-[38%] pb-1" /><th className="pb-1 text-right font-normal">分数</th><th className="pb-1 text-right font-normal">失分</th></tr></thead>
            <tbody>
              {board.dims.map((d) => {
                const lost = board.weights[d] * (100 - c.score[d])
                const raw = c.raw[d]
                return (
                  <tr key={d} className="border-t border-line">
                    <td className="py-1.5"><Tip tip={<>{DIM_HELP[d][0]}<br />{DIM_HELP[d][1]}</>}><span tabIndex={0} className="font-semibold text-ink">{DIM_LABEL[d]}</span></Tip> <span className="num text-[11px] text-ink-3">×{board.weights[d].toFixed(2)}</span></td>
                    <td className="num py-1.5 text-right text-ink-2">{raw > 100 ? Math.round(raw).toLocaleString() : raw.toFixed(3)}</td>
                    <td className="px-3 py-1.5"><Bar v={c.score[d]} max={100} /></td>
                    <td className="num py-1.5 text-right font-semibold">{c.score[d].toFixed(1)}</td>
                    <td className="num py-1.5 text-right text-ink-3">{lost < 0.05 ? '—' : `−${lost.toFixed(1)}`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="推荐牌组" sub="各卡入选率 · 改 = 改造" help="V 模型给出的最优牌组：每张卡在最优牌组里出现的比例。点卡看效果">
          <div className="flex flex-wrap gap-1">
            {deck.map((r) => (
              <CardChip key={r.id + r.upgrade + r.customized} id={r.id} name={names.card(r.id, r.upgrade)} customized={r.customized} onOpen={setOpen}>
                <span className={cx('num text-[11px]', r.in_best === 1 ? 'font-semibold text-ink' : 'text-ink-3')}>{Math.round(r.in_best * 100)}%</span>
              </CardChip>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-ink-2">
            必带 <b className="num text-ink">{must}</b> 张 · 入选卡中改造 <b className="num text-ink">{deck.filter((r) => r.customized).length}</b> 张 · 对原牌组 <b className="num text-ink">{(vb.mean * 100 >= 0 ? '+' : '') + (vb.mean * 100).toFixed(1)}%</b>
          </p>
          <p className="num mt-0.5 text-[12px] text-ink-3">95% 区间 {(vb.ci95[0] * 100).toFixed(1)}% ~ {(vb.ci95[1] * 100).toFixed(1)}% · 局部搜索 {(lc.mean * 100 >= 0 ? '+' : '') + (lc.mean * 100).toFixed(1)}% · 各 {vb.pairs} 对 · 采用：{c.deck.arm_label}</p>
          {drinks.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="mb-1.5 text-[12px] text-ink-3">最优饮料（{JSON.stringify(c.battles.mid1.best_drinks) === JSON.stringify(drinks) ? '前战、后战相同' : '后战'}）</p>
              <div className="flex flex-wrap gap-3">
                {[...new Set(drinks)].map((d) => (
                  <span key={d} className="inline-flex items-center gap-1.5 text-[13px]"><Thing asset={cat?.drinks[d]?.asset} size={30} /><Bi p={names.drink(d)} subClass="text-[11.5px]" /> ×{drinks.filter((x) => x === d).length}</span>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="技能卡权重" sub={`V 模型 · 词表 ${c.model.vocabulary} 种卡`} help="权重：这张卡在牌组里时，本戦总分的相对变化。采用：收集记录里带这张卡的比例">
          <p className="mb-1 text-[12px] text-ink-3">最该带的 6 张</p>
          <div className="space-y-1">
            {weights.map((r) => (
              <div key={r.id + r.upgrade + r.customized} className="grid grid-cols-[auto_1fr_38%_auto_auto] items-center gap-2 text-[13px]">
                <CardChip id={r.id} name={names.card(r.id, r.upgrade)} customized={r.customized} onOpen={setOpen} size={28} />
                <Bi p={names.card(r.id, r.upgrade)} className="min-w-0 truncate" subClass="text-[11.5px]" />
                <Bar v={r.w} max={topW} />
                <span className="num w-12 text-right font-semibold">{r.w >= 0 ? '+' : ''}{r.w.toFixed(2)}</span>
                <span className="num w-10 text-right text-ink-3">{Math.round(r.adoption * 100)}%</span>
              </div>
            ))}
          </div>
          <p className="mt-3 mb-1 text-[12px] text-ink-3">最拖分的 3 张</p>
          <div className="space-y-1">
            {worst.map((k) => (
              <div key={k.name + k.customized} className="grid grid-cols-[auto_1fr_38%_auto_auto] items-center gap-2 text-[13px]">
                {k.id ? <CardChip id={k.id} name={names.card(k.id, k.name.endsWith('+') ? 1 : 0)} customized={k.customized} onOpen={setOpen} size={28} /> : <span className="size-8" />}
                <Bi p={k.id ? names.card(k.id, k.name.endsWith('+') ? 1 : 0) : { main: k.name }} className="min-w-0 truncate" subClass="text-[11.5px]" />
                <Bar v={Math.abs(k.w)} max={topW} tone="bg-line-strong" />
                <span className="num w-12 text-right font-semibold text-ink-2">{k.w.toFixed(2)}</span>
                <span className="w-10" />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {u && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="常用搭配" sub={`${u.n} 份收集记录里带的比例`}>
            <p className="mb-1.5 text-[12px] text-ink-3">支援卡</p>
            <div className="space-y-1.5">
              {u.supports.map((s) => {
                const sc = board.supports[s.id]
                return (
                  <div key={s.id} className="grid grid-cols-[auto_1fr_30%_auto] items-center gap-2 text-[13px]">
                    <img src={supportThumbUrl(s.id)} alt="" width={30} height={30} loading="lazy" className="size-[30px] rounded-md bg-surface-2 object-cover ring-1 ring-line" />
                    <Link to={`/cards?tab=supports&support=${s.id}`} className="min-w-0 truncate hover:text-brand-ink"><RarityTag r={sc?.rarity} /> <Bi p={names.support(s.id)} subClass="text-[11.5px]" /></Link>
                    <Bar v={s.share} />
                    <span className="num w-10 text-right font-semibold">{Math.round(s.share * 100)}%</span>
                  </div>
                )
              })}
            </div>
            <p className="mt-3 mb-1.5 text-[12px] text-ink-3">P 道具（不含 H.I.F 固定道具）</p>
            <div className="flex flex-wrap gap-3">
              {u.items.map((it) => (
                <Tip key={it.id} tip={<><b>{names.item(it.id).main}</b>{names.item(it.id).sub && <span className="opacity-75">　{names.item(it.id).sub}</span>}{cat?.items[it.id]?.text && <><br /><span className="whitespace-pre-line">{cat.items[it.id].text}</span></>}</>} wide>
                  <button type="button" onClick={() => setItem(it.id)} className="flex cursor-pointer flex-col items-center gap-0.5 rounded-md hover:bg-surface-2"><Thing asset={cat?.items[it.id]?.asset} size={40} /><span className="num text-[11.5px] font-semibold">{Math.round(it.share * 100)}%</span></button>
                </Tip>
              ))}
            </div>
            <p className="mt-3 text-[12.5px] text-ink-2">
              {u.deck_size && <>牌组多为 {u.deck_size[0]}–{u.deck_size[1]} 张；</>}
              {u.support_limit != null && <>支援卡突破多为 {u.support_limit} 档。</>}
            </p>
          </Panel>

          <Panel title="平均三维" sub={`${u.n} 份收集记录的最终参数`}>
            <div className="space-y-2.5">
              {(['vocal', 'dance', 'visual'] as const).map((k, i) => {
                const p = u.params[k], cap = 1.04 * Math.max(u.params.vocal.max, u.params.dance.max, u.params.visual.max)
                const tone = ['bg-vo', 'bg-da', 'bg-vi'][i]
                return (
                  <div key={k} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3">
                    <span className="text-[13px] font-semibold text-ink-2">{['Vo', 'Da', 'Vi'][i]}</span>
                    <span className="relative h-2.5 rounded-full bg-surface-3">
                      <i className={cx('absolute top-0 h-full rounded-full opacity-40', tone)} style={{ left: `${(100 * p.min) / cap}%`, width: `${(100 * (p.max - p.min)) / cap}%` }} />
                      <i className={cx('absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface', tone)} style={{ left: `${(100 * p.mean) / cap}%` }} />
                    </span>
                    <span className="num text-[14px] font-semibold">{Math.round(p.mean).toLocaleString()} <span className="text-[11.5px] font-normal text-ink-3">成长率 +{u.growth[k].toFixed(1)}%</span></span>
                  </div>
                )
              })}
            </div>
            <p className="mt-2 text-[12px] text-ink-3">
              色带：最低到最高 · 圆点：平均 · 合计 <b className="num text-ink">{Math.round(u.params.vocal.mean + u.params.dance.mean + u.params.visual.mean).toLocaleString()}</b> · 体力 <b className="num text-ink">{u.stamina}</b>
            </p>
            {idol && (
              <div className="mt-4 grid gap-2 border-t border-line pt-3 sm:grid-cols-2">
                {idol.card && cat?.cards[idol.card] && (
                  <button type="button" onClick={() => setOpen(idol.card!)} className="flex cursor-pointer items-center gap-2 rounded-lg text-left hover:bg-surface-2">
                    <CardImage c={cat.cards[idol.card]} size={36} />
                    <span className="min-w-0"><span className="block text-[11px] text-ink-3">专属技能卡</span><Bi p={names.card(idol.card)} inline={false} className="block truncate text-[13px]" subClass="text-[11.5px] truncate" /></span>
                  </button>
                )}
                {idol.item && (
                  <button type="button" onClick={() => setItem(idol.item!)} className="flex cursor-pointer items-center gap-2 rounded-lg text-left hover:bg-surface-2">
                    <Thing asset={cat?.items[idol.item]?.asset} size={36} />
                    <span className="min-w-0"><span className="block text-[11px] text-ink-3">专属 P 道具</span><Bi p={names.item(idol.item)} inline={false} className="block truncate text-[13px]" subClass="text-[11.5px] truncate" /></span>
                  </button>
                )}
              </div>
            )}
          </Panel>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="本戦总分" sub="推荐牌组 · 本戦 = 前战 × 1.2 + 后战">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="最优饮料 均值" value={wan(total.best.mean)} />
            <Stat label="自带饮料 均值" value={wan(total.own.mean)} />
            <Stat label="最优 P10 / P90" value={wan(total.best.p10)} sub={`/ ${wan(total.best.p90)}`} />
            <Stat label="自带 P10 / P90" value={wan(total.own.p10)} sub={`/ ${wan(total.own.p90)}`} />
            <Stat label="最优对自带" value={`+${(100 * (total.best.mean / total.own.mean - 1)).toFixed(1)}%`} />
            {total.play && <Stat label="快搜均值" value={wan(total.play.mean)} />}
          </div>
        </Panel>
        <Panel title="前战分布"><Hist b={c.battles.mid1} /></Panel>
        <Panel title="后战分布"><Hist b={c.battles.final} /></Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="实际成绩" sub="收集的对局数据里的真实成绩">
          <div className="grid grid-cols-3 gap-3">
            {c.real.score_first != null && <Stat label="评价值 第 1 名" value={c.real.score_first.toLocaleString()} />}
            {c.real.score_median != null && <Stat label="评价值 中位" value={Math.round(c.real.score_median).toLocaleString()} />}
            <Stat label={<Tip tip="实录本戦总分的中位 ÷ 模拟实战"><span tabIndex={0}>实录 ÷ 模拟实战</span></Tip>} value={`${((100 * c.real.median) / c.raw.practice).toFixed(1)}%`} />
            <Stat label="本戦总分 中位" value={Math.floor(c.real.median).toLocaleString()} />
            <Stat label="本戦总分 最高" value={c.real.max.toLocaleString()} />
            <Stat label={<Tip tip="玩家实际打出的分数 ÷ 同一局用模拟打法打出的分数"><span tabIndex={0}>人打 ÷ 同局模拟</span></Tip>} value={`${(c.sim.human * 100).toFixed(1)}%`} />
          </div>
          {potSum > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-[12px] text-ink-3">潜力分布（{potSum} 份记录）</p>
              <div className="flex h-3 overflow-hidden rounded-full">
                {(['None', '1', '2', '3', '4'] as const).filter((k) => pot[k]).map((k, i) => (
                  <i key={k} style={{ flex: pot[k] }} className={['bg-surface-3', 'bg-da/40', 'bg-da/60', 'bg-da/80', 'bg-da'][k === 'None' ? 0 : Number(k)] + (i ? ' border-l-2 border-surface' : '')} />
                ))}
              </div>
              <div className="mt-1 flex text-[11.5px] text-ink-3">
                {(['None', '1', '2', '3', '4'] as const).filter((k) => pot[k]).map((k) => (
                  <span key={k} style={{ flex: pot[k] }} className="truncate">{pot[k] / potSum >= 0.06 ? `${k === 'None' ? '无' : k + ' 档'} ${pot[k]}` : ''}</span>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4"><p className="mb-1 text-[12px] text-ink-3">逐份记录（按实录成绩排序）</p><Dumbbells c={c} /></div>
        </Panel>
        <Panel title="数据规模" sub="这张卡的评估用了多少数据">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="收集记录" value={`${c.counts.records} 份`} />
            <Stat label="模板" value={`${c.counts.templates} 个`} />
            <Stat label="模拟局数" value={c.counts.games.toLocaleString()} />
            <Stat label="训练局数" value={c.model.train_games.toLocaleString()} />
            <Stat label={c.low_confidence ? 'V 相关（偏低）' : 'V 留出相关'} value={c.model.held_spearman.toFixed(3)} />
            <Stat label="交叉验证 R²" value={c.model.r2_cv.toFixed(3)} />
          </div>
          <div className="mt-4 border-t border-line pt-3"><SourceLine board={board} /></div>
        </Panel>
      </div>

      {open && cat?.cards[open] && <CardDetail id={open} c={cat.cards[open]} onClose={() => setOpen(null)} />}
      {item && cat && <ItemDetail id={item} cat={cat} onClose={() => setItem(null)} />}
    </div>
  )
}
