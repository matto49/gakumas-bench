import { useMemo, useState } from 'react'
import { ArrowDownUp } from 'lucide-react'
import { cardName, spriteUrl, useCatalog } from '../../lib/catalog'
import { compact, int } from '../../lib/format'
import { splitCardId, type SimResult } from '../../lib/contest'
import { niceTicks, useWidth } from '../Charts'
import { AttrChip, cx, SectionTitle } from '../ui'

/* 结果（dataviz 规范）：单一序列不放图例；线 2px、柱端 4px 圆角、网格 1px 弱化；每根柱、每个回合都有悬停提示；
   文字用正文色，Vo / Da / Vi 用站上的属性色并写字。 */

/** 刻度：最高一格一定不低于数据最大值（niceTicks 可能停在最大值下面） */
function ticksCover(max: number, n: number) {
  const t = niceTicks(max, n)
  const step = t.length > 1 ? t[1] - t[0] : max || 1
  while (t[t.length - 1] < max) t.push(t[t.length - 1] + step)
  return t
}

export function Result({ r, runs }: { r: SimResult; runs: number }) {
  return (
    <section className="mt-6 space-y-6">
      <Stats r={r} runs={runs} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <SectionTitle>分数分布</SectionTitle>
          <Histogram scores={r.scores} median={r.stats.median} />
        </div>
        <div className="min-w-0">
          <SectionTitle>每回合结束时的分数</SectionTitle>
          <TurnCurve turns={r.turns} />
        </div>
      </div>
      <ByParam r={r} />
      <CardTable r={r} />
      <Logs r={r} />
    </section>
  )
}

function Stats({ r, runs }: { r: SimResult; runs: number }) {
  const s = r.stats
  const cells: [string, number][] = [['平均', s.mean], ['中位数', s.median], ['P10', s.p10], ['P90', s.p90], ['最低', s.min], ['最高', s.max], ['标准差', s.sd]]
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-7">
        {cells.map(([k, v], i) => (
          <div key={k} className="flex flex-col-reverse">
            <dt className="text-[12px] text-ink-3">{k}</dt>
            <dd className={cx('num leading-none text-ink', i < 2 ? 'disp text-[28px]' : 'text-[18px] font-semibold')}>{int(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[12px] text-ink-3">
        {int(s.n)} 局{runs !== s.n ? `（要了 ${runs} 局）` : ''}{r.errors ? `，${r.errors} 局没打完` : ''} · 加载 {r.timing.load}s，对局 {r.timing.games}s
        {' · '}实际上场参数 Vo {int(r.player.params[0])} / Da {int(r.player.params[1])} / Vi {int(r.player.params[2])}，体力 {r.player.max_stamina}
      </p>
    </div>
  )
}

/** 分数直方图：约 24 桶，中位数一条竖线 */
function Histogram({ scores, median }: { scores: number[]; median: number }) {
  const [box, W] = useWidth<HTMLDivElement>(560)
  const [hover, setHover] = useState<number | null>(null)
  const H = 212, pad = { l: 40, r: 8, t: 22, b: 28 }
  const bins = useMemo(() => {
    if (!scores.length) return []
    const lo = Math.min(...scores), hi = Math.max(...scores)
    const n = Math.min(24, Math.max(6, Math.ceil(Math.sqrt(scores.length))))
    const w = Math.max(1, (hi - lo) / n)
    const out = Array.from({ length: n }, (_, i) => ({ from: lo + i * w, to: lo + (i + 1) * w, c: 0 }))
    for (const s of scores) out[Math.min(n - 1, Math.floor((s - lo) / w))].c++
    return out
  }, [scores])
  if (!bins.length) return null
  const lo = bins[0].from, hi = bins[bins.length - 1].to
  const cmax = Math.max(...bins.map((b) => b.c))
  const ticks = ticksCover(cmax, 3)
  const top = ticks[ticks.length - 1] || cmax
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b
  const bw = iw / bins.length
  const x = (v: number) => pad.l + ((v - lo) / (hi - lo || 1)) * iw
  const y = (c: number) => pad.t + ih - (c / top) * ih
  const h = hover != null ? bins[hover] : null
  return (
    <div ref={box} className="relative w-full min-w-0 overflow-hidden rounded-2xl border border-line bg-surface p-2">
      <svg width={W} height={H} role="img" aria-label={`分数分布，${scores.length} 局，中位数 ${int(median)}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-ink-3 text-[11px]">{t}</text>
          </g>
        ))}
        {bins.map((b, i) => {
          const bh = Math.max(0, pad.t + ih - y(b.c))
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={ih} fill="transparent" />
              {b.c > 0 && (
                <path d={roundTop(pad.l + i * bw + 1, y(b.c), Math.max(1, bw - 2), bh, Math.min(4, (bw - 2) / 2))}
                  fill={hover === i ? 'var(--color-brand-deep)' : 'var(--color-brand)'} />
              )}
            </g>
          )
        })}
        <line x1={x(median)} x2={x(median)} y1={pad.t} y2={pad.t + ih} stroke="var(--color-ink)" strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={x(median)} y={pad.t - 8} textAnchor="middle" className="fill-ink-2 text-[11px]">中位 {compact(median)}</text>
        {[lo, (lo + hi) / 2, hi].map((v, i) => (
          <text key={i} x={x(v)} y={H - 8} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} className="num fill-ink-3 text-[11px]">{compact(v)}</text>
        ))}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-2 right-3 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] shadow-sm">
          <span className="num">{int(h.from)}–{int(h.to)}</span> 分：<b className="num">{h.c}</b> 局（{((h.c / scores.length) * 100).toFixed(1)}%）
        </div>
      )}
    </div>
  )
}

function roundTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= r) return `M${x},${y + h}V${y}H${x + w}V${y + h}Z`
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

/** 每回合结束时的分数：均值线 + P10–P90 区间带，悬停看这一回合的三个数 */
function TurnCurve({ turns }: { turns: SimResult['turns'] }) {
  const [box, W] = useWidth<HTMLDivElement>(560)
  const [hover, setHover] = useState<number | null>(null)
  const H = 200, pad = { l: 52, r: 12, t: 10, b: 28 }
  if (!turns.length) return null
  const ymax = Math.max(1, ...turns.map((t) => t.p90))
  const ticks = ticksCover(ymax, 4)
  const top = ticks[ticks.length - 1] || ymax
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b
  const n = turns.length
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
  const y = (v: number) => pad.t + ih - (v / top) * ih
  const band = turns.map((t, i) => `${x(i)},${y(t.p90)}`).join(' ') + ' ' + turns.map((t, i) => `${x(i)},${y(t.p10)}`).reverse().join(' ')
  const line = turns.map((t, i) => `${i ? 'L' : 'M'}${x(i)},${y(t.mean)}`).join('')
  const h = hover != null ? turns[hover] : null
  return (
    <div ref={box} className="relative w-full min-w-0 overflow-hidden rounded-2xl border border-line bg-surface p-2">
      <svg width={W} height={H} role="img" aria-label={`每回合结束时的平均分，最后一回合 ${int(turns[n - 1].mean)}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rx = e.clientX - e.currentTarget.getBoundingClientRect().left
          setHover(Math.max(0, Math.min(n - 1, Math.round(((rx - pad.l) / iw) * (n - 1)))))
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="num fill-ink-3 text-[11px]">{compact(t)}</text>
          </g>
        ))}
        <polygon points={band} fill="var(--color-brand)" opacity={0.18} />
        <path d={line} fill="none" stroke="var(--color-brand-deep)" strokeWidth={2} />
        {turns.map((t, i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="num fill-ink-3 text-[11px]">{t.turn}</text>
        ))}
        {h && hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--color-line-strong)" />
            <circle cx={x(hover)} cy={y(h.mean)} r={4.5} fill="var(--color-brand-deep)" stroke="var(--color-surface)" strokeWidth={2} />
          </g>
        )}
      </svg>
      <p className="px-1 text-[11.5px] text-ink-3">线是平均，浅色带是 P10–P90；横轴是回合</p>
      {h && (
        <div className="pointer-events-none absolute top-2 right-3 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] shadow-sm">
          第 {h.turn} 回合：平均 <b className="num">{int(h.mean)}</b> · P10 <span className="num">{int(h.p10)}</span> · P90 <span className="num">{int(h.p90)}</span>
        </div>
      )}
    </div>
  )
}

/** Vo / Da / Vi 回合各拿了多少分（平均） */
function ByParam({ r }: { r: SimResult }) {
  const rows: [number, string, number][] = [[1, 'Vo', r.by_param.vocal], [2, 'Da', r.by_param.dance], [3, 'Vi', r.by_param.visual]]
  const max = Math.max(1, ...rows.map((x) => x[2]))
  return (
    <div>
      <SectionTitle>各属性回合的平均得分</SectionTitle>
      <div className="space-y-2 rounded-2xl border border-line bg-surface p-4">
        {rows.map(([t, k, v]) => (
          <div key={k} className="flex items-center gap-3">
            <AttrChip t={t} />
            <span className="h-3 flex-1 overflow-hidden rounded-full bg-surface-2">
              <span className={cx('block h-full rounded-full', t === 1 ? 'bg-vo' : t === 2 ? 'bg-da' : 'bg-vi')} style={{ width: `${(v / max) * 100}%` }} title={`${k} ${int(v)}`} />
            </span>
            <span className="num w-[5em] text-right font-semibold">{int(v)}</span>
            <span className="sr-only">{k}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 卡牌统计：每局平均打出次数、打出过的局占比，可排序 */
function CardTable({ r }: { r: SimResult }) {
  const cat = useCatalog()
  const [key, setKey] = useState<'per_game' | 'share'>('per_game')
  const rows = useMemo(() => [...r.cards].sort((a, b) => b[key] - a[key]), [r.cards, key])
  const head = (k: 'per_game' | 'share', label: string) => (
    <th className="px-3 py-2 text-right font-semibold">
      <button type="button" onClick={() => setKey(k)} aria-pressed={key === k} className={cx('inline-flex min-h-[32px] cursor-pointer items-center gap-1', key === k ? 'text-ink' : 'text-ink-2 hover:text-ink')}>
        {label}<ArrowDownUp size={12} aria-hidden />
      </button>
    </th>
  )
  return (
    <div>
      <SectionTitle>技能卡打出次数</SectionTitle>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[420px] text-[13px]">
          <thead className="bg-surface-2 text-left text-[12.5px] text-ink-2">
            <tr><th className="px-3 py-2 font-semibold">技能卡</th>{head('per_game', '每局平均')}{head('share', '打出过的局')}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((c) => {
              const [id, up] = splitCardId(c.card)
              const a = cat?.cards[id]?.asset
              return (
                <tr key={c.card}>
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-2">
                      {a ? <img src={spriteUrl(a)} alt="" width={28} height={28} className="size-7 rounded" /> : <span className="size-7 rounded bg-surface-3" />}
                      {cardName(cat, id, up)}
                    </span>
                  </td>
                  <td className="num px-3 py-1.5 text-right">{c.per_game.toFixed(2)}</td>
                  <td className="num px-3 py-1.5 text-right">{(c.share * 100).toFixed(1)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** 最低 / 中位 / 最高三局的出牌：按回合分组，每张打出的卡、这回合属性、打完后的分数、体力、元气 */
function Logs({ r }: { r: SimResult }) {
  const cat = useCatalog()
  const [which, setWhich] = useState<'min' | 'median' | 'max'>('median')
  const g = r.logs[which]
  const turns = useMemo(() => {
    const m = new Map<number, typeof g.plays>()
    for (const p of g?.plays ?? []) m.set(p.turn, [...(m.get(p.turn) ?? []), p])
    return [...m.entries()]
  }, [g])
  const tab = (k: typeof which, label: string, s?: number) => (
    <button type="button" aria-pressed={which === k} onClick={() => setWhich(k)}
      className={cx('min-h-[40px] cursor-pointer rounded-full px-4 text-[13px] font-semibold', which === k ? 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line)]' : 'text-ink-2 hover:text-ink')}>
      {label}{s != null && <span className="num ml-1.5 font-normal text-ink-3">{int(s)}</span>}
    </button>
  )
  return (
    <div>
      <SectionTitle>出牌记录</SectionTitle>
      <div className="mb-3 inline-flex gap-0.5 rounded-full bg-surface-2 p-1">
        {tab('min', '最低', r.logs.min?.score)}{tab('median', '中位', r.logs.median?.score)}{tab('max', '最高', r.logs.max?.score)}
      </div>
      {!g ? <p className="text-ink-3">这局没有记录</p> : (
        <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {turns.map(([t, plays]) => (
            <li key={t} className="grid grid-cols-[3.2em_1fr] gap-3 px-3 py-2">
              <span className="flex items-center gap-1.5 text-[12.5px] text-ink-2"><span className="num">{t}</span><AttrChip t={plays[0].ptype} size="xs" /></span>
              <ul className="space-y-1">
                {plays.map((p, i) => {
                  const a = cat?.cards[p.card_id]?.asset
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px]">
                      <span className="flex min-w-[12em] flex-1 items-center gap-2">
                        {a ? <img src={spriteUrl(a)} alt="" width={24} height={24} className="size-6 rounded" /> : <span className="size-6 rounded bg-surface-3" />}
                        {cardName(cat, p.card_id, p.up)}
                      </span>
                      <span className="num text-ink-2">分数 <b className="text-ink">{int(p.score)}</b></span>
                      <span className="num text-[12px] text-ink-3">体力 {p.stamina} · 元气 {p.block}</span>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-[12px] text-ink-3">模拟器只记打出的卡，不记手牌；没出现的回合是那回合没打牌。</p>
    </div>
  )
}
