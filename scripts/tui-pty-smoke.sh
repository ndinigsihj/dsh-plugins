#!/usr/bin/env bash
# T4b 真实 PTY 冒烟薄壳入口（票据 10；计划 §3.3 + 决策 D8/Q10/Q20/Q23）。
#
#   scripts/tui-pty-smoke.sh                                  # 正常跑，写默认报告
#   scripts/tui-pty-smoke.sh --json /tmp/pty-smoke.json       # 指定报告路径
#   scripts/tui-pty-smoke.sh --negative-control route         # 红路径：跳过 /model 切换
#   scripts/tui-pty-smoke.sh --negative-control drop-assertion # 红路径：模拟断言被删
#   scripts/tui-pty-smoke.sh --keep-temp                      # 保留临时 home 排查
#
# 独立入口（Q10）：regression-gate.sh 与 release.sh 都不引用本脚本（grep 可证）；
# 依赖真 PTY 环境，按需手跑，不进发版序列（D8）。
#
# 退出码：0 全过 / 1 任一断言失败 / 2 环境前置不满足（PTY 或宿主内嵌依赖不可用、
# 真实组合渲染失败）。
#
# 防护（Q20）：
#   - 与闸门共用仓库本地锁 `$REPO/.git/dsh-regression-gate.lock`（原子 mkdir + 存活
#     PID 判据），让两个都会碰共享 farm 的入口串行化；
#   - 临时 home 落 `$TMPDIR/dsh-pty-smoke-<pid>/home`，DSH_HOME/HOME 都指过去，
#     真实 ~/.dsh 只读；退出时删除（--keep-temp 保留——注意 real 模式副本含明文密钥）。

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

JSON_PATH=""
KEEP_TEMP=0
# 原参数原样透传给 mjs（薄壳只消费 --json/--keep-temp，其余由 mjs 统一校验）。
PASSTHROUGH=("$@")

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON_PATH="$2"; shift 2 ;;
    --json=*) JSON_PATH="${1#*=}"; shift ;;
    --report) JSON_PATH="$2"; shift 2 ;;
    --report=*) JSON_PATH="${1#*=}"; shift ;;
    --negative-control) shift 2 ;;
    --negative-control=*) shift ;;
    --keep-temp) KEEP_TEMP=1; shift ;;
    -h|--help)
      awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "$0"
      exit 0 ;;
    *)
      # 未知 flag 交给 mjs 统一报错（保持两入口同一份参数契约）。
      break ;;
  esac
done

# 仓库本地锁：与 scripts/regression-gate.sh 同一路径与语义（原子 mkdir + 存活 PID 判据）。
if [[ -d "$REPO/.git" ]]; then
  LOCK="$REPO/.git/dsh-regression-gate.lock"
else
  if command -v shasum >/dev/null 2>&1; then
    LOCK_KEY="$(printf '%s' "$REPO" | shasum -a 256 | cut -c1-12)"
  elif command -v sha256sum >/dev/null 2>&1; then
    LOCK_KEY="$(printf '%s' "$REPO" | sha256sum | cut -c1-12)"
  else
    LOCK_KEY="$(printf '%s' "$REPO" | cksum | tr -d ' ' | cut -c1-12)"
  fi
  LOCK="${TMPDIR:-/tmp}/dsh-regression-gate-$LOCK_KEY.lock"
fi
LOCK_TIMEOUT="${PTY_SMOKE_LOCK_TIMEOUT:-300}"
LOCK_WAITED=0
while ! mkdir "$LOCK" 2>/dev/null; do
  if [[ ! -d "$LOCK" ]]; then
    echo "tui-pty-smoke: cannot create lock $LOCK (parent missing or not writable)" >&2
    exit 2
  fi
  if [[ -f "$LOCK/pid" ]]; then
    holder="$(cat "$LOCK/pid" 2>/dev/null || true)"
    if [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; then
      echo "tui-pty-smoke: removing stale lock held by pid $holder" >&2
      rm -rf "$LOCK"
      continue
    fi
  fi
  if (( LOCK_WAITED >= LOCK_TIMEOUT )); then
    echo "tui-pty-smoke: lock $LOCK still held after ${LOCK_TIMEOUT}s (another gate/smoke running?)" >&2
    exit 2
  fi
  sleep 1
  LOCK_WAITED=$((LOCK_WAITED + 1))
done
echo $$ > "$LOCK/pid"
release_lock() { rm -rf "$LOCK"; }
trap release_lock EXIT

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dsh-pty-smoke-XXXXXX")"
cleanup() {
  release_lock
  if [[ "$KEEP_TEMP" == "1" ]]; then
    echo "tui-pty-smoke: kept temp root at $TEMP_ROOT" >&2
  else
    rm -rf "$TEMP_ROOT"
  fi
}
trap cleanup EXIT

export PTY_SMOKE_TEMP="$TEMP_ROOT"
export PTY_SMOKE_KEEP="$KEEP_TEMP"
[[ -n "$JSON_PATH" ]] && export PTY_SMOKE_REPORT="$JSON_PATH"

echo "tui-pty-smoke: repo=$REPO temp=$TEMP_ROOT${JSON_PATH:+ report=$JSON_PATH}"
set +e
node "$REPO/scripts/tui-pty-smoke.mjs" ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}
CODE=$?
set -e
echo "tui-pty-smoke: exit=$CODE${JSON_PATH:+ report=$JSON_PATH}"
exit "$CODE"
