#!/bin/sh
# gkbench 命令行工具的安装脚本（macOS / Linux）。
#
#   curl -fsSL https://hiro.matto.top/gkbench/install.sh | sh
#
# 把对应平台的可执行文件下载到 ~/.local/bin/gkbench（GKBENCH_INSTALL_DIR 可以换目录），核对 SHA-256。
# 不改 shell 配置；目录不在 PATH 里时会告诉你要加哪一行。再跑一遍就是升级。
set -eu

BASE="${GKBENCH_SERVER:-https://hiro.matto.top/gkbench}"
DIR="${GKBENCH_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "这个安装脚本只管 macOS 和 Linux。Windows 用 PowerShell：irm $BASE/install.ps1 | iex" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=amd64 ;;
  *) echo "没有 $(uname -m) 的版本" >&2; exit 1 ;;
esac
name="gkbench-$os-$arch"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "下载 $BASE/cli/$name"
curl -fsSL "$BASE/cli/$name" -o "$tmp/gkbench"
curl -fsSL "$BASE/cli/SHA256SUMS" -o "$tmp/SHA256SUMS"

want="$(awk -v n="$name" '$2 == n {print $1}' "$tmp/SHA256SUMS")"
if command -v sha256sum >/dev/null 2>&1; then
  got="$(sha256sum "$tmp/gkbench" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  got="$(shasum -a 256 "$tmp/gkbench" | awk '{print $1}')"
else
  got=""
  echo "这台机器没有 sha256sum / shasum，跳过校验" >&2
fi
if [ -n "$got" ] && [ "$got" != "$want" ]; then
  echo "校验和对不上，没有安装（下载到的 $got，应是 $want）" >&2
  exit 1
fi

mkdir -p "$DIR"
chmod +x "$tmp/gkbench"
mv "$tmp/gkbench" "$DIR/gkbench"
echo "装好了：$DIR/gkbench（$("$DIR/gkbench" version)）"

case ":$PATH:" in
  *":$DIR:"*) ;;
  *) echo "注意：$DIR 不在 PATH 里。在 ~/.zshrc 或 ~/.bashrc 里加一行："
     echo "  export PATH=\"$DIR:\$PATH\"" ;;
esac
echo "下一步：gkbench login"
