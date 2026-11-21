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
