#!/usr/bin/env bash
# 票据 11 行为探针运行器：准备 /tmp 隔离环境（设置文档副本 + 旧会话副本）后跑 probe.mjs。
#
#   experiments/subagent-model-selection/run.sh
#
# 不写 ~/.dsh/settings.yaml，也不写 ~/.dsh/sessions：探针 patch 把 settings.path 与
# session-persistence-jsonl.root 指向 /tmp/dsh-ticket11。旧会话取票据 10 去重后批次
# 里的 M4 E1（无策略事件、完整 turn），复制到临时 session root 后由 agents.resume 恢复。
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="${TICKET11_ROOT:-/tmp/dsh-ticket11}"
DSH_ROOT="${DSH_HOME:-$HOME/.dsh}"
OLD_ID="${TICKET11_OLD_SESSION:-session-m4-E1-4478e2ed-ca11-47e8-a86f-53dc9876547f}"
SRC_SESSIONS="$DSH_ROOT/sessions/--Users-vito-data-dev-dsh-plugins--"
OLD_SRC="$SRC_SESSIONS/$OLD_ID"

test -f "$DSH_ROOT/settings.yaml" || { echo "error: settings.yaml not found under $DSH_ROOT" >&2; exit 1; }
test -f "$OLD_SRC/session.v3.jsonl.zstd" || { echo "error: old session not found: $OLD_SRC" >&2; exit 1; }

rm -rf "$ROOT"
mkdir -p "$ROOT/sessions/--Users-vito-data-dev-dsh-plugins--/$OLD_ID"
cp "$DSH_ROOT/settings.yaml" "$ROOT/settings.yaml"
cp "$OLD_SRC/session.v3.jsonl.zstd" "$ROOT/sessions/--Users-vito-data-dev-dsh-plugins--/$OLD_ID/"
shasum -a 256 "$ROOT/settings.yaml" "$ROOT/sessions/--Users-vito-data-dev-dsh-plugins--/$OLD_ID/session.v3.jsonl.zstd" | sed 's/^/  /'

set +e
PROBE_OLD_SESSION_ID="$OLD_ID" PROBE_OUT="$ROOT/probe.json" \
  dsh --profile headless --patch experiments/subagent-model-selection/probe.patch.yml
CODE=$?
set -e
echo "probe exit=$CODE report=$ROOT/probe.json"
exit "$CODE"
