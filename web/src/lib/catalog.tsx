import { createContext, Fragment, useContext, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, BASE, type Catalog } from './api'
import { apiKey } from './query'
import { CATEGORY_JA, CATEGORY_ZH, IDOL_STYLE, IDOL_STYLE_ZH, PLAN, PLAN_ZH, setGameLang } from './game'

/** 游戏里的名字和效果文字用日文还是中文（中文取学マス汉化插件的翻译，见 server/cmd/catalog/zh.go） */
export type Lang = 'ja' | 'zh'
const LANG_KEY = 'gkb-lang'

const Ctx = createContext<Catalog | null>(null)
const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'zh', setLang: () => {} })

/** 默认中文；只有自己点过「日」的人（存了 ja）才用日文原文 */
function savedLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'ja' ? 'ja' : 'zh'
  } catch {
    return 'zh'
  }
}

const EMPTY_CATALOG: Catalog = { cards: {}, drinks: {}, items: {}, enchants: {}, idols: {} }

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(savedLang)
  // 中日两份目录各自缓存：切过去再切回来不用重新下载（目录约 1 MB，不常变，缓存 10 分钟算新鲜）
  const path = lang === 'zh' ? 'api/catalog?lang=zh' : 'api/catalog'
  const q = useQuery({ queryKey: apiKey(path), queryFn: () => api<Catalog>(path), staleTime: 10 * 60_000 })
  // 取失败时给空目录，页面照常画（和原来一样）
  const cat: Catalog | null = q.data ?? (q.isError ? EMPTY_CATALOG : null)
  const setLang = (l: Lang) => {
    try {
      localStorage.setItem(LANG_KEY, l)
    } catch {
      /* 无痕模式存不了，只在这一页生效 */
    }
    setLangState(l)
  }
  // 游戏用语表（lib/game.ts 的 bi()）是模块级的：先设好再画；换语言时用 key 让整页重画一遍
  setGameLang(lang)
  return (
    <LangCtx.Provider value={{ lang, setLang }}>
      <Ctx.Provider value={cat}>
        <Fragment key={lang}>{children}</Fragment>
      </Ctx.Provider>
    </LangCtx.Provider>
  )
}

export function useCatalog() {
  return useContext(Ctx)
}

export function useLang() {
  return useContext(LangCtx)
}

/** 计划、卡的类型、偶像流派的叫法，跟着「日 / 中」开关 */
export function useTerms() {
  const { lang } = useContext(LangCtx)
  return lang === 'zh' ? { plan: PLAN_ZH, category: CATEGORY_ZH, style: IDOL_STYLE_ZH } : { plan: PLAN, category: CATEGORY_JA, style: IDOL_STYLE }
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
