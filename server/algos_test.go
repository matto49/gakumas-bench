package main

import "testing"

func TestAlgoDocBuiltin(t *testing.T) {
	cases := map[string]string{"external:uinet": "screen", "external:pimc-vote": "screen", "external:oracle": "seed", "external:greedy": "screen"}
	for algo, sees := range cases {
		d := algoDoc(map[string]any{"algo": algo})
		if d == nil || d.Source != "builtin" || d.Sees != sees || len(d.Links) == 0 {
			t.Fatalf("%s: %+v", algo, d)
		}
	}
	// 别人起的同前缀名字不套内置说明
	if d := algoDoc(map[string]any{"algo": "external:pimc-mine"}); d != nil {
		t.Fatalf("pimc-mine 不该有内置说明：%+v", d)
	}
	// 旧格式 {name: ...}
	if d := algoDoc(map[string]any{"algo": map[string]any{"name": "random"}}); d == nil {
		t.Fatal("旧格式 algo 对不上")
	}
}

func TestAlgoDocSubmitter(t *testing.T) {
	h := map[string]any{"algo": "external:uinet"}
	withAbout(h, map[string]any{
		"summary": "  我的网络  ",
		"detail":  []any{"第一条", "", 3},
		"sees":    "screen",
		"links":   []any{map[string]any{"title": "repo", "url": "https://example.com/x"}, map[string]any{"title": "bad", "url": "javascript:alert(1)"}},
	})
	d := algoDoc(h)
	if d == nil || d.Source != "submitter" || d.Summary != "我的网络" || len(d.Detail) != 1 || len(d.Links) != 1 || d.Links[0].URL != "https://example.com/x" {
		t.Fatalf("%+v", d)
	}
	// 没有 summary 时什么都不写
	h2 := map[string]any{}
	withAbout(h2, map[string]any{"links": []any{map[string]any{"url": "https://example.com"}}})
	if len(h2) != 0 {
		t.Fatalf("没有 summary 不该写：%v", h2)
	}
}
