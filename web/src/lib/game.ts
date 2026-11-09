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

export const TAG_LABEL: Record<string, string> = { mechanic: '机制', stage: '阶段', idol: '偶像', deck: '牌组', round: '轮次', produce: '考试' }

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
  'hif-live': { title: '实机开局', blurb: '数字小广在 H.I.F 实战里打过的开局（Campus mode!! 篠澤広）。每题 1 个实机种子加 4 个随机种子。' },
  gkms480: { title: '审查题库', blurb: 'GKMS 按主数据生成的题：6 种机制 × 4 位偶像 × 2 种牌组 × 5 个阶段，每题 2 个种子。不含实机录制。' },
}

export function modeLabel(mode: string | undefined, privileged: boolean) {
  if (privileged) return { text: '上限', hint: '看种子的搜索，只作分母，不参与排名' }
  if (mode === 'hosted') return { text: '托管', hint: '种子留在服务器，算法每一步交动作，服务器计时' }
  return { text: '自报', hint: '本地跑完上传，服务器按种子重放核对过分数，但证明不了算法没偷看种子' }
}
