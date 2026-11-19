import { useCallback, useRef } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from './api'
import { apiKey } from './query'

/** loadedPath：data 是按哪个地址取回来的。地址换了、新的还没回来时，data 仍是上一个地址的，页面可以用它判断该不该先藏起来 */
export type Loadable<T> = { data: T | null; error: Error | null; loading: boolean; reload: () => void; loadedPath: string | null }

/** 取一个接口（TanStack Query，缓存见 lib/query.ts）。path 为 null 时不取。
 * loading：这个地址还没有自己的数据（第一次取，或地址刚换、手上只有上一个地址的）；有缓存时后台重取不算 loading，页面不闪 */
export function useApi<T>(path: string | null): Loadable<T> {
  const q = useQuery({
    queryKey: apiKey(path ?? ''),
    queryFn: () => api<T>(path!),
    enabled: !!path,
    placeholderData: keepPreviousData,
  })
  // 最近一次真正属于自己地址的数据是哪个地址的
  const last = useRef<string | null>(null)
  if (path && q.data !== undefined && !q.isPlaceholderData) last.current = path
  const has = q.data !== undefined
  const { refetch } = q
  const reload = useCallback(() => void refetch(), [refetch])
  return {
    data: has ? (q.data as T) : null,
    error: q.error,
    loading: !!path && (q.isPending || q.isPlaceholderData || (q.isFetching && !!q.error)),
    reload,
    loadedPath: !has ? null : q.isPlaceholderData ? last.current : path,
  }
}
