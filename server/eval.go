package main

// 题模板评测：每道题模板有一组固定的 32 个种子（tseeds.go），只存在服务器的私有目录，所有算法、每次评测都打这一组。
// 算法托管跑，每一局领一个「格子」（题 + 第几个种子），看不到种子本身。
// 种子相同，所以排行和固定种子题一样按同题同种子配对比较（leaderboard.go 的 template 模式）。
// 2026-11-09 以前的评测每次临时抽种子，运行里没有 template_seeds 字段，排行里标成旧版。
//
//	POST /api/evals                      {set, label, algo, params, step_seconds, seeds?, only?} -> {eval, run, slots: [{id, slot}]}
//	GET  /api/evals/{id}                 进度：total、done、已完成的格子
//	POST /api/evals/{id}/episodes        {id, slot} -> 开局（之后用 /api/episodes/{episode}/step、/worlds）

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type Eval struct {
	ID      string             `json:"id"`
	User    string             `json:"user"`
	Set     string             `json:"set"`
	Label   string             `json:"label"`
	Algo    string             `json:"algo"`
	Run     string             `json:"run"`
	Budget  float64            `json:"step_seconds"`
	Params  any                `json:"params"`
	N       int                `json:"seeds_per_problem"`
	Seeds   map[string][]int64 `json:"seeds"` // 私有
	Created string             `json:"created"`
	About   any                `json:"about,omitempty"` // 提交人填的算法说明
}

var evalMu sync.Mutex

func (s *Store) evalPath(id string) string {
	return filepath.Join(s.Data, "private", "evals", id+".json")
}

func (s *Store) LoadEval(id string) (*Eval, error) {
	if !s.validName(id) {
		return nil, fmt.Errorf("评测编号不合法")
	}
	var e Eval
	if err := readJSON(s.evalPath(id), &e); err != nil {
		return nil, err
	}
	return &e, nil
}

func (a *App) handleEvalStart(w http.ResponseWriter, r *http.Request, u string) {
	var body struct {
		Set    string   `json:"set"`
		Label  string   `json:"label"`
		Algo   string   `json:"algo"`
		Budget float64  `json:"step_seconds"`
		Params any      `json:"params"`
		Seeds  int      `json:"seeds"`
		Only   []string `json:"only"`
		About  any      `json:"about"` // 可选：算法说明 {summary, detail, sees, links}
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil {
		fail(w, 400, "请求体不是 JSON")
		return
	}
	probs := a.store.Problems(body.Set)
	if len(probs) == 0 {
		fail(w, 404, "没有这套题")
		return
	}
	fixed, err := a.store.TemplateSeeds(body.Set)
	if err != nil {
		fail(w, 500, "读固定种子失败："+err.Error())
		return
	}
	n := body.Seeds // 只跑前 n 个（调试用）；成绩照样能和别的运行在这些格子上配对
	if n <= 0 || n > TemplateSeeds {
		n = TemplateSeeds
	}
	label := slug(body.Label)
	if label == "" {
		label = "anon"
	}
	if body.Budget <= 0 {
		body.Budget = 5
	}
	id := newID(6)
	ev := &Eval{ID: id, User: u, Set: body.Set, Label: label, Algo: body.Algo, Budget: body.Budget, Params: body.Params, N: n,
		Seeds: map[string][]int64{}, Created: now(), About: body.About,
		Run: slug(fmt.Sprintf("template-%s-%s-%s-%s", body.Set, label, u, id))}
	type slot struct {
		ID   string `json:"id"`
		Slot int    `json:"slot"`
	}
	var slots []slot
	for _, p := range probs {
		pid, _ := p["id"].(string)
		if len(body.Only) > 0 {
			hit := false
			for _, o := range body.Only {
				hit = hit || strings.Contains(pid, o) || strings.Contains(nameOf(p), o)
			}
			if !hit {
				continue
			}
		}
		seeds := fixed[pid].Seeds
		if len(seeds) < n {
			fail(w, 500, "题 "+pid+" 的固定种子不够")
			return
		}
		ev.Seeds[pid] = append([]int64(nil), seeds[:n]...)
		for i := 0; i < n; i++ {
			slots = append(slots, slot{pid, i})
		}
	}
	if len(slots) == 0 {
		fail(w, 400, "筛选后没有题")
		return
	}
	if err := os.MkdirAll(filepath.Dir(a.store.evalPath(id)), 0o700); err != nil {
		fail(w, 500, err.Error())
		return
	}
	if err := writeJSON(a.store.evalPath(id), ev, 0o600); err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSONResp(w, 200, map[string]any{"eval": id, "run": ev.Run, "seeds_per_problem": n, "slots": slots})
}

func (a *App) handleEvalStatus(w http.ResponseWriter, r *http.Request, u string) {
	ev, err := a.store.LoadEval(r.PathValue("id"))
	if err != nil || ev.User != u {
		fail(w, 404, "没有这次评测")
		return
	}
	total := 0
	for _, s := range ev.Seeds {
		total += len(s)
	}
	done := []map[string]any{}
	if idx, err := a.store.Index(ev.Run); err == nil {
		for _, e := range idx {
			done = append(done, map[string]any{"id": e.ID, "slot": e.SeedIndex, "score": e.Score})
		}
	}
	writeJSONResp(w, 200, map[string]any{"eval": ev.ID, "run": ev.Run, "set": ev.Set, "label": ev.Label,
		"seeds_per_problem": ev.N, "total": total, "done": done, "created": ev.Created})
}

func (a *App) handleEvalEpisode(w http.ResponseWriter, r *http.Request, u string) {
	evalMu.Lock()
	ev, err := a.store.LoadEval(r.PathValue("id"))
	evalMu.Unlock()
	if err != nil || ev.User != u {
		fail(w, 404, "没有这次评测")
		return
	}
	var body struct {
		ID   string `json:"id"`
		Slot int    `json:"slot"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil {
		fail(w, 400, "请求体不是 JSON")
		return
	}
	seeds := ev.Seeds[body.ID]
	if body.Slot < 0 || body.Slot >= len(seeds) {
		fail(w, 404, "没有这个格子")
		return
	}
	prob, err := a.store.Problem(ev.Set, body.ID)
	if err != nil {
		fail(w, 404, "没有这道题")
		return
	}
	h := &Hosted{User: u, Label: ev.Label, Set: ev.Set, Run: ev.Run, Problem: prob, Budget: ev.Budget,
		Row:     SeedRow{Index: body.Slot, Seed: seeds[body.Slot], Split: "template", Label: "保密"},
		RunInfo: a.runHeader(ev.Run, ev.Label, ev.Set, "template", ev.Algo, ev.Params, ev.Budget, u)}
	withAbout(h.RunInfo, ev.About)
	h.RunInfo["eval"], h.RunInfo["seeds_per_problem"], h.RunInfo["started"] = ev.ID, ev.N, ev.Created
	h.RunInfo["template_seeds"] = TemplateSeedsVersion
	out, err := a.openHosted(h)
	if err != nil {
		fail(w, 503, err.Error())
		return
	}
	writeJSONResp(w, 200, out)
}
