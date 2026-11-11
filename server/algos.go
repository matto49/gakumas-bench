package main

// 算法说明：运行页和算法排行展示「大致思路、看得到什么、实现链接」。
// 运行表头里自带 summary / detail / sees / links 的（外部算法上传或托管时自己填的）优先；
// 否则按算法名对上内置算法的说明；都没有就不给（页面显示「提交人未提供」）。

import "strings"

type AlgoLink struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

type AlgoDoc struct {
	Summary string     `json:"summary"`          // 一句话
	Detail  []string   `json:"detail,omitempty"` // 分条的思路
	Sees    string     `json:"sees,omitempty"`   // screen：只看画面；seed：看牌序（提前知道整局的洗牌和随机结果）
	Links   []AlgoLink `json:"links,omitempty"`
	Private []string   `json:"private,omitempty"` // 依赖但不公开的部分（不挂链接）
	Source  string     `json:"source"`            // builtin 内置说明；submitter 提交人填写
}

const repoBlob = "https://github.com/matto49/gakumas-bench/blob/develop/"

// names：本仓库 gkbench/algos 实际写进表头的算法名（精确匹配，别人自己起的同前缀名字不会被套上）
var builtinAlgos = []struct {
	names []string
	doc   AlgoDoc
}{
	{[]string{"oracle"}, AlgoDoc{
		Summary: "提前知道整局牌序的限时搜索，只作「相对上限」的分母，不参与排名。",
		Detail: []string{
			"它提前知道这一局的牌序：整场的抽牌和随机结果都是确定的，一条出牌路线对应一个确定的终局分。",
			"开局用 GKMS 的整局求解（GNRPA 多次重启 + 最后一两回合精确求解），在参数 seconds 给的时间里算一条整场路线，之后照着打；路线走不通时在真局面上补搜。",
			"它不是真正的最优解：给更多时间往往还能更高。开局求解的时间不计入每步耗时。",
		},
		Sees: "seed",
		Links: []AlgoLink{
			{"本仓库实现 gkbench/algos/search.py（OracleAlgo）", repoBlob + "gkbench/algos/search.py"},
			{"GNRPA 论文（Cazenave, 2024）", "https://arxiv.org/abs/2401.10431"},
		},
		Private: []string{"整局求解来自 GKMS（私有仓库，未公开）"},
	}},
	{[]string{"official-ai"}, AlgoDoc{
		Summary: "asahi老师策略，也就是游戏官方 AI：学マス客户端自带的出牌 AI，比赛自动打和考试里高亮推荐卡用的就是它。它看牌序，排名时请注意。",
		Detail: []string{
			"决策代码是 GKMS 从安卓 3.2.1 客户端还原的官方搜索和评估，这里只用这部分算法，出牌、抽牌、随机结果全由裁判同款引擎（GKMS 原生核心）推进。",
			"每次决策往后搜到下一回合结束（两回合内，最多 5 步），按出牌顺序深度优先枚举；叶子局面用客户端的评估表（ProduceExamAutoEvaluation 等）打分，按偶像卡的推荐效果分组，已装上的持续效果按之后能带来多少折算进去。选分最高的一整段照着打完，再搜下一段。",
			"出牌里要选卡时（从山札选卡等），用客户端的选卡评分（ProduceExamAutoCardSelectEvaluation）选。",
			"它和游戏里一样在真实牌局上往后搜：接下来两回合抽到什么、随机结果是什么都是真的。所以标「看牌序」，不能托管跑，由管理员在本机打保密牌序后上传。",
			"它从不喝饮料：比赛 AI 没有饮料这个动作，H.I.F 的饮料它不会用。",
			"接到我们的引擎上有三处近似：持续效果的预测按每条效果的净变化记，不记其中的卡牌成长；「效果抽牌总数」一项按 0；出牌直接装上的定时效果一律当作技能卡带来的。",
		},
		Sees: "seed",
		Links: []AlgoLink{
			{"本仓库的引擎接入 gkbench/algos/official_ai.py", repoBlob + "gkbench/algos/official_ai.py"},
			{"单条效果执行的核心扩展 gkbench/algos/native/official_ai_ext.cpp", repoBlob + "gkbench/algos/native/official_ai_ext.cpp"},
		},
		Private: []string{"官方 AI 的还原代码在 GKMS 的 GKMSContest/official_ai（私有仓库，未公开）"},
	}},
	{[]string{"pimc", "pimc-vote", "pimc-eval"}, AlgoDoc{
		Summary: "确定化搜索（PIMC）：把看不到的山札顺序和随机数补全成多个世界，每个世界用 GNRPA 搜整场，再汇总。",
		Detail: []string{
			"每一步把看不到的部分（山札顺序、随机数状态）随机补全成 worlds 个「可能的世界」，手牌、状态等公开信息原样保留。",
			"vote 模式：每个世界用 GKMS 原生的 GNRPA 搜一条整场路线，按路线的第一步投票，平票比平均预期分。",
			"eval 模式：每个合法动作 × 每个世界先走这一步再搜，取平均预期分最高的动作（各动作共用同一组世界）。",
			"每次搜索的时间按每步预算扣掉取世界的时间后平分；参数 seconds 给定时按它来。",
		},
		Sees: "screen",
		Links: []AlgoLink{
			{"本仓库实现 gkbench/algos/search.py（PimcAlgo）", repoBlob + "gkbench/algos/search.py"},
			{"GNRPA 论文（Cazenave, 2024）", "https://arxiv.org/abs/2401.10431"},
		},
		Private: []string{"GNRPA 搜索核心来自 GKMS（私有仓库，未公开）"},
	}},
	{[]string{"uinet"}, AlgoDoc{
		Summary: "GKMS 公开的出牌神经网络：只看画面，直接给出每个动作的概率，不往前推演，每步几毫秒。",
		Detail: []string{
			"输入是画面上能看到的信息（UIObs v1：回合、数值、状态、手牌、牌区组成、饮料等），不知道牌序，看不到山札顺序。",
			"Set Transformer 网络，输出出牌策略和终局分数的预测；先模仿提前知道牌序的全信息搜索的出法，再用强化学习继续训练，导出成 ONNX。",
			"这里用的是 Ver1.1 模型，4 线程 CPU 推理。",
		},
		Sees: "screen",
		Links: []AlgoLink{
			{"本仓库实现 gkbench/algos/uinet.py", repoBlob + "gkbench/algos/uinet.py"},
			{"模型与代码 yuzeis/GKMSUINet（MIT）", "https://github.com/yuzeis/GKMSUINet"},
		},
	}},
	{[]string{"greedy"}, AlgoDoc{
		Summary: "贪心：打眼前估计加分最多、付得起的牌，没有就结束回合，从不喝饮料。",
		Detail: []string{
			"只看当前局面，不往后推演，作为下限参照。",
			"规则是 GKMS 的 greedy_policy；托管时在一个随机补全的世界上算，因为只读公开局面，结果和真局面相同。",
		},
		Sees: "screen",
		Links: []AlgoLink{
			{"本仓库实现 gkbench/algos/simple.py（GreedyAlgo）", repoBlob + "gkbench/algos/simple.py"},
		},
		Private: []string{"贪心规则来自 GKMS（私有仓库，未公开）"},
	}},
	{[]string{"random"}, AlgoDoc{
		Summary: "在当前能做的动作里均匀随机选一个，作为最低参照。",
		Sees:    "screen",
		Links: []AlgoLink{
			{"本仓库实现 gkbench/algos/simple.py（RandomAlgo）", repoBlob + "gkbench/algos/simple.py"},
		},
	}},
}

// algoName 运行表头的算法名：external:uinet → uinet；旧格式是 {name: ...}
func algoName(info map[string]any) string {
	var name string
	switch v := info["algo"].(type) {
	case string:
		name = v
	case map[string]any:
		name, _ = v["name"].(string)
	}
	name = strings.TrimPrefix(strings.TrimPrefix(name, "external:"), "internal:")
	if name == "" {
		name, _ = info["label"].(string)
	}
	return strings.ToLower(name)
}

// algoDoc 运行的算法说明；没有时返回 nil
func algoDoc(info map[string]any) *AlgoDoc {
	if s, _ := info["summary"].(string); strings.TrimSpace(s) != "" {
		d := &AlgoDoc{Summary: strings.TrimSpace(s), Source: "submitter"}
		if xs, ok := info["detail"].([]any); ok {
			for _, x := range xs {
				if t, ok := x.(string); ok && strings.TrimSpace(t) != "" {
					d.Detail = append(d.Detail, strings.TrimSpace(t))
				}
			}
		}
		if v, _ := info["sees"].(string); v == "screen" || v == "seed" {
			d.Sees = v
		}
		if xs, ok := info["links"].([]any); ok {
			for _, x := range xs {
				m, _ := x.(map[string]any)
				u, _ := m["url"].(string)
				t, _ := m["title"].(string)
				if strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "http://") {
					if t == "" {
						t = u
					}
					d.Links = append(d.Links, AlgoLink{t, u})
				}
			}
		}
		return d
	}
	name := algoName(info)
	for _, b := range builtinAlgos {
		for _, n := range b.names {
			if name == n {
				d := b.doc
				d.Source = "builtin"
				return &d
			}
		}
	}
	return nil
}

// withAbout 把提交人填的算法说明写进运行表头（summary / detail / sees / links，只收这几项、限长）
func withAbout(h map[string]any, about any) {
	m, ok := about.(map[string]any)
	if !ok || h == nil {
		return
	}
	clip := func(s string, n int) string {
		r := []rune(strings.TrimSpace(s))
		if len(r) > n {
			r = r[:n]
		}
		return string(r)
	}
	if f, _ := m["family"].(string); normFamily(f) != "" { // 家族不依赖说明：只写 family 也收
		h["family"] = normFamily(f)
	}
	if n, _ := m["family_name"].(string); cleanFamilyName(n) != "" {
		h["family_name"] = cleanFamilyName(n)
	}
	if s, _ := m["summary"].(string); clip(s, 300) != "" {
		h["summary"] = clip(s, 300)
	} else {
		return
	}
	if xs, ok := m["detail"].([]any); ok {
		var out []any
		for _, x := range xs {
			if t, ok := x.(string); ok && clip(t, 600) != "" && len(out) < 8 {
				out = append(out, clip(t, 600))
			}
		}
		if len(out) > 0 {
			h["detail"] = out
		}
	}
	if v, _ := m["sees"].(string); v == "screen" || v == "seed" {
		h["sees"] = v
	}
	if xs, ok := m["links"].([]any); ok {
		var out []any
		for _, x := range xs {
			l, _ := x.(map[string]any)
			u, _ := l["url"].(string)
			t, _ := l["title"].(string)
			if (strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "http://")) && len(out) < 6 {
				out = append(out, map[string]any{"title": clip(t, 120), "url": clip(u, 500)})
			}
		}
		if len(out) > 0 {
			h["links"] = out
		}
	}
}
