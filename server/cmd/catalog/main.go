// catalog：从 GKMS 主数据和游戏素材生成网页用的卡牌目录和小图。
//
//	go run ./cmd/catalog -master <GKMS>/GakumasCLI/ro/master/tables \
//	    -cards <素材>/skill_cards -drinks <素材>/drinks -out $GKBENCH_DATA/static
//
// 输出
//
//	catalog.json       cards / drinks / items / enchants：编号 -> 日文名、稀有度、效果文字、小图名；卡带定制方向（custom）；
//	                   idols：流派、初始参数和成长率、固有技能卡和 P 道具；memories：效果文字和图标（memicon-*）；
//	                   卡和饮料带解锁 P 等级（unlock，0 省略）
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
	"sort"
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

func describe(r row) string { return describeKey(r, "produceDescriptions") }

func describeKey(r row, key string) string {
	ds, _ := r[key].([]any)
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
	Custom   *CardCustom       `json:"custom,omitempty"`
	Unlock   int               `json:"unlock,omitempty"` // 解锁 P 等级（unlockProducerLevel）；0 = 不靠等级解锁（初始、固有、トラブル）
}

// 卡的定制（カスタマイズ）：每张卡有自己的几个方向，每个方向 1～3 档，各档花 P 点；一张卡总共能定制 Max 次。
// 各档的效果是「到这一档为止」的总量，不是增量。
type CardCustom struct {
	Max  int         `json:"max"`
	Dirs []CustomDir `json:"dirs"`
}

type CustomDir struct {
	ID     string        `json:"id"`
	Levels []CustomLevel `json:"levels"`
}

type CustomLevel struct {
	PP   int    `json:"pp"`
	Text string `json:"text"`
}

// 成长效果里只带一个数值的类型 → 文字（%d 是数值）。主数据没有这些的说明文字，按游戏里的叫法写。
var growValueText = map[string]string{
	"LESSON_ADD": "パラメータ+%d", "LESSON_REDUCE": "パラメータ-%d", "LESSON_COUNT_ADD": "パラメータ上昇回数+%d", "LESSON_COUNT_REDUCE": "パラメータ上昇回数-%d",
	"BLOCK_ADD": "元気+%d", "BLOCK_REDUCE": "元気-%d", "AGGRESSIVE_ADD": "やる気+%d", "REVIEW_ADD": "好印象+%d", "LESSON_BUFF_ADD": "集中+%d",
	"FULL_POWER_POINT_ADD": "全力値+%d", "FULL_POWER_POINT_REDUCE": "全力値-%d",
	"PARAMETER_BUFF_TURN_ADD": "好調+%dターン", "PARAMETER_BUFF_MULTIPLE_PER_TURN_ADD": "絶好調+%dターン", "STAMINA_CONSUMPTION_DOWN_TURN_ADD": "消費体力減少+%dターン",
	"COST_REDUCE": "コスト-%d", "COST_ADD": "コスト+%d", "COST_PENETRATE_REDUCE": "体力消費-%d", "COST_PENETRATE_ADD": "体力消費+%d",
	"COST_AGGRESSIVE_REDUCE": "やる気消費-%d", "COST_AGGRESSIVE_ADD": "やる気消費+%d", "COST_REVIEW_REDUCE": "好印象消費-%d", "COST_REVIEW_ADD": "好印象消費+%d",
	"COST_LESSON_BUFF_REDUCE": "集中消費-%d", "COST_LESSON_BUFF_ADD": "集中消費+%d", "COST_FULL_POWER_POINT_REDUCE": "全力値消費-%d", "COST_FULL_POWER_POINT_ADD": "全力値消費+%d",
	"COST_PARAMETER_BUFF_REDUCE": "好調消費-%dターン", "COST_PARAMETER_BUFF_ADD": "好調消費+%dターン", "COST_PARAMETER_BUFF_MULTIPLE_PER_TURN_REDUCE": "絶好調消費-%dターン",
}

// 数值是千分比的类型：「○○の N% 分パラメータ上昇」里的 N 加多少
var growPermilText = map[string]string{
	"LESSON_DEPEND_BLOCK_ADD": "元気分パラメータ+%s%%", "LESSON_DEPEND_EXAM_REVIEW_ADD": "好印象分パラメータ+%s%%", "LESSON_DEPEND_EXAM_CARD_PLAY_AGGRESSIVE_ADD": "やる気分パラメータ+%s%%",
}

var growChangeText = map[string]string{
	"EFFECT_ADD": "効果追加", "EFFECT_CHANGE": "効果変更", "CARD_STATUS_ENCHANT_CHANGE": "成長変更",
	"PLAY_TRIGGER_CHANGE": "使用条件変更", "PLAY_EFFECT_TRIGGER_CHANGE": "効果の発動条件変更",
	"INITIAL_ADD": "レッスン開始時手札に入る", "PLAY_MOVE_POSITION_TYPE_CHANGE": "使用後の置き場変更",
}

type growTables struct {
	grow, effect, trigger, cardEnchant map[string]row
	tx                                 texts
}

func byID(rows []row) map[string]row {
	m := map[string]row{}
	for _, r := range rows {
		m[str(r, "id")] = r
	}
	return m
}

func permil(v int) string {
	if v%10 == 0 {
		return fmt.Sprint(v / 10)
	}
	return fmt.Sprintf("%d.%d", v/10, v%10)
}

// 一条成长效果 → (文字, 是不是「数值类」)。数值类自己就是完整的说明；其余的是「换 / 加了哪条效果」，文字是那条效果的说明
func (t growTables) text(id string) (string, bool) {
	g := t.grow[id]
	typ := short("PRODUCE_CARD_GROW_EFFECT_TYPE_", enumName(g, "effectType"))
	v := 0
	if f, ok := g["value"].(float64); ok {
		v = int(f)
	}
	if f, ok := t.tx.value[typ]; ok {
		return fmt.Sprintf(f, v), true
	}
	if f, ok := t.tx.permil[typ]; ok {
		return fmt.Sprintf(f, permil(v)), true
	}
	detail := ""
	if e, ok := t.effect[str(g, "playProduceExamEffectId")]; ok {
		if detail = describeKey(e, "customizeProduceDescriptions"); detail == "" {
			detail = describe(e)
		}
	} else if e, ok := t.cardEnchant[str(g, "produceCardStatusEnchantId")]; ok {
		detail = describe(e)
	} else if e, ok := t.trigger[str(g, "playProduceExamTriggerId")]; ok {
		detail = describe(e)
	} else if e, ok := t.trigger[str(g, "playEffectProduceExamTriggerId")]; ok {
		detail = describe(e)
	}
	return strings.TrimRight(strings.ReplaceAll(detail, "\n", " "), "、"), false
}

// 定制的一档 → 文字。主数据给了短标签（description，如「元気追加」）就用它开头，后面跟具体效果
func (t growTables) level(r row) string {
	label := strings.ReplaceAll(strings.ReplaceAll(str(r, "description"), "\\n", ""), "\n", "")
	ids, _ := r["produceCardGrowEffectIds"].([]any)
	var parts []string
	kind := ""
	for _, x := range ids {
		id, _ := x.(string)
		s, plain := t.text(id)
		if !plain && kind == "" {
			kind = t.tx.change[short("PRODUCE_CARD_GROW_EFFECT_TYPE_", enumName(t.grow[id], "effectType"))]
		}
		if s != "" {
			dup := false
			for _, p := range parts {
				dup = dup || p == s
			}
			if !dup {
				parts = append(parts, s)
			}
		}
	}
	if label == "" {
		label = kind
	}
	body := strings.Join(parts, "\n")
	switch {
	case label == "":
		return body
	case body == "":
		return label
	}
	return label + "：" + body
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
	Unlock int    `json:"unlock,omitempty"` // 饮料的解锁 P 等级；P 道具主数据里没有这一项
}

// 偶像卡（IdolCard）：流派、初始参数和成长率、固有技能卡和固有 P 道具
type Idol struct {
	Name    string `json:"name"`
	Rarity  string `json:"rarity,omitempty"`
	Plan    string `json:"plan,omitempty"`
	Style   string `json:"style,omitempty"`   // 流派：examEffectType 去掉前缀，如 EXAM_PARAMETER_BUFF（好調）
	Params  [3]int `json:"params"`            // 初始 Vo / Da / Vi
	Growth  [3]int `json:"growth"`            // 成长率 Vo / Da / Vi，千分比
	Stamina int    `json:"stamina,omitempty"` // 初始体力
	Card    string `json:"card,omitempty"`    // 固有技能卡
	Item    string `json:"item,omitempty"`    // 固有 P 道具
	ItemUp  string `json:"item_up,omitempty"` // 特训（潜在能力）后的 P 道具
}

func num(r row, k string) int {
	v, _ := r[k].(float64)
	return int(v)
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
	zh := flag.String("zh", "", "汉化数据目录（imas-tools/gakumas-master-translation 的 data/，或汉化插件的 local-files/masterTrans）；给了就另出 catalog.zh.json")
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
	// 已经缩好的小图也算有：只更新文字时可以不带素材目录
	olds, _ := filepath.Glob(filepath.Join(spr, "*.png"))
	for _, f := range olds {
		if a := strings.TrimSuffix(filepath.Base(f), ".png"); have[a] == "" {
			have[a] = f
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

	rdJa := func(name string) []row { return readTable(*master, name) }
	doc, info := buildDoc(rdJa, jaTexts, sprite)
	var docZh map[string]any
	if *zh != "" {
		cache := map[string]*trTable{}
		rdZh := func(name string) []row {
			t, ok := cache[name]
			if !ok {
				t = loadTr(*zh, name)
				cache[name] = t
			}
			return overlay(name, readTable(*master, name), t)
		}
		docZh, _ = buildDoc(rdZh, zhTexts, sprite)
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
	b, _ := json.Marshal(doc)
	if err := os.WriteFile(filepath.Join(*out, "catalog.json"), b, 0o644); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("%s；小图 %d 张（新生成 %d），catalog.json %d KB\n", info, len(used), n, len(b)/1024)
	if docZh != nil {
		bz, _ := json.Marshal(docZh)
		if err := os.WriteFile(filepath.Join(*out, "catalog.zh.json"), bz, 0o644); err != nil {
			log.Fatal(err)
		}
		fmt.Printf("中文目录 catalog.zh.json %d KB；汉化命中（表：命中行 / 主数据行，数组对不上的条数）：", len(bz)/1024)
		names := make([]string, 0, len(trStat))
		for k := range trStat {
			names = append(names, k)
		}
		sort.Strings(names)
		for _, k := range names {
			st := trStat[k]
			fmt.Printf(" %s %d/%d", k, st.hit, st.rows)
			if st.nestedSkip > 0 {
				fmt.Printf("（%d）", st.nestedSkip)
			}
		}
		fmt.Println()
	}
}

// 生成一份目录。rd 读一张主数据表（中文目录读的是叠了汉化的表），tx 是目录自己拼的那些文字
func buildDoc(rd func(string) []row, tx texts, sprite func(string) string) (map[string]any, string) {
	cards := map[string]*Card{}
	for _, r := range rd("ProduceCard") {
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
		if v, ok := r["unlockProducerLevel"].(float64); ok && u == 0 {
			c.Unlock = int(v)
		}
		if ids, _ := r["produceCardCustomizeIds"].([]any); len(ids) > 0 && c.Custom == nil {
			c.Custom = &CardCustom{}
			if v, ok := r["maxCustomizeCount"].(float64); ok {
				c.Custom.Max = int(v)
			}
			for _, x := range ids {
				id, _ := x.(string)
				c.Custom.Dirs = append(c.Custom.Dirs, CustomDir{ID: id})
			}
		}
	}
	gt := growTables{tx: tx, grow: byID(rd("ProduceCardGrowEffect")), effect: byID(rd("ProduceExamEffect")),
		trigger: byID(rd("ProduceExamTrigger")), cardEnchant: byID(rd("ProduceCardStatusEnchant"))}
	custom := map[string][]CustomLevel{} // 定制编号 → 各档（按档次排好）
	for _, r := range rd("ProduceCardCustomize") {
		n := 1
		if v, ok := r["customizeCount"].(float64); ok {
			n = int(v)
		}
		pp := 0
		if v, ok := r["producePoint"].(float64); ok {
			pp = int(v)
		}
		id := str(r, "id")
		for len(custom[id]) < n {
			custom[id] = append(custom[id], CustomLevel{})
		}
		custom[id][n-1] = CustomLevel{PP: pp, Text: gt.level(r)}
	}
	nCustom := 0
	for _, c := range cards {
		if c.Custom == nil {
			continue
		}
		nCustom++
		for i := range c.Custom.Dirs {
			c.Custom.Dirs[i].Levels = custom[c.Custom.Dirs[i].ID]
		}
	}

	drinks := map[string]Thing{}
	for _, r := range rd("ProduceDrink") {
		unlock := 0
		if v, ok := r["unlockProducerLevel"].(float64); ok {
			unlock = int(v)
		}
		drinks[str(r, "id")] = Thing{Name: str(r, "name"), Rarity: short("PRODUCE_DRINK_RARITY_", enumName(r, "rarity")),
			Plan: short("PRODUCE_PLAN_TYPE_", enumName(r, "planType")), Text: describe(r), Asset: sprite(str(r, "assetId")), Unlock: unlock}
	}
	items := map[string]Thing{}
	for _, r := range rd("ProduceItem") {
		items[str(r, "id")] = Thing{Name: str(r, "name"), Rarity: short("PRODUCE_ITEM_RARITY_", enumName(r, "rarity")),
			Plan: short("PRODUCE_PLAN_TYPE_", enumName(r, "planType")), Text: describe(r), Asset: sprite(str(r, "assetId"))}
	}
	// 回忆（编成里的 memory_ability_ids）：效果写在 ProduceSkill 上
	skills := map[string]string{}
	for _, r := range rd("ProduceSkill") {
		skills[str(r, "id")] = describe(r)
	}
	// 回忆的图标：游戏里是彩色方底 + 白色图案，导出时已经合成好（gkmas-assets/tools/export_memory_icons.py → memicon-*）。
	// 考试中生效的（附魔）按附魔给的第一种考试效果取图案；培育中生效的按效果类型取
	skillRows := byID(rd("ProduceSkill"))
	effects := byID(rd("ProduceEffect"))
	enchantRows := byID(rd("ProduceExamStatusEnchant"))
	examEffects := byID(rd("ProduceExamEffect"))
	produceIcon := map[string]string{
		"VOCAL_ADDITION": "vocal", "DANCE_ADDITION": "dance", "VISUAL_ADDITION": "visual",
		"VOCAL_GROWTH_RATE_ADDITION": "vocalgrowthrate", "DANCE_GROWTH_RATE_ADDITION": "dancegrowthrate", "VISUAL_GROWTH_RATE_ADDITION": "visualgrowthrate",
		"STAMINA_RECOVER_FIX": "staminarecover", "PRODUCE_POINT_ADDITION_DISABLE_TRIGGER": "producepoint",
	}
	examIcon := func(typ string) string { // PRODUCE_EXAM_EFFECT_TYPE_EXAM_BLOCK -> memicon-exam-examblock
		t := short("PRODUCE_EXAM_EFFECT_TYPE_", typ)
		if t == "" || t == "EXAM_STATUS_ENCHANT" {
			return ""
		}
		return sprite("memicon-exam-" + strings.ToLower(strings.ReplaceAll(t, "_", "")))
	}
	memIcon := func(skill row) string {
		e := effects[str(skill, "produceEffectId1")]
		typ := short("PRODUCE_EFFECT_TYPE_", enumName(e, "produceEffectType"))
		if k, ok := produceIcon[typ]; ok {
			return sprite("memicon-" + k)
		}
		if typ != "EXAM_STATUS_ENCHANT" {
			return ""
		}
		en := enchantRows[str(e, "produceExamStatusEnchantId")]
		ds, _ := en["produceDescriptions"].([]any)
		for _, d := range ds {
			if a := examIcon(enumName(d.(map[string]any), "exam_effect_type")); a != "" {
				return a
			}
		}
		ids, _ := en["produceExamEffectIds"].([]any)
		for _, x := range ids {
			id, _ := x.(string)
			if a := examIcon(enumName(examEffects[id], "effectType")); a != "" {
				return a
			}
		}
		// H.I.F 专用的那些套了一层回合计时、说明里也没写效果类型：用游戏里的「计时效果」图标
		return sprite("memicon-exam-exameffecttimer")
	}
	memories := map[string]Thing{}
	noIcon := 0
	for _, r := range rd("MemoryAbility") {
		if t := skills[str(r, "skillId")]; t != "" {
			sk := skillRows[str(r, "skillId")]
			plan := short("PRODUCE_PLAN_TYPE_", enumName(sk, "planType"))
			if plan == "COMMON" {
				plan = ""
			}
			m := Thing{Text: t, Rarity: short("SKILL_RARITY_", enumName(sk, "rarity")), Plan: plan, Asset: memIcon(sk)}
			if m.Asset == "" {
				noIcon++
			}
			memories[str(r, "id")] = m
		}
	}
	chars := map[string]string{}
	for _, r := range rd("Character") {
		chars[str(r, "id")] = str(r, "lastName") + str(r, "firstName")
	}
	idols := map[string]Idol{}
	for _, r := range rd("IdolCard") {
		idols[str(r, "id")] = Idol{Name: fmt.Sprintf("【%s】%s", str(r, "name"), chars[str(r, "characterId")]),
			Rarity: short("IDOL_CARD_RARITY_", enumName(r, "rarity")), Plan: short("PRODUCE_PLAN_TYPE_", enumName(r, "planType")),
			Style:   short("PRODUCE_EXAM_EFFECT_TYPE_", enumName(r, "examEffectType")),
			Params:  [3]int{num(r, "produceVocal"), num(r, "produceDance"), num(r, "produceVisual")},
			Growth:  [3]int{num(r, "produceVocalGrowthRatePermil"), num(r, "produceDanceGrowthRatePermil"), num(r, "produceVisualGrowthRatePermil")},
			Stamina: num(r, "produceStamina"), Card: str(r, "produceCardId"), Item: str(r, "beforeProduceItemId"), ItemUp: str(r, "afterProduceItemId")}
	}
	// 持续效果：P 道具的效果用道具名，回忆的效果用卡名，其余用效果文字
	itemRe := regexp.MustCompile(`p_item_effect_([0-9]+-[0-9]+-[0-9]+-[0-9]+)`)
	memRe := regexp.MustCompile(`hif_memory-(p_card-[0-9a-z_-]+?)-enc`)
	enchants := map[string]Thing{}
	for _, r := range rd("ProduceExamStatusEnchant") {
		id := str(r, "id")
		t := Thing{Text: describe(r)}
		if m := itemRe.FindStringSubmatch(id); m != nil {
			if it, ok := items["pitem_"+m[1]]; ok {
				t.Name = it.Name
			}
		} else if m := memRe.FindStringSubmatch(id); m != nil {
			if c, ok := cards[m[1]]; ok {
				t.Name = c.Name + tx.memSuffix
			}
		} else if strings.HasPrefix(id, "enchant-customize_pitem") {
			t.Name = tx.customItem
		}
		enchants[id] = t
	}

	doc := map[string]any{"schema": "gkbench.catalog.v1", "cards": cards, "drinks": drinks, "items": items,
		"enchants": enchants, "idols": idols, "memories": memories}
	info := fmt.Sprintf("回忆 %d（没图标 %d）；能定制的卡 %d；目录：卡 %d、饮料 %d、P 道具 %d、持续效果 %d、偶像 %d",
		len(memories), noIcon, nCustom, len(cards), len(drinks), len(items), len(enchants), len(idols))
	return doc, info
}
