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

/** 官方集合排在前面，各组里按名字 */
export function sortSets(xs: SetInfo[]) {
  return [...xs].sort((a, b) => Number(a.status === 'community') - Number(b.status === 'community') || a.set.localeCompare(b.set))
}
