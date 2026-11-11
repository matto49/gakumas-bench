package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSetAliasesRewritePathAndQuery(t *testing.T) {
	var gotPath, gotSet string
	h := withSetAliases(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotSet = r.URL.Path, r.URL.Query().Get("set")
	}))
	cases := []struct{ in, path, set string }{
		{"/api/sets/hif-live/problems", "/api/sets/hif/problems", ""},
		{"/api/sets/hajime-lesson-yuzeis", "/api/sets/hajime", ""},
		{"/api/sets/hif/problems", "/api/sets/hif/problems", ""},
		{"/api/sets/gkms480/problems", "/api/sets/gkms480/problems", ""},
		{"/api/leaderboard?set=hif-yuzeis&kind=template", "/api/leaderboard", "hif"},
		{"/api/leaderboard?set=idolroad-yuzeis", "/api/leaderboard", "idolroad"},
		{"/api/runs?set=nia", "/api/runs", "nia"},
	}
	for _, c := range cases {
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", c.in, nil))
		if gotPath != c.path || gotSet != c.set {
			t.Errorf("%s → %s set=%q，要 %s set=%q", c.in, gotPath, gotSet, c.path, c.set)
		}
	}
	if canonicalSet("nia-history") != "nia" || canonicalSet("hif") != "hif" {
		t.Error("canonicalSet 不对")
	}
}
