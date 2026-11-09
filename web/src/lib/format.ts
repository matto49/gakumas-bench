import type { Ratio } from './api'

const nf = new Intl.NumberFormat('zh-CN')

export const int = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? '—' : nf.format(Math.round(v)))

export function compact(v: number) {
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`
  return `${Math.round(v)}`
}

export function ms(v: number | null | undefined) {
  if (v == null) return '—'
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 2)} s`
  if (v >= 10) return `${v.toFixed(0)} ms`
  return `${v.toFixed(1)} ms`
}

export function secs(v: number | null | undefined) {
  if (v == null) return '—'
  if (v >= 60) return `${(v / 60).toFixed(1)} 分`
  return `${v.toFixed(v >= 10 ? 0 : 1)} s`
}

export const pct = (r: Ratio | null | undefined, digits = 1) => (r ? `${(r.geo * 100).toFixed(digits)}%` : '—')
export const pm = (r: Ratio | null | undefined, digits = 1) => (r ? `±${(r.se * 100).toFixed(digits)}` : '')

export function when(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function shortCommit(c?: string) {
  return c ? c.slice(0, 7) : '—'
}
