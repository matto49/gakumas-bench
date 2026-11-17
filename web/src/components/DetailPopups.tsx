import { useState } from 'react'
import { useApi } from '../lib/hooks'
import { useCatalog } from '../lib/catalog'
import type { SupportCatalog } from '../lib/supports'
import { SupportDetail } from './SupportCard'
import { IdolDetail } from './IdolCard'
import { CardDetail } from './CardDetail'

/** 在任何页面原地打开详情弹窗，不跳到游戏资源一览。
 * 支援卡目录（约 700 KB）只在第一次打开支援卡弹窗时取；之后浏览器缓存里有 */

export function SupportPopup({ id, onClose }: { id: string; onClose: () => void }) {
  const cat = useCatalog()
  const sup = useApi<SupportCatalog>('api/supports')
  const d = sup.data?.cards[id]
  if (!cat || !sup.data || !d) return null
  return <SupportDetail id={id} d={d} all={sup.data} cat={cat} onClose={onClose} />
}

export function IdolPopup({ id, onClose }: { id: string; onClose: () => void }) {
  const cat = useCatalog()
  // 偶像卡详情里点固有技能卡：在上面再叠一层技能卡详情，关掉回到偶像卡
  const [card, setCard] = useState<string | null>(null)
  const d = cat?.idols[id]
  if (!cat || !d) return null
  return (
    <>
      <IdolDetail id={id} d={d} cat={cat} onClose={onClose} onOpenCard={setCard} />
      {card && cat.cards[card] && <CardDetail id={card} c={cat.cards[card]} onClose={() => setCard(null)} />}
    </>
  )
}

/** 一页里用一个：open(kind, id) 打开，渲染 <popup /> */
export function useDetailPopup() {
  const [open, setOpen] = useState<{ kind: 'support' | 'idol'; id: string } | null>(null)
  const close = () => setOpen(null)
  const popup = open?.kind === 'support' ? <SupportPopup id={open.id} onClose={close} />
    : open?.kind === 'idol' ? <IdolPopup id={open.id} onClose={close} /> : null
  return { open: (kind: 'support' | 'idol', id: string) => setOpen({ kind, id }), popup }
}
