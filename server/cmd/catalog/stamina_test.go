package main

import "testing"

func TestCardStamina(t *testing.T) {
	rows := []row{
		{"id": "p_card-x", "name": "花", "stamina": float64(5), "produceDescriptions": []any{map[string]any{"text": "效果"}}},
		{"id": "p_card-x", "name": "花+", "upgradeCount": float64(1), "stamina": float64(2), "produceDescriptions": []any{map[string]any{"text": "效果"}}},
		{"id": "p_card-y", "name": "集中", "produceDescriptions": []any{map[string]any{"text": "集中消費5"}}},
	}
	doc, _ := buildDoc(func(table string) []row {
		if table == "ProduceCard" {
			return rows
		}
		return nil
	}, texts{}, func(string) string { return "" })
	cards := doc["cards"].(map[string]*Card)
	x := cards["p_card-x"]
	if x.Up[0].Stamina == nil || *x.Up[0].Stamina != 5 || x.Up[1].Stamina == nil || *x.Up[1].Stamina != 2 {
		t.Fatalf("体力消耗没写进去：%+v", x.Up)
	}
	if y := cards["p_card-y"]; y.Up[0].Stamina != nil || y.Up[0].ForceStamina != nil {
		t.Fatalf("没有体力消耗的卡不该写：%+v", y.Up)
	}
}
