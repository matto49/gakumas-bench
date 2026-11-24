package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestTierComments(t *testing.T) {
	t.Setenv("GKBENCH_ADMINS", "boss")
	do := tierVoteApp(t)
	old := tierCommentCooldown
	tierCommentCooldown = time.Hour
	defer func() { tierCommentCooldown = old }()
	lastTierComment.Range(func(k, _ any) bool { lastTierComment.Delete(k); return true })

	base := "/api/tiers/hif-test/comments/i_card-a"
	if w := do("POST", base, `{"text":"hi"}`, ""); w.Code != 401 {
		t.Fatalf("没登录也能发 %d", w.Code)
	}
	if w := do("POST", base, `{"text":"   "}`, "alice"); w.Code != 400 {
		t.Fatalf("空评论 %d", w.Code)
	}
	if w := do("POST", base, `{"text":"`+strings.Repeat("长", 501)+`"}`, "alice"); w.Code != 400 {
		t.Fatalf("超长评论 %d", w.Code)
	}
	_ = do("PUT", "/api/tiers/hif-test/votes/i_card-a", `{"tier":"A"}`, "alice")
	if w := do("POST", base, `{"text":"  实战很稳\n\n\n\n抽卡运差也能打  "}`, "alice"); w.Code != 200 {
		t.Fatalf("发评论失败 %d %s", w.Code, w.Body.String())
	}
	if w := do("POST", base, `{"text":"再来一条"}`, "alice"); w.Code != 429 {
		t.Fatalf("没挡住刷屏 %d", w.Code)
	}
	if w := do("POST", base, `{"text":"我觉得一般"}`, "bob"); w.Code != 200 {
		t.Fatal("bob 发不了")
	}
	if w := do("POST", "/api/tiers/hif-test/comments/i_card-zzz", `{"text":"x"}`, "carol"); w.Code != 404 {
		t.Fatalf("榜上没有的卡 %d", w.Code)
	}

	var got struct {
		Comments []struct {
			ID, User, Text, Tier string
			CanDelete            bool `json:"can_delete"`
		} `json:"comments"`
	}
	w := do("GET", base, "", "alice")
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if len(got.Comments) != 2 || got.Comments[0].User != "bob" || got.Comments[1].Text != "实战很稳\n\n抽卡运差也能打" || got.Comments[1].Tier != "A" {
		t.Fatalf("列表不对 %+v", got)
	}
	if got.Comments[0].CanDelete || !got.Comments[1].CanDelete {
		t.Fatalf("删除权限标错 %+v", got)
	}
	bobID, aliceID := got.Comments[0].ID, got.Comments[1].ID
	if w := do("DELETE", base+"/"+bobID, "", "alice"); w.Code != 403 {
		t.Fatalf("删了别人的评论 %d", w.Code)
	}
	if w := do("DELETE", base+"/"+aliceID, "", "alice"); w.Code != 200 {
		t.Fatalf("删不了自己的 %d", w.Code)
	}
	if w := do("DELETE", base+"/"+bobID, "", "boss"); w.Code != 200 {
		t.Fatalf("管理员删不了 %d", w.Code)
	}
	if w := do("DELETE", base+"/nope", "", "boss"); w.Code != 404 {
		t.Fatalf("删不存在的 %d", w.Code)
	}
	var v struct {
		Comments map[string]int `json:"comments"`
	}
	_ = json.Unmarshal(do("GET", "/api/tiers/hif-test/votes", "", "").Body.Bytes(), &v)
	if v.Comments["i_card-a"] != 0 {
		t.Fatalf("删完计数还在 %v", v.Comments)
	}
}
