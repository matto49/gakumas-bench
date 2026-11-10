import type { ReactNode } from 'react'
import { Select as Root, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cx } from './ui'

const NONE = '\u0000none'

export type SelectOption = {
  value: string
  label: ReactNode
  /** 选中后按钮上显示的文字；不给就用 label */
  short?: ReactNode
  /** 左边的小图（偶像头像等） */
  icon?: ReactNode
  /** 右边的灰字说明 */
  hint?: ReactNode
}

/**
 * 全站统一的下拉框：shadcn/ui 的 Select（底层 Base UI），这里只把常用写法包成一个 options 数组。
 * 键盘（上下键、回车、Esc、按首字母跳转）、读屏、弹层定位都由 Base UI 处理。
 */
export function Select({
  value,
  onChange,
  options,
  label,
  placeholder = '请选择',
  className,
  width,
  align = 'start',
}: {
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  /** 读屏用的名字；页面上的文字标签另外写 */
  label: string
  placeholder?: string
  className?: string
  /** 按钮最大宽度，长名字截断 */
  width?: string
  /** 弹层和按钮哪一边对齐；靠页面右边的下拉框用 end */
  align?: 'start' | 'end'
}) {
  const cur = options.find((o) => o.value === value)
  // Base UI 把空串当成「没选」，按钮会显示成占位样式；内部换成一个占位值
  const enc = (v: string) => (v === '' ? NONE : v)
  return (
    <Root value={cur ? enc(value) : null} onValueChange={(v) => onChange(v == null || v === NONE ? '' : String(v))}>
      <SelectTrigger
        aria-label={label}
        className={cx(
          'min-w-24 rounded-full border-input bg-background pr-2 pl-3 text-[13px] text-ink hover:border-brand data-popup-open:border-primary data-popup-open:ring-3 data-popup-open:ring-ring/25 [&>svg]:transition-transform [&>svg]:duration-150 data-popup-open:[&>svg]:rotate-180',
          className,
        )}
        style={width ? { maxWidth: width } : undefined}
      >
        <SelectValue placeholder={placeholder}>
          {() =>
            cur ? (
              <span className="flex min-w-0 items-center gap-1.5">
                {cur.icon && <span className="-ml-1.5 shrink-0">{cur.icon}</span>}
                <span className="truncate">{cur.short ?? cur.label}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        align={align}
        alignItemWithTrigger={false}
        sideOffset={6}
        className="w-auto min-w-(--anchor-width) rounded-xl border border-border p-1 text-[13px] shadow-[0_14px_36px_-12px_oklch(0.35_0.06_40/0.35)] ring-0"
      >
        {options.map((o) => (
          <SelectItem
            key={o.value}
            value={enc(o.value)}
            className="rounded-lg py-1.5 pr-8 pl-2 text-[13px] text-ink data-highlighted:bg-accent data-selected:bg-brand-soft data-selected:font-semibold data-selected:text-brand-ink"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {o.icon && <span className="shrink-0">{o.icon}</span>}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 pl-3 text-[11.5px] font-normal text-ink-3">{o.hint}</span>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Root>
  )
}
