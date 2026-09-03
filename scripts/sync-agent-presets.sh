#!/usr/bin/env bash
# Sync the repo's agent-preset definitions to ~/.dsh/.agent-presets.
#
# The repo is the source of truth; deployed profiles mount the files from
# ~/.dsh/.agent-presets. Run this after changing presets/ so deployments pick
# up the same security posture (e.g. the 2026-08-25 filesystem sandbox fix).
#
# The preset directory is self-contained: the composition references its local
# plugin/vendor files by RELATIVE paths, and this script copies the whole set
# so the deployed preset never reaches back into a dev worktree. A
# node_modules/@deepseek-ai symlink (same target as link-global-dsh.sh) makes
# bare `@deepseek-ai/*` imports inside the copied modules resolvable from the
# user-preset location.
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="${DSH_AGENT_PRESETS_DIR:-$HOME/.dsh/.agent-presets}"

GROOT="$(npm root -g)"
DEP_TARGET="$GROOT/@deepseek-ai/dsh/node_modules/@deepseek-ai"
if [ ! -d "$DEP_TARGET" ]; then
  echo "error: global dsh dependency tree not found at $DEP_TARGET" >&2
  echo "install it first: npm i -g @deepseek-ai/dsh" >&2
  exit 1
fi

for preset in liangshen-bash; do
  mkdir -p "$DEST/$preset/vendor"
  install -m 644 "presets/$preset/agent.cordis.yml" "$DEST/$preset/agent.cordis.yml"
  install -m 644 "presets/$preset/preset.yml" "$DEST/$preset/preset.yml"
  install -m 644 "presets/$preset/phase-swap-bash.mjs" "$DEST/$preset/phase-swap-bash.mjs"
  cp -R "presets/$preset/vendor/." "$DEST/$preset/vendor/"
  # Bare @deepseek-ai imports (phase-swap-bash → dsh-tool-bash) from the user
  # preset dir cannot find node_modules by upward walk; alias the host deps.
  rm -rf "$DEST/$preset/node_modules"
  mkdir -p "$DEST/$preset/node_modules"
  ln -s "$DEP_TARGET" "$DEST/$preset/node_modules/@deepseek-ai"
  echo "synced $preset -> $DEST/$preset"
done