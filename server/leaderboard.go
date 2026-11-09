package main

// 排行榜：一套题上的所有运行放在一起比。口径和本地 `gkbench report` 一致：
//   相对上限  同题同种子对理论上限（特权算法）局的分数比，几何平均 ± 标准误
//   相对基准  同题同种子对基准运行的分数比，几何平均 ± 标准误，胜率（平局算半场）
//   耗时      每步思考的中位、95 分位、最长；每局思考总时长；超时步数

import (
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
	Run        string            `json:"run"`
	Label      string            `json:"label"`
	Mode       string            `json:"mode"`
	Uploader   string            `json:"uploader"`
	Privileged bool              `json:"privileged"`
	BudgetS    any               `json:"budget_s"`
	N          int               `json:"n"`
	Mean       float64           `json:"mean"`
	Errors     int               `json:"errors"`
	Unfinished int               `json:"unfinished"`
	Over       int               `json:"over"`
	P50        float64           `json:"p50_ms"`
	P95        float64           `json:"p95_ms"`
	Max        float64           `json:"max_ms"`
	EpThinkS   float64           `json:"ep_think_s"`
	VsOracle   *Ratio            `json:"vs_oracle"`
	VsBase     *Ratio            `json:"vs_base,omitempty"`
	Groups     map[string]*Group `json:"groups,omitempty"`
	Engine     any               `json:"engine"`
	Algo       any               `json:"algo"`
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
	algo, _ := info["algo"].(map[string]any)
	p, _ := algo["privileged"].(bool)
	return p
}

func tagOf(e EpisodeSummary, group string) string {
	if v, ok := e.Tags[group]; ok && v != nil {
		return fmt.Sprint(v)
	}
	return "（无）"
}

func (s *Store) Leaderboard(set, base, group string) ([]Row, error) {
	type run struct {
		info map[string]any
		eps  map[key]EpisodeSummary
	}
	var runs []run
	for _, info := range s.Runs(set) {
		name, _ := info["run"].(string)
		idx, err := s.Index(name)
		if err != nil {
			continue
		}
		m := map[key]EpisodeSummary{}
		for _, e := range idx {
			m[key{e.Problem, e.SeedIndex}] = e
		}
		runs = append(runs, run{info, m})
	}
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
			if r.info["label"] == base || r.info["run"] == base {
				baseEps = r.eps
			}
		}
	}
	rows := []Row{}
	for _, r := range runs {
		row := Row{Privileged: privileged(r.info), BudgetS: r.info["budget_s"], N: len(r.eps),
			Engine: r.info["engine"], Algo: r.info["algo"]}
		row.Run, _ = r.info["run"].(string)
		row.Label, _ = r.info["label"].(string)
		row.Mode, _ = r.info["mode"].(string)
		row.Uploader, _ = r.info["uploader"].(string)
		var think []float64
		var vsO, vsB [][2]float64
		sum, epThink := 0.0, 0.0
		for k, e := range r.eps {
			sum += e.Score
			epThink += e.ThinkS
			think = append(think, e.ThinkMs...)
			row.Over += e.Over
			if e.Error != "" {
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
		if row.N > 0 {
			row.Mean = sum / float64(row.N)
			row.EpThinkS = epThink / float64(row.N)
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
