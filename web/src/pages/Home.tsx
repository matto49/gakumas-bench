import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Download } from 'lucide-react'
import { useApi } from '../lib/hooks'
import { api, BASE, type RunInfo, type SetInfo } from '../lib/api'
import { int } from '../lib/format'
import { ROUND, STAGE } from '../lib/game'
import { setBlurbOf, setTitleOf } from '../lib/sets'
import { idolName, useCatalog } from '../lib/catalog'
import { btn, Code, CodeBlock, Grade, IdolThumb, RankNum, SectionTitle, Skeleton, TurnStrip } from '../components/ui'

type RunItem = { run: string; label: string; kind?: string; privileged?: boolean }

const FEATURE_SET = 'hif-live'

/** 首页头图：实机开局第一题、实机种子那一局，各算法打了多少分 */
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
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_18px_40px_-24px_oklch(0.45_0.12_40/0.45)]">
      <div className="stripes relative bg-brand-deep px-5 pt-4 pb-3 text-white">
        <p className="text-[12px] font-semibold tracking-wide text-white/90">試験結果 · 实机种子</p>
        <div className="mt-2 flex items-center gap-3">
          <IdolThumb id={idol} size={44} className="ring-2 ring-white/70" />
          <div className="min-w-0">
            <p className="truncate text-[16px] font-bold">{idol ? idolName(cat, idol) : data.name}</p>
            <p className="text-[12.5px] text-white/90">
              {[stage && (STAGE[stage] ?? stage), round && (ROUND[round] ?? round)].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      </div>
      <div className="border-b border-line bg-surface-2 px-5 py-2.5">
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
    <span className="flex -space-x-2">
      {(ids ?? []).slice(0, 6).map((id) => (
        <IdolThumb key={id} id={id} size={32} className="ring-2 ring-surface" />
      ))}
    </span>
  )
}

export function Home() {
  const sets = useApi<SetInfo[]>('api/sets')
  return (
    <div>
      <section className="stripes-soft mx-[calc(50%-50vw)] -mt-7 mb-10 border-b border-line bg-brand-tint px-5 pt-10 pb-12">
        <div className="mx-auto grid max-w-[1120px] items-center gap-10 lg:grid-cols-[minmax(0,1fr)_440px]">
          <div>
            <h1 className="text-[34px] leading-[1.2] font-bold tracking-tight text-ink sm:text-[40px]">
              学マス考试<br />出牌算法排行
            </h1>
            <p className="mt-4 max-w-[34em] text-[15.5px] leading-relaxed text-ink-2">
              所有算法打同一批题、同一批种子，比分数和每步用时。每一局裁判都按种子重放核对过，可以点开看每一步出了哪张牌。
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

        <section className="mb-12">
          <SectionTitle>题集</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {sets.loading && <Skeleton className="h-24" />}
            {sets.data?.map((s) => (
              <Link key={s.set} to={`/sets/${s.set}`} className="group flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 transition-colors duration-150 hover:border-brand">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[16px] font-bold text-ink group-hover:text-brand-ink">{setTitleOf(sets.data ?? null, s.set)}</span>
                  <SetIdols ids={s.idols} />
                </div>
                <p className="text-ink-2">{setBlurbOf(sets.data ?? null, s.set)}</p>
                <p className="num text-[12.5px] text-ink-3">
                  <span className="disp text-[16px] text-ink">{s.problems}</span> 题 · <span className="disp text-[16px] text-ink">{s.seeds.dev + s.seeds.test}</span> 个固定种子 · 每题另有 {s.template_seeds ?? 32} 个保密种子 · {s.runs} 次运行
                </p>
              </Link>
            ))}
          </div>
        </section>

        <section id="join" className="mb-12 scroll-mt-20">
          <SectionTitle>交成绩</SectionTitle>
          <p className="mb-5 max-w-[46em] text-ink-2">
            算法是一个函数：拿到画面上看得见的信息（和 GKMS UINet 的 UIObs v1 一样），返回一个动作。先到 <Link to="/me" className="text-brand-ink hover:underline">我的</Link> 页拿令牌。
          </p>
          <dl className="divide-y divide-line rounded-xl border border-line bg-surface">
            <Way title="固定种子 · 本地跑完上传" body="用同一个引擎跑完整套题再上传，服务器按种子逐局重放，对不上的局拒收。成绩标「自报」。">
              {`python -m gkbench run --set hif-live --algo uinet
python -m gkbench upload <运行目录>`}
            </Way>
            <Way title="保密种子 · 托管评测" body="每题 32 个种子只在服务器上，算法每步向服务器要画面、交动作，用时按服务器计。PIMC 这类算法可以向服务器要「可能的世界」。断了用 --resume 接着跑。">
              {`python -m gkbench eval --set hif-live --algo uinet --parallel 3`}
            </Way>
            <Way title="只交路线" body="算法不是 Python 也行：下载审查存档，把每局的出牌路线（如 p0 d1 p2 e）写回去再交，服务器逐条重放。">
              {`python -m gkbench save check my.gksave.jsonl
python -m gkbench upload-saves my.gksave.jsonl --label my-algo`}
            </Way>
          </dl>
          <p className="mt-3 text-[12.5px] text-ink-3">
            接自己的算法：继承 <Code>gkbench.algos.base.Algorithm</Code>，实现 <Code>decide(ctx)</Code>。格式见仓库里的 <Code>docs/format.md</Code>。
          </p>
        </section>

        <section>
          <SectionTitle>审查存档</SectionTitle>
          <p className="max-w-[46em] text-ink-2">
            题和答都按 <Code>gkms.audition_save.v2</Code>（GKMS-STD-001）存，任何实现了这个格式的引擎都能重放核对。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {sets.data?.map((s) => (
              <a key={s.set} href={`${BASE}api/sets/${s.set}/saves?answers=1${s.public_seeds ? '&fixed=1' : ''}`} className={btn.small}>
                <Download size={14} aria-hidden /> {setTitleOf(sets.data ?? null, s.set)}
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function Way({ title, body, children }: { title: string; body: string; children: string }) {
  return (
    <div className="grid gap-x-8 gap-y-2 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div>
        <dt className="font-bold text-ink">{title}</dt>
        <dd className="mt-1 text-ink-2">{body}</dd>
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
function Why() {
  const rows: [string, React.ReactNode][] = [
    ['一局要做的决定', <>9 或 12 回合，出牌 20 到 35 次。每次平均有 4 到 6 种选择，最多 10 种。</>],
    ['看不见的部分', <>牌堆 20 到 25 张，约有 <Pow n={18} /> 到 <Pow n={23} /> 种排法，出牌时不知道是哪一种。</>],
    ['牌序固定后的打法', <>完整的打法还有约 <Pow n={13} /> 到 <Pow n={17} /> 种，没法穷举。</>],
    ['相对的「最优解」', <>知道牌序，开局用 GNRPA 把整局路线一次搜完：每局单核 30 秒，约 150 万局整局模拟，相对全部打法只是极小一部分。所以它是限时搜到的最好成绩，不是真正的最优解。</>],
  ]
  return (
    <section className="mb-12">
      <SectionTitle>为什么有这个网站</SectionTitle>
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="space-y-3 text-[14.5px] leading-relaxed text-ink-2">
          <p>
            众所周知，学园偶像大师是一款肉鸽卡牌游戏。对局里每一步选哪张卡、用不用道具，都存在最优解；理论上只要计算量够大，总能算出一副牌组的最优打法。
            但实际上，以 H.I.F 为例：本战第二轮至少有 12 回合，一局要做 23 到 35 次决定，算上饮料，每次平均有 4 到 6 种选择；牌堆有 22 到 25 张牌，光排法就有 <Pow n={20} /> 到 <Pow n={23} /> 种；即使牌序固定，完整的打法也还有 <Pow n={13} /> 到 <Pow n={17} /> 种。
            每一步的效果结算还要考虑 P 道具、三色属性倍率、支援卡效果，以及好调、好印象、集中、元气、全力等各种 buff 的影响，计算量大得恐怖。
          </p>
          <p>面对这么大的计算量，我们需要性能更高的算法或神经网络，在更短的时间里算出更好的打法，给游戏过程中的选卡、换卡作指引。</p>
          <p>
            所以这个网站收集真实的考试数据，整理成可信的 benchmark，给不同的算法和模型测出高置信的得分和性能，最终设计出最好的算法，交给 bot / AI 自动运行。
            目前每道考试题都会先用 GNRPA 算法，在知道牌序的前提下，开局一次性把整局的出牌路线搜出来，每局搜 30 秒（MacBook Air M4 单核约 150 万局整局模拟），得到一个相对的「最优解」。收集来的外部算法都以它为锚，评估各自的用时和质量。
          </p>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-bold text-ink">H.I.F 本战的一局有多大</p>
          <dl className="divide-y divide-line rounded-xl border border-line bg-surface text-[13px]">
            {rows.map(([k, v]) => (
              <div key={k} className="grid gap-x-4 gap-y-0.5 px-4 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
                <dt className="font-semibold text-ink">{k}</dt>
                <dd className="leading-relaxed text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}
