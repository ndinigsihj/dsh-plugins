#!/usr/bin/env bash
# Cut a dsh-plugins release: verify -> bump -> tag -> move the stable worktree.
# Usage: scripts/release.sh <version>        e.g. scripts/release.sh 0.1.3
#
# The stable worktree (default ~/dev/dsh-plugins-stable, override with
# DSH_STABLE_DIR) is what ~/.dsh/profiles/tui mounts; profiles are never
# touched here — advancing it is purely this checkout.
set -euo pipefail

ver="${1:?usage: release.sh <version> (e.g. 0.1.3)}"
[[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "error: version must be X.Y.Z" >&2; exit 1; }
tag="v$ver"

cd "$(dirname "$0")/.."
STABLE="${DSH_STABLE_DIR:-$HOME/dev/dsh-plugins-stable}"

git diff --quiet || { echo "error: dirty working tree — commit or stash first" >&2; exit 1; }
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "error: $tag already exists" >&2
  exit 1
fi

npx tsc --noEmit

# Bump only when needed so a re-run after a late failure stays commit-clean.
if [ "$(node -p "require('./package.json').version")" != "$ver" ]; then
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    p.version = process.argv[1];
    fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
  " "$ver"
  git add package.json
  git commit -m "Release $tag"
fi
git tag -a "$tag" -m "$tag"

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
prevLock=$(git -C "$STABLE" rev-parse HEAD:"package-lock.json" 2>/dev/null || echo none)
newLock=$(git rev-parse "$tag:package-lock.json")
rm -f "$STABLE/node_modules/@deepseek-ai"
if [ "$prevLock" != "$newLock" ]; then
  (cd "$STABLE" && npm i --no-fund --no-audit)
fi
(cd "$STABLE" && scripts/link-global-dsh.sh)

echo "stable = $STABLE @ $tag"
echo "running TUI sessions must exit and relaunch to pick up the new code."
