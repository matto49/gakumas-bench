package main

// 审查存档（gkms.audition_save.v2）的下载和上传。
//
//	GET  /api/saves/{id}[?answers=0]       一个存档：题模板，或固定种子题（含种子；种子公开规则同 /seeds，测试集不给）
//	                                       默认附上服务器上所有的答（算法表）
//	GET  /api/sets/{set}/saves[?fixed=1&answers=1]   整套题，JSON Lines
//	POST /api/saves                        上传存档里的答（只要路线）：服务器按编号找题和种子，逐条重放、核对分数，
//	                                       生成完整的逐步记录；一张算法表成为一次运行（mode 一律记为 self）

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

var headerKeys = []string{"algo", "params", "budget", "seconds", "step_seconds", "rules", "machine", "mode", "by"}
var colKeys = []string{"seed", "exam", "exam_sha", "score", "value", "err", "client", "secs", "step_ms", "at", "route"}

// ---------------------------------------------------------------- 找题

type found struct {
	set      string
	template map[string]any
	row      *SeedRow // 固定种子题才有
}

// locate 按存档编号找题：先找题模板，再找固定种子题
func (a *App) locate(id string) *found {
	for _, set := range a.store.Sets() {
		if p, err := a.store.Problem(set, id); err == nil {
			return &found{set: set, template: p}
		}
	}
	for _, set := range a.store.Sets() {
		for tid, rows := range a.store.Seeds(set) {
			for i := range rows {
				if rows[i].FixedID == id {
					p, err := a.store.Problem(set, tid)
					if err != nil {
						return nil
					}
					r := rows[i]
					return &found{set: set, template: p, row: &r}
				}
			}
		}
	}
	return nil
}

func copyMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// fixedArchive 由题模板和一个种子组成固定种子题（编号、起点核对在入库时已算好）
func fixedArchive(tpl map[string]any, row *SeedRow) map[string]any {
	lo := copyMap(tpl["loadout"].(map[string]any))
	lo["seed"] = row.Seed
	meta := copyMap(metaOf(tpl))
	meta["source"] = map[string]any{"kind": "variant", "parent": tpl["id"], "change": fmt.Sprintf("补上第 %d 个种子", row.Index)}
	return map[string]any{"format": "gkms.audition_save.v2", "id": row.FixedID, "loadout": lo, "prefix": "",
		"objective": tpl["objective"], "check": row.Check, "meta": meta, "runs": []any{}}
}

// ---------------------------------------------------------------- 答 ↔ 算法表

func answerOf(info map[string]any, e EpisodeSummary, template bool) map[string]any {
	a := map[string]any{}
	for _, k := range headerKeys {
		if v, ok := info[k]; ok && v != nil && v != "" {
			a[k] = v
		}
	}
	steps := make([]int, len(e.StepMs))
	for i, x := range e.StepMs {
		steps[i] = int(x + 0.5)
	}
	a["score"], a["secs"], a["step_ms"], a["at"], a["route"] = int64(e.Score), round2(e.Secs), steps, e.At, e.Route
	if e.Err != "" {
		a["err"] = e.Err
	} else if !e.Finished {
		a["err"] = "路线没有走完这场审查"
	}
	if template {
		a["exam_sha"] = e.ExamSha
	}
	return a
}

// packRuns 审查存档 1.7：表头相同的答合成一张表，cols 只列出用到的列，按表 7 次序
func packRuns(answers []map[string]any) []any {
	type table struct {
		head map[string]any
		rows []map[string]any
	}
	order := []string{}
	tables := map[string]*table{}
	for _, a := range answers {
		head := map[string]any{}
		for _, k := range headerKeys {
			if v, ok := a[k]; ok {
				head[k] = v
			}
		}
		kb, _ := json.Marshal(head)
		k := string(kb)
		t := tables[k]
		if t == nil {
			t = &table{head: head}
			tables[k] = t
			order = append(order, k)
		}
		t.rows = append(t.rows, a)
	}
	out := []any{}
	for _, k := range order {
		t := tables[k]
		var cols []string
		for _, c := range colKeys {
			for _, r := range t.rows {
				if _, ok := r[c]; ok {
					cols = append(cols, c)
					break
				}
			}
		}
		rows := [][]any{}
		for _, r := range t.rows {
			row := make([]any, len(cols))
			for i, c := range cols {
				row[i] = r[c] // 缺的格是 nil，写成 null
			}
			rows = append(rows, row)
		}
		tb := copyMap(t.head)
		tb["cols"], tb["rows"] = cols, rows
		out = append(out, tb)
	}
	return out
}

func unpackRuns(runs []any) ([]map[string]any, error) {
	var out []map[string]any
	for _, ti := range runs {
		t, ok := ti.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("算法表应是对象")
		}
		colsAny, _ := t["cols"].([]any)
		rows, _ := t["rows"].([]any)
		if t["algo"] == nil || t["rules"] == nil || colsAny == nil {
			return nil, fmt.Errorf("算法表缺 algo、rules 或 cols")
		}
		cols := make([]string, len(colsAny))
		for i, c := range colsAny {
			cols[i] = str(c)
		}
		for _, ri := range rows {
			row, _ := ri.([]any)
			if len(row) != len(cols) {
				return nil, fmt.Errorf("答的格数不等于 cols 的长度")
			}
			a := map[string]any{}
			for _, k := range headerKeys {
				if v, ok := t[k]; ok && v != nil {
					a[k] = v
				}
			}
			for i, c := range cols {
				if row[i] != nil {
					a[c] = row[i]
				}
			}
			out = append(out, a)
		}
	}
	return out, nil
}

// answersFor 服务器上某道题的所有答。template=true：题模板（旧版随机种子评测的局；保密种子的局不导出）；否则某个固定种子
func (a *App) answersFor(set, tid string, row *SeedRow) []map[string]any {
	var out []map[string]any
	for _, info := range a.store.Runs(set) {
		isTpl := info["kind"] == "template"
		if isTpl != (row == nil) {
			continue
		}
		if info["template_seeds"] != nil { // 固定保密种子上的答只写得出 exam_sha，而它能穷举反推出种子，所以不进公开存档
			continue
		}
		idx, err := a.store.Index(str(info["run"]))
		if err != nil {
			continue
		}
		for _, e := range idx {
			if e.ID != tid || (row != nil && e.SeedIndex != row.Index) || e.Route == "" {
				continue
			}
			out = append(out, answerOf(info, e, isTpl))
		}
	}
	return out
}

func (a *App) canSeeSeeds(set, u string) bool {
	return u != "" || a.store.SetConfigs()[set].PublicSeeds
}

func (a *App) archiveFor(f *found, u string, withAnswers bool) (map[string]any, int, string) {
	var doc map[string]any
	if f.row == nil {
		doc = copyMap(f.template)
	} else {
		if f.row.Split == "test" {
			return nil, 404, "没有这个存档"
		}
		if !a.canSeeSeeds(f.set, u) {
			return nil, 401, "这套题的种子没有公开，需要令牌"
		}
		doc = fixedArchive(f.template, f.row)
	}
	if withAnswers {
		doc["runs"] = packRuns(a.answersFor(f.set, str(f.template["id"]), f.row))
	}
	return doc, 200, ""
}

func (a *App) handleSave(w http.ResponseWriter, r *http.Request, u string) {
	id := r.PathValue("id")
	f := a.locate(id)
	if f == nil {
		fail(w, 404, "没有这个存档")
		return
	}
	doc, code, msg := a.archiveFor(f, u, r.URL.Query().Get("answers") != "0")
	if code != 200 {
		fail(w, code, msg)
		return
	}
	if r.URL.Query().Get("download") != "" {
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.gksave.json"`, id))
	}
	writeJSONResp(w, 200, doc)
}

func (a *App) handleSetSaves(w http.ResponseWriter, r *http.Request, u string) {
	set := r.PathValue("set")
	q := r.URL.Query()
	withAnswers, withFixed := q.Get("answers") == "1", q.Get("fixed") == "1"
	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.gksave.jsonl"`, set))
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	seeds := a.store.Seeds(set)
	for _, p := range a.store.Problems(set) {
		if doc, code, _ := a.archiveFor(&found{set: set, template: p}, u, withAnswers); code == 200 {
			_ = enc.Encode(doc)
		}
		if withFixed && a.canSeeSeeds(set, u) {
			for i := range seeds[str(p["id"])] {
				row := seeds[str(p["id"])][i]
				if doc, code, _ := a.archiveFor(&found{set: set, template: p, row: &row}, u, withAnswers); code == 200 {
					_ = enc.Encode(doc)
				}
			}
		}
	}
}

// ---------------------------------------------------------------- 上传存档里的答

type pending struct {
	f      *found
	answer map[string]any
	seed   int64
	tpl    bool
	head   string
}

func (a *App) handleSaveUpload(w http.ResponseWriter, r *http.Request, u string) {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<20)
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		fail(w, 400, "表单不对："+err.Error())
		return
	}
	var docs []map[string]any
	for _, fh := range r.MultipartForm.File["saves"] {
		f, err := fh.Open()
		if err != nil {
			continue
		}
		raw, _ := io.ReadAll(f)
		f.Close()
		var one map[string]any
		if json.Unmarshal(raw, &one) == nil {
			docs = append(docs, one)
			continue
		}
		for _, line := range strings.Split(string(raw), "\n") {
			if strings.TrimSpace(line) == "" {
				continue
			}
			var d map[string]any
			if err := json.Unmarshal([]byte(line), &d); err != nil {
				fail(w, 400, fmt.Sprintf("%s 不是 JSON 或 JSON Lines：%v", fh.Filename, err))
				return
			}
			docs = append(docs, d)
		}
	}
	if len(docs) == 0 {
		fail(w, 400, "要至少一个存档文件（表单字段 saves）")
		return
	}
	label := slug(r.FormValue("label"))
	job := &Job{Job: newID(6), Status: "queued", user: u, Rejected: []map[string]any{}}
	a.jobsMu.Lock()
	a.jobs[job.Job] = job
	a.jobsMu.Unlock()
	go a.ingestSaves(job, docs, label, u)
	writeJSONResp(w, 202, job.snapshot())
}

func (a *App) ingestSaves(j *Job, docs []map[string]any, label, u string) {
	setJob := func(f func()) { j.mu.Lock(); f(); j.mu.Unlock() }
	reject := func(id any, i int, why string) {
		setJob(func() {
			j.Rejected = append(j.Rejected, map[string]any{"id": id, "answer": i, "reason": why})
		})
	}
	setJob(func() { j.Status = "running" })
	var work []pending
	for _, d := range docs {
		id := str(d["id"])
		f := a.locate(id)
		if d["format"] != "gkms.audition_save.v2" && d["format"] != "gkms.audition_save.v1" {
			reject(id, -1, "format 不是 gkms.audition_save.v2 / v1")
			continue
		}
		if f == nil {
			reject(id, -1, "服务器的题库里没有这个编号（只收已有题的答）")
			continue
		}
		runs, _ := d["runs"].([]any)
		answers, err := unpackRuns(runs)
		if err != nil {
			reject(id, -1, err.Error())
			continue
		}
		for i, ans := range answers {
			p := pending{f: f, answer: ans, tpl: f.row == nil}
			if f.row != nil {
				if f.row.Split == "test" {
					reject(id, i, "测试集只能托管跑")
					continue
				}
				p.seed = f.row.Seed
			} else {
				ex, ok := ans["exam"]
				if !ok {
					reject(id, i, "题模板的答要带 exam（明文种子）才能重放；只有 exam_sha 的答无法核对")
					continue
				}
				p.seed = int64(num(ex))
				if sha, ok := ans["exam_sha"]; ok && str(sha) != seedSha(p.seed) {
					reject(id, i, "exam 和 exam_sha 对不上")
					continue
				}
			}
			head := map[string]any{"set": f.set, "kind": map[bool]string{true: "template", false: "fixed"}[p.tpl]}
			for _, k := range headerKeys {
				if v, ok := ans[k]; ok {
					head[k] = v
				}
			}
			hb, _ := json.Marshal(head)
			p.head = string(hb)
			work = append(work, p)
		}
	}
	setJob(func() { j.Total = len(work) })
	eps := make([]map[string]any, len(work))
	ch := make(chan int)
	var wg sync.WaitGroup
	for _, wk := range a.pool.workers {
		wg.Add(1)
		go func(wk *Worker) {
			defer wg.Done()
			for i := range ch {
				ep, why := a.replayAnswer(wk, work[i])
				setJob(func() {
					j.Done++
					if why == "" {
						j.Accepted++
					}
				})
				if why != "" {
					reject(work[i].f.template["id"], i, why)
					continue
				}
				eps[i] = ep
			}
		}(wk)
	}
	for i := range work {
		ch <- i
	}
	close(ch)
	wg.Wait()
	// 一张算法表（表头 + 题集 + 题模板 / 固定种子）一次运行
	groups := map[string][]int{}
	var heads []string
	for i, e := range eps {
		if e != nil {
			if _, ok := groups[work[i].head]; !ok {
				heads = append(heads, work[i].head)
			}
			groups[work[i].head] = append(groups[work[i].head], i)
		}
	}
	sort.Strings(heads)
	stamp := time.Now().Format("20060102-150405")
	var runs []string
	for n, hk := range heads {
		var head map[string]any
		_ = json.Unmarshal([]byte(hk), &head)
		name := label
		if name == "" {
			name = strings.TrimPrefix(str(head["algo"]), "external:")
		}
		run := slug(fmt.Sprintf("%s-%s-%s-%s-%d", stamp, head["set"], name, u, n))
		info := map[string]any{"schema": "gkbench.run.v2", "run": run, "label": slug(name), "set": head["set"],
			"kind": head["kind"], "mode": "self", "by": u, "privileged": false, "engine": a.engineInfo,
			"uploaded": now(), "source": "audition_save"}
		for _, k := range headerKeys {
			if v, ok := head[k]; ok && k != "mode" && k != "by" {
				info[k] = v
			}
		}
		if head["mode"] != nil && head["mode"] != "self" {
			info["claimed_mode"] = head["mode"]
		}
		if head["by"] != nil && head["by"] != u {
			info["claimed_by"] = head["by"]
		}
		var list []map[string]any
		for _, i := range groups[hk] {
			eps[i]["run"] = run
			list = append(list, eps[i])
		}
		info["verified"] = map[string]any{"accepted": len(list), "engine": a.engineInfo}
		a.store.mu.Lock()
		err := a.store.WriteRun(run, info, list)
		a.store.mu.Unlock()
		if err != nil {
			setJob(func() { j.Status, j.Error = "error", err.Error() })
			return
		}
		runs = append(runs, run)
	}
	setJob(func() {
		j.Run = strings.Join(runs, ",")
		if j.Accepted == 0 {
			j.Status = "rejected"
		} else {
			j.Status = "done"
		}
	})
	log.Printf("上传存档：%d 条答，收下 %d，运行 %v", j.Total, j.Accepted, runs)
}

// replayAnswer 用引擎重放一条答，核对分数，生成 gkbench.episode.v2
func (a *App) replayAnswer(wk *Worker, p pending) (map[string]any, string) {
	ans := p.answer
	var stepMs []any
	if v, ok := ans["step_ms"].([]any); ok {
		stepMs = v
	}
	req := map[string]any{"op": "replay_route", "problem": p.f.template, "seed": p.seed, "route": str(ans["route"])}
	if stepMs != nil {
		req["step_ms"] = stepMs
	}
	rep, _, err := wk.Call(req)
	if err != nil {
		return nil, "引擎出错：" + err.Error()
	}
	score := num(rep["score"])
	if score != num(ans["score"]) {
		return nil, fmt.Sprintf("分数不符：存档 %v，重放 %v", int64(num(ans["score"])), int64(score))
	}
	replayErr := str(rep["err"])
	if replayErr != "" && ans["err"] == nil {
		return nil, "路线有问题：" + replayErr
	}
	steps, _ := rep["steps"].([]any)
	stepSeconds := num(ans["step_seconds"])
	ms, over := 0.0, 0
	var tokens []string
	for _, si := range steps {
		s, _ := si.(map[string]any)
		x := num(s["step_ms"])
		ms += x
		if overBudget(x, stepSeconds) {
			s["over"] = true
			over++
		}
		tokens = append(tokens, str(s["token"]))
	}
	tpl := p.f.template
	row := SeedRow{Index: 0, Split: "random", Label: "上传"}
	if p.f.row != nil {
		row = *p.f.row
	}
	final := map[string]any{"score": score, "finished": rep["finished"], "decisions": len(steps), "turns": rep["turns"],
		"begin_s": 0.0, "secs": round2(ms / 1000), "wall_s": nil, "over_steps": over}
	if v, ok := ans["secs"]; ok {
		final["secs"] = v
	}
	at := str(ans["at"])
	if at == "" {
		at = tsNow()
	}
	ep := map[string]any{"schema": "gkbench.episode.v2", "id": tpl["id"], "family": metaOf(tpl)["family"],
		"set": p.f.set, "name": nameOf(tpl), "tags": tagsOf(tpl), "seed_index": row.Index, "seed_label": row.Label,
		"seed_split": row.Split, "exam_sha": seedSha(p.seed), "meta": rep["meta"], "route": strings.Join(tokens, " "),
		"steps": steps, "final": final, "err": ans["err"], "at": at}
	if p.f.row != nil {
		ep["fixed_id"] = row.FixedID
	} else {
		ep["exam"] = p.seed // 题模板的答：种子是提交方自己给的，已经公开
		ep["seed_index"] = seedSlot(p.seed)
	}
	return ep, ""
}

// seedSlot 题模板上传的答没有格子号：用种子哈希的前 7 位当下标，同一个种子总落在同一格
func seedSlot(seed int64) int {
	var n int
	_, _ = fmt.Sscanf(seedSha(seed)[:7], "%x", &n)
	return n
}
