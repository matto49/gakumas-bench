import { useEffect, useState } from 'react'

const KEY = 'gkb-boot'
const MIN = 1200 // 最短停留：站名 0.82 秒才完整滑出，再留 0.4 秒看清
const MAX = 2600 // 头图再慢也不挡着

/** 进站动画：白底上 Vo / Da / Vi 三道斜杠依次落下，站名从左滑出，然后整块斜着擦走。
 * 每次打开网站（同一个标签页会话）只播一次；系统开了「减少动态效果」不播。
 * 首页等头图卡面加载完（HomeHero 发 gkb-ready）再擦开，等的时候斜杠轻轻闪；别的页面停够 MIN 就走 */
export function BootSplash() {
  const [phase, setPhase] = useState<'off' | 'in' | 'wait' | 'out'>(() => {
    if (typeof window === 'undefined') return 'off'
    if (sessionStorage.getItem(KEY) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'off'
    return 'in'
  })

  useEffect(() => {
    if (phase !== 'in') return
    sessionStorage.setItem(KEY, '1')
    const home = location.pathname.replace(/\/?$/, '/') === import.meta.env.BASE_URL // 首页：/gkbench 或 /gkbench/
    let ready = !home || !!(window as { __gkbReady?: boolean }).__gkbReady
    let minDone = false
    const go = () => setPhase('out')
    const onReady = () => {
      ready = true
      if (minDone) go()
    }
    window.addEventListener('gkb-ready', onReady)
    const t1 = setTimeout(() => {
      minDone = true
      if (ready) go()
      else setPhase('wait')
    }, MIN)
    const t2 = setTimeout(go, MAX)
    return () => {
      window.removeEventListener('gkb-ready', onReady)
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [phase])

  useEffect(() => {
    if (phase !== 'out') return
    const t = setTimeout(() => setPhase('off'), 450)
    return () => clearTimeout(t)
  }, [phase])

  if (phase === 'off') return null
  return (
    <div className={`boot ${phase === 'out' ? 'boot-out' : ''} ${phase === 'wait' ? 'boot-wait' : ''}`} aria-hidden>
      <div className="flex items-center gap-5 sm:gap-7">
        <div className="boot-bars">
          <i className="bg-vo" />
          <i className="bg-da" />
          <i className="bg-vi" />
        </div>
        <div className="overflow-hidden">
          <span className="boot-sub disp not-italic">HATSUBOSHI DATA ROOM</span>
          <span className="boot-title">初星数据室</span>
        </div>
      </div>
    </div>
  )
}
