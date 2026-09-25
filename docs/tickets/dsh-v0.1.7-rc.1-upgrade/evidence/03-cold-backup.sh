#!/usr/bin/env bash
# T03 cold backup: sessions + attachments + config面, with before/after source invariance
# and source==dest fidelity checks. Intended to run in a quiescent window (no dsh writers).
set -uo pipefail
ROOT="${1:?usage: cold-backup.sh <backup-root>}"
H="$HOME/.dsh"; M="$ROOT/meta"; MJS="$M/manifest.mjs"; LOG="$M/cold-backup.log"
mkdir -p "$ROOT/sessions" "$ROOT/attachments" "$ROOT/config" "$M"
log() { printf '[%s] %s\n' "$(date '+%F %T %z')" "$*" | tee -a "$LOG"; }
fail=0
chk() { if diff -q "$1" "$2" >/dev/null 2>&1; then log "PASS  $3"; else log "FAIL  $3"; diff "$1" "$2" 2>&1 | head -20 | tee -a "$LOG"; fail=1; fi; }
man() { node "$MJS" "$1" "$2" >/dev/null; }

log "== snapshot start =="
date '+%FT%T%z' > "$M/snapshot-start.txt"
lsof -c node -a -d cwd 2>/dev/null | awk '$4=="cwd" {print $2, $NF}' | sort -u > "$M/writers-during-backup.txt" || true
lsof +D "$H/sessions" 2>/dev/null | awk 'NR>1 {print $2, $NF}' | sort -u > "$M/open-session-files-during-backup.txt" || true
cat "$M/writers-during-backup.txt" | tee -a "$LOG"

log "== source manifests before =="
man "$H/sessions"             "$M/sessions.src.before.tsv"
man "$H/attachments"          "$M/attachments.src.before.tsv"
man "$H/settings.yaml"        "$M/settings.src.before.tsv"
man "$H/.agent-presets"       "$M/agent-presets.src.before.tsv"
man "$H/profiles"             "$M/profiles.src.before.tsv"

log "== copy =="
rsync -a "$H/sessions/" "$ROOT/sessions/"
rsync -a --exclude 'request-images' --exclude 'tmp' "$H/attachments/" "$ROOT/attachments/"
cp -p "$H/settings.yaml" "$ROOT/config/settings.yaml"
rsync -a "$H/.agent-presets/" "$ROOT/config/agent-presets/"
rsync -a --exclude 'node_modules' "$H/profiles/" "$ROOT/config/profiles/"

log "== source manifests after + dest manifests =="
man "$H/sessions"             "$M/sessions.src.after.tsv"
man "$H/attachments"          "$M/attachments.src.after.tsv"
man "$H/settings.yaml"        "$M/settings.src.after.tsv"
man "$H/.agent-presets"       "$M/agent-presets.src.after.tsv"
man "$H/profiles"             "$M/profiles.src.after.tsv"
man "$ROOT/sessions"          "$M/sessions.dst.tsv"
man "$ROOT/attachments"       "$M/attachments.dst.tsv"
man "$ROOT/config/settings.yaml" "$M/settings.dst.tsv"
man "$ROOT/config/agent-presets" "$M/agent-presets.dst.tsv"
man "$ROOT/config/profiles"   "$M/profiles.dst.tsv"

log "== checks: no writer wrote during the window; copy == source =="
chk "$M/sessions.src.before.tsv"  "$M/sessions.src.after.tsv"  "sessions source byte-stable across backup window"
chk "$M/sessions.src.after.tsv"   "$M/sessions.dst.tsv"        "sessions backup == source"
chk "$M/settings.src.before.tsv"  "$M/settings.src.after.tsv"  "settings.yaml byte-stable"
chk "$M/settings.src.after.tsv"   "$M/settings.dst.tsv"        "settings.yaml backup == source"
chk "$M/agent-presets.src.before.tsv" "$M/agent-presets.src.after.tsv" "agent-presets byte-stable"
chk "$M/agent-presets.src.after.tsv"  "$M/agent-presets.dst.tsv"       "agent-presets backup == source"
awk -F'\t' '$3 !~ /^v1\/(request-images|tmp)(\/|$)/' "$M/attachments.src.after.tsv" > "$M/attachments.src.after.filtered.tsv"
chk "$M/attachments.src.before.tsv" "$M/attachments.src.after.tsv" "attachments source byte-stable"
chk "$M/attachments.src.after.filtered.tsv" "$M/attachments.dst.tsv" "attachments backup == source (excl. request-images/ tmp/)"
awk -F'\t' '$3 !~ /(^|\/)node_modules(\/|$)/' "$M/profiles.src.after.tsv" > "$M/profiles.src.after.filtered.tsv"
chk "$M/profiles.src.before.tsv" "$M/profiles.src.after.tsv" "profiles source byte-stable"
chk "$M/profiles.src.after.filtered.tsv" "$M/profiles.dst.tsv" "profiles backup == source (excl. node_modules)"

log "== zstd integrity of every backed-up session log =="
find "$ROOT/sessions" -type f -name '*.zstd' -print0 | xargs -0 zstd -t >> "$M/zstd-test.log" 2>&1
if [ $? -eq 0 ]; then log "PASS  all session logs pass zstd -t"; else log "FAIL  zstd -t reported errors (see zstd-test.log)"; fail=1; fi

log "== excluded / derived surfaces =="
{ echo "attachments/v1/request-images: files=$(find "$H/attachments/v1/request-images" -type f 2>/dev/null | wc -l | tr -d ' ') bytes=$(find "$H/attachments/v1/request-images" -type f -exec stat -f %z {} \; 2>/dev/null | awk '{s+=$1} END{print s+0}')"
  echo "attachments/v1/tmp: files=$(find "$H/attachments/v1/tmp" -type f 2>/dev/null | wc -l | tr -d ' ')"
  echo "profiles/node_modules (excluded): dirs=$(find "$H/profiles" -type d -name node_modules 2>/dev/null | wc -l | tr -d ' ')"
  echo "storages (not part of restore face): $(du -sh "$H/storages" 2>/dev/null | cut -f1)" ; } > "$M/excluded-surfaces.txt"
cat "$M/excluded-surfaces.txt" | tee -a "$LOG"

date '+%FT%T%z' > "$M/snapshot-end.txt"
log "== snapshot end; fail=$fail =="
exit $fail
