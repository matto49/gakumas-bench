import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Calculator, Copy, Link2, Plus, Save, Trash2, X } from 'lucide-react'
import { cardName, idolThumbUrl, spriteUrl, useCatalog, useTerms } from '../../lib/catalog'
import type { DeckCard } from '../../lib/assist'
import {
  combine, emptyLoadout, packGC1, planFits, saveLoadout, seasonLabel, stagePlan,
  type ContestLoadout, type ContestSeasons,
} from '../../lib/contest'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Picker, type PickItem } from '../assist/Picker'
import { CustomizeDialog, NumInput } from '../assist/Editor'
import { Select } from '../Select'
import { cx, IdolThumb } from '../ui'
import { PlanText, StageBar, StageItems } from './Common'

type Pick = null | 'idol' | 'item' | 'main' | 'sub'

/** 竞技场编成：舞台 → 偶像卡 → 数值 → P 道具 → 主 / 副回忆技能卡 → 局数和操作 */
export function Editor({ seasons, value, onChange, runs, setRuns, onRun, blocked, busy }: {
  seasons: ContestSeasons
  value: ContestLoadout
  onChange: (l: ContestLoadout) => void
  runs: number
  setRuns: (n: number) => void
  onRun: () => void
  /** 不能模拟的原因；null = 可以 */
  blocked: string | null
  busy: boolean
}) {
  const cat = useCatalog()
  const terms = useTerms()
  const l = value
  const set = (p: Partial<ContestLoadout>) => onChange({ ...l, ...p })
  const season = seasons.seasons.find((s) => s.id === l.season) ?? seasons.seasons[0]
  const stage = season?.stages[l.stage]
  const idol = cat?.idols[l.idol]
  const idolOk = !l.idol || planFits(stage, idol?.plan)
  const [pick, setPick] = useState<Pick>(null)
  const [custom, setCustom] = useState<{ group: 'main' | 'sub'; i: number } | null>(null)

  // 选择弹窗的候选：偶像卡按舞台计划，卡和道具按偶像卡计划（加通用）
  const items = useMemo((): PickItem[] => {
    if (!cat || !pick) return []
    if (pick === 'idol') {
      const need = stagePlan(stage)
      return Object.entries(cat.idols)
        .filter(([, d]) => !need || d.plan === need)
        .map(([id, d]) => ({ id, name: d.name, sub: [d.rarity, d.plan && (terms.plan as Record<string, string>)[d.plan]].filter(Boolean).join(' · '), img: idolThumbUrl(id) }))
    }
    const plan = idol?.plan
    const fits = (p?: string) => !plan || !p || p === plan || p === 'COMMON'
    if (pick === 'item') {
      return Object.entries(cat.items)
        .filter(([, d]) => fits(d.plan))
        .map(([id, d]) => ({ id, name: d.name, sub: d.rarity, text: d.text, img: d.asset ? spriteUrl(d.asset) : undefined }))
    }
    return Object.entries(cat.cards)
      .filter(([, c]) => fits(c.plan))
      .map(([id, c]) => ({ id, name: c.name, sub: [c.rarity, c.plan && (terms.plan as Record<string, string>)[c.plan]].filter(Boolean).join(' · '), text: c.up['0']?.text, img: c.asset ? spriteUrl(c.asset) : undefined }))
  }, [cat, pick, stage, idol?.plan, terms])

  const onPick = (id: string) => {
    if (pick === 'idol') { set({ idol: id }); setPick(null); return }
    if (pick === 'item') { if (l.items.length < 4) set({ items: [...l.items, id] }); return }
    if (pick === 'main' || pick === 'sub') {
      const xs = l[pick]
      if (xs.length < 6) set({ [pick]: [...xs, { id, up: 0, cz: [] }] } as Partial<ContestLoadout>)
    }
  }

  const copyCode = async () => {
    await navigator.clipboard.writeText(await packGC1(l))
    toast.success('编成码已复制', { description: '发给别人，或者贴到分享链接里' })
  }
  const copyLink = async () => {
    const code = await packGC1(l)
    await navigator.clipboard.writeText(`${location.origin}/contest?c=${code}`)
    toast.success('分享链接已复制', { description: '打开就是这份编成和舞台' })
  }
  const save = async () => {
    const name = l.name.trim() || `${idol?.name ?? '编成'} · ${seasonLabel(season)} 舞台 ${l.stage + 1}`
    if (await saveLoadout(l, name)) toast.success('存到本机了', { description: name })
    else toast.error('浏览器不让存', { description: '可能是隐私模式或者存储满了' })
  }

  return (
    <section className="space-y-5 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      {/* 1. 舞台 */}
      <Block title="舞台">
        <div className="mb-2.5 max-w-xs">
          <Select label="赛季" value={season?.id ?? ''} onChange={(v) => set({ season: v, stage: 0 })}
            options={seasons.seasons.map((s, i) => ({ value: s.id, label: seasonLabel(s), hint: i === 0 ? '最新' : '卡牌效果按现在的版本' }))} />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {season?.stages.map((st, i) => (
            <button key={i} type="button" aria-pressed={l.stage === i} onClick={() => set({ stage: i })}
              className={cx('min-h-[44px] cursor-pointer rounded-xl border p-3 text-left transition-colors',
                l.stage === i ? 'border-brand bg-brand-tint' : 'border-line hover:border-line-strong')}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-bold text-ink">舞台 {i + 1}</span>
                <span className="text-[12.5px] text-ink-2"><PlanText stage={st} /> · <span className="num">{st.turn}</span> 回合</span>
              </span>
              <StageBar stage={st} className="mt-2" />
              <span className="mt-2 flex items-center gap-1.5 text-[11.5px] text-ink-3">舞台道具 <StageItems ids={st.produceItemIds} /></span>
            </button>
          ))}
        </div>
      </Block>

      {/* 2. 偶像卡 */}
      <Block title="偶像卡" hint="决定角色、计划和推荐效果；只列能上这个舞台的">
        <button type="button" onClick={() => setPick('idol')}
          className={cx('flex min-h-[52px] w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-left sm:max-w-md',
            idolOk ? 'border-line hover:border-line-strong' : 'border-red-500 bg-red-50')}>
          {l.idol ? <IdolThumb id={l.idol} size={36} /> : <span className="grid size-9 place-items-center rounded-lg bg-surface-3 text-ink-3"><Plus size={16} /></span>}
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink">{l.idol ? idol?.name ?? l.idol : '选偶像卡'}</span>
            {!idolOk && <span className="block text-[12px] text-red-600">这张卡的计划上不了这个舞台，换一张或换舞台</span>}
          </span>
        </button>
      </Block>

      {/* 3. 数值 */}
      <Block title="数值" hint="填最终参数（主回忆 + 副回忆 ÷ 5，向下取整）">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <NumInput label="Vo" value={l.params[0]} onChange={(v) => set({ params: [v, l.params[1], l.params[2]] })} />
          <NumInput label="Da" value={l.params[1]} onChange={(v) => set({ params: [l.params[0], v, l.params[2]] })} />
          <NumInput label="Vi" value={l.params[2]} onChange={(v) => set({ params: [l.params[0], l.params[1], v] })} />
          <NumInput label="体力" value={l.stamina} onChange={(v) => set({ stamina: v })} />
          <NumInput label="支援加成 %" value={l.support} step={0.01} onChange={(v) => set({ support: v })} />
        </div>
        <Combiner onApply={(p, s) => set({ params: p, stamina: s })} />
      </Block>

      {/* 4. P 道具 */}
      <Block title={`P 道具 ${l.items.length} / 4`}>
        <div className="flex flex-wrap gap-2">
          {l.items.map((id, i) => {
            const it = cat?.items[id]
            return (
              <span key={i} className="flex min-h-[44px] items-center gap-2 rounded-lg border border-line py-1 pr-1 pl-1.5 text-[13px]">
                {it?.asset && <img src={spriteUrl(it.asset)} alt="" width={30} height={30} className="size-[30px] rounded" />}
                <span className="max-w-[12em] truncate">{it?.name ?? id}</span>
                <IconBtn label="删掉" onClick={() => set({ items: l.items.filter((_, j) => j !== i) })}><X size={14} /></IconBtn>
              </span>
            )
          })}
          {l.items.length < 4 && <AddBtn onClick={() => setPick('item')}>加 P 道具</AddBtn>}
        </div>
      </Block>

      {/* 5. 技能卡 */}
      {(['main', 'sub'] as const).map((g) => (
        <Block key={g} title={`${g === 'main' ? '主回忆' : '副回忆'}技能卡 ${l[g].length} / 6`}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {l[g].map((c, i) => (
              <CardRow key={i} card={c}
                onUp={() => set({ [g]: l[g].map((x, j) => (j === i ? { ...x, up: x.up ? 0 : 1 } : x)) } as Partial<ContestLoadout>)}
                onCustom={cat?.cards[c.id]?.custom ? () => setCustom({ group: g, i }) : undefined}
                onRemove={() => set({ [g]: l[g].filter((_, j) => j !== i) } as Partial<ContestLoadout>)} />
            ))}
            {l[g].length < 6 && <AddBtn onClick={() => setPick(g)}>加技能卡</AddBtn>}
          </div>
        </Block>
      ))}

      {/* 6. 局数和操作 */}
      <div className="space-y-3 border-t border-line pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-w-[260px] flex-1 items-center gap-3">
            <span className="shrink-0 text-[13px] font-semibold text-ink">模拟局数</span>
            <input type="range" min={10} max={2000} step={10} value={runs} onChange={(e) => setRuns(Number(e.target.value))} className="flex-1 accent-[var(--color-brand)]" aria-label="模拟局数" />
            <span className="num w-[3.5em] text-right font-semibold">{runs}</span>
          </label>
          <label className="block w-full sm:w-56">
            <span className="sr-only">编成名</span>
            <Input value={l.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder="编成名（保存时用，可不填）" className="h-[44px]" />
          </label>
        </div>
        <Button className="h-[48px] w-full text-[15px]" disabled={!!blocked || busy} onClick={onRun}>{busy ? '模拟中…' : '模拟'}</Button>
        {blocked && <p className="text-center text-[12.5px] text-ink-3">{blocked}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-[44px]" onClick={() => onChange(emptyLoadout(l.season, l.stage))}><Trash2 size={15} />清空</Button>
          <Button variant="outline" className="h-[44px]" onClick={save}><Save size={15} />保存到本机</Button>
          <Button variant="outline" className="h-[44px]" onClick={copyLink}><Link2 size={15} />复制分享链接</Button>
          <Button variant="outline" className="h-[44px]" onClick={copyCode}><Copy size={15} />复制编成码</Button>
        </div>
      </div>

      <Picker open={pick !== null} title={pick === 'idol' ? '选偶像卡' : pick === 'item' ? '加 P 道具' : '加技能卡'} items={items}
        multi={pick === 'item' || pick === 'main' || pick === 'sub'} onPick={onPick} onClose={() => setPick(null)}
        note={pick === 'main' || pick === 'sub' ? '点一张加一张，可以连续加（最多 6 张）；强化和定制加完后在格子里改' : undefined} />
      {custom && l[custom.group][custom.i] && (
        <CustomizeDialog card={l[custom.group][custom.i]} onClose={() => setCustom(null)}
          onChange={(c) => set({ [custom.group]: l[custom.group].map((x, j) => (j === custom.i ? c : x)) } as Partial<ContestLoadout>)} />
      )}
    </section>
  )
}

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 flex flex-wrap items-baseline gap-x-2 text-[14px] font-bold text-ink">{title}{hint && <span className="text-[12px] font-normal text-ink-3">{hint}</span>}</h3>
      {children}
    </div>
  )
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="grid size-[36px] cursor-pointer place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink">{children}</button>
  )
}

function AddBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 text-[13px] text-ink-2 hover:border-brand hover:text-brand-ink">
      <Plus size={15} />{children}
    </button>
  )
}

/** 一张技能卡：图标、名字（随强化变）、强化开关、定制、删掉 */
function CardRow({ card, onUp, onCustom, onRemove }: { card: DeckCard; onUp: () => void; onCustom?: () => void; onRemove: () => void }) {
  const cat = useCatalog()
  const c = cat?.cards[card.id]
  const canUp = !!c?.up['1']
  const cz = card.cz.reduce((s, [, n]) => s + n, 0)
  return (
    <div className="flex min-h-[52px] items-center gap-2 rounded-lg border border-line py-1 pr-1 pl-1.5">
      {c?.asset ? <img src={spriteUrl(c.asset)} alt="" width={36} height={36} className="size-9 shrink-0 rounded-md bg-surface-3" /> : <span className="size-9 shrink-0 rounded-md bg-surface-3" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-ink">{cardName(cat, card.id, card.up)}</span>
        {cz > 0 && <span className="block text-[11.5px] text-brand-ink">定制 {cz} 次</span>}
      </span>
      {canUp && (
        <button type="button" aria-pressed={card.up > 0} onClick={onUp} title="强化"
          className={cx('grid h-[36px] min-w-[36px] cursor-pointer place-items-center rounded-md border px-1.5 text-[13px] font-bold',
            card.up ? 'border-brand bg-brand-tint text-brand-ink' : 'border-line text-ink-3 hover:border-line-strong')}>+</button>
      )}
      {onCustom && <button type="button" onClick={onCustom} className="h-[36px] cursor-pointer rounded-md border border-line px-2 text-[12px] text-ink-2 hover:border-line-strong">定制</button>}
      <IconBtn label="删掉" onClick={onRemove}><X size={14} /></IconBtn>
    </div>
  )
}

/** 从主副回忆算最终参数：floor(主 + 副 ÷ 5)，算好填进上面 */
function Combiner({ onApply }: { onApply: (params: [number, number, number], stamina: number) => void }) {
  const [main, setMain] = useState([0, 0, 0, 0])
  const [sub, setSub] = useState([0, 0, 0, 0])
  const out = main.map((m, i) => combine(m, sub[i]))
  const row = (xs: number[], setXs: (v: number[]) => void, label: string) => (
    <div className="grid grid-cols-[4.5em_repeat(4,1fr)] items-end gap-2">
      <span className="pb-3 text-[12.5px] text-ink-2">{label}</span>
      {['Vo', 'Da', 'Vi', '体力'].map((k, i) => (
        <NumInput key={k} label={k} value={xs[i]} onChange={(v) => setXs(xs.map((x, j) => (j === i ? v : x)))} />
      ))}
    </div>
  )
  return (
    <details className="mt-2 rounded-xl border border-line px-3 py-2">
      <summary className="flex min-h-[36px] cursor-pointer items-center gap-1.5 text-[13px] text-ink-2"><Calculator size={14} />从主副回忆的数值算</summary>
      <div className="mt-2 space-y-2">
        {row(main, setMain, '主回忆')}
        {row(sub, setSub, '副回忆')}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="num text-[13px] text-ink-2">最终：Vo {out[0]} · Da {out[1]} · Vi {out[2]} · 体力 {out[3]}</span>
          <Button variant="outline" className="h-[40px]" onClick={() => onApply([out[0], out[1], out[2]], out[3])}>填进上面</Button>
        </div>
      </div>
    </details>
  )
}
