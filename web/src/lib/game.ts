// 学マス用语：界面上用玩家熟悉的叫法，不用内部编号

/** 游戏用语用日文还是中文：CatalogProvider 按右上角「日 / 中」开关设（切换时整页重绘）。
 * 下面带 bi() 的表都跟着它走：中文照学マス汉化插件的叫法，中文表里没有的键照用日文。 */
let gameLang: 'ja' | 'zh' = 'ja'
export function setGameLang(l: 'ja' | 'zh') {
  gameLang = l
}
function bi(ja: Record<string, string>, zh: Record<string, string>): Record<string, string> {
  return new Proxy(ja, {
    get: (t, k) => (gameLang === 'zh' && typeof k === 'string' && k in zh ? zh[k] : t[k as string]),
  })
}

export const ATTR = {
  1: { key: 'vo', label: 'Vo', name: 'Vocal' },
  2: { key: 'da', label: 'Da', name: 'Dance' },
  3: { key: 'vi', label: 'Vi', name: 'Visual' },
} as const

export const PLAN: Record<string, string> = bi({
  COMMON: '通用',
  PLAN1: 'センス',
  PLAN2: 'ロジック',
  PLAN3: 'アノマリー',
  '2': 'センス',
  '3': 'ロジック',
  '4': 'アノマリー',
}, { PLAN1: '感性', PLAN2: '理性', PLAN3: '非凡', '2': '感性', '3': '理性', '4': '非凡' })

/** 中文叫法（「中」开关打开时用，照学マス汉化插件） */
export const PLAN_ZH: Record<string, string> = { COMMON: '通用', PLAN1: '感性', PLAN2: '理性', PLAN3: '非凡', '2': '感性', '3': '理性', '4': '非凡' }
export const CATEGORY_JA: Record<string, string> = { ACTIVE_SKILL: 'アクティブ', MENTAL_SKILL: 'メンタル', TROUBLE: 'トラブル' }
export const CATEGORY_ZH: Record<string, string> = { ACTIVE_SKILL: '主动', MENTAL_SKILL: '精神', TROUBLE: '干扰' }
export const IDOL_STYLE_ZH: Record<string, string> = {
  EXAM_PARAMETER_BUFF: '好调', EXAM_LESSON_BUFF: '集中', EXAM_REVIEW: '好印象', EXAM_CARD_PLAY_AGGRESSIVE: '干劲', EXAM_CONCENTRATION: '强气', EXAM_FULL_POWER: '全力',
}

/** 偶像卡的流派（IdolCard.examEffectType） */
export const IDOL_STYLE: Record<string, string> = bi({
  EXAM_PARAMETER_BUFF: '好調',
  EXAM_LESSON_BUFF: '集中',
  EXAM_REVIEW: '好印象',
  EXAM_CARD_PLAY_AGGRESSIVE: 'やる気',
  EXAM_CONCENTRATION: '強気',
  EXAM_FULL_POWER: '全力',
}, IDOL_STYLE_ZH)

export const MECHANIC: Record<string, string> = bi({
  parameter_buff: '好調',
  lesson_buff: '集中',
  review: '好印象',
  aggressive: 'やる気',
  stance: '指針',
  full_power: '全力',
}, { parameter_buff: '好调', aggressive: '干劲', stance: '指针' })

export const STAGE: Record<string, string> = bi({
  'hif.sel1': '選抜 1',
  'hif.sel2': '選抜 2',
  'hif.sel3': '選抜 3',
  'hif.main1': '本戦 1',
  'hif.main2': '本戦 2',
  sel1: '選抜 1',
  sel2: '選抜 2',
  sel3: '選抜 3',
  main1: '本戦 1',
  main2: '本戦 2',
  'hajime.audition_mid1': '中間審査',
  'hajime.audition_final': '最終審査',
  'nia.audition_mid1': '中間審査 1',
  'nia.audition_mid2': '中間審査 2',
  'nia.audition_final': '最終審査',
}, { 'hif.sel1': '选拔 1', 'hif.sel2': '选拔 2', 'hif.sel3': '选拔 3', 'hif.main1': '正赛 1', 'hif.main2': '正赛 2', sel1: '选拔 1', sel2: '选拔 2', sel3: '选拔 3', main1: '正赛 1', main2: '正赛 2', 'hajime.audition_mid1': '中间审查', 'hajime.audition_final': '最终审查', 'nia.audition_mid1': '中间审查 1', 'nia.audition_mid2': '中间审查 2', 'nia.audition_final': '最终审查' })

/** 阶段名：表里没有的，偶像之路 tower.N 写「N 层」；初的培育课程 hajime.N 的 N 是 GKMS 的步骤编号（看不出第几节课），写「培育课程 #N」 */
export function stageLabel(v: string): string {
  if (STAGE[v]) return STAGE[v]
  let m = /^tower\.(\d+)$/.exec(v)
  if (m) return `${m[1]} 层`
  m = /^hajime\.(\d+)$/.exec(v)
  if (m) return `培育课程 #${m[1]}`
  return v
}

/** 题的类型（服务器按阶段算的 kind）：集合卡片和筛选的第一层 */
export const KIND: Record<string, string> = bi({
  selection: '選抜',
  main: '本戦',
  mid: '中間審査',
  final: '最終審査',
  lesson: '培育课程',
  tower: '偶像之路',
}, { selection: '选拔', main: '正赛', mid: '中间审查', final: '最终审查' })

/** 题从哪来（meta.source.kind） */
export const SOURCE: Record<string, string> = bi({
  history: '育成履歴',
  capture: '采集站实录',
  live: '实战存档',
  upload: '上传',
  manual: '手工整理',
  bench: '生成',
}, { history: '培育履历' })

export const ROUND: Record<string, string> = bi({ mid1: '中間 1', mid2: '中間 2', final: '最終', lesson: '课程' }, { mid1: '中间 1', mid2: '中间 2', final: '最终' })

export const PRODUCE: Record<string, string> = bi({ 'produce-007': '選抜試験', 'produce-008': '本戦' }, { 'produce-007': '选拔考试', 'produce-008': '正赛' })

/** 試験集合的场景：考试（produce_id，名字取主数据 Produce 表），没写的显示原编号 */
export const EXAM: Record<string, string> = bi({
  'produce-001': '初 レギュラー',
  'produce-002': '初 プロ',
  'produce-003': '初 マスター',
  'produce-006': '初 レジェンド',
  'produce-004': 'N.I.A プロ',
  'produce-005': 'N.I.A マスター',
  'produce-007': 'H.I.F 選抜',
  'produce-008': 'H.I.F 本戦',
  tower: '偶像之路',
}, { 'produce-001': '初 Regular', 'produce-002': '初 Pro', 'produce-003': '初 Master', 'produce-006': '初 Legend', 'produce-004': 'N.I.A Pro', 'produce-005': 'N.I.A Master', 'produce-007': 'H.I.F 选拔', 'produce-008': 'H.I.F 正赛' })

/** 考试 + 阶段 + 轮次合成一句：「H.I.F 本戦 1 · 中間 1」（阶段名已含選抜 / 本戦，不重复） */
export function examLine(exam?: string, stage?: string, round?: string) {
  const ex = exam ? (EXAM[exam] ?? exam) : ''
  const st = stage ? stageLabel(stage) : ''
  const series = ex.includes(' ') ? ex.split(' ')[0] : ''
  // H.I.F 以外（初、N.I.A、偶像之路）：阶段名已经说清是哪场，考试名带难度，轮次不再重复
  if (series !== 'H.I.F' && (ex || st)) return [ex, st].filter(Boolean).join(' ')
  const head = st ? (series ? `${series} ${st}` : st) : ex
  return [head, round && (ROUND[round] ?? round)].filter(Boolean).join(' · ')
}

export const SCENE_LABEL: Record<string, string> = { kind: '类型', exam: '考试', stage: '阶段', round: '轮次', plan: '流派', mechanic: '机制', idol: '偶像', by: '提交人', source: '来源' }

export function sceneValueLabel(key: string, v: string, idolName?: (id: string) => string): string {
  switch (key) {
    case 'exam':
      return EXAM[v] ?? v
    case 'plan':
      return PLAN[v] ?? v
    case 'stage':
      return stageLabel(v)
    case 'round':
      return ROUND[v] ?? v
    case 'kind':
      return KIND[v] ?? v
    case 'source':
      return SOURCE[v] ?? v
    case 'mechanic':
      return MECHANIC[v] ?? v
    case 'idol':
      return idolName ? idolName(v) : v
  }
  return v
}

export const DECK: Record<string, string> = { tutorial: '攻略牌组', random: '随机牌组' }

// 状态图标（UIObs status 种类）→ 游戏里的叫法
export const STATUS: Record<string, string> = bi({
  lesson_buff: '集中',
  review: '好印象',
  aggressive: 'やる気',
  full_power_point: '全力値',
  enthusiastic: '熱意',
  anti_debuff: '低下状態無効',
  parameter_buff: '好調',
  parameter_buff_multiple: '絶好調',
  stance_lock: '指針固定',
  lesson_parameter_multiple: 'パラメータ上昇量増加',
  stamina_consumption_add: '消費体力増加',
  stamina_consumption_down: '消費体力減少',
  stamina_consumption_down_fix: '消費体力削減',
  playable_value_add: 'スキルカード使用数追加',
  block_restriction: '元気増加無効',
  search_effect_play_count: 'スキルカード追加発動',
  lesson_parameter_multiple_down: 'パラメータ上昇量減少',
  extra_turn: '追加ターン',
  hand_grave_count_card_draw: '手札入替',
  panic: '不調',
  slump: 'スランプ',
}, {
  aggressive: '干劲', full_power_point: '全力值', enthusiastic: '热意', anti_debuff: '状态下降无效', parameter_buff: '好调', parameter_buff_multiple: '绝好调',
  stance_lock: '指针固定', lesson_parameter_multiple: '打分提升量增加', stamina_consumption_add: '消耗体力增加', stamina_consumption_down: '消耗体力减少',
  stamina_consumption_down_fix: '消耗体力削减', playable_value_add: '技能卡使用数增加', block_restriction: '元气增加无效', search_effect_play_count: '技能卡追加发动',
  lesson_parameter_multiple_down: '打分上升量减少', extra_turn: '增加回合', hand_grave_count_card_draw: '更换手牌', panic: '不调', slump: '低迷',
})

export const STANCE: Record<string, string> = bi({
  Preservation: '温存',
  OverPreservation: '強気温存',
  Leisurely: 'のんびり',
  Concentration: '強気',
  FullPower: '全力',
}, { OverPreservation: '强气温存', Leisurely: '悠闲', Concentration: '强气' })

export const TAG_LABEL: Record<string, string> = { mechanic: '机制', stage: '场次', idol: '偶像', deck: '牌组', round: '轮次', produce: '考试' }

export function tagValueLabel(tag: string, v: string, idolName?: (id: string) => string): string {
  switch (tag) {
    case 'mechanic':
      return MECHANIC[v] ?? v
    case 'stage':
      return STAGE[v] ?? v
    case 'round':
      return ROUND[v] ?? v
    case 'produce':
      return PRODUCE[v] ?? v
    case 'deck':
      return DECK[v] ?? v
    case 'idol':
      return idolName ? idolName(v) : v
  }
  return v
}

export const SET_INFO: Record<string, { title: string; blurb: string }> = {
  hif: { title: 'H.I.F', blurb: 'H.I.F 实战开局：選抜 1～3、本戦两轮。' },
  nia: { title: 'N.I.A', blurb: 'N.I.A 实战开局：中间审查 1、2 和最终审查。' },
  hajime: { title: '初', blurb: '初实战开局：中间审查、最终审查和培育课程。' },
  idolroad: { title: '偶像之路', blurb: '偶像之路各层的实战开局。' },
}

/** 一次运行打的是哪种牌序。网页上不说「种子」，说「牌序」：一道题的一局，洗牌和随机结果定下来就是一种牌序。
 * template：每题固定 32 种随机牌序，只有服务器知道，排行只看它；fixed：每题另有几种牌序可以本地跑完上传（自测用，网页上不再单列排行）；
 * legacy：11-09 以前每次临时抽牌序的旧评测 */
export type Kind = 'fixed' | 'template' | 'legacy'

export const KIND_INFO: Record<Kind, { title: string; hint: string }> = {
  fixed: {
    title: '自测',
    hint: '每道题几种牌序，本地跑完上传，自测和调试用，不进排行。',
  },
  template: {
    title: '32 种牌序',
    hint: '每道题随机 32 种牌序，只有服务器知道，所有算法打同一组。只能托管跑，算法事先不知道牌序；逐局记录登录后才能看。',
  },
  legacy: {
    title: '旧版评测',
    hint: '11 月 9 日以前的题模板评测：每次评测临时抽牌序，各算法打的牌序不同，只能按题平均后比较，和现在的成绩不可比。',
  },
}

export function modeLabel(mode: string | undefined, privileged: boolean) {
  if (privileged) return { text: '上限', hint: '提前知道整局牌序的搜索。只当分母，不排名。' }
  if (mode === 'hosted') return { text: '托管', hint: '牌序只有服务器知道，算法每步向服务器要画面、交动作，用时按服务器计。' }
  if (mode === 'player') return { text: '玩家', hint: '玩家实战记录。' }
  if (mode === 'internal') return { text: '内置', hint: '在服务器或出题方机器上跑的内置算法。' }
  return { text: '自报', hint: '本地跑完上传，服务器逐局重放核对过分数；但证明不了算法没提前看牌序。' }
}

/** 评级：按「相对上限」划线，用游戏里的培育评级徽章 */
export const GRADES: [number, string, string][] = [
  [0.95, 'ss', 'SS'],
  [0.85, 'splus', 'S+'],
  [0.75, 's', 'S'],
  [0.6, 'aplus', 'A+'],
  [0.45, 'a', 'A'],
  [0.3, 'bplus', 'B+'],
  [0.15, 'b', 'B'],
  [0, 'c', 'C'],
]

export function gradeOf(ratio: number) {
  const g = GRADES.find(([t]) => ratio >= t) ?? GRADES[GRADES.length - 1]
  return { key: g[1], label: g[2] }
}

export const GRADE_HINT = '评级按相对上限划线：SS ≥95%，S+ ≥85%，S ≥75%，A+ ≥60%，A ≥45%，B+ ≥30%，B ≥15%，其余 C。'
