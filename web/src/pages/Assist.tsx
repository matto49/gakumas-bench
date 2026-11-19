import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api, ApiError, type Problem } from '../lib/api'
import {
  assistHand, assistNumbers, assistStep, assistUndo, closeAssist, emptyDraft, openAssist,
  type AssistView, type Draft, draftFromLoadout, loadoutFromDraft,
} from '../lib/assist'
import { PageHeader } from '../components/ui'
import { Editor } from '../components/assist/Editor'
import { Play } from '../components/assist/Play'

/** 出牌助手：编成（存在本机 localStorage）→ 开一局（服务器内存里，id 和最后一次画面存 sessionStorage，刷新不丢）。
 * 建议来自 GKMS rev383 引擎 + UINet Ver2.1（gkbench/assist.py）；不用种子，抽牌按玩家点的来。 */

const DRAFT = 'gkb-assist-draft'
const SESSION = 'gkb-assist-session'
type Live = { id: string; view: AssistView }

function load<T>(store: Storage, k: string, d: T): T {
  try {
    const v = store.getItem(k)
    return v ? (JSON.parse(v) as T) : d
  } catch {
    return d
  }
}
function keep(store: Storage, k: string, v: unknown) {
  try {
    if (v == null) store.removeItem(k)
    else store.setItem(k, JSON.stringify(v))
  } catch {
    /* 无痕模式存不了 */
  }
}

export function Assist() {
  const [draft, setDraftState] = useState<Draft>(() => ({ ...emptyDraft(), ...load<Partial<Draft>>(localStorage, DRAFT, {}) }))
  const [live, setLive] = useState<Live | null>(() => load<Live | null>(sessionStorage, SESSION, null))
  const [busy, setBusy] = useState(false)
  const setDraft = (d: Draft) => { setDraftState(d); keep(localStorage, DRAFT, d) }
  useEffect(() => keep(sessionStorage, SESSION, live), [live])

  // 从試験集合点进来（?set=&p=）：把那道题的编成带进编辑器
  const [q, setQ] = useSearchParams()
  const from = q.get('set') && q.get('p') ? [q.get('set')!, q.get('p')!] as const : null
  useEffect(() => {
    if (!from) return
    const [set, id] = from
    api<Problem[]>(`api/sets/${encodeURIComponent(set)}/problems`).then((ps) => {
      const p = ps.find((x) => x.id === id)
      if (!p) throw new Error('题库里没找到这道题')
      setDraft(draftFromLoadout(p.archive.loadout as Record<string, unknown>, p.name))
      setLive((l) => { if (l) closeAssist(l.id); return null })
      toast.success('带入了题库编成', { description: p.name })
    }).catch((e: Error) => toast.error(e.message)).finally(() => setQ({}, { replace: true }))
  }, [from?.[0], from?.[1]])

  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    try {
      await f()
    } catch (e) {
      const err = e as Error
      toast.error(err.message)
      // 会话没了（结束 / 闲置回收 / 引擎重启）：回编成，编成还在
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) setLive(null)
    } finally {
      setBusy(false)
    }
  }
  const start = (body: Parameters<typeof openAssist>[0]) => run(async () => {
    if (live) closeAssist(live.id)
    const r = await openAssist(body)
    setLive({ id: r.session, view: r.view })
    window.scrollTo({ top: 0 })
  })
  const act = (f: (id: string) => Promise<{ view: AssistView }>) => run(async () => {
    if (!live) return
    const r = await f(live.id)
    setLive({ id: live.id, view: r.view })
  })
  const exit = () => {
    if (live) closeAssist(live.id)
    setLive(null)
  }

  return (
    <div className="pb-6">
      <PageHeader title="出牌助手" sub={live ? undefined : '配好编成，一边在游戏里打 H.I.F 审查一边看 AI 建议怎么出。建议来自 GKMS 引擎（rev383）+ UINet Ver2.1，不看种子、不偷看牌堆顺序。'} />
      {live ? (
        <Play view={live.view} busy={busy} onExit={exit}
          onHand={(cards) => act((id) => assistHand(id, cards))}
          onStep={(a) => act((id) => assistStep(id, a))}
          onUndo={() => act((id) => assistUndo(id))}
          onNumbers={(n) => act((id) => assistNumbers(id, n))} />
      ) : (
        <Editor draft={draft} setDraft={setDraft} busy={busy}
          onStart={(practice) => start({ loadout: loadoutFromDraft(draft), practice })}
          onResume={(code) => start({ code, practice: false })} />
      )}
    </div>
  )
}
