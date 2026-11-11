package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOverlay(t *testing.T) {
	dir := t.TempDir()
	tr := `{"rules": {"primaryKeys": ["id", "upgradeCount", "produceDescriptions.targetId"]},
 "data": [
  {"id": "c1", "upgradeCount": 0, "name": "元气的问候", "produceDescriptions": [{"targetId": "Label_ExamBlock", "text": "元气"}, {"targetId": "", "text": ""}]},
  {"id": "c1", "upgradeCount": 1, "name": "元气的问候+", "produceDescriptions": [{"targetId": "Label_X", "text": "错位"}]},
  {"id": "c2", "upgradeCount": 0, "name": "", "produceDescriptions": [{"targetId": "Label_Y", "text": "不该换"}]}
 ]}`
	if err := os.WriteFile(filepath.Join(dir, "ProduceCard.json"), []byte(tr), 0o644); err != nil {
		t.Fatal(err)
	}
	tab := loadTr(dir, "ProduceCard")
	if tab == nil || len(tab.keys) != 2 {
		t.Fatalf("主键只取顶层的：%+v", tab)
	}
	desc := func(target, text string) any {
		return map[string]any{"target_id": target, "text": text}
	}
	rows := []row{
		// upgradeCount 为 0 时主数据里省略了这个字段
		{"id": "c1", "name": "元気な挨拶", "produceDescriptions": []any{desc("Label_ExamBlock", "元気"), desc("", "\n")}},
		// 数组长度对不上：名字照换，效果留日文
		{"id": "c1", "upgradeCount": 1.0, "name": "元気な挨拶+", "produceDescriptions": []any{desc("Label_ExamBlock", "元気"), desc("", "")}},
		// 汉化名字是空的：留日文；子键 targetId 对不上：效果留日文
		{"id": "c2", "name": "日本語", "produceDescriptions": []any{desc("Label_Z", "原文")}},
		{"id": "c3", "name": "没有汉化"},
	}
	out := overlay("ProduceCard", rows, tab)
	ds := func(r row, i int) string {
		return r["produceDescriptions"].([]any)[i].(map[string]any)["text"].(string)
	}
	if out[0]["name"] != "元气的问候" || ds(out[0], 0) != "元气" || ds(out[0], 1) != "\n" {
		t.Errorf("第一行：%v", out[0])
	}
	if out[1]["name"] != "元气的问候+" || ds(out[1], 0) != "元気" {
		t.Errorf("数组长度不同：%v", out[1])
	}
	if out[2]["name"] != "日本語" || ds(out[2], 0) != "原文" {
		t.Errorf("空翻译 / 子键不同：%v", out[2])
	}
	if out[3]["name"] != "没有汉化" {
		t.Errorf("没有汉化的行：%v", out[3])
	}
	if rows[0]["name"] != "元気な挨拶" || ds(rows[0], 0) != "元気" {
		t.Errorf("不能改原来的行：%v", rows[0])
	}
	if st := trStat["ProduceCard"]; st.hit != 3 || st.nestedSkip != 2 {
		t.Errorf("统计：%+v", st)
	}
}
