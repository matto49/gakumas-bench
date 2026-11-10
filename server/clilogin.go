package main

// 命令行登录：gkbench login 借浏览器里已有的登录状态拿一个命令行令牌，不用手抄令牌。
//
//	POST /api/cli/login {host}             命令行来要一次登录：返回 code（给人核对的短码）、device（只有这台命令行知道的密钥）、url
//	GET  /api/cli/login/{code}             网页查这次登录：哪台机器、什么时候要的、状态（不含密钥）
//	POST /api/cli/login/{code}/approve     网页上已登录的人点「授权」
//	POST /api/cli/login/token {device}     命令行轮询：没批是 202 pending；批了就发令牌（只发这一次）；过期 410
//
// 一次登录 10 分钟内有效，只存在内存里（服务器重启就作废，重新 gkbench login 即可）。
// 发的是普通命令行令牌（kind cli），在「我的」页能看到、能吊销。

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	cliLoginTTL     = 10 * time.Minute
	cliLoginMax     = 500 // 同时挂着的登录请求上限
	cliLoginPerIP   = 10  // 同一 IP 同时挂着的上限
	cliCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
)

type cliLogin struct {
	Code    string
	Device  string
	Host    string
	IP      string
	Created time.Time
	User    string // 批准的人；空 = 还没批
}

var (
	cliMu     sync.Mutex
	cliLogins = map[string]*cliLogin{} // code -> 登录请求
)

func cliCode() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	out := make([]byte, 0, 9)
	for i := 0; i < 8; i++ {
		if i == 4 {
			out = append(out, '-')
		}
		out = append(out, cliCodeAlphabet[int(b[i])%len(cliCodeAlphabet)])
	}
	return string(out)
}

// 调用方要先拿 cliMu
func cliSweep() {
	for k, l := range cliLogins {
		if time.Since(l.Created) > cliLoginTTL {
			delete(cliLogins, k)
		}
	}
}

func (a *App) handleCLILoginStart(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Host string `json:"host"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&b)
	ip := clientIP(r)
	cliMu.Lock()
	defer cliMu.Unlock()
	cliSweep()
	n := 0
	for _, l := range cliLogins {
		if l.IP == ip {
			n++
		}
	}
	if len(cliLogins) >= cliLoginMax || n >= cliLoginPerIP {
		fail(w, 429, "登录请求太多，过几分钟再试")
		return
	}
	l := &cliLogin{Code: cliCode(), Device: randToken(24), Host: trimRunes(strings.TrimSpace(b.Host), 40), IP: ip, Created: time.Now()}
	for cliLogins[l.Code] != nil {
		l.Code = cliCode()
	}
	cliLogins[l.Code] = l
	base := strings.TrimRight(env("GKBENCH_PUBLIC_URL", "https://hiro.matto.top/gkbench"), "/")
	writeJSONResp(w, 200, map[string]any{"code": l.Code, "device": l.Device, "url": base + "/cli-login?code=" + l.Code,
		"expires_in": int(cliLoginTTL.Seconds()), "interval": 2})
}

func (a *App) handleCLILoginInfo(w http.ResponseWriter, r *http.Request, u string) {
	cliMu.Lock()
	defer cliMu.Unlock()
	cliSweep()
	l := cliLogins[strings.ToUpper(r.PathValue("code"))]
	if l == nil {
		fail(w, 404, "没有这次登录，或者已经过期（10 分钟）。回终端重新运行 gkbench login")
		return
	}
	status := "pending"
	if l.User != "" {
		status = "approved"
	}
	writeJSONResp(w, 200, map[string]any{"code": l.Code, "host": l.Host, "created": l.Created.UTC().Format(time.RFC3339),
		"status": status, "user": u})
}

func (a *App) handleCLILoginApprove(w http.ResponseWriter, r *http.Request, u string) {
	cliMu.Lock()
	defer cliMu.Unlock()
	cliSweep()
	l := cliLogins[strings.ToUpper(r.PathValue("code"))]
	if l == nil {
		fail(w, 404, "没有这次登录，或者已经过期（10 分钟）。回终端重新运行 gkbench login")
		return
	}
	if l.User != "" && l.User != u {
		fail(w, 409, "这次登录已经被别的账号授权了")
		return
	}
	l.User = u
	writeJSONResp(w, 200, map[string]any{"ok": true, "user": u})
}

func (a *App) handleCLILoginToken(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Device string `json:"device"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&b)
	cliMu.Lock()
	cliSweep()
	var l *cliLogin
	for _, x := range cliLogins {
		if b.Device != "" && x.Device == b.Device {
			l = x
		}
	}
	if l == nil {
		cliMu.Unlock()
		fail(w, 410, "这次登录过期了，重新运行 gkbench login")
		return
	}
	if l.User == "" {
		cliMu.Unlock()
		writeJSONResp(w, 202, map[string]any{"status": "pending"})
		return
	}
	user, host := l.User, l.Host
	delete(cliLogins, l.Code) // 令牌只发一次
	cliMu.Unlock()

	n := 0
	for _, t := range a.store.loadTokens() {
		if t.User == user && t.Kind == "cli" {
			n++
		}
	}
	if n >= maxCLITokens {
		fail(w, 400, fmt.Sprintf("命令行令牌最多 %d 个，先到网页「我的」页吊销不用的，再重新 gkbench login", maxCLITokens))
		return
	}
	name := "gkbench login"
	if host != "" {
		name += "（" + host + "）"
	}
	tok, err := a.store.issueToken(user, "cli", name, 0)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSONResp(w, 200, map[string]any{"status": "approved", "token": tok, "user": user})
}
