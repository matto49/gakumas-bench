/** 取数据用 TanStack Query：同一个接口地址全站共用一份缓存，几个组件同时要只发一次请求，切回来先显示缓存、过期了后台再取。
 * 缓存的键是 ['api', 地址]（地址带查询参数），见 hooks.ts 的 useApi */
import { QueryClient } from '@tanstack/react-query'
import { api, ApiError } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 30 秒内再要同一份直接用缓存；过了 30 秒，用到时先给缓存、后台再取一次
      staleTime: 30_000,
      // 5 分钟没人用的缓存丢掉
      gcTime: 5 * 60_000,
      // 切回浏览器标签页不自动重取：排行、对局这些不会秒级变化，自动重取只会让页面闪
      refetchOnWindowFocus: false,
      // 4xx（没登录、没有这个东西）不重试；网络或 5xx 重试一次
      retry: (n, err) => n < 1 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
    },
  },
})

export const apiKey = (path: string) => ['api', path] as const

/** 在组件外取一份（带缓存）：effect 里串着取好几个接口时用 */
export function fetchApi<T>(path: string) {
  return queryClient.fetchQuery({ queryKey: apiKey(path), queryFn: () => api<T>(path) })
}

/** 改了数据以后，让地址以 prefix 开头的缓存都过期（正在用的马上重取） */
export function invalidateApi(prefix: string) {
  return queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'api' && String(q.queryKey[1]).startsWith(prefix) })
}

// 登录、退出后很多接口的结果会变（我是谁、能不能编辑）：缓存全部作废，正在用的马上重取
if (typeof window !== 'undefined') window.addEventListener('gkb-auth', () => void queryClient.invalidateQueries())
