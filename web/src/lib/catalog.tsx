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

export function cardName(cat: Catalog | null, id: string, u = 0) {
  const c = cat?.cards[id]
  if (!c) return id
  return c.up[String(u)]?.name ?? c.name + '+'.repeat(u)
}

export function idolName(cat: Catalog | null, id: string) {
  return cat?.idols[id]?.name ?? id
}

export function drinkName(cat: Catalog | null, id: string) {
  return cat?.drinks[id]?.name ?? id
}

export function enchantName(cat: Catalog | null, id: string) {
  const e = cat?.enchants[id]
  if (e?.name) return e.name
  return e?.text?.split('\n')[0]?.slice(0, 18) ?? id
}
