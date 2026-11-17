import type { Catalog } from '../lib/api'
import { spriteUrl, useLang, useTerms } from '../lib/catalog'
import { pick, type SupportCatalog } from '../lib/supports'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CopyId, IdolThumb } from './ui'
import { Meta, RarityTag, UnlockTag } from './CardDetail'
import { SupportThumb } from './SupportCard'

/** P 道具的详情：图标、名字、稀有度、计划、效果文字、编号，以及从哪来（偶像卡专属 / 支援卡事件）。
 * 嵌在别的弹窗里时用 open 控制开关、不要直接卸载（同 CardDetail）。supports 有就顺带列出哪些支援卡的事件给它 */
export function ItemDetail({ id, cat, supports, onClose, open = true }: { id: string; cat: Catalog; supports?: SupportCatalog | null; onClose: () => void; open?: boolean }) {
  const { lang } = useLang()
  const terms = useTerms()
  const d = cat.items[id]
  const idols = Object.entries(cat.idols).filter(([, x]) => x.item === id || x.item_up === id)
  const fromSupports = Object.entries(supports?.cards ?? {}).filter(([, s]) => s.events.some((e) => e.item === id))
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-2xl sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="size-16 shrink-0 overflow-hidden rounded-xl bg-surface-2 ring-1 ring-line">
              {d?.asset && <img src={spriteUrl(d.asset)} alt="" width={64} height={64} className="size-full object-contain" />}
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[18px] font-bold">{d?.name ?? id}</DialogTitle>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <RarityTag r={d?.rarity} />
                <Meta>{d?.plan && d.plan !== 'COMMON' ? (terms.plan[d.plan] ?? d.plan) : '通用'}</Meta>
                {d?.unlock ? <UnlockTag lv={d.unlock} /> : null}
              </div>
              <DialogDescription className="mt-1"><CopyId id={id} /></DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <section>
          <h3 className="mb-2 text-[13px] font-bold text-ink">效果</h3>
          <p className="rounded-xl border border-line px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-line text-ink">
            {d?.text || '游戏数据里没有这件道具的说明。'}
          </p>
        </section>

        {(idols.length > 0 || fromSupports.length > 0) && (
          <section>
            <h3 className="mb-2 text-[13px] font-bold text-ink">从哪拿到</h3>
            <ul className="divide-y divide-line rounded-xl border border-line text-[13px]">
              {idols.map(([iid, x]) => (
                <li key={iid} className="flex items-center gap-2.5 px-3 py-2">
                  <IdolThumb id={iid} size={32} title={false} />
                  <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  <span className="shrink-0 text-[12px] text-ink-3">偶像卡专属{x.item_up === id && x.item !== id ? ' · 特训后' : x.item_up && x.item_up !== id ? ' · 特训前' : ''}</span>
                </li>
              ))}
              {fromSupports.map(([sid, s]) => (
                <li key={sid} className="flex items-center gap-2.5 px-3 py-2">
                  <SupportThumb id={sid} size={32} />
                  <span className="min-w-0 flex-1 truncate">{pick(s.name, lang)}</span>
                  <span className="shrink-0 text-[12px] text-ink-3">支援卡事件 · Lv {s.events.find((e) => e.item === id)?.level}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </DialogContent>
    </Dialog>
  )
}
