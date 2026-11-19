package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// 出牌助手接口（assist.go）：用假的引擎子进程测会话登记、上限、限流、回收、子进程重启作废、开局超时。

type fakeAssistWorker struct {
	mu    sync.Mutex
	epoch int64
	calls []map[string]any
	delay time.Duration
	fail  string // 非空：所有调用都回这个引擎错误
}

func (f *fakeAssistWorker) Call(req map[string]any) (map[string]any, int64, error) {
	if f.delay > 0 {
		time.Sleep(f.delay)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, req)
	if f.fail != "" {
		return map[string]any{"ok": false, "error": f.fail}, f.epoch, fmt.Errorf("%w：%s", errEngine, f.fail)
	}
	if req["op"] == "assist_close" {
		return map[string]any{"ok": true}, f.epoch, nil
	}
	return map[string]any{"ok": true, "view": map[string]any{"op": req["op"]}}, f.epoch, nil
}

func (f *fakeAssistWorker) ops() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, c := range f.calls {
		out = append(out, fmt.Sprint(c["op"]))
	}
	return out
}

func assistApp(t *testing.T) (*App, http.Handler, *fakeAssistWorker) {
	t.Helper()
	app, h, _ := routesApp(t)
	fw := &fakeAssistWorker{epoch: 1}
	app.assistPick = func() assistCaller { return fw }
	return app, h, fw
}

var ipSeq int

func doAssist(h http.Handler, method, path, body, ip string) *httptest.ResponseRecorder {
	if ip == "" {
		ipSeq++
		ip = fmt.Sprintf("10.0.0.%d", ipSeq%250+1)
	}
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("X-Real-IP", ip)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func openAssist(t *testing.T, h http.Handler) string {
	t.Helper()
	w := doAssist(h, "POST", "/api/assist/sessions", `{"loadout":{"schema":"gkms.hif_loadout.v1"},"practice":true}`, "")
	if w.Code != 200 {
		t.Fatalf("开局：%d %s", w.Code, w.Body.String())
	}
	var j struct {
		Session string         `json:"session"`
		View    map[string]any `json:"view"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &j)
	if j.Session == "" || j.View["op"] != "assist_open" {
		t.Fatalf("开局回复不对：%s", w.Body.String())
	}
	return j.Session
}

func TestAssistOpenAndSteps(t *testing.T) {
	_, h, fw := assistApp(t)
	id := openAssist(t, h)
	for _, c := range []struct{ method, path, body, op string }{
		{"POST", "/hand", `{"cards":[["p_card-x",0]]}`, "assist_hand"},
		{"POST", "/numbers", `{"score":1}`, "assist_numbers"},
		{"POST", "/step", `{"action":["end"]}`, "assist_step"},
		{"POST", "/undo", `{}`, "assist_undo"},
	} {
		w := doAssist(h, c.method, "/api/assist/sessions/"+id+c.path, c.body, "")
		if w.Code != 200 || !strings.Contains(w.Body.String(), c.op) {
			t.Fatalf("%s：%d %s", c.path, w.Code, w.Body.String())
		}
	}
	if w := doAssist(h, "DELETE", "/api/assist/sessions/"+id, "", ""); w.Code != 200 {
		t.Fatalf("结束：%d", w.Code)
	}
	if got := fw.ops(); got[len(got)-1] != "assist_close" {
		t.Fatalf("结束要通知子进程：%v", got)
	}
	if w := doAssist(h, "POST", "/api/assist/sessions/"+id+"/undo", `{}`, ""); w.Code != 404 {
		t.Fatalf("结束后再用要 404：%d", w.Code)
	}
}

func TestAssistNeedsLoadoutOrCode(t *testing.T) {
	_, h, _ := assistApp(t)
	if w := doAssist(h, "POST", "/api/assist/sessions", `{"practice":true}`, ""); w.Code != 400 {
		t.Fatalf("没编成也没码要 400：%d", w.Code)
	}
}

func TestAssistEngineErrorPassedThrough(t *testing.T) {
	_, h, fw := assistApp(t)
	fw.fail = "卡组最多 60 个"
	w := doAssist(h, "POST", "/api/assist/sessions", `{"loadout":{}}`, "")
	if w.Code != 400 || !strings.Contains(w.Body.String(), "卡组最多 60 个") || strings.Contains(w.Body.String(), "引擎错误") {
		t.Fatalf("访客错误原样给出：%d %s", w.Code, w.Body.String())
	}
}

func TestAssistSessionCap(t *testing.T) {
	_, h, _ := assistApp(t)
	for i := 0; i < maxAssists; i++ {
		openAssist(t, h)
	}
	if w := doAssist(h, "POST", "/api/assist/sessions", `{"loadout":{}}`, ""); w.Code != 503 {
		t.Fatalf("超过全站上限要 503：%d", w.Code)
	}
}

func TestAssistRateLimitPerIP(t *testing.T) {
	_, h, _ := assistApp(t)
	codes := []int{}
	for i := 0; i < assistPerSecond+1; i++ {
		codes = append(codes, doAssist(h, "POST", "/api/assist/sessions/nope/undo", `{}`, "192.0.2.9").Code)
	}
	if codes[assistPerSecond] != 429 || codes[0] == 429 {
		t.Fatalf("同 IP 每秒超过 %d 个要 429：%v", assistPerSecond, codes)
	}
	if w := doAssist(h, "POST", "/api/assist/sessions/nope/undo", `{}`, "192.0.2.10"); w.Code == 429 {
		t.Fatal("别的 IP 不受影响")
	}
}

func TestAssistIdleReclaimed(t *testing.T) {
	app, h, fw := assistApp(t)
	id := openAssist(t, h)
	app.assistMu.Lock()
	app.assists[id].Touched = time.Now().Add(-assistTTL - time.Minute)
	app.assistMu.Unlock()
	openAssist(t, h) // 任何开局都会顺手回收
	if w := doAssist(h, "POST", "/api/assist/sessions/"+id+"/undo", `{}`, ""); w.Code != 404 {
		t.Fatalf("闲置过久要回收：%d", w.Code)
	}
	time.Sleep(50 * time.Millisecond) // 回收时通知子进程是异步的
	closed := false
	for _, op := range fw.ops() {
		closed = closed || op == "assist_close"
	}
	if !closed {
		t.Fatal("回收要通知子进程丢掉这局")
	}
}

func TestAssistWorkerRestartInvalidates(t *testing.T) {
	_, h, fw := assistApp(t)
	id := openAssist(t, h)
	fw.mu.Lock()
	fw.epoch++
	fw.mu.Unlock()
	w := doAssist(h, "POST", "/api/assist/sessions/"+id+"/undo", `{}`, "")
	if w.Code != 410 || !strings.Contains(w.Body.String(), "重开") {
		t.Fatalf("子进程重启过要 410 并提示重开：%d %s", w.Code, w.Body.String())
	}
	if w := doAssist(h, "POST", "/api/assist/sessions/"+id+"/undo", `{}`, ""); w.Code != 404 {
		t.Fatalf("作废的会话要删掉：%d", w.Code)
	}
}

func TestAssistOpenTimeout(t *testing.T) {
	_, h, fw := assistApp(t)
	old := assistOpenTimeout
	assistOpenTimeout = 30 * time.Millisecond
	defer func() { assistOpenTimeout = old }()
	fw.delay = 200 * time.Millisecond
	w := doAssist(h, "POST", "/api/assist/sessions", `{"loadout":{}}`, "")
	if w.Code != 504 {
		t.Fatalf("开局超时要 504：%d", w.Code)
	}
}

func TestAssistBodyTooLarge(t *testing.T) {
	_, h, _ := assistApp(t)
	big := `{"code":"` + strings.Repeat("A", 300<<10) + `"}`
	if w := doAssist(h, "POST", "/api/assist/sessions", big, ""); w.Code != 413 && w.Code != 400 {
		t.Fatalf("超大请求要拒：%d", w.Code)
	}
}

func TestAssistPerIPCapEvictsOldest(t *testing.T) {
	app, h, fw := assistApp(t)
	open := func() string {
		w := doAssist(h, "POST", "/api/assist/sessions", `{"loadout":{}}`, "198.51.100.7")
		if w.Code != 200 {
			t.Fatalf("开局：%d %s", w.Code, w.Body.String())
		}
		var j struct{ Session string }
		_ = json.Unmarshal(w.Body.Bytes(), &j)
		return j.Session
	}
	first := open()
	for i := 1; i < maxAssistsPerIP+1; i++ {
		time.Sleep(time.Millisecond) // 区分先后
		assistLimit.mu.Lock()        // 这里只测会话数，不测每秒限流
		assistLimit.hits = nil
		assistLimit.mu.Unlock()
		open()
	}
	if w := doAssist(h, "POST", "/api/assist/sessions/"+first+"/undo", `{}`, "198.51.100.7"); w.Code != 404 {
		t.Fatalf("同一 IP 超过 %d 局要关掉它最早的那局：%d", maxAssistsPerIP, w.Code)
	}
	n := 0
	app.assistMu.Lock()
	for _, s := range app.assists {
		if s.IP == "198.51.100.7" {
			n++
		}
	}
	app.assistMu.Unlock()
	if n != maxAssistsPerIP {
		t.Fatalf("同一 IP 留 %d 局，实际 %d", maxAssistsPerIP, n)
	}
	time.Sleep(50 * time.Millisecond)
	closed := false
	fw.mu.Lock()
	for _, c := range fw.calls {
		closed = closed || (c["op"] == "assist_close" && c["sid"] == first)
	}
	fw.mu.Unlock()
	if !closed {
		t.Fatal("被挤掉的那局要通知子进程丢掉")
	}
}
