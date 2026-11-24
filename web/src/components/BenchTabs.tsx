import { NavLink } from 'react-router-dom'
import { cx } from './ui'

/** 顶栏把「算法排行」和「試験集合」并成一项（2026-11-20），两页顶上用这一排切换 */
export function BenchTabs() {
  const tab = ({ isActive }: { isActive: boolean }) =>
    cx(
      'rounded-full px-4 py-1.5 text-[13.5px] font-semibold whitespace-nowrap transition-colors duration-150',
      isActive ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(20,16,30,.08),inset_0_0_0_1px_var(--color-line)]' : 'text-ink-2 hover:text-ink',
    )
  return (
    <nav aria-label="算法排行和試験集合" className="mb-5 inline-flex gap-0.5 rounded-full bg-surface-2 p-1">
      <NavLink to="/sets" className={tab}>算法排行</NavLink>
      <NavLink to="/exams" className={tab}>試験集合</NavLink>
    </nav>
  )
}
