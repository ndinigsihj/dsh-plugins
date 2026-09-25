#!/usr/bin/env bash
# Ticket 10 phase A: read-only inventory of the real session store.
#
# Emits into <out-dir>:
#   manifest.tsv          every file under <sessions-dir>: rel\tkind\tformat\tid\tsize\tmtime\tsha256
#   canonical.tsv         only canonical logs: rel\tformat\tid\tsize\tmtime
#   variants.tsv          non-canonical files (bak/corrupt/lock/stray): rel\tsize\tsha256
#   live-writers.txt      processes currently holding session.lock (lsof, read-only)
#
# Usage: bash 10-session-inventory.sh <out-dir> [sessions-dir]
set -euo pipefail
OUT="${1:?usage: 10-session-inventory.sh <out-dir> [sessions-dir]}"
SESSIONS="${2:-$HOME/.dsh/sessions}"
mkdir -p "$OUT"
[ -d "$SESSIONS" ] || { echo "sessions dir not found: $SESSIONS" >&2; exit 2; }

: > "$OUT/manifest.tsv"
: > "$OUT/canonical.tsv"
: > "$OUT/variants.tsv"

find "$SESSIONS" -type f | LC_ALL=C sort | while IFS= read -r file; do
  rel="${file#"$SESSIONS"/}"
  size="$(stat -f %z "$file")"
  mtime="$(stat -f %m "$file")"
  sha="$(shasum -a 256 "$file" | awk '{print $1}')"
  base="$(basename "$file")"
  case "$rel" in
    */*/*)
      case "$base" in
        session.jsonl.zstd)      kind=canonical; format=v0 ;;
        session.v3.jsonl.zstd)   kind=canonical; format=v3 ;;
        session.v4.jsonl.zstd)   kind=canonical; format=v4 ;;
        session.lock)            kind=lock;      format='-' ;;
        *)                       kind=variant;   format='-' ;;
      esac
      ;;
    *) kind=stray; format='-' ;;
  esac
  id="-"
  case "$rel" in */*/*) id="$(basename "$(dirname "$file")")" ;; esac
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$rel" "$kind" "$format" "$id" "$size" "$mtime" "$sha" >> "$OUT/manifest.tsv"
  if [ "$kind" = canonical ]; then
    printf '%s\t%s\t%s\t%s\t%s\n' "$rel" "$format" "$id" "$size" "$mtime" >> "$OUT/canonical.tsv"
  elif [ "$kind" != lock ]; then
    printf '%s\t%s\t%s\n' "$rel" "$size" "$sha" >> "$OUT/variants.tsv"
  fi
done

{
  echo "# lsof snapshot: processes holding session.lock under $SESSIONS"
  echo "# captured: $(date '+%Y-%m-%dT%H:%M:%S%z')"
  lsof 2>/dev/null | awk -v root="$SESSIONS/" 'index($9, root) == 1 && $9 ~ /session\.lock$/ {print $1"\t"$2"\t"$9}' || true
} > "$OUT/live-writers.txt"

echo "manifest files : $(wc -l < "$OUT/manifest.tsv")"
echo "canonical logs : $(wc -l < "$OUT/canonical.tsv")"
awk -F'\t' '{count[$2]++} END {for (format in count) print "  format " format ": " count[format]}' "$OUT/canonical.tsv" | sort
echo "variants/stray: $(wc -l < "$OUT/variants.tsv")"
echo "live writers   : $(grep -vc '^#' "$OUT/live-writers.txt" || true)"
