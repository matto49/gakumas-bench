import type { ReactNode } from 'react'
import { AlertTriangle, CircleHelp, RotateCw } from 'lucide-react'
import { ApiError, type Ratio } from '../lib/api'
import { pct, pm } from '../lib/format'
import { modeLabel } from '../lib/game'

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(' ')
}

/** 悬停 / 聚焦时出现的说明框 */
export function Tip({ children, tip, wide }: { children: ReactNode; tip: ReactNode; wide?: boolean }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cx(
          'pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 -translate-x-1/2 rounded-md border border-line bg-surface px-2.5 py-2 text-[12px] leading-relaxed text-ink-2 opacity-0 shadow-[0_6px_24px_-8px_oklch(0.3_0.02_60/0.25)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100',
          wide ? 'w-80' : 'w-60',
        )}
      >
        {tip}
      </span>
    </span>
  )
}

export function Help({ tip }: { tip: ReactNode }) {
  return (
    <Tip tip={tip} wide>
      <button type="button" aria-label="说明" className="ml-1 inline-flex text-muted hover:text-ink-2">
        <CircleHelp size={13} strokeWidth={2} />
      </button>
    </Tip>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 py-2" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const status = error instanceof ApiError ? error.status : 0
  const hint =
    status === 401 ? '这一页需要令牌。到「我的」页粘贴令牌后再试。' :
    status === 403 ? '没有权限看这一项。' :
    status === 404 ? '找不到，可能链接写错了，或者这次运行已经删除。' :
    status >= 500 ? '服务器出错了，稍后重试；一直这样请联系管理员。' :
    status === 0 ? '连不上服务器，检查网络后重试。' : ''
  return (
    <div className="my-6 flex items-start gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-critical" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{error.message}</p>
        {hint && <p className="mt-0.5 text-ink-2">{hint}</p>}
      </div>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-1 rounded-md border border-line-strong px-2.5 py-1 text-ink-2 hover:bg-surface-3">
          <RotateCw size={13} /> 重试
        </button>
      )}
    </div>
  )
}

export function ModeBadge({ mode, privileged }: { mode?: string; privileged: boolean }) {
  const m = modeLabel(mode, privileged)
  const style = privileged
    ? 'border-line-strong bg-surface-3 text-ink-2'
    : mode === 'hosted'
      ? 'border-accent/40 bg-accent-soft text-accent-ink'
      : 'border-line bg-surface text-ink-2'
  return (
    <Tip tip={m.hint}>
      <span tabIndex={0} className={cx('inline-flex h-5 items-center rounded border px-1.5 text-[11px] font-medium', style)}>
        {m.text}
      </span>
    </Tip>
  )
}

/** 比值：几何平均 ± 标准误；样本数放在提示里 */
export function RatioText({ r, digits = 1, strong }: { r: Ratio | null | undefined; digits?: number; strong?: boolean }) {
  if (!r) return <span className="text-muted">—</span>
  return (
    <Tip tip={<>同题同种子配对 {r.n} 局的几何平均，± 是标准误。</>}>
      <span tabIndex={0} className="num whitespace-nowrap">
        <span className={strong ? 'font-semibold text-ink' : 'text-ink'}>{pct(r, digits)}</span>
        <span className="ml-1 text-[12px] text-muted">{pm(r, digits)}</span>
      </span>
    </Tip>
  )
}

/** 相对上限的水平条（细条，0–100%） */
export function RatioBar({ r }: { r: Ratio | null | undefined }) {
  if (!r) return null
  const v = Math.max(0, Math.min(1, r.geo))
  const lo = Math.max(0, r.geo - r.se)
  const hi = Math.min(1, r.geo + r.se)
  return (
    <span className="relative inline-block h-1.5 w-20 rounded-full bg-surface-3 align-middle" aria-hidden>
      <span className="absolute inset-y-0 left-0 rounded-full bg-ink-2/70" style={{ width: `${v * 100}%` }} />
      <span className="absolute -top-0.5 h-2.5 border-x border-ink/50" style={{ left: `${lo * 100}%`, width: `${Math.max(0.5, (hi - lo) * 100)}%` }} />
    </span>
  )
}

export function AttrChip({ t, size = 'sm' }: { t: number; size?: 'sm' | 'xs' }) {
  const m = { 1: ['Vo', 'bg-vo'], 2: ['Da', 'bg-da'], 3: ['Vi', 'bg-vi'] }[t as 1 | 2 | 3] ?? ['?', 'bg-muted']
  return (
    <span className={cx('inline-flex items-center gap-1 font-medium text-ink-2', size === 'xs' ? 'text-[10px]' : 'text-[11px]')}>
      <span className={cx('inline-block rounded-full', m[1], size === 'xs' ? 'size-1.5' : 'size-2')} aria-hidden />
      {m[0]}
    </span>
  )
}

export function PageHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {sub && <div className="mt-1 text-ink-2">{sub}</div>}
      </div>
      {right}
    </div>
  )
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[12px] text-ink">{children}</code>
}

export function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-ink">
      {children}
    </pre>
  )
}
