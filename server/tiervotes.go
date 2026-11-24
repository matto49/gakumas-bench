package main

import (
	"encoding/json"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

// 角色强度榜的玩家评级：登录的玩家给一张榜上的每张偶像卡选一档（S–D，和数据榜同一套档位），可以改、可以撤，每人每卡一票。
// 存 $DATA/tier-votes/<榜>.json：{卡: {用户: 档}}。接口只公开汇总（票数、各档票数、平均分 S=5…D=1）和自己投的那档，不公开谁投了什么。
var tierVotesMu sync.Mutex

var tierGradeScore = map[string]int{"S": 5, "A": 4, "B": 3, "C": 2, "D": 1}

func (s *Store) tierVotesPath(board string) string {
	return filepath.Join(s.Data, "tier-votes", board+".json")
}

func (s *Store) TierVotes(board string) map[string]map[string]string {
	tierVotesMu.Lock()
	defer tierVotesMu.Unlock()
	m := map[string]map[string]string{}
	_ = readJSON(s.tierVotesPath(board), &m)
	return m
}

// SetTierVote：tier 为空就撤掉这个人对这张卡的票
func (s *Store) SetTierVote(board, card, user, tier string) error {
	tierVotesMu.Lock()
	defer tierVotesMu.Unlock()
	p := s.tierVotesPath(board)
	m := map[string]map[string]string{}
	if err := readJSON(p, &m); err != nil && !os.IsNotExist(err) {
		return err
	}
	if tier == "" {
		delete(m[card], user)
		if len(m[card]) == 0 {
			delete(m, card)
		}
	} else {
		if m[card] == nil {
			m[card] = map[string]string{}
		}
		m[card][user] = tier
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return writeJSON(p, m, 0o644)
}

// tierBoardCards：榜单文件 $static/tiers/<榜>.json 里有哪些卡；榜不存在返回 nil
func tierBoardCards(static, board string) map[string]bool {
	if !staticName.MatchString(board) {
		return nil
	}
	var b struct {
		Cards []struct {
			ID string `json:"id"`
		} `json:"cards"`
	}
	if readJSON(filepath.Join(static, "tiers", board+".json"), &b) != nil {
		return nil
	}
	out := map[string]bool{}
	for _, c := range b.Cards {
		out[c.ID] = true
	}
	return out
}

type tierVoteSummary struct {
	N    int            `json:"n"`
	Mean float64        `json:"mean"`
	Dist map[string]int `json:"dist"`
}

func summarizeTierVotes(votes map[string]map[string]string) map[string]tierVoteSummary {
	out := map[string]tierVoteSummary{}
	for card, byUser := range votes {
		sum := tierVoteSummary{Dist: map[string]int{}}
		total := 0
		for _, t := range byUser {
			if sc, ok := tierGradeScore[t]; ok {
				sum.N++
				sum.Dist[t]++
				total += sc
			}
		}
		if sum.N > 0 {
			sum.Mean = math.Round(float64(total)/float64(sum.N)*100) / 100
			out[card] = sum
		}
	}
	return out
}

// GET /api/tiers/:id/votes：各卡汇总；登录了再带上自己投的
func (a *App) handleTierVotes(static string) userHandler {
	return func(w http.ResponseWriter, r *http.Request, u string) {
		board := r.PathValue("id")
		if tierBoardCards(static, board) == nil {
			fail(w, 404, "没有这张榜")
			return
		}
		votes := a.store.TierVotes(board)
		mine := map[string]string{}
		if u != "" {
			for card, byUser := range votes {
				if t, ok := byUser[u]; ok {
					mine[card] = t
				}
			}
		}
		writeJSONResp(w, 200, map[string]any{"cards": summarizeTierVotes(votes), "mine": mine, "comments": a.store.tierCommentCounts(board)})
	}
}

// PUT /api/tiers/:id/votes/:card {"tier":"S"|…|"D"|""}：投、改或撤（空串）
func (a *App) handleTierVote(static string) userHandler {
	return func(w http.ResponseWriter, r *http.Request, u string) {
		board, card := r.PathValue("id"), r.PathValue("card")
		cards := tierBoardCards(static, board)
		if cards == nil {
			fail(w, 404, "没有这张榜")
			return
		}
		if !cards[card] {
			fail(w, 404, "这张榜上没有这张卡")
			return
		}
		var b struct {
			Tier string `json:"tier"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&b) != nil {
			fail(w, 400, "请求体不是 JSON")
			return
		}
		if _, ok := tierGradeScore[b.Tier]; b.Tier != "" && !ok {
			fail(w, 400, "档位只能是 S、A、B、C、D，或空（撤票）")
			return
		}
		if err := a.store.SetTierVote(board, card, u, b.Tier); err != nil {
			fail(w, 500, "保存失败："+err.Error())
			return
		}
		votes := a.store.TierVotes(board)
		writeJSONResp(w, 200, map[string]any{"card": card, "tier": b.Tier, "summary": summarizeTierVotes(votes)[card]})
	}
}
