package main

// 每局摘要的 SQLite 索引：$DATA/cache/episodes.sqlite。
// 正本仍是运行目录里的文件（index.json / index.jsonl / episodes.jsonl.zst），写入流程不变；
// 这里按文件的修改时间和大小同步：文件没变直接查库，变了就把这个运行整个重新导入。
// 好处：请求只取要用的行和列（排行不读出牌路线、题名；存档按题号查），重启后不用重新解析几十 MB 的 JSON，
// 内存里也不用常驻全部摘要。库坏了或格式升级，删掉文件下次自动重建。

import (
	"database/sql"
	"encoding/binary"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	fastjson "github.com/goccy/go-json"
	_ "modernc.org/sqlite"
)

const episodeDBVersion = 1 // 表结构改了就加一，旧库自动丢掉重建

type episodeDB struct {
	once sync.Once
	db   *sql.DB
	err  error

	wmu   sync.Mutex             // 导入（写库）一次一个
	mu    sync.Mutex             // 保护 known
	known map[string]sourceStamp // 运行 -> 库里那份是按哪个文件、什么时候的版本导入的
}

type sourceStamp struct {
	path  string
	stamp fileStamp
	err   string // 文件读坏了也记下来：文件不变就不再每次解压一遍再失败
}

const episodeSchema = `
CREATE TABLE IF NOT EXISTS episodes (
	run TEXT NOT NULL, ord INTEGER NOT NULL,
	id TEXT NOT NULL, seed_index INTEGER NOT NULL,
	name TEXT, fixed_id TEXT, exam_sha TEXT,
	score REAL, finished INTEGER, decisions INTEGER, secs REAL, over_steps INTEGER,
	err TEXT, at TEXT, route TEXT,
	tags TEXT,     -- JSON
	step_ms BLOB,  -- 小端 float64 数组，原值不丢精度
	types TEXT,    -- JSON
	PRIMARY KEY (run, ord)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS episodes_problem ON episodes (run, id);
CREATE TABLE IF NOT EXISTS sources (
	run TEXT PRIMARY KEY, path TEXT, mod INTEGER, size INTEGER, err TEXT
);`

func (s *Store) episodeDBPath() string { return filepath.Join(s.Data, "cache", "episodes.sqlite") }

// edb：第一次用时打开（或建）库
func (s *Store) edb() (*sql.DB, error) {
	e := &s.ep
	e.once.Do(func() {
		if err := os.MkdirAll(filepath.Dir(s.episodeDBPath()), 0o755); err != nil {
			e.err = err
			return
		}
		e.db, e.err = openEpisodeDB(s.episodeDBPath())
		if e.err != nil {
			return
		}
		e.known = map[string]sourceStamp{}
		rows, err := e.db.Query(`SELECT run, path, mod, size, err FROM sources`)
		if err != nil {
			e.err = err
			return
		}
		defer rows.Close()
		for rows.Next() {
			var run, path, errS string
			var mod, size int64
			if rows.Scan(&run, &path, &mod, &size, &errS) == nil {
				e.known[run] = sourceStamp{path, fileStamp{timeOfNano(mod), size}, errS}
			}
		}
	})
	return e.db, e.err
}

func openEpisodeDB(path string) (*sql.DB, error) {
	open := func() (*sql.DB, error) {
		db, err := sql.Open("sqlite", "file:"+path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(10000)&_pragma=synchronous(NORMAL)")
		if err != nil {
			return nil, err
		}
		return db, db.Ping()
	}
	db, err := open()
	if err != nil {
		return nil, err
	}
	var v int
	_ = db.QueryRow(`PRAGMA user_version`).Scan(&v)
	if v != episodeDBVersion {
		// 新库或旧格式：整个丢掉重建（数据都能从运行目录的文件重新导入）
		_ = db.Close()
		for _, suf := range []string{"", "-wal", "-shm"} {
			_ = os.Remove(path + suf)
		}
		if db, err = open(); err != nil {
			return nil, err
		}
		if _, err = db.Exec(episodeSchema); err != nil {
			return nil, err
		}
		if _, err = db.Exec(`PRAGMA user_version = ` + itoa(episodeDBVersion)); err != nil {
			return nil, err
		}
	}
	return db, nil
}

// Close：关库（测试里模拟重启用；服务退出时也调）
func (s *Store) Close() {
	if s.ep.db != nil {
		_ = s.ep.db.Close()
	}
}

// syncRun：库里这个运行是不是最新的；不是就从文件重新导入。返回文件本身读坏时的错误
func (s *Store) syncRun(run string) error {
	db, err := s.edb()
	if err != nil {
		return err
	}
	dir := s.RunDir(run)
	src, st, ok := indexSource(dir)
	e := &s.ep
	e.mu.Lock()
	k, have := e.known[run]
	e.mu.Unlock()
	if ok && have && k.path == src && k.stamp == st {
		if k.err != "" {
			return errors.New(k.err)
		}
		return nil
	}
	if !ok { // 运行目录没了：库里也删
		if have {
			e.wmu.Lock()
			_, _ = db.Exec(`DELETE FROM episodes WHERE run = ?`, run)
			_, _ = db.Exec(`DELETE FROM sources WHERE run = ?`, run)
			e.wmu.Unlock()
			e.mu.Lock()
			delete(e.known, run)
			e.mu.Unlock()
		}
		return os.ErrNotExist
	}
	eps, rerr := s.indexUncached(run)
	errS := ""
	if rerr != nil {
		errS = rerr.Error()
	}
	// 从 episodes 生成时会顺手写 index.json：按导入后的来源记版本，下次直接命中
	if s2, st2, ok2 := indexSource(dir); ok2 {
		src, st = s2, st2
	}
	if err := s.importRun(run, eps, sourceStamp{src, st, errS}); err != nil {
		return err
	}
	return rerr
}

func (s *Store) importRun(run string, eps []EpisodeSummary, src sourceStamp) error {
	db, _ := s.edb()
	e := &s.ep
	e.wmu.Lock()
	defer e.wmu.Unlock()
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM episodes WHERE run = ?`, run); err != nil {
		return err
	}
	ins, err := tx.Prepare(`INSERT INTO episodes (run, ord, id, seed_index, name, fixed_id, exam_sha, score, finished, decisions, secs, over_steps, err, at, route, tags, step_ms, types)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer ins.Close()
	for i, x := range eps {
		var tags, types []byte
		if x.Tags != nil {
			tags, _ = fastjson.Marshal(x.Tags)
		}
		if x.Types != nil {
			types, _ = fastjson.Marshal(x.Types)
		}
		if _, err := ins.Exec(run, i, x.ID, x.SeedIndex, x.Name, x.FixedID, x.ExamSha, x.Score, x.Finished, x.Decisions, x.Secs, x.Over,
			x.Err, x.At, x.Route, nullBytes(tags), packFloats(x.StepMs), nullBytes(types)); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`INSERT OR REPLACE INTO sources (run, path, mod, size, err) VALUES (?, ?, ?, ?, ?)`,
		run, src.path, src.stamp.mod.UnixNano(), src.stamp.size, src.err); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	e.mu.Lock()
	e.known[run] = src
	e.mu.Unlock()
	return nil
}

// Index：一次运行的全部局（全部字段，按文件顺序）。运行页、评测进度用
func (s *Store) Index(run string) ([]EpisodeSummary, error) {
	if err := s.syncRun(run); err != nil {
		return nil, err
	}
	return s.queryEpisodes(`SELECT id, seed_index, name, fixed_id, exam_sha, score, finished, decisions, secs, over_steps, err, at, route, tags, step_ms, types
		FROM episodes WHERE run = ? ORDER BY ord`, run)
}

// ProblemEpisodes：一次运行里某道题的局（全部字段）。存档、答案用：按题号走索引，不读整个运行
func (s *Store) ProblemEpisodes(run, id string) ([]EpisodeSummary, error) {
	if err := s.syncRun(run); err != nil {
		return nil, err
	}
	return s.queryEpisodes(`SELECT id, seed_index, name, fixed_id, exam_sha, score, finished, decisions, secs, over_steps, err, at, route, tags, step_ms, types
		FROM episodes WHERE run = ? AND id = ? ORDER BY ord`, run, id)
}

// lbEpisodes：排行要用的列（分数、局号、打完没有、出错、超时、耗时、每步毫秒）；withTags 时带标签（按轮次 / 考试分组）
func (s *Store) lbEpisodes(run string, withTags bool) ([]EpisodeSummary, error) {
	if err := s.syncRun(run); err != nil {
		return nil, err
	}
	tags := "NULL"
	if withTags {
		tags = "tags"
	}
	db, _ := s.edb()
	rows, err := db.Query(`SELECT id, seed_index, score, finished, decisions, secs, over_steps, err, step_ms, `+tags+`
		FROM episodes WHERE run = ? ORDER BY ord`, run)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EpisodeSummary
	for rows.Next() {
		var x EpisodeSummary
		var errS sql.NullString
		var steps, tg []byte
		if err := rows.Scan(&x.ID, &x.SeedIndex, &x.Score, &x.Finished, &x.Decisions, &x.Secs, &x.Over, &errS, &steps, &tg); err != nil {
			return nil, err
		}
		x.Err = errS.String
		x.StepMs = unpackFloats(steps)
		if tg != nil {
			_ = fastjson.Unmarshal(tg, &x.Tags)
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (s *Store) queryEpisodes(q string, args ...any) ([]EpisodeSummary, error) {
	db, _ := s.edb()
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EpisodeSummary
	for rows.Next() {
		var x EpisodeSummary
		var name, fixed, sha, errS, at, route sql.NullString
		var tags, steps, types []byte
		if err := rows.Scan(&x.ID, &x.SeedIndex, &name, &fixed, &sha, &x.Score, &x.Finished, &x.Decisions, &x.Secs, &x.Over,
			&errS, &at, &route, &tags, &steps, &types); err != nil {
			return nil, err
		}
		x.Name, x.FixedID, x.ExamSha, x.Err, x.At, x.Route = name.String, fixed.String, sha.String, errS.String, at.String, route.String
		x.StepMs = unpackFloats(steps)
		if tags != nil {
			_ = fastjson.Unmarshal(tags, &x.Tags)
		}
		if types != nil {
			_ = fastjson.Unmarshal(types, &x.Types)
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// 每步毫秒存成小端 float64：nil 存 NULL、空数组存空 blob，读回来和原来一样
func packFloats(xs []float64) any {
	if xs == nil {
		return nil
	}
	b := make([]byte, 8*len(xs))
	for i, x := range xs {
		binary.LittleEndian.PutUint64(b[8*i:], math.Float64bits(x))
	}
	return b
}

func unpackFloats(b []byte) []float64 {
	if b == nil {
		return nil
	}
	out := make([]float64, len(b)/8)
	for i := range out {
		out[i] = math.Float64frombits(binary.LittleEndian.Uint64(b[8*i:]))
	}
	return out
}

func timeOfNano(n int64) time.Time { return time.Unix(0, n) }

func itoa(n int) string { return strconv.Itoa(n) }

func nullBytes(b []byte) any {
	if b == nil {
		return nil
	}
	return string(b)
}
