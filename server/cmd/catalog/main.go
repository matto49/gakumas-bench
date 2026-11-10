// catalog：从 GKMS 主数据和游戏素材生成网页用的卡牌目录和小图。
//
//	go run ./cmd/catalog -master <GKMS>/GakumasCLI/ro/master/tables \
//	    -cards <素材>/skill_cards -drinks <素材>/drinks -out $GKBENCH_DATA/static
//
// 输出
//
//	catalog.json       cards / drinks / items / enchants / idols：编号 -> 日文名、稀有度、效果文字、小图名
//	sprites/<asset>.png  96px 小图（只生成用得到的）
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"image/png"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"golang.org/x/image/draw"
)

type row = map[string]any

func readTable(dir, name string) []row {
	f, err := os.Open(filepath.Join(dir, name+".jsonl"))
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	var out []row
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 64<<20)
	for sc.Scan() {
		var r row
		if json.Unmarshal(sc.Bytes(), &r) != nil {
			continue
		}
		if d, ok := r["decoded"].(map[string]any); ok {
			r = d
		}
		out = append(out, r)
	}
	return out
}

func str(r row, k string) string {
	s, _ := r[k].(string)
	return s
}

func enumName(r row, k string) string {
	if m, ok := r[k].(map[string]any); ok {
		s, _ := m["name"].(string)
		return s
	}
	return ""
}

var tagRe = regexp.MustCompile(`<[^>]*>`)

// 效果文字：produceDescriptions 里的 text 片段拼起来，去掉标签
var multiNL = regexp.MustCompile(`\s*\n\s*`)

func describe(r row) string {
	ds, _ := r["produceDescriptions"].([]any)
	var b strings.Builder
	for _, d := range ds {
		m, _ := d.(map[string]any)
		t, _ := m["text"].(string)
		switch {
		case m["target_id"] == "Label_StyleDot": // 每条效果前的「・」：游戏里各占一行
			b.WriteString("\n")
		case t == "" && enumName(m, "produce_description_type") == "PRODUCE_DESCRIPTION_TYPE_PLAIN_TEXT":
			// 有些卡的换行条目解出来是空文本（同类卡里是 "\n"），当换行处理
			b.WriteString("\n")
		default:
			b.WriteString(t)
		}
	}
	s := tagRe.ReplaceAllString(b.String(), "")
	return strings.TrimSpace(multiNL.ReplaceAllString(s, "\n"))
}

func short(prefix, s string) string { return strings.TrimPrefix(s, prefix) }

type Card struct {
	Name     string            `json:"name"`
	Rarity   string            `json:"rarity"`
	Plan     string            `json:"plan"`
	Category string            `json:"category"`
	Asset    string            `json:"asset,omitempty"`
	Up       map[int]CardLevel `json:"up"`
}

type CardLevel struct {
	Name string `json:"name"`
	Text string `json:"text"`
}

type Thing struct {
	Name   string `json:"name"`
	Rarity string `json:"rarity,omitempty"`
	Plan   string `json:"plan,omitempty"`
	Text   string `json:"text,omitempty"`
	Asset  string `json:"asset,omitempty"`
}

func resize(src, dst string, size int) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return err
	}
	out := image.NewNRGBA(image.Rect(0, 0, size, size))
	draw.CatmullRom.Scale(out, out.Bounds(), img, img.Bounds(), draw.Over, nil)
	w, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer w.Close()
	enc := png.Encoder{CompressionLevel: png.BestCompression}
	return enc.Encode(w, out)
}

func main() {
	master := flag.String("master", "", "GKMS 主数据目录（ro/master/tables）")
	cardsDir := flag.String("cards", "", "技能卡、P 道具小图目录，多个用逗号隔开")
	drinksDir := flag.String("drinks", "", "饮料小图目录")
	out := flag.String("out", "", "输出目录")
	size := flag.Int("size", 96, "小图边长")
	flag.Parse()
	if *master == "" || *out == "" {
		flag.Usage()
		os.Exit(2)
	}
	spr := filepath.Join(*out, "sprites")
	if err := os.MkdirAll(spr, 0o755); err != nil {
		log.Fatal(err)
	}
	have := map[string]string{} // asset -> 源文件
	for _, d := range append(strings.Split(*cardsDir, ","), *drinksDir) {
		if d == "" {
			continue
		}
		files, _ := filepath.Glob(filepath.Join(d, "*.png"))
		for _, f := range files {
			have[strings.TrimSuffix(filepath.Base(f), ".png")] = f
		}
	}
	used := map[string]bool{}
	variants := map[string]string{} // 按角色分图的卡（asset-amao 等）：取字母序第一张
	for a := range have {
		if i := strings.LastIndex(a, "-"); i > 0 && strings.Contains(a, "skillcard") && !strings.ContainsAny(a[i+1:], "0123456789_") {
			base := a[:i]
			if v, ok := variants[base]; !ok || a < v {
				variants[base] = a
			}
		}
	}
	sprite := func(asset string) string {
		if _, ok := have[asset]; !ok {
			asset = variants[asset]
		}
		if asset == "" {
			return ""
		}
		used[asset] = true
		return asset
	}

	cards := map[string]*Card{}
	for _, r := range readTable(*master, "ProduceCard") {
		id := str(r, "id")
		u := 0
		if v, ok := r["upgradeCount"].(float64); ok {
			u = int(v)
		}
		c := cards[id]
		if c == nil {
			c = &Card{Rarity: short("PRODUCE_CARD_RARITY_", enumName(r, "rarity")),
				Plan: short("PRODUCE_PLAN_TYPE_", enumName(r, "planType")), Category: short("PRODUCE_CARD_CATEGORY_", enumName(r, "category")),
				Up: map[int]CardLevel{}}
			cards[id] = c
		}
		if u == 0 || c.Name == "" {
			c.Name = strings.TrimRight(str(r, "name"), "+")
		}
		if c.Asset == "" {
			c.Asset = sprite(str(r, "assetId"))
		}
		c.Up[u] = CardLevel{Name: str(r, "name"), Text: describe(r)}
	}

	drinks := map[string]Thing{}
	for _, r := range readTable(*master, "ProduceDrink") {
		drinks[str(r, "id")] = Thing{Name: str(r, "name"), Rarity: short("PRODUCE_DRINK_RARITY_", enumName(r, "rarity")),
			Plan: short("PRODUCE_PLAN_TYPE_", enumName(r, "planType")), Text: describe(r), Asset: sprite(str(r, "assetId"))}
	}
	items := map[string]Thing{}
	for _, r := range readTable(*master, "ProduceItem") {
		items[str(r, "id")] = Thing{Name: str(r, "name"), Rarity: short("PRODUCE_ITEM_RARITY_", enumName(r, "rarity")),
			Plan: short("PRODUCE_PLAN_TYPE_", enumName(r, "planType")), Text: describe(r), Asset: sprite(str(r, "assetId"))}
	}
	// 回忆（编成里的 memory_ability_ids）：效果写在 ProduceSkill 上
	skills := map[string]string{}
	for _, r := range readTable(*master, "ProduceSkill") {
		skills[str(r, "id")] = describe(r)
	}
	memories := map[string]Thing{}
	for _, r := range readTable(*master, "MemoryAbility") {
		if t := skills[str(r, "skillId")]; t != "" {
			memories[str(r, "id")] = Thing{Text: t}
		}
	}
	chars := map[string]string{}
	for _, r := range readTable(*master, "Character") {
		chars[str(r, "id")] = str(r, "lastName") + str(r, "firstName")
	}
	idols := map[string]Thing{}
	for _, r := range readTable(*master, "IdolCard") {
		idols[str(r, "id")] = Thing{Name: fmt.Sprintf("【%s】%s", str(r, "name"), chars[str(r, "characterId")]),
			Plan: short("PRODUCE_PLAN_TYPE_", enumName(r, "planType"))}
	}
	// 持续效果：P 道具的效果用道具名，回忆的效果用卡名，其余用效果文字
	itemRe := regexp.MustCompile(`p_item_effect_([0-9]+-[0-9]+-[0-9]+-[0-9]+)`)
	memRe := regexp.MustCompile(`hif_memory-(p_card-[0-9a-z_-]+?)-enc`)
	enchants := map[string]Thing{}
	for _, r := range readTable(*master, "ProduceExamStatusEnchant") {
		id := str(r, "id")
		t := Thing{Text: describe(r)}
		if m := itemRe.FindStringSubmatch(id); m != nil {
			if it, ok := items["pitem_"+m[1]]; ok {
				t.Name = it.Name
			}
		} else if m := memRe.FindStringSubmatch(id); m != nil {
			if c, ok := cards[m[1]]; ok {
				t.Name = c.Name + "（回忆）"
			}
		} else if strings.HasPrefix(id, "enchant-customize_pitem") {
			t.Name = "定制 P 道具"
		}
		enchants[id] = t
	}

	n := 0
	for asset := range used {
		dst := filepath.Join(spr, asset+".png")
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		if err := resize(have[asset], dst, *size); err != nil {
			log.Printf("缩图失败 %s：%v", asset, err)
			continue
		}
		n++
	}
	doc := map[string]any{"schema": "gkbench.catalog.v1", "cards": cards, "drinks": drinks, "items": items,
		"enchants": enchants, "idols": idols, "memories": memories}
	b, _ := json.Marshal(doc)
	if err := os.WriteFile(filepath.Join(*out, "catalog.json"), b, 0o644); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("回忆 %d；", len(memories))
	fmt.Printf("目录：卡 %d、饮料 %d、P 道具 %d、持续效果 %d、偶像 %d；小图 %d 张（新生成 %d），catalog.json %d KB\n",
		len(cards), len(drinks), len(items), len(enchants), len(idols), len(used), n, len(b)/1024)
}
