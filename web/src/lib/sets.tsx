import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type SetInfo } from './api'
import { SET_INFO } from './game'

/** 試験集合：全站共用一份 /api/sets（名称、说明、场景统计），上传或建集合后 reload */
type Ctx = { sets: SetInfo[] | null; reload: () => void }
const SetsCtx = createContext<Ctx>({ sets: null, reload: () => {} })

export function SetsProvider({ children }: { children: ReactNode }) {
  const [sets, setSets] = useState<SetInfo[] | null>(null)
  const reload = useCallback(() => {
    api<SetInfo[]>('api/sets').then(setSets).catch(() => setSets((s) => s ?? []))
  }, [])
  useEffect(() => {
    reload()
    const f = () => reload()
    window.addEventListener('gkb-auth', f) // 登录后能不能编辑会变
    return () => window.removeEventListener('gkb-auth', f)
  }, [reload])
  return <SetsCtx.Provider value={{ sets, reload }}>{children}</SetsCtx.Provider>
}

export function useSets() {
  return useContext(SetsCtx)
}

/** 集合的显示名：服务器配置的名字优先，老代码里的名字兜底，最后用编号 */
export function setTitleOf(sets: SetInfo[] | null, id: string) {
  return sets?.find((s) => s.set === id)?.title || SET_INFO[id]?.title || id
}

export function setBlurbOf(sets: SetInfo[] | null, id: string) {
  return sets?.find((s) => s.set === id)?.blurb || SET_INFO[id]?.blurb || ''
}

export function useSetTitle() {
  const { sets } = useSets()
  return (id: string) => setTitleOf(sets, id)
}

/** 官方集合的固定顺序：H.I.F 在前（排行页默认打开它），没列出的排在后面 */
const SET_ORDER = ['hif', 'nia', 'hajime', 'idolroad']

/** 2026-11-11 集合按模式合并：旧集合名 → 新集合 + 考试页的筛选条件（服务器 server/setalias.go 有同样的表，旧名的接口照常能用） */
export const OLD_SETS: Record<string, { set: string; filter: Record<string, string> }> = {
  'hif-live': { set: 'hif', filter: { source: 'live' } },
  'hif-history': { set: 'hif', filter: { source: 'history' } },
  'hif-yuzeis': { set: 'hif', filter: { by: 'yuzeis' } },
  'nia-history': { set: 'nia', filter: { source: 'history' } },
  'nia-yuzeis': { set: 'nia', filter: { by: 'yuzeis' } },
  'hajime-history': { set: 'hajime', filter: { source: 'history' } },
  'hajime-yuzeis': { set: 'hajime', filter: { by: 'yuzeis' } },
  'hajime-lesson-yuzeis': { set: 'hajime', filter: { kind: 'lesson' } },
  'idolroad-yuzeis': { set: 'idolroad', filter: { by: 'yuzeis' } },
}

function setRank(id: string) {
  const i = SET_ORDER.indexOf(id)
  return i < 0 ? SET_ORDER.length : i
}

/** 官方集合排在前面，各组里按 SET_ORDER，再按名字 */
export function sortSets(xs: SetInfo[]) {
  return [...xs].sort((a, b) => Number(a.status === 'community') - Number(b.status === 'community')
    || setRank(a.set) - setRank(b.set) || a.set.localeCompare(b.set))
}
