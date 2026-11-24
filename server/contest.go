package main

// 竞技场（网页 /contest）。模拟用 GKMS 的竞技场模拟运行包：作者保留所有权利，不进本仓库，
// 放在服务器（和私有仓库）里，Go 只认包的根目录 GKBENCH_CONTEST_ROOT 和解释器 GKBENCH_CONTEST_PYTHON。
// 没配或读不到时竞技场接口一律 503，网站其他部分不受影响。
//
// 赛季接口只把网页要用的字段从包的 GKMSContest/master/contest.json 挑出来，不原样转发。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// ContestConf 竞技场模拟包的位置；Root 为空表示没装
type ContestConf struct {
	Root   string
	Python string
}

func (c ContestConf) ok() bool { return c.Root != "" && c.Python != "" }

const contestUnavailable = "竞技场模拟暂不可用"

type contestStage struct {
	StageType      string   `json:"stageType"`
	PlanType       string   `json:"planType"`
	Turn           int      `json:"turn"`
	ProduceItemIDs []string `json:"produceItemIds"`
	Vocal          int      `json:"vocal"`
	Dance          int      `json:"dance"`
	Visual         int      `json:"visual"`
}

type contestSeason struct {
	ID          string         `json:"id"`
	Description string         `json:"description"`
	Stages      []contestStage `json:"stages"`
}

type contestSeasons struct {
	Package string          `json:"package"`
	Seasons []contestSeason `json:"seasons"`
}

func seasonNumber(id string) int {
	n, _ := strconv.Atoi(id[strings.LastIndexByte(id, '-')+1:])
	return n
}

// loadContestSeasons 读包里的赛季表，只留白名单字段，赛季按编号从新到旧
func loadContestSeasons(root string) (*contestSeasons, error) {
	b, err := os.ReadFile(filepath.Join(root, "GKMSContest", "master", "contest.json"))
	if err != nil {
		return nil, err
	}
	var raw struct {
		PvpRateConfig []contestSeason `json:"PvpRateConfig"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, err
	}
	if len(raw.PvpRateConfig) == 0 {
		return nil, errors.New("contest.json 里没有赛季")
	}
	out := &contestSeasons{Seasons: raw.PvpRateConfig}
	for i := range out.Seasons {
		for j := range out.Seasons[i].Stages {
			if out.Seasons[i].Stages[j].ProduceItemIDs == nil {
				out.Seasons[i].Stages[j].ProduceItemIDs = []string{}
			}
		}
	}
	sort.SliceStable(out.Seasons, func(i, j int) bool {
		return seasonNumber(out.Seasons[i].ID) > seasonNumber(out.Seasons[j].ID)
	})
	if p, err := os.ReadFile(filepath.Join(root, "PACKAGE")); err == nil {
		out.Package = strings.TrimSpace(string(p))
	}
	return out, nil
}

// 赛季表按文件修改时间缓存（换包后自动重读）
var contestSeasonCache struct {
	sync.Mutex
	root string
	mod  time.Time
	val  *contestSeasons
}

func cachedContestSeasons(root string) (*contestSeasons, error) {
	st, err := os.Stat(filepath.Join(root, "GKMSContest", "master", "contest.json"))
	if err != nil {
		return nil, err
	}
	c := &contestSeasonCache
	c.Lock()
	defer c.Unlock()
	if c.val != nil && c.root == root && c.mod.Equal(st.ModTime()) {
		return c.val, nil
	}
	v, err := loadContestSeasons(root)
	if err != nil {
		return nil, err
	}
	c.root, c.mod, c.val = root, st.ModTime(), v
	return v, nil
}

func (a *App) handleContestSeasons(w http.ResponseWriter, r *http.Request) {
	if !a.contest.ok() {
		fail(w, 503, contestUnavailable)
		return
	}
	v, err := cachedContestSeasons(a.contest.Root)
	if err != nil {
		fail(w, 503, contestUnavailable)
		return
	}
	writeJSONResp(w, 200, v)
}

// ---------------------------------------------------------------- 模拟任务
//
// 一个任务 = 一个子进程跑包里的 GKMSContest/contest/worker.py（包的约定：竞技场不和 GakumasCLI 同进程）。
// 全站同时只跑 1 个，其余排队（最多 contestQueueMax 个）；同一 IP 同时最多 1 个，每分钟最多提交 contestPerMinute 个。
// 任务目录 $DATA/contest/jobs/<id>/：job.json、result.json、progress.jsonl、worker.log；结束时写 state.json。
// 访客只看到一句话的错误，详情在 worker.log。

const (
	contestQueueDefault = 20
	contestPerMinute    = 6
	contestMaxBody      = 64 << 10
	contestKeep         = 7 * 24 * time.Hour
	contestSeedDefault  = 20261012
)

var contestSubmitLimit limiter

type contestJob struct {
	ID      string
	IP      string
	Dir     string
	State   string // queued / running / done / failed / canceled
	Err     string
	cancel  context.CancelFunc
	created time.Time
}

func (a *App) contestJobsDir() string { return filepath.Join(a.store.Data, "contest", "jobs") }

func (a *App) contestTimeoutOr() time.Duration {
	if a.contestTimeout > 0 {
		return a.contestTimeout
	}
	return 120 * time.Second
}

func (a *App) contestQueueMaxOr() int {
	if a.contestQueueMax > 0 {
		return a.contestQueueMax
	}
	return contestQueueDefault
}

// defaultContestCmd 真的子进程：nice 10，2 个进程，工作目录是包根
func (a *App) defaultContestCmd(ctx context.Context, dir string) *exec.Cmd {
	c := exec.CommandContext(ctx, "nice", "-n", "10", a.contest.Python, "-B",
		filepath.Join(a.contest.Root, "GKMSContest", "contest", "worker.py"),
		filepath.Join(dir, "job.json"), filepath.Join(dir, "result.json"),
		"--workers", "2", "--progress", filepath.Join(dir, "progress.jsonl"))
	c.Dir = a.contest.Root
	c.Env = contestEnv()
	return c
}

// contestEnv 模拟子进程只拿基础环境：服务自己的 GKMS* 变量（考试引擎的 GKMSCLIGPU_LIB 会让模拟包加载错的原生库）
// 和 GKBENCH_* 里的密钥都不给第三方代码
func contestEnv() []string {
	keep := map[string]bool{"PATH": true, "HOME": true, "LANG": true, "LC_ALL": true, "LC_CTYPE": true, "TMPDIR": true, "TZ": true, "USER": true}
	out := []string{}
	for _, kv := range os.Environ() {
		if k, _, ok := strings.Cut(kv, "="); ok && keep[k] {
			out = append(out, kv)
		}
	}
	return out
}

var contestIDRe = regexp.MustCompile(`^[0-9a-f]{16,64}$`)

func (a *App) handleContestSubmit(w http.ResponseWriter, r *http.Request) {
	if !a.contest.ok() {
		fail(w, 503, contestUnavailable)
		return
	}
	seasons, err := cachedContestSeasons(a.contest.Root)
	if err != nil {
		fail(w, 503, contestUnavailable)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, contestMaxBody)
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		fail(w, 400, "请求体不是 JSON")
		return
	}
	job, err := validateContestJob(body, seasons)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	ip := clientIP(r)
	if contestSubmitLimit.count(ip, time.Minute) >= contestPerMinute {
		fail(w, 429, "提交得太频繁了，过一分钟再试")
		return
	}
	a.contestMu.Lock()
	if a.contestJobs == nil {
		a.contestJobs = map[string]*contestJob{}
	}
	for _, j := range a.contestJobs {
		if j.IP == ip && (j.State == "queued" || j.State == "running") {
			a.contestMu.Unlock()
			fail(w, 429, "你已经有一个模拟在跑了，等它结束或者先取消")
			return
		}
	}
	if len(a.contestQueue) >= a.contestQueueMaxOr() {
		a.contestMu.Unlock()
		fail(w, 429, "排队的人太多了，过几分钟再试")
		return
	}
	j := &contestJob{ID: newID(12), IP: ip, State: "queued", created: time.Now()}
	j.Dir = filepath.Join(a.contestJobsDir(), j.ID)
	if err := os.MkdirAll(j.Dir, 0o755); err != nil {
		a.contestMu.Unlock()
		fail(w, 500, "建不了任务目录")
		return
	}
	if err := writeJSON(filepath.Join(j.Dir, "job.json"), job, 0o644); err != nil {
		a.contestMu.Unlock()
		fail(w, 500, "写不了任务")
		return
	}
	contestSubmitLimit.add(ip)
	a.contestJobs[j.ID] = j
	a.contestQueue = append(a.contestQueue, j)
	pos := len(a.contestQueue)
	if a.contestRunning != nil {
		pos++
	}
	a.contestNextLocked()
	if j.State == "running" {
		pos = 0
	}
	a.contestMu.Unlock()
	writeJSONResp(w, 200, map[string]any{"id": j.ID, "position": pos})
}

// contestNextLocked 没有任务在跑时启动队首（调用时持有 contestMu）
func (a *App) contestNextLocked() {
	if a.contestRunning != nil || len(a.contestQueue) == 0 {
		return
	}
	j := a.contestQueue[0]
	a.contestQueue = a.contestQueue[1:]
	ctx, cancel := context.WithTimeout(context.Background(), a.contestTimeoutOr())
	j.cancel, j.State = cancel, "running"
	a.contestRunning = j
	mk := a.contestCmd
	if mk == nil {
		mk = a.defaultContestCmd
	}
	cmd := mk(ctx, j.Dir)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // 连同 worker 起的子进程一起杀
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = 2 * time.Second
	if logf, err := os.Create(filepath.Join(j.Dir, "worker.log")); err == nil {
		cmd.Stdout, cmd.Stderr = logf, logf
		defer func() { go func() { <-ctx.Done(); logf.Close() }() }()
	}
	if err := cmd.Start(); err != nil {
		log.Printf("竞技场任务 %s 起不来：%v", j.ID, err)
		a.contestFinishLocked(j, "failed", "模拟器启动失败，过一会再试")
		cancel()
		return
	}
	go func() {
		err := cmd.Wait()
		a.contestMu.Lock()
		defer a.contestMu.Unlock()
		switch {
		case j.State == "canceled":
			a.contestFinishLocked(j, "canceled", "已取消")
		case errors.Is(ctx.Err(), context.DeadlineExceeded):
			a.contestFinishLocked(j, "failed", "模拟超时了，少跑几局再试")
		case err != nil || !contestResultOK(j.Dir):
			log.Printf("竞技场任务 %s 失败：%v（详见 worker.log）", j.ID, err)
			a.contestFinishLocked(j, "failed", "模拟失败了，检查一下编成再试")
		default:
			a.contestFinishLocked(j, "done", "")
		}
		cancel()
	}()
}

// contestFinishLocked 任务结束：记状态、落盘、启动下一个（调用时持有 contestMu）
func (a *App) contestFinishLocked(j *contestJob, state, msg string) {
	j.State, j.Err = state, msg
	_ = writeJSON(filepath.Join(j.Dir, "state.json"), map[string]any{"state": state, "error": msg}, 0o644)
	if a.contestRunning == j {
		a.contestRunning = nil
	}
	a.contestNextLocked()
}

func contestResultOK(dir string) bool {
	b, err := os.ReadFile(filepath.Join(dir, "result.json"))
	if err != nil {
		return false
	}
	var v struct {
		OK *bool `json:"ok"`
	}
	if json.Unmarshal(b, &v) != nil {
		return false
	}
	return v.OK == nil || *v.OK
}

// lastProgress progress.jsonl 的最后一行
func lastProgress(dir string) json.RawMessage {
	b, err := os.ReadFile(filepath.Join(dir, "progress.jsonl"))
	if err != nil {
		return nil
	}
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	last := strings.TrimSpace(lines[len(lines)-1])
	if last == "" || !json.Valid([]byte(last)) {
		return nil
	}
	return json.RawMessage(last)
}

func (a *App) handleContestGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !contestIDRe.MatchString(id) {
		fail(w, 404, "没有这个模拟")
		return
	}
	a.contestMu.Lock()
	j := a.contestJobs[id]
	var state, msg, dir string
	pos := 0
	if j != nil {
		state, msg, dir = j.State, j.Err, j.Dir
		if state == "queued" {
			for i, q := range a.contestQueue {
				if q == j {
					pos = i + 1
					if a.contestRunning != nil {
						pos++
					}
				}
			}
		}
	}
	a.contestMu.Unlock()
	if j == nil { // 重启前的任务：看盘上的 state.json
		dir = filepath.Join(a.contestJobsDir(), id)
		b, err := os.ReadFile(filepath.Join(dir, "state.json"))
		if err != nil {
			fail(w, 404, "没有这个模拟")
			return
		}
		var st struct{ State, Error string }
		_ = json.Unmarshal(b, &st)
		state, msg = st.State, st.Error
	}
	out := map[string]any{"id": id, "state": state}
	switch state {
	case "queued":
		out["position"] = pos
	case "running":
		if p := lastProgress(dir); p != nil {
			out["progress"] = p
		}
	case "done":
		b, err := os.ReadFile(filepath.Join(dir, "result.json"))
		if err != nil || !json.Valid(b) {
			out["state"], out["error"] = "failed", "结果读不出来，请重新模拟"
			break
		}
		out["result"] = json.RawMessage(b)
	default:
		out["error"] = msg
	}
	writeJSONResp(w, 200, out)
}

func (a *App) handleContestCancel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	a.contestMu.Lock()
	defer a.contestMu.Unlock()
	j := a.contestJobs[id]
	if j == nil {
		fail(w, 404, "没有这个模拟")
		return
	}
	switch j.State {
	case "queued":
		for i, q := range a.contestQueue {
			if q == j {
				a.contestQueue = append(a.contestQueue[:i], a.contestQueue[i+1:]...)
				break
			}
		}
		j.State = "canceled"
		a.contestFinishLocked(j, "canceled", "已取消")
	case "running":
		j.State = "canceled" // Wait 返回后记成 canceled
		j.cancel()
	}
	writeJSONResp(w, 200, map[string]any{"ok": true})
}

// contestRecover 启动时：上次没结束的任务标失败；超过 contestKeep 的任务目录删掉
func (a *App) contestRecover() {
	ents, err := os.ReadDir(a.contestJobsDir())
	if err != nil {
		return
	}
	for _, e := range ents {
		dir := filepath.Join(a.contestJobsDir(), e.Name())
		if !e.IsDir() || !contestIDRe.MatchString(e.Name()) {
			continue
		}
		if info, err := e.Info(); err == nil && time.Since(info.ModTime()) > contestKeep {
			_ = os.RemoveAll(dir)
			continue
		}
		if _, err := os.Stat(filepath.Join(dir, "state.json")); os.IsNotExist(err) {
			_ = writeJSON(filepath.Join(dir, "state.json"), map[string]any{"state": "failed", "error": "服务重启了，请重新模拟"}, 0o644)
		}
	}
}

// ---------------------------------------------------------------- 校验
//
// 只收包「sim」任务认得的字段，数值卡范围，id 只收字母数字和 _-；job.json 由这里重新组装。

var contestIDField = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)

func intIn(v any, lo, hi int, name string) (int, error) {
	f, ok := v.(float64)
	if !ok || f != float64(int(f)) || int(f) < lo || int(f) > hi {
		return 0, fmt.Errorf("%s 要是 %d–%d 的整数", name, lo, hi)
	}
	return int(f), nil
}

func idField(v any, name string) (string, error) {
	s, ok := v.(string)
	if !ok || !contestIDField.MatchString(s) {
		return "", fmt.Errorf("%s 不对", name)
	}
	return s, nil
}

func vdv(v any, lo, hi int, name string) (map[string]any, error) {
	m, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s 要有 vocal、dance、visual", name)
	}
	out := map[string]any{}
	for _, k := range []string{"vocal", "dance", "visual"} {
		n, err := intIn(m[k], lo, hi, name+"."+k)
		if err != nil {
			return nil, err
		}
		out[k] = n
	}
	return out, nil
}

func contestCards(v any, name string) ([]any, error) {
	if v == nil {
		return []any{}, nil
	}
	xs, ok := v.([]any)
	if !ok || len(xs) > 6 {
		return nil, fmt.Errorf("%s 最多 6 张", name)
	}
	out := []any{}
	for _, x := range xs {
		m, ok := x.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%s 格式不对", name)
		}
		id, err := idField(m["id"], name+" 的卡")
		if err != nil {
			return nil, err
		}
		c := map[string]any{"id": id}
		if m["upgrade_count"] != nil {
			n, err := intIn(m["upgrade_count"], 0, 3, "强化次数")
			if err != nil {
				return nil, err
			}
			c["upgrade_count"] = n
		}
		if cs, ok := m["customizes"].([]any); ok && len(cs) > 0 {
			if len(cs) > 8 {
				return nil, fmt.Errorf("定制太多了")
			}
			var cus []any
			for _, x := range cs {
				cm, ok := x.(map[string]any)
				if !ok {
					return nil, fmt.Errorf("定制格式不对")
				}
				cid, err := idField(cm["id"], "定制")
				if err != nil {
					return nil, err
				}
				n, err := intIn(cm["customize_count"], 1, 5, "定制次数")
				if err != nil {
					return nil, err
				}
				cus = append(cus, map[string]any{"id": cid, "customize_count": n})
			}
			c["customizes"] = cus
		}
		out = append(out, c)
	}
	return out, nil
}

func validateContestJob(body map[string]any, seasons *contestSeasons) (map[string]any, error) {
	sid, err := idField(body["season_id"], "赛季")
	if err != nil {
		return nil, err
	}
	var season *contestSeason
	for i := range seasons.Seasons {
		if seasons.Seasons[i].ID == sid {
			season = &seasons.Seasons[i]
		}
	}
	if season == nil {
		return nil, errors.New("没有这个赛季")
	}
	stage, err := intIn(body["stage"], 0, len(season.Stages)-1, "舞台")
	if err != nil {
		return nil, err
	}
	runs, err := intIn(body["runs"], 10, 2000, "局数")
	if err != nil {
		return nil, err
	}
	support, err := intIn(body["support_permyriad"], 0, 2000, "支援加成（万分比）")
	if err != nil {
		return nil, err
	}
	seed := contestSeedDefault
	if body["seed_base"] != nil {
		if seed, err = intIn(body["seed_base"], 0, 1<<31-1, "seed_base"); err != nil {
			return nil, err
		}
	}
	lo, ok := body["loadout"].(map[string]any)
	if !ok {
		return nil, errors.New("缺编成")
	}
	idol, err := idField(lo["idol_card_id"], "偶像卡")
	if err != nil {
		return nil, err
	}
	params, err := vdv(lo["params"], 0, 6000, "参数")
	if err != nil {
		return nil, err
	}
	stamina, err := intIn(lo["stamina"], 1, 200, "体力")
	if err != nil {
		return nil, err
	}
	out := map[string]any{"idol_card_id": idol, "params": params, "stamina": stamina}
	if lo["bonus_permils"] != nil {
		b, err := vdv(lo["bonus_permils"], 0, 100000, "加成（千分比）")
		if err != nil {
			return nil, err
		}
		out["bonus_permils"] = b
	}
	items := []any{}
	if lo["items"] != nil {
		xs, ok := lo["items"].([]any)
		if !ok || len(xs) > 4 {
			return nil, errors.New("P 道具最多 4 个")
		}
		for _, x := range xs {
			id, err := idField(x, "P 道具")
			if err != nil {
				return nil, err
			}
			items = append(items, id)
		}
	}
	out["items"] = items
	if out["main_cards"], err = contestCards(lo["main_cards"], "主回忆技能卡"); err != nil {
		return nil, err
	}
	if out["sub_cards"], err = contestCards(lo["sub_cards"], "副回忆技能卡"); err != nil {
		return nil, err
	}
	return map[string]any{"kind": "sim", "season_id": sid, "stage": stage, "runs": runs,
		"seed_base": seed, "support_permyriad": support, "loadout": out}, nil
}

// contestGC 定期清理：内存里结束超过 contestKeep 的任务删掉，盘上超过 contestKeep 的任务目录删掉（运行中、排队中的不动）
func (a *App) contestGC(now time.Time) {
	a.contestMu.Lock()
	live := map[string]bool{}
	for id, j := range a.contestJobs {
		if j.State == "queued" || j.State == "running" {
			live[id] = true
			continue
		}
		if now.Sub(j.created) > contestKeep {
			delete(a.contestJobs, id)
			_ = os.RemoveAll(j.Dir)
		}
	}
	a.contestMu.Unlock()
	ents, err := os.ReadDir(a.contestJobsDir())
	if err != nil {
		return
	}
	for _, e := range ents {
		if !e.IsDir() || !contestIDRe.MatchString(e.Name()) || live[e.Name()] {
			continue
		}
		if info, err := e.Info(); err == nil && now.Sub(info.ModTime()) > contestKeep {
			_ = os.RemoveAll(filepath.Join(a.contestJobsDir(), e.Name()))
		}
	}
}

// contestGCLoop 每小时清理一次
func (a *App) contestGCLoop(ctx context.Context) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			a.contestGC(now)
		}
	}
}
