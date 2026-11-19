#!/bin/bash
# 部署网页到 ycy（/opt/gkbench/web/dist），保留旧版本的 hash 分片。
#
# 用法：tools/deploy-web.sh [提交，默认 origin/develop]
#
# 为什么要保留旧分片：页面按路由懒加载（assets/Leaderboard-xxxx.js 这类文件名带内容 hash）。
# 直接换掉 dist，部署前打开的标签页切到别的页面时，去拿的是旧文件名，会 404，
# 报「Failed to fetch dynamically imported module」（2026-11-19 出过一次，视频导流期间 60+ 次）。
# 所以新 dist 放上去之前，把当前线上 dist/assets 里的文件用 cp -n 并进来（文件名带 hash，不会撞名），
# 再删掉超过 KEEP_DAYS 天、且不属于新版本的旧分片，免得无限变大。
#
# 其他约定：
# - 只从干净的 worktree 构建（主目录常有别的会话没提交的改动），提交必须已经推到 origin。
# - 旧 dist 改名为 dist.bak-deploy-<时间>-<提交>，只保留最近 KEEP_BAK 个由本脚本产生的备份；
#   手工留下的 dist.bak-* 不动。
set -euo pipefail

REF=${1:-origin/develop}
HOST=${DEPLOY_HOST:-ycy}
WEB=/opt/gkbench/web
KEEP_DAYS=${KEEP_DAYS:-14}
KEEP_BAK=${KEEP_BAK:-5}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WT=$ROOT/../gakumas-bench-worktrees/deploy

cd "$ROOT"
git fetch -q origin
SHA=$(git rev-parse --short "$REF^{commit}")
git branch -r --contains "$SHA" | grep -q "origin/" || { echo "提交 $SHA 还没推到 origin，先推再部署"; exit 1; }

# 1. 干净 worktree 构建
if [ ! -d "$WT" ]; then git worktree add -q --detach "$WT" "$SHA"; fi
if [ -n "$(git -C "$WT" status --porcelain --untracked-files=no)" ]; then echo "部署 worktree $WT 有未提交改动，先处理"; exit 1; fi
git -C "$WT" checkout -q --detach "$SHA"
[ -e "$WT/web/node_modules" ] || ln -s "$ROOT/web/node_modules" "$WT/web/node_modules"
echo "== 构建 $SHA"
(cd "$WT/web" && rm -rf dist && npm run -s build) > /tmp/deploy-web-build.log 2>&1 || { tail -30 /tmp/deploy-web-build.log; exit 1; }
INDEX_JS=$(grep -o 'assets/index-[^"]*\.js' "$WT/web/dist/index.html" | head -1)
[ -n "$INDEX_JS" ] || { echo "构建产物里找不到 index-*.js"; exit 1; }

# 2. 上传到旁边的新目录
TS=$(date +%Y%m%d-%H%M%S)
NEW=$WEB/dist.new-$TS
echo "== 上传到 $HOST:$NEW"
rsync -az --delete "$WT/web/dist/" "$HOST:$NEW/"

# 3. 服务器上：合并旧分片 → 切换 → 清理
ssh "$HOST" bash -s -- "$WEB" "$NEW" "$TS" "$SHA" "$KEEP_DAYS" "$KEEP_BAK" <<'REMOTE'
set -euo pipefail
WEB=$1 NEW=$2 TS=$3 SHA=$4 KEEP_DAYS=$5 KEEP_BAK=$6
cd "$WEB"
new_files=$(cd "$NEW/assets" && ls)
if [ -d dist/assets ]; then
  cp -n -p dist/assets/* "$NEW/assets/" 2>/dev/null || true
fi
# 超过 KEEP_DAYS 天、又不属于新版本的旧分片删掉
pruned=0
for f in $(find "$NEW/assets" -maxdepth 1 -type f -mtime +"$KEEP_DAYS" -printf '%f\n'); do
  grep -qxF "$f" <<<"$new_files" || { rm -f "$NEW/assets/$f"; pruned=$((pruned + 1)); }
done
echo "assets：新版本 $(wc -l <<<"$new_files") 个，合并后 $(ls "$NEW/assets" | wc -l) 个，清掉过期 $pruned 个"
# 切换（两次 rename，中间空档在毫秒级）
if [ -d dist ]; then mv dist "dist.bak-deploy-$TS-$SHA"; fi
mv "$NEW" dist
# 只清理本脚本留下的备份
ls -1d dist.bak-deploy-* 2>/dev/null | sort | head -n -"$KEEP_BAK" | xargs -r rm -rf
REMOTE

# 4. 检查线上
URL=https://hiro.matto.top/gkbench
LIVE=$(curl -fsS "$URL/" | grep -o 'assets/index-[^"]*\.js' | head -1)
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$URL/$LIVE")
if [ "$LIVE" = "$INDEX_JS" ] && [ "$CODE" = 200 ]; then
  echo "== 已上线 $SHA（$LIVE 200）"
else
  echo "== 检查失败：线上 index 是 $LIVE（期望 $INDEX_JS），状态 $CODE"; exit 1
fi
