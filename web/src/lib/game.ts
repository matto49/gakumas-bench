// 学マス用语：界面上用玩家熟悉的叫法，不用内部编号

export const ATTR = {
  1: { key: 'vo', label: 'Vo', name: 'Vocal' },
  2: { key: 'da', label: 'Da', name: 'Dance' },
  3: { key: 'vi', label: 'Vi', name: 'Visual' },
} as const

export const PLAN: Record<string, string> = {
  COMMON: '通用',
  PLAN1: 'センス',
  PLAN2: 'ロジック',
  PLAN3: 'アノマリー',
  '2': 'センス',
  '3': 'ロジック',
  '4': 'アノマリー',
}

export const MECHANIC: Record<string, string> = {
  parameter_buff: '好調',
  lesson_buff: '集中',
  review: '好印象',
  aggressive: 'やる気',
  stance: '指針',
  full_power: '全力',
}

export const STAGE: Record<string, string> = {
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
}

export const ROUND: Record<string, string> = { mid1: '中間 1', mid2: '中間 2', final: '最終' }

export const PRODUCE: Record<string, string> = { 'produce-007': '選抜試験', 'produce-008': '本戦' }

export const DECK: Record<string, string> = { tutorial: '攻略牌组', random: '随机牌组' }

// 状态图标（UIObs status 种类）→ 游戏里的叫法
export const STATUS: Record<string, string> = {
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
}

export const STANCE: Record<string, string> = {
  Preservation: '温存',
  OverPreservation: '強気温存',
  Leisurely: 'のんびり',
  Concentration: '強気',
  FullPower: '全力',
}

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
  'hif-live': { title: 'H.I.F真实记录测试集', blurb: 'H.I.F 实战里打过的 5 个开局，篠澤広。' },
  gkms480: { title: 'H.I.F随机牌组测试', blurb: 'GKMS 按主数据生成：6 种机制 × 4 位偶像 × 2 种牌组 × 5 个阶段。' },
}

/** 种子模式。fixed：固定种子题；template：题模板，每题固定 32 个保密种子；legacy：11-09 以前每次临时抽种子的旧评测 */
export type Kind = 'fixed' | 'template' | 'legacy'

export const KIND_INFO: Record<Kind, { title: string; hint: string }> = {
  fixed: {
    title: '固定种子',
    hint: '每道题配几个公开的种子，大家打同一批，逐局配对比较。可以本地跑完上传，也可以托管跑。',
  },
  template: {
    title: '保密种子',
    hint: '每道题固定 32 个种子，只存在服务器上，所有算法打同一组。只能托管跑，算法看不到种子；逐局记录登录后才能看。',
  },
  legacy: {
    title: '旧版评测',
    hint: '11 月 9 日以前的题模板评测：每次评测临时抽种子，各算法打的种子不同，只能按题平均后比较，和现在的保密种子成绩不可比。',
  },
}

export function modeLabel(mode: string | undefined, privileged: boolean) {
  if (privileged) return { text: '上限', hint: '提前知道种子的搜索。只当分母，不排名。' }
  if (mode === 'hosted') return { text: '托管', hint: '种子留在服务器上，算法每步向服务器要画面、交动作，用时按服务器计。' }
  if (mode === 'player') return { text: '玩家', hint: '玩家实战记录。' }
  if (mode === 'internal') return { text: '内置', hint: '在服务器或出题方机器上跑的内置算法。' }
  return { text: '自报', hint: '本地跑完上传，服务器按种子逐局重放核对过分数；但证明不了算法没偷看种子。' }
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
