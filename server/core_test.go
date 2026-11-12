package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 写一次题模板运行：eps 是 题→各牌序的分
func writeTemplateRun(t *testing.T, s *Store, run, label string, eps map[string][]float64) {
	t.Helper()
	dir := s.RunDir(run)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	info := map[string]any{"schema": "gkbench.run.v2", "run": run, "set": "hif", "kind": "template", "label": label,
		"algo": "external:" + label, "by": "matto", "mode": "internal", "template_seeds": TemplateSeedsVersion,
		"step_seconds": 5, "finished": "2026-11-12T00:00:00Z", "engine": map[string]any{"rules_version": 59}}
	var list []EpisodeSummary
	for pid, scores := range eps {
		for i, sc := range scores {
			list = append(list, EpisodeSummary{ID: pid, SeedIndex: i, Score: sc, Finished: true})
		}
	}
	if err := writeJSON(filepath.Join(dir, "run.json"), info, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeJSON(filepath.Join(dir, "index.json"), map[string]any{"episodes": list}, 0o644); err != nil {
		t.Fatal(err)
	}
}

func rowOf(rows []Row, label string) *Row {
	for i := range rows {
		if rows[i].Label == label {
			return &rows[i]
		}
	}
	return nil
}

func TestLeaderboardCoreScope(t *testing.T) {
	s := &Store{Data: t.TempDir()}
	if err := s.updateSetConfig("hif", func(c *SetConfig) { c.Core, c.CoreSeeds = []string{"A", "B"}, 2 }); err != nil {
		t.Fatal(err)
	}
	// full：核心两题都跑了 3 个牌序，另有非核心题 C；part：只跑了核心里的 A
	writeTemplateRun(t, s, "r-full", "full", map[string][]float64{"A": {10, 20, 999}, "B": {30, 40, 999}, "C": {999}})
	writeTemplateRun(t, s, "r-part", "part", map[string][]float64{"A": {50, 60}})

	rows, err := s.Leaderboard("hif", "", "", "template", "")
	if err != nil {
		t.Fatal(err)
	}
	full, part := rowOf(rows, "full"), rowOf(rows, "part")
	if full == nil || part == nil {
		t.Fatalf("两次运行都应在排行里：%+v", rows)
	}
	if full.Problems != 2 || full.N != 4 || full.Mean != 25 {
		t.Fatalf("核心题单下只算核心题的前 2 个牌序：problems=%d n=%d mean=%v", full.Problems, full.N, full.Mean)
	}
	if full.CoreProblems != 2 || part.Problems != 1 {
		t.Fatalf("要报核心题数和各行覆盖了几题：core=%d part=%d", full.CoreProblems, part.Problems)
	}
	if rows[0].Label != "full" {
		t.Fatalf("没跑全核心题的行排在跑全的后面（哪怕平均分更高）：第一行是 %s", rows[0].Label)
	}

	all, _ := s.Leaderboard("hif", "", "", "template", "all")
	if f := rowOf(all, "full"); f == nil || f.Problems != 3 || f.N != 7 || f.CoreProblems != 0 {
		t.Fatalf("scope=all 看全部题和牌序：%+v", f)
	}
}

func TestLeaderboardWithoutCoreUnchanged(t *testing.T) {
	s := &Store{Data: t.TempDir()}
	writeTemplateRun(t, s, "r1", "x", map[string][]float64{"A": {10, 20, 30}})
	rows, _ := s.Leaderboard("hif", "", "", "template", "")
	if len(rows) != 1 || rows[0].N != 3 || rows[0].CoreProblems != 0 {
		t.Fatalf("没设核心题单的集合照旧：%+v", rows)
	}
}

func TestPatchSetCore(t *testing.T) {
	app, do := collApp(t)
	dir := filepath.Join(app.store.Data, "problems", "official-set")
	for _, id := range []string{"AS-1", "AS-2", "AS-3"} {
		doc := map[string]any{"id": id, "meta": map[string]any{"tags": []string{"name:" + id}}}
		b, _ := json.Marshal(doc)
		_ = os.WriteFile(filepath.Join(dir, id+".gksave.json"), b, 0o644)
	}
	if w := do("PATCH", "/api/sets/official-set", `{"core":["AS-1"],"core_seeds":8}`, "alice"); w.Code != 403 {
		t.Fatalf("只有管理员能定核心题单：%d", w.Code)
	}
	if w := do("PATCH", "/api/sets/official-set", `{"core":["AS-1","AS-9"],"core_seeds":8}`, "boss"); w.Code != 400 {
		t.Fatalf("题单里有不存在的题要拒：%d", w.Code)
	}
	if w := do("PATCH", "/api/sets/official-set", `{"core":["AS-1"],"core_seeds":40}`, "boss"); w.Code != 400 {
		t.Fatalf("牌序数超过 32 要拒：%d", w.Code)
	}
	if w := do("PATCH", "/api/sets/official-set", `{"core":["AS-1","AS-3"],"core_seeds":8}`, "boss"); w.Code != 200 {
		t.Fatalf("设核心题单失败：%d %s", w.Code, w.Body.String())
	}
	c := app.store.SetConfigs()["official-set"]
	if len(c.Core) != 2 || c.CoreSeeds != 8 {
		t.Fatalf("没存下：%+v", c)
	}
	w := do("GET", "/api/sets", "", "")
	var sets []map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &sets)
	for _, x := range sets {
		if x["set"] == "official-set" {
			if core, _ := x["core"].([]any); len(core) != 2 || x["core_seeds"] != float64(8) {
				t.Fatalf("/api/sets 要带核心题单：%v %v", x["core"], x["core_seeds"])
			}
		}
	}
	if w := do("PATCH", "/api/sets/official-set", `{"core":[]}`, "boss"); w.Code != 200 || len(app.store.SetConfigs()["official-set"].Core) != 0 {
		t.Fatal("空题单 = 取消核心题单")
	}
}

func TestEvalScope(t *testing.T) {
	c := SetConfig{Core: []string{"A", "B"}, CoreSeeds: 8}
	cases := []struct {
		seeds int
		full  bool
		only  []string
		want  int
		core  bool
	}{
		{0, false, nil, 8, true},            // 缺省：核心题 × 核心牌序数
		{32, false, nil, 8, true},           // 旧客户端总是传 32：照样按核心来
		{4, false, nil, 4, true},            // 少跑几个（调试）可以
		{0, true, nil, 32, false},           // --full：全部题 × 32
		{0, false, []string{"C"}, 8, false}, // 指定 only 时按 only 筛题，牌序仍按核心
	}
	for _, x := range cases {
		n, core := c.evalScope(x.seeds, x.full, x.only)
		if n != x.want || (core != nil) != x.core {
			t.Errorf("seeds=%d full=%v only=%v → n=%d core=%v，要 n=%d core=%v", x.seeds, x.full, x.only, n, core != nil, x.want, x.core)
		}
	}
	if n, core := (SetConfig{}).evalScope(0, false, nil); n != 32 || core != nil {
		t.Errorf("没核心题单：全部题 × 32，得到 %d %v", n, core)
	}
}

func TestEvalStartUsesCore(t *testing.T) {
	app, do := collApp(t)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/evals", app.auth(app.handleEvalStart))
	dir := filepath.Join(app.store.Data, "problems", "official-set")
	for _, id := range []string{"AS-1", "AS-2", "AS-3"} {
		b, _ := json.Marshal(map[string]any{"id": id, "meta": map[string]any{"family": "F-" + id}})
		_ = os.WriteFile(filepath.Join(dir, id+".gksave.json"), b, 0o644)
	}
	if w := do("PATCH", "/api/sets/official-set", `{"core":["AS-1","AS-3"],"core_seeds":8}`, "boss"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	tok, _ := app.store.issueToken("alice", "cli", "", 0)
	start := func(body string) (int, int) {
		r := httptest.NewRequest("POST", "/api/evals", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+tok)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		var j struct {
			N     int              `json:"seeds_per_problem"`
			Slots []map[string]any `json:"slots"`
		}
		if json.Unmarshal(w.Body.Bytes(), &j) != nil {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
		return j.N, len(j.Slots)
	}
	if n, slots := start(`{"set":"official-set","label":"x","seeds":32}`); n != 8 || slots != 16 {
		t.Fatalf("缺省（旧客户端传 32）要跑核心 2 题 × 8：n=%d slots=%d", n, slots)
	}
	if n, slots := start(`{"set":"official-set","label":"x","full":true}`); n != 32 || slots != 96 {
		t.Fatalf("full 跑全部 3 题 × 32：n=%d slots=%d", n, slots)
	}
}
