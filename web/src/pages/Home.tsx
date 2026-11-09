import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useApi } from '../lib/hooks'
import type { SetInfo } from '../lib/api'
import { SET_INFO } from '../lib/game'
import { Code, CodeBlock, Skeleton } from '../components/ui'

const rules = [
  ['裁判握着种子。', '每一局由服务器上的 GKMS 引擎推进，随机数种子和完整局面都在裁判手里。'],
  ['算法只看画面。', '每到一个决策点，算法拿到的是玩家在屏幕上能看到的信息：手牌、各牌区里有哪些牌（没有顺序）、状态、P 道具、饮料、合法动作。'],
  ['同题同种子比。', '所有算法打同一批题、同一批种子，按配对的分数比排名，误差一起给出。'],
  ['上限不排名。', '「看种子」的搜索提前知道之后抽什么牌，它只作分母，表示这局理论上能打多少分。'],
]

export function Home() {
  const sets = useApi<SetInfo[]>('api/sets')
  return (
    <div className="max-w-[880px]">
      <section className="pt-6 pb-10">
        <p className="text-[13px] font-medium tracking-wide text-accent-ink">学園アイドルマスター · 考试出牌</p>
        <h1 className="mt-2 text-[30px] leading-tight font-semibold tracking-tight text-ink">
          同一道题、同一个种子、同样的思考时间，<br className="hidden sm:inline" />
          看哪个出牌算法打得更高。
        </h1>
        <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-ink-2">
          gakumas-bench 是一个公开的评测场。题目来自实机开局和按主数据生成的审查题；每一局都由裁判按种子重放核对，分数、每一步的耗时和算法给出的理由都留档，能一路点到某一局的某一步。
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/sets" className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-[14px] font-medium text-white hover:bg-accent-ink">
            看排行 <ArrowRight size={15} aria-hidden />
          </Link>
          <a href="#join" className="inline-flex items-center rounded-md border border-line-strong px-3.5 py-2 text-[14px] text-ink hover:bg-surface-2">
            提交自己的算法
          </a>
        </div>
      </section>

      <section className="border-t border-line py-8">
        <h2 className="text-[17px] font-semibold text-ink">怎么比</h2>
        <ol className="mt-4 grid gap-x-10 gap-y-5 sm:grid-cols-2">
          {rules.map(([h, t], i) => (
            <li key={h} className="flex gap-3">
              <span className="num mt-0.5 text-[13px] font-semibold text-accent-ink">{String(i + 1).padStart(2, '0')}</span>
              <p className="leading-relaxed text-ink-2">
                <span className="font-medium text-ink">{h}</span>
                {t}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-line py-8">
        <h2 className="text-[17px] font-semibold text-ink">题集</h2>
        <div className="mt-3 divide-y divide-line">
          {sets.loading && <Skeleton className="my-3 h-12" />}
          {sets.data?.map((s) => (
            <Link key={s.set} to={`/sets/${s.set}`} className="group flex items-baseline gap-4 py-3.5">
              <span className="w-28 shrink-0 font-medium text-ink group-hover:text-accent-ink">{SET_INFO[s.set]?.title ?? s.set}</span>
              <span className="min-w-0 flex-1 text-ink-2">{SET_INFO[s.set]?.blurb ?? ''}</span>
              <span className="num shrink-0 text-[12.5px] text-muted">
                {s.problems} 题 · {s.seeds.dev + s.seeds.test} 种子 · {s.runs} 次运行
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section id="join" className="scroll-mt-16 border-t border-line py-8">
        <h2 className="text-[17px] font-semibold text-ink">怎么参与</h2>
        <p className="mt-2 max-w-[64ch] leading-relaxed text-ink-2">
          算法写成一个函数：拿到当前画面的观测（格式和 GKMS UINet 的 UIObs v1 相同），返回一个动作。两种交成绩的方式，都要先到「我的」页拿令牌。
        </p>
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="font-medium text-ink">本地跑，再上传</h3>
            <p className="mt-1 mb-3 text-ink-2">在自己机器上用同一个引擎跑完一整套题，上传后服务器按种子逐局重放核对。成绩标「自报」。</p>
            <CodeBlock>{`python -m gkbench run --set hif-live --algo uinet
python -m gkbench upload <运行目录>`}</CodeBlock>
          </div>
          <div>
            <h3 className="font-medium text-ink">托管跑</h3>
            <p className="mt-1 mb-3 text-ink-2">种子不离开服务器，算法每一步向服务器要观测、交动作，耗时以服务器计时为准。成绩标「托管」，测试集只能这样跑。</p>
            <CodeBlock>{`python -m gkbench hosted --set hif-live \\
    --algo uinet --budget 5`}</CodeBlock>
          </div>
        </div>
        <p className="mt-5 text-[13px] text-muted">
          数据格式见仓库里的 <Code>docs/format.md</Code>；接自己的算法：继承 <Code>gkbench.algos.base.Algorithm</Code>，实现 <Code>decide(ctx)</Code>。
        </p>
      </section>
    </div>
  )
}
