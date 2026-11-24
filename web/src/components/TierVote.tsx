import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/hooks'
import { invalidateApi } from '../lib/query'
import { TIER_STYLE, VOTE_MIN, voteTier, type Tier, type TierVotes, type TierVoteSummary } from '../lib/tiers'
import { cx, Help } from './ui'

/** 强度榜的玩家评级：单卡页的一块（汇总 + 自己投），和总榜卡片上的小标。数据 api/tiers/<榜>/votes（server/tiervotes.go） */

const TIERS: Tier[] = ['S', 'A', 'B', 'C', 'D']

export function useTierVotes(board: string | undefined) {
  return useApi<TierVotes>(board ? `api/tiers/${board}/votes` : null)
}

/** 总榜卡片上的小标：票够了写「玩家 A」，不够写票数；没人投不显示 */
export function VoteChip({ s, className }: { s?: TierVoteSummary; className?: string }) {
  if (!s?.n) return null
  if (s.n < VOTE_MIN) return <span className={cx('text-[11px] text-ink-3', className)}>玩家 {s.n} 票</span>
  const t = voteTier(s.mean)
  return (
    <span className={cx('inline-flex items-center gap-1 text-[11px] text-ink-3', className)} title={`玩家评级 ${t}（平均 ${s.mean.toFixed(2)}，${s.n} 票）`}>
      玩家
      <span className={cx('disp inline-grid size-[18px] place-items-center rounded-[4px] text-[12px] leading-none', TIER_STYLE[t])}>{t}</span>
      <span className="num">{s.n} 票</span>
    </span>
  )
}

/** 单卡页：玩家评级汇总 + 自己投一档（要登录） */
export function TierVotePanel({ board, card, dataTier }: { board: string; card: string; dataTier: Tier }) {
  const votes = useTierVotes(board)
  const me = useApi<{ user: string }>('api/me')
  const [busy, setBusy] = useState<Tier | '' | null>(null)
  const [err, setErr] = useState('')
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
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const pt = s && s.n >= VOTE_MIN ? voteTier(s.mean) : null
  return (
    <section className="grid gap-4 rounded-xl border border-line bg-surface p-4 md:grid-cols-[auto_1fr_auto] md:items-center">
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
    </section>
  )
}
