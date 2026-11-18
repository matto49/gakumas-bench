import { Link } from 'react-router-dom'
import { useApi } from '../lib/hooks'
import type { SetInfo } from '../lib/api'
import type { SiteHome, SiteNow, SiteUpdates } from '../lib/site'
import { DataDate, DataTiles, GuideTitle, HomeTierBoard, ModeEntries, MoreLink, NowSection, ToolTiles, UpdateList } from '../components/HomeGuide'
import { useTierBoard } from './Tiers'
import { HomeHero } from '../components/HomeHero'

/** 首页：官方卡面头图（HomeHero，最新 SSR 偶像卡）→ 压在头图下沿的「现在」浮层；后面照一般攻略站的骨架排——现在（卡池活动、新卡、生日）→ 最近更新 → 强度榜 → 按模式 → 游戏资料 → 工具 → 关于本站。
 * 长期内容（完整强度榜、图鉴）首页只放入口；原来首页上的算法排行说明搬到 /about */
export function Home() {
  const sets = useApi<SetInfo[]>('api/sets')
  const home = useApi<SiteHome>('api/site/home')
  const now = useApi<SiteNow>('api/site/now')
  const updates = useApi<SiteUpdates>('api/site/updates')
  const tiers = useTierBoard(undefined)
  return (
    <div>
      <HomeHero home={home.data} />

      <div className="mx-auto max-w-[1120px]">
        {/* 「现在」浮在头图下沿上：第一屏就能看到新卡和生日 */}
        <section className="relative z-10 -mt-24 mb-12 rounded-2xl bg-surface p-5 shadow-[0_1px_0_rgba(0,0,0,.04),0_24px_50px_-24px_rgba(20,16,30,.35)] sm:-mt-[104px] sm:px-6">
          <NowSection home={home.data} now={now.data} flat />
          {home.data?.source.master_date && <p className="mt-4 text-[12px] text-ink-3 lg:text-right">游戏数据同步于 <span className="num">{home.data.source.master_date}</span></p>}
        </section>

        <section className="mb-12">
          <GuideTitle right={<MoreLink to="/about#updates">全部更新</MoreLink>}>本站最近更新</GuideTitle>
          <UpdateList items={updates.data?.items ?? []} limit={4} />
        </section>

        <section className="mb-12">
          <GuideTitle
            sub="理性 · 好印象 31 张偶像卡在 H.I.F 本戦里的六维强度。数据：花吹雪また一年P，对局记录截至 11-14。"
            right={<MoreLink to="/tiers">完整榜单和六维</MoreLink>}
          >
            强度榜
          </GuideTitle>
          <HomeTierBoard board={tiers.data} only={['S', 'A']} />
        </section>

        <section className="mb-12">
          <GuideTitle sub="每个培育模式现在有什么。打法指南还在写。">按模式</GuideTitle>
          <ModeEntries sets={sets.data} board={tiers.data} />
        </section>

        <section className="mb-12">
          <GuideTitle sub={<DataDate />} right={<MoreLink to="/cards">游戏资源一览</MoreLink>}>游戏资料</GuideTitle>
          <DataTiles />
        </section>

        <section className="mb-12">
          <GuideTitle>工具</GuideTitle>
          <ToolTiles />
        </section>

        <section className="rounded-2xl bg-surface-2 px-5 py-4 text-[13.5px] leading-relaxed text-ink-2">
          <p>
            <b className="text-ink">关于本站</b>：资料取自游戏数据，中文用学マス汉化插件的翻译，考试模拟用 GKMS。强度榜的数据和方法来自花吹雪また一年P。
            不定期更新。<Link to="/about" className="font-semibold text-brand-ink hover:underline">数据来源、更新记录和出牌算法排行的说明 →</Link>
          </p>
        </section>
      </div>
    </div>
  )
}
