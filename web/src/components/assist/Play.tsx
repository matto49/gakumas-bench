import { useMemo, useState } from 'react'
import { Check, ChevronLeft, Hand, Pencil, Plus, RotateCcw, X } from 'lucide-react'
import { cardName, drinkName, spriteUrl, useCatalog } from '../../lib/catalog'
import type { Card } from '../../lib/api'
import type { AssistView, PileCard } from '../../lib/assist'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { EnchantChip, SkillCard, StatusChip } from '../GameBits'
import { cx, SectionTitle, TurnStrip } from '../ui'
import { Picker } from './Picker'

type Act = (string | number)[]
const pct = (p: number) => (p >= 0.995 ? '99%' : p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`)
const key = (a: Act) => a.join(':')

/** 对局页：状态栏、（实战同步时）核对手牌、带概率的出牌建议、预测得分、改数值、撤销 */
export function Play({ view, busy, onHand, onStep, onUndo, onNumbers, onExit }: {
  view: AssistView
  busy: boolean
  onHand: (cards: PileCard[]) => void
  onStep: (a: Act) => void
  onUndo: () => void
  onNumbers: (n: { score: number; stamina: number; block: number }) => void
  onExit: () => void
}) {
  const cat = useCatalog()
  const o = view.obs
  const [editNum, setEditNum] = useState(false)
  const prob = useMemo(() => {
    const m = new Map<string, number>()
    if (view.advice) o.legal.forEach((a, i) => m.set(key(a), view.advice!.probs[i] ?? 0))
    return m
  }, [view.advice, o.legal])
  const best = view.advice ? o.legal[view.advice.best] : null
  const legal = new Set(o.legal.map(key))
  const canAct = !busy && !view.awaiting_hand && !view.finished

  const ranked = view.advice
    ? o.legal.map((a, i) => ({ a, p: view.advice!.probs[i] ?? 0 })).sort((x, y) => y.p - x.p).slice(0, 4)
    : []
  const actLabel = (a: Act) => {
    if (a[0] === 'play') { const c = o.hand[Number(a[1])]; return c ? `打「${cardName(cat, c.id, c.u ?? 0)}」` : '打一张' }
    if (a[0] === 'drink') return `喝「${drinkName(cat, o.drinks[Number(a[1])])}」`
    if (a[0] === 'end') return '结束回合（不出牌）'
    return a.join(' ')
  }

  return (
    <div className="space-y-4">
      {/* 状态栏 */}
      <section className="rounded-2xl border border-line bg-surface p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" onClick={onExit} className="inline-flex min-h-10 cursor-pointer items-center gap-1 rounded-lg pr-2 text-[13px] font-semibold text-ink-2 hover:text-ink">
            <ChevronLeft size={16} />回编成
          </button>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-semibold text-ink-2">{view.practice ? '练习模拟' : '实战同步'}</span>
          <Stat label="回合" value={`${view.turn}${view.limit_turn ? ` / ${view.limit_turn}` : ''}`} />
          <Stat label="得分" value={view.score.toLocaleString()} big />
          <Stat label="体力" value={`${view.numbers.stamina} / ${view.numbers.max_stamina}`} />
          <Stat label="元气" value={String(view.numbers.block)} />
          <div className="ml-auto flex gap-1.5">
            <Button variant="outline" className="h-10" onClick={() => setEditNum(true)} disabled={busy || view.finished}><Pencil size={14} />改数值</Button>
            <Button variant="outline" className="h-10" onClick={onUndo} disabled={busy || !view.can_undo}><RotateCcw size={14} />撤销</Button>
          </div>
        </div>
        <div className="mt-2 overflow-x-auto pb-0.5"><TurnStrip types={o.exam.types} current={view.turn} size="xs" /></div>
        {(o.status.length > 0 || o.ench.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {o.status.map(([k, v, t]) => <StatusChip key={k} kind={k} value={v} turns={t} />)}
            {o.ench.map(([id, u, t], i) => <EnchantChip key={`${id}-${i}`} id={id} uses={u} turns={t} />)}
          </div>
        )}
        {view.imported && (
          <p className="mt-2 text-[12px] text-ink-3">从对局码接着打：已经按码走了 {view.imported.plays} / {view.imported.total} 步，之后的抽牌按你点的来。</p>
        )}
      </section>

      {view.finished ? (
        <section className="rounded-2xl border border-line bg-surface p-6 text-center">
          <p className="text-[13px] text-ink-3">这一场打完了</p>
          <p className="disp mt-1 text-[32px] text-ink">{view.score.toLocaleString()}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" className="h-11" onClick={onUndo} disabled={busy || !view.can_undo}><RotateCcw size={15} />退一步</Button>
            <Button className="h-11" onClick={onExit}>回编成</Button>
          </div>
        </section>
      ) : view.awaiting_hand ? (
        <HandCheck view={view} busy={busy} onHand={onHand} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-2xl border border-line bg-surface p-3 sm:p-4">
            <SectionTitle>手牌</SectionTitle>
            <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
              {o.hand.map((c, i) => {
                const a: Act = ['play', i]
                const ok = legal.has(key(a))
                return (
                  <ActionTile key={i} disabled={!canAct || !ok} best={!!best && key(best) === key(a)} p={prob.get(key(a))} onClick={() => onStep(a)}>
                    <SkillCard card={c} size={56} dim={!ok} />
                  </ActionTile>
                )
              })}
            </div>
            {o.drinks.length > 0 && (
              <>
                <h3 className="mt-4 mb-2 text-[13px] font-semibold text-ink">饮料</h3>
                <div className="flex flex-wrap gap-2">
                  {o.drinks.map((d, i) => {
                    const a: Act = ['drink', i]
                    const ok = legal.has(key(a))
                    const dd = cat?.drinks[d]
                    return (
                      <ActionTile key={i} wide disabled={!canAct || !ok} best={!!best && key(best) === key(a)} p={prob.get(key(a))} onClick={() => onStep(a)}>
                        <span className="flex items-center gap-1.5">
                          {dd?.asset ? <img src={spriteUrl(dd.asset)} alt="" width={28} height={28} className="size-7" /> : <span className="size-7 rounded bg-surface-3" />}
                          <span className="max-w-36 shrink-0 truncate text-[12px] text-ink">{drinkName(cat, d)}</span>
                        </span>
                      </ActionTile>
                    )
                  })}
                </div>
              </>
            )}
            {legal.has('end') && (
              <div className="mt-4">
                <ActionTile wide disabled={!canAct} best={!!best && key(best) === 'end'} p={prob.get('end')} onClick={() => onStep(['end'])}>
                  <span className="shrink-0 text-[13px] font-semibold whitespace-nowrap text-ink">结束回合</span>
                </ActionTile>
              </div>
            )}
            <Piles view={view} />
          </section>

          {/* 建议：手机上贴在底部 */}
          <aside className="sticky bottom-0 z-10 -mx-5 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur lg:static lg:mx-0 lg:self-start lg:rounded-2xl lg:border lg:bg-surface lg:p-4">
            <h3 className="text-[13px] font-semibold text-ink-3">建议</h3>
            {best ? (
              <>
                <button type="button" disabled={!canAct} onClick={() => onStep(best)}
                  className="mt-1 flex min-h-12 w-full cursor-pointer items-center justify-between gap-2 rounded-xl bg-brand px-3 text-left font-bold text-white disabled:opacity-60">
                  <span className="min-w-0 truncate">{actLabel(best)}</span>
                  <span className="num shrink-0">{pct(prob.get(key(best)) ?? 0)}</span>
                </button>
                <ul className="mt-2 hidden space-y-1 sm:block">
                  {ranked.slice(1).map(({ a, p }) => (
                    <li key={key(a)} className="flex items-center gap-2 text-[12.5px]">
                      <span className="min-w-0 flex-1 truncate text-ink-2">{actLabel(a)}</span>
                      <span className="num text-ink-3">{pct(p)}</span>
                    </li>
                  ))}
                </ul>
                {view.advice?.score_quantiles && <Forecast q={view.advice.score_quantiles} />}
                <p className="mt-2 hidden text-[11.5px] text-ink-3 sm:block">UINet 按现在的局面给的出牌概率；点卡就按那张出，点上面的按钮就照建议出。</p>
              </>
            ) : (
              <p className="mt-1 text-[13px] text-ink-3">{busy ? '算一下…' : '现在没有建议'}</p>
            )}
          </aside>
        </div>
      )}

      {editNum && (
        <NumbersDialog view={view} onClose={() => setEditNum(false)} onSave={(n) => { setEditNum(false); onNumbers(n) }} />
      )}
    </div>
  )
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[12px] text-ink-3">{label}</span>
      <span className={cx('num font-bold text-ink', big ? 'text-[18px]' : 'text-[14px]')}>{value}</span>
    </span>
  )
}

function ActionTile({ children, p, best, disabled, onClick, wide }: { children: React.ReactNode; p?: number; best: boolean; disabled: boolean; onClick: () => void; wide?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={cx('relative flex min-h-11 cursor-pointer items-center rounded-xl border p-1.5 transition-colors duration-150 disabled:cursor-not-allowed',
        wide ? 'flex-row gap-3 px-3' : 'flex-col gap-1',
        best ? 'border-brand bg-brand-tint' : 'border-line bg-surface hover:border-line-strong')}>
      {children}
      {p !== undefined && (
        <span className={cx('w-full', wide && 'w-auto')}>
          {!wide && <span className="block h-1 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(2, p * 100)}%` }} /></span>}
          <span className={cx('num block text-center text-[11.5px] font-semibold', best ? 'text-brand-ink' : 'text-ink-3')}>{pct(p)}</span>
        </span>
      )}
    </button>
  )
}

function Forecast({ q }: { q: Record<string, number> }) {
  const v = (k: string) => (q[k] !== undefined ? Math.round(q[k]).toLocaleString() : '—')
  return (
    <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-[11.5px] text-ink-3">照建议打完，预计最终得分</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="num text-[18px] font-bold text-ink">{v('50%')}</span>
        <span className="num text-[12px] text-ink-3">{v('10%')} ～ {v('90%')}</span>
      </div>
    </div>
  )
}

/** 牌堆（不给顺序）、弃牌、除外：折起来，看得到就够了 */
function Piles({ view }: { view: AssistView }) {
  const rows = [['牌堆', view.piles.deck], ['弃牌', view.piles.grave], ['保留', view.piles.hold], ['除外', view.piles.lost]] as const
  return (
    <details className="mt-4 rounded-lg border border-line bg-surface-2 px-3 py-2">
      <summary className="min-h-8 cursor-pointer text-[13px] font-semibold text-ink-2">
        {rows.map(([n, c]) => `${n} ${c.length}`).join(' · ')}
      </summary>
      {rows.map(([n, cards]) => cards.length > 0 && (
        <div key={n} className="mt-2">
          <div className="mb-1 text-[12px] text-ink-3">{n}</div>
          <div className="flex flex-wrap gap-1">{cards.map(([id, u], i) => <SkillCard key={i} card={{ id, u }} size={36} />)}</div>
        </div>
      ))}
    </details>
  )
}

/** 实战同步：这回合抽到了哪几张，点进来。候选是引擎现在的手牌 + 牌堆；考试中生成的卡从「其他卡」里找 */
function HandCheck({ view, busy, onHand }: { view: AssistView; busy: boolean; onHand: (cards: PileCard[]) => void }) {
  const cat = useCatalog()
  const [picked, setPicked] = useState<PileCard[]>([])
  const [more, setMore] = useState(false)
  // 候选：手牌 + 牌堆 + 弃牌，同一张（id + 强化）只列一次，标出还剩几张
  const pool = useMemo(() => {
    const m = new Map<string, { c: PileCard; n: number }>()
    for (const c of [...view.piles.hand, ...view.piles.deck, ...view.piles.grave]) {
      const k = c.join('+')
      const e = m.get(k)
      if (e) e.n++
      else m.set(k, { c, n: 1 })
    }
    return [...m.values()]
  }, [view.piles])
  const count = (c: PileCard) => picked.filter((x) => x[0] === c[0] && x[1] === c[1]).length
  const guess = view.piles.hand
  const asCard = (c: PileCard): Card => ({ id: c[0], u: c[1] })
  const allCards = useMemo(() => (cat ? Object.entries(cat.cards).map(([id, c]) => ({ id, name: c.name, sub: [c.rarity, c.plan].filter(Boolean).join(' · '), img: c.asset ? spriteUrl(c.asset) : undefined, text: c.up['0']?.text })) : []), [cat])

  return (
    <section className="rounded-2xl border border-brand/40 bg-surface p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <Hand size={18} className="text-brand-ink" />
        <h2 className="font-bold text-ink">第 {view.turn} 回合：游戏里抽到了哪几张？</h2>
      </div>
      <p className="mt-1 text-[12.5px] text-ink-3">按游戏画面从左到右点。强化过的卡（支援卡给的 +）点带 + 的那张。</p>

      <div className="mt-3 rounded-xl bg-surface-2 p-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[12.5px] font-semibold text-ink-2">已点 {picked.length} 张</span>
          {picked.length > 0 && <button type="button" onClick={() => setPicked([])} className="min-h-8 cursor-pointer text-[12px] text-ink-3 hover:text-ink">清空</button>}
        </div>
        <div className="flex min-h-16 flex-wrap gap-1.5">
          {picked.map((c, i) => (
            <button key={i} type="button" aria-label="拿掉这张" onClick={() => setPicked((p) => p.filter((_, j) => j !== i))} className="relative cursor-pointer">
              <SkillCard card={asCard(c)} size={48} />
              <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-ink text-surface"><X size={11} /></span>
            </button>
          ))}
          {picked.length === 0 && <span className="self-center px-1 text-[12.5px] text-ink-3">从下面点</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button className="h-11 flex-1 sm:flex-none" disabled={busy || picked.length === 0} onClick={() => onHand(picked)}><Check size={15} />就是这几张</Button>
          {guess.length > 0 && (
            <Button variant="outline" className="h-11 flex-1 sm:flex-none" disabled={busy} onClick={() => onHand(guess)}>照引擎猜的这 {guess.length} 张</Button>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-1.5">
        {pool.map(({ c, n }) => {
          const left = n - count(c)
          return (
            <button key={c.join('+')} type="button" disabled={left <= 0} onClick={() => setPicked((p) => [...p, c])}
              className="relative flex cursor-pointer flex-col items-center rounded-lg border border-line bg-surface p-1 hover:border-brand disabled:cursor-not-allowed disabled:opacity-40">
              <SkillCard card={asCard(c)} size={48} />
              {n > 1 && <span className="num absolute top-1 right-1 rounded bg-surface-2 px-1 text-[10px] text-ink-3">×{left}</span>}
            </button>
          )
        })}
        <button type="button" onClick={() => setMore(true)}
          className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong text-[12px] text-ink-2 hover:border-brand">
          <Plus size={16} />其他卡
        </button>
      </div>
      {more && (
        <Picker open title="考试中生成的卡" note="卡组里没有、考试中途生成进手牌的卡从这里找" items={allCards} multi
          onPick={(id) => setPicked((p) => [...p, [id, 0]])} onClose={() => setMore(false)} />
      )}
    </section>
  )
}

function NumbersDialog({ view, onSave, onClose }: { view: AssistView; onSave: (n: { score: number; stamina: number; block: number }) => void; onClose: () => void }) {
  const [score, setScore] = useState(view.score)
  const [stamina, setStamina] = useState(Number(view.numbers.stamina))
  const [block, setBlock] = useState(Number(view.numbers.block))
  const field = (label: string, v: number, set: (n: number) => void) => (
    <label className="block">
      <span className="mb-0.5 block text-[12px] text-ink-3">{label}</span>
      <Input type="number" inputMode="numeric" value={v} onChange={(e) => set(Number(e.target.value) || 0)} className="h-11" />
    </label>
  )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle className="text-[16px] font-bold">改成游戏里的数</DialogTitle>
        <DialogDescription>游戏里的得分、体力、元气和这里对不上时，照着游戏改；改完建议会按新数重算。</DialogDescription>
        <div className="grid grid-cols-3 gap-2">
          {field('得分', score, setScore)}
          {field('体力', stamina, setStamina)}
          {field('元气', block, setBlock)}
        </div>
        <Button className="h-11" onClick={() => onSave({ score, stamina, block })}>改好了</Button>
      </DialogContent>
    </Dialog>
  )
}
