package main

// 托管对局：种子和完整局面留在服务器的引擎子进程里，算法每一步交动作，服务器计时。

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const (
	hostedTTL  = time.Hour
	maxHosted  = 64
	maxDecides = 300
)

type Hosted struct {
	ID      string
	User    string
	Label   string
	Set     string
	Problem map[string]any
	Row     SeedRow
	Worker  *Worker
	Epoch   int64
	Budget  float64
	Params  any
	Steps   []map[string]any
	Obs     map[string]any
	Meta    any
	Sent    time.Time
	Touched time.Time
	Started time.Time
}

func (a *App) gcHosted() {
	for id, h := range a.hosted {
		if time.Since(h.Touched) > hostedTTL {
			_, _, _ = h.Worker.Call(map[string]any{"op": "close", "sid": id})
			delete(a.hosted, id)
		}
	}
}

func (a *App) handleHostedStart(w http.ResponseWriter, r *http.Request, u string) {
	var body struct {
		Set       string  `json:"set"`
		Problem   string  `json:"problem"`
		SeedIndex int     `json:"seed_index"`
		Label     string  `json:"label"`
		Budget    float64 `json:"budget"`
		Params    any     `json:"params"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil {
		fail(w, 400, "请求体不是 JSON")
		return
	}
	var row *SeedRow
	for _, s := range a.store.Seeds(body.Set)[body.Problem] {
		if s.Index == body.SeedIndex {
			s := s
			row = &s
		}
	}
	if row == nil {
		fail(w, 404, "没有这个种子")
		return
	}
	prob, err := a.store.Problem(body.Set, body.Problem)
	if err != nil {
		fail(w, 404, "没有这道题")
		return
	}
	a.hostedMu.Lock()
	a.gcHosted()
	if len(a.hosted) >= maxHosted {
		a.hostedMu.Unlock()
		fail(w, 429, "托管对局太多，稍后再试")
		return
	}
	a.hostedMu.Unlock()
	id := newID(16)
	wk := a.pool.Pick()
	rep, epoch, err := wk.Call(map[string]any{"op": "open", "sid": id, "loadout": prob["loadout"], "seed": row.Seed})
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	label := slug(body.Label)
	if label == "" {
		label = "anon"
	}
	budget := body.Budget
	if budget <= 0 {
		budget = 5
	}
	obs, _ := rep["obs"].(map[string]any)
	h := &Hosted{ID: id, User: u, Label: label, Set: body.Set, Problem: prob, Row: *row, Worker: wk, Epoch: epoch,
		Budget: budget, Params: body.Params, Obs: obs, Meta: rep["meta"], Sent: time.Now(), Touched: time.Now(), Started: time.Now()}
	a.hostedMu.Lock()
	a.hosted[id] = h
	a.hostedMu.Unlock()
	writeJSONResp(w, 200, map[string]any{"episode": id, "obs": obs, "meta": rep["meta"], "loadout": rep["loadout"]})
}

func (a *App) handleHostedStep(w http.ResponseWriter, r *http.Request, u string) {
	id := r.PathValue("id")
	a.hostedMu.Lock()
	h := a.hosted[id]
	a.hostedMu.Unlock()
	if h == nil || h.User != u {
		fail(w, 404, "没有这局托管对局（可能已超时）")
		return
	}
	serverMs := float64(time.Since(h.Sent).Microseconds()) / 1000
	var body struct {
		Action  []any   `json:"action"`
		ThinkMs float64 `json:"think_ms"`
		Meta    any     `json:"meta"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil || len(body.Action) == 0 {
		fail(w, 400, "要 action")
		return
	}
	rep, epoch, err := h.Worker.Call(map[string]any{"op": "step", "sid": id, "action": body.Action})
	if epoch != h.Epoch {
		a.dropHosted(id)
		fail(w, 410, "引擎子进程重启过，这局作废，请重开")
		return
	}
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	turn := 0.0
	if ex, ok := h.Obs["exam"].(map[string]any); ok {
		turn = num(ex["turn"])
	}
	h.Steps = append(h.Steps, map[string]any{"i": h.Obs["i"], "turn": turn, "obs": h.Obs, "action": body.Action,
		"algo_meta": body.Meta, "think_ms": round2(serverMs), "client_ms": body.ThinkMs, "cpu_ms": nil, "worlds": 0,
		"over_budget": serverMs/1000 > h.Budget*1.2+0.05, "result": rep["result"], "private": rep["private"]})
	done, _ := rep["done"].(bool)
	if len(h.Steps) >= maxDecides {
		done = true
	}
	res, _ := rep["result"].(map[string]any)
	out := map[string]any{"result": map[string]any{"after": res["after"], "delta": res["delta"]}, "done": done, "obs": rep["obs"]}
	if !done {
		h.Obs, _ = rep["obs"].(map[string]any)
		h.Sent, h.Touched = time.Now(), time.Now()
		writeJSONResp(w, 200, out)
		return
	}
	a.dropHosted(id)
	final := a.finishHosted(h, rep)
	out["final"] = final
	writeJSONResp(w, 200, out)
}

func (a *App) dropHosted(id string) {
	a.hostedMu.Lock()
	h := a.hosted[id]
	delete(a.hosted, id)
	a.hostedMu.Unlock()
	if h != nil {
		_, _, _ = h.Worker.Call(map[string]any{"op": "close", "sid": id})
	}
}

func round2(x float64) float64 { return float64(int64(x*100+0.5)) / 100 }

func (a *App) finishHosted(h *Hosted, rep map[string]any) map[string]any {
	fin, _ := rep["final"].(map[string]any)
	think, over := 0.0, 0
	for _, s := range h.Steps {
		think += num(s["think_ms"])
		if b, _ := s["over_budget"].(bool); b {
			over++
		}
	}
	final := map[string]any{"score": fin["score"], "finished": fin["finished"], "decisions": len(h.Steps),
		"turns": fin["turns"], "begin_s": 0.0, "think_s": round2(think / 1000),
		"wall_s": round2(time.Since(h.Started).Seconds()), "over_budget_steps": over}
	runName := slug(fmt.Sprintf("hosted-%s-%s-%s", h.Set, h.Label, h.User))
	ep := map[string]any{"schema": "gkbench.episode.v1", "problem": h.Problem["id"], "set": h.Set, "tags": h.Problem["tags"],
		"seed_index": h.Row.Index, "seed_label": h.Row.Label, "seed_split": h.Row.Split, "seed_sha": seedSha(h.Row.Seed),
		"meta": h.Meta, "steps": h.Steps, "final": final, "error": nil, "run": runName}
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	dir := a.store.RunDir(runName)
	info, err := a.store.RunInfo(runName)
	if err != nil {
		info = map[string]any{"schema": "gkbench.run.v1", "run": runName, "label": h.Label, "set": h.Set, "mode": "hosted",
			"uploader": h.User, "algo": map[string]any{"name": h.Label, "params": h.Params, "privileged": false},
			"budget_s": h.Budget, "engine": a.engineInfo, "started": now()}
	}
	var eps []map[string]any
	if _, err := os.Stat(filepath.Join(dir, "episodes.jsonl.zst")); err == nil {
		_ = ReadEpisodes(filepath.Join(dir, "episodes.jsonl.zst"), func(e map[string]any) bool {
			if !(e["problem"] == ep["problem"] && int(num(e["seed_index"])) == h.Row.Index) {
				eps = append(eps, e)
			}
			return true
		})
	}
	eps = append(eps, ep)
	total := 0.0
	for _, e := range eps {
		f, _ := e["final"].(map[string]any)
		total += num(f["score"])
	}
	info["episodes"], info["mean_score"], info["finished"] = len(eps), int(total/float64(len(eps))+0.5), now()
	_ = a.store.WriteRun(runName, info, eps)
	return final
}
