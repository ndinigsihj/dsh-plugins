#!/usr/bin/env bash
# T03 restore drill: restore the cold backup into a scratch home and open representative
# sessions with the local 0.1.5-rc.2 host copy. Scratch-only; real sessions dir is not touched.
#
# Facts this drill encodes (measured 2026-09-25, see meta/drill.log and evidence doc):
#   - v3 read-open returns version 3, events == file lines - 1.
#   - v0 read-open migrates in memory to version 3 and consolidates streaming chunk events;
#     the v0 source file is not modified and no successor is published (read-only).
#   - 72 legacy v0 subagent children carry subagent/descriptor data version 2; the old host's
#     v0->v1 migration refuses them ("unsupported descriptor version 2"). Pre-existing, recorded.
set -uo pipefail
ROOT="${1:?usage: drill.sh <backup-root>}"
H="$HOME/.dsh"; M="$ROOT/meta"; LOG="$M/drill.log"
DRILL="${DRILL_ROOT:-/tmp/dsh-t03-drill-$(date +%Y%m%d-%H%M%S)}"
SCRATCH="$DRILL/home"; PKG="$ROOT/host-package/dsh-0.1.5-rc.2"; RUNNER="$ROOT/host-package/drill-runner"
log() { printf '[%s] %s\n' "$(date '+%F %T %z')" "$*" | tee -a "$LOG"; }
fail=0
chk() { if diff -q "$1" "$2" >/dev/null 2>&1; then log "PASS  $3"; else log "FAIL  $3"; diff "$1" "$2" 2>&1 | head -10 | tee -a "$LOG"; fail=1; fi; }

log "== drill root: $DRILL =="
mkdir -p "$SCRATCH/profiles/drill-base" "$RUNNER" "$M/drill"

log "== restore backup into scratch =="
rsync -a "$ROOT/sessions/" "$SCRATCH/sessions/"
rsync -a "$ROOT/attachments/" "$SCRATCH/attachments/"
node "$M/manifest.mjs" "$SCRATCH/sessions" "$M/drill/restored.sessions.tsv" >/dev/null
node "$M/manifest.mjs" "$SCRATCH/attachments" "$M/drill/restored.attachments.tsv" >/dev/null
chk "$M/sessions.dst.tsv" "$M/drill/restored.sessions.tsv" "restored sessions byte-identical to backup"
chk "$M/attachments.dst.tsv" "$M/drill/restored.attachments.tsv" "restored attachments byte-identical to backup"

log "== old-host scratch profile (dsh-base only) + drill runner =="
printf '{"name":"dsh-profile-drill-base","private":true,"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base"]}}}\n' > "$SCRATCH/profiles/drill-base/package.json"
printf '[]\n' > "$SCRATCH/profiles/drill-base/cordis.patch.yml"
printf '# t03 drill base profile — empty entry list.\n[]\n' > "$SCRATCH/profiles/drill-base/cordis.yml"
ln -sfn "$PKG/node_modules" "$SCRATCH/profiles/drill-base/node_modules"
ln -sfn ../dsh-0.1.5-rc.2/node_modules "$RUNNER/node_modules"
cp -f "$M/probe-read.mjs" "$RUNNER/probe-read.mjs"
cp -f "$M/probe-read-many.mjs" "$RUNNER/probe-read-many.mjs"

assert_open() { # "<id>|<expVersion>|<expParent>|<minEvents>|<minSubagent>"
  local spec="$1" id expVer expParent minEvents minSubagent
  IFS='|' read -r id expVer expParent minEvents minSubagent <<< "$spec"
  local f="$M/drill/open-$id.json"
  if [ ! -s "$f" ]; then log "FAIL  open $id (no output; see .err)"; fail=1; return; fi
  node -e '
    const fs = require("node:fs");
    const [file, id, expVer, expParent, minEvents, minSubagent] = process.argv.slice(1);
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    const problems = [];
    if (j.ok !== true) problems.push("ok!=true");
    if (j.id !== id) problems.push(`id=${j.id}`);
    if (expVer !== "-" && String(j.version) !== expVer) problems.push(`version=${j.version}`);
    if (expParent !== "-" && String(j.parentSession ?? "") !== expParent) problems.push(`parent=${j.parentSession}`);
    if (!(j.events >= Number(minEvents))) problems.push(`events=${j.events}`);
    if (!(j.subagentEvents >= Number(minSubagent))) problems.push(`subagentEvents=${j.subagentEvents}`);
    if (problems.length) { console.error(`FAIL ${id}: ${problems.join("; ")}`); process.exit(1); }
    console.log(`PASS  open ${id} v${j.version} events=${j.events} subagent=${j.subagentEvents} attachments=${j.attachmentIdCount} parent=${j.parentSession ?? "-"}`);
  ' "$f" "$id" "$expVer" "$expParent" "$minEvents" "$minSubagent" | tee -a "$LOG" || fail=1
}
open_one() { # spec as above
  local spec="$1" id
  id="${spec%%|*}"
  T03_PKG="$PKG" T03_HOME="$SCRATCH" DSH_HOME="$SCRATCH" node "$RUNNER/probe-read.mjs" "$id" \
    > "$M/drill/open-$id.json" 2> "$M/drill/open-$id.err"
  local rc=$?
  if [ $rc -ne 0 ]; then log "FAIL  probe exit=$rc for $id"; head -5 "$M/drill/open-$id.err" | tee -a "$LOG"; fail=1; return; fi
  assert_open "$spec"
}

log "== open representative sessions (old host 0.1.5-rc.2, read path) =="
# spec = "id|expected version|expected parent|min events|min subagent events"
# v3 subagent chain: root (has subagent events) -> depth-1 -> depth-3 child
open_one "session-f9c1b3b6-5817-43ac-b009-7b03f6f43f33|3|-|100|1"
open_one "06bb5ecf-cf7b-4718-b2c1-08990d7a5a84|3|session-f9c1b3b6-5817-43ac-b009-7b03f6f43f33|50|0"
open_one "c36a2dad-45fc-4215-9151-cea5f61c19d3|3|b424f25c-369b-47ef-b33b-cb319fcb3dd4|20|0"
# v0 root with subagents (read-open migrates in memory to v3) + two more v0 logs incl. the largest
open_one "session-32c61738-46e0-4f35-ba92-9e0a624fb8c8|3|-|3000|0"
open_one "session-296c9f42-846e-452e-a043-c779555b3fde|3|session-73dfaa4b-b6c2-40ec-a804-81ca1470202d|13000|0"
# v3 session, the snapshot-time copy of the live conversation session, and an attachment-bearing subagent session
open_one "session-ba1aed88-b181-46de-8a8e-4e1be083a539|3|-|1000|0"
open_one "session-66e1fe6c-e993-4cb3-bc0e-2c5c6aef2ba4|3|-|1|0"
open_one "6d4bc58f-8665-4572-a12d-be3d09db0410|3|session-15fb0ea9-d45b-40dc-8ad0-f95a7948be3c|100|1"

log "== v0 subagent child linkage (child log in backup; header points at the opened root) =="
CHILD="$SCRATCH/sessions/--Users-vito-data-dev-dsh-plugins--/b4cfcbf7-cd3b-4fdb-97a3-72aa746a4504/session.jsonl.zstd"
if [ -f "$CHILD" ] && zstd -dc "$CHILD" | head -1 | grep -q '"parentSession":"session-32c61738-46e0-4f35-ba92-9e0a624fb8c8"'; then
  log "PASS  v0 subagent child b4cfcbf7 present in backup, header parent=session-32c61738 (child log is in the descriptor-v2 blind spot)"
else
  log "FAIL  v0 subagent child linkage check"; fail=1
fi

log "== attachment references of opened sessions resolve in restored objects/ =="
node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const [dir, root] = process.argv.slice(1);
  let refs = 0, missing = [], unreadable = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.startsWith("open-") && x.endsWith(".json"))) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { unreadable.push(f); continue; }
    for (const id of j.attachmentIds ?? []) {
      refs++;
      const hex = id.replace(/^sha256:/, "");
      if (!fs.existsSync(path.join(root, "attachments", "v1", "objects", hex.slice(0, 2), hex))) missing.push(id);
    }
  }
  if (unreadable.length) console.error(`WARN unreadable open outputs: ${unreadable.join(", ")}`);
  if (missing.length) { console.error(`FAIL ${missing.length}/${refs} attachment objects missing`); process.exit(1); }
  console.log(`PASS  ${refs} attachment references resolve to restored objects (0 missing)`);
' "$M/drill" "$SCRATCH" | tee -a "$LOG" || fail=1

log "== pre-existing old-host blind spot: descriptor-v2 v0 subagent sessions =="
T03_PKG="$PKG" T03_HOME="$SCRATCH" DSH_HOME="$SCRATCH" node "$RUNNER/probe-read-many.mjs" "$M/descriptor-v2-ids.txt" \
  > "$M/drill/descriptor-v2-open-attempt.json" 2> "$M/drill/descriptor-v2-open-attempt.err"
if [ $? -ne 0 ]; then log "FAIL  descriptor-v2 batch probe errored"; head -5 "$M/drill/descriptor-v2-open-attempt.err" | tee -a "$LOG"; fail=1; else
  node -e '
    const j = require(process.argv[1]);
    console.log(`RECORD  descriptor-v2 set: total=${j.total} opened=${j.opened} failed=${j.failed} classes=${JSON.stringify(j.errorClasses)}`);
    if (j.total !== j.failed || j.errorClasses.length !== 1 || j.errorClasses[0] !== "unsupported descriptor version 2") process.exit(1);
  ' "$M/drill/descriptor-v2-open-attempt.json" | tee -a "$LOG" || { log "FAIL  descriptor-v2 set did not match the recorded inventory"; fail=1; }
fi

log "== scratch sessions unchanged by the read drill =="
node "$M/manifest.mjs" "$SCRATCH/sessions" "$M/drill/restored.sessions.after.tsv" >/dev/null
chk "$M/drill/restored.sessions.tsv" "$M/drill/restored.sessions.after.tsv" "read opens did not modify scratch sessions"

log "== real source tree untouched by the drill (live writers are not the drill) =="
node "$M/manifest.mjs" "$H/sessions" "$M/drill/source.sessions.after.tsv" >/dev/null
node "$M/manifest.mjs" "$H/attachments" "$M/drill/source.attachments.after.tsv" >/dev/null
node "$M/manifest.mjs" "$H/profiles" "$M/drill/source.profiles.after.tsv" >/dev/null
chk "$M/attachments.src.after.tsv" "$M/drill/source.attachments.after.tsv" "real attachments dir unchanged"
chk "$M/profiles.src.after.tsv" "$M/drill/source.profiles.after.tsv" "real profiles dir unchanged"
# Live session dirs = dirs whose session.lock is held right now; the TUI running this drill cannot be silenced.
lsof +D "$H/sessions" 2>/dev/null | awk 'NR>1 && $NF ~ /session\.lock$/ {print $NF}' \
  | sed "s|^$H/sessions/||; s|/session\.lock$||" | sort -u > "$M/drill/live-session-dirs.txt"
node -e '
  const fs = require("node:fs");
  const [before, after, liveFile] = process.argv.slice(1);
  const parse = (p) => new Map(fs.readFileSync(p, "utf8").trim().split("\n").map((l) => { const i = l.indexOf("\t"); const j = l.indexOf("\t", i + 1); return [l.slice(j + 1), l.slice(0, j)]; }));
  const a = parse(before), b = parse(after);
  const live = new Set(fs.readFileSync(liveFile, "utf8").trim().split("\n").filter(Boolean));
  const isLive = (p) => [...live].some((d) => p === d || p.startsWith(d + "/"));
  const changed = [], removed = [], added = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (!a.has(k)) added.push(k);
    else if (!b.has(k)) removed.push(k);
    else if (a.get(k) !== b.get(k)) changed.push(k);
  }
  const unexpected = [...changed, ...removed].filter((p) => !isLive(p));
  console.log(`snapshot vs post-drill: changed=${changed.length} removed=${removed.length} added-after-snapshot=${added.length} liveSessionDirs=${live.size}`);
  console.log(`post-snapshot additions (loss window, not drill writes): ${added.length === 0 ? "-" : added.slice(0, 6).join(", ") + (added.length > 6 ? ", ..." : "")}`);
  if (unexpected.length) { console.error("unexpected modified/removed paths:"); console.error(unexpected.slice(0, 10).join("\n")); process.exit(1); }
  console.log(`PASS  no snapshot path was modified or removed outside live session dirs (${[...live].join(", ")})`);
' "$M/sessions.src.after.tsv" "$M/drill/source.sessions.after.tsv" "$M/drill/live-session-dirs.txt" | tee -a "$LOG" || fail=1

date '+%FT%T%z' > "$M/drill/drill-end.txt"
log "== drill done; fail=$fail; scratch=$DRILL =="
exit $fail
