package main

// GKMS 引擎子进程池。每个子进程按行收发 JSON（协议见 gkbench/worker.py），一次只处理一个请求。
// 托管对局固定在开局的那个子进程上；重放核对轮流分给各个子进程。子进程退出后下次调用时自动重启。

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
)

type Worker struct {
	idx   int
	argv  []string
	dir   string
	mu    sync.Mutex
	cmd   *exec.Cmd
	in    io.WriteCloser
	out   *bufio.Reader
	rid   int64
	epoch int64 // 每次重启加一；托管对局记下开局时的 epoch，子进程重启过就作废
}

func (w *Worker) start() error {
	cmd := exec.Command(w.argv[0], w.argv[1:]...)
	cmd.Dir = w.dir
	cmd.Env = os.Environ()
	cmd.Stderr = os.Stderr
	in, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	w.cmd, w.in, w.out = cmd, in, bufio.NewReaderSize(out, 1<<20)
	w.epoch++
	log.Printf("引擎子进程 %d 启动 pid=%d", w.idx, cmd.Process.Pid)
	return nil
}

func (w *Worker) stop() {
	if w.cmd != nil {
		_ = w.in.Close()
		_ = w.cmd.Process.Kill()
		_ = w.cmd.Wait()
		w.cmd = nil
	}
}

var errEngine = errors.New("引擎错误")

// Call 发一个请求，等一行回复。回复 ok=false 时返回 errEngine 包装的错误信息。
func (w *Worker) Call(req map[string]any) (map[string]any, int64, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.cmd == nil {
		if err := w.start(); err != nil {
			return nil, 0, err
		}
	}
	w.rid++
	req["rid"] = w.rid
	b, err := json.Marshal(req)
	if err != nil {
		return nil, w.epoch, err
	}
	if _, err := w.in.Write(append(b, '\n')); err != nil {
		w.stop()
		return nil, w.epoch, fmt.Errorf("写引擎子进程失败：%w", err)
	}
	line, err := w.out.ReadBytes('\n')
	if err != nil {
		w.stop()
		return nil, w.epoch, fmt.Errorf("引擎子进程退出：%w", err)
	}
	var rep map[string]any
	if err := json.Unmarshal(line, &rep); err != nil {
		return nil, w.epoch, fmt.Errorf("引擎回复不是 JSON：%w", err)
	}
	if ok, _ := rep["ok"].(bool); !ok {
		return rep, w.epoch, fmt.Errorf("%w：%v", errEngine, rep["error"])
	}
	return rep, w.epoch, nil
}

type Pool struct {
	workers []*Worker
	next    atomic.Int64
}

func NewPool(n int, argv []string, dir string) *Pool {
	p := &Pool{}
	for i := 0; i < n; i++ {
		p.workers = append(p.workers, &Worker{idx: i, argv: argv, dir: dir})
	}
	return p
}

func (p *Pool) Pick() *Worker {
	return p.workers[int(p.next.Add(1))%len(p.workers)]
}

func (p *Pool) Close() {
	for _, w := range p.workers {
		w.mu.Lock()
		w.stop()
		w.mu.Unlock()
	}
}
