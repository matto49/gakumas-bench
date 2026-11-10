package main

// 存储：全部是文件，按审查存档格式（gkms.audition_save.v2）组织，布局和本地工具一致（见 docs/format.md）。
//   $DATA/problems/<题集>/<AS-编号>.gksave.json   题模板（编成不含 seed），公开
//   $DATA/private/seeds/<题集>.json               固定种子（私有）：题模板编号 -> [{index, seed, split, label, fixed_id, check}]
//   $DATA/private/tokens.json                     令牌：sha256(令牌) -> {user}
//   $DATA/private/evals/<编号>.json               保密种子评测用到的种子（私有）
//   $DATA/runs/<运行>/run.json                    gkbench.run.v2：算法表的表头 + 题集、引擎版本等
//   $DATA/runs/<运行>/episodes.jsonl.zst          每局一行 gkbench.episode.v2（逐局追加的运行是多帧文件）
//   $DATA/runs/<运行>/index.json(l)               每局摘要（排行榜只读这个；没有时从 episodes 生成）

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/klauspost/compress/zstd"
)

type Store struct {
	Data string
	mu   sync.Mutex // 写运行目录时用

	cacheMu sync.Mutex
	cache   map[string]setCache // 题集 -> 题模板（按文件修改时间失效）
}

type setCache struct {
	stamp time.Time
	probs []map[string]any
	byID  map[string]map[string]any
}

type SeedRow struct {
	Index   int            `json:"index"`
	Seed    int64          `json:"seed"`
	Split   string         `json:"split"`
	Label   string         `json:"label"`
	FixedID string         `json:"fixed_id,omitempty"`
	Check   map[string]any `json:"check,omitempty"`
}

// 审查存档表 7 exam_sha：十进制种子串的 SHA-256 前 12 位
func seedSha(seed int64) string {
	h := sha256.Sum256([]byte(strconv.FormatInt(seed, 10)))
	return hex.EncodeToString(h[:])[:12]
}

var slugRe = regexp.MustCompile(`[^A-Za-z0-9_.-]+`)

func slug(s string) string { return strings.Trim(slugRe.ReplaceAllString(s, "-"), "-") }

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

func writeJSON(path string, v any, mode os.FileMode) error {
	b, err := json.MarshalIndent(v, "", " ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, mode); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (s *Store) Sets() []string {
	ents, _ := os.ReadDir(filepath.Join(s.Data, "problems"))
	var out []string
	for _, e := range ents {
		if e.IsDir() {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out
}

func (s *Store) validName(name string) bool { return name != "" && slug(name) == name }

func (s *Store) Seeds(set string) map[string][]SeedRow {
	var doc struct {
		Problems map[string][]SeedRow `json:"problems"`
	}
	if !s.validName(set) {
		return nil
	}
	_ = readJSON(filepath.Join(s.Data, "private", "seeds", set+".json"), &doc)
	return doc.Problems
}

// ---------------------------------------------------------------- 题模板

func metaOf(p map[string]any) map[string]any {
	m, _ := p["meta"].(map[string]any)
	if m == nil {
		m = map[string]any{}
	}
	return m
}

// nameOf 题模板 meta.tags 里的 name:<名字>，没有就用编号
func nameOf(p map[string]any) string {
	if tags, ok := metaOf(p)["tags"].([]any); ok {
		for _, t := range tags {
			if s, ok := t.(string); ok && strings.HasPrefix(s, "name:") {
				return s[5:]
			}
		}
	}
	id, _ := p["id"].(string)
	return id
}

// tagsOf 分组统计用的标签：编成的偶像、考试、轮次 + meta 的场次、机制 + meta.tags 里的 key:value（name 除外）
func tagsOf(p map[string]any) map[string]any {
	lo, _ := p["loadout"].(map[string]any)
	m := metaOf(p)
	out := map[string]any{}
	for k, v := range map[string]any{"idol": lo["idol_card_id"], "produce": lo["produce_id"], "round": lo["round"],
		"stage": m["stage"], "mechanic": m["mechanic"]} {
		if v != nil && v != "" {
			out[k] = v
		}
	}
	if tags, ok := m["tags"].([]any); ok {
		for _, t := range tags {
			if s, ok := t.(string); ok {
				if k, v, found := strings.Cut(s, ":"); found && k != "name" && v != "" {
					out[k] = v
				}
			}
		}
	}
	return out
}

func (s *Store) loadSet(set string) setCache {
	dir := filepath.Join(s.Data, "problems", set)
	st, err := os.Stat(dir)
	if err != nil || !s.validName(set) {
		return setCache{}
	}
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	if s.cache == nil {
		s.cache = map[string]setCache{}
	}
	if c, ok := s.cache[set]; ok && c.stamp.Equal(st.ModTime()) {
		return c
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*.gksave.json"))
	c := setCache{stamp: st.ModTime(), byID: map[string]map[string]any{}}
	for _, f := range files {
		var p map[string]any
		if readJSON(f, &p) == nil {
			c.probs = append(c.probs, p)
			c.byID[fmt.Sprint(p["id"])] = p
		}
	}
	sort.Slice(c.probs, func(i, j int) bool { return nameOf(c.probs[i]) < nameOf(c.probs[j]) })
	s.cache[set] = c
	return c
}

// Problem 题模板（原样的存档对象，只读，不要改）
func (s *Store) Problem(set, id string) (map[string]any, error) {
	p := s.loadSet(set).byID[id]
	if p == nil {
		return nil, fmt.Errorf("没有题 %s/%s", set, id)
	}
	return p, nil
}

func (s *Store) Problems(set string) []map[string]any { return s.loadSet(set).probs }

// ---------------------------------------------------------------- 运行

func (s *Store) RunDir(run string) string { return filepath.Join(s.Data, "runs", run) }

func (s *Store) RunInfo(run string) (map[string]any, error) {
	if !s.validName(run) {
		return nil, fmt.Errorf("运行名不合法")
	}
	var info map[string]any
	err := readJSON(filepath.Join(s.RunDir(run), "run.json"), &info)
	return info, err
}

func (s *Store) Runs(set string) []map[string]any {
	files, _ := filepath.Glob(filepath.Join(s.Data, "runs", "*", "run.json"))
	sort.Strings(files)
	var out []map[string]any
	for _, f := range files {
		var info map[string]any
		if readJSON(f, &info) != nil || info["schema"] != "gkbench.run.v2" {
			continue
		}
		if set != "" && info["set"] != set {
			continue
		}
		out = append(out, info)
	}
	return out
}

// ---------------------------------------------------------------- 一局记录

func ReadEpisodes(path string, fn func(map[string]any) bool) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	zr, err := zstd.NewReader(f)
	if err != nil {
		return err
	}
	defer zr.Close()
	sc := bufio.NewScanner(zr)
	sc.Buffer(make([]byte, 1<<20), 256<<20)
	for sc.Scan() {
		line := sc.Bytes()
		if len(strings.TrimSpace(string(line))) == 0 {
			continue
		}
		var e map[string]any
		if err := json.Unmarshal(line, &e); err != nil {
			return err
		}
		if !fn(e) {
			break
		}
	}
	return sc.Err()
}

func WriteEpisodes(path string, eps []map[string]any) error {
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	zw, err := zstd.NewWriter(f, zstd.WithEncoderLevel(zstd.SpeedDefault))
	if err != nil {
		f.Close()
		return err
	}
	for _, e := range eps {
		b, err := json.Marshal(e)
		if err == nil {
			_, err = zw.Write(append(b, '\n'))
		}
		if err != nil {
			zw.Close()
			f.Close()
			return err
		}
	}
	if err := zw.Close(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ---------------------------------------------------------------- 摘要

// EpisodeSummary 一局的摘要：排行榜、运行页和导出审查存档（一条答）都只读它
type EpisodeSummary struct {
	ID        string         `json:"id"` // 题模板编号
	Name      string         `json:"name,omitempty"`
	FixedID   string         `json:"fixed_id,omitempty"`
	SeedIndex int            `json:"seed_index"`
	ExamSha   string         `json:"exam_sha,omitempty"`
	Score     float64        `json:"score"`
	Finished  bool           `json:"finished"`
	Decisions int            `json:"decisions"`
	Secs      float64        `json:"secs"`
	Over      int            `json:"over_steps"`
	Err       string         `json:"err,omitempty"`
	At        string         `json:"at,omitempty"`
	Route     string         `json:"route,omitempty"`
	Tags      map[string]any `json:"tags,omitempty"`
	StepMs    []float64      `json:"step_ms"`
	Types     []int          `json:"types,omitempty"` // 每回合属性 1 Vo / 2 Da / 3 Vi，取自第一步的公开观测
}

func num(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case json.Number:
		f, _ := x.Float64()
		return f
	}
	return 0
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func Summarize(e map[string]any) EpisodeSummary {
	final, _ := e["final"].(map[string]any)
	s := EpisodeSummary{ID: str(e["id"]), Name: str(e["name"]), FixedID: str(e["fixed_id"]),
		SeedIndex: int(num(e["seed_index"])), ExamSha: str(e["exam_sha"]), Score: num(final["score"]),
		Decisions: int(num(final["decisions"])), Secs: num(final["secs"]), Over: int(num(final["over_steps"])),
		Err: str(e["err"]), At: str(e["at"]), Route: str(e["route"])}
	s.Finished, _ = final["finished"].(bool)
	s.Tags, _ = e["tags"].(map[string]any)
	var first map[string]any
	switch steps := e["steps"].(type) {
	case []any: // 从 JSON 读进来的
		for _, st := range steps {
			if m, ok := st.(map[string]any); ok {
				if first == nil {
					first = m
				}
				s.StepMs = append(s.StepMs, num(m["step_ms"]))
			}
		}
	case []map[string]any: // 托管局在内存里攒的
		for _, m := range steps {
			if first == nil {
				first = m
			}
			s.StepMs = append(s.StepMs, num(m["step_ms"]))
		}
	}
	if obs, ok := first["obs"].(map[string]any); ok {
		if exam, ok := obs["exam"].(map[string]any); ok {
			if ts, ok := exam["types"].([]any); ok {
				for _, t := range ts {
					s.Types = append(s.Types, int(num(t)))
				}
			}
		}
	}
	return s
}

func (s *Store) Index(run string) ([]EpisodeSummary, error) {
	dir := s.RunDir(run)
	var idx struct {
		Episodes []EpisodeSummary `json:"episodes"`
	}
	if readJSON(filepath.Join(dir, "index.json"), &idx) == nil {
		return idx.Episodes, nil
	}
	// 逐局追加的运行（托管、保密种子评测）：index.jsonl 一局一行，同一局重打时以最后一行为准
	if f, err := os.Open(filepath.Join(dir, "index.jsonl")); err == nil {
		defer f.Close()
		pos := map[key]int{}
		var out []EpisodeSummary
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 1<<20), 64<<20)
		for sc.Scan() {
			var e EpisodeSummary
			if json.Unmarshal(sc.Bytes(), &e) != nil {
				continue
			}
			k := key{e.ID, e.SeedIndex}
			if i, ok := pos[k]; ok {
				out[i] = e
			} else {
				pos[k] = len(out)
				out = append(out, e)
			}
		}
		return out, sc.Err()
	}
	pos := map[key]int{}
	var out []EpisodeSummary
	err := ReadEpisodes(filepath.Join(dir, "episodes.jsonl.zst"), func(e map[string]any) bool {
		x := Summarize(e)
		k := key{x.ID, x.SeedIndex}
		if i, ok := pos[k]; ok {
			out[i] = x
		} else {
			pos[k] = len(out)
			out = append(out, x)
		}
		return true
	})
	if err != nil {
		return nil, err
	}
	_ = writeJSON(filepath.Join(dir, "index.json"), map[string]any{"episodes": out}, 0o644)
	return out, nil
}

func (s *Store) WriteRun(run string, info map[string]any, eps []map[string]any) error {
	dir := s.RunDir(run)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if err := WriteEpisodes(filepath.Join(dir, "episodes.jsonl.zst"), eps); err != nil {
		return err
	}
	sums := make([]EpisodeSummary, 0, len(eps))
	total := 0.0
	for _, e := range eps {
		x := Summarize(e)
		sums = append(sums, x)
		total += x.Score
	}
	if err := writeJSON(filepath.Join(dir, "index.json"), map[string]any{"episodes": sums}, 0o644); err != nil {
		return err
	}
	info["episodes"] = len(eps)
	if len(eps) > 0 {
		info["mean_score"] = total / float64(len(eps))
	}
	return writeJSON(filepath.Join(dir, "run.json"), info, 0o644)
}

// AppendEpisode 逐局追加：episodes.jsonl.zst 加一个压缩帧，index.jsonl 加一行摘要，run.json 更新局数和均分。
// 第一次写时用 info 建 run.json。
func (s *Store) AppendEpisode(run string, info map[string]any, e map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir := s.RunDir(run)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(dir, "episodes.jsonl.zst"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	zw, err := zstd.NewWriter(f, zstd.WithEncoderLevel(zstd.SpeedDefault))
	if err == nil {
		_, err = zw.Write(append(b, '\n'))
		if cerr := zw.Close(); err == nil {
			err = cerr
		}
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	// 一次写成的 index.json 先转成逐行的 index.jsonl，否则 Index() 会一直读旧的那份
	if old := filepath.Join(dir, "index.json"); fileExists(old) {
		var idx struct {
			Episodes []EpisodeSummary `json:"episodes"`
		}
		if readJSON(old, &idx) == nil {
			var buf []byte
			for _, x := range idx.Episodes {
				line, _ := json.Marshal(x)
				buf = append(append(buf, line...), '\n')
			}
			if err := os.WriteFile(filepath.Join(dir, "index.jsonl"), buf, 0o644); err != nil {
				return err
			}
		}
		_ = os.Remove(old)
	}
	sum, _ := json.Marshal(Summarize(e))
	ix, err := os.OpenFile(filepath.Join(dir, "index.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	_, err = ix.Write(append(sum, '\n'))
	ix.Close()
	if err != nil {
		return err
	}
	cur := map[string]any{}
	if readJSON(filepath.Join(dir, "run.json"), &cur) != nil {
		cur = info
	}
	n := num(cur["episodes"])
	mean := num(cur["mean_score"])
	final, _ := e["final"].(map[string]any)
	cur["mean_score"] = (mean*n + num(final["score"])) / (n + 1)
	cur["episodes"] = n + 1
	cur["finished"] = now()
	return writeJSON(filepath.Join(dir, "run.json"), cur, 0o644)
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}
