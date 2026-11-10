package main

// 题模板的固定种子：每道题模板一组 32 个互不相同的种子，以后所有算法、每次评测都打这一组。
//
// 种子 = HMAC-SHA256(私钥, "<题族编号>:<i>") 的前 8 字节 mod (2^31-2) + 1，i 从 0 数起，
// 跳过重复的和这道题固定种子题已经用过的，取满 32 个。题族编号是公开的，所以必须带私钥：
// 只用 sha256(题族编号) 的话，任何人都能算出种子。
//
//	$DATA/private/template-seed.key        32 字节私钥（600），第一次用时生成，丢了种子就再也算不回来
//	$DATA/private/seeds/<题集>.template.json  gkbench.template_seeds.v1（600）：{"problems": {"<题模板编号>": {"family", "seeds": [...]}}}
//
// 文件是缓存兼存档：已有的题不重算（换了私钥也不会变），新题按私钥补上。

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

const (
	TemplateSeeds        = 32
	TemplateSeedsVersion = "fixed32.v1" // 写进运行的 template_seeds；没有这个字段的题模板运行是旧版（每次临时抽种子），不进排行
)

type TemplateSeedSet struct {
	Schema   string                      `json:"schema"`
	Set      string                      `json:"set"`
	N        int                         `json:"seeds_per_problem"`
	Method   string                      `json:"method"`
	Problems map[string]TemplateSeedList `json:"problems"`
}

type TemplateSeedList struct {
	Family string  `json:"family"`
	Seeds  []int64 `json:"seeds"`
}

var tseedMu sync.Mutex

func (s *Store) templateSeedKey() ([]byte, error) {
	p := filepath.Join(s.Data, "private", "template-seed.key")
	if b, err := os.ReadFile(p); err == nil {
		if len(b) < 32 {
			return nil, fmt.Errorf("%s 太短", p)
		}
		return b, nil
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return nil, err
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	if err := os.WriteFile(p, b, 0o600); err != nil {
		return nil, err
	}
	return b, nil
}

func deriveTemplateSeeds(key []byte, family string, avoid map[int64]bool, n int) []int64 {
	seen := map[int64]bool{}
	var out []int64
	for i := 0; len(out) < n; i++ {
		m := hmac.New(sha256.New, key)
		fmt.Fprintf(m, "%s:%d", family, i)
		v := int64(binary.BigEndian.Uint64(m.Sum(nil)[:8])%(1<<31-2)) + 1
		if seen[v] || avoid[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}

func (s *Store) templateSeedPath(set string) string {
	return filepath.Join(s.Data, "private", "seeds", set+".template.json")
}

// TemplateSeeds 读一套题的固定种子，缺的题按私钥补上并写回
func (s *Store) TemplateSeeds(set string) (map[string]TemplateSeedList, error) {
	if !s.validName(set) {
		return nil, fmt.Errorf("题集名不合法")
	}
	tseedMu.Lock()
	defer tseedMu.Unlock()
	path := s.templateSeedPath(set)
	doc := TemplateSeedSet{}
	_ = readJSON(path, &doc)
	if doc.Problems == nil {
		doc.Problems = map[string]TemplateSeedList{}
	}
	fixed := s.Seeds(set)
	var key []byte
	changed := false
	for _, p := range s.Problems(set) {
		id := fmt.Sprint(p["id"])
		if _, ok := doc.Problems[id]; ok {
			continue
		}
		fam, _ := metaOf(p)["family"].(string)
		if fam == "" {
			fam = id
		}
		if key == nil {
			k, err := s.templateSeedKey()
			if err != nil {
				return nil, err
			}
			key = k
		}
		avoid := map[int64]bool{}
		for _, r := range fixed[id] {
			avoid[r.Seed] = true
		}
		doc.Problems[id] = TemplateSeedList{Family: fam, Seeds: deriveTemplateSeeds(key, fam, avoid, TemplateSeeds)}
		changed = true
	}
	if changed {
		doc.Schema, doc.Set, doc.N = "gkbench.template_seeds.v1", set, TemplateSeeds
		doc.Method = "HMAC-SHA256(private/template-seed.key, \"<family>:<i>\")[:8] big-endian mod (2^31-2) + 1；跳过重复和固定种子题用过的种子"
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, err
		}
		if err := writeJSON(path, doc, 0o600); err != nil {
			return nil, err
		}
	}
	return doc.Problems, nil
}
