import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { useCatalog } from '../../lib/catalog'
import { int } from '../../lib/format'
import { clearHistory, dropSaved, listHistory, listSaved, seasonLabel, type ContestHistory, type ContestSeasons } from '../../lib/contest'
import { Button } from '@/components/ui/button'
import { Select } from '../Select'
import { Empty, IdolThumb, SectionTitle } from '../ui'

const stageKey = (season: string, stage: number) => `${season}#${stage}`
/** 本地时间「11-24 02:11」 */
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

/** 比较：本机最近的模拟记录（同一舞台画在同一条分数轴上）和保存的编成；都能「载入」回模拟器 */
export function Compare({ seasons }: { seasons: ContestSeasons }) {
  const cat = useCatalog()
  const [hist, setHist] = useState(listHistory)
  const [saved, setSaved] = useState(listSaved)
  const label = (season: string, stage: number) => {
    const s = seasons.seasons.find((x) => x.id === season)
    return `${s ? seasonLabel(s) : season} · 舞台 ${stage + 1}`
  }
  const stages = useMemo(() => {
    const m = new Map<string, number>()
    for (const h of hist) m.set(stageKey(h.season, h.stage), (m.get(stageKey(h.season, h.stage)) ?? 0) + 1)
    return [...m.entries()]
  }, [hist])
  const [pick, setPick] = useState('')
  const cur = pick && stages.some(([k]) => k === pick) ? pick : stages[0]?.[0] ?? ''
  const rows = hist.filter((h) => stageKey(h.season, h.stage) === cur).sort((a, b) => b.stats.mean - a.stats.mean)

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle right={hist.length > 0 && (
          <Button variant="outline" className="h-[36px]" onClick={() => { clearHistory(); setHist([]) }}><Trash2 size={14} />清空记录</Button>
        )}>最近的模拟</SectionTitle>
        {hist.length === 0 ? <Empty>还没有模拟记录。在模拟器里跑一次，结果会记在这里（只存在这台设备的浏览器里）。</Empty> : (
          <>
            <div className="mb-3 max-w-xs">
              <Select label="舞台" value={cur} onChange={setPick}
                options={stages.map(([k, n]) => { const [s, st] = k.split('#'); return { value: k, label: label(s, Number(st)), hint: `${n} 条` } })} />
            </div>
            <StageRows rows={rows} idolName={(id) => cat?.idols[id]?.name ?? id} />
          </>
        )}
      </section>

      <section>
        <SectionTitle>保存的编成</SectionTitle>
        {saved.length === 0 ? <Empty>还没有保存的编成。在模拟器里点「保存到本机」。</Empty> : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {saved.map((s) => (
              <li key={s.name} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <IdolThumb id={s.idol} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{s.name}</span>
                  <span className="block text-[12px] text-ink-3">{label(s.season, s.stage)} · {when(s.at)}</span>
                </span>
                <Link to={`/contest?c=${s.code}`} className="inline-flex h-[40px] items-center rounded-full border border-line px-4 text-[13px] font-semibold text-ink hover:border-brand hover:text-brand-ink">载入</Link>
                <button type="button" aria-label={`删掉 ${s.name}`} onClick={() => { dropSaved(s.name); setSaved(listSaved()) }}
                  className="grid size-[40px] cursor-pointer place-items-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink"><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** 同一舞台的几条记录：每条一行，P10–P90 区间条 + 平均点画在同一条分数轴上 */
function StageRows({ rows, idolName }: { rows: ContestHistory[]; idolName: (id: string) => string }) {
  const lo = Math.min(...rows.map((r) => r.stats.p10)), hi = Math.max(...rows.map((r) => r.stats.p90))
  const span = hi - lo || 1
  const pct = (v: number) => `${((v - lo) / span) * 92 + 4}%`
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.at} className="grid gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(12em,1fr)_2fr_auto] sm:items-center">
            <span className="flex min-w-0 items-center gap-2.5">
              <IdolThumb id={r.idol} size={32} />
              <span className="min-w-0">
                <span className="block truncate font-semibold text-ink">{r.name || idolName(r.idol)}</span>
                <span className="block text-[12px] text-ink-3">{when(r.at)} · {int(r.runs)} 局</span>
              </span>
            </span>
            <span className="relative h-6" role="img" aria-label={`平均 ${int(r.stats.mean)}，P10 ${int(r.stats.p10)}，P90 ${int(r.stats.p90)}`}>
              <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand/35" style={{ left: pct(r.stats.p10), width: `calc(${pct(r.stats.p90)} - ${pct(r.stats.p10)})` }} />
              <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-brand-deep" style={{ left: pct(r.stats.mean) }} />
            </span>
            <span className="flex items-center gap-3">
              <span className="num text-right text-[13px]">平均 <b className="text-ink">{int(r.stats.mean)}</b><span className="ml-2 text-ink-3">中位 {int(r.stats.median)}</span></span>
              <Link to={`/contest?c=${r.code}`} className="inline-flex h-[40px] items-center rounded-full border border-line px-4 text-[13px] font-semibold text-ink hover:border-brand hover:text-brand-ink">载入</Link>
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-2 text-[12px] text-ink-3">点是平均分，浅色条是 P10–P90。同一舞台的记录共用一条分数轴（{int(lo)}–{int(hi)}）。</p>
    </div>
  )
}
