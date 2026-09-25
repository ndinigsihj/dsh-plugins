#!/usr/bin/env bash
# Ticket 10 phase B: read-open classification of every canonical old-format
# session with the new host (0.1.7-rc.1). Read opens migrate in memory only:
# no successor, no lock, source bytes unchanged.
#
# Usage: bash 10-run-read-classify.sh <out-dir> <probe-root> [chunk-size]
#   <out-dir>     evidence output directory (aggregated JSON lands here)
#   <probe-root>  probe home root created by 10-make-probe-home.sh
#   CANONICAL_TSV optional path to phase A canonical.tsv (default <out-dir>/canonical.tsv)
set -euo pipefail
OUT="${1:?usage: 10-run-read-classify.sh <out-dir> <probe-root> [chunk-size]}"
ROOT="${2:?usage: 10-run-read-classify.sh <out-dir> <probe-root> [chunk-size]}"
CHUNK="${3:-150}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=10-lib.sh
source "$HERE/10-lib.sh"
HOME_DIR="$ROOT/home"
PROBE_SCRIPT="$HERE/10-probe-open.mjs"
CANONICAL_TSV="${CANONICAL_TSV:-$OUT/canonical.tsv}"
[ -d "$HOME_DIR" ] || { echo "probe home missing: $HOME_DIR" >&2; exit 2; }
[ -f "$CANONICAL_TSV" ] || { echo "canonical inventory missing: $CANONICAL_TSV" >&2; exit 2; }
mkdir -p "$OUT"

WORK="$ROOT/classify"
rm -rf "$WORK"; mkdir -p "$WORK/chunks" "$WORK/chunk-out"

# one id per canonical log, stable order
awk -F'\t' '{print $3}' "$CANONICAL_TSV" | LC_ALL=C sort -u > "$WORK/ids.txt"
echo "canonical ids: $(wc -l < "$WORK/ids.txt") (chunk=$CHUNK)"
split -l "$CHUNK" "$WORK/ids.txt" "$WORK/chunks/chunk-"

for chunk in "$WORK"/chunks/chunk-*; do
  name="$(basename "$chunk")"
  echo "== $name ($(wc -l < "$chunk") ids)"
  t10_probe "$HOME_DIR" read "$chunk" "$WORK/chunk-out/$name.json"
done

node - "$WORK/chunk-out" "$OUT/10-read-classification.json" <<'NODE'
const { readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const [chunkDir, outFile] = process.argv.slice(2);
const results = [];
for (const name of readdirSync(chunkDir).sort()) {
  const parsed = JSON.parse(readFileSync(join(chunkDir, name), 'utf8'));
  results.push(...parsed.results);
}
const classify = (r) => {
  if (r.ok) return 'readable';
  if (r.error.includes('unsupported descriptor version')) return 'unreadable:descriptor-v2';
  if (r.error.includes('corrupt')) return 'unreadable:corrupt';
  return 'unreadable:other';
};
const by = {};
for (const r of results) by[classify(r)] = (by[classify(r)] ?? 0) + 1;
writeFileSync(outFile, JSON.stringify({
  generatedAt: new Date().toISOString(),
  total: results.length,
  by,
  results: results.map((r) => ({ ...r, class: classify(r) })),
}, null, 1));
console.log(JSON.stringify({ total: results.length, by }, null, 1));
NODE
