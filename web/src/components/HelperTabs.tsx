import { NavLink } from 'react-router-dom'
import { cx } from './ui'

/** 顶栏「游戏小助手」下的两个工具：出牌助手（/assist）、竞技场（/contest 及其子页） */
export function HelperTabs() {
  const tab = ({ isActive }: { isActive: boolean }) =>
    cx(
      'rounded-full px-4 py-1.5 text-[13.5px] font-semibold whitespace-nowrap transition-colors duration-150',
      isActive ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(20,16,30,.08),inset_0_0_0_1px_var(--color-line)]' : 'text-ink-2 hover:text-ink',
    )
  return (
    <nav aria-label="游戏小助手" className="mb-5 inline-flex gap-0.5 rounded-full bg-surface-2 p-1">
      <NavLink to="/assist" className={tab}>出牌助手</NavLink>
      <NavLink to="/contest" className={tab}>竞技场</NavLink>
    </nav>
  )
}
