// Ticket 10: build the migration result lists from the phase A/C/D artifacts.
//
// Usage:
//   SESSIONS_DIR=$HOME/.dsh/sessions node 10-build-lists.mjs \
//     <inventory-dir> <classify-json> <samples-file> <out-dir>
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

const [inventoryDir, classifyJson, samplesFile, outDir] = process.argv.slice(2);
const sessionsDir = process.env.SESSIONS_DIR;
if (!inventoryDir || !classifyJson || !samplesFile || !outDir || !sessionsDir) {
  console.error('usage: SESSIONS_DIR=... node 10-build-lists.mjs <inventory-dir> <classify-json> <samples-file> <out-dir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const readTsv = (file) => readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => line.split('\t'));
const readLines = (file) => readFileSync(file, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
const canonical = readTsv(join(inventoryDir, 'canonical.tsv'));
const variants = readTsv(join(inventoryDir, 'variants.tsv'));
const live = new Set(readLines(join(inventoryDir, 'live-writers.txt'))
  .filter((line) => !line.startsWith('#'))
  .map((line) => line.split('\t')[2]).map((path) => basename(dirname(path))));
const classification = new Map(JSON.parse(readFileSync(classifyJson, 'utf8')).results.map((r) => [r.id, r]));
const samples = readLines(samplesFile);

// group canonical rows by id; selected file = highest generation present on disk now
const byId = new Map();
for (const [rel, format, id, size] of canonical) {
  const row = byId.get(id) ?? { id, project: rel.split('/')[0], files: [] };
  row.files.push({ rel, format, size: Number(size) });
  byId.set(id, row);
}
const rankOf = (generation) => (generation === 'v4' ? 4 : generation === 'v3' ? 3 : generation === 'v0' ? 1 : 0);
const generationOf = (name) => (name === 'session.v4.jsonl.zstd' ? 'v4' : name === 'session.v3.jsonl.zstd' ? 'v3' : name === 'session.jsonl.zstd' ? 'v0' : null);
const diskState = (id, project) => {
  const dir = join(sessionsDir, project, id);
  let names = [];
  try { names = readdirSync(dir); } catch { return null; }
  const generations = names.map(generationOf).filter(Boolean).sort((a, b) => rankOf(b) - rankOf(a));
  return { dir, generations, selected: generations[0] ?? null };
};

const sampleSet = new Set(samples);
const stillOld = [];
const selectedV4 = [];
const skip = [];
const summary = { generatedAt: new Date().toISOString(), totals: {}, bySelectedGeneration: {}, samples: samples.length };

for (const row of [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))) {
  const pre = classification.get(row.id) ?? {};
  const state = diskState(row.id, row.project);
  const selected = state?.selected ?? row.files.sort((a, b) => rankOf(b.format) - rankOf(a.format))[0].format;
  const selectedFile = row.files.find((f) => f.format === selected) ?? null;
  if (selected === 'v4') {
    const v4Rel = selectedFile?.rel ?? `${row.project}/${row.id}/session.v4.jsonl.zstd`;
    let v4Size = selectedFile?.size ?? null;
    if (v4Size === null) {
      try { v4Size = statSync(join(sessionsDir, v4Rel)).size; } catch { v4Size = null; }
    }
    selectedV4.push({
      id: row.id, project: row.project, selected: 'v4',
      v4File: v4Rel, v4Size,
      sourceFile: row.files.filter((f) => f.format !== 'v4').map((f) => f.rel).join(','),
      preReadVersion: pre.version ?? null, preReadEvents: pre.events ?? null,
      sourceFormat: row.files.filter((f) => f.format !== 'v4').map((f) => f.format).join(','),
    });
    summary.bySelectedGeneration.v4 = (summary.bySelectedGeneration.v4 ?? 0) + 1;
    if (!sampleSet.has(row.id)) summary.totals.unexpectedV4 = (summary.totals.unexpectedV4 ?? 0) + 1;
    continue;
  }
  stillOld.push({
    id: row.id, project: row.project, selected, selectedFile: selectedFile?.rel ?? null, size: selectedFile?.size ?? null,
    readable: pre.ok === true, readableClass: pre.class ?? 'not-classified', events: pre.events ?? null,
    liveAtInventory: live.has(row.id),
  });
  summary.bySelectedGeneration[selected] = (summary.bySelectedGeneration[selected] ?? 0) + 1;
}

for (const row of stillOld) {
  if (row.readableClass.startsWith('unreadable')) {
    skip.push({ kind: row.readableClass, id: row.id, path: row.selectedFile, detail: classification.get(row.id)?.error ?? '' });
  }
  if (row.liveAtInventory) skip.push({ kind: 'active-writer', id: row.id, path: row.selectedFile, detail: 'held session.lock at inventory snapshot' });
}
for (const [rel, size, sha] of variants) {
  skip.push({ kind: rel.endsWith('xxx.sh') ? 'stray-file' : 'variant-file', id: '-', path: rel, detail: `size=${size} sha256=${sha}` });
}

summary.totals = {
  ...summary.totals,
  canonicalFiles: canonical.length,
  sessionIds: byId.size,
  migrated: selectedV4.length,
  stillOld: stillOld.length,
  readableStillOld: stillOld.filter((r) => r.readable).length,
  unreadable: stillOld.filter((r) => !r.readable).length,
  liveAtInventory: stillOld.filter((r) => r.liveAtInventory).length,
  skipEntries: skip.length,
};
const writeTsv = (name, header, rows) => writeFileSync(join(outDir, name), [header, ...rows.map((r) => r.join('\t'))].join('\n') + '\n');
writeTsv('10-still-old-format.tsv', ['id', 'project', 'selected', 'source_file', 'size', 'readable', 'class', 'events', 'live_at_inventory'],
  stillOld.map((r) => [r.id, r.project, r.selected, r.selectedFile, r.size, r.readable, r.readableClass, r.events ?? '-', r.liveAtInventory]));
writeTsv('10-migrated-samples.tsv', ['id', 'project', 'source_format', 'source_file', 'selected', 'v4_file', 'v4_size', 'pre_read_events'],
  selectedV4.map((r) => [r.id, r.project, r.sourceFormat, r.sourceFile, r.selected, r.v4File, r.v4Size, r.preReadEvents ?? '-']));
writeTsv('10-skip-list.tsv', ['kind', 'id', 'path', 'detail'],
  skip.map((r) => [r.kind, r.id, r.path, String(r.detail).replace(/\t/g, ' ').replace(/\n/g, ' ')]));
writeFileSync(join(outDir, '10-summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
