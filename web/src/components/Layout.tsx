import { NavLink, Outlet, Link } from 'react-router-dom'
import { UserRound } from 'lucide-react'
import { useApi } from '../lib/hooks'
import { cx } from './ui'

const nav = [
  { to: '/', label: '介绍', end: true },
  { to: '/sets', label: '排行' },
  { to: '/compare', label: '对比' },
]

export function Layout() {
  const me = useApi<{ user: string }>('api/me')
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/92 backdrop-blur-sm">
        <div className="mx-auto flex h-12 max-w-[1320px] items-center gap-6 px-5">
          <Link to="/" className="flex items-baseline gap-2 text-ink">
            <span className="text-[15px] font-semibold tracking-tight">gakumas-bench</span>
            <span className="hidden text-[12px] text-muted sm:inline">学マス考试出牌算法评测</span>
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cx('rounded-md px-2.5 py-1 text-[13.5px] transition-colors duration-150', isActive ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <NavLink
              to="/me"
              className={({ isActive }) => cx('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px]', isActive ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-surface-2')}
            >
              <UserRound size={14} aria-hidden />
              {me.data?.user ?? '登录'}
            </NavLink>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1320px] px-5 pt-6 pb-16">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-[1320px] border-t border-line px-5 py-6 text-[12px] text-muted">
        规则引擎：GKMS 原生核心（github.com/yuzeis/GKMSProject）。卡面、图标等游戏素材的权利属于各自的权利人，仅供研究。
      </footer>
    </div>
  )
}
