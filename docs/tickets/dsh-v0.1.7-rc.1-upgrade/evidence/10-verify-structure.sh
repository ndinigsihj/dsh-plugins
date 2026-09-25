#!/usr/bin/env bash
# Ticket 10 phase D: read-only structural verification of the migrated sample
# successors. Emits one JSON object per sample (header version, event count and
# types, subagent/catalog facts, attachment-id count).
#
# Usage: SESSIONS_DIR=$HOME/.dsh/sessions bash 10-verify-structure.sh [out-file]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SESSIONS="${SESSIONS_DIR:-$HOME/.dsh/sessions}"
IDS="${T10_SAMPLE_IDS:-$HERE/10-samples/10-sample-ids.txt}"
OUT="${1:-/dev/stdout}"
[ -d "$SESSIONS" ] || { echo "sessions dir not found: $SESSIONS" >&2; exit 2; }
[ -f "$IDS" ] || { echo "sample ids file not found: $IDS" >&2; exit 2; }

while IFS= read -r id; do
  [ -n "$id" ] || continue
  file="$(find "$SESSIONS" -name 'session.v4.jsonl.zstd' -path "*/$id/*" 2>/dev/null | head -1)"
  if [ -z "$file" ]; then
    printf '{"id":"%s","v4":false}\n' "$id"
    continue
  fi
  size="$(stat -f %z "$file")"
  zstd -dc "$file" | node -e '
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      const lines = Buffer.concat(chunks).toString("utf8").split("\n").filter((line) => line.trim());
      const header = JSON.parse(lines[0]);
      const events = lines.slice(1).map((line) => JSON.parse(line));
      const eventTypes = {};
      const subagentCatalog = [];
      const attachments = new Set();
      for (const event of events) {
        eventTypes[event.type] = (eventTypes[event.type] ?? 0) + 1;
        if (event.type === "subagent/catalog") subagentCatalog.push(event.data);
        for (const match of JSON.stringify(event).matchAll(/"attachmentId":"(sha256:[0-9a-f]{64})"/g)) attachments.add(match[1]);
      }
      console.log(JSON.stringify({
        id: process.argv[1],
        v4: true,
        headerVersion: header.version,
        size: Number(process.argv[2]),
        events: events.length,
        eventTypes,
        subagentCatalog,
        attachmentIdCount: attachments.size,
      }));
    });' "$id" "$size"
done < "$IDS" > "$OUT"
