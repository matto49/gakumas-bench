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

func TestMergeRunsKeepsFixedMachineSeparate(t *testing.T) {
	info := func(run string, fixed bool) map[string]any {
		m := map[string]any{"run": run, "finished": "2026-11-10T00:00:00Z", "kind": "template", "algo": "external:x", "label": "x",
			"step_seconds": 5, "by": "matto", "mode": "self", "engine": map[string]any{"rules_version": 55}}
		if fixed {
			m["fixed_machine"] = true
		}
		return m
	}
	a := lbRun{info: info("fixed", true), names: []string{"fixed"}, eps: map[key]EpisodeSummary{{"A", 0}: {Score: 1}}}
	b := lbRun{info: info("own", false), names: []string{"own"}, eps: map[key]EpisodeSummary{{"A", 0}: {Score: 2}}}
	if out := mergeRuns([]lbRun{a, b}, false); len(out) != 2 {
		t.Fatalf("固定机器和自己机器的运行耗时不可比，不能合成一行：得到 %d 行", len(out))
	}
}

func TestFamilyOf(t *testing.T) {
	cases := map[string]string{
		"uinet-2.0beta-Abenddammerungseinsamkeit": "uinet", "uinet": "uinet", "pimc-vote-16w-2s": "pimc-vote",
		"oracle-30s": "oracle", "hiro-rules": "hiro-rules", "pimc-plus-v2": "pimc-plus", "asahi老师策略": "asahi老师策略",
		"UINet-Ver2.1-Kummertranen": "uinet", "uinet-Version3": "uinet", "my-algo-V.2": "my-algo", "pimc-vote-x": "pimc-vote-x",
	}
	for label, want := range cases {
		if got := familyOf(map[string]any{"label": label}); got != want {
			t.Errorf("familyOf(%q) = %q, want %q", label, got, want)
		}
	}
	if got := familyOf(map[string]any{"label": "my-net-3", "family": "UINet"}); got != "uinet" {
		t.Errorf("explicit family: %q", got)
	}
}
