#!/usr/bin/env bash
# Ticket 10 support: build the throwaway probe home used by 10-probe-open.mjs.
#   --profile t10     : dsh-base-only composition on the *new* host (0.1.7-rc.1)
#   home/sessions     : symlink to the session root under test
# Usage: bash 10-make-probe-home.sh <probe-root> <sessions-dir>
#   例：bash 10-make-probe-home.sh /tmp/dsh-t10-run "$HOME/.dsh/sessions"
set -euo pipefail
ROOT="${1:?usage: 10-make-probe-home.sh <probe-root> <sessions-dir>}"
SESSIONS="${2:?usage: 10-make-probe-home.sh <probe-root> <sessions-dir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=10-lib.sh
source "$HERE/10-lib.sh"
ANCHOR="$(t10_anchor)"
[ -f "$ANCHOR" ] || { echo "anchor not found: $ANCHOR (set T10_ANCHOR)" >&2; exit 2; }
HOME_DIR="$ROOT/home"
PROFILE_DIR="$HOME_DIR/profiles/t10"
mkdir -p "$PROFILE_DIR"
printf '{"name":"dsh-profile-t10","private":true,"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base"]}}}\n' > "$PROFILE_DIR/package.json"
printf '[]\n' > "$PROFILE_DIR/cordis.patch.yml"
printf '# t10 probe profile — empty entry list.\n[]\n' > "$PROFILE_DIR/cordis.yml"
ln -sfn "$(dirname "$ANCHOR")/node_modules" "$PROFILE_DIR/node_modules"
ln -sfn "$(cd "$SESSIONS" && pwd -P)" "$HOME_DIR/sessions"
echo "probe home: $HOME_DIR"
echo "sessions  : $(readlink "$HOME_DIR/sessions")"
