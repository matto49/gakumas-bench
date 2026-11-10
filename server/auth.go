package main

// 账号：用 GitHub 登录（OAuth App），第一次登录自动建账号。
//
//	$DATA/private/users.json   {"<GitHub 数字 id>": {user, login, name, avatar, created, last}}
//	$DATA/private/tokens.json  sha256(令牌) -> {user, kind, name, created, expires}
//	                           kind：session 网页登录（180 天）、cli 命令行令牌（自己在「我的」页生成，可吊销）、
//	                           空 = 管理员用 add-token 发的旧令牌
//
// 用户名取 GitHub 登录名的小写；和已有用户撞名时加 -gh 后缀。要把某个 GitHub 账号绑到已有用户名，
// 在 users.json 里预先写一条 {"<id>": {"user": "<用户名>"}}（matto49 → matto 就是这样绑的）。
//
// 环境变量：GKBENCH_GITHUB_CLIENT_ID、GKBENCH_GITHUB_CLIENT_SECRET（没配就不显示 GitHub 登录），
// GKBENCH_PUBLIC_URL（对外地址，回调用，默认 https://hiro.matto.top/gkbench）。
//
//	GET    /api/auth                     {github: 是否可用}
//	GET    /api/auth/github?next=/me     跳到 GitHub 授权
//	GET    /api/auth/github/callback     GitHub 回调：建账号、发网页登录令牌、跳回 next
//	GET    /api/me/tokens                我的命令行令牌（不含明文）
//	POST   /api/me/tokens {name}         新建一个，明文只在这次返回
//	DELETE /api/me/tokens/{id}           吊销

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	sessionDays  = 180
	maxCLITokens = 10
)

type TokenInfo struct {
	User    string `json:"user"`
	Kind    string `json:"kind,omitempty"`
	Name    string `json:"name,omitempty"`
	Created string `json:"created,omitempty"`
	Expires string `json:"expires,omitempty"`
}

type UserInfo struct {
	User    string `json:"user"`
	Login   string `json:"login,omitempty"`
	Name    string `json:"name,omitempty"`
	Avatar  string `json:"avatar,omitempty"`
	Created string `json:"created,omitempty"`
	Last    string `json:"last,omitempty"`
}

var tokMu sync.Mutex

func (s *Store) tokensPath() string { return filepath.Join(s.Data, "private", "tokens.json") }
func (s *Store) usersPath() string  { return filepath.Join(s.Data, "private", "users.json") }

func (s *Store) loadTokens() map[string]TokenInfo {
	m := map[string]TokenInfo{}
	_ = readJSON(s.tokensPath(), &m)
	return m
}

func (s *Store) saveTokens(m map[string]TokenInfo) error {
	if err := os.MkdirAll(filepath.Dir(s.tokensPath()), 0o700); err != nil {
		return err
	}
	return writeJSON(s.tokensPath(), m, 0o600)
}

func hashToken(tok string) string {
	h := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(h[:])
}

func randToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// lookupToken 令牌 -> 用户名；过期的当作无效
func (s *Store) lookupToken(tok string) string {
	t, ok := s.loadTokens()[hashToken(tok)]
	if !ok {
		return ""
	}
	if t.Expires != "" {
		if exp, err := time.Parse(time.RFC3339, t.Expires); err == nil && time.Now().After(exp) {
			return ""
		}
	}
	return t.User
}

// issueToken 发一个新令牌，返回明文（只存哈希）
func (s *Store) issueToken(user, kind, name string, ttl time.Duration) (string, error) {
	tokMu.Lock()
	defer tokMu.Unlock()
	m := s.loadTokens()
	now := time.Now().UTC()
	// 顺手清掉过期的网页登录令牌
	for k, t := range m {
		if t.Expires != "" {
			if exp, err := time.Parse(time.RFC3339, t.Expires); err == nil && now.After(exp) {
				delete(m, k)
			}
		}
	}
	tok := randToken(24)
	info := TokenInfo{User: user, Kind: kind, Name: name, Created: now.Format(time.RFC3339)}
	if ttl > 0 {
		info.Expires = now.Add(ttl).Format(time.RFC3339)
	}
	m[hashToken(tok)] = info
	return tok, s.saveTokens(m)
}

func (s *Store) revokeToken(hash string) error {
	tokMu.Lock()
	defer tokMu.Unlock()
	m := s.loadTokens()
	delete(m, hash)
	return s.saveTokens(m)
}

// ---------------------------------------------------------------- GitHub

type githubConf struct {
	ID, Secret, Public string
}

func loadGithubConf() githubConf {
	return githubConf{ID: os.Getenv("GKBENCH_GITHUB_CLIENT_ID"), Secret: os.Getenv("GKBENCH_GITHUB_CLIENT_SECRET"),
		Public: strings.TrimRight(env("GKBENCH_PUBLIC_URL", "https://hiro.matto.top/gkbench"), "/")}
}

func (g githubConf) ok() bool { return g.ID != "" && g.Secret != "" }

// basePath 对外地址里的路径前缀（/gkbench），cookie 和跳转都用它
func (g githubConf) basePath() string {
	u, err := url.Parse(g.Public)
	if err != nil || u.Path == "" {
		return "/"
	}
	return u.Path
}

func secureReq(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}

// safeNext 只允许站内路径，防止登录后被跳到别的网站
func safeNext(next string) string {
	if next == "" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") || strings.Contains(next, "\\") {
		return "/me"
	}
	return next
}

func (a *App) handleAuthInfo(w http.ResponseWriter, r *http.Request, u string) {
	writeJSONResp(w, 200, map[string]any{"github": a.github.ok()})
}

func (a *App) handleGithubStart(w http.ResponseWriter, r *http.Request) {
	if !a.github.ok() {
		fail(w, 503, "没有配置 GitHub 登录")
		return
	}
	state := randToken(18)
	next := safeNext(r.URL.Query().Get("next"))
	http.SetCookie(w, &http.Cookie{Name: "gkb_oauth", Value: state + "|" + url.QueryEscape(next), Path: "/", MaxAge: 600,
		HttpOnly: true, Secure: secureReq(r), SameSite: http.SameSiteLaxMode})
	q := url.Values{"client_id": {a.github.ID}, "redirect_uri": {a.github.Public + "/api/auth/github/callback"},
		"state": {state}, "allow_signup": {"true"}}
	http.Redirect(w, r, ghAuthorizeURL+"?"+q.Encode(), http.StatusFound)
}

func (a *App) handleGithubCallback(w http.ResponseWriter, r *http.Request) {
	base := strings.TrimRight(a.github.basePath(), "/")
	back := func(next, errMsg string) {
		if errMsg != "" {
			next = "/me?login_error=" + url.QueryEscape(errMsg)
		}
		http.Redirect(w, r, base+next, http.StatusFound)
	}
	c, err := r.Cookie("gkb_oauth")
	http.SetCookie(w, &http.Cookie{Name: "gkb_oauth", Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	if err != nil {
		back("", "登录超时了，再点一次「用 GitHub 登录」")
		return
	}
	state, nextEsc, _ := strings.Cut(c.Value, "|")
	next, _ := url.QueryUnescape(nextEsc)
	if r.URL.Query().Get("error") != "" {
		back("", "在 GitHub 上取消了授权")
		return
	}
	if state == "" || r.URL.Query().Get("state") != state {
		back("", "登录校验没通过，再试一次")
		return
	}
	gh, err := a.githubUser(r.URL.Query().Get("code"))
	if err != nil {
		back("", "GitHub 登录失败："+err.Error())
		return
	}
	user, err := a.store.upsertGithubUser(gh)
	if err != nil {
		back("", "建账号失败："+err.Error())
		return
	}
	tok, err := a.store.issueToken(user, "session", "网页登录", sessionDays*24*time.Hour)
	if err != nil {
		back("", "登录失败："+err.Error())
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "gkb_token", Value: tok, HttpOnly: true, Secure: secureReq(r),
		SameSite: http.SameSiteLaxMode, MaxAge: sessionDays * 86400, Path: "/"})
	back(safeNext(next), "")
}

type githubProfile struct {
	ID     int64  `json:"id"`
	Login  string `json:"login"`
	Name   string `json:"name"`
	Avatar string `json:"avatar_url"`
}

var ghClient = &http.Client{Timeout: 15 * time.Second}

// 测试时换成假的 GitHub
var (
	ghAuthorizeURL = "https://github.com/login/oauth/authorize"
	ghTokenURL     = "https://github.com/login/oauth/access_token"
	ghUserURL      = "https://api.github.com/user"
)

func (a *App) githubUser(code string) (*githubProfile, error) {
	if code == "" {
		return nil, fmt.Errorf("没有拿到授权码")
	}
	form := url.Values{"client_id": {a.github.ID}, "client_secret": {a.github.Secret}, "code": {code},
		"redirect_uri": {a.github.Public + "/api/auth/github/callback"}}
	req, _ := http.NewRequest("POST", ghTokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := ghClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("连不上 GitHub")
	}
	defer resp.Body.Close()
	var tk struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if json.NewDecoder(resp.Body).Decode(&tk) != nil || tk.AccessToken == "" {
		return nil, fmt.Errorf("换令牌失败 %s", tk.Error)
	}
	req, _ = http.NewRequest("GET", ghUserURL, nil)
	req.Header.Set("Authorization", "Bearer "+tk.AccessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp2, err := ghClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("连不上 GitHub")
	}
	defer resp2.Body.Close()
	var p githubProfile
	if resp2.StatusCode != 200 || json.NewDecoder(resp2.Body).Decode(&p) != nil || p.ID == 0 {
		return nil, fmt.Errorf("读不到 GitHub 用户信息")
	}
	return &p, nil
}

// upsertGithubUser GitHub 账号 -> 本站用户名；第一次来就建一个
func (s *Store) upsertGithubUser(p *githubProfile) (string, error) {
	tokMu.Lock()
	defer tokMu.Unlock()
	users := map[string]UserInfo{}
	_ = readJSON(s.usersPath(), &users)
	id := fmt.Sprint(p.ID)
	u, ok := users[id]
	if !ok || u.User == "" {
		taken := map[string]bool{}
		for _, x := range users {
			taken[x.User] = true
		}
		for _, t := range s.loadTokens() {
			taken[t.User] = true
		}
		name := slug(strings.ToLower(p.Login))
		if name == "" {
			name = "gh-" + id
		}
		if taken[name] {
			name += "-gh"
		}
		for i := 2; taken[name]; i++ {
			name = fmt.Sprintf("%s-gh%d", slug(strings.ToLower(p.Login)), i)
		}
		u = UserInfo{User: name, Created: now()}
	}
	if u.Created == "" {
		u.Created = now()
	}
	u.Login, u.Name, u.Avatar, u.Last = p.Login, p.Name, p.Avatar, now()
	users[id] = u
	if err := os.MkdirAll(filepath.Dir(s.usersPath()), 0o700); err != nil {
		return "", err
	}
	return u.User, writeJSON(s.usersPath(), users, 0o600)
}

func (s *Store) userProfile(user string) *UserInfo {
	users := map[string]UserInfo{}
	_ = readJSON(s.usersPath(), &users)
	for _, u := range users {
		if u.User == user && u.Login != "" {
			u := u
			return &u
		}
	}
	return nil
}

// ---------------------------------------------------------------- 命令行令牌

func (a *App) handleMyTokens(w http.ResponseWriter, r *http.Request, u string) {
	out := []map[string]any{}
	for h, t := range a.store.loadTokens() {
		if t.User == u && t.Kind != "session" {
			out = append(out, map[string]any{"id": h[:12], "name": t.Name, "kind": t.Kind, "created": t.Created})
		}
	}
	writeJSONResp(w, 200, out)
}

func (a *App) handleNewToken(w http.ResponseWriter, r *http.Request, u string) {
	var body struct {
		Name string `json:"name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	name := strings.TrimSpace(body.Name)
	if len([]rune(name)) > 40 {
		name = string([]rune(name)[:40])
	}
	if name == "" {
		name = "命令行"
	}
	n := 0
	for _, t := range a.store.loadTokens() {
		if t.User == u && t.Kind == "cli" {
			n++
		}
	}
	if n >= maxCLITokens {
		fail(w, 400, fmt.Sprintf("命令行令牌最多 %d 个，先吊销不用的", maxCLITokens))
		return
	}
	tok, err := a.store.issueToken(u, "cli", name, 0)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSONResp(w, 200, map[string]any{"token": tok, "id": hashToken(tok)[:12], "name": name})
}

func (a *App) handleRevokeToken(w http.ResponseWriter, r *http.Request, u string) {
	id := r.PathValue("id")
	for h, t := range a.store.loadTokens() {
		if strings.HasPrefix(h, id) && len(id) >= 12 && t.User == u && t.Kind != "session" {
			if err := a.store.revokeToken(h); err != nil {
				fail(w, 500, err.Error())
				return
			}
			writeJSONResp(w, 200, map[string]any{"ok": true})
			return
		}
	}
	fail(w, 404, "没有这个令牌")
}

// handleLogout 网页退出：清 cookie，网页登录令牌一起作废（命令行令牌不动）
func (a *App) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("gkb_token"); err == nil && c.Value != "" {
		h := hashToken(c.Value)
		if t, ok := a.store.loadTokens()[h]; ok && t.Kind == "session" {
			_ = a.store.revokeToken(h)
		}
	}
	http.SetCookie(w, &http.Cookie{Name: "gkb_token", Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	writeJSONResp(w, 200, map[string]any{"ok": true})
}
