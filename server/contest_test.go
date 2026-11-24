package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// 竞技场接口（contest.go）。测试只用假的包目录：最小的 contest.json 和 PACKAGE，不用真的模拟包。

const fakeContestJSON = `{
 "PvpRateConfig": [
  {"id": "pvp_rate_config-9", "description": "S9", "secretField": 1, "stages": [
   {"stageType": "PvpRateStageType__1", "planType": "ProducePlanType_Common", "turn": 12, "produceItemIds": ["pitem_a"], "vocal": 356, "dance": 267, "visual": 267, "bgmAssetId": "x"},
   {"stageType": "PvpRateStageType__2", "planType": "ProducePlanType_Plan2", "turn": 12, "produceItemIds": ["pitem_b"], "vocal": 300, "dance": 300, "visual": 300},
   {"stageType": "PvpRateStageType__3", "planType": "ProducePlanType_Plan2", "turn": 8, "produceItemIds": [], "vocal": 100, "dance": 200, "visual": 300}]},
  {"id": "pvp_rate_config-56", "description": "S56", "stages": [
   {"stageType": "PvpRateStageType__1", "planType": "ProducePlanType_Plan1", "turn": 10, "produceItemIds": ["pitem_c"], "vocal": 1, "dance": 2, "visual": 3}]}
 ],
 "PvpRateCommonProduceCard": [],
 "PvpRateUnitSlotUnlock": []
}`

// fakeContestRoot 一个假的包目录
func fakeContestRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "GKMSContest", "master")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "contest.json"), []byte(fakeContestJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(root, "PACKAGE"), []byte("3ad8f9b rev431 S56 2026-11-16\n"), 0o644)
	return root
}

func TestContestSeasonsWhitelistedAndNewestFirst(t *testing.T) {
	app, h, _ := routesApp(t)
	app.contest = ContestConf{Root: fakeContestRoot(t), Python: "python3"}
	w := serve(h, "GET", "/api/contest/seasons")
	if w.Code != 200 {
		t.Fatalf("code %d: %s", w.Code, w.Body)
	}
	var got struct {
		Package string           `json:"package"`
		Seasons []map[string]any `json:"seasons"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Package != "3ad8f9b rev431 S56 2026-11-16" {
		t.Fatalf("package %q", got.Package)
	}
	if len(got.Seasons) != 2 || got.Seasons[0]["id"] != "pvp_rate_config-56" || got.Seasons[1]["id"] != "pvp_rate_config-9" {
		t.Fatalf("seasons order %v", got.Seasons)
	}
	if _, ok := got.Seasons[1]["secretField"]; ok {
		t.Fatal("season field not whitelisted")
	}
	stages := got.Seasons[1]["stages"].([]any)
	if len(stages) != 3 {
		t.Fatalf("stages %v", stages)
	}
	st := stages[0].(map[string]any)
	if _, ok := st["bgmAssetId"]; ok {
		t.Fatal("stage field not whitelisted")
	}
	for _, k := range []string{"stageType", "planType", "turn", "produceItemIds", "vocal", "dance", "visual"} {
		if _, ok := st[k]; !ok {
			t.Fatalf("stage misses %s: %v", k, st)
		}
	}
	if st["turn"].(float64) != 12 || st["planType"] != "ProducePlanType_Common" {
		t.Fatalf("stage values %v", st)
	}
}

func TestContestUnavailableWithoutPackage(t *testing.T) {
	app, h, _ := routesApp(t)
	app.contest = ContestConf{}
	if w := serve(h, "GET", "/api/contest/seasons"); w.Code != 503 {
		t.Fatalf("no root: code %d", w.Code)
	}
	app.contest = ContestConf{Root: t.TempDir(), Python: "python3"}
	if w := serve(h, "GET", "/api/contest/seasons"); w.Code != 503 {
		t.Fatalf("empty root: code %d", w.Code)
	}
}

// ---------------------------------------------------------------- 模拟任务

// fakeContest 把模拟子进程换成 sh 脚本：script 在任务目录里运行，可以读 job.json、写 progress.jsonl / result.json
func fakeContest(t *testing.T, script string) (*App, http.Handler, string) {
	t.Helper()
	app, h, data := routesApp(t)
	app.contest = ContestConf{Root: fakeContestRoot(t), Python: "python3"}
	app.contestCmd = func(ctx context.Context, dir string) *exec.Cmd {
		c := exec.CommandContext(ctx, "sh", "-c", script)
		c.Dir = dir
		return c
	}
	return app, h, data
}

const okWorker = `printf '{"done":1,"total":2}\n' > progress.jsonl; printf '{"ok":true,"stats":{"n":10,"mean":123}}' > result.json`

var simIP int

func postSim(h http.Handler, body, ip string) *httptest.ResponseRecorder {
	if ip == "" {
		simIP++
		ip = fmt.Sprintf("10.9.0.%d", simIP%250+1)
	}
	return doAssist(h, "POST", "/api/contest/sims", body, ip)
}

func validSim() map[string]any {
	return map[string]any{
		"season_id": "pvp_rate_config-9", "stage": 1, "runs": 100, "support_permyriad": 188,
		"loadout": map[string]any{
			"idol_card_id": "i_card-hmsz-3-020", "stamina": 52,
			"params":     map[string]any{"vocal": 3791, "dance": 1504, "visual": 2114},
			"items":      []any{"pitem_01-3-341-0"},
			"main_cards": []any{map[string]any{"id": "p_card-01-ido-3_241", "upgrade_count": 1, "customizes": []any{map[string]any{"id": "c1", "customize_count": 1}}}},
			"sub_cards":  []any{map[string]any{"id": "p_card-00-sup-3_093"}},
			"evil":       "drop me",
		},
		"kind": "optimize",
	}
}

func simBody(m map[string]any) string { b, _ := json.Marshal(m); return string(b) }

// waitSim 轮询到不再是 queued / running
func waitSim(t *testing.T, h http.Handler, id string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		w := serve(h, "GET", "/api/contest/sims/"+id)
		var v map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &v)
		if s := v["state"]; s != "queued" && s != "running" {
			return v
		}
		time.Sleep(30 * time.Millisecond)
	}
	t.Fatalf("sim %s never finished", id)
	return nil
}

func TestContestSimRunsAndReturnsResult(t *testing.T) {
	_, h, data := fakeContest(t, okWorker)
	w := postSim(h, simBody(validSim()), "")
	if w.Code != 200 {
		t.Fatalf("code %d: %s", w.Code, w.Body)
	}
	var rep struct {
		ID       string `json:"id"`
		Position int    `json:"position"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &rep)
	if len(rep.ID) < 16 {
		t.Fatalf("id %q", rep.ID)
	}
	v := waitSim(t, h, rep.ID)
	if v["state"] != "done" {
		t.Fatalf("state %v", v)
	}
	if v["result"].(map[string]any)["stats"].(map[string]any)["mean"].(float64) != 123 {
		t.Fatalf("result %v", v["result"])
	}
	// job.json 由服务器重新组装：kind 固定 sim，多余字段丢掉
	b, err := os.ReadFile(filepath.Join(data, "contest", "jobs", rep.ID, "job.json"))
	if err != nil {
		t.Fatal(err)
	}
	var job map[string]any
	_ = json.Unmarshal(b, &job)
	if job["kind"] != "sim" {
		t.Fatalf("kind %v", job["kind"])
	}
	if _, ok := job["loadout"].(map[string]any)["evil"]; ok {
		t.Fatal("unknown loadout field kept")
	}
	if job["seed_base"] == nil {
		t.Fatal("seed_base default missing")
	}
}

func TestContestSimRejectsBadInput(t *testing.T) {
	_, h, _ := fakeContest(t, okWorker)
	bad := []func(m map[string]any){
		func(m map[string]any) { m["runs"] = 5 },
		func(m map[string]any) { m["runs"] = 2001 },
		func(m map[string]any) { m["stage"] = 3 },
		func(m map[string]any) { m["season_id"] = "pvp_rate_config-99" },
		func(m map[string]any) { m["season_id"] = "../../etc" },
		func(m map[string]any) { m["support_permyriad"] = 2001 },
		func(m map[string]any) { m["loadout"].(map[string]any)["stamina"] = 0 },
		func(m map[string]any) { m["loadout"].(map[string]any)["params"].(map[string]any)["vocal"] = 6001 },
		func(m map[string]any) { m["loadout"].(map[string]any)["params"].(map[string]any)["dance"] = 1.5 },
		func(m map[string]any) { m["loadout"].(map[string]any)["idol_card_id"] = "a;rm -rf" },
		func(m map[string]any) { m["loadout"].(map[string]any)["items"] = []any{"a", "b", "c", "d", "e"} },
		func(m map[string]any) {
			cs := []any{}
			for i := 0; i < 7; i++ {
				cs = append(cs, map[string]any{"id": "p_card-x"})
			}
			m["loadout"].(map[string]any)["main_cards"] = cs
		},
	}
	for i, f := range bad {
		m := validSim()
		f(m)
		if w := postSim(h, simBody(m), ""); w.Code != 400 {
			t.Fatalf("case %d: code %d %s", i, w.Code, w.Body)
		}
	}
}

func TestContestSimOneActivePerIP(t *testing.T) {
	_, h, _ := fakeContest(t, "sleep 1; "+okWorker)
	if w := postSim(h, simBody(validSim()), "10.8.0.1"); w.Code != 200 {
		t.Fatalf("first %d", w.Code)
	}
	if w := postSim(h, simBody(validSim()), "10.8.0.1"); w.Code != 429 {
		t.Fatalf("second same ip %d", w.Code)
	}
	if w := postSim(h, simBody(validSim()), "10.8.0.2"); w.Code != 200 {
		t.Fatalf("other ip %d", w.Code)
	}
}

func TestContestSimQueueFull(t *testing.T) {
	app, h, _ := fakeContest(t, "sleep 2; "+okWorker)
	app.contestQueueMax = 2
	codes := []int{}
	for i := 0; i < 4; i++ {
		codes = append(codes, postSim(h, simBody(validSim()), "").Code)
	}
	// 1 个在跑 + 2 个排队，第 4 个满了
	if fmt.Sprint(codes) != "[200 200 200 429]" {
		t.Fatalf("codes %v", codes)
	}
}

func TestContestSimCancelRunning(t *testing.T) {
	_, h, _ := fakeContest(t, "sleep 5; "+okWorker)
	w := postSim(h, simBody(validSim()), "")
	var rep map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &rep)
	id := rep["id"].(string)
	time.Sleep(200 * time.Millisecond)
	if d := doAssist(h, "DELETE", "/api/contest/sims/"+id, "", "10.7.0.1"); d.Code != 200 {
		t.Fatalf("delete %d", d.Code)
	}
	start := time.Now()
	v := waitSim(t, h, id)
	if v["state"] != "canceled" || time.Since(start) > 3*time.Second {
		t.Fatalf("state %v after %v", v["state"], time.Since(start))
	}
}

func TestContestSimTimeoutAndFailure(t *testing.T) {
	app, h, _ := fakeContest(t, "sleep 5; "+okWorker)
	app.contestTimeout = 300 * time.Millisecond
	w := postSim(h, simBody(validSim()), "")
	var rep map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &rep)
	v := waitSim(t, h, rep["id"].(string))
	if v["state"] != "failed" || v["error"] != "模拟超时了，少跑几局再试" {
		t.Fatalf("timeout: %v", v)
	}

	_, h2, _ := fakeContest(t, `printf '{"ok":false,"error":"Traceback secret path /opt/x"}' > result.json; exit 1`)
	w = postSim(h2, simBody(validSim()), "")
	_ = json.Unmarshal(w.Body.Bytes(), &rep)
	v = waitSim(t, h2, rep["id"].(string))
	if v["state"] != "failed" || strings.Contains(fmt.Sprint(v), "secret") {
		t.Fatalf("failure leaks or wrong: %v", v)
	}
}

func TestContestSimRunningShowsProgress(t *testing.T) {
	_, h, _ := fakeContest(t, `printf '{"done":3,"total":10,"partial":{"n":3,"mean":5}}\n' > progress.jsonl; sleep 2; `+okWorker)
	w := postSim(h, simBody(validSim()), "")
	var rep map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &rep)
	id := rep["id"].(string)
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var v map[string]any
		_ = json.Unmarshal(serve(h, "GET", "/api/contest/sims/"+id).Body.Bytes(), &v)
		if p, ok := v["progress"].(map[string]any); ok && p["done"].(float64) == 3 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("progress never shown")
}

func TestContestRecoverMarksLeftoversFailed(t *testing.T) {
	app, h, data := fakeContest(t, okWorker)
	dir := filepath.Join(data, "contest", "jobs", "deadbeefdeadbeefdeadbeef")
	_ = os.MkdirAll(dir, 0o755)
	_ = os.WriteFile(filepath.Join(dir, "job.json"), []byte(`{}`), 0o644)
	old := filepath.Join(data, "contest", "jobs", "0123456789abcdef0123")
	_ = os.MkdirAll(old, 0o755)
	past := time.Now().Add(-8 * 24 * time.Hour)
	_ = os.Chtimes(old, past, past)
	app.contestRecover()
	var v map[string]any
	_ = json.Unmarshal(serve(h, "GET", "/api/contest/sims/deadbeefdeadbeefdeadbeef").Body.Bytes(), &v)
	if v["state"] != "failed" || v["error"] != "服务重启了，请重新模拟" {
		t.Fatalf("leftover %v", v)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("old job dir not cleaned")
	}
	if w := serve(h, "GET", "/api/contest/sims/..%2F..%2Fetc"); w.Code != 404 {
		t.Fatalf("bad id %d", w.Code)
	}
}

func TestContestSimUnavailable(t *testing.T) {
	app, h, _ := routesApp(t)
	app.contest = ContestConf{}
	if w := postSim(h, simBody(validSim()), ""); w.Code != 503 {
		t.Fatalf("code %d", w.Code)
	}
}

func TestContestGCDropsOldFinishedJobs(t *testing.T) {
	app, _, data := fakeContest(t, okWorker)
	jobs := filepath.Join(data, "contest", "jobs")
	mk := func(id, state string, age time.Duration) *contestJob {
		dir := filepath.Join(jobs, id)
		_ = os.MkdirAll(dir, 0o755)
		j := &contestJob{ID: id, State: state, Dir: dir, created: time.Now().Add(-age)}
		app.contestJobs[id] = j
		return j
	}
	app.contestJobs = map[string]*contestJob{}
	mk("aaaaaaaaaaaaaaaaaaaaaaaa", "done", 8*24*time.Hour)
	mk("bbbbbbbbbbbbbbbbbbbbbbbb", "running", 8*24*time.Hour)
	mk("cccccccccccccccccccccccc", "failed", time.Hour)
	app.contestGC(time.Now())
	if _, ok := app.contestJobs["aaaaaaaaaaaaaaaaaaaaaaaa"]; ok {
		t.Fatal("old finished job kept in memory")
	}
	if _, err := os.Stat(filepath.Join(jobs, "aaaaaaaaaaaaaaaaaaaaaaaa")); !os.IsNotExist(err) {
		t.Fatal("old finished job dir kept")
	}
	if _, ok := app.contestJobs["bbbbbbbbbbbbbbbbbbbbbbbb"]; !ok {
		t.Fatal("running job dropped")
	}
	if _, ok := app.contestJobs["cccccccccccccccccccccccc"]; !ok {
		t.Fatal("recent job dropped")
	}
}
