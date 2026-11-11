package main

import (
	"bytes"
	"testing"

	"github.com/klauspost/compress/zstd"
)

func zstdLines(t *testing.T, n int) []byte {
	var b bytes.Buffer
	zw, err := zstd.NewWriter(&b)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < n; i++ {
		zw.Write([]byte(`{"schema":"gkbench.episode.v2","id":"AS-X"}` + "\n\n"))
	}
	zw.Close()
	return b.Bytes()
}

func TestCountEpisodeLinesStopsAtLimit(t *testing.T) {
	if n, err := countEpisodeLines(zstdLines(t, 5), 100); err != nil || n != 5 {
		t.Fatalf("5 局：%d %v", n, err)
	}
	if n, err := countEpisodeLines(zstdLines(t, 50), 10); err != nil || n != 11 {
		t.Fatalf("超过上限时数到上限 + 1 就停：%d %v", n, err)
	}
	if _, err := countEpisodeLines([]byte("not zstd"), 10); err == nil {
		t.Fatal("坏数据要报错")
	}
}
