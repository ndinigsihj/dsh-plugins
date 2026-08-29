#!/usr/bin/env bash
# Sync the repo's agent-preset definitions to ~/.dsh/.agent-presets.
#
# The repo is the source of truth; deployed profiles mount the files from
# ~/.dsh/.agent-presets. Run this after changing presets/ so deployments pick
# up the same security posture (e.g. the 2026-08-25 filesystem sandbox fix).
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="${DSH_AGENT_PRESETS_DIR:-$HOME/.dsh/.agent-presets}"

for preset in liangshen-bash; do
  mkdir -p "$DEST/$preset"
  cp "presets/$preset/agent.cordis.yml" "$DEST/$preset/agent.cordis.yml"
  cp "presets/$preset/preset.yml" "$DEST/$preset/preset.yml"
  echo "synced $preset -> $DEST/$preset"
done