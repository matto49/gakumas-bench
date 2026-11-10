package main

// 托管对局：种子和完整局面留在服务器的引擎子进程里，算法每一步交动作，服务器计时。
// 两种来源：固定种子（题集里的某个种子，/api/episodes）和保密种子评测（/api/evals，见 eval.go）。

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"
)

const (
	hostedTTL  = 15 * time.Minute // 闲置这么久没交动作就回收
	maxHosted  = 96
	maxDecides = 300
	maxWorlds  = 64
)

type Hosted struct {
	ID       string
	User     string
	Label    string
	Set      string
	Run      string         // 这局写进哪次运行
	RunInfo  map[string]any // 运行第一次创建时的 run.json
	Problem  map[string]any
	Row      SeedRow
	Worker   *Worker
	Epoch    int64
	Budget   float64 // 每步预算（秒），表头 step_seconds
	Steps    []map[string]any
	Obs      map[string]any
	Meta     any
	Worlds   int     // 这一步要了几个世界
	WorldsMs float64 // 这一步里服务器生成世界花的毫秒数：是裁判的开销，不算算法的思考时间
	Sent     time.Time
	Touched  time.Time
	Started  time.Time
}

func (a *App) gcHosted() {
	for id, h := range a.hosted {
		if time.Since(h.Touched) > hostedTTL {
			go h.Worker.Call(map[string]any{"op": "close", "sid": id})
			delete(a.hosted, id)
		}
	}
}

// openHosted 在一个引擎子进程里开局，登记成托管对局，返回给客户端的开局信息
func (a *App) openHosted(h *Hosted) (map[string]any, error) {
	a.hostedMu.Lock()
	a.gcHosted()
	full := len(a.hosted) >= maxHosted
	a.hostedMu.Unlock()
	if full {
		return nil, fmt.Errorf("托管对局太多，稍后再试")
	}
	h.ID = newID(16)
	h.Worker = a.pool.Pick()
	rep, epoch, err := h.Worker.Call(map[string]any{"op": "open", "sid": h.ID, "loadout": h.Problem["loadout"], "seed": h.Row.Seed})
	if err != nil {
		return nil, err
	}
	h.Epoch = epoch
	h.Obs, _ = rep["obs"].(map[string]any)
	h.Meta = rep["meta"]
	h.Sent, h.Touched, h.Started = time.Now(), time.Now(), time.Now()
	a.hostedMu.Lock()
	a.hosted[h.ID] = h
	a.hostedMu.Unlock()
	return map[string]any{"episode": h.ID, "obs": h.Obs, "meta": h.Meta, "loadout": rep["loadout"]}, nil
}

func (a *App) handleHostedStart(w http.ResponseWriter, r *http.Request, u string) {
	var body struct {
		Set         string  `json:"set"`
		ID          string  `json:"id"`
		SeedIndex   int     `json:"seed_index"`
		Label       string  `json:"label"`
		Algo        string  `json:"algo"`
		StepSeconds float64 `json:"step_seconds"`
		Params      any     `json:"params"`
		About       any     `json:"about"` // 可选：算法说明 {summary, detail, sees, links}
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil {
		fail(w, 400, "请求体不是 JSON")
		return
	}
	var row *SeedRow
	for _, s := range a.store.Seeds(body.Set)[body.ID] {
		if s.Index == body.SeedIndex {
			s := s
			row = &s
		}
	}
	if row == nil {
		fail(w, 404, "没有这个种子")
		return
	}
	prob, err := a.store.Problem(body.Set, body.ID)
	if err != nil {
		fail(w, 404, "没有这道题")
		return
	}
	label := slug(body.Label)
	if label == "" {
		label = "anon"
	}
	budget := body.StepSeconds
	if budget <= 0 {
		budget = 5
	}
	run := slug(fmt.Sprintf("hosted-%s-%s-%s", body.Set, label, u))
	h := &Hosted{User: u, Label: label, Set: body.Set, Run: run, Problem: prob, Row: *row, Budget: budget,
		RunInfo: a.runHeader(run, label, body.Set, "fixed", body.Algo, body.Params, budget, u)}
	withAbout(h.RunInfo, body.About)
	out, err := a.openHosted(h)
	if err != nil {
		fail(w, 503, err.Error())
		return
	}
	writeJSONResp(w, 200, out)
}

func (a *App) hostedOf(w http.ResponseWriter, r *http.Request, u string) *Hosted {
	a.hostedMu.Lock()
	h := a.hosted[r.PathValue("id")]
	a.hostedMu.Unlock()
	if h == nil || h.User != u {
		fail(w, 404, "没有这局托管对局（可能已超时）")
		return nil
	}
	return h
}

// 给多世界类算法（PIMC 等）发 k 个世界：隐藏信息（山札顺序、随机数、种子）已重抽，公开部分和真局面一致
func (a *App) handleHostedWorlds(w http.ResponseWriter, r *http.Request, u string) {
	h := a.hostedOf(w, r, u)
	if h == nil {
		return
	}
	var body struct {
		K int `json:"k"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.K <= 0 {
		body.K = 16
	}
	if body.K > maxWorlds {
		body.K = maxWorlds
	}
	t0 := time.Now()
	rep, epoch, err := h.Worker.Call(map[string]any{"op": "worlds", "sid": h.ID, "k": body.K})
	h.WorldsMs += float64(time.Since(t0).Microseconds()) / 1000
	if epoch != h.Epoch {
		a.dropHosted(h.ID)
		fail(w, 410, "引擎子进程重启过，这局作废，请重开")
		return
	}
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	h.Worlds += body.K
	h.Touched = time.Now()
	writeJSONResp(w, 200, map[string]any{"worlds": rep["worlds"]})
}

func (a *App) handleHostedStep(w http.ResponseWriter, r *http.Request, u string) {
	h := a.hostedOf(w, r, u)
	if h == nil {
		return
	}
	serverMs := math.Max(0, float64(time.Since(h.Sent).Microseconds())/1000-h.WorldsMs)
	var body struct {
		Action   []any   `json:"action"`
		ClientMs float64 `json:"client_ms"`
		Meta     any     `json:"meta"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil || len(body.Action) == 0 {
		fail(w, 400, "要 action")
		return
	}
	rep, epoch, err := h.Worker.Call(map[string]any{"op": "step", "sid": h.ID, "action": body.Action})
	if epoch != h.Epoch {
		a.dropHosted(h.ID)
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
	h.Steps = append(h.Steps, map[string]any{"i": h.Obs["i"], "turn": turn, "token": tokenOf(body.Action), "action": body.Action,
		"obs": h.Obs, "algo_meta": body.Meta, "step_ms": round2(serverMs), "client_ms": body.ClientMs, "cpu_ms": nil,
		"worlds": h.Worlds, "worlds_ms": round2(h.WorldsMs), "over": overBudget(serverMs, h.Budget), "result": rep["result"], "private": rep["private"]})
	h.Worlds, h.WorldsMs = 0, 0
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
	a.dropHosted(h.ID)
	final, err := a.finishHosted(h, rep)
	if err != nil {
		fail(w, 500, "这局打完了但没存下来："+err.Error())
		return
	}
	out["final"] = final
	writeJSONResp(w, 200, out)
}

func (a *App) dropHosted(id string) {
	a.hostedMu.Lock()
	h := a.hosted[id]
	delete(a.hosted, id)
	a.hostedMu.Unlock()
	if h != nil {
		go h.Worker.Call(map[string]any{"op": "close", "sid": id})
	}
}

func round2(x float64) float64 { return float64(int64(x*100+0.5)) / 100 }

// 审查存档 1.7 f)：大于 step_seconds × 1200 + 50 毫秒算超时
func overBudget(ms, stepSeconds float64) bool { return stepSeconds > 0 && ms > stepSeconds*1200+50 }

// tokenOf 审查存档第 3 章的动作记号
func tokenOf(action []any) string {
	if len(action) == 0 {
		return "?"
	}
	switch action[0] {
	case "play":
		return fmt.Sprintf("p%d", int(num(action[1])))
	case "drink":
		return fmt.Sprintf("d%d", int(num(action[1])))
	case "end":
		return "e"
	case "select":
		var idx []string
		if xs, ok := action[1].([]any); ok {
			for _, x := range xs {
				idx = append(idx, fmt.Sprint(int(num(x))))
			}
		}
		return "s" + strings.Join(idx, ",")
	}
	return "?"
}

func tsNow() string { return time.Now().UTC().Format("20060102T150405Z") }

// runHeader 托管运行的 run.json：算法表表头（algo、params、step_seconds、rules、mode、by）+ 题集等
func (a *App) runHeader(run, label, set, kind, algo string, params any, stepSeconds float64, u string) map[string]any {
	if algo == "" {
		algo = "external:" + label
	}
	eng, _ := a.engineInfo.(map[string]any)
	h := map[string]any{"schema": "gkbench.run.v2", "run": run, "label": label, "set": set, "kind": kind, "algo": algo,
		"step_seconds": stepSeconds, "rules": eng["rules_version"], "mode": "hosted", "by": u, "privileged": false,
		"engine": a.engineInfo, "started": now()}
	if params != nil {
		h["params"] = params
	}
	return h
}

func (a *App) finishHosted(h *Hosted, rep map[string]any) (map[string]any, error) {
	fin, _ := rep["final"].(map[string]any)
	ms, over := 0.0, 0
	var tokens []string
	for _, s := range h.Steps {
		ms += num(s["step_ms"])
		if b, _ := s["over"].(bool); b {
			over++
		}
		tokens = append(tokens, str(s["token"]))
	}
	final := map[string]any{"score": fin["score"], "finished": fin["finished"], "decisions": len(h.Steps),
		"turns": fin["turns"], "begin_s": 0.0, "secs": round2(ms / 1000),
		"wall_s": round2(time.Since(h.Started).Seconds()), "over_steps": over}
	ep := map[string]any{"schema": "gkbench.episode.v2", "id": h.Problem["id"], "family": metaOf(h.Problem)["family"],
		"set": h.Set, "name": nameOf(h.Problem), "tags": tagsOf(h.Problem), "seed_index": h.Row.Index,
		"seed_label": h.Row.Label, "seed_split": h.Row.Split, "exam_sha": seedSha(h.Row.Seed), "meta": h.Meta,
		"route": strings.Join(tokens, " "), "steps": h.Steps, "final": final, "err": nil, "at": tsNow(), "run": h.Run}
	if h.Row.FixedID != "" {
		ep["fixed_id"] = h.Row.FixedID
	}
	return final, a.store.AppendEpisode(h.Run, h.RunInfo, ep)
}

// 客户端出错或放弃时主动结束一局，释放名额
func (a *App) handleHostedAbort(w http.ResponseWriter, r *http.Request, u string) {
	h := a.hostedOf(w, r, u)
	if h == nil {
		return
	}
	a.dropHosted(h.ID)
	writeJSONResp(w, 200, map[string]any{"ok": true})
}
