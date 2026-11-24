// gkbench 服务器：接口 + 网页。
//
// 环境变量
//
//	GKBENCH_DATA     数据目录（题库、种子、令牌、运行），默认 ~/github/gakumas-bench-data
//	GKBENCH_ADDR     监听地址，默认 127.0.0.1:19150
//	GKBENCH_WEB      网页目录（web/ 打包出的 dist），默认 ../web/dist
//	GKBENCH_WORKER   引擎子进程命令，默认 ".venv/bin/python -m gkbench.worker"（在 GKBENCH_WORKER_DIR 下执行）
//	GKBENCH_WORKER_DIR  默认 ..（仓库根目录）
//	GKBENCH_WORKERS  子进程个数，默认 2
//
// 命令
//
//	gkbench-server                    启动
//	gkbench-server add-token 名字 文件   生成令牌，只写进文件（权限 600），不在终端显示
//	gkbench-server public-seeds 题集 on|off  开发集种子是否公开下载（测试集种子永不公开）
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func addToken(data, name, out string) error {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	tok := base64.RawURLEncoding.EncodeToString(b)
	s := &Store{Data: data}
	tokMu.Lock()
	m := s.loadTokens()
	m[hashToken(tok)] = TokenInfo{User: name, Kind: "cli", Name: "管理员发放", Created: now()}
	err := s.saveTokens(m)
	tokMu.Unlock()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(out), 0o700); err != nil {
		return err
	}
	return os.WriteFile(out, []byte(tok+"\n"), 0o600)
}

// 网页：静态文件，找不到的路径回 index.html（前端路由）
func spa(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Join(dir, filepath.Clean("/"+r.URL.Path))
		if st, err := os.Stat(p); err != nil || st.IsDir() {
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
			return
		}
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		fs.ServeHTTP(w, r)
	})
}

func cacheFor(h http.Handler, seconds int) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d", seconds))
		h.ServeHTTP(w, r)
	})
}

func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		h.ServeHTTP(w, r)
	})
}

func setPublicSeeds(data, set string, on bool) error {
	path := filepath.Join(data, "private", "sets.json")
	m := map[string]SetConfig{}
	_ = readJSON(path, &m)
	c := m[set]
	c.PublicSeeds = on
	m[set] = c
	return writeJSON(path, m, 0o600)
}

func main() {
	home, _ := os.UserHomeDir()
	data := env("GKBENCH_DATA", filepath.Join(home, "github/gakumas-bench-data"))
	if len(os.Args) == 4 && os.Args[1] == "add-token" {
		if err := addToken(data, os.Args[2], os.Args[3]); err != nil {
			log.Fatal(err)
		}
		fmt.Printf("令牌已写入 %s（不在终端显示）\n", os.Args[3])
		return
	}
	if len(os.Args) == 4 && os.Args[1] == "public-seeds" {
		on := os.Args[3] == "on"
		if err := setPublicSeeds(data, os.Args[2], on); err != nil {
			log.Fatal(err)
		}
		fmt.Printf("题集 %s 开发集种子公开：%v\n", os.Args[2], on)
		return
	}
	n, _ := strconv.Atoi(env("GKBENCH_WORKERS", "2"))
	if n < 1 {
		n = 1
	}
	argv := strings.Fields(env("GKBENCH_WORKER", ".venv/bin/python -m gkbench.worker"))
	app := &App{store: &Store{Data: data}, pool: NewPool(n, argv, env("GKBENCH_WORKER_DIR", "..")),
		jobs: map[string]*Job{}, hosted: map[string]*Hosted{}, github: loadGithubConf()}
	defer app.pool.Close()
	rep, _, err := app.pool.workers[0].Call(map[string]any{"op": "provenance"})
	if err != nil {
		log.Fatalf("引擎子进程起不来：%v", err)
	}
	app.engineInfo = rep["engine"]
	app.contest = ContestConf{Root: os.Getenv("GKBENCH_CONTEST_ROOT"), Python: env("GKBENCH_CONTEST_PYTHON", "python3")}
	if app.contest.Root == "" {
		app.contest.Python = ""
	}
	app.contestRecover() // 上次没跑完的竞技场模拟标失败，清掉 7 天前的
	go app.contestGCLoop(context.Background())
	log.Printf("引擎 %v", app.engineInfo)

	// 路由在 routes.go（Gin）
	handler := app.routes(filepath.Join(data, "static"), env("GKBENCH_WEB", "../web/dist"))
	go app.store.Warm()     // 后台预热排行缓存（runcache.go），不挡着开始监听
	defer app.store.Close() // 每局摘要的 SQLite（episodedb.go）正常关，WAL 写回主文件

	addr := env("GKBENCH_ADDR", "127.0.0.1:19150")
	srv := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		log.Printf("监听 %s，数据 %s，引擎子进程 %d 个", addr, data, n)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
