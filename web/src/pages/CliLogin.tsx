import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2, Terminal } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/hooks'
import { when } from '../lib/format'
import { Button } from '@/components/ui/button'
import { Empty, ErrorState, PageHeader, Skeleton } from '../components/ui'
import { Login } from './Me'

/** 命令行登录的授权页：`gkbench login` 打开这里，已登录的人核对代码后点授权，命令行就拿到一个令牌 */

type Info = { code: string; host: string; created: string; status: 'pending' | 'approved'; user: string }

export function CliLogin() {
  const [q] = useSearchParams()
  const code = (q.get('code') ?? '').toUpperCase()
  const info = useApi<Info>(code ? `api/cli/login/${encodeURIComponent(code)}` : null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  const approve = async () => {
    setBusy(true)
    setErr('')
    try {
      await api(`api/cli/login/${encodeURIComponent(code)}/approve`, { method: 'POST' })
      setDone(true)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const header = <PageHeader title="授权命令行" sub="一台电脑上的 gkbench login 想用你的账号。" />
  if (!code) return <>{header}<Empty>这一页要从终端里的 <span className="font-mono">gkbench login</span> 打开。</Empty></>
  if (info.loading && !info.data) return <>{header}<Skeleton className="h-40 max-w-[520px] rounded-xl" /></>
  if (info.error) {
    if (info.error instanceof ApiError && info.error.status === 404) return <>{header}<Empty>{info.error.message}</Empty></>
    return <>{header}<ErrorState error={info.error} onRetry={info.reload} /></>
  }
  const d = info.data!
  if (done || d.status === 'approved') {
    return (
      <>
        {header}
        <div className="flex max-w-[520px] items-start gap-3 rounded-xl border border-line bg-surface p-4">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-brand-ink" aria-hidden />
          <div className="text-[13.5px] leading-relaxed text-ink-2">
            <p className="font-semibold text-ink">已授权</p>
            <p>回到终端，gkbench 几秒内会显示已登录。这一页可以关了。</p>
            <p className="mt-1">以后不想让这台电脑再用，到 <Link to="/me" className="text-brand-ink underline-offset-2 hover:underline">我的</Link> 页的命令行令牌里吊销。</p>
          </div>
        </div>
      </>
    )
  }
  if (!d.user) {
    return (
      <>
        {header}
        <p className="max-w-[520px] rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">先登录，登录后回到这一页授权（代码 <span className="font-mono text-ink">{d.code}</span>）。</p>
        <Login onDone={info.reload} next={`/cli-login?code=${d.code}`} />
      </>
    )
  }
  return (
    <>
      {header}
      <div className="max-w-[520px] rounded-xl border border-line bg-surface p-5">
        <p className="text-[12.5px] text-ink-3">终端里显示的代码</p>
        <p className="mt-1 font-mono text-[30px] leading-none font-bold tracking-[0.12em] text-ink">{d.code}</p>
        <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <Terminal size={14} aria-hidden className="text-ink-3" />
          {d.host ? <>电脑 <span className="font-mono text-ink">{d.host}</span> · </> : null}{when(d.created)} 发起
        </p>
        <p className="mt-4 text-[13.5px] leading-relaxed text-ink-2">
          授权后，这台电脑上的 gkbench 能用你的账号 <span className="font-semibold text-ink">{d.user}</span> 传考试、交成绩。
          代码和终端里的一样再点授权；不是你自己刚运行的，直接关掉这一页。
        </p>
        {err && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-critical">{err}</p>}
        <Button className="mt-4" onClick={approve} disabled={busy}>
          {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}授权这台电脑
        </Button>
      </div>
    </>
  )
}
