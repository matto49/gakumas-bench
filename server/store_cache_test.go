package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// 运行目录读取的缓存：文件没变时不重读；文件一变（新上传、托管追加一局）马上读到新的；调用方改返回值不会改坏缓存

func writeRun(t *testing.T, s *Store, run, set string, label string) {
	t.Helper()
	dir := s.RunDir(run)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := writeJSON(filepath.Join(dir, "run.json"), map[string]any{"schema": "gkbench.run.v2", "run": run, "set": set, "label": label}, 0o644); err != nil {
		t.Fatal(err)
	}
}

// 改文件后把修改时间往后挪，免得同一秒内写两次、修改时间相同而判断不出变化
func bump(t *testing.T, path string, d time.Duration) {
	t.Helper()
	ts := time.Now().Add(d)
	if err := os.Chtimes(path, ts, ts); err != nil {
		t.Fatal(err)
	}
}

func TestRunsCacheSeesChanges(t *testing.T) {
	s := &Store{Data: t.TempDir()}
	writeRun(t, s, "r1", "hif", "a")
	if got := s.Runs("hif"); len(got) != 1 || got[0]["label"] != "a" {
		t.Fatalf("first read: %v", got)
	}
	// 调用方改返回的 map 不影响下一次
	s.Runs("hif")[0]["label"] = "dirty"
	if got := s.Runs("hif"); got[0]["label"] != "a" {
		t.Fatalf("cache was mutated by caller: %v", got[0]["label"])
	}
	// 改名（PATCH 运行）后读到新的
	writeRun(t, s, "r1", "hif", "b")
	bump(t, filepath.Join(s.RunDir("r1"), "run.json"), 2*time.Second)
	if got := s.Runs("hif"); got[0]["label"] != "b" {
		t.Fatalf("stale after change: %v", got[0]["label"])
	}
	// 新上传的运行马上出现
	writeRun(t, s, "r2", "hif", "c")
	if got := s.Runs("hif"); len(got) != 2 {
		t.Fatalf("new run missing: %d", len(got))
	}
	// 删掉的运行马上消失
	if err := os.RemoveAll(s.RunDir("r2")); err != nil {
		t.Fatal(err)
	}
	if got := s.Runs("hif"); len(got) != 1 {
		t.Fatalf("deleted run still listed: %d", len(got))
	}
}

func TestIndexCacheSeesAppendsAndReturnsCopy(t *testing.T) {
	s := &Store{Data: t.TempDir()}
	writeRun(t, s, "r1", "hif", "a")
	p := filepath.Join(s.RunDir("r1"), "index.jsonl")
	if err := os.WriteFile(p, []byte(`{"id":"p1","seed_index":0,"score":10,"exam_sha":"x"}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	idx, err := s.Index("r1")
	if err != nil || len(idx) != 1 || idx[0].Score != 10 {
		t.Fatalf("first read: %v %v", idx, err)
	}
	// handleRun 会就地清掉 ExamSha：不能改到缓存里的那份
	idx[0].ExamSha = ""
	if again, _ := s.Index("r1"); again[0].ExamSha != "x" {
		t.Fatalf("cache was mutated by caller")
	}
	// 托管评测逐局追加：追加后读到两局
	f, err := os.OpenFile(p, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.WriteString(`{"id":"p2","seed_index":0,"score":20}` + "\n")
	_ = f.Close()
	if got, _ := s.Index("r1"); len(got) != 2 {
		t.Fatalf("append not seen: %d", len(got))
	}
}

func BenchmarkLeaderboardCached(b *testing.B) {
	data := os.Getenv("GKBENCH_BENCH_DATA")
	if data == "" {
		b.Skip("GKBENCH_BENCH_DATA 指向真实数据目录时才跑")
	}
	s := &Store{Data: data}
	for i := 0; i < b.N; i++ {
		if _, err := s.Leaderboard("hif", "", "", "template", ""); err != nil {
			b.Fatal(err)
		}
	}
}

// 排行结果缓存：新上传一个运行、改了运行表头、改了家族名，下一次排行马上反映出来
func TestLeaderboardCacheInvalidates(t *testing.T) {
	s := &Store{Data: t.TempDir()}
	writeTemplateRun(t, s, "a1", "algo-a", map[string][]float64{"A": {100}})
	rows, err := s.Leaderboard("hif", "", "", "template", "")
	if err != nil || len(rows) != 1 {
		t.Fatalf("first: %v %v", rows, err)
	}
	writeTemplateRun(t, s, "b1", "algo-b", map[string][]float64{"A": {50}})
	if rows, _ = s.Leaderboard("hif", "", "", "template", ""); len(rows) != 2 {
		t.Fatalf("new run not seen: %d rows", len(rows))
	}
	patchRun(t, s, "b1", func(m map[string]any) { m["label"] = "algo-renamed" })
	bump(t, filepath.Join(s.RunDir("b1"), "run.json"), 2*time.Second)
	rows, _ = s.Leaderboard("hif", "", "", "template", "")
	found := false
	for _, r := range rows {
		found = found || r.Label == "algo-renamed"
	}
	if !found {
		t.Fatalf("rename not seen: %+v", rows)
	}
	if err := s.SetFamilyName("algo-a", "新名字"); err != nil {
		t.Fatal(err)
	}
	bump(t, s.familiesPath(), 2*time.Second)
	rows, _ = s.Leaderboard("hif", "", "", "template", "")
	named := false
	for _, r := range rows {
		named = named || r.FamilyName == "新名字"
	}
	if !named {
		t.Fatalf("family rename not seen: %+v", rows)
	}
}
