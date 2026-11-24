package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"
)

// 角色强度榜的玩家评论（和玩家评级 tiervotes.go 放在一起）：谁都能看，登录才能发；每条最多 500 字；
// 同一个人两次发言至少隔 30 秒；自己的能删，管理员能删任何人的。
// 存 $DATA/tier-comments/<榜>.json：{卡: [评论…]}，评论按发表时间先后追加。
var tierCommentsMu sync.Mutex

const tierCommentMax = 500

// tierCommentCooldown：同一个人两次发言的最短间隔（测试里改小）
var tierCommentCooldown = 30 * time.Second

type TierComment struct {
	ID      string `json:"id"`
	User    string `json:"user"`
	Text    string `json:"text"`
	Created string `json:"created"`
	Edited  string `json:"edited,omitempty"`
}

// lastTierComment：每个用户上次发评论的时间（只在内存里，重启清零，够防刷屏）
var lastTierComment sync.Map

func (s *Store) tierCommentsPath(board string) string {
	return filepath.Join(s.Data, "tier-comments", board+".json")
}

func (s *Store) TierComments(board string) map[string][]TierComment {
	tierCommentsMu.Lock()
	defer tierCommentsMu.Unlock()
	m := map[string][]TierComment{}
	_ = readJSON(s.tierCommentsPath(board), &m)
	return m
}

func (s *Store) updateTierComments(board string, fn func(m map[string][]TierComment) error) error {
	tierCommentsMu.Lock()
	defer tierCommentsMu.Unlock()
	p := s.tierCommentsPath(board)
	m := map[string][]TierComment{}
	if err := readJSON(p, &m); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := fn(m); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return writeJSON(p, m, 0o644)
}

// cleanComment：去掉首尾空白和除换行外的控制字符，连续空行压成一个
func cleanComment(s string) string {
	s = strings.Map(func(r rune) rune {
		if r == '\n' {
			return r
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.ReplaceAll(s, "\r\n", "\n"))
	for strings.Contains(s, "\n\n\n") {
		s = strings.ReplaceAll(s, "\n\n\n", "\n\n")
	}
	return strings.TrimSpace(s)
}

type tierCommentOut struct {
	TierComment
	Name      string `json:"name,omitempty"`
	Avatar    string `json:"avatar,omitempty"`
	Tier      string `json:"tier,omitempty"` // 发言人现在给这张卡评的档（没评过为空）
	CanDelete bool   `json:"can_delete,omitempty"`
}

// GET /api/tiers/:id/comments/:card：这张卡的评论，新的在前
func (a *App) handleTierComments(static string) userHandler {
	return func(w http.ResponseWriter, r *http.Request, u string) {
		board, card := r.PathValue("id"), r.PathValue("card")
		cards := tierBoardCards(static, board)
		if cards == nil || !cards[card] {
			fail(w, 404, "没有这张榜或这张卡")
			return
		}
		list := a.store.TierComments(board)[card]
		votes := a.store.TierVotes(board)[card]
		out := make([]tierCommentOut, 0, len(list))
		for i := len(list) - 1; i >= 0; i-- {
			c := list[i]
			o := tierCommentOut{TierComment: c, Tier: votes[c.User], CanDelete: u != "" && (u == c.User || isAdmin(u))}
			if p := a.store.userProfile(c.User); p != nil {
				o.Name, o.Avatar = p.Name, p.Avatar
			}
			out = append(out, o)
		}
		writeJSONResp(w, 200, map[string]any{"comments": out})
	}
}

// POST /api/tiers/:id/comments/:card {"text": "…"}
func (a *App) handleTierCommentPost(static string) userHandler {
	return func(w http.ResponseWriter, r *http.Request, u string) {
		board, card := r.PathValue("id"), r.PathValue("card")
		cards := tierBoardCards(static, board)
		if cards == nil || !cards[card] {
			fail(w, 404, "没有这张榜或这张卡")
			return
		}
		var b struct {
			Text string `json:"text"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&b) != nil {
			fail(w, 400, "请求体不是 JSON")
			return
		}
		text := cleanComment(b.Text)
		if text == "" {
			fail(w, 400, "评论是空的")
			return
		}
		if n := len([]rune(text)); n > tierCommentMax {
			fail(w, 400, "评论最多 500 字")
			return
		}
		if t, ok := lastTierComment.Load(u); ok && time.Since(t.(time.Time)) < tierCommentCooldown {
			fail(w, 429, "发得太快了，隔半分钟再发")
			return
		}
		c := TierComment{ID: newID(6), User: u, Text: text, Created: now()}
		if err := a.store.updateTierComments(board, func(m map[string][]TierComment) error {
			m[card] = append(m[card], c)
			return nil
		}); err != nil {
			fail(w, 500, "保存失败："+err.Error())
			return
		}
		lastTierComment.Store(u, time.Now())
		writeJSONResp(w, 200, c)
	}
}

// DELETE /api/tiers/:id/comments/:card/:cid：本人或管理员
func (a *App) handleTierCommentDelete(static string) userHandler {
	return func(w http.ResponseWriter, r *http.Request, u string) {
		board, card, cid := r.PathValue("id"), r.PathValue("card"), r.PathValue("cid")
		if tierBoardCards(static, board) == nil {
			fail(w, 404, "没有这张榜")
			return
		}
		code, msg := 404, "没有这条评论"
		err := a.store.updateTierComments(board, func(m map[string][]TierComment) error {
			list := m[card]
			for i, c := range list {
				if c.ID != cid {
					continue
				}
				if c.User != u && !isAdmin(u) {
					code, msg = 403, "只能删自己的评论"
					return nil
				}
				m[card] = append(list[:i:i], list[i+1:]...)
				if len(m[card]) == 0 {
					delete(m, card)
				}
				code, msg = 200, ""
				return nil
			}
			return nil
		})
		if err != nil {
			fail(w, 500, "保存失败："+err.Error())
			return
		}
		if code != 200 {
			fail(w, code, msg)
			return
		}
		writeJSONResp(w, 200, map[string]any{"deleted": cid})
	}
}

// PATCH /api/tiers/:id/comments/:card/:cid {"text": "…"}：只能改自己的；改了记 edited
func (a *App) handleTierCommentEdit(static string) userHandler {
	return func(w http.ResponseWriter, r *http.Request, u string) {
		board, card, cid := r.PathValue("id"), r.PathValue("card"), r.PathValue("cid")
		if tierBoardCards(static, board) == nil {
			fail(w, 404, "没有这张榜")
			return
		}
		var b struct {
			Text string `json:"text"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&b) != nil {
			fail(w, 400, "请求体不是 JSON")
			return
		}
		text := cleanComment(b.Text)
		if text == "" {
			fail(w, 400, "评论是空的；不想要了就删掉")
			return
		}
		if len([]rune(text)) > tierCommentMax {
			fail(w, 400, "评论最多 500 字")
			return
		}
		code, msg := 404, "没有这条评论"
		var out TierComment
		err := a.store.updateTierComments(board, func(m map[string][]TierComment) error {
			for i, c := range m[card] {
				if c.ID != cid {
					continue
				}
				if c.User != u {
					code, msg = 403, "只能改自己的评论"
					return nil
				}
				m[card][i].Text, m[card][i].Edited = text, now()
				out, code = m[card][i], 200
				return nil
			}
			return nil
		})
		if err != nil {
			fail(w, 500, "保存失败："+err.Error())
			return
		}
		if code != 200 {
			fail(w, code, msg)
			return
		}
		writeJSONResp(w, 200, out)
	}
}

// tierCommentCounts：各卡评论数（玩家评级汇总接口顺带给，总榜上显示）
func (s *Store) tierCommentCounts(board string) map[string]int {
	out := map[string]int{}
	for card, list := range s.TierComments(board) {
		out[card] = len(list)
	}
	return out
}
