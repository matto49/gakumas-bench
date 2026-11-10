package main

// 排行榜：一套题上的所有运行放在一起比。口径和本地 `gkbench report` 一致：
//   相对上限  同题同种子对理论上限（特权算法）局的分数比，几何平均 ± 标准误
//   相对基准  同题同种子对基准运行的分数比，几何平均 ± 标准误，胜率（平局算半场）
//   耗时      每步思考的中位、95 分位、最长；每局思考总时长；超时步数

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
)

type Ratio struct {
	N   int     `json:"n"`
	Geo float64 `json:"geo"`
	SE  float64 `json:"se"`
	Win float64 `json:"win"`
}

type Row struct {
	Run             string            `json:"run"`            // 合并后：最新那次运行
	Runs            []string          `json:"runs,omitempty"` // 合进这一行的全部运行，新的在前（只有一次时省略）
	Label           string            `json:"label"`
	Mode            string            `json:"mode"`
	Uploader        string            `json:"by"`
	Kind            string            `json:"kind"`
	Params          any               `json:"params,omitempty"`
	Privileged      bool              `json:"privileged"`
	SeesSeed        bool              `json:"sees_seed,omitempty"` // 看牌序但照常排名（游戏官方 AI）
	BudgetS         any               `json:"step_seconds"`
	N               int               `json:"n"`
	Problems        int               `json:"problems"`
	SeedsPerProblem any               `json:"seeds_per_problem,omitempty"`
	Mean            float64           `json:"mean"`
	Errors          int               `json:"errors"`
	Unfinished      int               `json:"unfinished"`
	Over            int               `json:"over"`
	P50             float64           `json:"p50_ms"`
	P95             float64           `json:"p95_ms"`
	Max             float64           `json:"max_ms"`
	EpThinkS        float64           `json:"ep_think_s"`
	VsOracle        *Ratio            `json:"vs_oracle"`
	VsBase          *Ratio            `json:"vs_base,omitempty"`
	Groups          map[string]*Group `json:"groups,omitempty"`
	Engine          any               `json:"engine"`
	Algo            any               `json:"algo"`
	About           *AlgoDoc          `json:"about,omitempty"`
}

// Group 按题目标签分组后的成绩：相对上限（有上限时）、相对基准（选了基准时）、平均分
type Group struct {
	N        int     `json:"n"`
	Mean     float64 `json:"mean"`
	VsOracle *Ratio  `json:"vs_oracle"`
	VsBase   *Ratio  `json:"vs_base,omitempty"`
}

type key struct {
	p string
	s int
}

func pct(xs []float64, q float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	ys := append([]float64(nil), xs...)
	sort.Float64s(ys)
	i := int(q*float64(len(ys)-1) + 0.5)
	if i >= len(ys) {
		i = len(ys) - 1
	}
	return ys[i]
}

func ratioStats(pairs [][2]float64) *Ratio {
	var logs []float64
	wins := 0.0
	for _, p := range pairs {
		if p[0] > 0 && p[1] > 0 {
			logs = append(logs, math.Log(p[0]/p[1]))
		}
		switch {
		case p[0] > p[1]:
			wins++
		case p[0] == p[1]:
			wins += 0.5
		}
	}
	if len(logs) == 0 {
		return nil
	}
	m := 0.0
	for _, x := range logs {
		m += x
	}
	m /= float64(len(logs))
	se := 0.0
	if len(logs) > 1 {
		v := 0.0
		for _, x := range logs {
			v += (x - m) * (x - m)
		}
		se = math.Sqrt(v/float64(len(logs)-1)) / math.Sqrt(float64(len(logs)))
	}
	g := math.Exp(m)
	return &Ratio{N: len(logs), Geo: g, SE: g * se, Win: wins / float64(len(pairs))}
}

func privileged(info map[string]any) bool {
	p, _ := info["privileged"].(bool)
	return p
}

func tagOf(e EpisodeSummary, group string) string {
	if v, ok := e.Tags[group]; ok && v != nil {
		return fmt.Sprint(v)
	}
	return "（无）"
}

// perProblem 旧版题模板评测（各算法种子不同）：同一道题的各局合成一条（分数取平均），之后按题配对比较
func perProblem(idx []EpisodeSummary) map[key]EpisodeSummary {
	type acc struct {
		e   EpisodeSummary
		sum float64
		ts  float64
		n   int
	}
	m := map[string]*acc{}
	for _, e := range idx {
		a := m[e.ID]
		if a == nil {
			a = &acc{e: EpisodeSummary{ID: e.ID, Tags: e.Tags, Finished: true}}
			m[e.ID] = a
		}
		a.n++
		a.sum += e.Score
		a.ts += e.Secs
		a.e.Decisions += e.Decisions
		a.e.Over += e.Over
		a.e.StepMs = append(a.e.StepMs, e.StepMs...)
		a.e.Finished = a.e.Finished && e.Finished
		if e.Err != "" {
			a.e.Err = e.Err
		}
	}
	out := map[key]EpisodeSummary{}
	for p, a := range m {
		a.e.Score = a.sum / float64(a.n)
		a.e.Secs = a.ts / float64(a.n)
		out[key{p, 0}] = a.e
	}
	return out
}

// Leaderboard kind：
//
//	fixed     默认，固定种子题：self、hosted、上限
//	template  题模板，每题固定 32 个保密种子：同题同种子配对，和 fixed 一样；平均分是先按题平均再对题平均
//	legacy    2026-11-09 以前的题模板评测（每次临时抽种子）：各算法种子不同，只能按题平均后比较
func (s *Store) Leaderboard(set, base, group, kind string) ([]Row, error) {
	type run = lbRun
	legacy := kind == "legacy"
	tmpl := kind == "template" || kind == "random" || legacy
	var runs []run
	for _, info := range s.Runs(set) {
		if (info["kind"] == "template") != tmpl {
			continue
		}
		if tmpl && (info["template_seeds"] == TemplateSeedsVersion) == legacy {
			continue
		}
		name, _ := info["run"].(string)
		idx, err := s.Index(name)
		if err != nil || len(idx) == 0 {
			continue
		}
		var m map[key]EpisodeSummary
		if legacy {
			m = perProblem(idx)
		} else {
			m = map[key]EpisodeSummary{}
			for _, e := range idx {
				m[key{e.ID, e.SeedIndex}] = e
			}
		}
		runs = append(runs, run{info: info, eps: m, count: len(idx), names: []string{name}})
	}
	runs = mergeRuns(runs, legacy)
	oracle := map[key]float64{}
	for _, r := range runs {
		if privileged(r.info) {
			for k, e := range r.eps {
				if e.Score > oracle[k] {
					oracle[k] = e.Score
				}
			}
		}
	}
	var baseEps map[key]EpisodeSummary
	if base != "" {
		for _, r := range runs {
			if r.info["label"] == base || r.info["run"] == base || contains(r.names, base) {
				baseEps = r.eps
			}
		}
	}
	rows := []Row{}
	for _, r := range runs {
		row := Row{Privileged: privileged(r.info), BudgetS: r.info["step_seconds"], N: r.count, Problems: len(r.eps),
			Engine: r.info["engine"], Algo: r.info["algo"], SeedsPerProblem: r.info["seeds_per_problem"]}
		row.Run, _ = r.info["run"].(string)
		if len(r.names) > 1 {
			for i := len(r.names) - 1; i >= 0; i-- {
				row.Runs = append(row.Runs, r.names[i])
			}
		}
		row.Label, _ = r.info["label"].(string)
		row.Mode, _ = r.info["mode"].(string)
		row.Uploader, _ = r.info["by"].(string)
		row.Kind, _ = r.info["kind"].(string)
		row.Params = r.info["params"]
		row.SeesSeed, _ = r.info["sees_seed"].(bool)
		row.About = algoDoc(r.info)
		var think []float64
		var vsO, vsB [][2]float64
		sum, epThink := 0.0, 0.0
		for k, e := range r.eps {
			sum += e.Score
			epThink += e.Secs
			think = append(think, e.StepMs...)
			row.Over += e.Over
			if e.Err != "" {
				row.Errors++
			}
			if !e.Finished {
				row.Unfinished++
			}
			if o, ok := oracle[k]; ok {
				vsO = append(vsO, [2]float64{e.Score, o})
			}
			if b, ok := baseEps[k]; ok {
				vsB = append(vsB, [2]float64{e.Score, b.Score})
			}
		}
		if len(r.eps) > 0 { // 旧版题模板的 eps 是每题一条（已按题平均），所以除以条数而不是局数
			row.Mean = sum / float64(len(r.eps))
			row.EpThinkS = epThink / float64(len(r.eps))
		}
		if tmpl && !legacy { // 先按题平均，再对题平均：没跑完的题不会因为局数少而权重变小
			byProb := map[string][2]float64{}
			for k, e := range r.eps {
				v := byProb[k.p]
				byProb[k.p] = [2]float64{v[0] + e.Score, v[1] + 1}
			}
			row.Mean = 0
			for _, v := range byProb {
				row.Mean += v[0] / v[1]
			}
			row.Mean /= float64(len(byProb))
			row.Problems = len(byProb)
		}
		row.P50, row.P95 = pct(think, 0.5), pct(think, 0.95)
		for _, t := range think {
			row.Max = math.Max(row.Max, t)
		}
		row.VsOracle = ratioStats(vsO)
		if baseEps != nil {
			row.VsBase = ratioStats(vsB)
		}
		if group != "" {
			type acc struct {
				sum    float64
				n      int
				vo, vb [][2]float64
			}
			accs := map[string]*acc{}
			for k, e := range r.eps {
				g := tagOf(e, group)
				a := accs[g]
				if a == nil {
					a = &acc{}
					accs[g] = a
				}
				a.n++
				a.sum += e.Score
				if o, ok := oracle[k]; ok {
					a.vo = append(a.vo, [2]float64{e.Score, o})
				}
				if b, ok := baseEps[k]; ok {
					a.vb = append(a.vb, [2]float64{e.Score, b.Score})
				}
			}
			row.Groups = map[string]*Group{}
			for g, a := range accs {
				gr := &Group{N: a.n, Mean: a.sum / float64(a.n), VsOracle: ratioStats(a.vo)}
				if baseEps != nil {
					gr.VsBase = ratioStats(a.vb)
				}
				row.Groups[g] = gr
			}
		}
		rows = append(rows, row)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].Privileged != rows[j].Privileged {
			return !rows[i].Privileged
		}
		gi, gj := -1.0, -1.0
		if rows[i].VsOracle != nil {
			gi = rows[i].VsOracle.Geo
		}
		if rows[j].VsOracle != nil {
			gj = rows[j].VsOracle.Geo
		}
		if gi != gj {
			return gi > gj
		}
		return rows[i].Mean > rows[j].Mean
	})
	return rows, nil
}

// lbRun：排行里的一行在合并前后的样子。names 是合进来的运行，旧的在前。
type lbRun struct {
	info  map[string]any
	eps   map[key]EpisodeSummary
	count int
	names []string
}

// runTime：运行的完成时间（没有就用开始 / 上传时间），用来决定合并时谁新。时间是 ISO 字符串，按字典序比就是按时间比。
func runTime(info map[string]any) string {
	for _, k := range []string{"finished", "uploaded", "started"} {
		if v, ok := info[k].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

// mergeKey：同一个算法 = 评测种类、算法、参数、每步预算、提交人、来源、理论上限与否、规则版本都相同。
// 规则版本不同的成绩不能直接比，不合并。
func mergeKey(info map[string]any) string {
	rules := any(nil)
	if e, ok := info["engine"].(map[string]any); ok {
		rules = e["rules_version"]
	}
	b, _ := json.Marshal([]any{info["kind"], info["algo"], info["label"], info["params"], info["step_seconds"],
		info["by"], info["mode"], privileged(info), rules})
	return string(b)
}

// mergeRuns：同一个算法的多次运行合成一行。按时间从旧到新叠：同一题同一种子以最新那次为准，
// 表头信息（引擎、说明……）也取最新那次。局数：新版按合并后的局算；旧版评测每题只有一条平均，局数把各次加起来。
func mergeRuns(runs []lbRun, legacy bool) []lbRun {
	sort.SliceStable(runs, func(i, j int) bool {
		ti, tj := runTime(runs[i].info), runTime(runs[j].info)
		if ti != tj {
			return ti < tj
		}
		return runs[i].names[0] < runs[j].names[0]
	})
	var out []lbRun
	at := map[string]int{}
	for _, r := range runs {
		k := mergeKey(r.info)
		i, ok := at[k]
		if !ok {
			at[k] = len(out)
			out = append(out, lbRun{info: r.info, eps: map[key]EpisodeSummary{}, names: nil})
			i = len(out) - 1
		}
		g := &out[i]
		for kk, e := range r.eps {
			g.eps[kk] = e
		}
		g.info = r.info
		g.names = append(g.names, r.names...)
		if legacy {
			g.count += r.count
		} else {
			g.count = len(g.eps)
		}
	}
	return out
}

func contains(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}
