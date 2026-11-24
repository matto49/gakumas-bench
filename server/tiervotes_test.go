package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func tierVoteApp(t *testing.T) func(method, path, body, user string) *httptest.ResponseRecorder {
	app := &App{store: &Store{Data: t.TempDir()}, jobs: map[string]*Job{}}
	static := t.TempDir()
	_ = os.MkdirAll(filepath.Join(static, "tiers"), 0o755)
	board := `{"id":"hif-test","cards":[{"id":"i_card-a"},{"id":"i_card-b"}]}`
	_ = os.WriteFile(filepath.Join(static, "tiers", "hif-test.json"), []byte(board), 0o644)
	mux := app.routes(static, t.TempDir())
	toks := map[string]string{}
	return func(method, path, body, user string) *httptest.ResponseRecorder {
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

type tierVotesResp struct {
	Cards map[string]struct {
		N    int            `json:"n"`
		Mean float64        `json:"mean"`
		Dist map[string]int `json:"dist"`
	} `json:"cards"`
	Mine map[string]string `json:"mine"`
}

func getVotes(t *testing.T, do func(string, string, string, string) *httptest.ResponseRecorder, user string) tierVotesResp {
	t.Helper()
	w := do("GET", "/api/tiers/hif-test/votes", "", user)
	if w.Code != 200 {
		t.Fatalf("取票失败 %d %s", w.Code, w.Body.String())
	}
	var v tierVotesResp
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestTierVotes(t *testing.T) {
	do := tierVoteApp(t)
	if w := do("PUT", "/api/tiers/hif-test/votes/i_card-a", `{"tier":"S"}`, ""); w.Code != 401 {
		t.Fatalf("没登录也能投 %d", w.Code)
	}
	for _, c := range []struct{ user, tier string }{{"alice", "S"}, {"bob", "A"}, {"carol", "A"}} {
		if w := do("PUT", "/api/tiers/hif-test/votes/i_card-a", `{"tier":"`+c.tier+`"}`, c.user); w.Code != 200 {
			t.Fatalf("%s 投票失败 %d %s", c.user, w.Code, w.Body.String())
		}
	}
	// 同一个人再投是改票，不是多一票
	if w := do("PUT", "/api/tiers/hif-test/votes/i_card-a", `{"tier":"B"}`, "carol"); w.Code != 200 {
		t.Fatal("改票失败")
	}
	v := getVotes(t, do, "alice")
	a := v.Cards["i_card-a"]
	if a.N != 3 || a.Dist["S"] != 1 || a.Dist["A"] != 1 || a.Dist["B"] != 1 || a.Mean != 4 {
		t.Fatalf("汇总不对 %+v", a)
	}
	if v.Mine["i_card-a"] != "S" {
		t.Fatalf("自己的票 %v", v.Mine)
	}
	if anon := getVotes(t, do, ""); len(anon.Mine) != 0 || anon.Cards["i_card-a"].N != 3 {
		t.Fatalf("没登录也该看到汇总、看不到谁投的 %+v", anon)
	}
	// 撤票
	if w := do("PUT", "/api/tiers/hif-test/votes/i_card-a", `{"tier":""}`, "alice"); w.Code != 200 {
		t.Fatal("撤票失败")
	}
	if v := getVotes(t, do, "alice"); v.Cards["i_card-a"].N != 2 || v.Mine["i_card-a"] != "" {
		t.Fatalf("撤票后 %+v", v)
	}
	// 档位、卡、榜不对都拒
	if w := do("PUT", "/api/tiers/hif-test/votes/i_card-a", `{"tier":"SS"}`, "alice"); w.Code != 400 {
		t.Fatalf("非法档位 %d", w.Code)
	}
	if w := do("PUT", "/api/tiers/hif-test/votes/i_card-zzz", `{"tier":"A"}`, "alice"); w.Code != 404 {
		t.Fatalf("榜上没有的卡 %d", w.Code)
	}
	if w := do("PUT", "/api/tiers/no-such/votes/i_card-a", `{"tier":"A"}`, "alice"); w.Code != 404 {
		t.Fatalf("没有的榜 %d", w.Code)
	}
	if w := do("GET", "/api/tiers/no-such/votes", "", ""); w.Code != 404 {
		t.Fatalf("没有的榜取票 %d", w.Code)
	}
	// 原来的静态榜单接口不受影响
	if w := do("GET", "/api/tiers/hif-test", "", ""); w.Code != 200 {
		t.Fatalf("榜单本身取不到了 %d", w.Code)
	}
}
