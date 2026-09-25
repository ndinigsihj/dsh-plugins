// Ticket 10 probe: read-open (no writes) or write-open (historical input is
// migrated and a current-format successor is published; the source generation
// stays byte-identical) every session id in a list file.
//
// The probe boots a throwaway dsh-base-only profile from T10_HOME, whose
// `sessions` entry is expected to be a symlink to the session root under test.
// That keeps profile/config writes out of a real home while the persistence
// backend still operates on the real artifacts.
//
// Usage:
//   T10_HOME=<probe-home> T10_PROFILE=<profile> T10_ANCHOR=<dsh/package.json> \
//     DSH_HOME=<probe-home> node 10-probe-open.mjs <read|write> <ids-file>
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [mode, listFile] = process.argv.slice(2);
const home = process.env.T10_HOME;
const anchor = process.env.T10_ANCHOR;
const profileName = process.env.T10_PROFILE;
if (!mode || !listFile || !home || !anchor || !profileName) {
  console.error('usage: T10_HOME=... T10_PROFILE=... T10_ANCHOR=... node 10-probe-open.mjs <read|write> <ids-file>');
  process.exit(2);
}
// Resolve app-boot from the host anchor so the probe can never mix the host
// under test with a different copy installed along the probe's own path.
const anchorRequire = createRequire(anchor);
const { boot, loadProfile } = await import(anchorRequire.resolve('@deepseek-ai/dsh-app-boot'));
const ids = readFileSync(listFile, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
const profile = loadProfile('dsh', profileName, anchor, home);
const patches = [...profile.layers.flatMap((layer) => layer.patches), ...profile.patches];
const ctx = await boot(`t10-${mode}-open`, join(profile.dir, 'cordis.yml'), patches);
await ctx.get('loader')?.await();
const results = [];
for (const id of ids) {
  const startedAt = Date.now();
  try {
    if (mode === 'read') {
      const snapshot = await ctx.get('sessionQuery').readSession(id);
      results.push({
        id,
        ok: true,
        ms: Date.now() - startedAt,
        version: snapshot.session.version,
        events: snapshot.events.length,
        cwd: snapshot.session.cwd ?? null,
        agentPreset: snapshot.session.agentPreset ?? null,
        parentSession: snapshot.session.parentSession ?? null,
      });
    } else {
      const handle = await ctx.get('sessionPersistence').open(id, 'write');
      await handle.close();
      results.push({ id, ok: true, ms: Date.now() - startedAt });
    }
  } catch (error) {
    results.push({ id, ok: false, ms: Date.now() - startedAt, error: String(error?.message ?? error).slice(0, 300) });
  }
}
const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({
  mode,
  total: results.length,
  opened: results.length - failed.length,
  failed: failed.length,
  errorClasses: [...new Set(failed.map((result) => result.error.slice(0, 80)))],
  results,
}, null, 1));
process.exit(0);
