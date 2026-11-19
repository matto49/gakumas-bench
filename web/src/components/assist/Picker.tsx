import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cx } from '../ui'

/** 一个可选的东西：图标、名字、一行说明 */
export type PickItem = { id: string; name: string; sub?: string; img?: string; text?: string; group?: string }

/** 选择弹窗：上面搜索，下面图标网格；点一个就加（multi：弹窗不关，可以连续加） */
export function Picker({ open, title, items, onPick, onClose, multi, note }: {
  open: boolean; title: string; items: PickItem[]; onPick: (id: string) => void; onClose: () => void; multi?: boolean; note?: string
}) {
  const [q, setQ] = useState('')
  const [added, setAdded] = useState<string[]>([])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    const xs = t ? items.filter((x) => (x.name + ' ' + (x.sub ?? '') + ' ' + (x.text ?? '') + ' ' + x.id).toLowerCase().includes(t)) : items
    return xs.slice(0, 240)
  }, [items, q])
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setQ(''); setAdded([]) } }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 p-4 sm:max-w-3xl">
        <div>
          <DialogTitle className="text-[16px] font-bold">{title}</DialogTitle>
          <DialogDescription className="mt-0.5">{note ?? (multi ? '点一个加一个，可以连续加；加完点右上角关掉' : '点一个选上')}</DialogDescription>
        </div>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜名字、效果或编号" aria-label="搜索" className="h-10 rounded-full pl-8" />
        </div>
        {added.length > 0 && <p className="text-[12.5px] text-brand-ink">已加 {added.length} 个</p>}
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2">
            {shown.map((x) => (
              <button key={x.id} type="button" title={x.text || x.name}
                onClick={() => { onPick(x.id); setAdded((a) => [...a, x.id]); if (!multi) { onClose(); setQ(''); setAdded([]) } }}
                className={cx('flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface p-1.5 text-left transition-colors duration-150 hover:border-brand hover:bg-brand-tint',
                  added.includes(x.id) && 'border-brand')}>
                {x.img ? <img src={x.img} alt="" width={36} height={36} loading="lazy" className="size-9 shrink-0 rounded-md bg-surface-3 object-cover" />
                  : <span className="size-9 shrink-0 rounded-md bg-surface-3" />}
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold text-ink">{x.name || x.id}</span>
                  {x.text ? <span className="line-clamp-2 text-[11px] leading-snug text-ink-3">{x.text.replace(/\n/g, ' ')}</span>
                    : x.sub && <span className="block truncate text-[11px] text-ink-3">{x.sub}</span>}
                </span>
              </button>
            ))}
          </div>
          {shown.length === 0 && <p className="py-8 text-center text-ink-3">没找到</p>}
          {shown.length === 240 && <p className="py-2 text-center text-[12px] text-ink-3">只列前 240 个，搜一下缩小范围</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
