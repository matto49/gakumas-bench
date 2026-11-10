import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-[18px] font-semibold text-ink">没有这一页</p>
      <p className="mt-2 text-ink-2">
        链接可能写错了。回 <Link to="/sets" className="text-brand-ink underline underline-offset-2">排行</Link> 看看。
      </p>
    </div>
  )
}
