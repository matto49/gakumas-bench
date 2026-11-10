package main

import (
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func collApp(t *testing.T) (*App, func(method, path, body, user string) *httptest.ResponseRecorder) {
	t.Setenv("GKBENCH_ADMINS", "boss")
	app := &App{store: &Store{Data: t.TempDir()}, jobs: map[string]*Job{}}
	_ = os.MkdirAll(filepath.Join(app.store.Data, "problems", "official-set"), 0o755)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/sets", app.auth(app.handleCreateSet))
	mux.HandleFunc("PATCH /api/sets/{set}", app.auth(app.handlePatchSet))
	mux.HandleFunc("GET /api/sets", app.open(app.handleSets))
	mux.HandleFunc("DELETE /api/sets/{set}/problems/{id}", app.auth(app.handleDeleteProblem))
	toks := map[string]string{}
	return app, func(method, path, body, user string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if user != "" {
			if toks[user] == "" {
				toks[user], _ = app.store.issueToken(user, "cli", "", 0)
			}
			r.Header.Set("Authorization", "Bearer "+toks[user])
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
}

func TestCreateAndReviewSet(t *testing.T) {
	app, do := collApp(t)
	if w := do("POST", "/api/sets", `{"title":"x"}`, ""); w.Code != 401 {
		t.Fatal("没登录也能建集合")
	}
	w := do("POST", "/api/sets", `{"title":"我的测试","blurb":"说明"}`, "alice")
	var made map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &made)
	set := made["set"]
	if w.Code != 200 || !strings.HasPrefix(set, "u-alice-") {
		t.Fatalf("建集合失败 %d %s", w.Code, w.Body.String())
	}
	c := app.store.SetConfigs()[set]
	if c.status() != statusCommunity || c.Owner != "alice" {
		t.Fatalf("新集合 %+v", c)
	}
	// 别人不能改；自己能改名字但不能自己升官方；管理员能审核
	if w := do("PATCH", "/api/sets/"+set, `{"title":"抢"}`, "bob"); w.Code != 403 {
		t.Fatal("别人改了集合")
	}
	if w := do("PATCH", "/api/sets/"+set, `{"status":"official"}`, "alice"); w.Code != 403 {
		t.Fatal("提交人自己把集合升成了官方")
	}
	if w := do("PATCH", "/api/sets/"+set, `{"title":"改个名"}`, "alice"); w.Code != 200 || app.store.SetConfigs()[set].Title != "改个名" {
		t.Fatal("提交人改不了名字")
	}
	if w := do("PATCH", "/api/sets/"+set, `{"status":"official"}`, "boss"); w.Code != 200 || app.store.SetConfigs()[set].status() != statusOfficial {
		t.Fatal("管理员审核不了")
	}
	// 升成官方以后，提交人不能再往里改
	if canEdit(app.store.SetConfigs()[set], "alice") {
		t.Fatal("官方集合提交人还能改")
	}
	// 老集合没有 status，当官方；普通用户不能动
	if canEdit(app.store.SetConfigs()["official-set"], "alice") || !canEdit(app.store.SetConfigs()["official-set"], "boss") {
		t.Fatal("老集合的权限不对")
	}
	var sets []map[string]any
	_ = json.Unmarshal(do("GET", "/api/sets", "", "alice").Body.Bytes(), &sets)
	if len(sets) != 2 {
		t.Fatalf("集合列表 %d 个", len(sets))
	}
}

func TestStoreProblemDedupe(t *testing.T) {
	app, do := collApp(t)
	_ = os.MkdirAll(filepath.Join(app.store.Data, "problems", "s1"), 0o755)
	doc := `{"format":"gkms.audition_save.v2","id":"AS-AAAAAAAA","loadout":{"idol_card_id":"i_card-x","produce_id":"produce-008","round":"final","deck_cards":["p_card-a","p_card-b+1"],"drink_ids":["d1"],"produce_item_ids":["i1"]},"prefix":"","objective":{},"check":{},"meta":{"family":"AF-11111111","stage":"hif.main2","turns":12,"tags":["name:t1"]},"runs":[]}`
	rep := map[string]any{"id": "AS-AAAAAAAA", "family": "AF-11111111", "name": "t1", "text": doc}
	if id, why := app.storeProblem("s1", rep); id != "AS-AAAAAAAA" || why != "" {
		t.Fatalf("收题失败 %q %q", id, why)
	}
	rep2 := map[string]any{"id": "AS-BBBBBBBB", "family": "AF-11111111", "name": "t2", "text": strings.Replace(doc, "AS-AAAAAAAA", "AS-BBBBBBBB", 1)}
	if _, why := app.storeProblem("s1", rep2); !strings.Contains(why, "重复") {
		t.Fatalf("同题族没拦住：%q", why)
	}
	sc := app.store.sceneOf(app.store.Problems("s1")[0])
	if sc["exam"] != "produce-008" || sc["round"] != "final" || sc["stage"] != "hif.main2" || sc["deck"] != 2 {
		t.Fatalf("场景 %v", sc)
	}
	if items := sc["drinks"].([]string); len(items) != 1 || items[0] != "d1" {
		t.Fatalf("饮料 %v", sc["drinks"])
	}
	// 删题：只有提交人 / 管理员；官方集合（s1 没有 status）普通用户删不了
	if w := do("DELETE", "/api/sets/s1/problems/AS-AAAAAAAA", "", "alice"); w.Code != 403 {
		t.Fatal("普通用户删了官方集合的题")
	}
	if w := do("DELETE", "/api/sets/s1/problems/AS-AAAAAAAA", "", "boss"); w.Code != 200 || len(app.store.Problems("s1")) != 0 {
		t.Fatalf("管理员删题失败 %d", w.Code)
	}
}

func TestUploadPermissions(t *testing.T) {
	app, _ := collApp(t)
	tokA, _ := app.store.issueToken("alice", "cli", "", 0)
	try := func(info string) int {
		var b strings.Builder
		mw := multipart.NewWriter(&b)
		fw, _ := mw.CreateFormFile("run_json", "run.json")
		fw.Write([]byte(info))
		fw, _ = mw.CreateFormFile("episodes", "episodes.jsonl.zst")
		fw.Write([]byte("x"))
		mw.Close()
		r := httptest.NewRequest("POST", "/api/runs", strings.NewReader(b.String()))
		r.Header.Set("Content-Type", mw.FormDataContentType())
		r.Header.Set("Authorization", "Bearer "+tokA)
		w := httptest.NewRecorder()
		app.auth(app.handleUpload)(w, r)
		return w.Code
	}
	if c := try(`{"schema":"gkbench.run.v2","run":"x","set":"official-set","kind":"template","template_seeds":"fixed32.v1"}`); c != 403 {
		t.Fatalf("普通用户上传了保密种子运行：%d", c)
	}
	if c := try(`{"schema":"gkbench.run.v2","run":"y","set":"official-set","kind":"fixed","privileged":true}`); c != 403 {
		t.Fatalf("普通用户上传了理论上限：%d", c)
	}
}
