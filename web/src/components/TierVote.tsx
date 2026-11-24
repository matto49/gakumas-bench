import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, MessageSquare, Pencil, Trash2, UserRound } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/hooks'
import { invalidateApi } from '../lib/query'
import { TIER_STYLE, VOTE_MIN, voteTier, type Tier, type TierComment, type TierVotes, type TierVoteSummary } from '../lib/tiers'
import { when } from '../lib/format'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cx, Help } from './ui'

/** 强度榜的玩家评级和评论：单卡页的一块（评级汇总 + 自己投，下面接评论），和总榜卡片上的小标。
 * 数据 api/tiers/<榜>/votes（server/tiervotes.go）、api/tiers/<榜>/comments/<卡>（server/tiercomments.go） */

const TIERS: Tier[] = ['S', 'A', 'B', 'C', 'D']

export function useTierVotes(board: string | undefined) {
  return useApi<TierVotes>(board ? `api/tiers/${board}/votes` : null)
}

/** 总榜卡片上的小标：票够了写「玩家 A」，不够写票数，有评论再加评论数；都没有不显示 */
export function VoteChip({ s, comments = 0, className }: { s?: TierVoteSummary; comments?: number; className?: string }) {
  if (!s?.n && !comments) return null
  const t = s && s.n >= VOTE_MIN ? voteTier(s.mean) : null
  return (
    <span className={cx('inline-flex items-center gap-1 text-[11px] text-ink-3', className)} title={t ? `玩家评级 ${t}（平均 ${s!.mean.toFixed(2)}，${s!.n} 票）` : undefined}>
      {s?.n ? <>玩家{t && <span className={cx('disp inline-grid size-[18px] place-items-center rounded-[4px] text-[12px] leading-none', TIER_STYLE[t])}>{t}</span>}<span className="num">{s.n} 票</span></> : null}
      {comments > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare size={11} aria-hidden /><span className="num">{comments}</span></span>}
    </span>
  )
}

/** 单卡页：玩家评级汇总 + 自己投一档（要登录） */
export function TierVotePanel({ board, card, dataTier }: { board: string; card: string; dataTier: Tier }) {
  const votes = useTierVotes(board)
  const me = useApi<{ user: string }>('api/me')
  const [busy, setBusy] = useState<Tier | '' | null>(null)
  const [err, setErr] = useState('')
  // 评论框：new 写新的（没写过评论时，点完档位自动展开）；edit 改自己那条
  const [editing, setEditing] = useState<'new' | 'edit' | null>(null)
  const comments = useApi<{ comments: TierComment[] }>(me.data ? `api/tiers/${board}/comments/${card}` : null)
  const myComment = comments.data?.comments.find((x) => x.user === me.data?.user) // 列表新的在前：自己最近那条
  const s = votes.data?.cards[card]
  const mine = votes.data?.mine[card]
  const loggedOut = me.error instanceof ApiError && me.error.status === 401
  const max = Math.max(1, ...TIERS.map((t) => s?.dist[t] ?? 0))
  const vote = async (t: Tier | '') => {
    setBusy(t)
    setErr('')
    try {
      await api(`api/tiers/${board}/votes/${card}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier: t }) })
      await invalidateApi(`api/tiers/${board}/votes`)
      setEditing(t !== '' && !myComment ? 'new' : null)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const pt = s && s.n >= VOTE_MIN ? voteTier(s.mean) : null
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
    <div className="grid gap-4 md:grid-cols-[auto_1fr_auto] md:items-center">
      <div className="flex items-center gap-3">
        {pt
          ? <span className={cx('disp grid size-16 shrink-0 place-items-center rounded-2xl text-[40px] leading-none', TIER_STYLE[pt])}>{pt}</span>
          : <span className="grid size-16 shrink-0 place-items-center rounded-2xl border border-dashed border-line-strong text-[12px] text-ink-3">{s?.n ? '票少' : '无票'}</span>}
        <div>
          <p className="flex items-center text-[15px] font-bold text-ink">玩家评级<Help tip={`登录的玩家给这张卡评一档（S–D），每人一票、可以改。平均分 S=5、A=4、B=3、C=2、D=1，≥4.5 算 S、≥3.5 A、≥2.5 B、≥1.5 C。满 ${VOTE_MIN} 票才给档位。数据榜的档位是按六维总分算的，和这里无关。`} /></p>
          <p className="text-[12.5px] text-ink-3">
            {s?.n ? <>平均 <b className="num text-ink">{s.mean.toFixed(2)}</b> · <span className="num">{s.n}</span> 票</> : '还没有人评'}
            <span className="mx-1.5 text-line-strong">·</span>数据榜 <b className="text-ink">{dataTier}</b>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-[1.25rem_1fr_1.5rem] items-center gap-x-2 gap-y-1">
        {TIERS.map((t) => (
          <div key={t} className="contents">
            <span className={cx('disp text-center text-[14px] leading-none', mine === t ? 'text-brand-ink' : 'text-ink-2')}>{t}</span>
            <span className="h-2 overflow-hidden rounded-full bg-surface-3">
              <i className={cx('block h-full rounded-full', TIER_STYLE[t])} style={{ width: `${(100 * (s?.dist[t] ?? 0)) / max}%` }} />
            </span>
            <span className="num text-right text-[12px] text-ink-3">{s?.dist[t] ?? 0}</span>
          </div>
        ))}
      </div>

      <div className="md:w-[15.5rem]">
        <p className="mb-1.5 text-[12px] text-ink-3">{mine ? '你评的（点别的档改，点同一档撤回）' : '你觉得这张卡在这个模式里算几档？'}</p>
        {loggedOut ? (
          <Link to="/me" className="inline-flex h-9 items-center rounded-full border border-line-strong px-4 text-[13px] font-semibold text-ink-2 hover:border-brand hover:text-brand-ink">登录后评级</Link>
        ) : (
          <div className="flex gap-1.5" role="group" aria-label="你的评级">
            {TIERS.map((t) => (
              <button key={t} type="button" disabled={busy !== null || !me.data} onClick={() => vote(mine === t ? '' : t)} aria-pressed={mine === t}
                className={cx('disp grid size-10 cursor-pointer place-items-center rounded-lg text-[20px] leading-none transition-[transform,box-shadow] duration-150 disabled:cursor-wait',
                  mine === t ? cx(TIER_STYLE[t], 'shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-ink)]') : 'bg-surface-2 text-ink-2 hover:-translate-y-0.5 hover:bg-surface-3 hover:text-ink')}>
                {busy === t || (busy === '' && mine === t) ? <Loader2 size={16} className="animate-spin" aria-hidden /> : t}
              </button>
            ))}
          </div>
        )}
        {err && <p className="mt-1.5 text-[12px] text-critical">{err}</p>}
      </div>
    </div>
    {mine && me.data && (
      editing
        ? <CommentComposer board={board} card={card} tier={mine} edit={editing === 'edit' ? myComment : undefined} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
        : <MyReview board={board} card={card} tier={mine} comment={myComment} onWrite={() => setEditing(myComment ? 'edit' : 'new')} />
    )}
    </section>
  )
}

/** 评过级的人在评级块下面看到自己的评价：档位 + 自己最近那条评论（改、删），没写过就给「写一句为什么」 */
function MyReview({ board, card, tier, comment, onWrite }: { board: string; card: string; tier: Tier; comment?: TierComment; onWrite: () => void }) {
  const remove = async () => {
    if (!comment || !window.confirm('删掉这条评论？评级会保留。')) return
    try {
      await api(`api/tiers/${board}/comments/${card}/${comment.id}`, { method: 'DELETE' })
      await Promise.all([invalidateApi(`api/tiers/${board}/comments/${card}`), invalidateApi(`api/tiers/${board}/votes`)])
    } catch (e) {
      window.alert((e as Error).message)
    }
  }
  return (
    <div className="mt-4 flex gap-3 border-t border-line pt-4">
      <span className={cx('disp grid size-9 shrink-0 place-items-center rounded-lg text-[20px] leading-none', TIER_STYLE[tier])}>{tier}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-3 text-[12px] text-ink-3">
          <span className="font-semibold text-ink">你的评价</span>
          {comment && <span className="num">{when(comment.edited ?? comment.created)}{comment.edited && '（改过）'}</span>}
          <span className="ml-auto flex gap-3">
            <button type="button" onClick={onWrite} className="inline-flex cursor-pointer items-center gap-0.5 font-semibold text-brand-ink hover:underline">
              <Pencil size={12} aria-hidden />{comment ? '修改' : '写一句为什么'}
            </button>
            {comment && (
              <button type="button" onClick={remove} className="inline-flex cursor-pointer items-center gap-0.5 hover:text-critical"><Trash2 size={12} aria-hidden />删除</button>
            )}
          </span>
        </p>
        {comment
          ? <p className="mt-0.5 text-[13.5px] leading-relaxed break-words whitespace-pre-line text-ink">{comment.text}</p>
          : <p className="mt-0.5 text-[13px] text-ink-3">只评了级，还没写为什么。写了会显示在页面最下面的评论区。</p>}
      </div>
    </div>
  )
}

/** 点了档位之后展开的评论框：说说为什么评这一档，可以不写 */
function CommentComposer({ board, card, tier, edit, onDone, onCancel }: { board: string; card: string; tier: Tier; edit?: TierComment; onDone: () => void; onCancel: () => void }) {
  const path = `api/tiers/${board}/comments/${card}`
  const [text, setText] = useState(edit?.text ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const n = [...text.trim()].length
  const post = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await api(edit ? `${path}/${edit.id}` : path, { method: edit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      await Promise.all([invalidateApi(path), invalidateApi(`api/tiers/${board}/votes`)])
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={post} className="mt-4 border-t border-line pt-4">
      <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        {edit ? '修改你的评价' : '你评了'}<span className={cx('disp inline-grid size-[20px] place-items-center rounded-[5px] text-[13px] leading-none', TIER_STYLE[tier])}>{tier}</span>{edit ? '' : <>，说说为什么？<span className="font-normal text-ink-3">（可以不写）</span></>}
      </p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={500} autoFocus
        placeholder="强在哪、什么编成好用、什么情况下会翻车" className="min-h-[3.5rem] text-[13.5px]" />
      <div className="mt-1.5 flex items-center justify-end gap-3">
        {err && <span className="mr-auto text-[12px] text-critical">{err}</span>}
        <span className={cx('num text-[11.5px]', n > 500 ? 'text-critical' : 'text-ink-3')}>{n} / 500</span>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>{edit ? '取消' : '先不写'}</Button>
        <Button type="submit" size="sm" disabled={busy || n === 0 || n > 500} className="disabled:bg-surface-3 disabled:text-ink-3 disabled:opacity-100">
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}{edit ? '保存' : '发表评论'}
        </Button>
      </div>
    </form>
  )
}

/** 单卡页最下面的评论列表：新的在前，默认 5 条；写评论在页面顶部评级之后 */
export function TierCommentList({ board, card }: { board: string; card: string }) {
  const path = `api/tiers/${board}/comments/${card}`
  const list = useApi<{ comments: TierComment[] }>(path)
  const [all, setAll] = useState(false)
  const items = list.data?.comments ?? []
  const remove = async (id: string) => {
    if (!window.confirm('删掉这条评论？')) return
    try {
      await api(`${path}/${id}`, { method: 'DELETE' })
      await Promise.all([invalidateApi(path), invalidateApi(`api/tiers/${board}/votes`)])
    } catch (e) {
      window.alert((e as Error).message)
    }
  }
  return (
    <section id="tier-comments" className="scroll-mt-20 rounded-xl border border-line bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-1.5 text-[15px] font-bold text-ink">
        <MessageSquare size={16} className="text-ink-3" aria-hidden />玩家评论{items.length > 0 && <span className="num text-[12.5px] font-normal text-ink-3">{items.length}</span>}
        <span className="ml-auto text-[12px] font-normal text-ink-3">在页面顶部评级后可以写一句</span>
      </h2>
      {list.data && items.length === 0 && <p className="text-[13px] text-ink-3">还没有评论。</p>}
      <ul className="space-y-3">
        {items.slice(0, all ? items.length : 5).map((c) => (
          <li key={c.id} className="group flex gap-2.5">
            {c.avatar ? <img src={c.avatar} alt="" width={28} height={28} className="mt-0.5 size-7 shrink-0 rounded-full bg-surface-2" />
              : <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-3"><UserRound size={14} aria-hidden /></span>}
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
                <span className="font-semibold text-ink">{c.name || c.user}</span>
                {c.tier && <span className={cx('disp inline-grid size-[17px] place-items-center rounded-[4px] text-[11.5px] leading-none', TIER_STYLE[c.tier])} title={`评了 ${c.tier}`}>{c.tier}</span>}
                <span className="num">{when(c.created)}{c.edited && '（改过）'}</span>
                {c.can_delete && (
                  <button type="button" onClick={() => remove(c.id)} className="ml-auto inline-flex cursor-pointer items-center gap-0.5 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:text-critical focus-visible:opacity-100 max-md:opacity-100" aria-label="删除这条评论">
                    <Trash2 size={13} aria-hidden />删除
                  </button>
                )}
              </p>
              <p className="mt-0.5 text-[13.5px] leading-relaxed break-words whitespace-pre-line text-ink">{c.text}</p>
            </div>
          </li>
        ))}
      </ul>
      {items.length > 5 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 h-9 w-full cursor-pointer rounded-lg text-[13px] text-brand-ink hover:bg-brand-tint">
          {all ? '收起' : `展开全部 ${items.length} 条`}
        </button>
      )}
    </section>
  )
}
