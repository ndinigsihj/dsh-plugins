#!/usr/bin/env bash
# 票据 11 行为探针运行器：预置 /tmp 隔离环境（0.1.7 preset 载体 + 设置文档副本 + 旧会话副本）
# 后跑 probe.mjs。
#
#   experiments/subagent-model-selection/run.sh
#
# 不写 ~/.dsh/settings.yaml，也不写 ~/.dsh/sessions：隔离 home（$ROOT/home）承载 profile 与
# preset bundle，探针 patch 把 settings.path 与 session-persistence-jsonl.root 指向
# /tmp/dsh-ticket11。旧会话默认取票据 10 去重后批次的 M4 E1；该会话已不在真实 sessions 树时
# 用 TICKET11_OLD_SESSION 指一条无策略事件的旧会话，或直接跑闸门 `--tier 3`（自带旧会话）。
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="${TICKET11_ROOT:-/tmp/dsh-ticket11}"
DSH_ROOT="${DSH_HOME:-$HOME/.dsh}"
OLD_ID="${TICKET11_OLD_SESSION:-session-m4-E1-4478e2ed-ca11-47e8-a86f-53dc9876547f}"
SRC_SESSIONS="$DSH_ROOT/sessions/--Users-vito-data-dev-dsh-plugins--"
OLD_SRC="$SRC_SESSIONS/$OLD_ID"

test -f "$DSH_ROOT/settings.yaml" || { echo "error: settings.yaml not found under $DSH_ROOT" >&2; exit 1; }
test -f "$OLD_SRC/session.v3.jsonl.zstd" || { echo "error: old session not found: $OLD_SRC (set TICKET11_OLD_SESSION)" >&2; exit 1; }

rm -rf "$ROOT"
mkdir -p "$ROOT/sessions/--Users-vito-data-dev-dsh-plugins--/$OLD_ID"
cp "$DSH_ROOT/settings.yaml" "$ROOT/settings.yaml"
cp "$OLD_SRC/session.v3.jsonl.zstd" "$ROOT/sessions/--Users-vito-data-dev-dsh-plugins--/$OLD_ID/"
shasum -a 256 "$ROOT/settings.yaml" "$ROOT/sessions/--Users-vito-data-dev-dsh-plugins--/$OLD_ID/session.v3.jsonl.zstd" | sed 's/^/  /'

# 0.1.7 载体：隔离 home 的 headless 骨架 + 从真源生成的 preset bundle + 宿主侧模型选择单例。
# 单例的部署基线（允许路由集合）来自 allowed-routes.mjs，放 profile 层而不是 overlay：
# settings 编辑器拒绝写入被 --patch 覆盖的条目，a9 需要可写的 user 层。
SETTINGS_CONFIG="$(node experiments/subagent-model-selection/allowed-routes.mjs --print-config)"
node scripts/profile-home.mjs --home "$ROOT/home" --source presets/minimal-plus --settings-config "$SETTINGS_CONFIG" >/dev/null

set +e
DSH_HOME="$ROOT/home" HOME="$ROOT/home" PROBE_OLD_SESSION_ID="$OLD_ID" PROBE_OUT="$ROOT/probe.json" \
  dsh --profile headless --patch experiments/subagent-model-selection/probe.patch.yml
CODE=$?
set -e
echo "probe exit=$CODE report=$ROOT/probe.json"
exit "$CODE"
