package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTokens(t *testing.T) {
	s := &Store{Data: t.TempDir()}
	tok, err := s.issueToken("alice", "cli", "笔记本", 0)
	if err != nil || s.lookupToken(tok) != "alice" {
		t.Fatalf("新令牌认不出：%v", err)
	}
	if s.lookupToken("nope") != "" {
		t.Fatal("假令牌被认出来了")
	}
	old, _ := s.issueToken("alice", "session", "网页登录", time.Millisecond)
	time.Sleep(5 * time.Millisecond)
	if s.lookupToken(old) != "" {
		t.Fatal("过期的网页登录令牌还能用")
	}
	if err := s.revokeToken(hashToken(tok)); err != nil || s.lookupToken(tok) != "" {
		t.Fatal("吊销后还能用")
	}
	st, _ := os.Stat(s.tokensPath())
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("tokens.json 权限 %v", st.Mode().Perm())
	}
	b, _ := os.ReadFile(s.tokensPath())
	if strings.Contains(string(b), old) {
		t.Fatal("tokens.json 里有明文令牌")
	}
}

func TestUpsertGithubUser(t *testing.T) {
	s := &Store{Data: t.TempDir()}
	_ = os.MkdirAll(filepath.Join(s.Data, "private"), 0o700)
	// 已有管理员发的 bob 令牌；预先把 GitHub id 7 绑到 matto
	if _, err := s.issueToken("bob", "", "", 0); err != nil {
		t.Fatal(err)
	}
	_ = writeJSON(s.usersPath(), map[string]UserInfo{"7": {User: "matto"}}, 0o600)
	cases := []struct {
		p    githubProfile
		want string
	}{
		{githubProfile{ID: 7, Login: "matto49"}, "matto"},     // 预先绑定
		{githubProfile{ID: 8, Login: "Carol.Z"}, "carol.z"},   // 小写
		{githubProfile{ID: 9, Login: "Bob"}, "bob-gh"},        // 和令牌用户撞名
		{githubProfile{ID: 10, Login: "bob-gh"}, "bob-gh-gh"}, // 再撞
		{githubProfile{ID: 8, Login: "renamed"}, "carol.z"},   // 改了 GitHub 名，本站用户名不变
	}
	for _, c := range cases {
		got, err := s.upsertGithubUser(&c.p)
		if err != nil || got != c.want {
			t.Fatalf("%s：得到 %q，要 %q（%v）", c.p.Login, got, c.want, err)
		}
	}
	if p := s.userProfile("carol.z"); p == nil || p.Login != "renamed" {
		t.Fatal("没更新 GitHub 登录名")
	}
}

func TestSafeNext(t *testing.T) {
	for in, want := range map[string]string{"": "/me", "/sets/x": "/sets/x", "//evil.com": "/me", "https://evil.com": "/me", "/\\evil": "/me"} {
		if got := safeNext(in); got != want {
			t.Fatalf("safeNext(%q)=%q", in, got)
		}
	}
}

// 整个 GitHub 登录流程：跳授权 → 回调 → 建账号 → cookie 能用 → 生成命令行令牌 → 退出
func TestGithubFlow(t *testing.T) {
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			_ = r.ParseForm()
			if r.Form.Get("code") != "good" || r.Form.Get("client_secret") != "sec" {
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "bad_verification_code"})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "gho_x"})
		case "/user":
			if r.Header.Get("Authorization") != "Bearer gho_x" {
				w.WriteHeader(401)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"id": 42, "login": "Dave", "name": "Dave D", "avatar_url": "https://a/x.png"})
		}
	}))
	defer gh.Close()
	ghAuthorizeURL, ghTokenURL, ghUserURL = gh.URL+"/authorize", gh.URL+"/token", gh.URL+"/user"

	app := &App{store: &Store{Data: t.TempDir()}, github: githubConf{ID: "cid", Secret: "sec", Public: "https://x.test/gkbench"}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/auth/github", app.handleGithubStart)
	mux.HandleFunc("GET /api/auth/github/callback", app.handleGithubCallback)
	mux.HandleFunc("GET /api/me", app.auth(app.handleMe))
	mux.HandleFunc("POST /api/me/tokens", app.auth(app.handleNewToken))
	mux.HandleFunc("GET /api/me/tokens", app.auth(app.handleMyTokens))
	mux.HandleFunc("POST /api/logout", app.handleLogout)

	do := func(method, path string, cookies []*http.Cookie, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		for _, c := range cookies {
			r.AddCookie(c)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}

	w := do("GET", "/api/auth/github?next=/sets/hif-live", nil, "")
	loc, _ := url.Parse(w.Header().Get("Location"))
	if w.Code != 302 || loc.Query().Get("client_id") != "cid" || loc.Query().Get("redirect_uri") != "https://x.test/gkbench/api/auth/github/callback" {
		t.Fatalf("跳授权不对：%d %s", w.Code, loc)
	}
	state := loc.Query().Get("state")
	oauth := w.Result().Cookies()

	// state 不对：拒绝
	w = do("GET", "/api/auth/github/callback?code=good&state=wrong", oauth, "")
	if !strings.Contains(w.Header().Get("Location"), "login_error") {
		t.Fatal("state 不对也登录了")
	}
	// 授权码不对：拒绝
	w = do("GET", "/api/auth/github/callback?code=bad&state="+state, oauth, "")
	if !strings.Contains(w.Header().Get("Location"), "login_error") {
		t.Fatal("授权码不对也登录了")
	}
	// 正常
	w = do("GET", "/api/auth/github/callback?code=good&state="+state, oauth, "")
	if w.Header().Get("Location") != "/gkbench/sets/hif-live" {
		t.Fatalf("回调后跳到 %q", w.Header().Get("Location"))
	}
	var session []*http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == "gkb_token" && c.Value != "" {
			session = []*http.Cookie{c}
			if !c.HttpOnly {
				t.Fatal("登录 cookie 不是 HttpOnly")
			}
		}
	}
	if session == nil {
		t.Fatal("没发登录 cookie")
	}
	w = do("GET", "/api/me", session, "")
	var me map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &me)
	if me["user"] != "dave" || me["github"] != "Dave" {
		t.Fatalf("/api/me = %v", me)
	}

	// 命令行令牌：明文只返回一次，之后能用 Bearer 认出来；列表里没有网页登录令牌
	w = do("POST", "/api/me/tokens", session, `{"name":"laptop"}`)
	var nt map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &nt)
	if app.store.lookupToken(nt["token"]) != "dave" {
		t.Fatal("命令行令牌认不出")
	}
	w = do("GET", "/api/me/tokens", session, "")
	if strings.Contains(w.Body.String(), nt["token"]) || strings.Contains(w.Body.String(), "session") {
		t.Fatalf("令牌列表泄露了东西：%s", w.Body.String())
	}

	// 退出：网页登录令牌作废，命令行令牌还在
	do("POST", "/api/logout", session, "")
	if do("GET", "/api/me", session, "").Code != 401 {
		t.Fatal("退出后网页登录还有效")
	}
	if app.store.lookupToken(nt["token"]) != "dave" {
		t.Fatal("退出把命令行令牌也删了")
	}
}
