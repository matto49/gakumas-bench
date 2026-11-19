package main

// 运行目录的读缓存。排行、题集列表、存档每次请求都要把全部运行的 run.json 和每局摘要（index.json(l)）读一遍，
// 线上 245 个运行、摘要上百 MB，一次排行要两三秒。这里按文件的修改时间和大小缓存解析结果：文件没变就用上次的，
// 一变（新上传、改名、托管评测追加一局）下一次请求就重读。返回给调用方的都是副本，调用方随便改。

import (
	"fmt"
	"hash/fnv"
	"log"
	"maps"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"sync"
	"time"
)

type fileStamp struct {
	mod  time.Time
	size int64
}

func stampOf(path string) (fileStamp, bool) {
	st, err := os.Stat(path)
	if err != nil || st.IsDir() {
		return fileStamp{}, false
	}
	return fileStamp{st.ModTime(), st.Size()}, true
}

type runInfoEntry struct {
	stamp fileStamp
	info  map[string]any // nil：不是 gkbench.run.v2 或读不了
}

type indexEntry struct {
	path  string
	stamp fileStamp
	eps   []EpisodeSummary
	err   error // episodes 文件坏了也缓存：文件不变就不再每次解压一遍再失败
}

type runCache struct {
	mu    sync.Mutex
	infos map[string]runInfoEntry // run.json 路径 ->
	index map[string]indexEntry   // 运行目录 ->
	lb    map[string]lbEntry      // 排行请求参数 ->
}

const lbCacheMax = 256

type lbEntry struct {
	sig  uint64
	rows []Row
}

// runInfoCached：读一个 run.json，没变就用缓存。返回缓存里那份（只给 Runs 内部用，Runs 负责复制）
func (s *Store) runInfoCached(path string) map[string]any {
	st, ok := stampOf(path)
	if !ok {
		return nil
	}
	s.rc.mu.Lock()
	e, hit := s.rc.infos[path]
	s.rc.mu.Unlock()
	if hit && e.stamp == st {
		return e.info
	}
	var info map[string]any
	if readJSON(path, &info) != nil || info["schema"] != "gkbench.run.v2" {
		info = nil
	}
	s.rc.mu.Lock()
	if s.rc.infos == nil {
		s.rc.infos = map[string]runInfoEntry{}
	}
	s.rc.infos[path] = runInfoEntry{st, info}
	s.rc.mu.Unlock()
	return info
}

// forgetMissing：缓存里删掉已经不在的 run.json（运行被删了）
func (s *Store) forgetMissing(present map[string]bool) {
	s.rc.mu.Lock()
	defer s.rc.mu.Unlock()
	for p := range s.rc.infos {
		if !present[p] {
			delete(s.rc.infos, p)
		}
	}
}

// indexSource：这个运行的每局摘要从哪个文件读。index.json 优先，其次逐局追加的 index.jsonl，都没有就是从 episodes 现算
func indexSource(dir string) (string, fileStamp, bool) {
	for _, name := range []string{"index.json", "index.jsonl", "episodes.jsonl.zst"} {
		p := filepath.Join(dir, name)
		if st, ok := stampOf(p); ok {
			return p, st, true
		}
	}
	return "", fileStamp{}, false
}

// Index：一次运行的每局摘要（带缓存，返回副本）
func (s *Store) Index(run string) ([]EpisodeSummary, error) {
	dir := s.RunDir(run)
	src, st, ok := indexSource(dir)
	if ok {
		s.rc.mu.Lock()
		e, hit := s.rc.index[dir]
		s.rc.mu.Unlock()
		if hit && e.path == src && e.stamp == st {
			if e.err != nil {
				return nil, e.err
			}
			return slices.Clone(e.eps), nil
		}
	}
	eps, err := s.indexUncached(run)
	// 从 episodes 生成成功时顺手写了 index.json：重新取一次来源，下次直接命中
	if src, st, ok = indexSource(dir); ok {
		s.rc.mu.Lock()
		if s.rc.index == nil {
			s.rc.index = map[string]indexEntry{}
		}
		s.rc.index[dir] = indexEntry{src, st, eps, err}
		s.rc.mu.Unlock()
	}
	if err != nil {
		return nil, err
	}
	return slices.Clone(eps), nil
}

func cloneInfos(in []map[string]any) []map[string]any {
	out := make([]map[string]any, len(in))
	for i, m := range in {
		out[i] = maps.Clone(m)
	}
	return out
}

// dataSig：排行用到的全部文件（各运行的 run.json 和摘要、题集配置、家族名）的修改时间和大小合成一个指纹。
// 245 个运行约五百次 stat，几毫秒；任何一个文件变了指纹就变
func (s *Store) dataSig() uint64 {
	h := fnv.New64a()
	add := func(p string) {
		st, ok := stampOf(p)
		fmt.Fprintf(h, "%s|%v|%d|%d\n", p, ok, st.mod.UnixNano(), st.size)
	}
	add(s.setConfigPath())
	add(s.familiesPath())
	files, _ := filepath.Glob(filepath.Join(s.Data, "runs", "*", "run.json"))
	for _, f := range files {
		add(f)
		src, st, ok := indexSource(filepath.Dir(f))
		fmt.Fprintf(h, "%s|%v|%d|%d\n", src, ok, st.mod.UnixNano(), st.size)
	}
	return h.Sum64()
}

// Leaderboard：排行（带缓存）。数据指纹没变就返回上次算好的；变了就现算。调用方只拿去序列化，不改
func (s *Store) Leaderboard(set, base, group, kind, scope string) ([]Row, error) {
	key := set + "\x00" + base + "\x00" + group + "\x00" + kind + "\x00" + scope
	sig := s.dataSig()
	s.rc.mu.Lock()
	e, hit := s.rc.lb[key]
	s.rc.mu.Unlock()
	if hit && e.sig == sig {
		return e.rows, nil
	}
	// 缓存没命中：先用全部核并行把这个集合的摘要读进缓存，下面现算时就不用一个文件一个文件串着解析
	s.prefetchIndexes(set)
	rows, err := s.leaderboardUncached(set, base, group, kind, scope)
	if err != nil {
		return nil, err
	}
	s.rc.mu.Lock()
	// base、group 是外面随便传的参数：条数到上限就整个清掉，免得被刷爆内存
	if s.rc.lb == nil || len(s.rc.lb) >= lbCacheMax {
		s.rc.lb = map[string]lbEntry{}
	}
	s.rc.lb[key] = lbEntry{sig, rows}
	s.rc.mu.Unlock()
	return rows, nil
}

// prefetchIndexes：并行读一个集合（空 = 全部）所有运行的摘要进缓存。已经在缓存里、文件没变的只 stat 一下
func (s *Store) prefetchIndexes(set string) {
	var names []string
	for _, info := range s.Runs(set) {
		if n, _ := info["run"].(string); n != "" {
			names = append(names, n)
		}
	}
	jobs := make(chan string)
	var wg sync.WaitGroup
	for range max(1, min(runtime.NumCPU(), len(names))) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := range jobs {
				_, _ = s.Index(n)
			}
		}()
	}
	for _, n := range names {
		jobs <- n
	}
	close(jobs)
	wg.Wait()
}

// Warm：服务启动后在后台跑一次，把每个集合的默认排行（排行页打开时的那个请求）算好放进缓存。
// 之后只有改过的运行会重读，所以除了刚启动的这几秒，没人会碰到冷请求
func (s *Store) Warm() {
	t0 := time.Now()
	s.prefetchIndexes("")
	sets := s.Sets()
	for _, set := range sets {
		_, _ = s.Leaderboard(set, "", "", "template", "")
	}
	log.Printf("缓存预热：%d 个集合的默认排行，用时 %v", len(sets), time.Since(t0).Round(time.Millisecond))
}
