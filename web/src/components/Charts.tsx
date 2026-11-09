import { useEffect, useMemo, useRef, useState } from 'react'
import { compact, int } from '../lib/format'

/* 图表规范（dataviz）：线 2px、端点 ≥8px 带 2px 表面色描边、网格 1px 实线、文字不用数据色、悬停有十字线和提示。
   回合属性用图下方的一条色带表示（Vo 粉 / Da 蓝 / Vi 黄，每格带文字），不铺在背景上，免得和曲线颜色打架。 */

export type Series = { name: string; color: string; dash?: boolean; points: { x: number; y: number; label?: string }[] }

const ATTR_COLOR: Record<number, string> = { 1: 'var(--color-vo)', 2: 'var(--color-da)', 3: 'var(--color-vi)' }
const ATTR_TEXT: Record<number, string> = { 1: 'Vo', 2: 'Da', 3: 'Vi' }

/** 容器的实际宽度：图按真实像素画，字号不会跟着缩放 */
function useWidth<T extends HTMLElement>(fallback = 720) {
  const ref = useRef<T>(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

function niceTicks(max: number, n = 4) {
  if (max <= 0) return [0]
  const raw = max / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out = []
  for (let v = 0; v <= max + step * 0.01; v += step) out.push(v)
  return out
}

/** 分数随决策步数的曲线；turns[i] 是第 i 步所在回合，types 是每回合属性 */
export function ScoreChart({
  series,
  turnOf,
  types,
  current,
  onPick,
  height = 220,
}: {
  series: Series[]
  turnOf: number[]
  types?: number[]
  current?: number
  onPick?: (i: number) => void
  height?: number
}) {
  const ref = useRef<SVGSVGElement>(null)
  const [box, W] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const pad = { l: 52, r: 16, t: 12, b: 44 }
  const n = Math.max(1, ...series.map((s) => s.points.length))
  const ymax = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.y)))
  const ticks = niceTicks(ymax)
  const ytop = ticks[ticks.length - 1] || ymax
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r))
  const y = (v: number) => pad.t + (1 - v / ytop) * (height - pad.t - pad.b)
  const bandY = height - pad.b + 14

  // 回合分段：连续同一回合的步数合成一段
  const segs = useMemo(() => {
    const out: { t: number; a: number; b: number }[] = []
    turnOf.forEach((t, i) => {
      const last = out[out.length - 1]
      if (last && last.t === t) last.b = i
      else out.push({ t, a: i, b: i })
    })
    return out
  }, [turnOf])

  const onMove = (e: React.PointerEvent) => {
    const svg = ref.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  const hi = hover ?? current ?? null

  return (
    <div ref={box} className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${height}`}
        className="block touch-none select-none"
        width={W}
        height={height}
        role="img"
        aria-label={`分数曲线：${series.map((s) => `${s.name} 终局 ${int(s.points[s.points.length - 1]?.y ?? 0)}`).join('，')}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={() => hover != null && onPick?.(hover)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-muted)" className="num">
              {compact(t)}
            </text>
          </g>
        ))}
        {/* 回合色带 */}
        {segs.map((s) => {
          const x0 = x(s.a) - (n > 1 ? (W - pad.l - pad.r) / (n - 1) / 2 : 0)
          const x1 = x(s.b) + (n > 1 ? (W - pad.l - pad.r) / (n - 1) / 2 : 0)
          const a = types?.[s.t - 1]
          const left = Math.max(pad.l, x0) + 1
          const width = Math.max(2, Math.min(W - pad.r, x1) - left - 1)
          return (
            <g key={`${s.t}-${s.a}`}>
              <rect x={left} y={bandY - 6} width={width} height={4} rx={2} fill={a ? ATTR_COLOR[a] : 'var(--color-line-strong)'} />
              {width > 26 && (
                <text x={left + width / 2} y={bandY + 10} textAnchor="middle" fontSize={10} fill="var(--color-ink-2)">
                  {s.t}{a ? ` ${ATTR_TEXT[a]}` : ''}
                </text>
              )}
            </g>
          )
        })}
        <text x={pad.l - 8} y={bandY + 10} textAnchor="end" fontSize={10} fill="var(--color-muted)">回合</text>
        {hi != null && <line x1={x(hi)} x2={x(hi)} y1={pad.t} y2={height - pad.b} stroke="var(--color-line-strong)" strokeWidth={1} />}
        {series.map((s) => (
          <g key={s.name}>
            <polyline
              points={s.points.map((p, i) => `${x(i)},${y(p.y)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={s.dash ? '6 4' : undefined}
            />
            {s.points.length > 0 && (
              <circle cx={x(s.points.length - 1)} cy={y(s.points[s.points.length - 1].y)} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />
            )}
            {hi != null && s.points[hi] && <circle cx={x(hi)} cy={y(s.points[hi].y)} r={4.5} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />}
          </g>
        ))}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] shadow-[0_6px_24px_-8px_oklch(0.3_0.02_60/0.25)]"
          style={{ left: `${Math.min(78, (x(hover) / W) * 100)}%` }}
        >
          <div className="text-muted">第 {hover + 1} 步 · 回合 {turnOf[hover] ?? '?'}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} aria-hidden />
              <span className="text-ink-2">{s.name}</span>
              <span className="num ml-auto pl-3 font-medium text-ink">{s.points[hover] ? int(s.points[hover].y) : '—'}</span>
            </div>
          ))}
          {series[0]?.points[hover]?.label && <div className="mt-0.5 max-w-56 truncate text-ink-2">{series[0].points[hover].label}</div>}
        </div>
      )}
    </div>
  )
}

/** 每局的相对上限比值分布：一条轴上的点（同值往上叠） */
export function StripPlot({ values, onPick, label }: { values: { v: number; key: string; title: string }[]; onPick?: (key: string) => void; label: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const [box, W] = useWidth<HTMLDivElement>()
  const H = 92
  const pad = { l: 16, r: 16 }
  const vmax = Math.max(1, ...values.map((d) => d.v))
  const x = (v: number) => pad.l + (v / vmax) * (W - pad.l - pad.r)
  const bins = new Map<number, number>()
  const placed = values.map((d) => {
    const b = Math.round(x(d.v) / 9)
    const k = bins.get(b) ?? 0
    bins.set(b, k + 1)
    return { ...d, cx: x(d.v), cy: H - 30 - k * 9 }
  })
  const ticks = vmax > 1.05 ? [0, 0.5, 1, vmax] : [0, 0.25, 0.5, 0.75, 1]
  return (
    <div ref={box} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img" aria-label={label}>
        <line x1={pad.l} x2={W - pad.r} y1={H - 22} y2={H - 22} stroke="var(--color-line-strong)" strokeWidth={1} />
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--color-muted)" className="num">
            {(t * 100).toFixed(0)}%
          </text>
        ))}
        {placed.map((d, i) => (
          <circle
            key={d.key}
            cx={d.cx}
            cy={Math.max(6, d.cy)}
            r={hover === i ? 5 : 4}
            fill="var(--color-da)"
            stroke="var(--color-surface)"
            strokeWidth={2}
            className="cursor-pointer"
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            onClick={() => onPick?.(d.key)}
          >
            <title>{d.title}</title>
          </circle>
        ))}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute top-0 rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink shadow-sm" style={{ left: `${Math.min(80, (placed[hover].cx / W) * 100)}%` }}>
          {placed[hover].title}
        </div>
      )}
    </div>
  )
}
