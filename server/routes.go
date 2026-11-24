package main

// 路由：Gin。接口函数仍是 (w, r, 用户) 的写法，路径参数照旧用 r.PathValue 取（下面的 h / plain 把 Gin 的参数抄进去）；
// 认谁登录是两个中间件：openMW（谁都能看，认得出就带上用户名）、authMW（要令牌，没有回 401）。
// 包在 Gin 外面的两层要在路由匹配之前做，所以不是 Gin 中间件：withSetAliases（题集旧名改新名）、headAsGet（HEAD 当 GET 路由）。

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
)

const ctxUser = "gkb_user"

type userHandler = func(http.ResponseWriter, *http.Request, string)

// pathValues：Gin 的路径参数抄进 r，接口函数里 r.PathValue("set") 照旧能用
func pathValues(c *gin.Context) {
	for _, p := range c.Params {
		c.Request.SetPathValue(p.Key, p.Value)
	}
}

// h：带用户名的接口函数（用户名由 openMW / authMW 放进上下文）
func h(fn userHandler) gin.HandlerFunc {
	return func(c *gin.Context) {
		pathValues(c)
		fn(c.Writer, c.Request, c.GetString(ctxUser))
	}
}

// plain：不需要用户名的接口函数（登录流程、静态文件）
func plain(fn http.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		pathValues(c)
		fn(c.Writer, c.Request)
	}
}

// openMW：谁都能看；认得出令牌就带上用户名
func (a *App) openMW(c *gin.Context) {
	u, _ := a.userOf(c.Request)
	c.Set(ctxUser, u)
}

// authMW：要有效令牌。?token= 带来的令牌顺手种成 cookie（命令行工具打开网页时用）
func (a *App) authMW(c *gin.Context) {
	r := c.Request
	u, tok := a.userOf(r)
	if u == "" {
		fail(c.Writer, http.StatusUnauthorized, "需要有效令牌")
		c.Abort()
		return
	}
	if r.URL.Query().Get("token") != "" {
		http.SetCookie(c.Writer, &http.Cookie{Name: "gkb_token", Value: tok, HttpOnly: true, Secure: r.TLS != nil ||
			r.Header.Get("X-Forwarded-Proto") == "https", SameSite: http.SameSiteLaxMode, MaxAge: 180 * 86400, Path: "/"})
	}
	c.Set(ctxUser, u)
}

// headAsGet：HEAD 请求按 GET 找路由（标准库的 ServeMux 原来就这样）。响应体由 net/http 按原请求是 HEAD 丢掉
func headAsGet(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			r = r.Clone(r.Context())
			r.Method = http.MethodGet
		}
		next.ServeHTTP(w, r)
	})
}

// 强度榜、配置频率、首页小文件的名字：小写字母、数字、连字符
var staticName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// staticJSON：$static/<子目录>/<路径参数>.json，名字不合法或文件不在回 404；每次都问一下有没有更新（没变回 304）
func staticJSON(static, sub, param string) gin.HandlerFunc {
	return func(c *gin.Context) {
		name := c.Param(param)
		if !staticName.MatchString(name) {
			http.NotFound(c.Writer, c.Request)
			return
		}
		serveIfExists(c, filepath.Join(static, sub, name+".json"))
	}
}

func serveIfExists(c *gin.Context, p string) {
	if _, err := os.Stat(p); err != nil {
		http.NotFound(c.Writer, c.Request)
		return
	}
	c.Header("Cache-Control", "public, no-cache")
	http.ServeFile(c.Writer, c.Request, p)
}

// routes：整套路由。static = $DATA/static，web = 网页构建产物（web/dist）
func (app *App) routes(static, web string) http.Handler {
	gin.SetMode(gin.ReleaseMode)
	g := gin.New()
	g.RedirectTrailingSlash = false // 和原来一样：不自动重定向，找不到就是找不到
	g.RedirectFixedPath = false
	g.HandleMethodNotAllowed = true
	g.Use(gin.Recovery())

	api := g.Group("/api")
	open := api.Group("", app.openMW)
	auth := api.Group("", app.authMW)

	// 公开只读
	open.GET("/sets", h(app.handleSets))
	open.GET("/sets/:set/problems", h(app.handleProblems))
	open.GET("/sets/:set/seeds", h(app.handleSeeds)) // 题集开了 public_seeds 才公开
	open.GET("/leaderboard", h(app.handleLeaderboard))
	open.GET("/runs", h(app.handleRuns))
	open.GET("/runs/:run", h(app.handleRun))
	open.GET("/runs/:run/episodes/:id/:seed", h(app.handleEpisode))
	open.GET("/saves/:id", h(app.handleSave))
	open.GET("/sets/:set/saves", h(app.handleSetSaves))

	// 事先生成好的静态 JSON（$DATA/static/）
	api.GET("/catalog", func(c *gin.Context) {
		// 每次都问一下有没有更新（没变时回 304，不重新下载），换了目录马上生效
		c.Header("Cache-Control", "public, no-cache")
		// ?lang=zh：中文目录（cmd/catalog -zh 生成，卡名和效果文字用学マス汉化插件的翻译）；没有就回日文的
		name := "catalog.json"
		if c.Query("lang") == "zh" {
			if _, err := os.Stat(filepath.Join(static, "catalog.zh.json")); err == nil {
				name = "catalog.zh.json"
			}
		}
		http.ServeFile(c.Writer, c.Request, filepath.Join(static, name))
	})
	// 支援卡目录：python -m gkbench.supports 从完整主数据生成（日文、中文都在里面）
	api.GET("/supports", func(c *gin.Context) { serveIfExists(c, filepath.Join(static, "supports.json")) })
	api.GET("/supports/meta", func(c *gin.Context) { serveIfExists(c, filepath.Join(static, "supports.meta.json")) })
	// 配置频率：python -m gkbench.usage 生成 usage/<模式>.json（排行榜前 100 名里各卡出现的比例）
	api.GET("/usage/:mode", staticJSON(static, "usage", "mode"))
	// 偶像卡攻略：python -m gkbench.guides build 生成 guides/<模式>.json、<模式>-<日期>-<N>.json（不可变）和 manifest.json
	api.GET("/guides/:name", staticJSON(static, "guides", "name"))
	// 首页小文件：home 由 gkbench.homedata 生成（生日、新卡）；now（卡池、活动）和 updates（站内更新）手写
	api.GET("/site/:name", staticJSON(static, "site", "name"))
	// 角色强度榜：python -m gkbench.tierboard 导入（index.json 是目录，<id>.json 是一张榜）
	api.GET("/tiers/:id", staticJSON(static, "tiers", "id"))

	// 登录
	open.GET("/auth", h(app.handleAuthInfo))
	api.GET("/auth/github", plain(app.handleGithubStart))
	api.GET("/auth/github/callback", plain(app.handleGithubCallback))
	api.POST("/auth/register", plain(app.handleRegister))
	api.POST("/auth/login", plain(app.handlePasswordLogin))
	api.POST("/cli/login", plain(app.handleCLILoginStart))
	open.GET("/cli/login/:code", h(app.handleCLILoginInfo))
	auth.POST("/cli/login/:code/approve", h(app.handleCLILoginApprove))
	api.POST("/cli/login/token", plain(app.handleCLILoginToken))
	api.POST("/logout", plain(app.handleLogout))

	// 竞技场：不用登录（contest.go）
	api.GET("/contest/seasons", plain(app.handleContestSeasons))
	api.POST("/contest/sims", plain(app.handleContestSubmit))
	api.GET("/contest/sims/:id", plain(app.handleContestGet))
	api.DELETE("/contest/sims/:id", plain(app.handleContestCancel))

	// 出牌助手：不用登录，按 IP 限流（assist.go）
	as := api.Group("/assist/sessions")
	as.POST("", plain(assistLimitMW(app.handleAssistOpen)))
	as.POST("/:id/hand", plain(assistLimitMW(app.assistCall("assist_hand", withBody))))
	as.POST("/:id/numbers", plain(assistLimitMW(app.assistCall("assist_numbers", withBody))))
	as.POST("/:id/step", plain(assistLimitMW(app.assistCall("assist_step", withBody))))
	as.POST("/:id/undo", plain(assistLimitMW(app.assistCall("assist_undo", nil))))
	as.DELETE("/:id", plain(assistLimitMW(app.handleAssistClose)))

	// 要令牌
	auth.GET("/me", h(app.handleMe))
	auth.GET("/me/tokens", h(app.handleMyTokens))
	auth.POST("/me/password", h(app.handleSetPassword))
	auth.POST("/me/tokens", h(app.handleNewToken))
	auth.DELETE("/me/tokens/:id", h(app.handleRevokeToken))
	auth.GET("/me/runs", h(app.handleMyRuns))
	auth.GET("/me/jobs", h(app.handleMyJobs))
	auth.POST("/runs", h(app.handleUpload))
	auth.POST("/saves", h(app.handleSaveUpload))
	auth.POST("/sets", h(app.handleCreateSet))
	auth.PATCH("/sets/:set", h(app.handlePatchSet))
	auth.PATCH("/families/:family", h(app.handlePatchFamily))
	auth.POST("/sets/:set/problems", h(app.handleUploadProblems))
	auth.DELETE("/sets/:set/problems/:id", h(app.handleDeleteProblem))
	auth.GET("/jobs/:job", h(app.handleJob))
	auth.POST("/episodes", h(app.handleHostedStart))
	auth.POST("/episodes/:id/step", h(app.handleHostedStep))
	auth.POST("/episodes/:id/worlds", h(app.handleHostedWorlds))
	auth.DELETE("/episodes/:id", h(app.handleHostedAbort))
	auth.POST("/evals", h(app.handleEvalStart))
	auth.GET("/evals/:id", h(app.handleEvalStatus))
	auth.POST("/evals/:id/episodes", h(app.handleEvalEpisode))

	// 命令行工具：安装脚本和各平台的可执行文件放在 $DATA/static/cli/（server/cmd/gkbench/build.sh 生成）
	cli := filepath.Join(static, "cli")
	g.GET("/install.sh", func(c *gin.Context) {
		c.Header("Content-Type", "text/x-shellscript; charset=utf-8")
		c.Header("Cache-Control", "no-cache")
		http.ServeFile(c.Writer, c.Request, filepath.Join(cli, "install.sh"))
	})
	g.GET("/install.ps1", func(c *gin.Context) {
		c.Header("Content-Type", "text/plain; charset=utf-8")
		c.Header("Cache-Control", "no-cache")
		http.ServeFile(c.Writer, c.Request, filepath.Join(cli, "install.ps1"))
	})
	g.GET("/cli/*file", gin.WrapH(http.StripPrefix("/cli/", noCache(http.FileServer(http.Dir(cli))))))
	g.GET("/sprites/*file", gin.WrapH(http.StripPrefix("/sprites/", cacheFor(http.FileServer(http.Dir(filepath.Join(static, "sprites"))), 7*86400))))

	// 找不到：/api/ 下回 JSON 404，其余交给网页（前端路由）
	site := spa(web)
	g.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			fail(c.Writer, http.StatusNotFound, "没有这个接口")
			return
		}
		site.ServeHTTP(c.Writer, c.Request)
	})
	g.NoMethod(func(c *gin.Context) {
		fail(c.Writer, http.StatusMethodNotAllowed, "这个接口不接受 "+c.Request.Method)
	})

	return withSetAliases(headAsGet(g))
}
