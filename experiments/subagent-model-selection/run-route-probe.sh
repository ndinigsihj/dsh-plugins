#!/usr/bin/env bash
# 票据 12 允许路由真实验证运行器：准备 /tmp 隔离设置副本后跑 route-probe.mjs。
#
#   experiments/subagent-model-selection/run-route-probe.sh
#
# 不写 ~/.dsh/settings.yaml，也不写 ~/.dsh/sessions：探针 patch 把 settings.path 与
# session-persistence-jsonl.root 指向 /tmp/dsh-ticket12。
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="${TICKET12_ROOT:-/tmp/dsh-ticket12}"
DSH_ROOT="${DSH_HOME:-$HOME/.dsh}"

test -f "$DSH_ROOT/settings.yaml" || { echo "error: settings.yaml not found under $DSH_ROOT" >&2; exit 1; }

rm -rf "$ROOT"
mkdir -p "$ROOT/sessions"
cp "$DSH_ROOT/settings.yaml" "$ROOT/settings.yaml"
shasum -a 256 "$ROOT/settings.yaml" | sed 's/^/  /'

set +e
PROBE_OUT="$ROOT/route-probe.json" \
  dsh --profile headless --patch experiments/subagent-model-selection/route-probe.patch.yml
CODE=$?
set -e
echo "route probe exit=$CODE report=$ROOT/route-probe.json"
exit "$CODE"
