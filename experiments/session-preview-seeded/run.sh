#!/usr/bin/env bash
# 票 02 seeded 预览探针运行器（finding 06-4）：seeded 子会话预览读取。
#
#   experiments/session-preview-seeded/run.sh [sessionId]
#
# 只使用仓库资产：设置模板 `gates/fixtures/settings.min.yaml` + fixture
# `experiments/fixtures/session-preview-seeded/store`（探针自行复制到临时 store）。
# 不读 `~/.dsh/settings.yaml` 与 `~/.dsh/sessions`；临时根只写
# `${SEEDED_PREVIEW_ROOT:-${TMPDIR:-/tmp}/dsh-seeded-preview}`。
# 调用方可用 `DSH_HOME=<临时副本>` 让宿主 profile 规范化也落在副本上（票 03 的闸门路径）。
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="${SEEDED_PREVIEW_ROOT:-${TMPDIR:-/tmp}/dsh-seeded-preview}"
SETTINGS_TEMPLATE="gates/fixtures/settings.min.yaml"
FIXTURE_STORE="experiments/fixtures/session-preview-seeded/store"
SESSION_ID="${1:-${SEEDED_SESSION_ID:-session-6846f8fa-18eb-4ce8-8f85-4b6a36b37aff}}"

test -f "$SETTINGS_TEMPLATE" || { echo "error: settings template not found: $SETTINGS_TEMPLATE" >&2; exit 1; }
test -d "$FIXTURE_STORE" || { echo "error: fixture store not found: $FIXTURE_STORE" >&2; exit 1; }

rm -rf "$ROOT"
mkdir -p "$ROOT"
cp "$SETTINGS_TEMPLATE" "$ROOT/settings.yaml"

export SEEDED_PREVIEW_ROOT="$ROOT"
export SEEDED_PREVIEW_SESSIONS_ROOT="$ROOT/sessions"
export SEEDED_PREVIEW_SETTINGS="$ROOT/settings.yaml"
export PROBE_OUT="${PROBE_OUT:-$ROOT/probe.json}"

shasum -a 256 "$ROOT/settings.yaml" | sed 's/^/  settings /'

set +e
SEEDED_SESSION_ID="$SESSION_ID" \
  dsh --profile headless --patch experiments/session-preview-seeded/probe.patch.yml
CODE=$?
set -e
echo "seeded-preview probe exit=$CODE report=$PROBE_OUT session=$SESSION_ID"
exit "$CODE"
