import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, BASE, type Catalog } from './api'

const Ctx = createContext<Catalog | null>(null)

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [cat, setCat] = useState<Catalog | null>(null)
  useEffect(() => {
    api<Catalog>('api/catalog').then(setCat).catch(() => setCat({ cards: {}, drinks: {}, items: {}, enchants: {}, idols: {} }))
  }, [])
  return <Ctx.Provider value={cat}>{children}</Ctx.Provider>
}

export function useCatalog() {
  return useContext(Ctx)
}

export const spriteUrl = (asset: string) => `${BASE}sprites/${asset}.png`
export const idolThumbUrl = (id: string) => `${BASE}sprites/idol-${id}.webp`
export const gradeUrl = (key: string) => `${BASE}sprites/rank-${key}.webp`

export function cardName(cat: Catalog | null, id: string, u = 0) {
  const c = cat?.cards[id]
  if (!c) return id
  return c.up[String(u)]?.name ?? c.name + '+'.repeat(u)
}

export function idolName(cat: Catalog | null, id: string) {
  return cat?.idols[id]?.name ?? id
}

/** 偶像名去掉【卡名】前缀，只留人名 */
export function idolShort(cat: Catalog | null, id: string) {
  const n = idolName(cat, id)
  return n.includes('】') ? n.slice(n.indexOf('】') + 1) : n
}

export function drinkName(cat: Catalog | null, id: string) {
  return cat?.drinks[id]?.name ?? id
}

export function enchantName(cat: Catalog | null, id: string) {
  const e = cat?.enchants[id]
  if (e?.name) return e.name
  return e?.text?.split('\n')[0]?.slice(0, 18) ?? id
}
