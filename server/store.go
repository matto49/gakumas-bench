package main

// 存储：全部是文件，布局和本地工具一致（见 docs/format.md）。
//   $DATA/problems/<题集>/<题号>.json     题目（公开）
//   $DATA/private/seeds/<题集>.json       种子（私有）
//   $DATA/private/tokens.json             令牌：sha256(令牌) -> {user}
//   $DATA/runs/<运行>/run.json            运行信息
//   $DATA/runs/<运行>/episodes.jsonl.zst  每局一行
//   $DATA/runs/<运行>/index.json          每局摘要（排行榜只读这个，没有时从 episodes 生成）

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

	"github.com/klauspost/compress/zstd"
)

type Store struct {
	Data string
	mu   sync.Mutex // 写运行目录时用
}

type SeedRow struct {
	Index int    `json:"index"`
	Seed  int64  `json:"seed"`
	Split string `json:"split"`
	Label string `json:"label"`
}

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

func (s *Store) Problem(set, pid string) (map[string]any, error) {
	if !s.validName(set) || !s.validName(pid) {
		return nil, fmt.Errorf("题号不合法")
	}
	var p map[string]any
	err := readJSON(filepath.Join(s.Data, "problems", set, pid+".json"), &p)
	return p, err
}

func (s *Store) Problems(set string) []map[string]any {
	if !s.validName(set) {
		return nil
	}
	files, _ := filepath.Glob(filepath.Join(s.Data, "problems", set, "*.json"))
	sort.Strings(files)
	var out []map[string]any
	for _, f := range files {
		var p map[string]any
		if readJSON(f, &p) == nil {
			out = append(out, p)
		}
	}
	return out
}

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
		if readJSON(f, &info) != nil {
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
		if err != nil {
			zw.Close()
			f.Close()
			return err
		}
		if _, err := zw.Write(append(b, '\n')); err != nil {
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

type EpisodeSummary struct {
	Problem   string         `json:"problem"`
	SeedIndex int            `json:"seed_index"`
	Score     float64        `json:"score"`
	Finished  bool           `json:"finished"`
	Decisions int            `json:"decisions"`
	ThinkS    float64        `json:"think_s"`
	Over      int            `json:"over_budget_steps"`
	Error     string         `json:"error,omitempty"`
	Tags      map[string]any `json:"tags,omitempty"`
	ThinkMs   []float64      `json:"think_ms"`
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

func Summarize(e map[string]any) EpisodeSummary {
	final, _ := e["final"].(map[string]any)
	s := EpisodeSummary{Problem: fmt.Sprint(e["problem"]), SeedIndex: int(num(e["seed_index"])),
		Score: num(final["score"]), Decisions: int(num(final["decisions"])), ThinkS: num(final["think_s"]),
		Over: int(num(final["over_budget_steps"]))}
	s.Finished, _ = final["finished"].(bool)
	if err, ok := e["error"].(string); ok {
		s.Error = err
	}
	s.Tags, _ = e["tags"].(map[string]any)
	steps, _ := e["steps"].([]any)
	for _, st := range steps {
		if m, ok := st.(map[string]any); ok {
			s.ThinkMs = append(s.ThinkMs, num(m["think_ms"]))
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
	var out []EpisodeSummary
	err := ReadEpisodes(filepath.Join(dir, "episodes.jsonl.zst"), func(e map[string]any) bool {
		out = append(out, Summarize(e))
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
	for _, e := range eps {
		sums = append(sums, Summarize(e))
	}
	if err := writeJSON(filepath.Join(dir, "index.json"), map[string]any{"episodes": sums}, 0o644); err != nil {
		return err
	}
	return writeJSON(filepath.Join(dir, "run.json"), info, 0o644)
}
