package main

// 中文目录：照学マス汉化插件（gakuen-imas-localify）替换主数据的办法，把汉化数据叠到主数据上，再用同一套代码生成目录。
//
// 汉化数据是 imas-tools/gakumas-master-translation 的 data/<表名>.json（插件的 local-files/masterTrans 是同一份）：
//
//	{"rules": {"primaryKeys": ["id", "upgradeCount", "produceDescriptions.targetId", …]},
//	 "data": [{"id": …, "upgradeCount": 1, "name": "元气的问候+", "produceDescriptions": [{…, "text": "体力消耗"}, …]}, …]}
//
// 插件按 primaryKeys 找到主数据里的同一行，只换文字字段（name、description、text 等），数值和结构不动。
// 这里也一样：顶层主键（不带「.」的）定位行；顶层字符串字段直接换；数组字段按下标一条条对，
// 每条先核对能对上的子键（targetId 等）一致才换它的 text。汉化留空或对不上的地方保留日文。

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type trTable struct {
	keys []string       // 顶层主键
	rows map[string]row // 主键值 → 汉化行
}

type trStats struct {
	rows, hit, nestedSkip int
}

var trStat = map[string]*trStats{}

func loadTr(dir, name string) *trTable {
	b, err := os.ReadFile(filepath.Join(dir, name+".json"))
	if err != nil {
		return nil
	}
	var doc struct {
		Rules struct {
			PrimaryKeys []string `json:"primaryKeys"`
		} `json:"rules"`
		Data []row `json:"data"`
	}
	if json.Unmarshal(b, &doc) != nil {
		return nil
	}
	t := &trTable{rows: map[string]row{}}
	for _, k := range doc.Rules.PrimaryKeys {
		if !strings.Contains(k, ".") {
			t.keys = append(t.keys, k)
		}
	}
	for _, r := range doc.Data {
		t.rows[trKey(r, t.keys)] = r
	}
	return t
}

// 主键值拼成字符串。主数据里值为 0 / 空的字段常常整个省略，汉化数据里写了 0，所以 0、""、缺省一律算空。
func trKey(r row, keys []string) string {
	parts := make([]string, len(keys))
	for i, k := range keys {
		switch v := r[k].(type) {
		case nil:
		case string:
			parts[i] = v
		case float64:
			if v != 0 {
				parts[i] = fmt.Sprint(v)
			}
		case map[string]any: // 主数据的枚举是 {name, number}
			if n, ok := v["number"].(float64); ok && n != 0 {
				parts[i] = fmt.Sprint(n)
			}
		default:
			parts[i] = fmt.Sprint(v)
		}
	}
	return strings.Join(parts, "|")
}

// 汉化数据的子键是 camelCase，主数据（GKMS 解出来的）是 snake_case
func snake(s string) string {
	var b strings.Builder
	for i, c := range s {
		if c >= 'A' && c <= 'Z' {
			if i > 0 {
				b.WriteByte('_')
			}
			b.WriteRune(c - 'A' + 'a')
		} else {
			b.WriteRune(c)
		}
	}
	return b.String()
}

// 数组里的一条：能核对的子键（字符串、不是 text）都要和主数据一致
func sameItem(m, t map[string]any) bool {
	for k, v := range t {
		s, ok := v.(string)
		if !ok || k == "text" || strings.HasSuffix(s, "_Unknown") {
			continue
		}
		mv := m[k]
		if mv == nil {
			mv = m[snake(k)]
		}
		switch x := mv.(type) {
		case string:
			if x != s {
				return false
			}
		case nil:
			if s != "" {
				return false
			}
		}
		// 枚举（{name, number}）两边写法不同，不比
	}
	return true
}

func overlay(name string, rows []row, t *trTable) []row {
	if t == nil {
		return rows
	}
	st := &trStats{rows: len(rows)}
	trStat[name] = st
	out := make([]row, len(rows))
	for i, r := range rows {
		tr, ok := t.rows[trKey(r, t.keys)]
		if !ok {
			out[i] = r
			continue
		}
		st.hit++
		n := row{}
		for k, v := range r {
			n[k] = v
		}
		for k, tv := range tr {
			switch x := tv.(type) {
			case string:
				if _, isStr := r[k].(string); isStr && x != "" {
					n[k] = x
				}
			case []any:
				orig, _ := r[k].([]any)
				if len(orig) != len(x) {
					if len(x) > 0 {
						st.nestedSkip++
					}
					continue
				}
				arr := make([]any, len(orig))
				okAll := true
				for j := range orig {
					om, _ := orig[j].(map[string]any)
					tm, _ := x[j].(map[string]any)
					if om == nil || tm == nil || !sameItem(om, tm) {
						okAll = false
						break
					}
					c := map[string]any{}
					for kk, vv := range om {
						c[kk] = vv
					}
					if s, _ := tm["text"].(string); s != "" {
						c["text"] = s
					}
					arr[j] = c
				}
				if okAll {
					n[k] = arr
				} else {
					st.nestedSkip++
				}
			}
		}
		out[i] = n
	}
	return out
}

// 目录里自己拼的文字（主数据没有的）：日文 / 中文各一套。中文叫法照汉化数据（打分、元气、干劲、好调……）
type texts struct {
	value, permil, change map[string]string
	memSuffix, customItem string
}

var jaTexts = texts{value: growValueText, permil: growPermilText, change: growChangeText, memSuffix: "（回忆）", customItem: "定制 P 道具"}

var zhTexts = texts{
	value: map[string]string{
		"LESSON_ADD": "打分+%d", "LESSON_REDUCE": "打分-%d", "LESSON_COUNT_ADD": "打分次数+%d", "LESSON_COUNT_REDUCE": "打分次数-%d",
		"BLOCK_ADD": "元气+%d", "BLOCK_REDUCE": "元气-%d", "AGGRESSIVE_ADD": "干劲+%d", "REVIEW_ADD": "好印象+%d", "LESSON_BUFF_ADD": "集中+%d",
		"FULL_POWER_POINT_ADD": "全力值+%d", "FULL_POWER_POINT_REDUCE": "全力值-%d",
		"PARAMETER_BUFF_TURN_ADD": "好调+%d回合", "PARAMETER_BUFF_MULTIPLE_PER_TURN_ADD": "绝好调+%d回合", "STAMINA_CONSUMPTION_DOWN_TURN_ADD": "消耗体力减少+%d回合",
		"COST_REDUCE": "消耗-%d", "COST_ADD": "消耗+%d", "COST_PENETRATE_REDUCE": "体力消耗-%d", "COST_PENETRATE_ADD": "体力消耗+%d",
		"COST_AGGRESSIVE_REDUCE": "干劲消耗-%d", "COST_AGGRESSIVE_ADD": "干劲消耗+%d", "COST_REVIEW_REDUCE": "好印象消耗-%d", "COST_REVIEW_ADD": "好印象消耗+%d",
		"COST_LESSON_BUFF_REDUCE": "集中消耗-%d", "COST_LESSON_BUFF_ADD": "集中消耗+%d", "COST_FULL_POWER_POINT_REDUCE": "全力值消耗-%d", "COST_FULL_POWER_POINT_ADD": "全力值消耗+%d",
		"COST_PARAMETER_BUFF_REDUCE": "好调消耗-%d回合", "COST_PARAMETER_BUFF_ADD": "好调消耗+%d回合", "COST_PARAMETER_BUFF_MULTIPLE_PER_TURN_REDUCE": "绝好调消耗-%d回合",
	},
	permil: map[string]string{
		"LESSON_DEPEND_BLOCK_ADD": "元气的打分比例+%s%%", "LESSON_DEPEND_EXAM_REVIEW_ADD": "好印象的打分比例+%s%%", "LESSON_DEPEND_EXAM_CARD_PLAY_AGGRESSIVE_ADD": "干劲的打分比例+%s%%",
	},
	change: map[string]string{
		"EFFECT_ADD": "效果追加", "EFFECT_CHANGE": "效果变更", "CARD_STATUS_ENCHANT_CHANGE": "成长变更",
		"PLAY_TRIGGER_CHANGE": "使用条件变更", "PLAY_EFFECT_TRIGGER_CHANGE": "效果发动条件变更",
		"INITIAL_ADD": "训练开始时加入手牌", "PLAY_MOVE_POSITION_TYPE_CHANGE": "使用后去向变更",
	},
	memSuffix: "（回忆）", customItem: "定制 P 道具",
}
