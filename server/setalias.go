package main

// 集合合并（2026-11-11）：按模式合成 hif / nia / hajime / idolroad 四个集合，旧集合名都指向新集合。
// 请求里出现旧名（路径 /api/sets/<旧名>/…、查询参数 set=、请求体的 set、上传成绩的 run.json）一律按新名处理，
// 这样旧链接、旧脚本、命令行 --set 旧名都还能用。网页另有一份同样的表（web/src/lib/sets.tsx），把旧地址跳到新集合加筛选。

import (
	"net/http"
	"strings"
)

var setAliases = map[string]string{
	"hif-live":             "hif",
	"hif-history":          "hif",
	"hif-yuzeis":           "hif",
	"nia-history":          "nia",
	"nia-yuzeis":           "nia",
	"hajime-history":       "hajime",
	"hajime-yuzeis":        "hajime",
	"hajime-lesson-yuzeis": "hajime",
	"idolroad-yuzeis":      "idolroad",
}

// canonicalSet 旧集合名 → 新集合名；不是旧名的原样返回
func canonicalSet(s string) string {
	if n, ok := setAliases[s]; ok {
		return n
	}
	return s
}

// withSetAliases 进路由前把路径和查询参数里的旧集合名换成新名
func withSetAliases(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		const prefix = "/api/sets/"
		if p := r.URL.Path; strings.HasPrefix(p, prefix) {
			rest := p[len(prefix):]
			name, tail, _ := strings.Cut(rest, "/")
			if n, ok := setAliases[name]; ok {
				r.URL.Path = prefix + n
				if tail != "" || strings.HasSuffix(rest, "/") {
					r.URL.Path += "/" + tail
				}
				r.URL.RawPath = ""
			}
		}
		if q := r.URL.Query(); q.Get("set") != "" {
			if n, ok := setAliases[q.Get("set")]; ok {
				q.Set("set", n)
				r.URL.RawQuery = q.Encode()
			}
		}
		h.ServeHTTP(w, r)
	})
}
