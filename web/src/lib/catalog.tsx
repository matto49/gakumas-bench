import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, BASE, type Catalog } from './api'
import { CATEGORY_JA, CATEGORY_ZH, IDOL_STYLE, IDOL_STYLE_ZH, PLAN, PLAN_ZH, setGameLang } from './game'

/** 游戏里的名字和效果文字用日文还是中文（中文取学マス汉化插件的翻译，见 server/cmd/catalog/zh.go） */
export type Lang = 'ja' | 'zh'
const LANG_KEY = 'gkb-lang'

const Ctx = createContext<Catalog | null>(null)
const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'ja', setLang: () => {} })

function savedLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'zh' ? 'zh' : 'ja'
  } catch {
    return 'ja'
  }
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [cat, setCat] = useState<Catalog | null>(null)
  const [lang, setLangState] = useState<Lang>(savedLang)
  useEffect(() => {
    let live = true
    api<Catalog>(lang === 'zh' ? 'api/catalog?lang=zh' : 'api/catalog')
      .then((c) => live && setCat(c))
      .catch(() => live && setCat({ cards: {}, drinks: {}, items: {}, enchants: {}, idols: {} }))
    return () => {
      live = false
    }
  }, [lang])
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
