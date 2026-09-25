#!/usr/bin/env bash
# Sync the repo's minimal-plus preset to the profile-side 0.1.7 carrier.
#
# 2026-09-25（票据 07）：0.1.7 起宿主不再读取 `~/.dsh/.agent-presets/<id>/` 目录形态，
# preset 载体改为插件组合包（bundle）里的声明行。本脚本现在只是
# `scripts/sync-agent-presets.mjs` 的薄入口，默认 dry-run（不写任何真实路径），
# 逐文件核对生成产物与仓库真源后打印目标位状态；显式 `--write` 才写部署位。
#
# Usage: scripts/sync-agent-presets.sh [--dry-run | --write] [preset-id] [--dest <dir>]
#   No argument plans `minimal-plus`; positional preset ids are passed through for
#   compatibility with the old interface.
set -euo pipefail
cd "$(dirname "$0")/.."

args=("$@")
if [[ $# -gt 0 && "$1" != -* ]]; then
  args=("--preset" "$1" "${@:2}")
fi

exec node scripts/sync-agent-presets.mjs "${args[@]}"
