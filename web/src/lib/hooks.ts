import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

export type Loadable<T> = { data: T | null; error: Error | null; loading: boolean; reload: () => void }

export function useApi<T>(path: string | null): Loadable<T> {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: !!path })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!path) return
    let live = true
    setState((s) => ({ ...s, loading: true, error: null }))
    api<T>(path)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error: Error) => live && setState({ data: null, error, loading: false }))
    return () => {
      live = false
    }
  }, [path, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}
