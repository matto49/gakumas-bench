import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

/** loadedPath：data 是按哪个地址取回来的。地址换了、新的还没回来时，data 仍是上一个地址的，页面可以用它判断该不该先藏起来 */
export type Loadable<T> = { data: T | null; error: Error | null; loading: boolean; reload: () => void; loadedPath: string | null }

export function useApi<T>(path: string | null): Loadable<T> {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean; loadedPath: string | null }>({ data: null, error: null, loading: !!path, loadedPath: null })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!path) return
    let live = true
    setState((s) => ({ ...s, loading: true, error: null }))
    api<T>(path)
      .then((data) => live && setState({ data, error: null, loading: false, loadedPath: path }))
      .catch((error: Error) => live && setState({ data: null, error, loading: false, loadedPath: null }))
    return () => {
      live = false
    }
  }, [path, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}
