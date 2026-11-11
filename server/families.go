package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode"
)

// 算法家族的显示名：$DATA/families.json {家族编号: 显示名}。家族编号由 familyOf 自动认（或上传时写 family），
// 显示名由人起：上传时在说明里写 family_name，或在排行页家族行上改（管理员、在这个家族里传过成绩的人）。
var familiesMu sync.Mutex

func (s *Store) familiesPath() string { return filepath.Join(s.Data, "families.json") }

func (s *Store) FamilyNames() map[string]string {
	familiesMu.Lock()
	defer familiesMu.Unlock()
	m := map[string]string{}
	_ = readJSON(s.familiesPath(), &m)
	return m
}

func (s *Store) SetFamilyName(family, name string) error {
	familiesMu.Lock()
	defer familiesMu.Unlock()
	m := map[string]string{}
	if err := readJSON(s.familiesPath(), &m); err != nil && !os.IsNotExist(err) {
		return err
	}
	if name == "" {
		delete(m, family)
	} else {
		m[family] = name
	}
	return writeJSON(s.familiesPath(), m, 0o644)
}

// cleanFamilyName：去掉首尾空白和控制字符，最多 40 个字
func cleanFamilyName(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.TrimSpace(s))
	r := []rune(s)
	if len(r) > 40 {
		r = r[:40]
	}
	return strings.TrimSpace(string(r))
}

// 能不能给这个家族起名：管理员，或者在任何题集里传过这个家族成绩的人
func (s *Store) canNameFamily(u, family string) bool {
	if isAdmin(u) {
		return true
	}
	for _, set := range s.Sets() {
		for _, info := range s.Runs(set) {
			if by, _ := info["by"].(string); by == u && familyOf(info) == family {
				return true
			}
		}
	}
	return false
}

func (a *App) handlePatchFamily(w http.ResponseWriter, r *http.Request, u string) {
	family := normFamily(r.PathValue("family"))
	if family == "" {
		fail(w, 400, "家族编号不对")
		return
	}
	var b struct {
		Name string `json:"name"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&b) != nil {
		fail(w, 400, "请求体不是 JSON")
		return
	}
	if !a.store.canNameFamily(u, family) {
		fail(w, 403, "只有管理员和在这个家族里传过成绩的人能给它起名")
		return
	}
	name := cleanFamilyName(b.Name)
	if err := a.store.SetFamilyName(family, name); err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSONResp(w, 200, map[string]any{"family": family, "name": name})
}
