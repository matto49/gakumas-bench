package main

// 整次上传成绩的局数上限：核对时整份读进内存（每局带逐步记录约 130KB，加上引擎子进程），
// 一次传几千局会把服务器内存吃光（2026-11-11 被系统杀了两次）。超过就拒收，让客户端分批传
// （gkbench upload 会自动按题分批；分批的几次运行在排行里按算法合成一行）。

import (
	"bufio"
	"bytes"
	"strings"

	"github.com/klauspost/compress/zstd"
)

const maxRunUploadEpisodes = 1000

// countEpisodeLines 数 episodes.jsonl.zst 里有几局（非空行），不解析 JSON；超过 limit 数到 limit+1 就停
func countEpisodeLines(raw []byte, limit int) (int, error) {
	zr, err := zstd.NewReader(bytes.NewReader(raw))
	if err != nil {
		return 0, err
	}
	defer zr.Close()
	sc := bufio.NewScanner(zr)
	sc.Buffer(make([]byte, 1<<20), 256<<20)
	n := 0
	for sc.Scan() {
		if strings.TrimSpace(sc.Text()) == "" {
			continue
		}
		n++
		if n > limit {
			break
		}
	}
	return n, sc.Err()
}
