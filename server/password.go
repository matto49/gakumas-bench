package main

// 用户名 + 密码账号：给没有 GitHub 的玩家用。没有邮箱，忘了密码找不回（管理员可以在 accounts.json 里删掉密码让他重设）。
//
//	$DATA/private/accounts.json  {"<用户名>": {hash, created, changed}}   bcrypt 哈希，600
//
//	POST /api/auth/register  {user, password}   注册并登录
//	POST /api/auth/login     {user, password}   登录
//	POST /api/me/password    {old?, password}   设置 / 修改密码（GitHub 账号也能设，之后两种都能登录）
//
// 防刷：同一 IP 每小时最多注册 5 个；同一 IP + 用户名 15 分钟内输错 8 次就要等。

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

const (
	minPassword     = 8
	maxPassword     = 72 // bcrypt 只看前 72 字节
	registerPerHour = 5
	loginFailMax    = 8
	loginFailWindow = 15 * time.Minute
)

// 用户不存在时拿它比对，让「用户不存在」和「密码错」花的时间一样
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("gkbench-dummy-password"), bcrypt.DefaultCost)

var userNameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{2,23}$`)

// 不能注册的名字：容易冒充管理员或和系统用语混淆
var reservedNames = map[string]bool{"admin": true, "root": true, "system": true, "oracle": true, "gkbench": true,
	"gkms": true, "anon": true, "guest": true, "null": true, "undefined": true, "api": true, "me": true}

type Account struct {
	Hash    string `json:"hash"`
	Created string `json:"created"`
	Changed string `json:"changed,omitempty"`
}

func (s *Store) accountsPath() string { return filepath.Join(s.Data, "private", "accounts.json") }

func (s *Store) loadAccounts() map[string]Account {
	m := map[string]Account{}
	_ = readJSON(s.accountsPath(), &m)
	return m
}

func (s *Store) saveAccounts(m map[string]Account) error {
	if err := os.MkdirAll(filepath.Dir(s.accountsPath()), 0o700); err != nil {
		return err
	}
	return writeJSON(s.accountsPath(), m, 0o600)
}

// nameTaken 用户名是否已经被任何来源占用（密码账号、GitHub 账号、令牌）。调用方持有 tokMu
func (s *Store) nameTaken(name string) bool {
	if _, ok := s.loadAccounts()[name]; ok {
		return true
	}
	users := map[string]UserInfo{}
	_ = readJSON(s.usersPath(), &users)
	for _, u := range users {
		if u.User == name {
			return true
		}
	}
	for _, t := range s.loadTokens() {
		if t.User == name {
			return true
		}
	}
	return false
}

func checkPassword(pw string) string {
	switch {
	case utf8.RuneCountInString(pw) < minPassword:
		return "密码至少 8 位"
	case len(pw) > maxPassword:
		return "密码太长（最多 72 个字节）"
	}
	return ""
}

// ---------------------------------------------------------------- 限流

type limiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

func (l *limiter) count(key string, window time.Duration) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.hits == nil {
		l.hits = map[string][]time.Time{}
	}
	cut := time.Now().Add(-window)
	xs := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cut) {
			xs = append(xs, t)
		}
	}
	l.hits[key] = xs
	return len(xs)
}

func (l *limiter) add(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.hits == nil {
		l.hits = map[string][]time.Time{}
	}
	l.hits[key] = append(l.hits[key], time.Now())
}

func (l *limiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.hits, key)
}

var (
	registerLimit limiter
	loginLimit    limiter
)

// clientIP nginx 传过来的真实 IP；直连时用连接地址
func clientIP(r *http.Request) string {
	if ip := strings.TrimSpace(r.Header.Get("X-Real-IP")); ip != "" {
		return ip
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// ---------------------------------------------------------------- 接口

type credBody struct {
	User     string `json:"user"`
	Password string `json:"password"`
	Old      string `json:"old"`
}

func (a *App) startSession(w http.ResponseWriter, r *http.Request, user string) bool {
	tok, err := a.store.issueToken(user, "session", "网页登录", sessionDays*24*time.Hour)
	if err != nil {
		fail(w, 500, err.Error())
		return false
	}
	http.SetCookie(w, &http.Cookie{Name: "gkb_token", Value: tok, HttpOnly: true, Secure: secureReq(r),
		SameSite: http.SameSiteLaxMode, MaxAge: sessionDays * 86400, Path: "/"})
	return true
}

func (a *App) handleRegister(w http.ResponseWriter, r *http.Request) {
	var b credBody
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&b) != nil {
		fail(w, 400, "请求体不是 JSON")
		return
	}
	name := strings.ToLower(strings.TrimSpace(b.User))
	if !userNameRe.MatchString(name) {
		fail(w, 400, "用户名 3–24 位，只能用小写字母、数字、_ 和 -，以字母或数字开头")
		return
	}
	if reservedNames[name] {
		fail(w, 400, "这个用户名不能用")
		return
	}
	if msg := checkPassword(b.Password); msg != "" {
		fail(w, 400, msg)
		return
	}
	ip := clientIP(r)
	if registerLimit.count(ip, time.Hour) >= registerPerHour {
		fail(w, 429, "注册太频繁，过一小时再试")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(b.Password), bcrypt.DefaultCost)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	tokMu.Lock()
	if a.store.nameTaken(name) {
		tokMu.Unlock()
		fail(w, 409, "用户名已经有人用了")
		return
	}
	acc := a.store.loadAccounts()
	acc[name] = Account{Hash: string(hash), Created: now()}
	err = a.store.saveAccounts(acc)
	tokMu.Unlock()
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	registerLimit.add(ip)
	if a.startSession(w, r, name) {
		writeJSONResp(w, 200, map[string]any{"user": name})
	}
}

func (a *App) handlePasswordLogin(w http.ResponseWriter, r *http.Request) {
	var b credBody
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&b) != nil {
		fail(w, 400, "请求体不是 JSON")
		return
	}
	name := strings.ToLower(strings.TrimSpace(b.User))
	key := clientIP(r) + "|" + name
	if loginLimit.count(key, loginFailWindow) >= loginFailMax {
		fail(w, 429, "输错次数太多，15 分钟后再试")
		return
	}
	acc, ok := a.store.loadAccounts()[name]
	// 用户不存在时也跑一次 bcrypt，响应时间不泄露用户名是否存在
	hash := []byte(acc.Hash)
	if !ok || acc.Hash == "" {
		hash = dummyHash
	}
	if bcrypt.CompareHashAndPassword(hash, []byte(b.Password)) != nil || !ok || acc.Hash == "" {
		loginLimit.add(key)
		fail(w, 401, "用户名或密码不对")
		return
	}
	loginLimit.reset(key)
	if a.startSession(w, r, name) {
		writeJSONResp(w, 200, map[string]any{"user": name})
	}
}

// handleSetPassword 已登录用户设置或修改密码；已经有密码的要先输对旧密码
func (a *App) handleSetPassword(w http.ResponseWriter, r *http.Request, u string) {
	var b credBody
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&b) != nil {
		fail(w, 400, "请求体不是 JSON")
		return
	}
	if msg := checkPassword(b.Password); msg != "" {
		fail(w, 400, msg)
		return
	}
	key := clientIP(r) + "|" + u
	if loginLimit.count(key, loginFailWindow) >= loginFailMax {
		fail(w, 429, "输错次数太多，15 分钟后再试")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(b.Password), bcrypt.DefaultCost)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	tokMu.Lock()
	defer tokMu.Unlock()
	acc := a.store.loadAccounts()
	cur, has := acc[u]
	if has && cur.Hash != "" && bcrypt.CompareHashAndPassword([]byte(cur.Hash), []byte(b.Old)) != nil {
		loginLimit.add(key)
		fail(w, 403, "旧密码不对")
		return
	}
	if !has {
		cur.Created = now()
	}
	cur.Hash, cur.Changed = string(hash), now()
	acc[u] = cur
	if err := a.store.saveAccounts(acc); err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSONResp(w, 200, map[string]any{"ok": true})
}

func (a *App) hasPassword(u string) bool {
	acc, ok := a.store.loadAccounts()[u]
	return ok && acc.Hash != ""
}
