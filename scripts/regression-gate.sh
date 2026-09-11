#!/usr/bin/env bash
# 回归闸门单一入口（票据 03；计划 §2.2、§5.1）。
#
#   scripts/regression-gate.sh [--tier 0,1] [--composition gate|real]
#                              [--json <path>] [--skip-deployment-check]
#                              [--allow-stale-deployment] [--keep-temp]
#
# 退出码：0 全过 / 1 任一断言失败 / 2 环境前置不满足（宿主或会话格式与清单不符、
# 组合渲染缺依赖、real 模式缺相邻仓库）。
#
# 防护（计划 §2.2）：
#   - 仓库本地锁 `$REPO/.git/dsh-regression-gate.lock`：两个终端并发会抢共享 farm，
#     这里用「原子 mkdir」持锁串行化（macOS/Linux 都可用；超时默认 300s）；
#   - 临时 home：`$TMPDIR/dsh-regression-gate-<pid>/home`，DSH_HOME/HOME 都指过去，
#     真实 ~/.dsh 只读；退出时删除（--keep-temp 保留供排查）；
#   - 报告默认落 `experiments/regression-gate/results-<UTC 日期>.json`（计划 §4.4）。

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

TIERS="0,1"
COMPOSITION="gate"
JSON_PATH=""
EXEMPTIONS=()
KEEP_TEMP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tier) TIERS="$2"; shift 2 ;;
    --tier=*) TIERS="${1#*=}"; shift ;;
    --composition) COMPOSITION="$2"; shift 2 ;;
    --composition=*) COMPOSITION="${1#*=}"; shift ;;
    --json) JSON_PATH="$2"; shift 2 ;;
    --json=*) JSON_PATH="${1#*=}"; shift ;;
    --skip-deployment-check) EXEMPTIONS+=("skip-deployment-check"); shift ;;
    --allow-stale-deployment) EXEMPTIONS+=("allow-stale-deployment"); shift ;;
    --keep-temp) KEEP_TEMP=1; shift ;;
    -h|--help)
      awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "$0"
      exit 0 ;;
    *)
      echo "regression-gate: unknown flag $1" >&2
      exit 2 ;;
  esac
done

case "$TIERS" in
  *[!0-9,]*|"") echo "regression-gate: --tier expects a list like 0,1 (got '$TIERS')" >&2; exit 2 ;;
esac
case "$COMPOSITION" in
  gate|real) ;;
  *) echo "regression-gate: --composition expects gate|real (got '$COMPOSITION')" >&2; exit 2 ;;
esac

if [[ -z "$JSON_PATH" ]]; then
  JSON_PATH="$REPO/experiments/regression-gate/results-$(date -u +%Y-%m-%d).json"
fi

# 仓库本地锁：原子 mkdir + PID 记录；超时默认 300s。
# 首选 `$REPO/.git/dsh-regression-gate.lock`（计划 §2.2）；无 .git 的 checkout
# （CI 导出/tarball）落 TMPDIR，名字带仓库路径哈希，避免不同 checkout 互撞。
if [[ -d "$REPO/.git" ]]; then
  LOCK="$REPO/.git/dsh-regression-gate.lock"
else
  # 无 .git 时用「仓库路径哈希」做 TMPDIR 锁名；sha256 工具按平台择一。
  if command -v shasum >/dev/null 2>&1; then
    LOCK_KEY="$(printf '%s' "$REPO" | shasum -a 256 | cut -c1-12)"
  elif command -v sha256sum >/dev/null 2>&1; then
    LOCK_KEY="$(printf '%s' "$REPO" | sha256sum | cut -c1-12)"
  else
    LOCK_KEY="$(printf '%s' "$REPO" | cksum | tr -d ' ' | cut -c1-12)"
  fi
  LOCK="${TMPDIR:-/tmp}/dsh-regression-gate-$LOCK_KEY.lock"
fi
LOCK_TIMEOUT="${GATE_LOCK_TIMEOUT:-300}"
LOCK_WAITED=0
while ! mkdir "$LOCK" 2>/dev/null; do
  if [[ ! -d "$LOCK" ]]; then
    echo "regression-gate: cannot create lock $LOCK (parent missing or not writable)" >&2
    exit 2
  fi
  if [[ -f "$LOCK/pid" ]]; then
    holder="$(cat "$LOCK/pid" 2>/dev/null || true)"
    if [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; then
      echo "regression-gate: removing stale lock held by pid $holder" >&2
      rm -rf "$LOCK"
      continue
    fi
  fi
  if (( LOCK_WAITED >= LOCK_TIMEOUT )); then
    echo "regression-gate: lock $LOCK still held after ${LOCK_TIMEOUT}s (another gate running?)" >&2
    exit 2
  fi
  sleep 1
  LOCK_WAITED=$((LOCK_WAITED + 1))
done
echo $$ > "$LOCK/pid"
release_lock() { rm -rf "$LOCK"; }
trap release_lock EXIT

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dsh-regression-gate-XXXXXX")"
TEMP_HOME="$TEMP_ROOT/home"
mkdir -p "$TEMP_HOME"
cleanup() {
  release_lock
  if [[ "$KEEP_TEMP" == "1" ]]; then
    echo "regression-gate: kept temp home at $TEMP_HOME" >&2
  else
    rm -rf "$TEMP_ROOT"
  fi
}
trap cleanup EXIT

EXEMPT_LIST="$(IFS=,; echo "${EXEMPTIONS[*]-}")"
export GATE_TEMP="$TEMP_HOME"
export GATE_LOCK="$LOCK"
export GATE_TIERS="$TIERS"
export GATE_COMPOSITION="$COMPOSITION"
export GATE_REPORT="$JSON_PATH"
export GATE_EXEMPTIONS="$EXEMPT_LIST"

echo "regression-gate: repo=$REPO tiers=$TIERS composition=$COMPOSITION report=$JSON_PATH"
node "$REPO/gates/run.mjs"
CODE=$?
echo "regression-gate: exit=$CODE report=$JSON_PATH"
exit "$CODE"
