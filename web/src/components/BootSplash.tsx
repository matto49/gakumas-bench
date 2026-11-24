import { useEffect, useState } from 'react'

const KEY = 'gkb-boot'
const MIN = 1450 // 最短停留：五个字 1.06 秒才全部弹完，再留 0.4 秒看清
const MAX = 2600 // 头图再慢也不挡着

/** 进站动画：白底上 Vo / Da / Vi 三道斜杠依次落下，英文副标滑出，「初星攻略站」五个字逐个弹上来，然后整块斜着擦走。
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
    const home = location.pathname.replace(/\/?$/, '/') === import.meta.env.BASE_URL // 首页：/
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
        <div className="-ml-1 overflow-hidden pb-1 pl-1">
          <span className="boot-sub disp">HATSUBOSHI GUIDE</span>
          {/* 字标：思源黑体 Black 只截这五个字（assets/fonts/wordmark-black.woff2），前三个字对应 Vo / Da / Vi，和宣传视频封面一致 */}
          <span className="boot-title">
            <b className="text-vo">初</b>
            <b className="text-da">星</b>
            <b className="text-vi">攻</b>
            <b>略</b>
            <b>站</b>
          </span>
        </div>
      </div>
    </div>
  )
}
