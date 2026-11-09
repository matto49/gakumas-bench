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
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
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
	path := filepath.Join(data, "private", "tokens.json")
	tokens := map[string]any{}
	_ = readJSON(path, &tokens)
	h := sha256.Sum256([]byte(tok))
	tokens[hex.EncodeToString(h[:])] = map[string]any{"user": name, "created": now()}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := writeJSON(path, tokens, 0o600); err != nil {
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
		jobs: map[string]*Job{}, hosted: map[string]*Hosted{}}
	defer app.pool.Close()
	rep, _, err := app.pool.workers[0].Call(map[string]any{"op": "provenance"})
	if err != nil {
		log.Fatalf("引擎子进程起不来：%v", err)
	}
	app.engineInfo = rep["engine"]
	log.Printf("引擎 %v", app.engineInfo)

	mux := http.NewServeMux()
	A := app.auth
	O := app.open
	// 公开只读
	mux.HandleFunc("GET /api/sets", O(app.handleSets))
	mux.HandleFunc("GET /api/sets/{set}/problems", O(app.handleProblems))
	mux.HandleFunc("GET /api/sets/{set}/seeds", O(app.handleSeeds)) // 题集开了 public_seeds 才公开
	mux.HandleFunc("GET /api/leaderboard", O(app.handleLeaderboard))
	mux.HandleFunc("GET /api/runs", O(app.handleRuns))
	mux.HandleFunc("GET /api/runs/{run}", O(app.handleRun))
	mux.HandleFunc("GET /api/runs/{run}/episodes/{problem}/{seed}", O(app.handleEpisode))
	static := filepath.Join(data, "static")
	mux.HandleFunc("GET /api/catalog", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=3600")
		http.ServeFile(w, r, filepath.Join(static, "catalog.json"))
	})
	mux.Handle("GET /sprites/", http.StripPrefix("/sprites/", cacheFor(http.FileServer(http.Dir(filepath.Join(static, "sprites"))), 7*86400)))
	// 要令牌
	mux.HandleFunc("GET /api/me", A(app.handleMe))
	mux.HandleFunc("POST /api/logout", func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "gkb_token", Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
		writeJSONResp(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("GET /api/me/runs", A(app.handleMyRuns))
	mux.HandleFunc("GET /api/me/jobs", A(app.handleMyJobs))
	mux.HandleFunc("POST /api/runs", A(app.handleUpload))
	mux.HandleFunc("GET /api/jobs/{job}", A(app.handleJob))
	mux.HandleFunc("POST /api/episodes", A(app.handleHostedStart))
	mux.HandleFunc("POST /api/episodes/{id}/step", A(app.handleHostedStep))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { fail(w, 404, "没有这个接口") })
	mux.Handle("/", spa(env("GKBENCH_WEB", "../web/dist")))

	addr := env("GKBENCH_ADDR", "127.0.0.1:19150")
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
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
