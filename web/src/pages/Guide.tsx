import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useApi } from '../lib/hooks'
import { cardName, idolShort, spriteUrl, useCatalog, useLang, useTerms } from '../lib/catalog'
import { charOf } from '../lib/usage'
import { pairBi, type SupportCatalog } from '../lib/supports'
import { IDOL_STYLE } from '../lib/game'
import {
  ACTION_LABEL, applies, DECISIONS, GUIDE_MODES, item, LAYER_LABEL, layerOf, LEVEL_LABEL, levelOf, PLAN_KEY, sortEntries, STYLE_KEY,
  type GuideEntry, type GuideItem, type GuideItemObj, type GuideMode, type GuidePack, type Quartiles, type TowerDecks, type TowerExample, type TowerSeason,
} from '../lib/guides'
import { AttrChip, cx, Empty, ErrorState, Help, IdolThumb, PageHeader, SectionTitle, Skeleton, Tip } from '../components/ui'
import { CardDetail, CardImage, RarityTag } from '../components/CardDetail'
import { ItemDetail } from '../components/ItemDetail'
import { useDetailPopup } from '../components/DetailPopups'
import { SupportThumb, TypeChip } from '../components/SupportCard'
import { SkillCard } from '../components/GameBits'
import { parseDeckCard } from '../components/DeckView'

/** 偶像卡攻略：每张偶像卡一页，按决策点列出排行榜统计和人写攻略（docs/guides.md）。
 * 数据 api/guides/<模式>（gkbench.guides build 生成）；偶像之路是按层的汇总，点开一层再取这座塔的完整编成（api/guides/idolroad-decks-…） */

const modeOf = (v: string | null): GuideMode => (GUIDE_MODES.some((m) => m.key === v) ? (v as GuideMode) : 'hajime')
const pct = (v: number | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`)

function Chip({ on, children, onClick, disabled, hint }: { on?: boolean; children: React.ReactNode; onClick?: () => void; disabled?: boolean; hint?: string }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={hint}
      className={cx('h-9 rounded-full border px-3.5 text-[13px] transition-colors',
        on ? 'border-ink bg-ink font-semibold text-white' : disabled ? 'cursor-not-allowed border-dashed border-line-strong text-ink-3' : 'cursor-pointer border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink')}>
      {children}
    </button>
  )
}

function Bar({ v, full }: { v: number; full?: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="relative hidden h-[6px] w-24 overflow-hidden rounded-full bg-surface-3 sm:block">
        <i className="absolute inset-y-0 left-0 rounded-full bg-da/45" style={{ width: `${Math.min(100, v * 100)}%` }} />
        {full != null && <i className="absolute inset-y-0 left-0 rounded-full bg-da" style={{ width: `${Math.min(100, full * 100)}%` }} />}
      </span>
      <span className="num w-10 text-right font-semibold text-ink">{pct(v)}</span>
    </span>
  )
}

/** 一项：技能卡 / 支援卡 / P 道具 / 偶像卡 / 行动，按 ID 前缀认 */
function Thing({ id, sup, onCard, onItem, onSupport, onIdol }: { id: string; sup?: SupportCatalog; onCard: (id: string) => void; onItem: (id: string) => void; onSupport: (id: string) => void; onIdol: (id: string) => void }) {
  const cat = useCatalog()
  const { lang } = useLang()
  const cls = 'flex min-w-0 cursor-pointer items-center gap-2.5 text-left hover:text-brand-ink'
  if (id.startsWith('p_card-')) {
    const c = cat?.cards[id]
    return (
      <button type="button" className={cls} onClick={() => onCard(id)}>
        {c ? <CardImage c={c} size={30} /> : <span className="size-[30px] shrink-0 rounded-lg bg-surface-3" />}
        <span className="truncate">{cardName(cat, id)}</span>{c && <span className="max-sm:hidden"><RarityTag r={c.rarity} /></span>}
      </button>
    )
  }
  if (id.startsWith('s_card-')) {
    const s = sup?.cards[id]
    const name = pairBi(s?.name, lang, id)
    return (
      <button type="button" className={cls} onClick={() => onSupport(id)}>
        <SupportThumb id={id} size={32} />
        <span className="min-w-0">
          <span className="block truncate">{name.main}</span>
          {s && <span className="flex items-center gap-1 text-[11px] text-ink-3"><RarityTag r={s.rarity} /><TypeChip t={s.type} /></span>}
        </span>
      </button>
    )
  }
  if (id.startsWith('pitem_')) {
    const it = cat?.items[id]
    return (
      <Tip tip={<span className="whitespace-pre-line">{it?.text}</span>} wide>
        <button type="button" className={cls} onClick={() => onItem(id)}>
          <span className="size-[30px] shrink-0 overflow-hidden rounded-md bg-surface-2 ring-1 ring-line">{it?.asset && <img src={spriteUrl(it.asset)} alt="" className="size-full object-contain" />}</span>
          <span className="truncate">{it?.name ?? id}</span>
        </button>
      </Tip>
    )
  }
  if (id.startsWith('i_card-')) {
    return <button type="button" className={cls} onClick={() => onIdol(id)}><IdolThumb id={id} size={30} title={false} /><span className="truncate">{cat?.idols[id]?.name ?? id}</span></button>
  }
  if (id.startsWith('pdrink_')) return <span className="truncate">{cat?.drinks[id]?.name ?? id}</span>
  const attr = { vo: 1, da: 2, vi: 3 }[id]
  if (attr) return <AttrChip t={attr} />
  return <span className="font-semibold">{ACTION_LABEL[id] ?? id}</span>
}

type Open = { card: (id: string) => void; item: (id: string) => void; support: (id: string) => void; idol: (id: string) => void }

export function GuideIndex() {
  const cat = useCatalog()
  const terms = useTerms()
  const [q, setQ] = useSearchParams()
  const mode = modeOf(q.get('mode'))
  const style = q.get('style') ?? ''
  const pack = useApi<GuidePack>(mode === 'idolroad' ? null : `api/guides/${mode}`)
  const ids = useMemo(() => Object.keys(pack.data?.summary ?? {}).filter((k) => k.startsWith('i_card-')).sort(), [pack.data])
  const shown = ids.filter((i) => !style || cat?.idols[i]?.style === style)
  const set = (patch: Record<string, string>) => {
    const n = new URLSearchParams(q)
    for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k))
    setQ(n, { replace: true })
  }
  return (
    <div>
      <PageHeader title="偶像卡攻略" sub="每张偶像卡一页：排行榜前 100 名的编成、拿卡、删卡、强化和三维，加上人写的攻略。" />
      <div className="mb-5 space-y-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-12 text-[12.5px] text-ink-3">模式</span>
          {GUIDE_MODES.map((m) => <Chip key={m.key} on={mode === m.key} onClick={() => set({ mode: m.key === 'hajime' ? '' : m.key, style: '' })}>{m.label}</Chip>)}
        </div>
        {mode !== 'idolroad' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 text-[12.5px] text-ink-3">流派</span>
            <Chip on={!style} onClick={() => set({ style: '' })}>全部</Chip>
            {Object.keys(IDOL_STYLE).map((s) => <Chip key={s} on={style === s} onClick={() => set({ style: s })}>{terms.style[s]}</Chip>)}
          </div>
        )}
      </div>
      {mode === 'idolroad' ? <IdolRoadIndex /> : (
        <>
          {pack.error && <ErrorState error={pack.error} onRetry={pack.reload} />}
          {!pack.data && !pack.error && <Skeleton className="h-96 rounded-2xl" />}
          {pack.data && (shown.length === 0 ? <Empty>这个流派没有数据。</Empty> : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
              {shown.map((i) => (
                <li key={i}>
                  <Link to={`/guide/${i}${mode === 'hajime' ? '' : `?mode=${mode}`}`}
                    className="flex min-h-14 items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 hover:border-brand hover:bg-brand-tint">
                    <IdolThumb id={i} size={40} title={false} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] text-ink">{cat?.idols[i]?.name ?? i}</span>
                      <span className="text-[11.5px] text-ink-3">{terms.style[cat?.idols[i]?.style ?? ''] ?? ''} · 前 100 名 {pack.data!.summary[i].n} 份</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ))}
          {pack.data && <Source pack={pack.data} />}
        </>
      )}
    </div>
  )
}

function IdolRoadIndex() {
  const cat = useCatalog()
  const pack = useApi<GuidePack>('api/guides/idolroad')
  const season = Object.values(pack.data?.summary.seasons ?? {})[0]
  if (pack.error) return <ErrorState error={pack.error} onRetry={pack.reload} />
  if (!season) return <Skeleton className="h-60 rounded-2xl" />
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
      {Object.entries(season.towers).map(([tid, t]) => {
        const best = t.layers[t.layers.length - 1]?.idols[0]?.idol_card_id
        return (
          <li key={tid}>
            <Link to={`/guide/${best ?? tid}?mode=idolroad`} className="flex min-h-14 items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 hover:border-brand hover:bg-brand-tint">
              <IdolThumb id={best} size={40} title={false} />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] text-ink">{best ? idolShort(cat, best) : t.character} 的塔</span>
                <span className="text-[11.5px] text-ink-3">{t.layers.length} 层</span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function Source({ pack }: { pack: GuidePack }) {
  const r = pack.sources.ranking?.[0]
  return (
    <p className="mt-6 text-[12px] text-ink-3">
      攻略包 {pack.version}{r ? `；排行榜抓取 ${r.fetched}` : ''}。统计只用了终局记录（最终牌组、支援卡、回忆、三维），看不到培育过程；排行榜不分难度。
      人写攻略在 <a className="text-brand-ink hover:underline" href="https://github.com/matto49/gakumas-bench/tree/develop/guides/entries" target="_blank" rel="noreferrer">guides/entries</a>，欢迎提 PR。
    </p>
  )
}

export function GuidePage() {
  const { idol = '' } = useParams()
  const cat = useCatalog()
  const terms = useTerms()
  const [q, setQ] = useSearchParams()
  const mode = modeOf(q.get('mode'))
  const pack = useApi<GuidePack>(`api/guides/${mode}`)
  const sup = useApi<SupportCatalog>('api/supports')
  const [openCard, setOpenCard] = useState<string | null>(null)
  const [openItem, setOpenItem] = useState<string | null>(null)
  const detail = useDetailPopup()
  const open: Open = { card: setOpenCard, item: setOpenItem, support: (id) => detail.open('support', id), idol: (id) => detail.open('idol', id) }
  const info = cat?.idols[idol]
  const ctx = { mode, idol, style: STYLE_KEY[info?.style ?? ''], plan: PLAN_KEY[info?.plan ?? ''] }
  const d = pack.data
  const mine = useMemo(() => (d ? sortEntries(d.entries.filter((e) => applies(e, ctx))) : []), [d, idol, ctx.style, ctx.plan])
  const summary = d?.summary[idol]
  const setMode = (m: string) => setQ(m === 'hajime' ? {} : { mode: m }, { replace: true })

  return (
    <div>
      <PageHeader
        crumb={<Link to={`/guide${mode === 'hajime' ? '' : `?mode=${mode}`}`} className="hover:text-brand-ink">偶像卡攻略</Link>}
        title={<span className="flex items-center gap-3"><IdolThumb id={idol} size={48} title={false} /><span className="min-w-0">{info?.name ?? idol}</span></span>}
        sub={info && <>{terms.plan[info.plan ?? ''] ?? ''} · {terms.style[info.style ?? ''] ?? ''}{summary && <> · 排行榜前 100 名 {summary.n} 份，分数中位数 <span className="num">{Math.round(summary.score_p50).toLocaleString()}</span>，最高 <span className="num">{summary.score_max.toLocaleString()}</span></>}</>}
      />
      <div className="mb-6 flex flex-wrap gap-2">
        {GUIDE_MODES.map((m) => <Chip key={m.key} on={mode === m.key} onClick={() => setMode(m.key)}>{m.label}</Chip>)}
      </div>
      {pack.error && <ErrorState error={pack.error} onRetry={pack.reload} />}
      {!d && !pack.error && <Skeleton className="h-96 rounded-2xl" />}
      {d && mode === 'idolroad' && <IdolRoad idol={idol} seasons={d.summary.seasons ?? {}} open={open} sup={sup.data ?? undefined} />}
      {d && mode !== 'idolroad' && (
        <>
          {!summary && <div className="mb-6"><Empty>这个模式的排行榜里没有这张偶像卡的记录，下面只有通用的攻略。</Empty></div>}
          {(['开局编成', '培育', '考试'] as const).map((g) => (
            <section key={g} className="mb-8">
              <SectionTitle>{g}</SectionTitle>
              <div className="space-y-5">
                {DECISIONS.filter((x) => x.group === g).map((x) => (
                  <Decision key={x.key} label={x.label} hint={x.hint} canStat={x.stat}
                    entries={mine.filter((e) => e.decision === x.key)} decision={x.key} open={open} sup={sup.data ?? undefined} />
                ))}
              </div>
            </section>
          ))}
          {summary && summary.final_pitems.length > 0 && (
            <section className="mb-8">
              <SectionTitle>终局 P 道具（参考）</SectionTitle>
              <ItemRows rows={summary.final_pitems.map((r) => ({ id: r.id, stat: { share: r.share } }))} open={open} sup={sup.data ?? undefined} cols={['share']} />
            </section>
          )}
          <Source pack={d} />
        </>
      )}
      {openCard && cat?.cards[openCard] && <CardDetail id={openCard} c={cat.cards[openCard]} onClose={() => setOpenCard(null)} />}
      {openItem && cat && <ItemDetail id={openItem} cat={cat} onClose={() => setOpenItem(null)} />}
      {detail.popup}
    </div>
  )
}

function Decision({ label, hint, canStat, entries, decision, open, sup }: {
  label: string; hint?: string; canStat: boolean; entries: GuideEntry[]; decision: string; open: Open; sup?: SupportCatalog
}) {
  const written = entries.filter((e) => e.kind === 'written')
  const stat = entries.find((e) => e.kind === 'stat')
  return (
    <div className="rounded-2xl border border-line bg-surface">
      <h3 className="flex items-center border-b border-line px-4 py-2.5 text-[14px] font-bold text-ink">{label}{hint && <Help tip={hint} />}</h3>
      <div className="space-y-3 p-3 sm:p-4">
        {written.map((e) => <Written key={e.id} e={e} open={open} sup={sup} />)}
        {stat ? <StatBlock e={stat} decision={decision} open={open} sup={sup} />
          : written.length === 0 && <p className="px-1 py-2 text-[13px] text-ink-3">{canStat ? '这张偶像卡在这个模式没有统计。' : '暂无统计（排行榜只有终局，看不出这一步）。'}还没有人写这一项的攻略。</p>}
      </div>
    </div>
  )
}

function Written({ e, open, sup }: { e: GuideEntry; open: Open; sup?: SupportCatalog }) {
  const lv = levelOf(e)
  const remove = e.decision === 'card_remove'
  const list = (xs: GuideItem[] | undefined, title: string) => xs && xs.length > 0 && (
    <div>
      <p className="mb-1 text-[12px] text-ink-3">{title}</p>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
        {xs.map(item).map((it) => (
          <li key={it.id} className="flex items-center gap-1.5 text-[13.5px]">
            <Thing id={it.id} sup={sup} onCard={open.card} onItem={open.item} onSupport={open.support} onIdol={open.idol} />
            <ItemNotes it={it} />
          </li>
        ))}
      </ul>
    </div>
  )
  return (
    <article className="rounded-xl border border-brand/40 bg-brand-tint/40 px-3 py-3 sm:px-4">
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <span className="rounded-full bg-brand-deep px-2 py-0.5 font-bold text-white">{lv ? LEVEL_LABEL[lv] : '人写'}</span>
        <span className="rounded-full bg-surface px-2 py-0.5 text-ink-2 ring-1 ring-line">{LAYER_LABEL[layerOf(e.scope)]}</span>
        {e.scope.difficulty && <span className="rounded-full bg-surface px-2 py-0.5 text-ink-2 ring-1 ring-line">难度 {e.scope.difficulty}</span>}
        {e.scope.pool?.requires?.length ? <span className="rounded-full bg-surface px-2 py-0.5 text-ink-2 ring-1 ring-line">需要特定的卡</span> : null}
      </div>
      {e.content.why && <p className="mb-2 text-[13.5px] leading-relaxed text-ink">{e.content.why}</p>}
      <div className="space-y-2">
        {list(e.content.prefer, remove ? '保护，不删' : '推荐')}
        {list(e.content.avoid, remove ? '先删' : '避开')}
      </div>
      {e.content.unless?.text && <p className="mt-2 text-[12.5px] text-ink-2">不适用：{e.content.unless.text}</p>}
      {e.content.fallback && <p className="mt-1 text-[12.5px] text-ink-2">都没有时：{e.content.fallback}</p>}
      <p className="mt-2 text-[11.5px] text-ink-3">
        出处：{e.evidence.map((ev, i) => (
          <span key={i}>{i > 0 && '、'}{ev.kind === 'ranking' ? `排行榜 ${ev.n?.toLocaleString() ?? ''} 份（${ev.fetched ?? ''}）`
            : ev.url ? <a href={ev.url} target="_blank" rel="noreferrer" className="text-brand-ink hover:underline">{ev.ref}</a> : ev.ref ?? ev.kind}</span>
        ))}{e.updated && ` · ${e.updated}`}
      </p>
    </article>
  )
}

function ItemNotes({ it }: { it: GuideItemObj }) {
  const bits = [
    it.min_limit != null && (it.min_limit === 4 ? '满凸' : `${it.min_limit} 凸以上`),
    it.keep != null && `最多 ${it.keep} 张`,
    it.custom?.length && `定制 ${it.levels ?? ''}${it.full ? '（做满）' : ''}`,
    it.attr && it.attr.toUpperCase(),
    it.note,
  ].filter(Boolean)
  return bits.length ? <span className="text-[11.5px] text-ink-3">{bits.join(' · ')}</span> : null
}

type Col = 'share' | 'split' | 'limit' | 'copies' | 'upgraded' | 'kept'
const COL_HEAD: Record<Col, React.ReactNode> = {
  share: '出现比例',
  split: <>满凸 / 非满凸<Help tip="带这张支援卡的记录里，满凸和没满凸各占全部记录的比例。条的深色段是满凸" /></>,
  limit: <>平均凸数<Help tip="带这张卡的记录里，突破档（0–4）的平均" /></>,
  copies: <>张数<Help tip="带这张卡的记录里，平均带几张" /></>,
  upgraded: '强化过',
  kept: <>留存<Help tip="初始牌组里这张卡到终局还剩几成（终局张数 / 初始张数）；越低说明删得越多" /></>,
}

function ItemRows({ rows, cols, open, sup, limit = 10 }: { rows: GuideItemObj[]; cols: Col[]; open: Open; sup?: SupportCatalog; limit?: number }) {
  const [all, setAll] = useState(false)
  if (!rows.length) return <p className="px-1 text-[13px] text-ink-3">没有占比到 5% 的项。</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full max-w-4xl table-fixed text-[13.5px] sm:table-auto">
        <thead className="text-[12px] text-ink-3"><tr>
          <th className="w-7 px-1 py-1.5 text-left font-semibold sm:w-8 sm:px-2">#</th>
          <th className="px-2 py-1.5 text-left font-semibold">&nbsp;</th>
          {cols.map((c) => <th key={c} className={cx('px-1 py-1.5 text-right font-semibold sm:px-2', c === 'split' ? 'w-[7.5rem] sm:w-auto' : 'w-[4.2rem] sm:w-auto')}>{COL_HEAD[c]}</th>)}
        </tr></thead>
        <tbody>
          {rows.slice(0, all ? rows.length : limit).map((r, i) => (
            <tr key={r.id} className="border-t border-line hover:bg-brand-tint">
              <td className="num px-1 py-1.5 text-ink-3 sm:px-2">{i + 1}</td>
              <td className="min-w-0 overflow-hidden px-1 py-1.5 sm:max-w-[18rem] sm:px-2"><Thing id={r.id} sup={sup} onCard={open.card} onItem={open.item} onSupport={open.support} onIdol={open.idol} /></td>
              {cols.map((c) => (
                <td key={c} className="num px-1 py-1.5 text-right text-ink-2 sm:px-2">
                  {c === 'share' && <span className="flex justify-end"><Bar v={r.stat?.share ?? 0} /></span>}
                  {c === 'split' && <span className="flex items-center justify-end gap-2"><span className="text-right sm:hidden"><b className="text-ink">{pct(r.stat?.share)}</b><br /><span className="text-[11px]">{pct(r.stat?.share_full)} / {pct(r.stat?.share_nonfull)}</span></span><span className="max-sm:hidden"><Bar v={r.stat?.share ?? 0} full={r.stat?.share_full} /></span><span className="whitespace-nowrap text-[12px] max-sm:hidden sm:w-[5.5rem]">{pct(r.stat?.share_full)} / {pct(r.stat?.share_nonfull)}</span></span>}
                  {c === 'limit' && (r.stat?.limit_mean?.toFixed(1) ?? '—')}
                  {c === 'copies' && (r.stat?.copies?.toFixed(1) ?? '—')}
                  {c === 'upgraded' && pct(r.stat?.upgraded)}
                  {c === 'kept' && pct(r.stat?.kept)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1 h-10 w-full max-w-4xl cursor-pointer rounded-lg text-[13px] text-brand-ink hover:bg-brand-tint">
          {all ? '收起' : `展开全部 ${rows.length} 项`}
        </button>
      )}
    </div>
  )
}

function StatBlock({ e, decision, open, sup }: { e: GuideEntry; decision: string; open: Open; sup?: SupportCatalog }) {
  const [lowLimit, setLowLimit] = useState(false)
  const ev = e.evidence[0]
  const prefer = (e.content.prefer ?? []).map(item)
  const head = (
    <p className="mb-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
      <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-ink-2 ring-1 ring-line">排行榜统计</span>
      前 100 名 {ev?.n} 份 · {ev?.fetched}{ev?.low_sample && <span className="rounded-full bg-critical/10 px-2 py-0.5 text-critical">样本少</span>}
    </p>
  )
  let body: React.ReactNode
  if (decision === 'formation.support') {
    const rows = lowLimit ? [...prefer].sort((a, b) => (b.stat?.share_nonfull ?? 0) - (a.stat?.share_nonfull ?? 0)).filter((r) => (r.stat?.share_nonfull ?? 0) > 0) : prefer
    body = (
      <>
        <div className="mb-2 flex flex-wrap gap-2">
          <Chip on={!lowLimit} onClick={() => setLowLimit(false)}>按出现比例</Chip>
          <Chip on={lowLimit} onClick={() => setLowLimit(true)}>没满凸的玩家怎么选</Chip>
        </div>
        {lowLimit && <p className="mb-2 text-[12px] text-ink-3">只看没满凸时的出现比例排序：卡没凸满时，排在前面的是大家实际拿来替代的。不做数值折算。</p>}
        <ItemRows rows={rows} cols={lowLimit ? ['split', 'limit'] : ['split', 'limit']} open={open} sup={sup} />
      </>
    )
  } else if (decision === 'formation.main_attr') {
    body = <ItemRows rows={prefer} cols={['share']} open={open} sup={sup} />
  } else if (decision === 'card_pick') {
    body = <ItemRows rows={prefer} cols={['share', 'copies', 'upgraded']} open={open} sup={sup} />
  } else if (decision === 'formation.memory') {
    body = <ItemRows rows={prefer} cols={['share', 'upgraded']} open={open} sup={sup} />
  } else if (decision === 'card_upgrade') {
    body = <ItemRows rows={prefer} cols={['share', 'upgraded']} open={open} sup={sup} />
  } else if (decision === 'card_remove') {
    const avoid = (e.content.avoid ?? []).map(item)
    body = avoid.length ? <ItemRows rows={avoid} cols={['kept']} open={open} sup={sup} /> : <p className="px-1 text-[13px] text-ink-3">初始牌组的卡基本都留到了终局。</p>
  } else if (decision === 'params_target') {
    const t = e.content.targets ?? {}
    body = (
      <div className="grid grid-cols-3 gap-2">
        {(['vo', 'da', 'vi'] as const).map((a) => {
          const v = t[a] as Quartiles | undefined
          return (
            <div key={a} className="rounded-xl bg-surface-2 px-3 py-2 text-center">
              <span className={cx('inline-grid h-5 place-items-center rounded-[4px] px-1.5 text-[11px] font-bold', a === 'vi' ? 'bg-vi-strong text-ink' : a === 'vo' ? 'bg-vo-strong text-white' : 'bg-da-strong text-white')}>{a.toUpperCase()}</span>
              <p className="disp mt-1 text-[22px] leading-none text-ink">{v?.p50?.toLocaleString() ?? '—'}</p>
              <p className="num mt-1 text-[11.5px] text-ink-3">{v ? `${v.p25.toLocaleString()} – ${v.p75.toLocaleString()}` : ''}</p>
            </div>
          )
        })}
        <p className="col-span-3 text-[11.5px] text-ink-3">终局三维的中位数，下面是中间一半的范围（25% – 75%）。</p>
      </div>
    )
  } else {
    body = <ItemRows rows={prefer} cols={['share']} open={open} sup={sup} />
  }
  return <div>{head}{body}</div>
}

function IdolRoad({ idol, seasons, open, sup }: { idol: string; seasons: Record<string, TowerSeason>; open: Open; sup?: SupportCatalog }) {
  const cat = useCatalog()
  const names = Object.keys(seasons).sort().reverse()
  const [season, setSeason] = useState(names.find((n) => n.startsWith('current')) ?? names[0])
  const [layer, setLayer] = useState<number | null>(null)
  const s = seasons[season]
  const tower = s && Object.entries(s.towers).find(([, t]) => t.character === charOf(idol))
  if (!tower) return <Empty>这位偶像没有偶像之路的塔。</Empty>
  const [, t] = tower
  const L = layer == null ? null : t.layers.find((x) => x.layer === layer)
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {names.map((n) => <Chip key={n} on={season === n} onClick={() => { setSeason(n); setLayer(null) }}>{n.startsWith('current') ? '本赛季' : '上赛季'}（{n.split('-')[1].slice(0, 4)}.{n.split('-')[1].slice(4, 6)}）</Chip>)}
      </div>
      <p className="mb-3 text-[12.5px] text-ink-3">{idolShort(cat, idol)} 的塔：每层每张偶像卡排行榜前 100 名的分数。点一层看这一层的完整编成（开局卡组）、常见的换卡和编成里的回忆。</p>
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[620px] text-[13.5px]">
          <thead className="bg-surface-2 text-[12px] text-ink-3"><tr>
            <th className="px-3 py-2 text-left font-semibold">层</th>
            <th className="px-3 py-2 text-left font-semibold">这张卡的名次<Help tip="这一层各偶像卡按第 10 名的分数排，这张卡排第几" /></th>
            <th className="px-3 py-2 text-right font-semibold">第 1 名</th>
            <th className="px-3 py-2 text-right font-semibold">第 10 名</th>
            <th className="px-3 py-2 text-right font-semibold">第 100 名</th>
            <th className="px-3 py-2 text-left font-semibold">这一层最强的卡</th>
          </tr></thead>
          <tbody>
            {[...t.layers].sort((a, b) => b.layer - a.layer).map((x) => {
              const ranked = [...x.idols].sort((a, b) => b.r10 - a.r10)
              const k = ranked.findIndex((r) => r.idol_card_id === idol)
              const me = ranked[k]
              return (
                <tr key={x.layer} onClick={() => setLayer(layer === x.layer ? null : x.layer)}
                  className={cx('cursor-pointer border-t border-line hover:bg-brand-tint', layer === x.layer && 'bg-brand-soft')}>
                  <td className="num px-3 py-1.5 font-semibold">{x.layer}</td>
                  <td className="num px-3 py-1.5">{me ? `${k + 1} / ${ranked.length}` : '—'}</td>
                  <td className="num px-3 py-1.5 text-right">{me?.top.toLocaleString() ?? '—'}</td>
                  <td className="num px-3 py-1.5 text-right">{me?.r10.toLocaleString() ?? '—'}</td>
                  <td className="num px-3 py-1.5 text-right">{me?.r100.toLocaleString() ?? '—'}</td>
                  <td className="px-3 py-1.5"><span className="flex items-center gap-1.5"><IdolThumb id={ranked[0]?.idol_card_id} size={22} title={false} /><span className="truncate text-[12.5px] text-ink-2">{ranked[0] ? cat?.idols[ranked[0].idol_card_id]?.name : ''}</span></span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {L && t.decks && <LayerDecks file={t.decks} layer={L.layer} idol={idol} open={open} sup={sup} />}
      {L && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="mb-2 text-[14px] font-bold">第 {L.layer} 层编成里的回忆<Help tip={`这一层 ${L.n_histories} 条编成里，用到这张偶像卡回忆的比例`} /></h3>
            <ItemRows rows={L.memories.map((m) => ({ id: m.id, stat: { share: m.share } }))} cols={['share']} open={open} sup={sup} limit={12} />
          </div>
          <div className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="mb-2 text-[14px] font-bold">第 {L.layer} 层常见的换卡<Help tip="前 5 名牌组里，「换卡」把哪张换成了哪张，按次数排" /></h3>
            <ul className="space-y-1.5 text-[13px]">
              {L.conversions.map((c, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <Thing id={c.before} sup={sup} onCard={open.card} onItem={open.item} onSupport={open.support} onIdol={open.idol} />
                  <span className="text-ink-3">→</span>
                  <Thing id={c.after} sup={sup} onCard={open.card} onItem={open.item} onSupport={open.support} onIdol={open.idol} />
                  <span className="num text-ink-3">{c.count} 次</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

/** 一层的完整编成：排行接口每层给 10 条玩家记录，带回忆的考试牌，按偶像之路的规则拼出开局卡组 */
function LayerDecks({ file, layer, idol, open, sup }: { file: string; layer: number; idol: string; open: Open; sup?: SupportCatalog }) {
  const cat = useCatalog()
  const d = useApi<TowerDecks>(`api/guides/${file}`)
  const all = d.data?.layers[String(layer)] ?? []
  const mine = all.filter((e) => e.idol === idol)
  const [onlyMine, setOnlyMine] = useState(true)
  const shown = onlyMine && mine.length ? mine : all
  if (d.error) return <div className="mt-4"><ErrorState error={d.error} onRetry={d.reload} /></div>
  if (!d.data) return <Skeleton className="mt-4 h-60 rounded-2xl" />
  if (!all.length) return null
  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-bold">第 {layer} 层的完整编成<Help tip="排行接口每层给 10 条玩家记录（不分偶像卡），带每份回忆的考试牌。开局卡组按游戏规则拼：主回忆的考试牌，再接副回忆的（不能重复的卡只留强化最多的那张），最后加 2 张初始卡。三维和体力 = 主回忆 + 每份副回忆的 20%。不显示玩家信息" /></h3>
        <span className="text-[12.5px] text-ink-3">{all.length} 条，用 {idolShort(cat, idol)} 当主回忆的 {mine.length} 条</span>
        {mine.length > 0 && mine.length < all.length && (
          <span className="ml-auto flex gap-1.5">
            <Chip on={onlyMine} onClick={() => setOnlyMine(true)}>只看这张卡</Chip>
            <Chip on={!onlyMine} onClick={() => setOnlyMine(false)}>全部 {all.length} 条</Chip>
          </span>
        )}
      </div>
      <div className="space-y-3">
        {shown.map((e, i) => <TowerDeck key={i} e={e} rank={all.indexOf(e) + 1} open={open} sup={sup} />)}
      </div>
    </section>
  )
}

function TowerDeck({ e, rank, open, sup }: { e: TowerExample; rank: number; open: Open; sup?: SupportCatalog }) {
  const cat = useCatalog()
  const cards = e.deck.map(parseDeckCard).filter((c): c is NonNullable<typeof c> => !!c)
  return (
    <article className="rounded-xl border border-line bg-surface-2/60 p-3">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="num text-[12px] text-ink-3">#{rank}</span>
        <span className="num text-[18px] font-bold text-ink">{e.score.toLocaleString()}</span>
        <span className="flex items-center gap-1">
          {e.memories.map((m, j) => (
            <Tip key={j} tip={<span className="block"><b>{j === 0 ? '主回忆' : `副回忆 ${j}`}</b>：{cat?.idols[m.idol]?.name ?? m.idol}<br />评价 {m.grade} · Vo {m.vo} / Da {m.da} / Vi {m.vi} · 体力 {m.stamina}</span>}>
              <button type="button" onClick={() => open.idol(m.idol)} className={cx('relative cursor-pointer rounded-md', j === 0 && 'ring-2 ring-brand')}>
                <IdolThumb id={m.idol} size={j === 0 ? 34 : 28} title={false} />
                <span className="absolute -right-1 -bottom-1 rounded bg-ink/75 px-0.5 text-[9px] leading-tight font-bold text-white">{m.grade}</span>
              </button>
            </Tip>
          ))}
        </span>
        <span className="flex items-center gap-2 text-[12.5px] text-ink-2">
          {e.params.map((v, j) => <span key={j} className="inline-flex items-center gap-1"><AttrChip t={j + 1} size="xs" /><span className="num">{v.toLocaleString()}</span></span>)}
          <span>体力 <span className="num">{e.stamina}</span></span>
        </span>
      </header>
      <div className="mt-3">
        <div className="mb-1.5 text-[12px] font-semibold text-ink-2">开局卡组 {cards.length} 张</div>
        <div className="flex flex-wrap gap-1">
          {cards.map((c, j) => (
            <button key={j} type="button" onClick={() => open.card(c.id)} className="cursor-pointer rounded-md">
              <SkillCard card={c} size={44} />
            </button>
          ))}
        </div>
      </div>
      {(e.items.length > 0 || e.conversions.length > 0) && (
        <div className="mt-3 grid gap-3 text-[12.5px] md:grid-cols-2">
          {e.items.length > 0 && (
            <div>
              <div className="mb-1 font-semibold text-ink-2">P 道具（主回忆的）</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">{e.items.map((id) => <Thing key={id} id={id} sup={sup} onCard={open.card} onItem={open.item} onSupport={open.support} onIdol={open.idol} />)}</div>
            </div>
          )}
          {e.conversions.length > 0 && (
            <details>
              <summary className="cursor-pointer font-semibold text-ink-2">换卡设置 {e.conversions.length} 条</summary>
              <ul className="mt-1.5 space-y-1">
                {e.conversions.map(([b, a], j) => (
                  <li key={j} className="flex flex-wrap items-center gap-2">
                    <Thing id={b} sup={sup} onCard={open.card} onItem={open.item} onSupport={open.support} onIdol={open.idol} />
                    <span className="text-ink-3">→</span>
                    <Thing id={a} sup={sup} onCard={open.card} onItem={open.item} onSupport={open.support} onIdol={open.idol} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </article>
  )
}

