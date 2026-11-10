import { ExternalLink } from 'lucide-react'
import type { AlgoDoc } from '../lib/api'
import { cx } from './ui'

/** 看得到什么：只看画面（和玩家一样）/ 看牌序（提前知道整局的洗牌和随机结果，只作分母） */
export function SeesBadge({ sees }: { sees?: AlgoDoc['sees'] }) {
  if (!sees) return null
  const seed = sees === 'seed'
  return (
    <span
      className={cx(
        'rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        seed ? 'bg-brand-tint text-brand-ink' : 'bg-surface-3 text-ink-2',
      )}
    >
      {seed ? '看牌序' : '只看画面'}
    </span>
  )
}

/** 运行页的「算法说明」：大致思路、看得到什么、实现链接 */
export function AlgoAbout({ about }: { about?: AlgoDoc | null }) {
  return (
    <section className="mb-6 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[14px] font-bold text-ink">算法说明</h2>
        <SeesBadge sees={about?.sees} />
        {about?.source === 'submitter' && <span className="text-[11.5px] text-ink-3">提交人填写</span>}
      </div>
      {!about ? (
        <p className="mt-2 text-[13px] text-ink-3">提交人未提供算法说明。</p>
      ) : (
        <>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink">{about.summary}</p>
          {!!about.detail?.length && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink-2">
              {about.detail.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
          {(!!about.links?.length || !!about.private?.length) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2.5 text-[12.5px]">
              <span className="text-ink-3">实现</span>
              {about.links?.map((l) => (
                <a
                  key={l.url}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-brand-ink hover:underline"
                >
                  {l.title}
                  <ExternalLink size={12} strokeWidth={2} aria-hidden />
                </a>
              ))}
              {about.private?.map((p) => (
                <span key={p} className="text-ink-3">
                  {p}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
