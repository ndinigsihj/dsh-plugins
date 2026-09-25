#!/usr/bin/env bash
# 降级路径实测（验收 #7；票据 03 起默认 dev 侧 minimal-plus）：
# 临时构造一份 bootstrapTools 含不存在工具的 agent.cordis.yml，运行真实
# headless 挂载冒烟，验证 tool-bootstrap 的 fail-open（缺工具 → warn once +
# 暴露全量目录），会话不 brick，promotion 后两轮行为仍正常。
#
# 用法：scripts/degrade-smoke.sh   （默认在仓库 .tmp-degrade-<preset> 下建临时 preset 树）
# 可覆盖：DEGRADE_SMOKE_PRESET=<preset id>（stable 手验可设 minimal-plus）
#         DEGRADE_SMOKE_ROOT=<dir>
#         DEGRADE_SMOKE_SOURCE_ROOT=<dir>（preset 真源根，默认 presets；degrade 需要可改坏的
#           真源，real 组合模式的部署位是 bundle、不传此值——主冒烟改由 SMOKE_PRESET_BUNDLE
#           装载部署位那一份）
#         SMOKE_SESSION_ROOT=<dir>（沿透给 smoke-boot；闸门落临时 home）
set -euo pipefail
cd "$(dirname "$0")/.."

PRESET="${DEGRADE_SMOKE_PRESET:-minimal-plus}"
SOURCE_ROOT="${DEGRADE_SMOKE_SOURCE_ROOT:-presets}"
ROOT="${DEGRADE_SMOKE_ROOT:-.tmp-degrade-$PRESET}"
rm -rf "$ROOT"
mkdir -p "$ROOT"
cp -R "$SOURCE_ROOT/$PRESET" "$ROOT/"

# 0.1.7 载体（票据 07）：这份副本只是 smoke-boot 生成 bundle 的真源；自研 .mjs 从
# smoke 隔离 profile 内的 bundle 执行，裸包名走 profile 运行时解析，不再需要副本侧
# node_modules fallback 链接。

# 注入一个不存在的 bootstrap 工具 → keepTools 缺工具分支 → fail-open
perl -0pi -e 's/bootstrapTools: \[bash, str_replace_editor\]/bootstrapTools: [bash, str_replace_editor, __missing__]/' "$ROOT/$PRESET/agent.cordis.yml"

echo "=== degrade composition ($PRESET) bootstrapTools ==="
grep -n "bootstrapTools" "$ROOT/$PRESET/agent.cordis.yml"

OUT="$(SMOKE_PRESET="$PRESET" SMOKE_PRESET_ROOT="$ROOT" node "presets/$PRESET/smoke-boot.mjs" 2>&1)"
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
echo "=== degrade smoke PASS ($PRESET) ==="
rm -rf "$ROOT"