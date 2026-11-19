import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { BASE } from '../lib/api'
import { useCatalog, useLang } from '../lib/catalog'
import { HERO_FALLBACK, heroCard, type SiteHome } from '../lib/site'
import { pick } from '../lib/supports'
import { useDetailPopup } from './DetailPopups'

const artUrl = (id: string, m = false) => `${BASE}sprites/art-${id}${m ? '-m' : ''}.webp`

/** 进站动画在等这一声：头图卡面加载完（或失败）就可以擦开了 */
const ready = () => {
  ;(window as { __gkbReady?: boolean }).__gkbReady = true
  window.dispatchEvent(new Event('gkb-ready'))
}

/** 首页头图：最新 SSR 偶像卡的卡面铺满，站名压在左边暗角上；右下角写这是哪张卡，点开原地看详情。
 * 顶栏在首页是透明的，叠在头图上（Layout.tsx），所以这里往上顶一个顶栏的高度 */
export function HomeHero({ home }: { home: SiteHome | null }) {
  const { lang } = useLang()
  const cat = useCatalog()
  const detail = useDetailPopup()
  const card = heroCard(home)
  const [broken, setBroken] = useState(false)
  // 新卡数据还没到时先不放图，免得先闪一张备用卡面再换
  const id = home ? (card && !broken ? card.id : HERO_FALLBACK) : null
  const shown = card && !broken ? card : null
  return (
    <section className="relative mx-[calc(50%-50vw)] -mt-[calc(3.25rem+1px)] overflow-hidden bg-[#17141C] text-white">
      {id && (
        <picture key={id}>
          <source media="(max-width: 639px)" srcSet={artUrl(id, true)} />
          <img
            src={artUrl(id)}
            alt=""
            fetchPriority="high"
            onLoad={ready}
            onError={() => (broken ? ready() : setBroken(true))}
            className="absolute inset-x-0 top-0 h-[62%] w-full object-cover object-[50%_30%] [mask-image:linear-gradient(180deg,#000_55%,transparent_100%)] sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:w-[76%] sm:[mask-image:linear-gradient(90deg,transparent_0,#000_34%)]"
          />
        </picture>
      )}
      {/* 手机上卡面占上面六成、顶上压暗一点给顶栏；宽屏上卡面在右，左边是纯色暗角 */}
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#17141C]/60 to-transparent sm:hidden" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 hidden h-40 bg-gradient-to-b from-transparent to-[#17141C]/55 sm:block" aria-hidden />

      <div className="relative mx-auto flex min-h-[600px] max-w-[1160px] flex-col justify-end px-5 pt-24 pb-32 sm:min-h-[560px] sm:justify-start sm:pt-[124px] sm:pb-40">
        <p className="disp text-[14px] tracking-[0.16em] text-white/70 not-italic sm:text-[16px]">HATSUBOSHI GUIDE · 学マス</p>
        <h1 className="mt-2 text-[48px] leading-[1.04] font-black tracking-tight [text-shadow:0_2px_24px_rgba(0,0,0,.35)] sm:text-[84px]">初星攻略站</h1>
        <p className="mt-4 max-w-[26em] text-[15px] leading-[1.75] text-balance text-white/85 sm:text-[17px]">由学园偶像大师（学マス）玩家共建的中文攻略站，包含角色卡等游戏资源、游戏引擎复刻、角色强度榜、考试算法排行。</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link to="/tiers" className="inline-flex items-center gap-1.5 rounded-full bg-white px-6 py-3 text-[15px] font-bold text-ink transition-transform duration-150 hover:-translate-y-px">
            看角色强度榜 <ArrowRight size={16} aria-hidden />
          </Link>
          <Link to="/cards" className="inline-flex items-center rounded-full border-[1.5px] border-white/55 px-6 py-[10.5px] text-[15px] font-bold text-white backdrop-blur-sm transition-colors duration-150 hover:bg-white/10">
            查游戏资料
          </Link>
        </div>
      </div>

      {shown && (
        <button
          type="button"
          disabled={!cat?.idols[shown.id]}
          onClick={() => detail.open('idol', shown.id)}
          className="absolute right-4 bottom-[118px] max-w-[calc(100%-2rem)] truncate rounded-full bg-black/30 px-3 py-1.5 text-[12px] text-white/90 backdrop-blur-md transition-colors duration-150 enabled:cursor-pointer enabled:hover:bg-black/45 max-sm:hidden sm:right-12 sm:bottom-[136px]"
        >
          <b className="mr-1.5 font-bold">{shown.date.slice(5)} 新卡</b>【{pick(shown.name, lang)}】{pick(shown.character_name ?? shown.name, lang)}
        </button>
      )}
      {detail.popup}
    </section>
  )
}
