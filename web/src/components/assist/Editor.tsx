import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Download, Play, Plus, Save, Trash2, X, Zap } from 'lucide-react'
import { useApi } from '../../lib/hooks'
import { cardName, drinkName, enchantName, idolThumbUrl, spriteUrl, useCatalog, useLang } from '../../lib/catalog'
import { pick, supportThumbUrl, type SupportCatalog } from '../../lib/supports'
import type { Problem } from '../../lib/api'
import {
  draftFromLoadout, dropSave, listSaves, loadoutFromDraft, packGA1, parseCode, putSave, ROUNDS,
  type DeckCard, type Draft, type Saved,
} from '../../lib/assist'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Picker, type PickItem } from './Picker'
import { cx, IdolThumb, SectionTitle } from '../ui'

const SUPPORT_DEFAULT: Record<string, number> = { SSR: 61, SR: 56, R: 53 }

/** 编成页：上面带入（题库 / 本机保存 / 码），下面编辑，最下面保存、复制码、开始 */
export function Editor({ draft, setDraft, onStart, onResume, busy }: {
  draft: Draft
  setDraft: (d: Draft) => void
  onStart: (practice: boolean) => void
  onResume: (code: string) => void
  busy: boolean
}) {
  const cat = useCatalog()
  const { lang } = useLang()
  const sup = useApi<SupportCatalog>('api/supports')
  const [picker, setPicker] = useState<null | 'idol' | 'card' | 'item' | 'drink' | 'memory' | 'support'>(null)
  const [czCard, setCzCard] = useState<number | null>(null)
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })

  const items = useMemo((): Record<string, PickItem[]> => {
    if (!cat) return {}
    const idols = Object.entries(cat.idols).map(([id, d]) => ({ id, name: d.name, sub: [d.rarity, d.plan].filter(Boolean).join(' · '), img: idolThumbUrl(id) }))
    const cards = Object.entries(cat.cards).map(([id, c]) => ({ id, name: c.name, sub: [c.rarity, c.plan].filter(Boolean).join(' · '), img: c.asset ? spriteUrl(c.asset) : undefined, text: c.up['0']?.text }))
    // 名字和效果都一样的（游戏里按场景分了好多个编号）只列一个
    const thing = (m: Record<string, { name: string; rarity?: string; text?: string; asset?: string }>, f?: (id: string) => boolean) => {
      const seen = new Set<string>()
      return Object.entries(m).filter(([id, d]) => {
        const k = `${d.name}\n${d.text ?? ''}`
        if ((f && !f(id)) || seen.has(k)) return false
        seen.add(k)
        return true
      }).map(([id, d]) => ({ id, name: d.name, sub: d.rarity, text: d.text, img: d.asset ? spriteUrl(d.asset) : undefined }))
    }
    const supports = sup.data ? Object.entries(sup.data.cards).map(([id, d]) => ({ id, name: pick(d.name, lang), sub: `${d.rarity} 支援卡`, img: supportThumbUrl(id) })) : []
    return {
      idol: idols, card: cards, item: thing(cat.items), drink: thing(cat.drinks),
      memory: thing(cat.enchants, (id) => id.includes('hif_memory')), support: supports,
    }
  }, [cat, sup.data, lang])

  const chooseIdol = (id: string) => {
    const old = cat?.idols[draft.idol]
    const d = cat?.idols[id]
    let deck = draft.deck.filter((c) => c.id !== old?.card)
    let its = draft.items.filter((x) => x !== old?.item && x !== old?.item_up)
    if (d?.card && !deck.some((c) => c.id === d.card)) deck = [{ id: d.card, up: 1, cz: [] }, ...deck]
    const it = d?.item_up ?? d?.item
    if (it && !its.includes(it)) its = [it, ...its]
    set({ idol: id, deck, items: its })
  }

  const onPick = (kind: NonNullable<typeof picker>, id: string) => {
    if (kind === 'idol') return chooseIdol(id)
    if (kind === 'card') return set({ deck: [...draft.deck, { id, up: 1, cz: [] }] })
    if (kind === 'item') return set({ items: [...draft.items, id] })
    if (kind === 'drink') return set({ drinks: [...draft.drinks, id] })
    if (kind === 'memory') return set({ memories: [...draft.memories, id] })
    if (kind === 'support') return set({ supports: [...draft.supports, { id, v: SUPPORT_DEFAULT[sup.data?.cards[id]?.rarity ?? 'SSR'] ?? 61 }] })
  }

  const maxUp = (id: string) => Math.max(0, ...Object.keys(cat?.cards[id]?.up ?? { 0: 1 }).map(Number))
  const idol = cat?.idols[draft.idol]
  const loadout = loadoutFromDraft(draft)

  const copyCode = async () => {
    const code = await packGA1(draft.name || '我的编成', loadout)
    await navigator.clipboard.writeText(code)
    toast.success('编成码已复制', { description: '发给别人，或者下次贴回来就能还原' })
  }
  const save = async () => {
    const name = draft.name.trim() || `${idol?.name ?? '编成'} ${new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    putSave({ name, code: await packGA1(name, loadout), at: new Date().toISOString() })
    set({ name })
    toast.success('存到本机了', { description: name })
  }

  return (
    <div className="space-y-6">
      <Bring onDraft={setDraft} onResume={onResume} />

      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <SectionTitle>编成</SectionTitle>

        <div className="mt-3 grid gap-5 lg:grid-cols-2">
          <div className="space-y-4">
            <Field label="偶像卡">
              <button type="button" onClick={() => setPicker('idol')}
                className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2 text-left hover:border-brand">
                {draft.idol ? <IdolThumb id={draft.idol} size={40} title={false} /> : <span className="size-10 rounded-lg bg-surface-3" />}
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{idol?.name ?? '选偶像卡'}</span>
                  <span className="block text-[12px] text-ink-3">{idol ? [idol.rarity, idol.plan].filter(Boolean).join(' · ') : '选了以后专属技能卡和 P 道具会自动加进来'}</span>
                </span>
              </button>
            </Field>

            <Field label="审查">
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                {ROUNDS.map((r) => (
                  <button key={r.key} type="button" aria-pressed={draft.round === r.key} onClick={() => set({ round: r.key })}
                    className={cx('min-h-11 cursor-pointer rounded-lg border px-2 text-[13px] font-semibold transition-colors duration-150',
                      draft.round === r.key ? 'border-brand bg-brand-tint text-brand-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong')}>
                    {r.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="数值">
              <div className="grid grid-cols-3 gap-2">
                {(['Vo', 'Da', 'Vi'] as const).map((k, i) => (
                  <NumInput key={k} label={k} value={draft.params[i]} onChange={(v) => { const p = [...draft.params] as Draft['params']; p[i] = v; set({ params: p }) }} />
                ))}
                <NumInput label="体力" value={draft.stamina} onChange={(v) => set({ stamina: v })} />
                <NumInput label="体力上限" value={draft.maxStamina} onChange={(v) => set({ maxStamina: v })} />
              </div>
            </Field>

            <Field label="得分加成 %" hint="游戏里看得到就填，不填按引擎算">
              <div className="grid grid-cols-3 gap-2">
                {(['Vo', 'Da', 'Vi'] as const).map((k, i) => (
                  <NumInput key={k} label={k} value={draft.bonus[i] / 10} step={0.1}
                    onChange={(v) => { const b = [...draft.bonus] as Draft['bonus']; b[i] = Math.round(v * 10); set({ bonus: b }) }} />
                ))}
              </div>
            </Field>
          </div>

          <div className="space-y-4">
            <Chips label="P 道具" ids={draft.items} name={(id) => cat?.items[id]?.name ?? id} img={(id) => cat?.items[id]?.asset}
              onAdd={() => setPicker('item')} onRemove={(i) => set({ items: draft.items.filter((_, j) => j !== i) })} />
            <Chips label="饮料" ids={draft.drinks} name={(id) => drinkName(cat, id)} img={(id) => cat?.drinks[id]?.asset} max={6}
              onAdd={() => setPicker('drink')} onRemove={(i) => set({ drinks: draft.drinks.filter((_, j) => j !== i) })} />
            <Chips label="回忆技能" ids={draft.memories} name={(id) => enchantName(cat, id)}
              onAdd={() => setPicker('memory')} onRemove={(i) => set({ memories: draft.memories.filter((_, j) => j !== i) })} />
            {draft.mainItems.length > 0 && (
              <Chips label="定制道具" ids={draft.mainItems} name={(id) => enchantName(cat, id)}
                onRemove={(i) => set({ mainItems: draft.mainItems.filter((_, j) => j !== i) })} />
            )}
            <Field label={`支援卡 ${draft.supports.length} / 6`} hint="右边的数是这张卡给的强化概率（‰），游戏里支援卡详情能看到">
              <div className="space-y-1.5">
                {draft.supports.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <img src={supportThumbUrl(s.id)} alt="" width={36} height={36} className="size-9 rounded-md bg-surface-3 object-cover" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{sup.data ? pick(sup.data.cards[s.id]?.name, lang) || s.id : s.id}</span>
                    <Input type="number" inputMode="numeric" value={s.v} aria-label="强化概率 ‰"
                      onChange={(e) => set({ supports: draft.supports.map((x, j) => (j === i ? { ...x, v: Number(e.target.value) || 0 } : x)) })}
                      className="h-9 w-20 text-right" />
                    <span className="text-[12px] text-ink-3">‰</span>
                    <RemoveBtn onClick={() => set({ supports: draft.supports.filter((_, j) => j !== i) })} />
                  </div>
                ))}
                {draft.supports.length < 6 && <AddBtn onClick={() => setPicker('support')}>添加支援卡</AddBtn>}
              </div>
            </Field>
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="font-bold text-ink">卡组 {draft.deck.length} 张</h3>
            <AddBtn onClick={() => setPicker('card')}>添加技能卡</AddBtn>
          </div>
          {draft.deck.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-strong bg-surface-2 px-4 py-6 text-center text-ink-3">先选偶像卡，专属卡会自动加进来；再添加其余技能卡。</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-1.5">
              {draft.deck.map((c, i) => {
                const cc = cat?.cards[c.id]
                return (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-line bg-surface p-1.5">
                    {cc?.asset ? <img src={spriteUrl(cc.asset)} alt="" width={36} height={36} className="size-9 shrink-0 rounded-md bg-surface-3" /> : <span className="size-9 shrink-0 rounded-md bg-surface-3" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-ink">{cardName(cat, c.id, c.up)}</span>
                      {cc?.custom && (
                        <button type="button" onClick={() => setCzCard(i)} className="cursor-pointer text-[11px] text-brand-ink hover:underline">
                          {c.cz.length ? `定制 ${c.cz.reduce((s, [, n]) => s + n, 0)} 次` : '定制'}
                        </button>
                      )}
                    </span>
                    <button type="button" aria-label="改强化" onClick={() => set({ deck: draft.deck.map((x, j) => (j === i ? { ...x, up: (x.up + 1) % (maxUp(x.id) + 1) } : x)) })}
                      className="min-h-9 min-w-9 cursor-pointer rounded-md border border-line px-1.5 text-[12px] font-bold text-ink-2 hover:border-brand">
                      {c.up ? '+'.repeat(c.up) : '+0'}
                    </button>
                    <RemoveBtn onClick={() => set({ deck: draft.deck.filter((_, j) => j !== i) })} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="编成名字（保存用）" className="h-11 min-w-0 flex-1 basis-48" />
          <Button variant="outline" className="h-11 flex-1 sm:flex-none" onClick={save}><Save size={15} />保存到本机</Button>
          <Button variant="outline" className="h-11 flex-1 sm:flex-none" onClick={copyCode}><Copy size={15} />复制编成码</Button>
        </div>
        <p className="mt-2 text-[12px] text-ink-3">实战同步：每回合把游戏里抽到的牌点进来再给建议。练习模拟：引擎自己抽牌，照建议打一场。</p>
      </section>

      {/* 开始按钮：手机上贴在屏幕底部 */}
      <div className="sticky bottom-0 z-10 -mx-5 flex gap-2 border-t border-line bg-surface/95 px-5 py-2.5 backdrop-blur sm:static sm:mx-0 sm:justify-end sm:border-0 sm:bg-transparent sm:p-0">
        <Button className="h-11 flex-1 sm:w-40 sm:flex-none" disabled={busy || !draft.idol || !draft.deck.length} onClick={() => onStart(false)}><Zap size={15} />实战同步</Button>
        <Button variant="outline" className="h-11 flex-1 sm:w-40 sm:flex-none" disabled={busy || !draft.idol || !draft.deck.length} onClick={() => onStart(true)}><Play size={15} />练习模拟</Button>
      </div>

      {picker && (
        <Picker open title={{ idol: '选偶像卡', card: '添加技能卡', item: '添加 P 道具', drink: '添加饮料', memory: '添加回忆技能', support: '添加支援卡' }[picker]}
          items={items[picker] ?? []} multi={picker !== 'idol'} onPick={(id) => onPick(picker, id)} onClose={() => setPicker(null)} />
      )}
      {czCard !== null && draft.deck[czCard] && (
        <CustomizeDialog card={draft.deck[czCard]} onClose={() => setCzCard(null)}
          onChange={(c) => set({ deck: draft.deck.map((x, j) => (j === czCard ? c : x)) })} />
      )}
    </div>
  )
}

/** 带入：题库的某道题、本机保存的编成、粘贴的码 */
function Bring({ onDraft, onResume }: { onDraft: (d: Draft) => void; onResume: (code: string) => void }) {
  const [tab, setTab] = useState<'problem' | 'saved' | 'code'>('problem')
  const [code, setCode] = useState('')
  const [saves, setSaves] = useState<Saved[]>(() => listSaves())
  const [q, setQ] = useState('')
  const probs = useApi<Problem[]>(tab === 'problem' ? 'api/sets/hif/problems' : null)
  const cat = useCatalog()
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (probs.data ?? []).filter((p) => !t || (p.name + ' ' + p.id + ' ' + (cat?.idols[String((p.archive.loadout as Record<string, unknown>)?.idol_card_id)]?.name ?? '')).toLowerCase().includes(t)).slice(0, 60)
  }, [probs.data, q, cat])
  const readCode = async (resume: boolean) => {
    try {
      const c = await parseCode(code)
      if (resume && c.kind === 'GR') return onResume(code.trim())
      onDraft(draftFromLoadout(c.loadout, c.name))
      toast.success('编成读进来了', { description: c.name || undefined })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const tabs = [['problem', '从题库'], ['saved', `本机保存 ${saves.length}`], ['code', '粘贴码']] as const
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <SectionTitle>带入编成</SectionTitle>
      <div className="mt-3 mb-3 flex gap-1 rounded-full bg-surface-2 p-0.5 text-[13px] font-semibold">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}
            className={cx('min-h-9 flex-1 cursor-pointer rounded-full px-3', tab === k ? 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line)]' : 'text-ink-3 hover:text-ink')}>{label}</button>
        ))}
      </div>
      {tab === 'problem' && (
        <div>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜偶像、题名或编号" className="mb-2 h-10" />
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {probs.loading && <p className="py-4 text-center text-ink-3">读取题库…</p>}
            {shown.map((p) => {
              const lo = p.archive.loadout as Record<string, unknown>
              return (
                <button key={p.id} type="button" onClick={() => { onDraft(draftFromLoadout(lo, p.name)); toast.success('带入了题库编成', { description: p.name }) }}
                  className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
                  <IdolThumb id={String(lo.idol_card_id)} size={32} title={false} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{p.name}</span>
                  <span className="shrink-0 text-[11.5px] text-ink-3">{ROUNDS.find((r) => r.produce_id === lo.produce_id && r.round === lo.round)?.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      {tab === 'saved' && (
        <div className="space-y-1">
          {saves.length === 0 && <p className="py-4 text-center text-ink-3">还没有。编好后点下面的「保存到本机」。</p>}
          {saves.map((s) => (
            <div key={s.name} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-2">
              <button type="button" onClick={async () => { const c = await parseCode(s.code); onDraft(draftFromLoadout(c.loadout, s.name)) }}
                className="min-h-10 min-w-0 flex-1 cursor-pointer truncate text-left text-[13px] text-ink">{s.name}</button>
              <span className="text-[11.5px] text-ink-3">{s.at.slice(5, 10)}</span>
              <RemoveBtn onClick={() => { dropSave(s.name); setSaves(listSaves()) }} />
            </div>
          ))}
        </div>
      )}
      {tab === 'code' && (
        <div className="space-y-2">
          <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={3}
            placeholder="贴编成码（GA1…），或 GKMS「导出 GKMSUINet」给的对局码（GR1…）/ 链接"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-brand" />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-10" disabled={!code.trim()} onClick={() => readCode(false)}><Download size={15} />读出编成</Button>
            {code.trim().startsWith('GR') || code.includes('#c=GR') ? (
              <Button className="h-10" onClick={() => readCode(true)}><Play size={15} />从对局码的位置继续</Button>
            ) : null}
          </div>
          <p className="text-[12px] text-ink-3">对局码会带着 GKMS 那边已经打过的几步，「从对局码的位置继续」会接着那一步往下给建议。</p>
        </div>
      )}
    </section>
  )
}

/** 一张卡的定制：每个方向选几档，合计不超过这张卡的上限 */
function CustomizeDialog({ card, onChange, onClose }: { card: DeckCard; onChange: (c: DeckCard) => void; onClose: () => void }) {
  const cat = useCatalog()
  const c = cat?.cards[card.id]
  if (!c?.custom) return null
  const have = new Map(card.cz)
  const total = card.cz.reduce((s, [, n]) => s + n, 0)
  const setDir = (id: string, n: number) => {
    const m = new Map(have)
    if (n > 0) m.set(id, n)
    else m.delete(id)
    onChange({ ...card, cz: [...m.entries()] })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle className="text-[16px] font-bold">定制 {cardName(cat, card.id, card.up)}</DialogTitle>
        <DialogDescription>合计最多 {c.custom.max} 次，已用 {total} 次</DialogDescription>
        <div className="space-y-3">
          {c.custom.dirs.map((d) => {
            const n = have.get(d.id) ?? 0
            return (
              <div key={d.id}>
                <div className="flex flex-wrap gap-1.5">
                  {[0, ...d.levels.map((_, i) => i + 1)].map((k) => (
                    <button key={k} type="button" aria-pressed={n === k} disabled={k > n && total - n + k > c.custom!.max} onClick={() => setDir(d.id, k)}
                      className={cx('min-h-10 cursor-pointer rounded-lg border px-2.5 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-40',
                        n === k ? 'border-brand bg-brand-tint text-brand-ink' : 'border-line text-ink-2 hover:border-line-strong')}>
                      {k === 0 ? '不定制' : d.levels[k - 1].text}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2"><span className="text-[13px] font-semibold text-ink">{label}</span>{hint && <span className="text-[11.5px] text-ink-3">{hint}</span>}</div>
      {children}
    </div>
  )
}

function NumInput({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11.5px] text-ink-3">{label}</span>
      <Input type="number" inputMode="decimal" step={step} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value) || 0)} className="h-10" />
    </label>
  )
}

function Chips({ label, ids, name, img, onAdd, onRemove, max }: {
  label: string; ids: string[]; name: (id: string) => string; img?: (id: string) => string | undefined; onAdd?: () => void; onRemove: (i: number) => void; max?: number
}) {
  return (
    <Field label={`${label} ${ids.length}${max ? ` / ${max}` : ''}`}>
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id, i) => {
          const a = img?.(id)
          return (
            <span key={`${id}-${i}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface py-1 pr-1 pl-1.5 text-[12.5px] text-ink">
              {a && <img src={spriteUrl(a)} alt="" width={22} height={22} className="size-[22px]" />}
              <span className="max-w-44 truncate">{name(id)}</span>
              <RemoveBtn onClick={() => onRemove(i)} small />
            </span>
          )
        })}
        {onAdd && (!max || ids.length < max) && <AddBtn onClick={onAdd}>添加</AddBtn>}
      </div>
    </Field>
  )
}

function AddBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-lg border border-dashed border-line-strong px-2.5 text-[12.5px] font-semibold text-ink-2 hover:border-brand hover:text-brand-ink">
      <Plus size={14} />{children}
    </button>
  )
}

function RemoveBtn({ onClick, small }: { onClick: () => void; small?: boolean }) {
  return (
    <button type="button" aria-label="删掉" onClick={onClick} className={cx('grid cursor-pointer place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-critical', small ? 'size-7' : 'size-9')}>
      {small ? <X size={14} /> : <Trash2 size={15} />}
    </button>
  )
}
