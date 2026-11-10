import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, CircleAlert, Copy, KeyRound, Loader2, LogOut, Trash2 } from 'lucide-react'
import { api, ApiError, BASE, type Job } from '../lib/api'
import { useApi } from '../lib/hooks'
import { when } from '../lib/format'
import { useSetTitle } from '../lib/sets'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { useRowLink, btn, Code, CodeBlock, cx, Empty, ErrorState, ModeBadge, PageHeader, SectionTitle, TableSkeleton } from '../components/ui'

type MyRun = { run: string; label: string; set: string; kind?: string; mode?: string; uploaded?: string; finished?: string; started?: string; episodes?: number; verified?: { accepted: number; rejected?: number }; privileged?: boolean }

type MeInfo = { user: string; has_password?: boolean; github?: string; name?: string; avatar?: string; engine: { rules_version?: number } }

export function Me() {
  const me = useApi<MeInfo>('api/me')
  if (me.loading && !me.data) return <TableSkeleton rows={4} />
  const onLogin = () => {
    me.reload()
    window.dispatchEvent(new Event('gkb-auth')) // 让顶栏刷新登录状态
  }
  if (me.error instanceof ApiError && me.error.status === 401) return <Login onDone={onLogin} />
  if (me.error) return <ErrorState error={me.error} onRetry={me.reload} />
  return <Dashboard me={me.data!} />
}

const GithubMark = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
)

/** 登录表单。next：GitHub 登录回来后落到哪一页（站内路径） */
export function Login({ onDone, next = '/me' }: { onDone: () => void; next?: string }) {
  const auth = useApi<{ github: boolean }>('api/auth')
  const [err, setErr] = useState(() => new URLSearchParams(location.search).get('login_error') ?? '')
  return (
    <div className="max-w-[440px] py-6">
      <PageHeader title="登录" sub="看排行和复盘不用登录。交成绩、托管跑要登录。" />
      {err && <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-critical">{err}</p>}
      {auth.data?.github !== false && (
        <>
          <a href={`${BASE}api/auth/github?next=${encodeURIComponent(next)}`} className={cx(btn.primary, 'h-10 w-full')}>
            <GithubMark /> 用 GitHub 登录
          </a>
          <p className="mt-2 text-[12.5px] text-ink-3">推荐。第一次登录自动建账号，用户名取 GitHub 名，只读公开信息。</p>
          <div className="my-6 flex items-center gap-3 text-[12px] text-ink-3">
            <span className="h-px flex-1 bg-line" />或者用用户名<span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      <Tabs defaultValue="login">
        <TabsList className="mb-4 w-full">
          <TabsTrigger value="login">登录</TabsTrigger>
          <TabsTrigger value="register">注册</TabsTrigger>
        </TabsList>
        <TabsContent value="login"><PasswordAuth mode="login" onDone={onDone} onError={setErr} /></TabsContent>
        <TabsContent value="register"><PasswordAuth mode="register" onDone={onDone} onError={setErr} /></TabsContent>
      </Tabs>
      <details className="mt-6">
        <summary className="cursor-pointer text-[13px] text-ink-2 hover:text-brand-ink">已经有命令行令牌？粘贴登录</summary>
        <TokenLogin onDone={onDone} />
      </details>
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-3">{hint}</span>}
    </label>
  )
}

function PasswordAuth({ mode, onDone, onError }: { mode: 'login' | 'register'; onDone: () => void; onError: (m: string) => void }) {
  const [user, setUser] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const reg = mode === 'register'
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg('')
    onError('')
    if (reg && pw !== pw2) return setMsg('两次输入的密码不一样')
    setBusy(true)
    try {
      await api(`api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ user: user.trim(), password: pw }) })
      if (reg) toast.success('注册好了', { description: '已经登录。记好密码：没有邮箱，忘了找不回。' })
      onDone()
    } catch (err) {
      setMsg((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="用户名" hint={reg ? '3–24 位，小写字母、数字、_ 和 -。会显示在排行上。' : undefined}>
        <Input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" className="h-10" required />
      </Field>
      <Field label="密码" hint={reg ? '至少 8 位。' : undefined}>
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={reg ? 'new-password' : 'current-password'} className="h-10" required />
      </Field>
      {reg && (
        <Field label="再输一次密码">
          <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" className="h-10" required />
        </Field>
      )}
      {msg && <p className="text-[13px] text-critical">{msg}</p>}
      <Button type="submit" className="h-10 w-full" disabled={busy || !user.trim() || !pw}>
        {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}{reg ? '注册并登录' : '登录'}
      </Button>
      {reg && <p className="text-[12px] text-ink-3">没有邮箱，忘了密码找不回。想省心就用上面的 GitHub 登录。</p>}
    </form>
  )
}

function TokenLogin({ onDone }: { onDone: () => void }) {
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
    <form onSubmit={submit} className="mt-3 space-y-3">
      <Input type="password" autoComplete="off" aria-label="令牌" value={tok} onChange={(e) => setTok(e.target.value)} className="h-10 font-mono" placeholder="粘贴令牌" />
      {err && <p className="text-[13px] text-critical">{err}</p>}
      <Button type="submit" variant="outline" disabled={!tok.trim() || busy}>
        {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}登录
      </Button>
    </form>
  )
}

function Dashboard({ me }: { me: MeInfo }) {
  const rowLink = useRowLink()
  const user = me.user
  const setTitle = useSetTitle()
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
        title={
          <span className="inline-flex items-center gap-2.5">
            {me.avatar && <img src={me.avatar} alt="" width={30} height={30} className="size-[30px] rounded-full ring-1 ring-line" />}
            我的 · {user}
            {me.github && me.github.toLowerCase() !== user && <span className="text-[13px] font-normal text-ink-3">GitHub @{me.github}</span>}
          </span>
        }
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
              <Empty>还没有成绩。怎么交见 <Link to="/#join" className="text-brand-ink underline underline-offset-2">首页的「交成绩」</Link>。</Empty>
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
                      <tr key={r.run} {...rowLink(`/runs/${r.run}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-brand-tint">
                        <td className="px-3 py-2">
                          <Link to={`/runs/${r.run}`} className="font-semibold text-ink hover:text-brand-ink">{r.label}</Link>
                          <div className="font-mono text-[11px] text-ink-3">{r.run}</div>
                        </td>
                        <td className="px-3 py-2 text-ink-2">{setTitle(r.set)}</td>
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
          <CliTokens />
          <PasswordForm has={!!me.has_password} />
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

type CliToken = { id: string; name: string; kind: string; created?: string }

/** 命令行令牌：自己生成、自己吊销；明文只在生成时显示一次 */
function CliTokens() {
  const list = useApi<CliToken[]>('api/me/tokens')
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api<{ token: string; name: string }>('api/me/tokens', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })
      setFresh(r)
      setName('')
      list.reload()
    } catch (err) {
      toast.error('生成失败', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const revoke = async (t: CliToken) => {
    if (!confirm(`吊销「${t.name}」？用它的命令行会立刻失效。`)) return
    try {
      await api(`api/me/tokens/${t.id}`, { method: 'DELETE' })
      toast.success(`已吊销「${t.name}」`)
      list.reload()
    } catch (err) {
      toast.error('吊销失败', { description: (err as Error).message })
    }
  }
  const copy = async () => {
    if (!fresh) return
    await navigator.clipboard.writeText(fresh.token)
    toast.success('已复制')
  }
  return (
    <section>
      <SectionTitle>命令行令牌</SectionTitle>
      <p className="mb-3 text-ink-2">本地跑分、托管评测用。存进 <Code>~/.config/gkbench/token</Code>（权限 600）。</p>
      {fresh && (
        <div className="mb-3 rounded-xl border border-brand/50 bg-brand-tint p-3">
          <p className="mb-2 text-[12.5px] font-semibold text-brand-ink">「{fresh.name}」的令牌只显示这一次，现在保存：</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-surface px-2 py-1.5 font-mono text-[12px] text-ink ring-1 ring-line">{fresh.token}</code>
            <Button size="sm" variant="outline" onClick={copy}><Copy size={13} aria-hidden />复制</Button>
          </div>
          <CodeBlock>{`mkdir -p ~/.config/gkbench && pbpaste > ~/.config/gkbench/token && chmod 600 ~/.config/gkbench/token`}</CodeBlock>
          <button onClick={() => setFresh(null)} className="mt-1 text-[12px] text-ink-3 hover:text-brand-ink">我存好了，收起</button>
        </div>
      )}
      <form onSubmit={create} className="mb-3 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="用途，比如：笔记本" aria-label="令牌用途" className="h-8" maxLength={40} />
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <KeyRound size={14} aria-hidden />}生成
        </Button>
      </form>
      {list.data && list.data.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {list.data.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-2">
              <KeyRound size={14} className="shrink-0 text-ink-3" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-ink">{t.name || (t.kind ? '未命名' : '管理员发放')}</span>
              <span className="num text-[12px] text-ink-3">{when(t.created)}</span>
              <Button size="icon-sm" variant="ghost" aria-label={`吊销 ${t.name}`} onClick={() => revoke(t)}>
                <Trash2 size={14} aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <CodeBlock>{`pip install "gkbench @ git+https://github.com/matto49/gakumas-bench"
python -m gkbench eval --set hif-live --algo my_algo.py:MyAlgo --parallel 3`}</CodeBlock>
      <p className="mt-2 text-[12.5px] text-ink-3">服务器默认 https://hiro.matto.top/gkbench，用 <Code>GKBENCH_SERVER</Code> 改。</p>
    </section>
  )
}

/** 设置 / 修改密码：GitHub 账号也能设，之后用户名 + 密码也能登录 */
function PasswordForm({ has }: { has: boolean }) {
  const [old, setOld] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [set, setSet] = useState(has)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api('api/me/password', { method: 'POST', body: JSON.stringify({ old, password: pw }) })
      toast.success(set ? '密码改好了' : '密码设好了', { description: '现在也能用用户名 + 密码登录。' })
      setOld('')
      setPw('')
      setSet(true)
    } catch (err) {
      toast.error('没改成', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <section>
      <SectionTitle>{set ? '修改密码' : '设置密码'}</SectionTitle>
      {!set && <p className="mb-3 text-ink-2">可选。设了以后，没有 GitHub 的电脑上也能用用户名 + 密码登录。</p>}
      <form onSubmit={submit} className="space-y-2">
        {set && <Input type="password" value={old} onChange={(e) => setOld(e.target.value)} placeholder="旧密码" aria-label="旧密码" autoComplete="current-password" className="h-9" />}
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="新密码，至少 8 位" aria-label="新密码" autoComplete="new-password" className="h-9" />
        <Button type="submit" size="sm" disabled={busy || pw.length < 8 || (set && !old)}>
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}{set ? '修改' : '设置'}
        </Button>
      </form>
    </section>
  )
}
