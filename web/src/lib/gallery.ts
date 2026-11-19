/** 图鉴（gkbench.gallery.v1）：gkbench/gallery.py 生成，GET api/site/gallery。
 * 图在 sprites/gallery/ 下，由 gkmas-assets/tools/export_gallery.py 从游戏资源导出 */
import { BASE } from './api'
import type { Bi } from './site'

export type GalleryChar = { id: string; name: Bi; stand: boolean; bustup: boolean }
/** 一套卡面：偶像卡本身的，或挂在某张偶像卡下的「光景」换装卡面（skin 是换装名）。arts：0 特训前、1 特训后、2 第三张 */
export type GalleryCard = { id: string; card: string; char: string; asset: string; rarity: string; name: Bi; skin?: Bi; arts: number[] }
export type GallerySupport = { id: string; rarity: string; name: Bi; chars: string[] }
/** 衣装、发型：desc 是怎么拿到；skin 是这套衣装来自哪套卡面（GalleryCard.id） */
export type GalleryOutfit = { id: string; char: string; name: Bi; desc: Bi; skin?: string }
export type Gallery = {
  format: string
  source?: { commit?: string; master_date?: string; built?: string }
  characters: GalleryChar[]
  cards: GalleryCard[]
  supports: GallerySupport[]
  costumes: GalleryOutfit[]
  heads: GalleryOutfit[]
}

const G = `${BASE}sprites/gallery/`
export const standUrl = (c: string) => `${G}chr/${c}-full.webp`
export const bustupUrl = (c: string) => `${G}chr/${c}-bustup.webp`
export const cardArtUrl = (asset: string, v: number, thumb = false) => `${G}card/${asset}_${v}${thumb ? '-t' : ''}.webp`
export const supportArtUrl = (id: string, thumb = false) => `${G}support/${id}${thumb ? '-t' : ''}.webp`
export const costumeUrl = (id: string) => `${G}cos/${id}.webp`
export const headUrl = (id: string) => `${G}head/${id}.webp`

export const ART_LABEL: Record<number, string> = { 0: '特训前', 1: '特训后', 2: '第三张' }
