package main

import "testing"

func TestUploadAttribution(t *testing.T) {
	doc := map[string]any{"meta": map[string]any{"by": "yuzeis", "source": map[string]any{"kind": "capture"}}}
	if by, src := uploadAttribution("matto", doc); by != "yuzeis" || src != "capture" {
		t.Errorf("管理员代填：%q %q", by, src)
	}
	if by, src := uploadAttribution("alice", doc); by != "alice" || src != "" {
		t.Errorf("普通用户只能记自己：%q %q", by, src)
	}
	if by, src := uploadAttribution("matto", map[string]any{"schema": "gkms.hif_loadout.v1"}); by != "matto" || src != "" {
		t.Errorf("没写 meta：%q %q", by, src)
	}
}

func TestSceneHasByAndSource(t *testing.T) {
	s := &Store{Data: t.TempDir()}
	p := map[string]any{"loadout": map[string]any{"produce_id": "produce-008"},
		"meta": map[string]any{"by": "yuzeis", "source": map[string]any{"kind": "capture"}, "stage": "hif.main1"}}
	sc := s.sceneOf(p)
	if sc["by"] != "yuzeis" || sc["source"] != "capture" {
		t.Errorf("scene %v", sc)
	}
	if !contains(sceneKeys, "by") || !contains(sceneKeys, "source") {
		t.Error("sceneKeys 要有 by、source")
	}
}

func TestSceneKind(t *testing.T) {
	cases := map[[2]string]string{
		{"hif.sel2", "mid2"}: "selection", {"hif.main1", "mid1"}: "main", {"hajime.audition_mid1", "mid1"}: "mid",
		{"nia.audition_mid2", "mid2"}: "mid", {"nia.audition_final", "final"}: "final", {"hajime.7", "lesson"}: "lesson",
		{"tower.11", "final"}: "tower", {"", ""}: "",
	}
	for in, want := range cases {
		if got := kindOfStage(in[0], in[1]); got != want {
			t.Errorf("%v → %q，要 %q", in, got, want)
		}
	}
	if !contains(sceneKeys, "kind") {
		t.Error("sceneKeys 要有 kind")
	}
}

func TestSceneDeckFromProduceCards(t *testing.T) {
	s := &Store{Data: t.TempDir()}
	p := map[string]any{"loadout": map[string]any{"produce_id": "tower", "produce_cards": []any{"p_card-a+1", "p_card-b"},
		"produce_item_ids": []any{"pitem_x"}}, "meta": map[string]any{"stage": "tower.8"}}
	if sc := s.sceneOf(p); sc["deck"] != 2 {
		t.Errorf("偶像之路的牌组在 produce_cards：%v", sc["deck"])
	}
}
