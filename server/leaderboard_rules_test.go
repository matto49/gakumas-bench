package main

import (
	"math"
	"path/filepath"
	"testing"
)

// 改一次已写好的运行的表头字段（规则版本、上限与否等）
func patchRun(t *testing.T, s *Store, run string, f func(map[string]any)) {
	t.Helper()
	p := filepath.Join(s.RunDir(run), "run.json")
	var info map[string]any
	if err := readJSON(p, &info); err != nil {
		t.Fatal(err)
	}
	f(info)
	if err := writeJSON(p, info, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestOracleIsPerRulesVersion(t *testing.T) {
	s := &Store{Data: t.TempDir()}
	writeTemplateRun(t, s, "bk59", "best-known", map[string][]float64{"A": {100}})
	writeTemplateRun(t, s, "bk65", "best-known", map[string][]float64{"A": {200}})
	writeTemplateRun(t, s, "algo59", "algo", map[string][]float64{"A": {50}})
	writeTemplateRun(t, s, "algo65", "algo", map[string][]float64{"A": {50}})
	for _, r := range []string{"bk59", "bk65"} {
		patchRun(t, s, r, func(m map[string]any) { m["privileged"] = true })
	}
	for _, r := range []string{"bk65", "algo65"} {
		patchRun(t, s, r, func(m map[string]any) { m["engine"] = map[string]any{"rules_version": 65} })
	}
	patchRun(t, s, "algo65", func(m map[string]any) { m["sees"] = "seed" })

	rows, err := s.Leaderboard("hif", "", "", "template", "")
	if err != nil {
		t.Fatal(err)
	}
	var r59, r65 *Row
	for i := range rows {
		if rows[i].Label != "algo" {
			continue
		}
		if rows[i].Run == "algo59" {
			r59 = &rows[i]
		} else {
			r65 = &rows[i]
		}
	}
	if r59 == nil || r65 == nil || r59.VsOracle == nil || r65.VsOracle == nil {
		t.Fatalf("两个规则版本各一行、都有相对上限：%+v", rows)
	}
	if math.Abs(r59.VsOracle.Geo-0.5) > 1e-9 || math.Abs(r65.VsOracle.Geo-0.25) > 1e-9 {
		t.Fatalf("规则 59 的行要除以 59 的上限（0.5），65 的除以 65 的（0.25）：%v %v", r59.VsOracle.Geo, r65.VsOracle.Geo)
	}
	if !r65.SeesSeed || r59.SeesSeed {
		t.Fatalf("运行表头写了 sees=seed 就标看牌序：59=%v 65=%v", r59.SeesSeed, r65.SeesSeed)
	}
}
