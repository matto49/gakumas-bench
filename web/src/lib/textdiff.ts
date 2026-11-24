/** 卡牌效果文字的逐字比较：标出 next 比 prev 新增或改动的字（删掉的不显示）。
 * 数字连同小数点、百分号算一个单位（「50%」→「60%」整个「60%」标出来，不只标「6」），其余逐字比。最长公共子序列，效果文字几百字以内，直接 DP */
const TOKEN = /\d+(?:\.\d+)?%?|[\s\S]/gu

export type Seg = { t: string; add: boolean }

export function diffAdded(prev: string, next: string): Seg[] {
  const a = prev.match(TOKEN) ?? []
  const b = next.match(TOKEN) ?? []
  const n = a.length, m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: Seg[] = []
  const push = (t: string, add: boolean) => {
    const last = out[out.length - 1]
    if (last && last.add === add) last.t += t
    else out.push({ t, add })
  }
  let i = 0, j = 0
  while (j < m) {
    if (i < n && a[i] === b[j]) { push(b[j], false); i++; j++ }
    else if (i < n && dp[i + 1][j] >= dp[i][j + 1]) i++
    else { push(b[j], /\S/.test(b[j])); j++ }
  }
  return out
}

const KANA = /[\u3040-\u30ff]/
const tokens = (s: string) => s.match(TOKEN) ?? []

/** 两行有多像：公共单位数 / 较长那行的单位数 */
function similarity(a: string, b: string) {
  const x = tokens(a), y = tokens(b)
  if (!x.length || !y.length) return 0
  const prev = new Uint16Array(y.length + 1), cur = new Uint16Array(y.length + 1)
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    prev.set(cur)
  }
  return prev[y.length] / Math.max(x.length, y.length)
}

/** 按行比：先找完全没变的行；变了的行和上一档同位置的行配对，够像（≥ 一半）就逐字标，不像的整行标。
 * 两档一档是日文一档是中文（汉化缺了某一档）时比不出意义，一个字都不标 */
export function diffLines(prev: string, next: string): Seg[][] {
  const plain = next.split('\n').map((t) => [{ t, add: false }])
  if (KANA.test(prev) !== KANA.test(next)) return plain
  const a = prev.split('\n'), b = next.split('\n')
  const n = a.length, m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: Seg[][] = []
  let i = 0, j = 0
  let gapA: string[] = []
  while (j < m) {
    if (i < n && a[i] === b[j]) { out.push([{ t: b[j], add: false }]); gapA = []; i++; j++ }
    else if (i < n && dp[i + 1][j] >= dp[i][j + 1]) { gapA.push(a[i]); i++ }
    else {
      const old = gapA.shift()
      out.push(old != null && similarity(old, b[j]) >= 0.5 ? diffAdded(old, b[j]) : [{ t: b[j], add: /\S/.test(b[j]) }])
      j++
    }
  }
  return out
}

/** 按换行切成行，每行是若干段 */
export function toLines(segs: Seg[]): Seg[][] {
  const lines: Seg[][] = [[]]
  for (const s of segs) {
    s.t.split('\n').forEach((part, k) => {
      if (k > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ t: part, add: s.add })
    })
  }
  return lines
}
