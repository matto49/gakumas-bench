package main

import (
	"os"
	"testing"
)

// 冷启动：每轮新建 Store（没有缓存），量第一次排行。GKBENCH_BENCH_DATA 指向真实数据目录时才跑
func BenchmarkLeaderboardCold(b *testing.B) {
	data := os.Getenv("GKBENCH_BENCH_DATA")
	if data == "" {
		b.Skip("GKBENCH_BENCH_DATA 指向真实数据目录时才跑")
	}
	for i := 0; i < b.N; i++ {
		s := &Store{Data: data}
		if _, err := s.Leaderboard("hif", "", "", "template", ""); err != nil {
			b.Fatal(err)
		}
	}
}

// 预热全部集合
func BenchmarkWarm(b *testing.B) {
	data := os.Getenv("GKBENCH_BENCH_DATA")
	if data == "" {
		b.Skip("GKBENCH_BENCH_DATA 指向真实数据目录时才跑")
	}
	for i := 0; i < b.N; i++ {
		(&Store{Data: data}).Warm()
	}
}
