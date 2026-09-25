#!/usr/bin/env bash
# 票据 04 — 为 dsh-runtime/stable 重建「扁平 @deepseek-ai 镜像」（归档 as-run 等价脚本）。
#
# 背景：部署位 preset 的 node_modules/@deepseek-ai 是 symlink，指向 stable 运行时的 scope 目录
#       （scripts/sync-agent-presets.sh 的契约：bare `@deepseek-ai/*` 导入从 preset 目录解析）。
#       2026-09-25 按 lock `npm ci` 重建 stable 后，部分 scoped 包只存在于
#       `@deepseek-ai/dsh/node_modules/` 等 nested 位置，顶层 scope 目录不再扁平，
#       导致 minimal-plus 的 `phase-swap-bash.mjs` 无法 import `@deepseek-ai/dsh-tool-bash`。
#
# 行为：为「全树存在、顶层缺失」的 scoped 包名，在顶层 scope 目录建内部 symlink
#       （优先指向 `@deepseek-ai/dsh/node_modules/` 内的副本），恢复扁平解析面；
#       不新增/删除任何 npm 实体包，全部为运行时目录内的相对内部链接。
# 用法：bash 04-stable-flat-mirror.sh [stable 目录]
# 注意：stable 每次 `npm ci` 重建 node_modules 后需重放本脚本（扁平镜像非 npm 管理面）。
set -euo pipefail

S="${1:-/Users/vito/data/dev/dsh-runtime/stable}"
top="$S/node_modules/@deepseek-ai"
[ -d "$top" ] || { echo "no scope dir: $top" >&2; exit 1; }

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
find "$S/node_modules" -type f -path '*/node_modules/@deepseek-ai/*/package.json' > "$tmp"
names="$(sed -E 's#.*/node_modules/@deepseek-ai/([^/]+)/package.json#\1#' "$tmp" | sort -u)"

created=0
skipped=0
for name in $names; do
  [ -e "$top/$name" ] && continue
  preferred="$(grep -m1 "/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/${name}/package.json$" "$tmp" || true)"
  target="${preferred%/package.json}"
  if [ -z "$target" ]; then
    first="$(grep -m1 "/node_modules/@deepseek-ai/${name}/package.json$" "$tmp" || true)"
    target="${first%/package.json}"
  fi
  if [ -n "$target" ] && [ -e "$target/package.json" ]; then
    ln -sfn "$target" "$top/$name"
    created=$((created + 1))
  else
    echo "skip $name (no resolvable nested copy)" >&2
    skipped=$((skipped + 1))
  fi
done

echo "flat mirror: created=$created skipped=$skipped top-level=$(ls -1 "$top" | wc -l | tr -d ' ')"
