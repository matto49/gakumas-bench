import { NavLink } from 'react-router-dom'
import { spriteUrl, useCatalog, useTerms } from '../../lib/catalog'
import { stagePlan, type ContestStage } from '../../lib/contest'
import { cx, Tip } from '../ui'

/** 竞技场页内切换：模拟器 / 舞台 / 比较 */
export function ContestTabs() {
  const tab = ({ isActive }: { isActive: boolean }) =>
    cx(
      'rounded-full px-4 py-1.5 text-[13.5px] font-semibold whitespace-nowrap transition-colors duration-150',
      isActive ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(20,16,30,.08),inset_0_0_0_1px_var(--color-line)]' : 'text-ink-2 hover:text-ink',
    )
  return (
    <nav aria-label="竞技场" className="mb-5 inline-flex gap-0.5 rounded-full bg-surface-2 p-1">
      <NavLink to="/contest" end className={tab}>模拟器</NavLink>
      <NavLink to="/contest/stages" className={tab}>舞台</NavLink>
      <NavLink to="/contest/compare" className={tab}>比较</NavLink>
    </nav>
  )
}

/** 舞台的审查基准：Vo / Da / Vi 三段比例条，每段写字，不只靠颜色 */
export function StageBar({ stage, className }: { stage: ContestStage; className?: string }) {
  const sum = stage.vocal + stage.dance + stage.visual || 1
  const segs = [
    ['Vo', stage.vocal, 'bg-vo'],
    ['Da', stage.dance, 'bg-da'],
    ['Vi', stage.visual, 'bg-vi'],
  ] as const
  return (
    <span role="img" title={`审查基准 Vo ${stage.vocal} · Da ${stage.dance} · Vi ${stage.visual}`} aria-label={`审查基准 Vo ${stage.vocal}，Da ${stage.dance}，Vi ${stage.visual}`}
      className={cx('flex h-2 w-full min-w-16 gap-0.5 overflow-hidden rounded-full', className)}>
      {segs.map(([k, v, c]) => (
        <span key={k} className={cx('h-full rounded-full', c)} style={{ width: `${(v / sum) * 100}%` }} />
      ))}
    </span>
  )
}

/** 舞台的计划（Common 写「通用」） */
export function PlanText({ stage }: { stage: ContestStage }) {
  const terms = useTerms()
  const p = stagePlan(stage)
  return <>{p ? (terms.plan as Record<string, string>)[p] ?? p : '通用'}</>
}

/** 舞台自带的 P 道具：小图标，悬停看名字和效果 */
export function StageItems({ ids }: { ids: string[] }) {
  const cat = useCatalog()
  if (!ids.length) return <span className="text-ink-3">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {ids.map((id) => {
        const it = cat?.items[id]
        return (
          <Tip key={id} wide tip={<><b>{it?.name ?? id}</b>{it?.text && <span className="mt-1 block whitespace-pre-line">{it.text}</span>}</>}>
            {it?.asset ? <img src={spriteUrl(it.asset)} alt={it.name} width={26} height={26} className="size-[26px] rounded-md bg-surface-3" /> : <span className="rounded bg-surface-3 px-1.5 text-[11.5px]">{it?.name ?? id}</span>}
          </Tip>
        )
      })}
    </span>
  )
}
