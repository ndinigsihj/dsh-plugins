#!/usr/bin/env bash
# Cut a dsh-plugins release: verify -> bump -> tag -> move the stable worktree.
# Usage: scripts/release.sh <version>        e.g. scripts/release.sh 0.1.3
#
# The stable worktree (default /Users/vito/data/dev/dsh-plugins-stable, override with
# DSH_STABLE_DIR) is what ~/.dsh/profiles/tui mounts; profiles are never
# touched here — advancing it is purely this checkout.
set -euo pipefail

ver="${1:?usage: release.sh <version> (e.g. 0.1.3)}"
[[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "error: version must be X.Y.Z" >&2; exit 1; }
tag="v$ver"

cd "$(dirname "$0")/.."
STABLE="${DSH_STABLE_DIR:-/Users/vito/data/dev/dsh-plugins-stable}"
HOST_DEPS_DIR="${DSH_HOST_DEPS_DIR:-/Users/vito/data/dev/dsh-runtime/stable/node_modules/@deepseek-ai}"

if [ -n "$(git status --porcelain)" ]; then
  echo "error: dirty working tree (including staged/untracked) — commit or stash first" >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "error: $tag already exists" >&2
  exit 1
fi

# --- Pre-release gate (tickets 03/04; plan §5.1) -----------------------------
# Always the REAL tui-dev composition, runtime-rendered into a temp home; never
# any exemption flag (D6) — a stale/absent deployment or a missing sibling
# checkout must stop the release, not be waived. T0 covers tsc + npm test, T1 the
# zero-LLM composition layer, T2 the scripted stub behaviour layer (tickets 06/07).
# Delivery sequence: explicit preset sync -> this gate -> T3 real-model layer on
# demand -> human sign-off.
scripts/regression-gate.sh --tier 0,1,2 --composition real

# Bump only when needed so a re-run after a late failure stays commit-clean.
if [ "$(node -p "require('./package.json').version")" != "$ver" ]; then
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    p.version = process.argv[1];
    fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
  " "$ver"
  # Keep package-lock.json root metadata in sync so a later stable `npm i`
  # does not dirty the lockfile merely because the version/engines drifted.
  node -e "
    const fs = require('fs');
    const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    lock.version = pkg.version;
    if (lock.packages && lock.packages['']) {
      lock.packages[''].version = pkg.version;
      if (pkg.engines) lock.packages[''].engines = pkg.engines;
      else delete lock.packages[''].engines;
    }
    fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
  "
  git add package.json package-lock.json
  git commit -m "Release $tag"
fi
git tag -a "$tag" -m "$tag"

# Capture the OLD lockfile BEFORE advancing the stable tree: after checkout
# HEAD already points at the new tag, so comparing there is always equal.
prevLock="none"
if [ -d "$STABLE" ]; then
  prevLock=$(git -C "$STABLE" rev-parse HEAD:"package-lock.json" 2>/dev/null || echo none)
fi

if [ -d "$STABLE" ]; then
  # package-lock.json is a regenerable artifact: a local npm run in the
  # stable tree normalizes it beyond the committed blob and would block the
  # checkout. Discard that one file, then advance.
  git -C "$STABLE" checkout -- package-lock.json 2>/dev/null || true
  git -C "$STABLE" checkout --detach "$tag"
else
  git worktree add --detach "$STABLE" "$tag"
fi

# npm prunes THROUGH a pre-existing node_modules/@deepseek-ai symlink and
# wipes the global host tree (2026-08-24 incident): strip it before any npm
# run, restore via the idempotent link script afterwards.
newLock=$(git rev-parse "$tag:package-lock.json")
rm -f "$STABLE/node_modules/@deepseek-ai"
if [ "$prevLock" != "$newLock" ]; then
  (cd "$STABLE" && npm i --no-fund --no-audit)
fi
(cd "$STABLE" && DSH_HOST_DEPS_DIR="$HOST_DEPS_DIR" scripts/link-global-dsh.sh)
# Presets advance with the release: sync the self-contained preset tree to
# ~/.dsh/.agent-presets so the stable TUI stops loading the dev worktree.
DSH_HOST_DEPS_DIR="$HOST_DEPS_DIR" scripts/sync-agent-presets.sh

# 收尾必检（2026-09-22 事故补检）：部署位已同步 → 真起 **stable profile**（隔离 home +
# 真 PTY + 部署位 preset），断言 preset 真挂上了。回归闸门只渲染 tui-dev 组合，stable
# profile 的宿主层差异（例如缺 subagent-model-selection-settings）在闸门里完全看不见：
# 那次 v0.2.0 发版因此把 stable 通道发坏了。报告落 experiments/regression-gate/，
# 与闸门报告一样由发版后的人工记录提交。
STABLE_LAUNCHER="${DSH_STABLE_LAUNCHER:-/Users/vito/data/dev/dsh-runtime/stable/bin/tui-stable}"
PRESET_MOUNT_REPORT="experiments/regression-gate/preset-mount-$(date -u +%Y-%m-%d).json"
if [ -x "$STABLE_LAUNCHER" ]; then
  node scripts/preset-mount-smoke.mjs --launcher "$STABLE_LAUNCHER" --json "$PRESET_MOUNT_REPORT"
else
  node scripts/preset-mount-smoke.mjs --json "$PRESET_MOUNT_REPORT"
fi

echo "stable = $STABLE @ $tag"
echo "running TUI sessions must exit and relaunch to pick up the new code."
