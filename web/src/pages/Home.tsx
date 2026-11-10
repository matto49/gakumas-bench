import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, KeyRound } from 'lucide-react'
import { useApi } from '../lib/hooks'
import { api, type Row, type RunInfo, type SetInfo } from '../lib/api'
import { int, ms, pct, pm } from '../lib/format'
import { ROUND, STAGE } from '../lib/game'
import { setBlurbOf, setTitleOf, sortSets } from '../lib/sets'
import { idolName, useCatalog } from '../lib/catalog'
import { Badge } from '@/components/ui/badge'
import { btn, Code, CodeBlock, Grade, IdolThumb, ModeBadge, RankNum, Skeleton, Tip, TurnStrip, useRowLink } from '../components/ui'

type RunItem = { run: string; label: string; kind?: string; privileged?: boolean }

const FEATURE_SET = 'hif-live'

/** 首页头图：实机开局第一题、实机那一局的牌序，各算法打了多少分（数据取自每题几种牌序的自测运行） */
function useFeatured() {
  const [data, setData] = useState<{ name: string; id: string; seed: number; types?: number[]; tags?: Record<string, string>; rows: { run: string; label: string; score: number; ratio: number | null }[]; oracle: number } | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    ;(async () => {
      const runs = (await api<RunItem[]>(`api/runs?set=${FEATURE_SET}`)).filter((r) => (r.kind ?? 'fixed') === 'fixed')
      const all = await Promise.all(runs.map((r) => api<RunInfo>(`api/runs/${r.run}`)))
      // 同一个算法跑过几次（题集扩过题）时只留最新的一次
      const latest = new Map<string, RunInfo>()
      for (const r of all) {
        const k = `${r.privileged ? 'oracle:' : ''}${r.label}`
        const old = latest.get(k)
        if (!old || (r.uploaded ?? r.finished ?? r.started ?? '') > (old.uploaded ?? old.finished ?? old.started ?? '')) latest.set(k, r)
      }
      const infos = [...latest.values()]
      const oracleRun = infos.find((r) => r.privileged)
      const first = oracleRun?.episodes.find((e) => e.seed_index === 0) ?? infos[0]?.episodes[0]
      if (!first) throw new Error('没有成绩')
      const oracle = oracleRun?.episodes.find((e) => e.id === first.id && e.seed_index === first.seed_index)?.score ?? 0
      const rows = infos
        .filter((r) => !r.privileged)
        .map((r) => {
          const e = r.episodes.find((x) => x.id === first.id && x.seed_index === first.seed_index)
          return e ? { run: r.run, label: r.label, score: e.score, ratio: oracle ? e.score / oracle : null } : null
        })
        .filter((x): x is NonNullable<typeof x> => !!x)
        .sort((a, b) => b.score - a.score)
      if (live) setData({ name: first.name ?? first.id, id: first.id, seed: first.seed_index, types: first.types, tags: first.tags, rows, oracle })
    })().catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [])
  return { data, failed }
}

function FeaturedResult() {
  const { data, failed } = useFeatured()
  const cat = useCatalog()
  if (failed) return null
  if (!data) return <Skeleton className="h-[340px] w-full rounded-2xl" />
  const idol = data.tags?.idol
  const stage = data.tags?.stage
  const round = data.tags?.round
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_1px_2px_oklch(0.2_0_0/0.04),0_18px_40px_-26px_oklch(0.2_0_0/0.22)]">
      <div className="px-5 pt-4 pb-3">
        <p className="text-[12px] font-semibold text-ink-3">試験結果 · 实机牌序</p>
        <div className="mt-2 flex items-center gap-3">
          <IdolThumb id={idol} size={44} />
          <div className="min-w-0">
            <p className="truncate text-[16px] font-bold text-ink">{idol ? idolName(cat, idol) : data.name}</p>
            <p className="text-[12.5px] text-ink-2">
              {[stage && (STAGE[stage] ?? stage), round && (ROUND[round] ?? round)].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      </div>
      <div className="border-y border-line bg-surface-2 px-5 py-2.5">
        <TurnStrip types={data.types} />
      </div>
      <ol className="divide-y divide-line">
        {data.rows.slice(0, 4).map((r, i) => (
          <li key={r.run}>
            <Link to={`/runs/${r.run}/${data.id}/${data.seed}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-brand-tint">
              <RankNum n={i + 1} className="w-5 text-center" />
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{r.label}</span>
              <Grade ratio={r.ratio} size={30} />
              <span className="disp w-24 text-right text-[22px] leading-none text-ink">{int(r.score)}</span>
            </Link>
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between bg-surface-2 px-5 py-2.5 text-[12.5px] text-ink-2">
        <span>理论上限 <span className="disp text-[15px] text-ink">{int(data.oracle)}</span></span>
        <Link to={`/sets/${FEATURE_SET}?kind=fixed`} className="inline-flex items-center gap-1 font-semibold text-brand-ink hover:underline">
          完整排行 <ArrowRight size={13} aria-hidden />
        </Link>
      </div>
    </div>
  )
}

function SetIdols({ ids }: { ids?: string[] }) {
  return (
    <span className="flex shrink-0 -space-x-2">
      {(ids ?? []).slice(0, 6).map((id) => (
        <IdolThumb key={id} id={id} size={32} className="ring-2 ring-surface" />
      ))}
    </span>
  )
}

/** 首页的节标题：比内页的 SectionTitle 大一号，下面可以带一行说明 */
function HomeTitle({ children, sub, right }: { children: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div>
        <h2 className="flex items-center gap-2.5 text-[21px] leading-tight font-bold tracking-tight text-ink">
          <span className="inline-block h-5 w-[5px] shrink-0 -skew-x-12 rounded-sm bg-brand" aria-hidden />
          {children}
        </h2>
        {sub && <p className="mt-2 max-w-[54em] text-ink-2">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

function Stat({ n, label }: { n: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="disp text-[26px] leading-none text-ink">{n}</dd>
    </div>
  )
}

/** 一个题集的排行：同一个算法跑过几次（题集扩过题）时留题数最多的那次，按相对上限排 */
function useBoard(set: string) {
  const lb = useApi<Row[]>(`api/leaderboard?set=${encodeURIComponent(set)}&kind=template`)
  return useMemo(() => {
    const best = new Map<string, Row>()
    for (const r of lb.data ?? []) {
      const k = `${r.privileged ? 'oracle:' : ''}${r.label}`
      const old = best.get(k)
      if (!old || r.problems > old.problems) best.set(k, r)
    }
    const all = [...best.values()]
    const v = (r: Row) => r.vs_oracle?.geo ?? -1
    const ranked = all.filter((r) => !r.privileged).sort((a, b) => v(b) - v(a) || b.mean - a.mean)
    return { loading: lb.loading, ranked, oracle: all.find((r) => r.privileged), hasOracle: ranked.some((r) => r.vs_oracle) }
  }, [lb.data, lb.loading])
}

/** 首页「现在的排行」：FEATURE_SET 的榜，相对上限旁边带一根条。完整的列和筛选在排行页 */
function NowBoard({ sets }: { sets: SetInfo[] | null }) {
  const { loading, ranked, oracle } = useBoard(FEATURE_SET)
  const rowLink = useRowLink()
  const info = sets?.find((s) => s.set === FEATURE_SET)
  return (
    <section className="mb-14">
      <HomeTitle
        sub={`${setTitleOf(sets, FEATURE_SET)} · 每题 ${info?.template_seeds ?? 32} 种随机牌序`}
        right={
          <Link to={`/sets/${FEATURE_SET}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-ink hover:underline">
            完整排行 <ArrowRight size={13} aria-hidden />
          </Link>
        }
      >
        现在的排行
      </HomeTitle>
      {loading ? (
        <Skeleton className="h-[280px] rounded-2xl" />
      ) : ranked.length === 0 ? (
        <p className="text-ink-3">还没有成绩。</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-[12.5px] text-ink-3">
                <th scope="col" className="w-12 px-3 py-2.5 font-medium" aria-label="名次" />
                <th scope="col" className="px-3 py-2.5 font-medium">算法</th>
                <th scope="col" className="px-3 py-2.5 font-medium sm:w-[330px]">相对上限</th>
                <th scope="col" className="w-14 px-3 py-2.5 font-medium">评级</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">平均分</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium max-sm:hidden">每步用时</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => (
                <tr key={r.run} {...rowLink(`/runs/${r.run}`)} className="cursor-pointer border-b border-line hover:bg-brand-tint">
                  <td className="px-3 text-center"><RankNum n={i + 1} /></td>
                  <td className="h-14 px-3">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <Link to={`/runs/${r.run}`} className="text-[15px] font-semibold text-ink hover:text-brand-ink">{r.label}</Link>
                      <ModeBadge mode={r.mode} privileged={false} />
                    </span>
                  </td>
                  <td className="px-3">
                    <span className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3">
                      <span className="whitespace-nowrap">
                        <span className="disp text-[21px] text-ink">{pct(r.vs_oracle)}</span>{' '}
                        <span className="num text-[12px] text-ink-3">{pm(r.vs_oracle)}</span>
                      </span>
                      <span className="block h-1.5 rounded-full bg-surface-3 max-sm:hidden" aria-hidden>
                        <span className="block h-1.5 rounded-full bg-brand" style={{ width: `${Math.min(100, Math.max(0, (r.vs_oracle?.geo ?? 0) * 100))}%` }} />
                      </span>
                    </span>
                  </td>
                  <td className="px-3"><Grade ratio={r.vs_oracle?.geo} size={30} /></td>
                  <td className="px-3 text-right"><span className="disp text-[21px] text-ink">{int(r.mean)}</span></td>
                  <td className="num px-3 text-right text-ink-2 max-sm:hidden">{ms(r.p50_ms)}</td>
                </tr>
              ))}
              {oracle && (
                <tr className="bg-surface-2 text-ink-2">
                  <td />
                  <td className="h-12 px-3">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-[15px]">{oracle.label}</span>
                      <ModeBadge mode={oracle.mode} privileged />
                    </span>
                  </td>
                  <td className="px-3 text-[12.5px] text-ink-3" colSpan={2}>提前知道牌序的搜索，只当分母，不排名</td>
                  <td className="px-3 text-right"><span className="disp text-[21px]">{int(oracle.mean)}</span></td>
                  <td className="num px-3 text-right text-ink-3 max-sm:hidden">30 s / 局</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** 题集的一行：名字和说明、题数、每题几种牌序、现在的第一名。整行点进排行 */
function SetRow({ s, sets }: { s: SetInfo; sets: SetInfo[] }) {
  const { loading, ranked, hasOracle } = useBoard(s.set)
  const first = ranked[0]
  return (
    <li className="group relative grid items-center gap-x-8 gap-y-3 border-b border-line px-1 py-5 hover:bg-surface-2 sm:px-3 md:grid-cols-[minmax(0,1fr)_12rem_11rem_12.5rem]">
      <div className="min-w-0">
        <h3 className="text-[17px] leading-snug font-bold text-ink">
          <Link to={`/sets/${s.set}`} className="rounded-sm after:absolute after:inset-0 group-hover:text-brand-ink">
            {setTitleOf(sets, s.set)}
          </Link>
        </h3>
        <p className="mt-1 text-ink-2">{setBlurbOf(sets, s.set)}</p>
      </div>
      <dl className="flex gap-x-8">
        <Stat n={s.problems} label="道题" />
        <Stat n={s.template_seeds ?? 32} label="种随机牌序 / 题" />
      </dl>
      <p className="text-[12px] leading-snug text-ink-3">
        {loading ? '' : first ? (
          <>
            <span className="block truncate">现在第一 <span className="font-semibold text-ink">{first.label}</span></span>
            <span className="disp text-[19px] text-ink">{hasOracle ? pct(first.vs_oracle) : int(first.mean)}</span>{' '}
            {hasOracle ? '相对上限' : '平均分'}
          </>
        ) : '还没有成绩'}
      </p>
      <span className="md:justify-self-end">
        <SetIdols ids={s.idols} />
      </span>
    </li>
  )
}

export function Home() {
  const sets = useApi<SetInfo[]>('api/sets')
  return (
    <div>
      <section className="mx-[calc(50%-50vw)] -mt-7 mb-14 border-b border-line px-5 pt-14 pb-16">
        <div className="mx-auto grid max-w-[1120px] items-center gap-10 lg:grid-cols-[minmax(0,1fr)_440px]">
          <div>
            <h1 className="text-[34px] leading-[1.16] font-bold tracking-tight text-ink sm:text-[46px]">
              学マス考试<br />出牌算法排行
            </h1>
            <p className="mt-5 max-w-[32em] text-[16px] leading-[1.8] text-ink-2">
              所有算法打同一批题，每题同样的 32 种随机牌序，比分数和每步用时。牌序只有裁判知道，每一局都可以点开看每一步出了哪张牌。
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/sets" className={btn.primary}>
                看排行 <ArrowRight size={15} aria-hidden />
              </Link>
              <a href="#join" className={btn.secondary}>交自己的算法</a>
            </div>
          </div>
          <FeaturedResult />
        </div>
      </section>

      <div className="mx-auto max-w-[1120px]">
        <Why />
        <NowBoard sets={sets.data} />

        <section className="mb-14">
          <HomeTitle
            sub={
              <>
                题和答都按 <Code>gkms.audition_save.v2</Code>（GKMS-STD-001）存，任何实现了这个格式的引擎都能重放核对。
              </>
            }
            right={
              <Link to="/exams" className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-ink hover:underline">
                全部試験集合 <ArrowRight size={13} aria-hidden />
              </Link>
            }
          >
            题集
          </HomeTitle>
          {sets.loading && <Skeleton className="h-[180px] rounded-2xl" />}
          <ul className="border-t border-line">
            {sortSets(sets.data ?? []).map((s) => <SetRow key={s.set} s={s} sets={sets.data ?? []} />)}
          </ul>
        </section>

        <section id="join" className="scroll-mt-20">
          <HomeTitle
            sub="算法是一个函数：拿到画面上看得见的信息（和 GKMS UINet 的 UIObs v1 一样），返回一个动作。成绩走托管评测，要先拿令牌。"
            right={
              <Link to="/me" className={btn.small}>
                <KeyRound size={14} aria-hidden /> 去拿令牌
              </Link>
            }
          >
            交成绩
          </HomeTitle>
          <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            <Way title="提交到仓库" tag="固定机器" strong body="把算法放进仓库的 submissions/ 开 PR，合并后由固定的评测机（作者的 Mac，Apple M4）在空闲时跑完上传。所有提交同一台机器、同一个环境、沙盒里单独进程，所以耗时可以互相比。">
              {`submissions/<你的算法>/algo.py
submissions/<你的算法>/submission.json`}
            </Way>
            <Way title="托管评测" tag="自测" body="每题随机 32 种牌序，只有服务器知道，算法每步向服务器要画面、交动作，用时按服务器计。PIMC 这类算法可以向服务器要「可能的世界」。断了用 --resume 接着跑。">
              {`python -m gkbench eval --set hif-live --algo uinet --parallel 3`}
            </Way>
          </dl>
          <p className="mt-3 text-[12.5px] text-ink-3">
            接自己的算法：<Code>pip install "gkbench @ git+https://github.com/matto49/gakumas-bench"</Code>（不需要 GKMS），
            写一个继承 <Code>gkbench.algos.base.Algorithm</Code> 的类，实现 <Code>decide(ctx)</Code>，
            再用 <Code>--algo my_algo.py:MyAlgo</Code> 托管评测。例子见仓库的 <Code>examples/first_playable.py</Code>，观测格式见 <Code>docs/format.md</Code>。
          </p>
        </section>
      </div>
    </div>
  )
}

function Way({ title, tag, strong, body, children }: { title: string; tag: string; strong?: boolean; body: string; children: string }) {
  return (
    <div className="grid items-center gap-x-8 gap-y-3 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div>
        <dt className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-ink">
          {title}
          <Badge variant={strong ? 'brand' : 'outline'}>{tag}</Badge>
        </dt>
        <dd className="mt-1.5 text-ink-2">{body}</dd>
      </div>
      <dd>
        <CodeBlock>{children}</CodeBlock>
      </dd>
    </div>
  )
}

const Pow = ({ n }: { n: number }) => <>10<sup>{n}</sup></>

/** 基础说明：为什么有这个网站，一局本战有多大。数字是 2026-11 在 hif-live 的本战题上实测的（MacBook Air M4）：
 *  排法数 = 牌堆的排列数；打法数用随机试打估算（Knuth 估计，第二轮 8 题各 4000 局，自助法区间约 ±0.3 个数量级）；
 *  GNRPA 单核 60 秒约 300 到 350 万局整局模拟、8,400 万次出牌推演。脚本在 gakumas-bench-data/scripts/complexity*.py */
/** 正文里的重点数字：加粗，下半截垫一道橙色荧光笔 */
const N = ({ children }: { children: React.ReactNode }) => (
  <strong className="num box-decoration-clone bg-[linear-gradient(transparent_58%,color-mix(in_oklch,var(--color-brand)_40%,transparent)_58%)] px-[2px] font-bold text-ink">{children}</strong>
)

function Why() {
  return (
    <section className="mb-14">
      <HomeTitle>为什么有这个网站</HomeTitle>
      <div className="grid items-start gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="max-w-[36em] space-y-3.5 text-[14.5px] leading-[1.8] text-ink-2">
          <p className="text-[16px] leading-[1.7] font-medium text-ink">
            众所周知，学园偶像大师是一款肉鸽卡牌游戏。对局里每一步选哪张卡、用不用道具，都存在最优解；理论上只要计算量够大，总能算出一副牌组的最优打法。
          </p>
          <p>
            但实际上，以 H.I.F 为例：本战第二轮至少有 <N>12 回合</N>，一局要做 <N>23 到 35 次</N>决定，算上饮料，每次平均有 <N>4 到 6 种</N>选择；牌堆有 <N>22 到 25 张</N>牌，光排法就有 <N><Pow n={20} /> 到 <Pow n={23} /> 种</N>；即使牌序固定，完整的打法也还有 <N><Pow n={13} /> 到 <Pow n={17} /> 种</N>。
            每一步的效果结算还要考虑 P 道具、三色属性倍率、支援卡效果，以及好调、好印象、集中、元气、全力等各种 buff 的影响，计算量大得恐怖。
          </p>
          <p>面对这么大的计算量，我们需要性能更高的算法或神经网络，在更短的时间里算出更好的打法，给游戏过程中的选卡、换卡作指引。</p>
          <p>
            所以这个网站收集真实的考试数据，整理成可信的 benchmark，给不同的算法和模型测出高置信的得分和性能，最终设计出最好的算法，交给 bot / AI 自动运行。
            目前每道考试题都会先用 GNRPA 算法，在知道牌序的前提下，开局一次性把整局的出牌路线搜出来，每局搜 <N>30 秒</N>（MacBook Air M4 单核约 <N>150 万局</N>整局模拟），得到一个相对的「最优解」。收集来的外部算法都以它为锚，评估各自的用时和质量。
          </p>
        </div>
        <ScaleFigure />
      </div>
    </section>
  )
}

/** 数量级标尺：横轴是 10 的几次方（0 到 24）。上面两条是「存在多少种」，最下面一个点是「30 秒搜得了多少」 */
const SCALE_MAX = 24
const pos = (e: number) => `${(e / SCALE_MAX) * 100}%`

function ScaleRow({ label, sub, from, to, tip, point, gapTo, gapLabel }: { label: string; sub: React.ReactNode; from: number; to?: number; tip: React.ReactNode; point?: boolean; gapTo?: number; gapLabel?: string }) {
  return (
    <div className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
      <div className="leading-tight">
        <p className="text-[13px] font-semibold text-ink">{label}</p>
        <p className="num mt-0.5 text-[12px] text-ink-2">{sub}</p>
      </div>
      {/* @container：条的宽度用 cqw（作图区宽度的百分之几），不受外面那层悬停提示的包裹影响 */}
      <div className="@container relative h-8">
        {point && gapTo != null && (
          <div className="absolute top-1/2 flex -translate-y-1/2 flex-col items-start" style={{ left: pos(from), width: `${((gapTo - from) / SCALE_MAX) * 100}cqw` }} aria-hidden>
            <span className="-mt-[18px] mb-[3px] ml-3.5 text-[11px] leading-none whitespace-nowrap text-ink-2">{gapLabel}</span>
            <span className="w-full border-t-[1.5px] border-dashed border-ink-3" />
          </div>
        )}
        <div className="absolute top-1/2 -translate-y-1/2" style={{ left: pos(from) }}>
          <Tip tip={tip} wide>
            {point ? (
              <span tabIndex={0} className="-ml-2 block size-4 rounded-full bg-ink ring-2 ring-surface" />
            ) : (
              <span tabIndex={0} className="block h-4 rounded-[4px] bg-brand" style={{ width: `${(((to ?? from) - from) / SCALE_MAX) * 100}cqw` }} />
            )}
          </Tip>
        </div>
      </div>
    </div>
  )
}

function ScaleFigure() {
  const ticks = [0, 6, 12, 18, 24]
  return (
    <figure className="rounded-2xl border border-line bg-surface p-5">
      <figcaption className="mb-4">
        <p className="text-[14px] font-bold text-ink">H.I.F 本战的一局有多大</p>
        <p className="mt-0.5 text-[12px] text-ink-3">横轴是数量级，每往右一格大 100 万倍。</p>
      </figcaption>
      <div className="relative">
        {/* 竖的刻度线：只铺在右边的作图区 */}
        <div className="pointer-events-none absolute inset-y-0 right-0 left-0 sm:left-[calc(9.5rem+1rem)]" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: pos(t) }} />
          ))}
        </div>
        <div className="relative space-y-4 py-2">
          <ScaleRow label="牌堆的排法" sub={<><Pow n={18} /> 到 <Pow n={23} /> 种</>} from={18} to={23}
            tip="牌堆 20 到 25 张，洗牌后可能的顺序数。出牌时不知道是哪一种。" />
          <ScaleRow label="牌序固定后的打法" sub={<><Pow n={13} /> 到 <Pow n={17} /> 种</>} from={13} to={17}
            tip="牌序定下来以后，从第一步到最后一步的完整打法数。9 或 12 回合，出牌 20 到 35 次，每次平均 4 到 6 种选择。" />
          <ScaleRow label="30 秒搜得了的" sub="约 150 万局" from={6.18} point gapTo={13} gapLabel="相差 600 万倍以上"
            tip="GNRPA 知道牌序、单核搜 30 秒，约 150 万局整局模拟（MacBook Air M4）。" />
        </div>
        <div className="relative mt-1 h-5 sm:ml-[calc(9.5rem+1rem)]" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className={cxTick(t)} style={{ left: pos(t) }}>
              {t === 0 ? '1' : <Pow n={t} />}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-4 border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink-2">
        30 秒搜过的局数，<strong className="font-bold text-ink">不到全部打法的百万分之一</strong>。所以这里的「最优解」是限时搜到的最好成绩，不是真正的最优解。
      </p>
    </figure>
  )
}

const cxTick = (t: number) =>
  'num absolute top-1 text-[11px] text-ink-3 ' + (t === 0 ? '' : t === SCALE_MAX ? '-translate-x-full' : '-translate-x-1/2')
