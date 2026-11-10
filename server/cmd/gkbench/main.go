// gkbench：gakumas-bench 的命令行工具，一个不依赖别的东西的可执行文件。
//
//	curl -fsSL https://hiro.matto.top/gkbench/install.sh | sh     # 装到 ~/.local/bin/gkbench
//	gkbench login                                                 # 浏览器里点一下授权，令牌存到 ~/.config/gkbench/token
//	gkbench upload exam.json --set <集合>                          # 传考试，服务器核对后逐道报结果
//
// 令牌文件和仓库里 Python 版（python -m gkbench）共用。除了判断是不是终端用了 golang.org/x/term，只用标准库。
package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"golang.org/x/term"
)

var version = "dev" // 构建时用 -ldflags "-X main.version=…" 写入

const usage = `gkbench：学マス考试出牌算法 benchmark（gakumas-bench）的命令行工具

用法
  gkbench login [--no-browser] [--force]     登录：打开浏览器，在网页上点「授权」
  gkbench logout                             退出：吊销这台电脑的令牌
  gkbench whoami                             现在登录的是谁
  gkbench sets                               列出試験集合（标出哪些你能传）
  gkbench new <名字>                          新建一个自己的集合
  gkbench upload <文件…> [--set 集合] [--name 题名] [--new 名字] [--json]
                                             传考试。文件是开局配置（gkms.hif_loadout.v1）或 .gksave.json，
                                             可以多个，也可以是 JSON Lines。不写 --set 时会列出集合让你选
  gkbench example                            打印一份完整的开局配置，改一改就能传
  gkbench version

怎么写一道考试
  格式说明（字段表、完整例子）  %[1]s/blob/develop/docs/format.md
  纯文本版（适合交给 AI 读）    https://raw.githubusercontent.com/matto49/gakumas-bench/develop/docs/format.md
  卡、饮料、P 道具、偶像的编号   %[2]s/api/catalog
  某个集合现成的题              %[2]s/api/sets/<集合>/problems

环境变量
  GKBENCH_SERVER      服务器地址，默认 %[3]s
  GKBENCH_TOKEN       令牌（给了就不读文件）
  GKBENCH_TOKEN_FILE  令牌文件，默认 ~/.config/gkbench/token
`

const defaultServer = "https://hiro.matto.top/gkbench"
const repoURL = "https://github.com/matto49/gakumas-bench"

// 和 docs/format.md「写一道题」里的例子相同
const exampleLoadout = `{
  "schema": "gkms.hif_loadout.v1",
  "idol_card_id": "i_card-shro-3-007",
  "produce_id": "produce-007",
  "step_type": 16,
  "round": "mid1",
  "parameters": [296, 221, 172],
  "score_bonus_permils": [13410, 14630, 8870],
  "deck_cards": [
    "p_card-00-acc-0_002",
    "p_card-00-sup-3_093+1",
    "p_card-02-act-1_037+1/p_card_custom-040_040_070-g_effect-p_card-02-act-1_037-enc_1-g_effect-p_card-02-act-1_037-enc_2-g_effect-p_card-02-act-1_037-enc_3",
    "p_card-02-men-0_039",
    "p_card-02-men-0_039",
    "p_card-02-men-1_031+1/p_card_custom-040_040_070-g_effect-aggressive_add-1-g_effect-aggressive_add-2-g_effect-aggressive_add-5*3"
  ],
  "include_produce_default": false,
  "produce_item_ids": ["pitem_02-3-076-0"],
  "starting_stamina": 33,
  "max_stamina": 33,
  "drink_ids": ["pdrink_00-2-010", "pdrink_02-1-008"],
  "support_cards": ["s_card-2-0007:56", "s_card-3-0039:70"],
  "memory_ability_ids": [],
  "main_item_enchant_ids": []
}
`

func server() string {
	if v := strings.TrimRight(os.Getenv("GKBENCH_SERVER"), "/"); v != "" {
		return v
	}
	return defaultServer
}

func tokenFile() string {
	if v := os.Getenv("GKBENCH_TOKEN_FILE"); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "gkbench", "token")
}

func loadToken() string {
	if v := strings.TrimSpace(os.Getenv("GKBENCH_TOKEN")); v != "" {
		return v
	}
	b, _ := os.ReadFile(tokenFile())
	return strings.TrimSpace(string(b))
}

type apiError struct {
	Status int
	Detail string
}

func (e *apiError) Error() string { return e.Detail }

var httpc = &http.Client{Timeout: 5 * time.Minute}

// call 调一个接口，把返回的 JSON 解到 out。4xx / 5xx 变成 *apiError（服务器的 detail 原样带上）
func call(method, path, tok string, body io.Reader, ctype string, out any) (int, error) {
	req, err := http.NewRequest(method, server()+path, body)
	if err != nil {
		return 0, err
	}
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	if ctype != "" {
		req.Header.Set("Content-Type", ctype)
	}
	req.Header.Set("User-Agent", "gkbench-cli/"+version)
	resp, err := httpc.Do(req)
	if err != nil {
		return 0, fmt.Errorf("连不上 %s：%v", server(), err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if resp.StatusCode >= 400 {
		var e struct {
			Detail string `json:"detail"`
		}
		_ = json.Unmarshal(raw, &e)
		if e.Detail == "" {
			e.Detail = fmt.Sprintf("服务器返回 %d", resp.StatusCode)
		}
		return resp.StatusCode, &apiError{resp.StatusCode, e.Detail}
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			return resp.StatusCode, fmt.Errorf("服务器的返回读不懂：%v", err)
		}
	}
	return resp.StatusCode, nil
}

func jsonBody(v any) io.Reader {
	b, _ := json.Marshal(v)
	return bytes.NewReader(b)
}

func die(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}

func isTTY(f *os.File) bool { return term.IsTerminal(int(f.Fd())) }

// args 把「--旗标 值」「--旗标=值」「--开关」和其余参数分开；旗标可以写在文件名前面或后面
func parseArgs(args []string, withValue, switches []string) (map[string]string, []string) {
	flags, rest := map[string]string{}, []string{}
	has := func(xs []string, k string) bool {
		for _, x := range xs {
			if x == k {
				return true
			}
		}
		return false
	}
	for i := 0; i < len(args); i++ {
		a := args[i]
		if !strings.HasPrefix(a, "--") {
			rest = append(rest, a)
			continue
		}
		k, v, eq := strings.Cut(a[2:], "=")
		switch {
		case has(switches, k) && !eq:
			flags[k] = "1"
		case has(withValue, k) && eq:
			flags[k] = v
		case has(withValue, k) && i+1 < len(args):
			i++
			flags[k] = args[i]
		default:
			die("不认识的参数 %s。用法见 gkbench help", a)
		}
	}
	return flags, rest
}

type me struct {
	User  string `json:"user"`
	Admin bool   `json:"admin"`
}

func whoami(tok string) (*me, error) {
	if tok == "" {
		return nil, &apiError{401, "还没登录"}
	}
	var m me
	_, err := call("GET", "/api/me", tok, nil, "", &m)
	return &m, err
}

func needLogin() string {
	tok := loadToken()
	if tok == "" {
		die("还没登录。先运行 gkbench login")
	}
	return tok
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func cmdLogin(args []string) {
	flags, _ := parseArgs(args, nil, []string{"no-browser", "force"})
	if os.Getenv("GKBENCH_TOKEN") != "" {
		die("设了环境变量 GKBENCH_TOKEN，命令行会一直用它。要用 gkbench login，先 unset GKBENCH_TOKEN")
	}
	if m, err := whoami(loadToken()); err == nil && flags["force"] == "" {
		fmt.Printf("已经登录为 %s。要换账号用 gkbench login --force\n", m.User)
		return
	}
	host, _ := os.Hostname()
	var st struct {
		Code, Device, URL string
		ExpiresIn         int `json:"expires_in"`
		Interval          int
	}
	if _, err := call("POST", "/api/cli/login", "", jsonBody(map[string]string{"host": host}), "application/json", &st); err != nil {
		die("登录没开始：%v", err)
	}
	fmt.Printf("在浏览器里打开下面的地址，登录后点「授权」：\n\n  %s\n\n网页上显示的代码应该是 %s。等待授权，%d 分钟内有效（Ctrl+C 取消）…\n", st.URL, st.Code, st.ExpiresIn/60)
	if flags["no-browser"] == "" {
		openBrowser(st.URL)
	}
	if st.Interval < 1 {
		st.Interval = 2
	}
	deadline := time.Now().Add(time.Duration(st.ExpiresIn) * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(time.Duration(st.Interval) * time.Second)
		var r struct{ Status, Token, User string }
		code, err := call("POST", "/api/cli/login/token", "", jsonBody(map[string]string{"device": st.Device}), "application/json", &r)
		var ae *apiError
		switch {
		case err == nil && code == 200 && r.Token != "":
			f := tokenFile()
			if err := os.MkdirAll(filepath.Dir(f), 0o700); err != nil {
				die("令牌没存上：%v", err)
			}
			if err := os.WriteFile(f, []byte(r.Token+"\n"), 0o600); err != nil {
				die("令牌没存上：%v", err)
			}
			fmt.Printf("已登录为 %s。令牌存在 %s，在网页「我的」页可以吊销。\n", r.User, f)
			return
		case err == nil: // 202：还没批
		case errors.As(err, &ae) && ae.Status >= 400 && ae.Status < 500:
			die("登录没成：%v", err)
		default: // 网络抖动，接着等
		}
	}
	die("等了 %d 分钟没有授权，重新运行 gkbench login", st.ExpiresIn/60)
}

func cmdLogout() {
	if os.Getenv("GKBENCH_TOKEN") != "" {
		die("现在用的是环境变量 GKBENCH_TOKEN 里的令牌，gkbench logout 不动它；到网页「我的」页吊销")
	}
	tok := loadToken()
	if tok == "" {
		fmt.Println("本来就没登录。")
		return
	}
	h := sha256.Sum256([]byte(tok))
	_, err := call("DELETE", "/api/me/tokens/"+hex.EncodeToString(h[:])[:12], tok, nil, "", nil)
	_ = os.Remove(tokenFile())
	if err != nil {
		fmt.Printf("本机的令牌删了；服务器那边没吊销成（%v），可以到网页「我的」页吊销。\n", err)
		return
	}
	fmt.Println("已退出，这台电脑的令牌已吊销。")
}

type setInfo struct {
	Set      string `json:"set"`
	Title    string `json:"title"`
	Status   string `json:"status"`
	Owner    string `json:"owner"`
	Problems int    `json:"problems"`
	CanEdit  bool   `json:"can_edit"`
}

func listSets(tok string) []setInfo {
	var sets []setInfo
	if _, err := call("GET", "/api/sets", tok, nil, "", &sets); err != nil {
		die("集合列不出来：%v", err)
	}
	return sets
}

func statusLabel(s string) string {
	if s == "community" {
		return "社区"
	}
	return "官方"
}

func cmdSets() {
	tok := loadToken()
	for _, s := range listSets(tok) {
		mark := "  "
		if s.CanEdit {
			mark = "✓ "
		}
		fmt.Printf("%s%-24s %s  %d 题  %s  提交人 %s\n", mark, s.Set, statusLabel(s.Status), s.Problems, s.Title, s.Owner)
	}
	if tok == "" {
		fmt.Println("\n登录后（gkbench login）前面带 ✓ 的是你能传的集合。")
	} else {
		fmt.Println("\n前面带 ✓ 的是你能传的集合。新建一个：gkbench new <名字>")
	}
}

func newSet(tok, title string) string {
	var r struct{ Set, Title string }
	if _, err := call("POST", "/api/sets", tok, jsonBody(map[string]string{"title": title}), "application/json", &r); err != nil {
		die("集合没建成：%v", err)
	}
	return r.Set
}

// chooseSet 没写 --set 时：只有一个能传的就用它；有几个且在终端里就让人选；否则报出来让调用方写 --set
func chooseSet(tok string) string {
	var mine []setInfo
	for _, s := range listSets(tok) {
		if s.CanEdit {
			mine = append(mine, s)
		}
	}
	if len(mine) == 0 {
		die("你还没有能传的集合。先建一个：gkbench new <名字>，或者 gkbench upload <文件> --new <名字>")
	}
	if len(mine) == 1 {
		return mine[0].Set
	}
	if !isTTY(os.Stdin) {
		fmt.Fprintln(os.Stderr, "要用 --set 指明传到哪个集合：")
		for _, s := range mine {
			fmt.Fprintf(os.Stderr, "  --set %-24s %s（%d 题）\n", s.Set, s.Title, s.Problems)
		}
		os.Exit(1)
	}
	fmt.Println("传到哪个集合？")
	for i, s := range mine {
		fmt.Printf("  %d. %s  %s  %s（%d 题）\n", i+1, s.Set, statusLabel(s.Status), s.Title, s.Problems)
	}
	in := bufio.NewReader(os.Stdin)
	for {
		fmt.Printf("输入序号 1–%d：", len(mine))
		line, err := in.ReadString('\n')
		if err != nil {
			die("\n没选集合，取消了")
		}
		if n, err := strconv.Atoi(strings.TrimSpace(line)); err == nil && n >= 1 && n <= len(mine) {
			return mine[n-1].Set
		}
	}
}

type job struct {
	Job      string           `json:"job"`
	Status   string           `json:"status"`
	Done     int              `json:"done"`
	Total    int              `json:"total"`
	Accepted int              `json:"accepted"`
	Added    []map[string]any `json:"added"`
	Rejected []map[string]any `json:"rejected"`
	Error    string           `json:"error"`
}

func cmdUpload(args []string) {
	flags, files := parseArgs(args, []string{"set", "name", "new"}, []string{"json"})
	if len(files) == 0 {
		die("要给文件：gkbench upload exam.json --set <集合>。没有文件可以先 gkbench example > exam.json 拿一份例子改")
	}
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			die("读不了 %s：%v", f, err)
		}
		if !json.Valid(raw) { // JSON Lines 整体不是合法 JSON，逐行看
			for i, line := range strings.Split(string(raw), "\n") {
				if strings.TrimSpace(line) != "" && !json.Valid([]byte(line)) {
					die("%s 不是 JSON：第 %d 行读不懂。整个文件应是一个 JSON 对象，或者每行一个（JSON Lines）", f, i+1)
				}
			}
		}
		w, _ := mw.CreateFormFile("files", filepath.Base(f))
		_, _ = w.Write(raw)
	}
	if flags["name"] != "" {
		_ = mw.WriteField("name", flags["name"])
	}
	_ = mw.Close()

	tok := needLogin()
	set := flags["set"]
	switch {
	case flags["new"] != "" && set != "":
		die("--set 和 --new 只能写一个")
	case flags["new"] != "":
		set = newSet(tok, flags["new"])
		fmt.Fprintf(os.Stderr, "建了集合 %s\n", set)
	case set == "":
		set = chooseSet(tok)
	}

	var j job
	path := "/api/sets/" + set + "/problems"
	_, err := call("POST", path+"?wait=1", tok, bytes.NewReader(body.Bytes()), mw.FormDataContentType(), &j)
	var ae *apiError
	if errors.As(err, &ae) && strings.Contains(ae.Detail, "wait=1") { // 题多：不等，自己轮询
		if _, err = call("POST", path, tok, bytes.NewReader(body.Bytes()), mw.FormDataContentType(), &j); err == nil {
			for j.Status == "queued" || j.Status == "running" {
				fmt.Fprintf(os.Stderr, "\r核对中 %d / %d", j.Done, j.Total)
				time.Sleep(1500 * time.Millisecond)
				if _, err = call("GET", "/api/jobs/"+j.Job, tok, nil, "", &j); err != nil {
					break
				}
			}
			fmt.Fprintln(os.Stderr)
		}
	}
	if err != nil {
		if errors.As(err, &ae) && ae.Status == 401 {
			die("令牌失效了，重新运行 gkbench login")
		}
		die("没传成：%v", err)
	}
	if flags["json"] != "" {
		out, _ := json.MarshalIndent(map[string]any{"set": set, "accepted": j.Accepted, "added": j.Added, "rejected": j.Rejected,
			"total": j.Total, "status": j.Status, "url": server() + "/exams/" + set}, "", "  ")
		fmt.Println(string(out))
	} else {
		fmt.Printf("集合 %s：收下 %d 道，没收 %d 道\n", set, j.Accepted, len(j.Rejected))
		for _, a := range j.Added {
			fmt.Printf("  + %v  %v（题族 %v）\n", a["id"], a["name"], a["family"])
		}
		for _, r := range j.Rejected {
			fmt.Printf("  × %v：%v\n", r["id"], r["reason"])
		}
		if j.Accepted > 0 {
			fmt.Printf("看题：%s/exams/%s\n", server(), set)
		}
	}
	if j.Accepted == 0 || len(j.Rejected) > 0 {
		os.Exit(1)
	}
}

func main() {
	args := os.Args[1:]
	if len(args) == 0 {
		args = []string{"help"}
	}
	switch args[0] {
	case "login":
		cmdLogin(args[1:])
	case "logout":
		cmdLogout()
	case "whoami":
		m, err := whoami(loadToken())
		if err != nil {
			die("还没登录（或令牌失效了）。运行 gkbench login")
		}
		if m.Admin {
			fmt.Printf("%s（管理员）  %s\n", m.User, server())
		} else {
			fmt.Printf("%s  %s\n", m.User, server())
		}
	case "sets":
		cmdSets()
	case "new":
		if len(args) != 2 || strings.HasPrefix(args[1], "--") {
			die("用法：gkbench new <名字>")
		}
		set := newSet(needLogin(), args[1])
		fmt.Printf("建了集合 %s。往里传：gkbench upload exam.json --set %s\n", set, set)
	case "upload":
		cmdUpload(args[1:])
	case "example":
		fmt.Print(exampleLoadout)
	case "version", "--version", "-v":
		fmt.Println("gkbench", version)
	case "help", "--help", "-h":
		fmt.Printf(usage, repoURL, server(), defaultServer)
	default:
		die("不认识的命令 %s。用法见 gkbench help", args[0])
	}
}
