#!/usr/bin/env bash
# Ticket 10 phase C/D: migrate the representative sample sessions on the real
# store through the per-session write-open seam (no batch tool exists), then
# verify every sample reads back as current format with unchanged event counts.
#
# Usage: bash 10-run-sample-migration.sh <out-dir> <probe-root> <samples-file> <canonical.tsv>
#   <samples-file>  one session id per line
#   <canonical.tsv> phase A inventory (rel\tformat\tid\tsize\tmtime)
set -euo pipefail
OUT="${1:?usage: 10-run-sample-migration.sh <out-dir> <probe-root> <samples-file> <canonical.tsv>}"
ROOT="${2:?}"
SAMPLES="${3:?}"
CANONICAL="${4:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=10-lib.sh
source "$HERE/10-lib.sh"
HOME_DIR="$ROOT/home"
PROBE_SCRIPT="$HERE/10-probe-open.mjs"
SESSIONS="$(readlink "$HOME_DIR/sessions")"
mkdir -p "$OUT"
if ! cmp -s "$SAMPLES" "$OUT/10-sample-ids.txt"; then cp "$SAMPLES" "$OUT/10-sample-ids.txt"; fi

# Select the highest canonical generation per sample id and fingerprint it.
: > "$OUT/10-sample-sources.tsv"
: > "$OUT/10-sample-after.tsv"
while IFS= read -r id; do
  [ -n "$id" ] || continue
  read -r rel fmt < <(awk -F'\t' -v id="$id" '$3 == id { rank = ($2 == "v4" ? 4 : ($2 == "v3" ? 3 : ($2 == "v0" ? 1 : 0))); if (rank >= best) { best = rank; path = $1; format = $2 } } END { print path "\t" format }' "$CANONICAL")
  [ -n "$rel" ] || { echo "sample not in inventory: $id" >&2; exit 2; }
  file="$SESSIONS/$rel"
  sha="$(shasum -a 256 "$file" | awk '{print $1}')"
  printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$rel" "$fmt" "$sha" "$(stat -f %z "$file")" >> "$OUT/10-sample-sources.tsv"
done < "$SAMPLES"

echo "== write open (migrate) samples"
t10_probe "$HOME_DIR" write "$SAMPLES" "$OUT/10-sample-write.json"

# Post-write artifact facts per sample: source sha unchanged + successor present.
while IFS=$'\t' read -r id rel format sha_before size_before; do
  file="$SESSIONS/$rel"
  sha_after="$(shasum -a 256 "$file" | awk '{print $1}')"
  dir="$(dirname "$file")"
  v4="$dir/session.v4.jsonl.zstd"
  if [ -f "$v4" ]; then v4_size="$(stat -f %z "$v4")"; else v4_size='-'; fi
  printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$sha_before" "$sha_after" "$([ "$sha_before" = "$sha_after" ] && echo unchanged || echo CHANGED)" "$v4_size" >> "$OUT/10-sample-after.tsv"
done < "$OUT/10-sample-sources.tsv"

echo "== read open (verify current format)"
t10_probe "$HOME_DIR" read "$SAMPLES" "$OUT/10-sample-verify.json"

echo "== summary"
node - "$OUT" <<'NODE'
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const out = process.argv[2];
const readJson = (name) => JSON.parse(readFileSync(join(out, name), 'utf8'));
const sources = readFileSync(join(out, '10-sample-sources.tsv'), 'utf8').trim().split('\n').map((line) => {
  const [id, rel, format, sha, size] = line.split('\t');
  return { id, rel, format, sha, size: Number(size) };
});
const after = new Map(readFileSync(join(out, '10-sample-after.tsv'), 'utf8').trim().split('\n').map((line) => {
  const [id, shaBefore, shaAfter, state, v4Size] = line.split('\t');
  return [id, { shaBefore, shaAfter, state, v4Size }];
}));
const write = readJson('10-sample-write.json');
const verify = readJson('10-sample-verify.json');
const writeById = new Map(write.results.map((r) => [r.id, r]));
const verifyById = new Map(verify.results.map((r) => [r.id, r]));
const classifyFile = process.env.T10_CLASSIFY_JSON ?? join(out, '..', '10-classify', '10-read-classification.json');
let pre = new Map();
try { pre = new Map(JSON.parse(readFileSync(classifyFile, 'utf8')).results.map((r) => [r.id, r])); } catch { pre = new Map(); }
const rows = sources.map((s) => {
  const w = writeById.get(s.id) ?? {};
  const v = verifyById.get(s.id) ?? {};
  const p = pre.get(s.id) ?? {};
  const a = after.get(s.id) ?? {};
  return {
    id: s.id, source: s.rel, sourceFormat: s.format,
    preRead: p.ok === true ? { version: p.version, events: p.events, parentSession: p.parentSession } : (p.error ? { error: p.error } : null),
    writeOpen: w.ok === true ? 'ok' : `failed:${w.error}`,
    sourceUnchanged: a.state === 'unchanged',
    v4Size: a.v4Size,
    postRead: v.ok === true ? { version: v.version, events: v.events, parentSession: v.parentSession } : { error: v.error },
    eventsPreserved: typeof p.events === 'number' && v.ok === true ? p.events === v.events : null,
  };
});
writeFileSync(join(out, '10-sample-summary.json'), JSON.stringify({ generatedAt: new Date().toISOString(), samples: rows }, null, 1));
for (const row of rows) {
  console.log(`${row.id}\t${row.sourceFormat}->v4 write=${row.writeOpen} source=${row.sourceUnchanged ? 'unchanged' : 'CHANGED'} events ${row.preRead?.events ?? '-'}->${row.postRead.events ?? '-'} preserved=${row.eventsPreserved}`);
}
NODE
