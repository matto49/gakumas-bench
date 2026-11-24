import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useCatalog } from '../lib/catalog'
import { cancelSim, emptyLoadout, missing, parseGC1, pushHistory, sanitizeLoadout, seasonLabel, submitSim, useContestSeasons, useSim, type ContestLoadout, type ContestSeasons, type SimState } from '../lib/contest'
import { int } from '../lib/format'
import { Button } from '@/components/ui/button'
import { ContestTabs, PlanText, StageBar, StageItems } from '../components/contest/Common'
import { Editor } from '../components/contest/Editor'
import { Result } from '../components/contest/Result'
import { Compare } from '../components/contest/Compare'
import { toast } from 'sonner'
import { Empty, ErrorState, PageHeader, Skeleton } from '../components/ui'

/** 竞技场：模拟器（/contest）、舞台一览（/contest/stages）、比较（/contest/compare）。
 * 模拟用 GKMS 的竞技场模拟包（游戏官方 AI 的还原），在服务器上跑，见 server/contest.go */

const SUB = '用游戏里竞技场自动出牌的官方 AI（GKMS 还原版）模拟你的编成，看分数分布、每回合得分和出牌记录。'

/** 赛季没取到时的统一处理：包没装是 503，页面说一句 */
function SeasonsGate({ seasons, children }: { seasons: ReturnType<typeof useContestSeasons>; children: (d: ContestSeasons) => React.ReactNode }) {
  if (seasons.error) {
    return (seasons.error as { status?: number }).status === 503
      ? <Empty>竞技场模拟暂不可用，过一会再来看看。</Empty>
      : <ErrorState error={seasons.error} onRetry={seasons.reload} />
  }
  if (!seasons.data) return <Skeleton className="h-64 rounded-2xl" />
  return <>{children(seasons.data)}</>
}

const DRAFT = 'gkb-contest-draft'
const RUN = 'gkb-contest-run'

/** 当前这次模拟（任务 id 和当时的编成），坏数据当没有 */
function readRun(): { id: string; ran: { lo: ContestLoadout; runs: number }; recorded: boolean } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(RUN) ?? 'null')
    const lo = sanitizeLoadout(v?.ran?.lo)
    if (typeof v?.id !== 'string' || !/^[0-9a-f]{16,64}$/.test(v.id) || !lo) return null
    return { id: v.id, ran: { lo, runs: typeof v.ran.runs === 'number' ? v.ran.runs : 0 }, recorded: v.recorded === true }
  } catch {
    return null
  }
}

function readDraft(): ContestLoadout | null {
  try {
    return sanitizeLoadout(JSON.parse(localStorage.getItem(DRAFT) ?? 'null'))
  } catch {
    return null
  }
}

export function ContestPage() {
  const seasons = useContestSeasons()
  return (
    <div>
      <PageHeader title="竞技场" sub={SUB} />
      <ContestTabs />
      <SeasonsGate seasons={seasons}>{(d) => <Simulator seasons={d} />}</SeasonsGate>
    </div>
  )
}

/** 模拟器：编成（本机草稿）+ 运行 + 结果 */
function Simulator({ seasons }: { seasons: ContestSeasons }) {
  const cat = useCatalog()
  const [params, setParams] = useSearchParams()
  const [lo, setLo] = useState<ContestLoadout>(() => readDraft() ?? emptyLoadout(seasons.seasons[0]?.id ?? ''))
  const [runs, setRuns] = useState(1000)

  // 赛季不在列表里（换了数据包）时退回最新赛季
  useEffect(() => {
    if (!seasons.seasons.some((s) => s.id === lo.season)) setLo((l) => ({ ...l, season: seasons.seasons[0]?.id ?? '', stage: 0 }))
  }, [seasons, lo.season])
  // 分享链接或比较页「载入」：?c=<GC1>
  useEffect(() => {
    const code = params.get('c')
    if (!code) return
    setParams({}, { replace: true })
    parseGC1(code).then(
      (l) => { setLo(l); toast.success('编成已带入', { description: l.name || undefined }) },
      (e: Error) => toast.error('链接里的编成读不出来', { description: e.message }),
    )
  }, [params, setParams])
  // 舞台一览点过来：?season=&stage=
  useEffect(() => {
    const sid = params.get('season')
    if (!sid || !seasons.seasons.some((s) => s.id === sid)) return
    const st = Math.max(0, Math.min(2, Number(params.get('stage')) || 0))
    setLo((l) => ({ ...l, season: sid, stage: st }))
    setParams({}, { replace: true })
  }, [params, seasons, setParams])
  useEffect(() => {
    try { localStorage.setItem(DRAFT, JSON.stringify(lo)) } catch { /* 存不了就算了 */ }
  }, [lo])

  const season = seasons.seasons.find((s) => s.id === lo.season)
  const stage = season?.stages[lo.stage]
  const blocked = missing(lo, stage, cat?.idols[lo.idol]?.plan)
  // 当前这次模拟存在 sessionStorage：跑的时候刷新页面也能接上
  const [simId, setSimId] = useState<string | null>(() => readRun()?.id ?? null)
  const [ranWith, setRanWith] = useState<{ lo: ContestLoadout; runs: number } | null>(() => readRun()?.ran ?? null)
  const [submitErr, setSubmitErr] = useState<string | null>(null)
  const sim = useSim(simId)
  const st = sim.data
  const busy = !!simId && (!st || st.state === 'queued' || st.state === 'running')
  const recorded = useRef<string | null>(readRun()?.recorded ? readRun()!.id : null)
  useEffect(() => {
    if (st?.state === 'done' && ranWith && recorded.current !== st.id) {
      recorded.current = st.id
      void pushHistory(ranWith.lo, ranWith.runs, st.result.stats)
      try { sessionStorage.setItem(RUN, JSON.stringify({ id: st.id, ran: ranWith, recorded: true })) } catch { /* 存不了就算了 */ }
    }
  }, [st, ranWith])

  const run = async () => {
    setSubmitErr(null)
    try {
      const r = await submitSim(lo, runs)
      setRanWith({ lo, runs })
      setSimId(r.id)
      try { sessionStorage.setItem(RUN, JSON.stringify({ id: r.id, ran: { lo, runs } })) } catch { /* 存不了就算了 */ }
    } catch (e) {
      setSubmitErr((e as Error).message)
    }
  }

  return (
    <div>
      <Editor seasons={seasons} value={lo} onChange={setLo} runs={runs} setRuns={setRuns} onRun={run} blocked={blocked} busy={busy} />
      {submitErr && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">{submitErr}</p>}
      {sim.error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">取不到模拟进度：{(sim.error as Error).message}</p>}
      {st && <RunStatus st={st} onCancel={() => simId && void cancelSim(simId).then(() => sim.refetch())} />}
      {st?.state === 'done' && <Result r={st.result} runs={ranWith?.runs ?? st.result.stats.n} />}
    </div>
  )
}

/** 排队 / 运行中 / 失败的提示条；运行时显示进度和已跑完的几局的统计 */
function RunStatus({ st, onCancel }: { st: SimState; onCancel: () => void }) {
  if (st.state === 'done') return null
  if (st.state === 'failed' || st.state === 'canceled') {
    return <p className="mt-4 rounded-xl border border-line bg-surface-2 px-4 py-3 text-[13.5px] text-ink-2">{st.state === 'canceled' ? '已取消' : st.error}</p>
  }
  const p = st.state === 'running' ? st.progress : undefined
  const frac = p?.total ? Math.min(1, (p.done ?? 0) / p.total) : 0
  return (
    <div className="mt-4 rounded-2xl border border-line bg-surface p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] font-semibold text-ink">
          {st.state === 'queued' ? (st.position > 0 ? `排队中，前面还有 ${st.position - 1} 个` : '马上开始') : p?.total ? `模拟中 ${p.done ?? 0} / ${p.total}` : '准备中（读数据、编牌组）'}
        </p>
        <Button variant="outline" className="h-[40px]" onClick={onCancel}>取消</Button>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${frac * 100}%` }} /></div>
      {p?.partial?.n ? <p className="num mt-2 text-[12.5px] text-ink-3">已跑完 {p.partial.n} 局：平均 {int(p.partial.mean)} · 中位 {int(p.partial.median)}</p> : null}
    </div>
  )
}

/** 舞台一览：赛季从新到旧，每季三个舞台；点一行到模拟器并选好这个舞台 */
export function ContestStagesPage() {
  const seasons = useContestSeasons()
  return (
    <div>
      <PageHeader title="竞技场" sub="每个赛季每个舞台的计划、回合数、审查基准和舞台自带的 P 道具。点一行，在模拟器里用这个舞台。" />
      <ContestTabs />
      <SeasonsGate seasons={seasons}>
        {(d) => (
          <div className="space-y-4">
            {d.seasons.map((s, si) => (
              <section key={s.id} className="overflow-hidden rounded-2xl border border-line bg-surface">
                <h2 className="flex items-baseline gap-2 border-b border-line bg-surface-2 px-4 py-2.5 text-[15px] font-bold text-ink">
                  {seasonLabel(s)}
                  {si > 0 && <span className="text-[12px] font-normal text-ink-3">卡牌效果按现在的版本</span>}
                </h2>
                <ul className="divide-y divide-line">
                  {s.stages.map((st, i) => (
                    <li key={i}>
                      <Link to={`/contest?season=${s.id}&stage=${i}`} className="group grid grid-cols-[3.5em_1fr_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 hover:bg-surface-2 sm:grid-cols-[4em_6em_4em_1fr_auto_auto]">
                        <span className="font-semibold text-ink">舞台 {i + 1}</span>
                        <span className="text-ink-2"><PlanText stage={st} /></span>
                        <span className="num text-ink-2 max-sm:col-start-3 max-sm:row-start-1 max-sm:text-right">{st.turn} 回合</span>
                        <StageBar stage={st} className="max-sm:col-span-2 max-sm:col-start-1" />
                        <StageItems ids={st.produceItemIds} />
                        <ChevronRight size={15} className="text-ink-3 group-hover:text-brand-ink max-sm:hidden" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <p className="text-[12.5px] text-ink-3">数据版本：{d.package || '未知'}。新赛季要等模拟数据更新后才会出现。</p>
          </div>
        )}
      </SeasonsGate>
    </div>
  )
}

export function ContestComparePage() {
  const seasons = useContestSeasons()
  return (
    <div>
      <PageHeader title="竞技场" sub="这台设备上跑过的模拟和保存的编成。同一舞台的记录放在一起比，点「载入」回到模拟器。" />
      <ContestTabs />
      <SeasonsGate seasons={seasons}>{(d) => <Compare seasons={d} />}</SeasonsGate>
    </div>
  )
}
