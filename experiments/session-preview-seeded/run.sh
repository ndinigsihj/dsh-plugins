#!/usr/bin/env bash
# Stage 7 反馈回路运行器（finding 06-4）：seeded 子会话预览读取探针。
#
#   experiments/session-preview-seeded/run.sh [sessionId]
#
# 只写 /tmp/dsh-ticket13-seeded-preview（settings 副本 + 报告）；不写
# ~/.dsh/settings.yaml 与 ~/.dsh/sessions（探针只读真实会话）。
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="${TICKET13_PREVIEW_ROOT:-/tmp/dsh-ticket13-seeded-preview}"
DSH_ROOT="${DSH_HOME:-$HOME/.dsh}"
SESSION_ID="${1:-${SEEDED_SESSION_ID:-session-6846f8fa-18eb-4ce8-8f85-4b6a36b37aff}}"

test -f "$DSH_ROOT/settings.yaml" || { echo "error: settings.yaml not found under $DSH_ROOT" >&2; exit 1; }

rm -rf "$ROOT"
mkdir -p "$ROOT"
cp "$DSH_ROOT/settings.yaml" "$ROOT/settings.yaml"
shasum -a 256 "$ROOT/settings.yaml" | sed 's/^/  /'

set +e
PROBE_OUT="$ROOT/probe.json" SEEDED_SESSION_ID="$SESSION_ID" \
  dsh --profile headless --patch experiments/session-preview-seeded/probe.patch.yml
CODE=$?
set -e
echo "seeded-preview probe exit=$CODE report=$ROOT/probe.json session=$SESSION_ID"
exit "$CODE"
