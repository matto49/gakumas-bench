import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, BookOpen, ChevronRight, Copy, ExternalLink, FolderPlus, Layers, Loader2, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { DeckView } from '../components/DeckView'
import { toast } from 'sonner'
import { api, ApiError, BASE, type Job, type Problem, type SetInfo } from '../lib/api'
import { useApi } from '../lib/hooks'
import { idolShort, spriteUrl, useCatalog } from '../lib/catalog'
import { examLine, PLAN, SCENE_LABEL, sceneValueLabel } from '../lib/game'
import { setBlurbOf, setTitleOf, sortSets, useSets } from '../lib/sets'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select } from '../components/Select'
import { btn, Code, CodeBlock, Empty, ErrorState, Help, IdolThumb, PageHeader, SectionTitle, Skeleton, TableSkeleton, Tip } from '../components/ui'

/** 試験集合：收集来的考试集合。所有算法排行、托管评测都按集合选题。 */

type Me = { user: string; admin?: boolean }

function StatusBadge({ s }: { s?: string }) {
  return s === 'community'
    ? <Tip tip="社区集合：用户自己建、自己传题。管理员审核后可以升为官方。"><Badge tabIndex={0} variant="outline">社区</Badge></Tip>
    : <Tip tip="官方集合：管理员维护，首页和算法排行默认展示。"><Badge tabIndex={0} variant="brand">官方</Badge></Tip>
}

/** 场景分布：一行小标签，标签后是题数 */
function SceneChips({ scenes, keys = ['exam', 'plan'], idol }: { scenes?: Record<string, Record<string, number>>; keys?: string[]; idol: (id: string) => string }) {
  if (!scenes) return null
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
      {keys.map((k) => {
        const vals = Object.entries(scenes[k] ?? {}).sort((a, b) => b[1] - a[1])
        if (!vals.length) return null
        return (
          <span key={k} className="inline-flex flex-wrap items-center gap-1">
            <span className="text-ink-3">{SCENE_LABEL[k]}</span>
            {vals.slice(0, 6).map(([v, n]) => (
              <span key={v} className="inline-flex h-[20px] items-center gap-1 rounded-full bg-surface-2 px-2 text-ink-2">
                {sceneValueLabel(k, v, idol)}<span className="num text-ink-3">{n}</span>
              </span>
            ))}
            {vals.length > 6 && <span className="text-ink-3">等 {vals.length} 种</span>}
          </span>
        )
      })}
    </div>
  )
}

export function Exams() {
  const { sets, reload } = useSets()
  const me = useApi<Me>('api/me')
  const cat = useCatalog()
  const idol = (id: string) => idolShort(cat, id)
  const groups: [string, SetInfo[]][] = [
    ['官方集合', sortSets(sets ?? []).filter((s) => s.status !== 'community')],
    ['社区集合', sortSets(sets ?? []).filter((s) => s.status === 'community')],
  ]
  return (
    <div>
      <PageHeader
        title="試験集合"
        sub="收集来的考试集合，所有算法排行和托管评测都按集合选题。官方集合由管理员维护；登录后可以建自己的集合、上传考试。"
        right={me.data ? <NewSetDialog onDone={reload} /> : <Link to="/me" className={btn.secondary}>登录后建集合</Link>}
      />
      {!sets && <div className="grid gap-3 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}</div>}
      {groups.map(([title, list]) => (sets && (list.length > 0 || title === '官方集合')) && (
        <section key={title} className="mb-10">
          <SectionTitle>{title}</SectionTitle>
          {list.length === 0 ? <Empty>还没有。</Empty> : (
            <div className="grid gap-3 md:grid-cols-2">
              {list.map((s) => (
                <div key={s.set} className="group relative flex cursor-pointer flex-col gap-3 rounded-xl border border-line bg-surface p-4 transition-colors duration-150 hover:border-brand has-[a[data-card]:focus-visible]:border-brand has-[a[data-card]:focus-visible]:ring-2 has-[a[data-card]:focus-visible]:ring-ring">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {/* 整张卡可点：标题链接的遮罩铺满卡片；卡里另外能点的（算法数提示、算法排行）放在 z-10 */}
                      <Link to={`/exams/${s.set}`} data-card className="inline-flex flex-wrap items-center gap-2 text-[16px] font-bold text-ink outline-none group-hover:text-brand-ink after:absolute after:inset-0 after:rounded-xl after:content-['']">
                        {setTitleOf(sets, s.set)}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                        <span className="relative z-10 inline-flex cursor-default"><StatusBadge s={s.status} /></span>
                        <span className="font-mono">{s.set}</span>
                        {s.owner && <span>提交人 {s.owner}</span>}
                      </div>
                    </div>
                    <span className="flex shrink-0 -space-x-2">
                      {(s.idols ?? []).slice(0, 5).map((id) => <IdolThumb key={id} id={id} size={30} className="ring-2 ring-surface" />)}
                    </span>
                  </div>
                  {setBlurbOf(sets, s.set) && <p className="text-ink-2">{setBlurbOf(sets, s.set)}</p>}
                  <SceneChips scenes={s.scenes} idol={idol} />
                  <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-[12.5px] text-ink-3">
                    <span><span className="disp text-[16px] text-ink">{s.problems}</span> 题</span>
                    <Tip tip={s.algos?.length ? s.algos.join('、') : '还没有算法跑过'}>
                      <span tabIndex={0} className="relative z-10 cursor-default"><span className="disp text-[16px] text-ink">{s.algos?.length ?? 0}</span> 种算法跑过</span>
                    </Tip>
                    <span className="relative z-10 ml-auto flex gap-2">
                      <Link to={`/sets/${s.set}`} className={btn.small}>算法排行 <ArrowRight size={13} aria-hidden /></Link>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
      <section className="max-w-[46em] text-[12.5px] leading-relaxed text-ink-2">
        <p><span className="font-semibold text-ink">场景怎么分。</span>不靠手填：考试、阶段、轮次从编成的 <Code>produce_id</Code>、<Code>round</Code> 读，流派按偶像卡，机制和回合数由引擎算。</p>
        <p className="mt-1.5"><span className="font-semibold text-ink">种子。</span>每道题入库后自动配 32 个保密种子，算法托管跑；上传的固定种子题，种子另外记成固定种子。</p>
      </section>
    </div>
  )
}

function NewSetDialog({ onDone }: { onDone: () => void }) {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [blurb, setBlurb] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api<{ set: string }>('api/sets', { method: 'POST', body: JSON.stringify({ title, blurb }) })
      onDone()
      setOpen(false)
      toast.success('集合建好了', { description: '现在可以往里传考试。' })
      nav(`/exams/${r.set}`)
    } catch (err) {
      toast.error('没建成', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button><FolderPlus size={15} aria-hidden />新建集合</Button>} />
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>新建試験集合</DialogTitle>
            <DialogDescription>建好后往里传考试。社区集合有自己的算法排行；管理员审核后可以升为官方。</DialogDescription>
          </DialogHeader>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">名字</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} placeholder="比如：N.I.A 最终试验" className="h-9" required />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">说明（可选）</span>
            <Textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={300} placeholder="题从哪来、想测什么" rows={3} />
          </label>
          <DialogFooter>
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}建集合
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- 集合详情

const FILTER_KEYS = ['exam', 'stage', 'round', 'plan', 'mechanic', 'idol'] as const

export function ExamSet() {
  const { set = '' } = useParams()
  const { sets, reload: reloadSets } = useSets()
  const cat = useCatalog()
  const me = useApi<Me>('api/me')
  const probs = useApi<Problem[]>(`api/sets/${encodeURIComponent(set)}/problems`)
  const [q, setQ] = useSearchParams()
  const info = sets?.find((s) => s.set === set)
  const idol = (id: string) => idolShort(cat, id)
  const update = (patch: Record<string, string>) => {
    const n = new URLSearchParams(q)
    for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k))
    setQ(n, { replace: true })
  }
  const group = q.get('group') ?? ''

  const values = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const k of FILTER_KEYS) out[k] = Array.from(new Set((probs.data ?? []).map((p) => String(p.scene?.[k] ?? '')).filter(Boolean))).sort()
    return out
  }, [probs.data])
  const rows = useMemo(
    () => (probs.data ?? []).filter((p) => FILTER_KEYS.every((k) => !q.get(k) || String(p.scene?.[k] ?? '') === q.get(k))),
    [probs.data, q],
  )
  const grouped = useMemo(() => {
    if (!group) return [['', rows]] as [string, Problem[]][]
    const m = new Map<string, Problem[]>()
    for (const p of rows) {
      const k = String(p.scene?.[group as keyof typeof p.scene] ?? '（无）')
      m.set(k, [...(m.get(k) ?? []), p])
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows, group])

  if (sets && !info) return <ErrorState error={new ApiError(404, '没有这个集合')} />
  const canEdit = !!info?.can_edit
  const admin = !!me.data?.admin
  const review = async (status: 'official' | 'community') => {
    try {
      await api(`api/sets/${set}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      toast.success(status === 'official' ? '已升为官方集合' : '已退回社区集合')
      reloadSets()
    } catch (err) {
      toast.error('没改成', { description: (err as Error).message })
    }
  }
  const remove = async (p: Problem) => {
    if (!confirm(`从集合里删掉「${p.name}」？已有的成绩不受影响。`)) return
    try {
      await api(`api/sets/${set}/problems/${p.id}`, { method: 'DELETE' })
      toast.success('删掉了')
      probs.reload()
      reloadSets()
    } catch (err) {
      toast.error('没删成', { description: (err as Error).message })
    }
  }

  return (
    <div>
      <PageHeader
        crumb={<><Link to="/exams" className="hover:text-brand-ink">試験集合</Link> / {set}</>}
        title={<span className="inline-flex flex-wrap items-center gap-2.5">{setTitleOf(sets, set)}<StatusBadge s={info?.status} /></span>}
        sub={
          <>
            {setBlurbOf(sets, set)}
            {info && <span className="ml-1 text-ink-3">{info.problems} 题 · {info.algos?.length ?? 0} 种算法跑过{info.owner ? ` · 提交人 ${info.owner}` : ''}</span>}
          </>
        }
        right={
          <div className="flex flex-wrap gap-2">
            {admin && info && (info.status === 'community'
              ? <Button variant="outline" size="sm" onClick={() => review('official')}><ShieldCheck size={14} aria-hidden />审核通过，升为官方</Button>
              : info.owner && info.owner !== 'matto' && <Button variant="outline" size="sm" onClick={() => review('community')}>退回社区</Button>)}
            <Link to={`/sets/${set}`} className={btn.small}>算法排行 <ArrowRight size={13} aria-hidden /></Link>
          </div>
        }
      />

      {canEdit && <UploadPanel set={set} onDone={() => { probs.reload(); reloadSets() }} />}
      {!canEdit && me.data && info?.status !== 'community' && (
        <p className="mb-5 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
          官方集合由管理员维护。想加题？到 <Link to="/exams" className="text-brand-ink hover:underline">試験集合</Link> 建一个自己的集合上传，管理员审核后可以升为官方。
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {FILTER_KEYS.filter((k) => values[k].length > 1).map((k) => (
          <Select key={k} label={SCENE_LABEL[k]} value={q.get(k) ?? ''} onChange={(v) => update({ [k]: v })} width="14rem"
            options={[{ value: '', label: `全部${SCENE_LABEL[k]}` }, ...values[k].map((v) => ({
              value: v, label: sceneValueLabel(k, v, idol),
              icon: k === 'idol' ? <IdolThumb id={v} size={20} title={false} className="rounded-full" /> : undefined,
            }))]} />
        ))}
        <span className="inline-flex items-center gap-2 text-ink-2">
          分组
          <Select label="分组" value={group} onChange={(v) => update({ group: v })}
            options={[{ value: '', label: '不分' }, ...FILTER_KEYS.filter((k) => values[k].length > 1).map((k) => ({ value: k, label: `按${SCENE_LABEL[k]}` }))]} />
        </span>
        <span className="num ml-auto text-[12.5px] text-ink-3">{rows.length} 题</span>
      </div>

      {probs.error && <ErrorState error={probs.error} onRetry={probs.reload} />}
      {!probs.data && !probs.error && <TableSkeleton rows={8} />}
      {probs.data && rows.length === 0 && <Empty>{probs.data.length ? '没有符合筛选的题。' : canEdit ? '集合还是空的，用上面的面板传题。' : '集合还是空的。'}</Empty>}
      {rows.length > 0 && grouped.map(([g, list]) => (
        <section key={g} className="mb-5">
          {group && <SectionTitle className="mb-2">{sceneValueLabel(group, g, idol)} <span className="text-[13px] font-normal text-ink-3">{list.length} 题</span></SectionTitle>}
          <ProblemTable rows={list} canEdit={canEdit} onDelete={remove} />
        </section>
      ))}
    </div>
  )
}

function ProblemTable({ rows, canEdit, onDelete }: { rows: Problem[]; canEdit: boolean; onDelete: (p: Problem) => void }) {
  const cat = useCatalog()
  const [q, setQ] = useSearchParams()
  const openId = q.get('deck')
  const setOpen = (id: string) => { const n = new URLSearchParams(q); id ? n.set('deck', id) : n.delete('deck'); setQ(n, { replace: true }) }
  const opened = rows.find((p) => p.id === openId)
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[980px] border-collapse text-[13px]">
        <thead className="border-b border-line bg-surface-2 text-[12.5px] text-ink-2">
          <tr>
            <th scope="col" className="px-3 py-2.5 text-left font-semibold">偶像 · 题</th>
            <th scope="col" className="px-3 py-2.5 text-left font-semibold">考试</th>
            <th scope="col" className="px-3 py-2.5 text-left font-semibold">流派 · 机制</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">回合</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">牌组</th>
            <th scope="col" className="px-3 py-2.5 text-left font-semibold">P 道具</th>
            <th scope="col" className="px-3 py-2.5 text-left font-semibold">饮料</th>
            <th scope="col" className="px-3 py-2.5 text-left font-semibold"><span className="inline-flex items-center">题族<Help tip="题族编号 AF-：同一个开局（编成去掉种子）的编号。上传时按它去重。" /></span></th>
            <th scope="col" className="w-24 px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const sc = p.scene ?? {}
            return (
              <tr key={p.id} onClick={() => { if (!window.getSelection()?.toString()) setOpen(p.id) }} className="cursor-pointer border-b border-line last:border-0 hover:bg-brand-tint">
                <td className="max-w-[320px] px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    <IdolThumb id={sc.idol} size={30} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink" title={p.name}>{p.name}</p>
                      <p className="truncate text-[11.5px] text-ink-3">{sc.idol ? idolShort(cat, sc.idol) : ''}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-ink-2">
                  {examLine(sc.exam, sc.stage, sc.round)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-ink-2">{[sc.plan && (PLAN[sc.plan] ?? sc.plan), sc.mechanic && sceneValueLabel('mechanic', sc.mechanic)].filter(Boolean).join(' · ')}</td>
                <td className="num px-3 py-2 text-right whitespace-nowrap">{sc.turns ?? '—'}</td>
                <td className="num px-3 py-2 text-right whitespace-nowrap">{sc.deck ?? '—'} 张</td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {(sc.items ?? []).map((id, i) => {
                      const it = cat?.items[id]
                      return it?.asset
                        ? <Tip key={i} tip={<><b>{it.name}</b><br /><span className="whitespace-pre-line">{it.text}</span></>} wide><img tabIndex={0} src={spriteUrl(it.asset)} alt={it.name} width={22} height={22} className="size-[22px] object-contain" /></Tip>
                        : <span key={i} className="text-[11.5px] text-ink-3">{it?.name ?? id}</span>
                    })}
                    {!sc.items?.length && <span className="text-ink-3">—</span>}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex gap-1">
                    {(sc.drinks ?? []).map((id, i) => {
                      const d = cat?.drinks[id]
                      return d?.asset
                        ? <Tip key={i} tip={<><b>{d.name}</b><br />{d.text}</>}><img tabIndex={0} src={spriteUrl(d.asset)} alt={d.name} width={22} height={22} className="size-[22px]" /></Tip>
                        : <span key={i} className="text-[11.5px] text-ink-3">{d?.name ?? id}</span>
                    })}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-[11.5px] whitespace-nowrap text-ink-3">{p.family}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <Tip tip="看完整牌组（点这一行也可以）"><button onClick={() => setOpen(p.id)} aria-label={`看 ${p.name} 的牌组`} className="inline-grid size-7 place-items-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-brand-ink"><Layers size={14} /></button></Tip>
                  {canEdit && <button onClick={() => onDelete(p)} aria-label={`删除 ${p.name}`} className="inline-grid size-7 place-items-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-critical"><Trash2 size={14} /></button>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {opened && <DeckView p={opened} onClose={() => setOpen('')} />}
    </div>
  )
}

const FORMAT_DOC = 'https://github.com/matto49/gakumas-bench/blob/develop/docs/format.md#写一道题'
const FORMAT_RAW = 'https://raw.githubusercontent.com/matto49/gakumas-bench/develop/docs/format.md'
const README = 'https://github.com/matto49/gakumas-bench#readme'
/** 说明里的链接一律开新标签页：上传面板里可能已经选了文件 */
const ext = { target: '_blank', rel: 'noreferrer noopener' } as const
const link = 'text-brand-ink underline-offset-2 hover:underline'

/** 贴给 AI 助手的说明：去哪读格式、去哪查编号、怎么生成文件。地址都是能直接抓的纯文本 / JSON */
function aiBrief(set: string) {
  const site = `${location.origin}${BASE}`
  return [
    `帮我给 gakumas-bench（学マス考试出牌算法的 benchmark）写一道考试，要上传到集合 ${set}。`,
    '',
    `1. 先读格式说明里的「写一道题」一章（字段表和一份完整的例子）：${FORMAT_RAW}`,
    `2. 现成的题可以当例子，每项的 archive.loadout 就是一份开局配置：${site}api/sets/${set}/problems`,
    `3. 卡、饮料、P 道具、偶像的编号和效果文字，以及每张卡能选的定制：${site}api/catalog`,
    '4. 按我下面的要求写出开局配置（JSON，schema 写 gkms.hif_loadout.v1，不要写 seed），存成 exam.json。编号只用上面查得到的，不要自己编。',
    '5. 在 gakumas-bench 仓库目录下运行 python -m gkbench save make exam.json --name <题名>，得到 AS-编号.gksave.json。',
    `6. 把这个文件给我，我在网页上传；或者运行 python -m gkbench upload-problems AS-编号.gksave.json --set ${set}（要命令行令牌）。`,
    '',
    '我要的考试：<偶像、哪场考试第几轮、牌组、P 道具、饮料、开局体力>',
  ].join('\n')
}

/** 上传面板里的说明：文件怎么来、传上去核对什么。默认收起 */
function UploadGuide({ set }: { set: string }) {
  return (
    <details className="group mb-4 rounded-lg border border-line bg-surface-2 text-[12.5px] leading-relaxed text-ink-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-3 py-2 font-medium text-ink hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} aria-hidden className="text-ink-3 motion-safe:transition-transform group-open:rotate-90" />
        三步做出文件，传上去会核对什么
      </summary>
      <div className="max-w-[78ch] border-t border-line px-3 pb-3 pt-2.5 [overflow-wrap:anywhere]">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            写开局配置：偶像、哪场考试、牌组 <Code>deck_cards</Code>、P 道具 <Code>produce_item_ids</Code>、饮料 <Code>drink_ids</Code>、开局体力这些，
            字段表和一份完整的例子在 <a href={FORMAT_DOC} {...ext} className={link}>格式说明</a>。
            编号在 <a href={`${BASE}cards`} {...ext} className={link}>考试资源一览</a> 查，
            也可以拿 <a href={`${BASE}api/sets/${set}/problems`} {...ext} className={link}>这个集合现成的题</a>（JSON，每项的 <Code>archive.loadout</Code>）照着改。
          </li>
          <li>
            算编号，在 gakumas-bench 仓库目录下运行（不需要游戏引擎，装法见 <a href={README} {...ext} className={link}>README</a>）：
            <div className="my-1.5"><CodeBlock>{'python -m gkbench save make exam.json --name 题名'}</CodeBlock></div>
            它生成 <Code>AS-编号.gksave.json</Code>。编号按内容算，改过内容要重新生成，直接传改过的文件会被拒，原因写「编号不符」。
          </li>
          <li>在下面选这个文件，点上传。</li>
        </ol>
        <h4 className="mt-3 mb-1 font-semibold text-ink">传上去会核对什么</h4>
        <ul className="list-disc space-y-1 pl-5">
          <li>编号和内容对得上；引擎认得里面的偶像、卡、P 道具，能开局。</li>
          <li>这个集合里已经有同一开局（同一题族）的题，算重复，不收。</li>
          <li>带种子的题只收成题模板，种子另记成这道题的固定种子，起点（回合、分数、体力、手牌）要对得上。</li>
          <li>收下后每道题配 32 个保密种子，所有算法打同一组。没收的每道写原因，列在下面。</li>
        </ul>
      </div>
    </details>
  )
}

/** 上传考试：.gksave.json（可多个、可 JSON Lines）；服务器逐道核对。格式说明放最前面，另给一段能直接贴给 AI 的说明 */
function UploadPanel({ set, onDone }: { set: string; onDone: () => void }) {
  const [files, setFiles] = useState<FileList | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [busy, setBusy] = useState(false)
  const running = job && (job.status === 'queued' || job.status === 'running')
  useEffect(() => {
    if (!running) return
    const t = setInterval(async () => {
      try {
        const j = await api<Job>(`api/jobs/${job!.job}`)
        setJob(j)
        if (j.status !== 'queued' && j.status !== 'running') {
          onDone()
          if (j.accepted) toast.success(`收下 ${j.accepted} 道题`, { description: j.rejected.length ? `另有 ${j.rejected.length} 道没收，原因见上传面板。` : undefined })
          else toast.error('一道都没收下', { description: '原因见上传面板。' })
        }
      } catch {
        /* 下次再试 */
      }
    }, 1500)
    return () => clearInterval(t)
  }, [running, job?.job])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const fd = new FormData()
    for (const f of Array.from(files ?? [])) fd.append('files', f)
    try {
      const r = await fetch(`${BASE}api/sets/${set}/problems`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.detail ?? `${r.status}`)
      setJob(j)
    } catch (err) {
      toast.error('上传失败', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const pct = job?.total ? Math.round((job.done / job.total) * 100) : 0
  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(aiBrief(set))
      toast.success('已复制', { description: '贴给 AI 助手，把最后一行换成你要的考试。' })
    } catch {
      toast.error('没复制上', { description: '浏览器不让写剪贴板，打开格式说明手动给它也行。' })
    }
  }
  return (
    <section className="mb-6 rounded-xl border border-line bg-surface p-4">
      <SectionTitle>上传考试</SectionTitle>
      <p className="mb-2.5 max-w-[78ch] text-[13px] text-ink-2">
        一道考试是一个审查存档 <Code>.gksave.json</Code>（可以多个，也可以是 JSON Lines）。怎么写看格式说明的「写一道题」：字段表、一份完整的例子、编号去哪查。
        想让 AI 代写，把下面那段说明贴给它。
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <a href={FORMAT_DOC} {...ext} className={btn.small}><BookOpen size={14} aria-hidden />格式说明<ExternalLink size={12} aria-hidden className="text-ink-3" /></a>
        <Button type="button" variant="outline" size="sm" onClick={copyBrief}><Copy size={14} aria-hidden />复制给 AI 的说明</Button>
      </div>
      <UploadGuide set={set} />
      <form onSubmit={submit} className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="block min-w-0">
          <span className="mb-1 block text-[12.5px] font-medium text-ink">文件</span>
          <input type="file" multiple accept=".json,.jsonl,application/json,text/plain" onChange={(e) => setFiles(e.target.files)}
            className="block w-full text-[12.5px] text-ink-2 file:mr-3 file:h-8 file:rounded-full file:border file:border-line-strong file:bg-surface file:px-3 file:text-ink hover:file:bg-surface-2" />
        </label>
        <Button type="submit" disabled={busy || !!running || !files?.length}>
          {busy || running ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />}上传并核对
        </Button>
      </form>
      {job && (
        <div className="mt-4 rounded-lg bg-surface-2 px-3 py-2.5 text-[12.5px]">
          <p className="num text-ink-2">
            {running ? '核对中' : '核对完'} {job.done} / {job.total} · 收下 <span className="font-semibold text-ink">{job.accepted}</span>
            {job.rejected.length > 0 && <> · 没收 <span className="font-semibold text-critical">{job.rejected.length}</span></>}
          </p>
          {running && <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-brand transition-[width] duration-200" style={{ width: `${pct}%` }} /></div>}
          {job.rejected.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-ink-2">
              {job.rejected.slice(0, 20).map((r, i) => <li key={i}><span className="font-mono text-[11.5px]">{r.id}</span>：{r.reason}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
