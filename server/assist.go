package main

// 出牌助手（网页 /assist）：不用登录。一局开在某个引擎子进程里（gkbench/assist.py），之后的请求都转给它。
// 会话只在内存里，不落盘、不进排行。限制：全站最多 maxAssists 个，闲置 assistTTL 回收，同一 IP 每秒最多
// assistPerSecond 个请求，开局最多等 assistOpenTimeout；子进程重启过（纪元变了）的会话作废，回 410 让网页重开。

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	assistTTL       = 30 * time.Minute
	maxAssists      = 64
	assistPerSecond = 5
	assistMaxBody   = 256 << 10
)

var assistOpenTimeout = 10 * time.Second

// assistCaller 引擎子进程（*Worker）；测试里换成假的
type assistCaller interface {
	Call(req map[string]any) (map[string]any, int64, error)
}

type AssistSession struct {
	ID      string
	W       assistCaller
	Epoch   int64
	Touched time.Time
	mu      sync.Mutex // 同一局的请求排队
}

var assistLimit limiter

func (a *App) assistWorker() assistCaller {
	if a.assistPick != nil {
		return a.assistPick()
	}
	return a.pool.Pick()
}

// gcAssists 回收闲置的会话（调用时持有 assistMu）
func (a *App) gcAssists() {
	for id, s := range a.assists {
		if time.Since(s.Touched) > assistTTL {
			go s.W.Call(map[string]any{"op": "assist_close", "sid": id})
			delete(a.assists, id)
		}
	}
}

// assistLimitMW 同一 IP 每秒最多 assistPerSecond 个请求
func assistLimitMW(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if assistLimit.count(ip, time.Second) >= assistPerSecond {
			fail(w, 429, "点得太快了，稍等一下")
			return
		}
		assistLimit.add(ip)
		r.Body = http.MaxBytesReader(w, r.Body, assistMaxBody)
		next(w, r)
	}
}

// engineMessage 引擎回的访客能看懂的那句话
func engineMessage(rep map[string]any, err error) string {
	if msg, ok := rep["error"].(string); ok && msg != "" {
		return msg
	}
	return err.Error()
}

func (a *App) handleAssistOpen(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Loadout  map[string]any `json:"loadout"`
		Code     string         `json:"code"`
		Practice bool           `json:"practice"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			fail(w, 413, "请求太大了")
			return
		}
		fail(w, 400, "请求体不是 JSON")
		return
	}
	if body.Loadout == nil && strings.TrimSpace(body.Code) == "" {
		fail(w, 400, "要给编成或者编成码")
		return
	}
	a.assistMu.Lock()
	if a.assists == nil {
		a.assists = map[string]*AssistSession{}
	}
	a.gcAssists()
	full := len(a.assists) >= maxAssists
	a.assistMu.Unlock()
	if full {
		fail(w, 503, "现在用出牌助手的人太多了，过几分钟再试")
		return
	}
	s := &AssistSession{ID: newID(16), W: a.assistWorker(), Touched: time.Now()}
	req := map[string]any{"op": "assist_open", "sid": s.ID, "practice": body.Practice}
	if body.Code != "" {
		req["code"] = body.Code
	} else {
		req["loadout"] = body.Loadout
	}
	type result struct {
		rep   map[string]any
		epoch int64
		err   error
	}
	done := make(chan result, 1)
	go func() {
		rep, epoch, err := s.W.Call(req)
		done <- result{rep, epoch, err}
	}()
	select {
	case res := <-done:
		if res.err != nil {
			if errors.Is(res.err, errEngine) {
				fail(w, 400, engineMessage(res.rep, res.err))
			} else {
				fail(w, 502, "引擎出错了，稍后再试")
			}
			return
		}
		s.Epoch = res.epoch
		a.assistMu.Lock()
		a.assists[s.ID] = s
		a.assistMu.Unlock()
		writeJSONResp(w, 200, map[string]any{"session": s.ID, "view": res.rep["view"]})
	case <-time.After(assistOpenTimeout):
		go func() { // 开局最后做完了也丢掉
			<-done
			s.W.Call(map[string]any{"op": "assist_close", "sid": s.ID})
		}()
		fail(w, 504, "开局超时了，换一份编成或稍后再试")
	}
}

func (a *App) assistOf(w http.ResponseWriter, r *http.Request) *AssistSession {
	a.assistMu.Lock()
	defer a.assistMu.Unlock()
	if a.assists == nil {
		a.assists = map[string]*AssistSession{}
	}
	a.gcAssists()
	s := a.assists[r.PathValue("id")]
	if s == nil {
		fail(w, 404, "这局已经结束了（闲置太久会自动结束），回编成重开")
		return nil
	}
	s.Touched = time.Now()
	return s
}

// assistCall 把一个操作转给这局所在的子进程，回 {view}
func (a *App) assistCall(op string, fields func(map[string]any) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s := a.assistOf(w, r)
		if s == nil {
			return
		}
		req := map[string]any{"op": op, "sid": s.ID}
		if fields != nil {
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				fail(w, 400, "请求体不是 JSON")
				return
			}
			for k, v := range body {
				if k != "op" && k != "sid" && k != "rid" {
					req[k] = v
				}
			}
		}
		s.mu.Lock()
		rep, epoch, err := s.W.Call(req)
		s.mu.Unlock()
		if epoch != s.Epoch {
			a.dropAssist(s.ID)
			fail(w, 410, "对局断了（服务器的引擎重启过），编成还在本机，点重开")
			return
		}
		if err != nil {
			if errors.Is(err, errEngine) {
				fail(w, 400, engineMessage(rep, err))
			} else {
				a.dropAssist(s.ID)
				fail(w, 410, "对局断了，编成还在本机，点重开")
			}
			return
		}
		writeJSONResp(w, 200, map[string]any{"view": rep["view"]})
	}
}

func (a *App) dropAssist(id string) {
	a.assistMu.Lock()
	delete(a.assists, id)
	a.assistMu.Unlock()
}

func (a *App) handleAssistClose(w http.ResponseWriter, r *http.Request) {
	s := a.assistOf(w, r)
	if s == nil {
		return
	}
	a.dropAssist(s.ID)
	s.mu.Lock()
	s.W.Call(map[string]any{"op": "assist_close", "sid": s.ID})
	s.mu.Unlock()
	writeJSONResp(w, 200, map[string]any{})
}

var withBody = func(map[string]any) error { return nil } // assistCall 的 fields：这个操作要读请求体
