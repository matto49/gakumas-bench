import { useEffect } from 'react'
import { NavLink, Outlet, Link } from 'react-router-dom'
import { UserRound } from 'lucide-react'
import { useApi } from '../lib/hooks'
import { cx } from './ui'

const nav = [
  { to: '/', label: '首页', end: true },
  { to: '/sets', label: '排行' },
  { to: '/compare', label: '对比' },
]

const pill = ({ isActive }: { isActive: boolean }) =>
  cx(
    'rounded-full px-2.5 py-1 text-[13.5px] font-semibold whitespace-nowrap transition-colors duration-150 sm:px-3',
    isActive ? 'bg-surface text-brand-ink shadow-[0_1px_0_oklch(0.4_0.15_38/0.4)]' : 'text-white/95 hover:bg-white/15',
  )

export function Layout() {
  const me = useApi<{ user: string; avatar?: string }>('api/me')
  useEffect(() => {
    const f = () => me.reload()
    window.addEventListener('gkb-auth', f)
    return () => window.removeEventListener('gkb-auth', f)
  }, [me.reload])
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <header className="sticky top-0 z-40 bg-brand-deep text-white">
        <div className="stripes">
          <div className="mx-auto flex h-13 max-w-[1320px] items-center gap-3 px-4 sm:gap-5 sm:px-5">
            <Link to="/" className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
              <span className="disp text-[18px] leading-none tracking-wide not-italic sm:text-[21px]">gakumas-bench</span>
              <span className="hidden text-[12px] text-white/85 md:inline">学マス出牌算法排行</span>
            </Link>
            <nav className="flex items-center gap-0.5 sm:gap-1">
              {nav.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={pill}>
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto">
              <NavLink to="/me" className={(s) => cx(pill(s), 'inline-flex items-center gap-1.5')}>
                {me.data?.avatar ? <img src={me.data.avatar} alt="" width={18} height={18} className="size-[18px] rounded-full" /> : <UserRound size={14} aria-hidden />}
                {me.data?.user ?? '登录'}
              </NavLink>
            </div>
          </div>
        </div>
        <div className="h-[3px] bg-[linear-gradient(90deg,var(--color-vo)_0_33.3%,var(--color-da)_33.3%_66.6%,var(--color-vi)_66.6%)]" aria-hidden />
      </header>
      <main className="mx-auto w-full max-w-[1320px] flex-1 px-5 pt-7 pb-16">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-surface-2">
        <div className="mx-auto flex max-w-[1320px] flex-wrap gap-x-6 gap-y-1 px-5 py-5 text-[12px] text-ink-3">
          <span>裁判：<a href="https://github.com/yuzeis/GKMSProject" className="hover:text-brand-ink">GKMS</a> 原生核心</span>
          <span><a href="https://github.com/matto49/gakumas-bench" className="hover:text-brand-ink">源代码</a></span>
          <span>卡面、图标等游戏素材归各自权利人所有，这里只作研究用。</span>
        </div>
      </footer>
    </div>
  )
}
