package main

// 試験集合：题集的名称、说明、提交人、状态，场景统计，建集合和上传题。
//
//	$DATA/private/sets.json  {"<集合>": {title, blurb, owner, status, created, public_seeds}}
//	  status：official 官方（管理员维护，首页和算法排行默认看它们）、community 社区（用户自己建、自己传）
//	  老数据没有 status 的当作 official
//
//	GET    /api/sets                         每个集合的信息 + 场景统计 + 跑过几种算法
//	GET    /api/sets/{set}/problems          每道题带 scene（考试、阶段、轮次、流派、机制、偶像、回合、牌组张数、P 道具、饮料）
//	POST   /api/sets {title, blurb}          登录用户新建社区集合
//	PATCH  /api/sets/{set} {title?, blurb?, status?}   提交人或管理员改名字说明；status 只有管理员能改（审核：社区 → 官方）
//	POST   /api/sets/{set}/problems          上传题：表单字段 files（开局配置 gkms.hif_loadout.v1 或 .gksave.json，可多个，可 JSON Lines）、name（开局配置的题名）；?wait=1 核对完再返回
//	DELETE /api/sets/{set}/problems/{id}     提交人或管理员删一道题（官方集合只有管理员能删）
//
// 上传的每道题交给引擎核对（worker check_problem：编号、题族、起点、能开局），同一集合里题族编号相同的算重复。
// 保密种子在评测开始时按题自动生成（tseeds.go），不用另外处理。

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	maxUploadDocs     = 500
	maxWaitDocs       = 20 // ?wait=1 同步核对时一次最多几道
	maxCommunitySets  = 20
	maxTitleRunes     = 40
	maxBlurbRunes     = 300
	statusOfficial    = "official"
	statusCommunity   = "community"
	defaultAdminUsers = "matto"
)

type SetConfig struct {
	PublicSeeds bool   `json:"public_seeds"`
	Title       string `json:"title,omitempty"`
	Blurb       string `json:"blurb,omitempty"`
	Owner       string `json:"owner,omitempty"`
	Status      string `json:"status,omitempty"`
	Created     string `json:"created,omitempty"`
}

func (c SetConfig) status() string {
	if c.Status == "" {
		return statusOfficial
	}
	return c.Status
}

var setCfgMu sync.Mutex

func (s *Store) setConfigPath() string { return filepath.Join(s.Data, "private", "sets.json") }

func (s *Store) SetConfigs() map[string]SetConfig {
	m := map[string]SetConfig{}
	_ = readJSON(s.setConfigPath(), &m)
	return m
}

func (s *Store) updateSetConfig(set string, f func(*SetConfig)) error {
	setCfgMu.Lock()
	defer setCfgMu.Unlock()
	m := s.SetConfigs()
	c := m[set]
	f(&c)
	m[set] = c
	if err := os.MkdirAll(filepath.Dir(s.setConfigPath()), 0o700); err != nil {
		return err
	}
	return writeJSON(s.setConfigPath(), m, 0o600)
}

func isAdmin(u string) bool {
	for _, x := range strings.Split(env("GKBENCH_ADMINS", defaultAdminUsers), ",") {
		if strings.TrimSpace(x) == u && u != "" {
			return true
		}
	}
	return false
}

// canEdit 能不能往集合里传题、改名字：管理员都能；社区集合的提交人能
func canEdit(c SetConfig, u string) bool {
	return isAdmin(u) || (u != "" && c.status() == statusCommunity && c.Owner == u)
}

// ---------------------------------------------------------------- 场景

// 偶像卡 → 流派（PLAN1 センス / PLAN2 ロジック / PLAN3 アノマリー），从卡牌目录读，按修改时间缓存
var (
	idolPlanMu    sync.Mutex
	idolPlanStamp time.Time
	idolPlan      map[string]string
)

func (s *Store) planOfIdol(id string) string {
	path := filepath.Join(s.Data, "static", "catalog.json")
	idolPlanMu.Lock()
	defer idolPlanMu.Unlock()
	if st, err := os.Stat(path); err == nil && !st.ModTime().Equal(idolPlanStamp) {
		var cat struct {
			Idols map[string]struct {
				Plan string `json:"plan"`
			} `json:"idols"`
		}
		if readJSON(path, &cat) == nil {
			idolPlan = map[string]string{}
			for k, v := range cat.Idols {
				idolPlan[k] = v.Plan
			}
			idolPlanStamp = st.ModTime()
		}
	}
	return idolPlan[id]
}

func idsOf(v any) []string {
	xs, _ := v.([]any)
	var out []string
	for _, x := range xs {
		switch t := x.(type) {
		case string:
			out = append(out, strings.SplitN(t, "+", 2)[0])
		case map[string]any:
			if id, ok := t["id"].(string); ok {
				out = append(out, id)
			}
		}
	}
	return out
}

// sceneOf 一道题的场景：全部从编成和 meta 自动算，不靠手填
func (s *Store) sceneOf(p map[string]any) map[string]any {
	lo, _ := p["loadout"].(map[string]any)
	m := metaOf(p)
	idol, _ := lo["idol_card_id"].(string)
	sc := map[string]any{
		"exam": lo["produce_id"], "stage": m["stage"], "round": lo["round"], "mechanic": m["mechanic"],
		"idol": idol, "plan": s.planOfIdol(idol), "turns": m["turns"],
		"deck": len(idsOf(lo["deck_cards"])), "items": idsOf(lo["produce_item_ids"]), "drinks": idsOf(lo["drink_ids"]),
	}
	for k, v := range sc {
		if v == nil || v == "" {
			delete(sc, k)
		}
	}
	return sc
}

var sceneKeys = []string{"exam", "stage", "round", "plan", "mechanic", "idol"}

func (s *Store) sceneCounts(set string) map[string]map[string]int {
	out := map[string]map[string]int{}
	for _, k := range sceneKeys {
		out[k] = map[string]int{}
	}
	for _, p := range s.Problems(set) {
		sc := s.sceneOf(p)
		for _, k := range sceneKeys {
			if v, ok := sc[k].(string); ok && v != "" {
				out[k][v]++
			}
		}
	}
	return out
}

// algosOf 这个集合上跑过的算法（不含理论上限），按名字去重
func (s *Store) algosOf(set string) []string {
	seen := map[string]bool{}
	var out []string
	for _, info := range s.Runs(set) {
		if privileged(info) {
			continue
		}
		l, _ := info["label"].(string)
		if l != "" && !seen[l] {
			seen[l] = true
			out = append(out, l)
		}
	}
	sort.Strings(out)
	return out
}

// ---------------------------------------------------------------- 建集合、改集合

func trimRunes(s string, n int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

func (a *App) handleCreateSet(w http.ResponseWriter, r *http.Request, u string) {
	var b struct {
		Title string `json:"title"`
		Blurb string `json:"blurb"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&b) != nil {
		fail(w, 400, "请求体不是 JSON")
		return
	}
	title := trimRunes(b.Title, maxTitleRunes)
	if title == "" {
		fail(w, 400, "集合要有名字")
		return
	}
	n := 0
	for _, c := range a.store.SetConfigs() {
		if c.Owner == u && c.status() == statusCommunity {
			n++
		}
	}
	if n >= maxCommunitySets && !isAdmin(u) {
		fail(w, 400, fmt.Sprintf("每人最多建 %d 个集合", maxCommunitySets))
		return
	}
	id := slug(fmt.Sprintf("u-%s-%s", u, newID(3)))
	if err := os.MkdirAll(filepath.Join(a.store.Data, "problems", id), 0o755); err != nil {
		fail(w, 500, err.Error())
		return
	}
	if err := a.store.updateSetConfig(id, func(c *SetConfig) {
		*c = SetConfig{Title: title, Blurb: trimRunes(b.Blurb, maxBlurbRunes), Owner: u, Status: statusCommunity, Created: now()}
	}); err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSONResp(w, 200, map[string]any{"set": id, "title": title})
}

func (a *App) handlePatchSet(w http.ResponseWriter, r *http.Request, u string) {
	set := r.PathValue("set")
	if !a.setExists(set) {
		fail(w, 404, "没有这个集合")
		return
	}
	var b struct {
		Title  *string `json:"title"`
		Blurb  *string `json:"blurb"`
		Status *string `json:"status"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&b) != nil {
		fail(w, 400, "请求体不是 JSON")
		return
	}
	c := a.store.SetConfigs()[set]
	if b.Status != nil {
		if !isAdmin(u) {
			fail(w, 403, "只有管理员能审核集合")
			return
		}
		if *b.Status != statusOfficial && *b.Status != statusCommunity {
			fail(w, 400, "status 只能是 official 或 community")
			return
		}
	} else if !canEdit(c, u) {
		fail(w, 403, "只有提交人或管理员能改这个集合")
		return
	}
	err := a.store.updateSetConfig(set, func(c *SetConfig) {
		if b.Title != nil && trimRunes(*b.Title, maxTitleRunes) != "" {
			c.Title = trimRunes(*b.Title, maxTitleRunes)
		}
		if b.Blurb != nil {
			c.Blurb = trimRunes(*b.Blurb, maxBlurbRunes)
		}
		if b.Status != nil {
			c.Status = *b.Status
		}
	})
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSONResp(w, 200, map[string]any{"ok": true})
}

func (a *App) setExists(set string) bool {
	if !a.store.validName(set) {
		return false
	}
	st, err := os.Stat(filepath.Join(a.store.Data, "problems", set))
	return err == nil && st.IsDir()
}

// ---------------------------------------------------------------- 上传题

var setWriteMu sync.Mutex // 往集合里写题、写固定种子时串行

func (a *App) handleUploadProblems(w http.ResponseWriter, r *http.Request, u string) {
	set := r.PathValue("set")
	if !a.setExists(set) {
		fail(w, 404, "没有这个集合")
		return
	}
	if !canEdit(a.store.SetConfigs()[set], u) {
		fail(w, 403, "只能往自己建的社区集合里传题；官方集合由管理员维护")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<20)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		fail(w, 400, "表单不对："+err.Error())
		return
	}
	// docs：存档对象，或者没算过编号的开局配置（gkms.hif_loadout.v1，引擎子进程替它算编号，所以用 curl 就能传，不用装本仓库）。
	// names：开局配置没有题名，用表单的 name，没给就用文件名；一次传多道时从第二道起加 -2、-3
	var docs []any
	var names []string
	formName := strings.TrimSpace(r.FormValue("name"))
	add := func(d map[string]any, file string) {
		name := formName
		if name == "" {
			name = file
			for _, ext := range []string{".jsonl", ".json", ".gksave"} {
				name = strings.TrimSuffix(name, ext)
			}
		}
		n := 0
		for _, x := range names {
			if x == name || strings.HasPrefix(x, name+"-") {
				n++
			}
		}
		if n > 0 {
			name = fmt.Sprintf("%s-%d", name, n+1)
		}
		docs, names = append(docs, d), append(names, trimRunes(name, 80))
	}
	for _, fh := range r.MultipartForm.File["files"] {
		f, err := fh.Open()
		if err != nil {
			continue
		}
		raw, _ := io.ReadAll(f)
		f.Close()
		var one map[string]any
		if json.Unmarshal(raw, &one) == nil {
			add(one, fh.Filename)
			continue
		}
		for _, line := range strings.Split(string(raw), "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			var d map[string]any
			if err := json.Unmarshal([]byte(line), &d); err != nil {
				fail(w, 400, fmt.Sprintf("%s 不是 JSON 或 JSON Lines：%v", fh.Filename, err))
				return
			}
			add(d, fh.Filename)
		}
	}
	if len(docs) == 0 {
		fail(w, 400, "没有题：表单字段 files 放开局配置或 .gksave.json（可多个，可 JSON Lines）")
		return
	}
	if len(docs) > maxUploadDocs {
		fail(w, 400, fmt.Sprintf("一次最多 %d 道题", maxUploadDocs))
		return
	}
	job := &Job{Job: newID(6), Run: set, Status: "queued", Total: len(docs), user: u, Rejected: []map[string]any{}}
	a.jobsMu.Lock()
	a.jobs[job.Job] = job
	a.jobsMu.Unlock()
	// ?wait=1：核对完再返回最终结果（给 curl 用，不用再轮询）；题多时核对久，会超过代理的等待时间，所以限 20 道
	if r.URL.Query().Get("wait") != "" {
		if len(docs) > maxWaitDocs {
			fail(w, 400, fmt.Sprintf("wait=1 一次最多 %d 道题，更多的去掉 wait，用返回的 job 查 /api/jobs/{job}", maxWaitDocs))
			return
		}
		a.ingestProblems(job, set, docs, names)
		writeJSONResp(w, 200, job.snapshot())
		return
	}
	go a.ingestProblems(job, set, docs, names)
	writeJSONResp(w, 202, job.snapshot())
}

func (a *App) ingestProblems(j *Job, set string, docs []any, names []string) {
	setJob := func(f func()) { j.mu.Lock(); f(); j.mu.Unlock() }
	reject := func(i int, id, why string) {
		setJob(func() {
			j.Rejected = append(j.Rejected, map[string]any{"id": id, "answer": i, "reason": why})
		})
	}
	setJob(func() { j.Status = "running" })
	for i, d := range docs {
		label := fmt.Sprintf("第 %d 道", i+1)
		if m, ok := d.(map[string]any); ok && str(m["id"]) != "" {
			label = str(m["id"])
		}
		rep, _, err := a.pool.Pick().Call(map[string]any{"op": "check_problem", "doc": d, "name": names[i]})
		switch {
		case err != nil:
			msg := err.Error()
			if k := strings.Index(msg, ": "); k > 0 && strings.Contains(msg[:k], "Error") {
				msg = msg[k+2:] // 去掉 Python 异常类名
			}
			reject(i, label, "核对没过："+trimRunes(msg, 200))
		default:
			added, why := a.storeProblem(set, rep)
			if why != "" {
				reject(i, str(rep["id"]), why)
			} else {
				setJob(func() {
					j.Accepted++
					j.Added = append(j.Added, map[string]any{"id": added, "name": rep["name"], "family": rep["family"]})
				})
			}
		}
		setJob(func() { j.Done++ })
	}
	setJob(func() {
		if j.Accepted == 0 {
			j.Status = "rejected"
		} else {
			j.Status = "done"
		}
	})
}

// storeProblem 把核对过的题写进集合：题族重复的不收。返回题模板编号，或拒收原因
func (a *App) storeProblem(set string, rep map[string]any) (string, string) {
	id, fam, text := str(rep["id"]), str(rep["family"]), str(rep["text"])
	if !strings.HasPrefix(id, "AS-") || text == "" || !a.store.validName(id) {
		return "", "引擎没给出题模板"
	}
	setWriteMu.Lock()
	defer setWriteMu.Unlock()
	for _, p := range a.store.Problems(set) {
		if str(metaOf(p)["family"]) == fam || fmt.Sprint(p["id"]) == id {
			return "", fmt.Sprintf("重复：集合里已有题族 %s（%s）", fam, nameOf(p))
		}
	}
	path := filepath.Join(a.store.Data, "problems", set, id+".gksave.json")
	if err := os.WriteFile(path+".tmp", []byte(text), 0o644); err != nil {
		return "", err.Error()
	}
	if err := os.Rename(path+".tmp", path); err != nil {
		return "", err.Error()
	}
	if row, ok := rep["fixed_seed"].(map[string]any); ok {
		if err := a.store.addFixedSeed(set, id, row); err != nil {
			return id, "" // 题已经收下；固定种子没写上不影响保密种子评测
		}
	}
	return id, ""
}

func (s *Store) addFixedSeed(set, id string, row map[string]any) error {
	path := filepath.Join(s.Data, "private", "seeds", set+".json")
	doc := map[string]any{}
	_ = readJSON(path, &doc)
	probs, _ := doc["problems"].(map[string]any)
	if probs == nil {
		probs = map[string]any{}
	}
	rows, _ := probs[id].([]any)
	row["index"] = len(rows)
	probs[id] = append(rows, row)
	doc["schema"], doc["set"], doc["problems"] = "gkbench.seeds.v2", set, probs
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return writeJSON(path, doc, 0o600)
}

func (a *App) handleDeleteProblem(w http.ResponseWriter, r *http.Request, u string) {
	set, id := r.PathValue("set"), r.PathValue("id")
	c := a.store.SetConfigs()[set]
	if !a.setExists(set) || !a.store.validName(id) {
		fail(w, 404, "没有这道题")
		return
	}
	if !canEdit(c, u) {
		fail(w, 403, "只有提交人或管理员能删题")
		return
	}
	setWriteMu.Lock()
	defer setWriteMu.Unlock()
	path := filepath.Join(a.store.Data, "problems", set, id+".gksave.json")
	if _, err := os.Stat(path); err != nil {
		fail(w, 404, "没有这道题")
		return
	}
	trash := filepath.Join(a.store.Data, "trash", set)
	_ = os.MkdirAll(trash, 0o755)
	if err := os.Rename(path, filepath.Join(trash, id+".gksave.json")); err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSONResp(w, 200, map[string]any{"ok": true})
}
