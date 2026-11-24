import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ChevronDown, CircleAlert, Copy, KeyRound, Loader2, LogOut, Trash2 } from 'lucide-react'
import { runDisplay, type RunDisplayCatalog } from '../lib/runDisplay'
import { api, ApiError, BASE, type Job } from '../lib/api'
import { useApi } from '../lib/hooks'
import { when } from '../lib/format'
import { useSetTitle } from '../lib/sets'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { HomeBackdrop } from '../components/HomeBackdrop'
import { useRowLink, Code, GithubMark, CodeBlock, cx, Empty, ErrorState, ModeBadge, PageHeader, SectionTitle, TableSkeleton } from '../components/ui'

type MyRun = { run: string; by?: string; label: string; set: string; kind?: string; mode?: string; uploaded?: string; finished?: string; started?: string; episodes?: number; verified?: { accepted: number; rejected?: number }; privileged?: boolean }

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

/** 登录以后能做的事（登录页左栏），每条前面一道 Vo / Da / Vi 色的小斜杠 */
const PERKS: [string, string][] = [
  ['bg-vo', '把实战开局传到自己的試験集合，服务器核对后入库'],
  ['bg-da', '交出牌算法的成绩，在算法排行上署名'],
  ['bg-vi', '生成命令行令牌，本地跑分、托管评测'],
]

/** 站名字标：三道斜杠 + 「初星攻略站」（字体和配色同进站动画，见 index.css 的 .wordmark） */
function Wordmark({ small }: { small?: boolean }) {
  return (
    <div className={cx('flex items-center', small ? 'gap-2.5' : 'gap-3.5')} aria-label="初星攻略站">
      <span className={cx('flex items-end', small ? 'h-7 gap-[3px]' : 'h-10 gap-1')} aria-hidden>
        <i className={cx('block -skew-x-[16deg] rounded-[3px] bg-vo', small ? 'h-[22px] w-[6px]' : 'h-8 w-2')} />
        <i className={cx('block -skew-x-[16deg] rounded-[3px] bg-da', small ? 'h-7 w-[6px]' : 'h-10 w-2')} />
        <i className={cx('block -skew-x-[16deg] rounded-[3px] bg-vi', small ? 'h-5 w-[6px]' : 'h-7 w-2')} />
      </span>
      <span className={cx('wordmark', small ? 'text-[24px]' : 'text-[34px]')} aria-hidden>
        <b className="text-vo">初</b><b className="text-da">星</b><b className="text-vi">攻</b><b>略</b><b>站</b>
      </span>
    </div>
  )
}

/** 登录。单独打开（/me 没登录）时是暖白网点底上的一张卡：左边站名和登录后能做什么，右边表单；
 * embedded（命令行授权页里嵌着用）只出表单。next：GitHub 登录回来后落到哪一页（站内路径） */
export function Login({ onDone, next = '/me', embedded }: { onDone: () => void; next?: string; embedded?: boolean }) {
  const auth = useApi<{ github: boolean }>('api/auth')
  const [err, setErr] = useState(() => new URLSearchParams(location.search).get('login_error') ?? '')
  const form = (
    <div>
      {err && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-[color-mix(in_oklch,var(--color-critical)_8%,var(--color-surface))] px-3 py-2.5 text-[13px] text-critical">
          <CircleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />{err}
        </p>
      )}
      {auth.data?.github !== false && (
        <>
          <a
            href={`${BASE}api/auth/github?next=${encodeURIComponent(next)}`}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ink text-[14.5px] font-semibold text-surface shadow-[0_2px_0_oklch(0.08_0.005_60)] transition-colors hover:bg-[oklch(0.3_0.005_60)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:translate-y-px"
          >
            <GithubMark /> 用 GitHub 登录
          </a>
          <p className="mt-2 text-center text-[12.5px] text-ink-3">推荐：第一次登录自动建账号，只读公开信息</p>
          <div className="my-6 flex items-center gap-3 text-[12px] text-ink-3">
            <span className="h-px flex-1 bg-line" />或者用户名和密码<span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      <Tabs defaultValue="login">
        <TabsList className="mb-5 w-full">
          <TabsTrigger value="login">登录</TabsTrigger>
          <TabsTrigger value="register">注册</TabsTrigger>
        </TabsList>
        <TabsContent value="login"><PasswordAuth mode="login" onDone={onDone} onError={setErr} /></TabsContent>
        <TabsContent value="register"><PasswordAuth mode="register" onDone={onDone} onError={setErr} /></TabsContent>
      </Tabs>
      <details className="group mt-6 border-t border-line pt-4">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] text-ink-2 hover:text-brand-ink [&::-webkit-details-marker]:hidden">
          <KeyRound size={14} className="text-ink-3" aria-hidden />已经有命令行令牌？粘贴登录
          <ChevronDown size={14} className="ml-auto text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <TokenLogin onDone={onDone} />
      </details>
    </div>
  )
  if (embedded) return <div className="max-w-[420px] py-2">{form}</div>

  return (
    <div className="relative isolate -mt-7 -mb-16 flex min-h-[calc(100dvh-3.25rem)] items-start justify-center py-6 md:items-center md:py-16">
      <HomeBackdrop />
      <div className="grid w-full max-w-[880px] overflow-hidden rounded-2xl bg-surface shadow-[0_1px_0_rgba(0,0,0,.04),0_24px_50px_-24px_rgba(20,16,30,.35)] md:grid-cols-[1fr_1.08fr]">
        <section className="flex flex-col border-b border-line bg-surface-2 px-6 py-7 md:border-r md:border-b-0 md:px-9 md:py-10">
          <p className="disp text-[13px] font-semibold tracking-[0.2em] text-ink-3">HATSUBOSHI GUIDE</p>
          <div className="mt-2 md:mt-3"><span className="md:hidden"><Wordmark small /></span><span className="hidden md:block"><Wordmark /></span></div>
          <h1 className="mt-5 text-[20px] font-bold tracking-tight text-ink md:mt-8">登录</h1>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
            看强度榜、资料、算法排行都不用登录。<span className="hidden md:inline">登录以后可以：</span>
            <span className="md:hidden">登录以后可以传考试开局、交算法成绩、生成命令行令牌。</span>
          </p>
          <ul className="mt-4 hidden space-y-3 md:block">
            {PERKS.map(([c, t]) => (
              <li key={t} className="flex items-start gap-3 text-[13.5px] leading-snug text-ink">
                <span className={cx('mt-[3px] h-3.5 w-1 shrink-0 -skew-x-[16deg] rounded-[1px]', c)} aria-hidden />{t}
              </li>
            ))}
          </ul>
          <p className="mt-auto hidden pt-10 text-[12px] text-ink-3 md:block">用 GitHub 登录不申请任何权限，只记 GitHub 用户名、昵称和头像。</p>
        </section>
        <section className="px-6 py-7 md:px-9 md:py-10">{form}</section>
      </div>
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
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
    <form onSubmit={submit} className="space-y-4">
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
      <Button type="submit" className="mt-1 h-11 w-full text-[14.5px] disabled:bg-surface-3 disabled:text-ink-3 disabled:opacity-100" disabled={busy || !user.trim() || !pw}>
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
  const catalog = useApi<RunDisplayCatalog>('api/site/run-presentations').data
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
                          <Link to={`/runs/${r.run}`} title={runDisplay(catalog, r)?.name} className="font-semibold text-ink hover:text-brand-ink">{runDisplay(catalog, r)?.short ?? r.label}</Link>
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
python -m gkbench eval --set hif --algo my_algo.py:MyAlgo --parallel 3`}</CodeBlock>
      <p className="mt-2 text-[12.5px] text-ink-3">服务器默认 https://gakumas.wiki，用 <Code>GKBENCH_SERVER</Code> 改。</p>
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
