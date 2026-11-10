package main

import "testing"

func TestDeriveTemplateSeeds(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	a := deriveTemplateSeeds(key, "AF-TEST0001", nil, TemplateSeeds)
	b := deriveTemplateSeeds(key, "AF-TEST0001", nil, TemplateSeeds)
	if len(a) != TemplateSeeds {
		t.Fatalf("要 %d 个，得到 %d", TemplateSeeds, len(a))
	}
	seen := map[int64]bool{}
	for i, x := range a {
		if x != b[i] {
			t.Fatal("同一私钥、同一题族应该得到同一组种子")
		}
		if x < 1 || x > 1<<31-2 || seen[x] {
			t.Fatalf("种子 %d 越界或重复", x)
		}
		seen[x] = true
	}
	// 固定种子题用过的种子要跳过
	c := deriveTemplateSeeds(key, "AF-TEST0001", map[int64]bool{a[0]: true}, TemplateSeeds)
	if c[0] == a[0] || c[0] != a[1] {
		t.Fatal("没有跳过要避开的种子")
	}
	// 换私钥或换题族，种子全变
	d := deriveTemplateSeeds([]byte("another-key-another-key-another!"), "AF-TEST0001", nil, TemplateSeeds)
	e := deriveTemplateSeeds(key, "AF-TEST0002", nil, TemplateSeeds)
	if d[0] == a[0] || e[0] == a[0] {
		t.Fatal("私钥或题族不同，种子却相同")
	}
}
