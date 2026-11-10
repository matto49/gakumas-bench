package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func pwApp(t *testing.T) (*App, func(method, path, body string, cookies []*http.Cookie, ip string) *httptest.ResponseRecorder) {
	registerLimit, loginLimit = limiter{}, limiter{}
	app := &App{store: &Store{Data: t.TempDir()}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/auth/register", app.handleRegister)
	mux.HandleFunc("POST /api/auth/login", app.handlePasswordLogin)
	mux.HandleFunc("POST /api/me/password", app.auth(app.handleSetPassword))
	mux.HandleFunc("GET /api/me", app.auth(app.handleMe))
	return app, func(method, path, body string, cookies []*http.Cookie, ip string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("X-Real-IP", ip)
		for _, c := range cookies {
			r.AddCookie(c)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
}

func sessionOf(w *httptest.ResponseRecorder) []*http.Cookie {
	for _, c := range w.Result().Cookies() {
		if c.Name == "gkb_token" && c.Value != "" {
			return []*http.Cookie{c}
		}
	}
	return nil
}

func TestRegisterAndLogin(t *testing.T) {
	app, do := pwApp(t)
	bad := map[string]string{
		`{"user":"ab","password":"12345678"}`:       "太短的用户名",
		`{"user":"Hi There","password":"12345678"}`: "带空格",
		`{"user":"admin","password":"12345678"}`:    "保留名",
		`{"user":"newbie","password":"short"}`:      "密码太短",
		`{"user":"-dash","password":"12345678"}`:    "横线开头",
	}
	for body, why := range bad {
		if w := do("POST", "/api/auth/register", body, nil, "1.1.1.1"); w.Code != 400 {
			t.Fatalf("%s 应该拒绝，得到 %d", why, w.Code)
		}
	}
	w := do("POST", "/api/auth/register", `{"user":"Alice_1","password":"correct horse"}`, nil, "1.1.1.1")
	if w.Code != 200 || sessionOf(w) == nil {
		t.Fatalf("注册失败 %d %s", w.Code, w.Body.String())
	}
	var me map[string]any
	_ = json.Unmarshal(do("GET", "/api/me", "", sessionOf(w), "1.1.1.1").Body.Bytes(), &me)
	if me["user"] != "alice_1" || me["has_password"] != true {
		t.Fatalf("/api/me = %v", me)
	}
	if w := do("POST", "/api/auth/register", `{"user":"alice_1","password":"another one"}`, nil, "2.2.2.2"); w.Code != 409 {
		t.Fatal("重名注册没拒绝")
	}
	b, _ := os.ReadFile(app.store.accountsPath())
	if strings.Contains(string(b), "correct horse") {
		t.Fatal("accounts.json 里有明文密码")
	}
	if w := do("POST", "/api/auth/login", `{"user":"alice_1","password":"wrong pass"}`, nil, "1.1.1.1"); w.Code != 401 {
		t.Fatal("错密码登录成功了")
	}
	if w := do("POST", "/api/auth/login", `{"user":"nobody","password":"whatever1"}`, nil, "1.1.1.1"); w.Code != 401 {
		t.Fatal("不存在的用户登录成功了")
	}
	if w := do("POST", "/api/auth/login", `{"user":"ALICE_1","password":"correct horse"}`, nil, "1.1.1.1"); w.Code != 200 || sessionOf(w) == nil {
		t.Fatal("正确密码登不上（用户名不分大小写）")
	}
}

func TestRegisterAvoidsTakenNames(t *testing.T) {
	app, do := pwApp(t)
	_, _ = app.store.issueToken("matto", "", "", 0)
	_, _ = app.store.upsertGithubUser(&githubProfile{ID: 5, Login: "carol"})
	for _, n := range []string{"matto", "carol"} {
		if w := do("POST", "/api/auth/register", `{"user":"`+n+`","password":"12345678"}`, nil, "1.1.1.1"); w.Code != 409 {
			t.Fatalf("%s 已被占用却注册成功 %d", n, w.Code)
		}
	}
	// 反过来：GitHub 新用户撞上密码账号的名字要改名
	do("POST", "/api/auth/register", `{"user":"dave","password":"12345678"}`, nil, "1.1.1.2")
	if got, _ := app.store.upsertGithubUser(&githubProfile{ID: 6, Login: "dave"}); got != "dave-gh" {
		t.Fatalf("GitHub 用户撞名得到 %q", got)
	}
}

func TestRateLimits(t *testing.T) {
	_, do := pwApp(t)
	for i := 0; i < registerPerHour; i++ {
		if w := do("POST", "/api/auth/register", `{"user":"bot`+string(rune('a'+i))+`x","password":"12345678"}`, nil, "9.9.9.9"); w.Code != 200 {
			t.Fatalf("第 %d 个注册失败 %d", i, w.Code)
		}
	}
	if w := do("POST", "/api/auth/register", `{"user":"botzz","password":"12345678"}`, nil, "9.9.9.9"); w.Code != 429 {
		t.Fatal("同一 IP 注册没限流")
	}
	for i := 0; i < loginFailMax; i++ {
		do("POST", "/api/auth/login", `{"user":"botax","password":"wrongwrong"}`, nil, "8.8.8.8")
	}
	if w := do("POST", "/api/auth/login", `{"user":"botax","password":"12345678"}`, nil, "8.8.8.8"); w.Code != 429 {
		t.Fatal("连续输错后没限流")
	}
	if w := do("POST", "/api/auth/login", `{"user":"botax","password":"12345678"}`, nil, "7.7.7.7"); w.Code != 200 {
		t.Fatal("别的 IP 也被连累了")
	}
}

func TestSetPassword(t *testing.T) {
	app, do := pwApp(t)
	// GitHub 用户没有密码：直接设
	_, _ = app.store.upsertGithubUser(&githubProfile{ID: 7, Login: "erin"})
	tok, _ := app.store.issueToken("erin", "session", "", 0)
	ck := []*http.Cookie{{Name: "gkb_token", Value: tok}}
	if w := do("POST", "/api/me/password", `{"password":"first-pass"}`, ck, "1.1.1.1"); w.Code != 200 {
		t.Fatalf("设密码失败 %d %s", w.Code, w.Body.String())
	}
	if w := do("POST", "/api/auth/login", `{"user":"erin","password":"first-pass"}`, nil, "1.1.1.1"); w.Code != 200 {
		t.Fatal("设了密码却登不上")
	}
	// 已有密码：要旧密码
	if w := do("POST", "/api/me/password", `{"password":"second-pass"}`, ck, "1.1.1.1"); w.Code != 403 {
		t.Fatal("没给旧密码也改成功了")
	}
	if w := do("POST", "/api/me/password", `{"old":"first-pass","password":"second-pass"}`, ck, "1.1.1.1"); w.Code != 200 {
		t.Fatal("给了旧密码却改不了")
	}
	if w := do("POST", "/api/auth/login", `{"user":"erin","password":"first-pass"}`, nil, "1.1.1.1"); w.Code != 401 {
		t.Fatal("旧密码还能登录")
	}
}
