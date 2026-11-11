package main

import "testing"

func TestFamilyNames(t *testing.T) {
	s := &Store{Data: t.TempDir()}
	if len(s.FamilyNames()) != 0 {
		t.Fatal("新目录应该没有家族名")
	}
	if err := s.SetFamilyName("uinet", cleanFamilyName("  UINet\n")); err != nil {
		t.Fatal(err)
	}
	if got := s.FamilyNames()["uinet"]; got != "UINet" {
		t.Fatalf("got %q", got)
	}
	if err := s.SetFamilyName("uinet", ""); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.FamilyNames()["uinet"]; ok {
		t.Fatal("名字清空后应删掉")
	}
	if n := []rune(cleanFamilyName(string(make([]rune, 0)) + "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十多出来")); len(n) != 40 {
		t.Fatalf("最多 40 字，得到 %d", len(n))
	}
}
