package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type App struct {
	store *Store
	pool  *Pool

	jobsMu sync.Mutex
	jobs   map[string]*Job

	hostedMu sync.Mutex
	hosted   map[string]*Hosted

	engineInfo any
	github     githubConf
}

// ---------------------------------------------------------------- 工具

func writeJSONResp(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSONResp(w, code, map[string]any{"detail": msg})
}

func newID(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

// ---------------------------------------------------------------- 身份

type ctxKey struct{}

func (a *App) userOf(r *http.Request) (string, string) {
	tok := ""
	if h := r.Header.Get("Authorization"); strings.HasPrefix(strings.ToLower(h), "bearer ") {
		tok = strings.TrimSpace(h[7:])
	}
	if tok == "" {
		tok = r.URL.Query().Get("token")
	}
	if tok == "" {
		if c, err := r.Cookie("gkb_token"); err == nil {
			tok = c.Value
		}
	}
	if tok == "" {
		return "", ""
	}
	return a.store.lookupToken(tok), tok
}

// auth 包一层：没有有效令牌返回 401；带 ?token= 时写进 cookie，浏览器之后不用再带
func (a *App) auth(fn func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, tok := a.userOf(r)
		if u == "" {
			fail(w, http.StatusUnauthorized, "需要有效令牌")
			return
		}
		if r.URL.Query().Get("token") != "" {
			http.SetCookie(w, &http.Cookie{Name: "gkb_token", Value: tok, HttpOnly: true, Secure: r.TLS != nil ||
				r.Header.Get("X-Forwarded-Proto") == "https", SameSite: http.SameSiteLaxMode, MaxAge: 180 * 86400, Path: "/"})
		}
		fn(w, r, u)
	}
}

// open 公开接口：不要求令牌；有令牌时照样认出是谁
func (a *App) open(fn func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, _ := a.userOf(r)
		fn(w, r, u)
	}
}

// 题集设置：$DATA/private/sets.json {"<题集>": {"public_seeds": true}}
type SetConfig struct {
	PublicSeeds bool `json:"public_seeds"`
}

func (s *Store) SetConfigs() map[string]SetConfig {
	m := map[string]SetConfig{}
	_ = readJSON(filepath.Join(s.Data, "private", "sets.json"), &m)
	return m
}

// ---------------------------------------------------------------- 题库

func (a *App) handleMe(w http.ResponseWriter, r *http.Request, u string) {
	out := map[string]any{"user": u, "engine": a.engineInfo}
	if p := a.store.userProfile(u); p != nil {
		out["github"], out["name"], out["avatar"] = p.Login, p.Name, p.Avatar
	}
	writeJSONResp(w, 200, out)
}

func (a *App) handleSets(w http.ResponseWriter, r *http.Request, u string) {
	out := []map[string]any{}
	cfg := a.store.SetConfigs()
	for _, s := range a.store.Sets() {
		seeds := a.store.Seeds(s)
		dev, test := 0, 0
		for _, rows := range seeds {
			for _, row := range rows {
				if row.Split == "test" {
					test++
				} else {
					dev++
				}
			}
		}
		var idols []string // 题里出现的偶像卡，按出现顺序去重，首页画头像用
		seen := map[string]bool{}
		for _, p := range a.store.Problems(s) {
			if id, _ := tagsOf(p)["idol"].(string); id != "" && !seen[id] {
				seen[id] = true
				idols = append(idols, id)
			}
		}
		out = append(out, map[string]any{"set": s, "problems": len(a.store.Problems(s)), "seeds": map[string]int{"dev": dev, "test": test},
			"template_seeds": TemplateSeeds, "idols": idols, "runs": len(a.store.Runs(s)), "public_seeds": cfg[s].PublicSeeds})
	}
	writeJSONResp(w, 200, out)
}

// 题集里的题：题模板（审查存档原样）+ 便于展示的 name、family、tags + 每个固定种子的公开信息（不含种子本身）
func (a *App) handleProblems(w http.ResponseWriter, r *http.Request, u string) {
	set := r.PathValue("set")
	seeds := a.store.Seeds(set)
	out := []map[string]any{}
	for _, p := range a.store.Problems(set) {
		id, _ := p["id"].(string)
		rows := []map[string]any{}
		for _, s := range seeds[id] {
			row := map[string]any{"index": s.Index, "split": s.Split, "label": s.Label}
			if !secretSplit(s.Split) { // 种子只有约 21 亿种，exam_sha 和固定种子题编号都能穷举反推出种子
				row["exam_sha"], row["fixed_id"] = seedSha(s.Seed), s.FixedID
			}
			rows = append(rows, row)
		}
		out = append(out, map[string]any{"id": id, "name": nameOf(p), "family": metaOf(p)["family"], "tags": tagsOf(p),
			"archive": p, "seeds": rows})
	}
	writeJSONResp(w, 200, out)
}

// 开发集种子（本地跑要用）：题集开了 public_seeds 时谁都能下载，否则要令牌。测试集种子永不下发。
func (a *App) handleSeeds(w http.ResponseWriter, r *http.Request, u string) {
	set := r.PathValue("set")
	if u == "" && !a.store.SetConfigs()[set].PublicSeeds {
		fail(w, http.StatusUnauthorized, "这套题的种子没有公开，需要令牌")
		return
	}
	out := map[string][]SeedRow{}
	for pid, rows := range a.store.Seeds(set) {
		for _, s := range rows {
			if s.Split != "test" {
				out[pid] = append(out[pid], s)
			}
		}
	}
	writeJSONResp(w, 200, map[string]any{"schema": "gkbench.seeds.v2", "set": set, "problems": out})
}

// ---------------------------------------------------------------- 运行

func (a *App) handleRuns(w http.ResponseWriter, r *http.Request, u string) {
	writeJSONResp(w, 200, a.store.Runs(r.URL.Query().Get("set")))
}

func (a *App) handleRun(w http.ResponseWriter, r *http.Request, u string) {
	run := r.PathValue("run")
	info, err := a.store.RunInfo(run)
	if err != nil {
		fail(w, 404, "没有这次运行")
		return
	}
	idx, err := a.store.Index(run)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	secret := info["template_seeds"] != nil
	for i := range idx {
		idx[i].StepMs = nil
		if secret {
			idx[i].ExamSha = ""
		}
	}
	info["episodes"] = idx
	writeJSONResp(w, 200, info)
}

func (a *App) handleEpisode(w http.ResponseWriter, r *http.Request, u string) {
	run, pid := r.PathValue("run"), r.PathValue("id")
	si, err := strconv.Atoi(r.PathValue("seed"))
	if err != nil || !a.store.validName(run) {
		fail(w, 400, "参数不对")
		return
	}
	var found map[string]any // 逐局追加的运行里同一局可能重打过，取最后一次
	_ = ReadEpisodes(filepath.Join(a.store.RunDir(run), "episodes.jsonl.zst"), func(e map[string]any) bool {
		if e["id"] == pid && int(num(e["seed_index"])) == si {
			found = e
		}
		return true
	})
	if found == nil {
		fail(w, 404, "没有这一局")
		return
	}
	// 保密种子（测试集、题模板的固定种子）的逐步记录会暴露抽牌顺序，不公开；exam_sha 能穷举反推出种子，一律不下发
	if split := str(found["seed_split"]); secretSplit(split) {
		if u == "" {
			fail(w, http.StatusForbidden, "保密种子的逐步记录不公开，登录后可看")
			return
		}
		delete(found, "exam_sha")
		delete(found, "fixed_id")
	}
	// 只给裁判看的字段不下发到网页
	if steps, ok := found["steps"].([]any); ok {
		for _, st := range steps {
			if m, ok := st.(map[string]any); ok {
				delete(m, "private")
			}
		}
	}
	writeJSONResp(w, 200, found)
}

func (a *App) handleLeaderboard(w http.ResponseWriter, r *http.Request, u string) {
	q := r.URL.Query()
	kind := q.Get("kind")
	if kind == "" {
		kind = q.Get("mode") // 旧参数名
	}
	rows, err := a.store.Leaderboard(q.Get("set"), q.Get("base"), q.Get("group"), kind)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSONResp(w, 200, rows)
}

// ---------------------------------------------------------------- 上传（后台核对）

type Job struct {
	Job      string           `json:"job"`
	Run      string           `json:"run"`
	Status   string           `json:"status"` // queued running done rejected error
	Done     int              `json:"done"`
	Total    int              `json:"total"`
	Accepted int              `json:"accepted"`
	Rejected []map[string]any `json:"rejected"`
	Error    string           `json:"error,omitempty"`
	user     string
	mu       sync.Mutex
}

func (j *Job) snapshot() map[string]any {
	j.mu.Lock()
	defer j.mu.Unlock()
	rej := j.Rejected
	if len(rej) > 50 {
		rej = rej[:50]
	}
	return map[string]any{"job": j.Job, "run": j.Run, "status": j.Status, "done": j.Done, "total": j.Total,
		"accepted": j.Accepted, "rejected": rej, "error": j.Error}
}

func (a *App) handleUpload(w http.ResponseWriter, r *http.Request, u string) {
	r.Body = http.MaxBytesReader(w, r.Body, 256<<20)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		fail(w, 400, "表单不对："+err.Error())
		return
	}
	readPart := func(name string) ([]byte, error) {
		f, _, err := r.FormFile(name)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		return io.ReadAll(f)
	}
	runRaw, err1 := readPart("run_json")
	epsRaw, err2 := readPart("episodes")
	if err1 != nil || err2 != nil {
		fail(w, 400, "要两个文件：run_json、episodes")
		return
	}
	var info map[string]any
	if json.Unmarshal(runRaw, &info) != nil || info["schema"] != "gkbench.run.v2" {
		fail(w, 400, "run.json 格式不对（要 gkbench.run.v2）")
		return
	}
	if info["kind"] == "template" {
		fail(w, 400, "题模板（保密种子）的成绩只能托管跑，不能上传整次运行")
		return
	}
	runID := slug(fmt.Sprintf("%v-%s", info["run"], u))
	if _, err := os.Stat(a.store.RunDir(runID)); err == nil {
		fail(w, 409, "已经有运行 "+runID)
		return
	}
	a.jobsMu.Lock()
	for _, j := range a.jobs {
		if j.Run == runID && (j.Status == "queued" || j.Status == "running") {
			a.jobsMu.Unlock()
			fail(w, 409, "这次运行正在核对")
			return
		}
	}
	job := &Job{Job: newID(6), Run: runID, Status: "queued", user: u, Rejected: []map[string]any{}}
	a.jobs[job.Job] = job
	a.jobsMu.Unlock()
	tmp := filepath.Join(a.store.Data, "tmp", job.Job+".jsonl.zst")
	_ = os.MkdirAll(filepath.Dir(tmp), 0o755)
	if err := os.WriteFile(tmp, epsRaw, 0o600); err != nil {
		fail(w, 500, err.Error())
		return
	}
	go a.verify(job, info, tmp, u)
	writeJSONResp(w, 202, job.snapshot())
}

func (a *App) handleJob(w http.ResponseWriter, r *http.Request, u string) {
	a.jobsMu.Lock()
	j := a.jobs[r.PathValue("job")]
	a.jobsMu.Unlock()
	if j == nil || j.user != u {
		fail(w, 404, "没有这个任务")
		return
	}
	writeJSONResp(w, 200, j.snapshot())
}

func (a *App) verify(j *Job, info map[string]any, tmp string, u string) {
	defer os.Remove(tmp)
	set := fmt.Sprint(info["set"])
	setJob := func(f func()) { j.mu.Lock(); f(); j.mu.Unlock() }
	setJob(func() { j.Status = "running" })
	var eps []map[string]any
	if err := ReadEpisodes(tmp, func(e map[string]any) bool { eps = append(eps, e); return true }); err != nil {
		setJob(func() { j.Status, j.Error = "error", "读不了 episodes："+err.Error() })
		return
	}
	setJob(func() { j.Total = len(eps) })
	seeds := a.store.Seeds(set)
	ok := make([]bool, len(eps))
	reasons := make([]string, len(eps))
	// 多个引擎子进程并行核对
	work := make(chan int)
	var wg sync.WaitGroup
	for _, wk := range a.pool.workers {
		wg.Add(1)
		go func(wk *Worker) {
			defer wg.Done()
			for i := range work {
				e := eps[i]
				reasons[i] = a.check(wk, set, seeds, e)
				ok[i] = reasons[i] == ""
				setJob(func() {
					j.Done++
					if ok[i] {
						j.Accepted++
					} else {
						j.Rejected = append(j.Rejected, map[string]any{"id": e["id"], "seed_index": e["seed_index"], "reason": reasons[i]})
					}
				})
			}
		}(wk)
	}
	for i := range eps {
		work <- i
	}
	close(work)
	wg.Wait()
	var accepted []map[string]any
	for i, e := range eps {
		if ok[i] {
			e["run"] = j.Run
			accepted = append(accepted, e)
		}
	}
	if len(accepted) == 0 {
		setJob(func() { j.Status = "rejected" })
		return
	}
	// 上传的成绩一律是 self（自报）：服务器核对过分数，但证明不了算法没偷看种子；by 以令牌为准
	if info["mode"] != "self" && info["mode"] != nil {
		info["claimed_mode"] = info["mode"]
	}
	info["run"], info["by"], info["mode"], info["uploaded"], info["kind"] = j.Run, u, "self", now(), "fixed"
	info["verified"] = map[string]any{"accepted": len(accepted), "rejected": len(eps) - len(accepted), "engine": a.engineInfo}
	a.store.mu.Lock()
	err := a.store.WriteRun(j.Run, info, accepted)
	if err == nil {
		_ = writeJSON(filepath.Join(a.store.RunDir(j.Run), "rejected.json"), j.snapshot()["rejected"], 0o644)
	}
	a.store.mu.Unlock()
	if err != nil {
		setJob(func() { j.Status, j.Error = "error", err.Error() })
		return
	}
	setJob(func() { j.Status = "done" })
	log.Printf("上传 %s：收下 %d / %d", j.Run, len(accepted), len(eps))
}

// check 返回空字符串表示通过，否则是拒收原因
func (a *App) check(wk *Worker, set string, seeds map[string][]SeedRow, e map[string]any) string {
	pid := fmt.Sprint(e["id"])
	si := int(num(e["seed_index"]))
	var row *SeedRow
	for i := range seeds[pid] {
		if seeds[pid][i].Index == si {
			row = &seeds[pid][i]
		}
	}
	switch {
	case e["schema"] != "gkbench.episode.v2" || row == nil:
		return "没有这道题或种子"
	case row.Split == "test":
		return "测试集只能托管跑"
	case e["exam_sha"] != seedSha(row.Seed):
		return "种子哈希不符"
	}
	prob, err := a.store.Problem(set, pid)
	if err != nil {
		return "读不了题目"
	}
	rep, _, err := wk.Call(map[string]any{"op": "replay", "problem": prob, "seed": row.Seed, "episode": e})
	if err != nil {
		return "引擎出错：" + err.Error()
	}
	if v, _ := rep["verdict"].(bool); !v {
		return fmt.Sprint(rep["reason"])
	}
	// 题的身份信息以服务器的题库为准
	e["fixed_id"], e["family"], e["name"], e["tags"] = row.FixedID, metaOf(prob)["family"], nameOf(prob), tagsOf(prob)
	return ""
}

// ---------------------------------------------------------------- 我的

func (a *App) handleMyRuns(w http.ResponseWriter, r *http.Request, u string) {
	out := []map[string]any{}
	for _, info := range a.store.Runs("") {
		if info["by"] == u {
			out = append(out, info)
		}
	}
	writeJSONResp(w, 200, out)
}

func (a *App) handleMyJobs(w http.ResponseWriter, r *http.Request, u string) {
	a.jobsMu.Lock()
	var js []*Job
	for _, j := range a.jobs {
		if j.user == u {
			js = append(js, j)
		}
	}
	a.jobsMu.Unlock()
	out := []map[string]any{}
	for _, j := range js {
		out = append(out, j.snapshot())
	}
	writeJSONResp(w, 200, out)
}

// secretSplit 种子保密的局：测试集、题模板的固定种子
func secretSplit(split string) bool { return split == "test" || split == "template" }
