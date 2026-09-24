#!/usr/bin/env bash
# C0 前置取证复现脚本（票据 02）
#
# 在临时前缀安装 @deepseek-ai/dsh@0.1.7-rc.1（独立 npm cache），复现：
#   ① 版本锁定 / 组合装配；rc.2 ↔ rc.1 三个同步读取方法签名逐字相同
#   ③ 旧格式会话读开（不落盘）与写开（发布 v4 后继、源文件不变）
#   ④ 旧目录 Preset（$DSH_HOME/.agent-presets/<id>/）不再被加载
#
# 探针为归档件（同目录 02-preflight-probe-{read,write,preset}.mjs），本脚本把它们
# 复制进临时 CLI 安装树后执行，保证归档证据与复现输出同源。
#
# 安全边界：只写 mktemp 目录；绝不向真实 ~/.dsh 写入（DSH_HOME 全部显式覆盖）。
# 用法：bash 02-preflight-repro.sh
#   可选 V3_SRC / V0_SRC 指定夹具来源（默认取本机两份真实旧格式会话，只读复制）；
#   夹具头部记录的 cwd 必须存在（脚本按头部推导，不硬编码）。
#   可选 C0_REUSE_ROOT=<既有 /tmp/dsh-c0-repro-*> 跳过安装、只复跑探针与断言
#   （会清空该临时 root 的 home 后重新布夹具；拒绝非 temp 路径）。
set -euo pipefail

PROBE_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -n "${C0_REUSE_ROOT:-}" ]; then
  ROOT="$(cd "$C0_REUSE_ROOT" && pwd -P)"
  case "$ROOT" in
    /tmp/dsh-c0-repro-*|/private/tmp/dsh-c0-repro-*) ;;
    *) echo "refuse to reuse non-temp root: $ROOT"; exit 2 ;;
  esac
  rm -rf "$ROOT/home"
else
  ROOT="$(mktemp -d "/tmp/dsh-c0-repro-$(date +%Y%m%d-%H%M%S)-XXXXXX")"
  ROOT="$(cd "$ROOT" && pwd -P)"
fi
echo "ROOT=$ROOT"
mkdir -p "$ROOT/home" "$ROOT/cli"

header_field() { zstd -dc "$1" 2>/dev/null | head -n 1 | node -e '
let s = ""; process.stdin.on("data", (d) => { s += d }); process.stdin.on("end", () => {
  console.log(JSON.parse(s)[process.argv[1]] ?? "")
})' "$2"; }
encode_cwd() { printf '%s' "$1" | sed 's#^/#--#; s#/#-#g; s#$#--#'; }

# ── 1. 临时前缀安装（独立 cache）───────────────────────────────────────────
cd "$ROOT/cli"
if [ -d "$ROOT/cli/node_modules/@deepseek-ai/dsh" ]; then
  echo "reuse existing install at $ROOT/cli"
else
  npm init -y >/dev/null
  npm i --no-audit --no-fund --no-package-lock --cache "$ROOT/npm-cache" \
    @deepseek-ai/dsh@0.1.7-rc.1
fi
CLI="$ROOT/cli/node_modules/@deepseek-ai/dsh/lib/bin.js"
echo "version: $(DSH_HOME="$ROOT/home" node "$CLI" --version)"
cp "$PROBE_DIR"/02-preflight-probe-*.mjs "$ROOT/cli/"

make_profile() {
  local name="$1" bundles="$2"
  mkdir -p "$ROOT/home/profiles/$name"
  printf '{"name":"dsh-profile-%s","private":true,"dsh":{"profile":{"bundles":%s}}}\n' \
    "$name" "$bundles" > "$ROOT/home/profiles/$name/package.json"
  printf '[]\n' > "$ROOT/home/profiles/$name/cordis.patch.yml"
  ln -sfn "$ROOT/cli/node_modules" "$ROOT/home/profiles/$name/node_modules"
}
make_profile c0 '["@deepseek-ai/dsh-base","@deepseek-ai/dsh-headless"]'
make_profile c0base '["@deepseek-ai/dsh-base"]'
DSH_HOME="$ROOT/home" node "$CLI" --profile c0 --dump-config > "$ROOT/dump-c0.yml"
printf '# dsh profile root — an empty entry list.\n[]\n' > "$ROOT/home/profiles/c0base/cordis.yml"

# ── 2. ① 签名对比：rc.2 包 vs rc.1 包（三个方法声明行）──────────────────────
mkdir -p "$ROOT/pkg-compare" && cd "$ROOT/pkg-compare"
npm pack --cache "$ROOT/npm-cache" --no-audit --no-fund @deepseek-ai/dsh-session@0.1.5-rc.2 >/dev/null
mkdir -p rc2 && tar -xzf deepseek-ai-dsh-session-0.1.5-rc.2.tgz -C rc2
sig() { grep -E "eventAt\(seq|snapshotEvents\(fromSeq|ownEvents\(\)" "$1" | sed 's/^ *//'; }
RC2_SIG="$(sig "$ROOT/pkg-compare/rc2/package/lib/types/index.d.ts" | shasum -a 256 | awk '{print $1}')"
RC1_SIG="$(sig "$ROOT/cli/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts" | shasum -a 256 | awk '{print $1}')"

# ── 3. 夹具：只读复制两份真实旧格式会话，cwd 从头部推导 ─────────────────────
V3_SRC="${V3_SRC:-$HOME/.dsh/sessions/--Users-vito--/session-aebc6e9c-577b-4a47-b08d-2f3c154888cf/session.v3.jsonl.zstd}"
V0_SRC="${V0_SRC:-$HOME/.dsh/sessions/--private-tmp-dsh-tui-depcheck--/session-25054cd5-ca70-4936-9202-55adeabc427a/session.jsonl.zstd}"
V3_CWD="$(header_field "$V3_SRC" cwd)"
V0_CWD="$(header_field "$V0_SRC" cwd)"
V3_ID="$(basename "$(dirname "$V3_SRC")")"
V0_ID="$(basename "$(dirname "$V0_SRC")")"
[ -d "$V3_CWD" ] || { echo "fixture v3 cwd missing: $V3_CWD"; exit 2; }
[ -d "$V0_CWD" ] || { echo "fixture v0 cwd missing: $V0_CWD"; exit 2; }

stage() {
  local src="$1" cwd="$2" id="$3"
  local dst="$ROOT/home/sessions/$(encode_cwd "$cwd")/$id"
  mkdir -p "$dst"
  cp -p "$src" "$dst/"
}
stage "$V3_SRC" "$V3_CWD" "$V3_ID"
stage "$V0_SRC" "$V0_CWD" "$V0_ID"
V3_SHA_BEFORE="$(shasum -a 256 "$V3_SRC" | awk '{print $1}')"
V0_SHA_BEFORE="$(shasum -a 256 "$V0_SRC" | awk '{print $1}')"
V3_DIR="$ROOT/home/sessions/$(encode_cwd "$V3_CWD")/$V3_ID"
V0_DIR="$ROOT/home/sessions/$(encode_cwd "$V0_CWD")/$V0_ID"

# ── 4. ③ 读开（v3）：内存迁移、不落盘 ──────────────────────────────────────
(cd "$ROOT/cli" && DSH_HOME="$ROOT/home" node 02-preflight-probe-read.mjs "$V3_ID")
V3_V4_AFTER_READ="$(ls "$V3_DIR" | grep -c 'v4' || true)"
V3_SHA_AFTER_READ="$(shasum -a 256 "$V3_DIR/session.v3.jsonl.zstd" | awk '{print $1}')"

# ── 5. ③ 写开（v3）：sessionPersistence 发布 v4 后继 ───────────────────────
(cd "$ROOT/cli" && DSH_HOME="$ROOT/home" node 02-preflight-probe-write.mjs "$V3_ID")

# ── 6. ③ 写开（v0）：真实 headless 采纳路径（无凭据会失败，后继发布在此之前）
(cd "$V0_CWD" && DSH_HOME="$ROOT/home" node "$CLI" --profile c0 --session-id "$V0_ID" \
  "c0 repro probe" || true)

# ── 7. ④ 旧目录 Preset 哨兵（registry 声明行 vs .agent-presets 目录）────────
mkdir -p "$ROOT/home/.agent-presets/c0-sentinel"
printf 'name: C0 Sentinel\ndescription: legacy directory preset\norder: 99\n' \
  > "$ROOT/home/.agent-presets/c0-sentinel/preset.yml"
printf '[]\n' > "$ROOT/home/.agent-presets/c0-sentinel/agent.cordis.yml"
cat > "$ROOT/home/profiles/c0base/cordis.patch.yml" <<'EOF'
- insert:
    - id: agent-preset-registry
      name: '@deepseek-ai/dsh-agent-preset-registry'
      config:
        default: declared-c0
    - id: preset-declared-c0
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: declared-c0
        name: Declared C0
        plugins: []
EOF
(cd "$ROOT/cli" && DSH_HOME="$ROOT/home" node 02-preflight-probe-preset.mjs)

# ── 8. 断言 ───────────────────────────────────────────────────────────────
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (got '$2' want '$3')"; fail=1; fi; }
check "rc.2/rc.1 三个方法声明逐字相同" "$RC2_SIG" "$RC1_SIG"
check "v3 读开后未产生后继" "$V3_V4_AFTER_READ" "0"
check "v3 读开后源文件未改写" "$V3_SHA_AFTER_READ" "$V3_SHA_BEFORE"
check "v3 写开产生 v4 后继" "$(ls "$V3_DIR" | grep -c 'v4' || true)" "1"
check "v0 写开产生 v4 后继" "$(ls "$V0_DIR" | grep -c 'v4' || true)" "1"
check "v3 源文件未改写" \
  "$(shasum -a 256 "$V3_DIR/session.v3.jsonl.zstd" | awk '{print $1}')" "$V3_SHA_BEFORE"
check "v0 源文件仍在且未改写" \
  "$(shasum -a 256 "$V0_DIR/session.jsonl.zstd" | awk '{print $1}')" "$V0_SHA_BEFORE"
check "真实源文件未被改写" \
  "$(shasum -a 256 "$V3_SRC" | awk '{print $1}')$(shasum -a 256 "$V0_SRC" | awk '{print $1}')" \
  "$V3_SHA_BEFORE$V0_SHA_BEFORE"
check "夹具在临时 home 落位" "$(ls "$ROOT/home/sessions" | wc -l | tr -d ' ')" "2"

echo
echo "ROOT=${ROOT}（保留现场；确认后可整体删除）"
[ "$fail" -eq 0 ] && echo "ALL CHECKS PASSED" || { echo "CHECKS FAILED"; exit 1; }
