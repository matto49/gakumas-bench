import type { AlgoDoc } from './api'

export type RunDisplayCatalog = {
  profiles: Record<string, {
    owner: string
    name: string
    summary: string
    detail?: string[]
    source_url?: string
  }>
  runs: Record<string, { profile: string; set: string; alias_of?: string }>
}

/** Optional operator-reviewed text. Match the exact run and authenticated uploader. */
export function runDisplay(catalog: RunDisplayCatalog | null, run?: { run: string; by?: string; set?: string; about?: AlgoDoc } | null) {
  if (!catalog || !run?.by) return undefined
  const entry = catalog.runs?.[run.run]
  const profile = entry && catalog.profiles?.[entry.profile]
  if (!profile?.name || !profile.summary || profile.owner !== run.by || !run.set || run.set !== entry.set) return undefined
  const target = entry.alias_of && catalog.runs[entry.alias_of]
  const aliasOf = target && target.set === entry.set && catalog.profiles[target.profile]?.owner === run.by ? entry.alias_of : undefined
  const links = [...(run.about?.links ?? [])]
  if (profile.source_url?.startsWith('https://') && !links.some((l) => l.url === profile.source_url)) {
    links.push({ title: '算法源码 / Source', url: profile.source_url })
  }
  const about: AlgoDoc = { ...run.about, source: run.about?.source ?? 'submitter', summary: profile.summary, detail: profile.detail, links }
  return { name: profile.name, about, aliasOf }
}
