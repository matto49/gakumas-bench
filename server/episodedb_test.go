package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// 每局摘要的 SQLite 索引（episodedb.go）：文件仍是正本，数据库按文件的修改时间和大小同步

const twoEps = `{"id":"P1","seed_index":0,"score":10,"finished":true,"decisions":3,"secs":0.5,"over_steps":1,"route":"d0 e","exam_sha":"aa","name":"题一","at":"20261119T000000Z","tags":{"round":"mid","n":2},"step_ms":[1.5,0,2.25],"types":[1,2,3]}
{"id":"P2","seed_index":3,"score":20,"finished":false,"decisions":1,"secs":0.1,"over_steps":0,"err":"boom","step_ms":[0.125]}
`

func writeJSONL(t *testing.T, s *Store, run, body string) string {
	t.Helper()
	writeRun(t, s, run, "hif", run)
	p := filepath.Join(s.RunDir(run), "index.jsonl")
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

// 服务重启（新的 Store、同一个数据目录）后直接用库里的数据，不再解析文件。
// 证明办法：把文件改成同样大小的另一份内容、修改时间改回原样——库里还是旧内容，说明没重读
func TestEpisodeDBSurvivesRestart(t *testing.T) {
	data := t.TempDir()
	s1 := &Store{Data: data}
	p := writeJSONL(t, s1, "r1", twoEps)
	st, _ := os.Stat(p)
	first, err := s1.Index("r1")
	if err != nil || len(first) != 2 {
		t.Fatalf("first: %v %v", first, err)
	}
	s1.Close()
	fake := []byte(twoEps)
	copy(fake[len(`{"id":"P`):], "9") // P1 → P9，大小不变
	if err := os.WriteFile(p, fake, 0o644); err != nil {
		t.Fatal(err)
	}
	_ = os.Chtimes(p, st.ModTime(), st.ModTime())
	s2 := &Store{Data: data}
	defer s2.Close()
	again, err := s2.Index("r1")
	if err != nil || len(again) != 2 || again[0].ID != "P1" {
		t.Fatalf("重启后要直接用库里的（P1），得到 %+v %v", again, err)
	}
}

// 读出来的每个字段都和直接解析文件一样，顺序也一样（运行页按文件顺序列）
func TestEpisodeDBRoundTripsAllFields(t *testing.T) {
	s := &Store{Data: t.TempDir()}
	defer s.Close()
	writeJSONL(t, s, "r1", twoEps)
	want, err := s.indexUncached("r1")
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Index("r1")
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("库里读出来的不一样：\n%+v\n%+v", got, want)
	}
}

// 排行只取用得到的列：分数、局号、打完没有、出错、超时、耗时、每步毫秒；要分组时才带标签
func TestLeaderboardEpisodesOnlyNeededFields(t *testing.T) {
	s := &Store{Data: t.TempDir()}
	defer s.Close()
	writeJSONL(t, s, "r1", twoEps)
	eps, err := s.lbEpisodes("r1", false)
	if err != nil || len(eps) != 2 {
		t.Fatal(eps, err)
	}
	e := eps[0]
	if e.ID != "P1" || e.Score != 10 || !e.Finished || e.Decisions != 3 || e.Secs != 0.5 || e.Over != 1 || !reflect.DeepEqual(e.StepMs, []float64{1.5, 0, 2.25}) {
		t.Fatalf("排行要的字段不对：%+v", e)
	}
	if e.Route != "" || e.ExamSha != "" || e.Name != "" || e.Tags != nil || e.Types != nil {
		t.Fatalf("排行用不到的字段不该取：%+v", e)
	}
	if eps[1].Err != "boom" || eps[1].SeedIndex != 3 {
		t.Fatalf("第二局：%+v", eps[1])
	}
	tagged, _ := s.lbEpisodes("r1", true)
	if tagged[0].Tags["round"] != "mid" {
		t.Fatalf("要分组时带标签：%+v", tagged[0].Tags)
	}
}

// 按题号查：只回这道题的局
func TestEpisodesOfProblem(t *testing.T) {
	s := &Store{Data: t.TempDir()}
	defer s.Close()
	writeJSONL(t, s, "r1", twoEps)
	eps, err := s.ProblemEpisodes("r1", "P2")
	if err != nil || len(eps) != 1 || eps[0].ID != "P2" || eps[0].Err != "boom" {
		t.Fatalf("%+v %v", eps, err)
	}
}

// 文件追加（托管评测一局一行）后马上读到；运行删掉后库里也删
func TestEpisodeDBFollowsFileChanges(t *testing.T) {
	s := &Store{Data: t.TempDir()}
	defer s.Close()
	p := writeJSONL(t, s, "r1", twoEps)
	if eps, _ := s.Index("r1"); len(eps) != 2 {
		t.Fatal(len(eps))
	}
	f, _ := os.OpenFile(p, os.O_APPEND|os.O_WRONLY, 0o644)
	_, _ = f.WriteString(`{"id":"P3","seed_index":0,"score":5}` + "\n")
	_ = f.Close()
	bump(t, p, time.Second)
	if eps, _ := s.Index("r1"); len(eps) != 3 {
		t.Fatalf("追加后：%d", len(eps))
	}
	if err := os.RemoveAll(s.RunDir("r1")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Index("r1"); err == nil {
		t.Fatal("运行删了还读得到")
	}
}
