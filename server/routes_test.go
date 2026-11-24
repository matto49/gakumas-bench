package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 整套路由（Gin）：和换框架前的行为一致——前端路由回落 index.html、未知接口 JSON 404、方法不对 405、
// HEAD 能用、路径参数、题集别名、静态文件的缓存头

func routesApp(t *testing.T) (*App, http.Handler, string) {
	t.Helper()
	data := t.TempDir()
	static := filepath.Join(data, "static")
	web := filepath.Join(data, "web")
	for _, d := range []string{filepath.Join(static, "usage"), filepath.Join(static, "sprites"), filepath.Join(web, "assets")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	_ = os.WriteFile(filepath.Join(web, "index.html"), []byte("<!doctype html>spa"), 0o644)
	_ = os.WriteFile(filepath.Join(web, "assets", "app-abc.js"), []byte("js"), 0o644)
	_ = os.WriteFile(filepath.Join(static, "usage", "hif.json"), []byte(`{"mode":"hif"}`), 0o644)
	_ = os.WriteFile(filepath.Join(static, "sprites", "x.webp"), []byte("img"), 0o644)
	app := &App{store: &Store{Data: data}}
	return app, app.routes(static, web), data
}

func serve(h http.Handler, method, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(method, path, nil))
	return w
}

func TestRoutesSPAFallbackAndAssets(t *testing.T) {
	_, h, _ := routesApp(t)
	for _, p := range []string{"/", "/tiers/hif-koinsho-202611", "/usage"} {
		w := serve(h, "GET", p)
		if w.Code != 200 || !strings.Contains(w.Body.String(), "spa") || w.Header().Get("Cache-Control") != "no-cache" {
			t.Errorf("%s：要回 index.html（no-cache），得到 %d %q %q", p, w.Code, w.Body.String(), w.Header().Get("Cache-Control"))
		}
	}
	if w := serve(h, "GET", "/assets/app-abc.js"); w.Code != 200 || !strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
		t.Errorf("带哈希的静态文件长缓存：%d %q", w.Code, w.Header().Get("Cache-Control"))
	}
	if w := serve(h, "GET", "/assets/missing.js"); w.Code != 404 {
		t.Errorf("缺的 assets 不回 index.html：%d", w.Code)
	}
	if w := serve(h, "GET", "/sprites/x.webp"); w.Code != 200 || !strings.Contains(w.Header().Get("Cache-Control"), "max-age=604800") {
		t.Errorf("小图缓存 7 天：%d %q", w.Code, w.Header().Get("Cache-Control"))
	}
}

func TestRoutesAPIErrors(t *testing.T) {
	_, h, _ := routesApp(t)
	w := serve(h, "GET", "/api/nope")
	var j map[string]any
	if w.Code != 404 || json.Unmarshal(w.Body.Bytes(), &j) != nil || j["detail"] == nil {
		t.Errorf("未知接口要 JSON 404：%d %s", w.Code, w.Body.String())
	}
	if w := serve(h, "PUT", "/api/sets"); w.Code != 405 {
		t.Errorf("方法不对要 405：%d", w.Code)
	}
	if w := serve(h, "GET", "/api/me"); w.Code != 401 {
		t.Errorf("要令牌的接口没令牌 401：%d", w.Code)
	}
}

func TestRoutesParamsHeadAndAliases(t *testing.T) {
	_, h, data := routesApp(t)
	if w := serve(h, "GET", "/api/usage/hif"); w.Code != 200 || !strings.Contains(w.Body.String(), `"hif"`) {
		t.Errorf("路径参数：%d %s", w.Code, w.Body.String())
	}
	if w := serve(h, "GET", "/api/usage/Bad_Name"); w.Code != 404 {
		t.Errorf("名字不合法 404：%d", w.Code)
	}
	if w := serve(h, "HEAD", "/api/usage/hif"); w.Code != 200 {
		t.Errorf("HEAD 要能用：%d", w.Code)
	}
	if w := serve(h, "HEAD", "/"); w.Code != 200 {
		t.Errorf("HEAD 首页：%d", w.Code)
	}
	// 题集别名：hif-live → hif（题目目录只有 hif）
	dir := filepath.Join(data, "problems", "hif")
	_ = os.MkdirAll(dir, 0o755)
	_ = os.WriteFile(filepath.Join(dir, "AS-1.gksave.json"), []byte(`{"id":"AS-1"}`), 0o644)
	a, b := serve(h, "GET", "/api/sets/hif-live/problems"), serve(h, "GET", "/api/sets/hif/problems")
	if a.Code != 200 || a.Body.String() != b.Body.String() {
		t.Errorf("别名和本名要回一样的：%d %s / %s", a.Code, a.Body.String(), b.Body.String())
	}
}

func TestRoutesGuides(t *testing.T) {
	_, h, data := routesApp(t)
	dir := filepath.Join(data, "static", "guides")
	_ = os.MkdirAll(dir, 0o755)
	_ = os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"schema":1}`), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "hajime-20261120-1.json"), []byte(`{"mode":"hajime"}`), 0o644)
	for p, want := range map[string]string{"/api/guides/manifest": `"schema"`, "/api/guides/hajime-20261120-1": `"hajime"`} {
		if w := serve(h, "GET", p); w.Code != 200 || !strings.Contains(w.Body.String(), want) {
			t.Errorf("%s：%d %s", p, w.Code, w.Body.String())
		}
	}
	if w := serve(h, "GET", "/api/guides/nia"); w.Code != 404 {
		t.Errorf("没有的包 404：%d", w.Code)
	}
	if w := serve(h, "GET", "/guide/i_card-shro-3-007"); w.Code != 200 || !strings.Contains(w.Body.String(), "spa") {
		t.Errorf("攻略页走网页：%d", w.Code)
	}
}
