import { useEffect, useState } from 'react'
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom'
import { UserRound } from 'lucide-react'
import { useApi } from '../lib/hooks'
import { useLang } from '../lib/catalog'
import { cx, GithubMark } from './ui'
import { BootSplash } from './BootSplash'

const nav = [
  { to: '/', label: '首页', end: true, wide: true }, // 小屏上藏起来，点 logo 回首页
  { to: '/tiers', label: '角色强度榜' },
  { to: '/usage', label: '配置强度榜' },
  { to: '/guide', label: '偶像卡攻略' },
  // 算法排行和試験集合并成一项（2026-11-20）：这几条路径下都算在「算法排行」里，页内再用 BenchTabs 切换
  { to: '/sets', label: '算法排行', also: ['/exams', '/runs', '/compare'] },
  { to: '/gallery', label: '图鉴' },
  { to: '/cards', label: '游戏资源一览' },
  // 「对比」不放导航：从复盘页的「和别的算法对比」进（/compare 路由还在）
]

/** onArt：首页顶栏叠在头图卡面上，白字、半透明白底胶囊 */
const pill = (onArt: boolean) => ({ isActive }: { isActive: boolean }) =>
  cx(
    'rounded-full px-2.5 py-1 text-[13.5px] font-semibold whitespace-nowrap transition-colors duration-150 sm:px-3',
    onArt
      ? isActive ? 'bg-white/16 text-white' : 'text-white/80 hover:bg-white/12 hover:text-white'
      : isActive ? 'bg-surface-2 text-ink shadow-[inset_0_0_0_1px_var(--color-line)]' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  )

/** 首页、还没滚过头图：顶栏透明叠在卡面上 */
function useOnArt() {
  const home = useLocation().pathname === '/'
  const [top, setTop] = useState(true)
  useEffect(() => {
    if (!home) return
    const f = () => setTop(window.scrollY < 360)
    f()
    window.addEventListener('scroll', f, { passive: true })
    return () => window.removeEventListener('scroll', f)
  }, [home])
  return { home, onArt: home && top }
}

/** 卡名、效果文字用日文还是中文 */
function LangSwitch({ onArt }: { onArt: boolean }) {
  const { lang, setLang } = useLang()
  const opt = (l: 'ja' | 'zh', label: string, title: string) => (
    <button
      type="button"
      onClick={() => setLang(l)}
      aria-pressed={lang === l}
      title={title}
      className={cx(
        'rounded-full px-2 py-0.5 text-[12.5px] font-semibold transition-colors duration-150',
        lang === l
          ? onArt ? 'bg-white text-ink' : 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line)]'
          : onArt ? 'text-white/75 hover:text-white' : 'text-ink-3 hover:text-ink',
      )}
    >
      {label}
    </button>
  )
  const other = lang === 'ja' ? 'zh' : 'ja'
  return (
    <>
      {/* 小屏上只放一个键，点了换到另一种，给导航留位置 */}
      <button
        type="button"
        onClick={() => setLang(other)}
        title={other === 'zh' ? '卡名和效果改用中文' : '卡名和效果改用日文原文'}
        aria-label={other === 'zh' ? '游戏文字改用中文' : '游戏文字改用日文'}
        className={cx('rounded-full px-2 py-0.5 text-[12.5px] font-semibold sm:hidden', onArt ? 'bg-white/16 text-white' : 'bg-surface-2 text-ink-2 hover:text-ink')}
      >
        {other === 'zh' ? '中' : '日'}
      </button>
      <div role="group" aria-label="游戏文字语言" className={cx('hidden items-center gap-0.5 rounded-full p-0.5 sm:flex', onArt ? 'bg-white/14' : 'bg-surface-2')}>
        {opt('zh', '中', '卡名和效果用中文（学マス汉化插件的翻译）')}
        {opt('ja', '日', '卡名和效果用游戏原文（日文）')}
      </div>
    </>
  )
}

export function Layout() {
  const me = useApi<{ user: string; avatar?: string }>('api/me')
  useEffect(() => {
    const f = () => me.reload()
    window.addEventListener('gkb-auth', f)
    return () => window.removeEventListener('gkb-auth', f)
  }, [me.reload])
  const { home, onArt } = useOnArt()
  const { pathname } = useLocation()
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <BootSplash />
      <header className={cx('sticky top-0 z-40 border-b transition-colors duration-200', onArt ? 'border-transparent bg-transparent' : 'border-line bg-surface')}>
        <div>
          <div className="mx-auto flex h-13 max-w-[1320px] items-center gap-3 px-4 sm:gap-5 sm:px-5">
            <Link to="/" className={cx('flex shrink-0 items-baseline gap-2 whitespace-nowrap transition-colors duration-200', onArt ? 'text-white' : 'text-ink')}>
              {/* 三色小标：Vo 粉、Da 蓝、Vi 黄 */}
              <span className="flex gap-[2px] self-center" aria-hidden>
                <span className="h-4 w-1 -skew-x-12 rounded-[1px] bg-vo" />
                <span className="h-4 w-1 -skew-x-12 rounded-[1px] bg-da" />
                <span className="h-4 w-1 -skew-x-12 rounded-[1px] bg-vi" />
              </span>
              <span className="text-[16px] leading-none font-bold tracking-tight sm:text-[17px]">初星攻略站</span>
              <span className={cx('disp hidden text-[13px] leading-none tracking-wide not-italic md:inline', onArt ? 'text-white/60' : 'text-ink-3')}>gakumas-bench</span>
            </Link>
            <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] sm:gap-1">
              {nav.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={(s) => cx(pill(onArt)({ isActive: s.isActive || !!n.also?.some((p) => pathname.startsWith(p)) }), 'wide' in n && 'max-sm:hidden')}>
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <LangSwitch onArt={onArt} />
              <a
                href="https://github.com/matto49/gakumas-bench"
                target="_blank"
                rel="noreferrer"
                aria-label="源代码（GitHub）"
                title="源代码（GitHub）"
                className={cx(pill(onArt)({ isActive: false }), 'inline-flex items-center px-2 sm:px-2')}
              >
                <GithubMark size={17} />
              </a>
              <NavLink to="/me" aria-label={me.data?.user ?? '登录'} className={(s) => cx(pill(onArt)(s), 'inline-flex items-center gap-1.5')}>
                {me.data?.avatar ? <img src={me.data.avatar} alt="" width={18} height={18} className="size-[18px] rounded-full" /> : <UserRound size={14} aria-hidden />}
                <span className="hidden sm:inline">{me.data?.user ?? '登录'}</span>
              </NavLink>
            </div>
          </div>
        </div>
      </header>
      <main className={cx('mx-auto w-full max-w-[1320px] flex-1 px-5 pb-16', home ? 'pt-0' : 'pt-7')}>
        <Outlet />
      </main>
      <footer className="border-t border-line bg-surface-2">
        <div className="mx-auto flex max-w-[1320px] flex-wrap gap-x-6 gap-y-1 px-5 py-5 text-[12px] text-ink-3">
          <span>裁判：<a href="https://github.com/yuzeis/GKMSProject" className="hover:text-brand-ink">GKMS</a> 原生核心</span>
          <span><Link to="/about" className="hover:text-brand-ink">关于本站</Link></span>
          <span><a href="https://github.com/matto49/gakumas-bench" className="hover:text-brand-ink">源代码</a></span>
          <span>
            中文卡名和效果：<a href="https://github.com/imas-tools/gakumas-master-translation" className="hover:text-brand-ink">学マス汉化插件的翻译数据</a>
          </span>
          <span>友链：<a href="https://idol-master.top/" target="_blank" rel="noopener" className="hover:text-brand-ink">IMSWeb 偶像大师交流站</a></span>
          <span>卡面、图标等游戏素材归各自权利人所有，这里只作研究用。</span>
        </div>
      </footer>
    </div>
  )
}
