#!/bin/sh
# 给各平台编译 gkbench 命令行工具，连同安装脚本和校验和放进一个目录；把这个目录同步到服务器的 $DATA/static/cli/ 就上线了。
#
#   sh server/cmd/gkbench/build.sh <输出目录> [版本号]
#
# 版本号默认取 git 的提交号。服务器从 /cli/<文件>、/install.sh、/install.ps1 发这些文件。
set -eu
out="${1:?用法：build.sh <输出目录> [版本号]}"
here="$(cd "$(dirname "$0")" && pwd)"
ver="${2:-$(git -C "$here" rev-parse --short HEAD)}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
cd "$here/../.."
for t in darwin/arm64 darwin/amd64 linux/amd64 linux/arm64 windows/amd64 windows/arm64; do
  os="${t%/*}"; arch="${t#*/}"; ext=""
  [ "$os" = windows ] && ext=".exe"
  CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath -ldflags "-s -w -X main.version=$ver" -o "$out/gkbench-$os-$arch$ext" ./cmd/gkbench
done
cp "$here/install.sh" "$here/install.ps1" "$out/"
# 校验和按没压缩的文件算；另给 macOS / Linux 的各出一份 .gz（约三分之一大小），安装脚本优先下它
(cd "$out" && rm -f SHA256SUMS gkbench-*.gz && shasum -a 256 gkbench-* > SHA256SUMS && echo "$ver" > VERSION \
  && for f in gkbench-darwin-* gkbench-linux-*; do gzip -9 -k "$f"; done)
ls -la "$out"
