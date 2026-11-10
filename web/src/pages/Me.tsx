import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, CircleAlert, Loader2, LogOut, Upload } from 'lucide-react'
import { api, ApiError, BASE, type Job } from '../lib/api'
import { useApi } from '../lib/hooks'
import { when } from '../lib/format'
import { SET_INFO } from '../lib/game'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Code, CodeBlock, cx, Empty, ErrorState, ModeBadge, PageHeader, SectionTitle, TableSkeleton } from '../components/ui'

type MyRun = { run: string; label: string; set: string; kind?: string; mode?: string; uploaded?: string; finished?: string; started?: string; episodes?: number; verified?: { accepted: number; rejected?: number }; privileged?: boolean }

export function Me() {
  const me = useApi<{ user: string; engine: { rules_version?: number } }>('api/me')
  if (me.loading && !me.data) return <TableSkeleton rows={4} />
  if (me.error instanceof ApiError && me.error.status === 401) return <Login onDone={me.reload} />
  if (me.error) return <ErrorState error={me.error} onRetry={me.reload} />
  return <Dashboard user={me.data!.user} />
}

function Login({ onDone }: { onDone: () => void }) {
  const [tok, setTok] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await api(`api/me?token=${encodeURIComponent(tok.trim())}`)
      onDone()
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 401 ? '令牌不对，检查有没有多复制空格或换行。' : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="max-w-[560px] py-6">
      <PageHeader title="登录" sub="看排行和复盘不用登录。交成绩、托管跑要令牌。" />
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="mb-1 block font-medium text-ink">令牌</span>
          <Input
            type="password"
            autoComplete="off"
            value={tok}
            onChange={(e) => setTok(e.target.value)}
            className="h-10 font-mono"
            placeholder="粘贴令牌"
          />
        </label>
        {err && <p className="text-critical">{err}</p>}
        <Button type="submit" disabled={!tok.trim() || busy}>
          {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}登录
        </Button>
        <p className="text-[12.5px] text-ink-3">令牌存在这个浏览器的 cookie 里，180 天有效。没有令牌找管理员要。</p>
      </form>
    </div>
  )
}

function Dashboard({ user }: { user: string }) {
  const runs = useApi<MyRun[]>('api/me/runs')
  const [jobs, setJobs] = useState<Job[]>([])
  const refreshJobs = () => api<Job[]>('api/me/jobs').then(setJobs).catch(() => {})
  useEffect(() => {
    refreshJobs()
  }, [])
  const active = jobs.some((j) => j.status === 'queued' || j.status === 'running')
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => {
      refreshJobs()
    }, 2000)
    return () => clearInterval(t)
  }, [active])
  const prevActive = useRef(active)
  useEffect(() => {
    if (prevActive.current && !active) runs.reload()
    prevActive.current = active
  }, [active])

  const logout = async () => {
    await fetch(`${BASE}api/logout`, { method: 'POST' })
    location.reload()
  }

  return (
    <div>
      <PageHeader
        title={`我的 · ${user}`}
        right={
          <Button variant="outline" size="sm" onClick={logout}>
            <LogOut size={14} aria-hidden />退出
          </Button>
        }
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {jobs.length > 0 && (
            <section className="mb-8">
              <SectionTitle>上传核对</SectionTitle>
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                {jobs.map((j) => <JobRow key={j.job} j={j} />)}
              </ul>
            </section>
          )}
          <section>
            <SectionTitle>我的运行</SectionTitle>
            {runs.error && <ErrorState error={runs.error} onRetry={runs.reload} />}
            {runs.loading && !runs.data && <TableSkeleton rows={4} />}
            {runs.data && runs.data.length === 0 && (
              <Empty>还没有成绩。右边可以上传，也可以用命令行交。</Empty>
            )}
            {runs.data && runs.data.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full min-w-[640px] border-collapse text-[13px]">
                  <thead className="border-b border-line bg-surface-2 text-[12.5px] text-ink-2">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium">运行</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">题集</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">方式</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">局数</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...runs.data].reverse().map((r) => (
                      <tr key={r.run} className="border-b border-line last:border-0 hover:bg-brand-tint">
                        <td className="px-3 py-2">
                          <Link to={`/runs/${r.run}`} className="font-semibold text-ink hover:text-brand-ink">{r.label}</Link>
                          <div className="font-mono text-[11px] text-ink-3">{r.run}</div>
                        </td>
                        <td className="px-3 py-2 text-ink-2">{SET_INFO[r.set]?.title ?? r.set}</td>
                        <td className="px-3 py-2"><ModeBadge mode={r.mode} privileged={!!r.privileged} /></td>
                        <td className="num px-3 py-2 text-right">
                          {r.verified ? <>{r.verified.accepted}{(r.verified.rejected ?? 0) > 0 && <span className="text-critical"> / 拒 {r.verified.rejected}</span>}</> : r.episodes ?? '—'}
                        </td>
                        <td className="num px-3 py-2 text-right text-ink-2">{when(r.uploaded ?? r.finished ?? r.started)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
        <aside className="space-y-8">
          <SaveUploadForm onStarted={refreshJobs} />
          <UploadForm onStarted={refreshJobs} />
          <section>
            <SectionTitle>命令行</SectionTitle>
            <p className="mb-2 text-ink-2">令牌存进 <Code>~/.config/gkbench/token</Code>（权限 600）：</p>
            <CodeBlock>{`python -m gkbench run --set hif-live --algo uinet
python -m gkbench upload <运行目录>
python -m gkbench eval --set hif-live --algo uinet`}</CodeBlock>
            <p className="mt-2 text-[12.5px] text-ink-3">服务器默认 https://hiro.matto.top/gkbench，用 <Code>GKBENCH_SERVER</Code> 改。</p>
          </section>
        </aside>
      </div>
    </div>
  )
}

function JobRow({ j }: { j: Job }) {
  const pct = j.total ? Math.round((j.done / j.total) * 100) : 0
  const running = j.status === 'queued' || j.status === 'running'
  const icon = running ? <Loader2 size={15} className="animate-spin text-ink-2" aria-hidden /> : j.status === 'done' ? <CheckCircle2 size={15} className="text-good" aria-hidden /> : <CircleAlert size={15} className="text-critical" aria-hidden />
  const text = { queued: '排队中', running: '核对中', done: '完成', rejected: '全部拒收', error: '出错' }[j.status]
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-medium text-ink">{text}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-3">{j.run}</span>
        <span className="num text-[12.5px] text-ink-2">{j.done} / {j.total || '?'} · 收下 {j.accepted}</span>
      </div>
      {running && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
      )}
      {j.error && <p className="mt-1 text-[12.5px] text-critical">{j.error}</p>}
      {j.rejected.length > 0 && (
        <details className="mt-1.5 text-[12.5px]">
          <summary className="cursor-pointer text-ink-2">拒收 {j.rejected.length} 局，看原因</summary>
          <ul className="mt-1 space-y-0.5 pl-4 text-ink-2">
            {j.rejected.slice(0, 20).map((r, i) => <li key={i}><span className="font-mono text-[11.5px]">{r.id}{r.seed_index != null ? ` #${r.seed_index}` : ''}{r.answer != null && r.answer >= 0 ? ` 答 ${r.answer}` : ''}</span>：{r.reason}</li>)}
          </ul>
        </details>
      )}
    </li>
  )
}

function UploadForm({ onStarted }: { onStarted: () => void }) {
  const [runFile, setRunFile] = useState<File | null>(null)
  const [epFile, setEpFile] = useState<File | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!runFile || !epFile) return
    setBusy(true)
    setMsg(null)
    const fd = new FormData()
    fd.append('run_json', runFile)
    fd.append('episodes', epFile)
    try {
      const r = await fetch(`${BASE}api/runs`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.detail ?? `${r.status}`)
      setMsg(null)
      toast.success('已收下，正在核对', { description: '进度看左边「上传核对」。' })
      onStarted()
    } catch (err) {
      setMsg({ ok: false, text: `上传失败：${(err as Error).message}` })
      toast.error('上传失败', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const file = 'block w-full text-[12.5px] text-ink-2 file:mr-3 file:h-8 file:rounded-full file:border file:border-line-strong file:bg-surface file:px-3 file:text-ink hover:file:bg-surface-2'
  return (
    <section>
      <SectionTitle>上传本地运行</SectionTitle>
      <p className="mb-3 text-ink-2">本地跑完后输出目录里的两个文件。服务器按种子逐局重放，对不上的局拒收。</p>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-ink"><Code>run.json</Code></span>
          <input type="file" accept=".json,application/json" onChange={(e) => setRunFile(e.target.files?.[0] ?? null)} className={file} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-ink"><Code>episodes.jsonl.zst</Code></span>
          <input type="file" accept=".zst" onChange={(e) => setEpFile(e.target.files?.[0] ?? null)} className={file} />
        </label>
        <Button type="submit" disabled={!runFile || !epFile || busy}>
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />}上传
        </Button>
        {msg && <p className={cx('text-[12.5px]', msg.ok ? 'text-ink-2' : 'text-critical')}>{msg.text}</p>}
      </form>
    </section>
  )
}

/** 上传审查存档（gkms.audition_save.v2）：只要路线，服务器按编号找题和种子、逐条重放生成记录 */
function SaveUploadForm({ onStarted }: { onStarted: () => void }) {
  const [files, setFiles] = useState<FileList | null>(null)
  const [label, setLabel] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!files?.length) return
    setBusy(true)
    setMsg(null)
    const fd = new FormData()
    for (const f of Array.from(files)) fd.append('saves', f)
    if (label.trim()) fd.append('label', label.trim())
    try {
      const r = await fetch(`${BASE}api/saves`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.detail ?? `${r.status}`)
      setMsg(null)
      toast.success('已收下，正在逐条重放', { description: '进度看左边「上传核对」。' })
      onStarted()
    } catch (err) {
      setMsg({ ok: false, text: `上传失败：${(err as Error).message}` })
      toast.error('上传失败', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <section>
      <SectionTitle>上传审查存档</SectionTitle>
      <p className="mb-3 text-ink-2">
        <Code>.gksave.json</Code> 或 JSON Lines，每条答只要路线。服务器按编号找到题和种子逐条重放；题模板的答要带 <Code>exam</Code>。一张算法表算一次运行，标「自报」。
      </p>
      <form onSubmit={submit} className="space-y-3">
        <input type="file" multiple accept=".json,.jsonl,application/json" onChange={(e) => setFiles(e.target.files)}
          className="block w-full text-[12.5px] text-ink-2 file:mr-3 file:h-8 file:rounded-full file:border file:border-line-strong file:bg-surface file:px-3 file:text-ink hover:file:bg-surface-2" />
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="运行名（不填就用算法名）"
          className="h-9" />
        <Button type="submit" disabled={!files?.length || busy}>
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />}上传存档
        </Button>
        {msg && <p className={cx('text-[12.5px]', msg.ok ? 'text-ink-2' : 'text-critical')}>{msg.text}</p>}
      </form>
    </section>
  )
}
