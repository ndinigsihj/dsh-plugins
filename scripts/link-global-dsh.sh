#!/usr/bin/env bash
# Point node_modules/@deepseek-ai at the globally installed dsh's dependency
# tree, so this plugin always compiles and runs against the exact generation
# the host process uses. Idempotent; re-run after `npm i -g @deepseek-ai/dsh`
# changes the global prefix (e.g. an nvm node upgrade moves it).
set -euo pipefail

GROOT="$(npm root -g)"
TARGET="$GROOT/@deepseek-ai/dsh/node_modules/@deepseek-ai"
if [ ! -d "$TARGET" ]; then
  echo "error: global dsh dependency tree not found at $TARGET" >&2
  echo "install it first: npm i -g @deepseek-ai/dsh" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
mkdir -p node_modules
if [ -L node_modules/@deepseek-ai ]; then
  rm node_modules/@deepseek-ai
elif [ -d node_modules/@deepseek-ai ]; then
  echo "replacing a real node_modules/@deepseek-ai directory (stale local copies)" >&2
  rm -rf node_modules/@deepseek-ai
fi
ln -s "$TARGET" node_modules/@deepseek-ai
echo "linked node_modules/@deepseek-ai -> $TARGET ($(ls "$TARGET" | wc -l | tr -d ' ') packages, dsh $(node -p "require('$TARGET/dsh-agent/package.json').version"))"
