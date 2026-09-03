#!/usr/bin/env bash
# minimal-plus 降级路径实测（验收 #7）：
# 临时构造一份 bootstrapTools 含不存在工具的 agent.cordis.yml，运行真实
# headless 挂载冒烟，验证 tool-bootstrap 的 fail-open（缺工具 → warn once +
# 暴露全量目录），会话不 brick，promotion 后两轮行为仍正常。
#
# 用法：scripts/degrade-smoke.sh   （默认在仓库 .tmp-degrade 下建临时 preset 树）
# 可覆盖：DEGRADE_SMOKE_ROOT=<dir>
set -euo pipefail
cd "$(dirname "$0")/.."

ROOT="${DEGRADE_SMOKE_ROOT:-.tmp-degrade}"
rm -rf "$ROOT"
mkdir -p "$ROOT"
cp -R presets/minimal-plus "$ROOT/"

# 注入一个不存在的 bootstrap 工具 → keepTools 缺工具分支 → fail-open
perl -0pi -e 's/bootstrapTools: \[bash, str_replace_editor\]/bootstrapTools: [bash, str_replace_editor, __missing__]/' "$ROOT/minimal-plus/agent.cordis.yml"

echo "=== degrade composition bootstrapTools ==="
grep -n "bootstrapTools" "$ROOT/minimal-plus/agent.cordis.yml"

OUT="$(SMOKE_PRESET=minimal-plus SMOKE_PRESET_ROOT="$ROOT" node presets/minimal-plus/smoke-boot.mjs 2>&1)"
echo "$OUT"

# 断言：R1 目录是全量（fail-open），且 warn 出现，且两轮冒烟仍通过（脚本 exit 0）
if ! grep -q "bootstrap disabled, full catalog exposed" <<<"$OUT"; then
  echo "error: expected fail-open warning" >&2
  exit 1
fi
if ! grep -q '"web_search"' <<<"$(printf '%s' "$OUT" | grep 'ROUND1 catalog')"; then
  echo "error: ROUND1 should expose the full catalog under fail-open" >&2
  exit 1
fi
echo "=== degrade smoke PASS ==="
rm -rf "$ROOT"