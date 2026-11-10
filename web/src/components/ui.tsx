import type { MouseEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, CircleHelp, Copy, RotateCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ApiError, BASE, type Ratio } from '../lib/api'
import { pct, pm } from '../lib/format'
import { GRADE_HINT, gradeOf, modeLabel } from '../lib/game'
import { gradeUrl, idolName, idolThumbUrl, useCatalog } from '../lib/catalog'

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(' ')
}

/** 链接要长成按钮时用这几个类名；真按钮直接用 shadcn 的 <Button> */
export const btn = {
  primary: cn(buttonVariants()),
  secondary: cn(buttonVariants({ variant: 'outline' })),
  small: cn(buttonVariants({ variant: 'outline', size: 'sm' })),
}

/** 悬停 / 聚焦时出现的说明框（shadcn Tooltip，弹层挂在 body 上，不会被表格的滚动区裁掉） */
export function Tip({ children, tip, wide }: { children: ReactNode; tip: ReactNode; wide?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className={wide ? 'max-w-80' : 'max-w-60'}>
        {tip}
      </TooltipContent>
    </Tooltip>
  )
}

export function Help({ tip }: { tip: ReactNode }) {
  return (
    <Tip tip={tip} wide>
      <button type="button" aria-label="说明" className="ml-1 inline-flex text-ink-3 hover:text-brand-ink">
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
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const status = error instanceof ApiError ? error.status : 0
  const hint =
    status === 401 ? '要令牌。到「我的」页粘贴令牌再试。' :
    status === 403 ? '这一项不公开。' :
    status === 404 ? '找不到。链接可能写错了，或者这次运行已删除。' :
    status >= 500 ? '服务器出错了，稍后再试。' :
    status === 0 ? '连不上服务器，检查网络。' : ''
  return (
    <div className="my-6 flex items-start gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-critical" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{error.message}</p>
        {hint && <p className="mt-0.5 text-ink-2">{hint}</p>}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw size={13} /> 重试
        </Button>
      )}
    </div>
  )
}

/** 空状态：一句话说该做什么 */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="stripes-soft rounded-xl border border-dashed border-line-strong px-6 py-10 text-center text-ink-2">{children}</div>
}

export function ModeBadge({ mode, privileged }: { mode?: string; privileged: boolean }) {
  const m = modeLabel(mode, privileged)
  const variant = privileged ? 'quiet' : mode === 'hosted' ? 'brand' : 'outline'
  return (
    <Tip tip={m.hint}>
      <Badge tabIndex={0} variant={variant}>
        {m.text}
      </Badge>
    </Tip>
  )
}

/** 比值：几何平均 ± 标准误；样本数放在提示里 */
export function RatioText({ r, digits = 1, strong }: { r: Ratio | null | undefined; digits?: number; strong?: boolean }) {
  if (!r) return <span className="text-ink-3">—</span>
  return (
    <Tip tip={<>同题同种子配对 {r.n} 局的几何平均，± 是标准误。</>}>
      <span tabIndex={0} className="num whitespace-nowrap">
        <span className={strong ? 'disp text-[17px] text-ink' : 'text-ink'}>{pct(r, digits)}</span>
        <span className="ml-1 text-[12px] text-ink-3">{pm(r, digits)}</span>
      </span>
    </Tip>
  )
}

/** 评级徽章：游戏里的培育评级图标，按相对上限划线 */
export function Grade({ ratio, size = 28 }: { ratio: number | null | undefined; size?: number }) {
  if (ratio == null) return <span className="inline-block" style={{ width: size }} aria-hidden />
  const g = gradeOf(ratio)
  return (
    <Tip tip={<>相对上限 {(ratio * 100).toFixed(1)}%，评 {g.label}。<br />{GRADE_HINT}</>} wide>
      <img tabIndex={0} src={gradeUrl(g.key)} alt={`评级 ${g.label}`} width={size} height={size} className="shrink-0 select-none" style={{ width: size, height: size }} />
    </Tip>
  )
}

/** 偶像缩略图（偶像卡的方形图）；没有图时用名字首字 */
export function IdolThumb({ id, size = 28, title = true, className }: { id?: string; size?: number; title?: boolean; className?: string }) {
  const cat = useCatalog()
  if (!id) return null
  const name = idolName(cat, id)
  const img = (
    <img
      src={idolThumbUrl(id)}
      alt={title ? '' : name}
      width={size}
      height={size}
      loading="lazy"
      className={cx('shrink-0 rounded-lg bg-surface-3 object-cover ring-1 ring-line', className)}
      style={{ width: size, height: size }}
      onError={(e) => ((e.currentTarget.style.visibility = 'hidden'))}
    />
  )
  return title ? <Tip tip={name}><span tabIndex={0} className="inline-flex">{img}</span></Tip> : img
}

const ATTR_STYLE: Record<number, [string, string]> = {
  1: ['Vo', 'bg-vo-strong text-white'],
  2: ['Da', 'bg-da-strong text-white'],
  3: ['Vi', 'bg-vi-strong text-ink'],
}

/** 一个回合属性：Vo / Da / Vi 色块带字 */
export function AttrChip({ t, size = 'sm' }: { t: number; size?: 'sm' | 'xs' }) {
  const [label, cls] = ATTR_STYLE[t] ?? ['?', 'bg-surface-3 text-ink-2']
  return (
    <span className={cx('inline-grid place-items-center rounded-[4px] font-bold italic leading-none', cls, size === 'xs' ? 'h-4 w-5 text-[9.5px]' : 'h-5 w-6 text-[10.5px]')}>
      {label}
    </span>
  )
}

/** 回合属性条：考试画面顶部那一排，每回合一块 */
export function TurnStrip({ types, current, size = 'sm' }: { types?: number[] | null; current?: number; size?: 'sm' | 'xs' }) {
  if (!types?.length) return null
  const names = types.map((t) => ATTR_STYLE[t]?.[0] ?? '?')
  return (
    <span className="inline-flex items-center gap-[3px]" role="img" aria-label={`回合属性：${names.join(' ')}`}>
      {types.map((t, i) => (
        <span key={i} className={cx('inline-flex rounded-[5px]', current === i + 1 && 'ring-2 ring-brand ring-offset-1 ring-offset-surface')}>
          <AttrChip t={t} size={size} />
        </span>
      ))}
    </span>
  )
}

/** 名次数字：1–3 名用金银铜 */
export function RankNum({ n, className }: { n: number; className?: string }) {
  const c = n === 1 ? 'text-gold' : n === 2 ? 'text-silver' : n === 3 ? 'text-bronze' : 'text-ink-3'
  return <span className={cx('disp text-[22px] leading-none', c, className)}>{n}</span>
}

/** 页面标题：左边一道斜的橙色标记，像游戏里的标题牌 */
export function PageHeader({ title, sub, right, crumb }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; crumb?: ReactNode }) {
  return (
    <div className="mb-6">
      {crumb && <p className="mb-2 text-[12.5px] text-ink-3">{crumb}</p>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-3 text-[24px] leading-tight font-bold tracking-tight text-ink">
            <span className="inline-block h-6 w-1.5 shrink-0 -skew-x-12 rounded-sm bg-brand" aria-hidden />
            <span className="min-w-0">{title}</span>
          </h1>
          {sub && <div className="mt-1.5 pl-[18px] text-ink-2">{sub}</div>}
        </div>
        {right}
      </div>
    </div>
  )
}

export function SectionTitle({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-3 flex flex-wrap items-baseline justify-between gap-2', className)}>
      <h2 className="flex items-center gap-2 text-[16px] font-bold text-ink">
        <span className="inline-block h-4 w-1 shrink-0 -skew-x-12 rounded-sm bg-brand" aria-hidden />
        {children}
      </h2>
      {right}
    </div>
  )
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[12px] text-ink">{children}</code>
}

export function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-[oklch(0.27_0.025_40)] px-4 py-3 font-mono text-[12.5px] leading-relaxed text-[oklch(0.93_0.02_70)]">
      {children}
    </pre>
  )
}

/** 行里自己能点的东西：点到它们时整行不跳 */
const ROW_INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role="button"],[role="checkbox"],[tabindex]:not(tr)'

/**
 * 整行可点：`const rowLink = useRowLink()`，`<tr {...rowLink('/runs/' + id)} className="cursor-pointer …">`。点行里的空白或文字跳到 to；点行里自己的链接、按钮、
 * 带提示的数字照常；选中文字时不跳；⌘ / Ctrl / Shift 点或中键点在新标签打开。行里仍要留一个真链接给键盘和读屏。
 */
export function useRowLink() {
  const nav = useNavigate()
  return (to: string) => {
    const open = (e: MouseEvent, newTab: boolean) => {
      if ((e.target as HTMLElement).closest(ROW_INTERACTIVE)) return
      if (window.getSelection()?.toString()) return
      if (newTab) window.open(BASE + to.replace(/^\//, ''), '_blank', 'noopener')
      else nav(to)
    }
    return {
      onClick: (e: MouseEvent) => open(e, e.metaKey || e.ctrlKey || e.shiftKey),
      onAuxClick: (e: MouseEvent) => { if (e.button === 1) open(e, true) },
    }
  }
}

/** 编号 + 复制按钮（上传编成时要填编号：偶像卡、饮料、P 道具、回忆能力、技能卡） */
export function CopyId({ id, className }: { id: string; className?: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id)
      setDone(true)
      setTimeout(() => setDone(false), 1200)
    } catch {
      toast.error('没复制成功', { description: '浏览器不让写剪贴板，手动选中编号复制。' })
    }
  }
  return (
    <span className={cx('inline-flex max-w-full items-center gap-1 font-mono text-[11px] text-ink-3', className)}>
      <span className="truncate select-all" title={id}>{id}</span>
      <button type="button" onClick={copy} aria-label={`复制编号 ${id}`}
        className="inline-grid size-6 shrink-0 place-items-center rounded-full hover:bg-surface-2 hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-ring">
        {done ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
      </button>
      <span className="sr-only" aria-live="polite">{done ? '已复制' : ''}</span>
    </span>
  )
}
