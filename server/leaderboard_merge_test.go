package main

import "testing"

func TestMergeRunsSameAlgo(t *testing.T) {
	info := func(run, fin string, rules int) map[string]any {
		return map[string]any{"run": run, "finished": fin, "kind": "template", "algo": "external:uinet", "label": "uinet",
			"params": map[string]any{"threads": 4}, "step_seconds": 5, "by": "matto", "mode": "hosted",
			"engine": map[string]any{"rules_version": rules}}
	}
	old := lbRun{info: info("old", "2026-11-09T14:23:18Z", 55), names: []string{"old"},
		eps: map[key]EpisodeSummary{{"A", 0}: {Score: 1}, {"B", 0}: {Score: 2}}}
	newer := lbRun{info: info("new", "2026-11-10T08:21:41Z", 55), names: []string{"new"},
		eps: map[key]EpisodeSummary{{"B", 0}: {Score: 20}, {"C", 0}: {Score: 30}}}
	other := lbRun{info: info("v56", "2026-11-11T00:00:00Z", 56), names: []string{"v56"},
		eps: map[key]EpisodeSummary{{"A", 0}: {Score: 9}}}
	out := mergeRuns([]lbRun{newer, other, old}, false)
	if len(out) != 2 {
		t.Fatalf("规则版本相同的两次应合成一行、不同版本单独一行，得到 %d 行", len(out))
	}
	m := out[0]
	if m.info["run"] != "new" || len(m.names) != 2 || m.names[0] != "old" || m.names[1] != "new" {
		t.Fatalf("合并行应以最新运行为表头、按旧到新记运行：%v %v", m.info["run"], m.names)
	}
	if m.count != 3 || m.eps[key{"B", 0}].Score != 20 || m.eps[key{"A", 0}].Score != 1 {
		t.Fatalf("同题同种子应取最新那次、其余并起来：count=%d B=%v A=%v", m.count, m.eps[key{"B", 0}].Score, m.eps[key{"A", 0}].Score)
	}
}
