#!/usr/bin/env bash
# 票据 12 允许路由真实验证运行器：预置 /tmp 隔离 home（0.1.7 preset 载体 + 设置副本）后跑 route-probe.mjs。
#
#   experiments/subagent-model-selection/run-route-probe.sh
#
# 不写 ~/.dsh/settings.yaml，也不写 ~/.dsh/sessions：隔离 home（$ROOT/home）承载 profile 与
# preset bundle，探针 patch 把 settings.path 与 session-persistence-jsonl.root 指向 /tmp/dsh-ticket12。
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="${TICKET12_ROOT:-/tmp/dsh-ticket12}"
DSH_ROOT="${DSH_HOME:-$HOME/.dsh}"

test -f "$DSH_ROOT/settings.yaml" || { echo "error: settings.yaml not found under $DSH_ROOT" >&2; exit 1; }

rm -rf "$ROOT"
mkdir -p "$ROOT/sessions"
cp "$DSH_ROOT/settings.yaml" "$ROOT/settings.yaml"
shasum -a 256 "$ROOT/settings.yaml" | sed 's/^/  /'

# 0.1.7 载体：隔离 home 的 headless 骨架 + 从真源生成的 preset bundle + 宿主侧模型选择单例。
# 单例的部署基线（允许路由集合）来自 allowed-routes.mjs，放 profile 层而不是 overlay。
SETTINGS_CONFIG="$(node experiments/subagent-model-selection/allowed-routes.mjs --print-config)"
node scripts/profile-home.mjs --home "$ROOT/home" --source presets/minimal-plus --settings-config "$SETTINGS_CONFIG" >/dev/null

set +e
DSH_HOME="$ROOT/home" HOME="$ROOT/home" PROBE_OUT="$ROOT/route-probe.json" \
  dsh --profile headless --patch experiments/subagent-model-selection/route-probe.patch.yml
CODE=$?
set -e
echo "route probe exit=$CODE report=$ROOT/route-probe.json"
exit "$CODE"
