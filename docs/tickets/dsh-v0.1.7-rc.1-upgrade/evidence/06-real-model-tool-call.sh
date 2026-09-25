#!/usr/bin/env bash
# 票据 06 证据：0.1.7 上真实模型一次工具调用（升级计划 §6 P0 模型适配器行的
# 「真实模型一次工具调用（T3）或等价证据」）。
#
# 口径：隔离临时 home（设置与凭据只读复制、退出即删；真实 ~/.dsh 只读），
# headless profile 跑一条必须调用 bash 的任务，按 JSONL 事件流核对
# tool_call → tool_result(completed) → final 三行。
#
# 运行：bash docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/06-real-model-tool-call.sh
# 需要真实 ~/.dsh/settings.yaml 与 ~/.dsh/.credentials.yaml（provider 凭据）；只输出
# 事件过滤行，不打印设置/凭据内容。真实模型调用会产生少量 token 消耗。
set -euo pipefail

REAL_HOME="$HOME"
REPO="$(cd "$(dirname "$0")/../../../.." && pwd)"
CLI="${DSH_CLI:-$REAL_HOME/.dsh/bin/dsh}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/t06-real-model-XXXXXX")"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

mkdir -p "$ROOT/profiles/headless"
cat > "$ROOT/profiles/headless/package.json" <<'JSON'
{
  "name": "dsh-profile-headless",
  "private": true,
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"], "patchReload": "startup" } }
}
JSON
printf '# evidence probe profile root — empty entry list.\n[]\n' > "$ROOT/profiles/headless/cordis.yml"

# 只读复制真实凭据与设置；600 权限；临时 home 退出即删。
cp "$REAL_HOME/.dsh/.credentials.yaml" "$ROOT/.credentials.yaml"
chmod 600 "$ROOT/.credentials.yaml"
cp "$REAL_HOME/.dsh/settings.yaml" "$ROOT/settings.yaml"
chmod 600 "$ROOT/settings.yaml"

cd "$REPO"
HOME="$ROOT" DSH_HOME="$ROOT" "$CLI" --profile headless --json \
  "Use the bash tool to run exactly: echo t06-adapter-ok. Then reply with the exact stdout you observed." \
  > "$ROOT/run.jsonl" 2> "$ROOT/run.err"

grep -E '"type":"tool_call"|"type":"tool_result"|"type":"final"' "$ROOT/run.jsonl" | head -10
echo "run-lines=$(wc -l < "$ROOT/run.jsonl") stderr-lines=$(wc -l < "$ROOT/run.err")"
