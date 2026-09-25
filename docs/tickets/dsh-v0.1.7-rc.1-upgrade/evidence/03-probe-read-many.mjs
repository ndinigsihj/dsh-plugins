// T03 drill: open many sessions with one boot of the local 0.1.5-rc.2 host copy and
// report per-session ok/error (used for the pre-existing descriptor-v2 inventory).
import { join } from 'node:path';
import { boot, loadProfile } from '@deepseek-ai/dsh-app-boot';

const pkgDir = process.env.T03_PKG;
const home = process.env.T03_HOME;
const listFile = process.argv[2];
if (!pkgDir || !home || !listFile) {
  console.error('usage: T03_PKG=<host-copy> T03_HOME=<scratch-home> node probe-read-many.mjs <id-list>');
  process.exit(2);
}
const ids = (await import('node:fs')).readFileSync(listFile, 'utf8').trim().split('\n').filter(Boolean);
const anchor = join(pkgDir, 'package.json');
const profile = loadProfile('dsh', 'drill-base', anchor, home);
const patches = [...profile.layers.flatMap((layer) => layer.patches), ...profile.patches];
const ctx = await boot('t03-read-many', join(profile.dir, 'cordis.yml'), patches);
const loader = ctx.get('loader');
if (loader?.await) await loader.await();
const query = ctx.get('sessionQuery');
const results = [];
for (const id of ids) {
  try {
    const snapshot = await query.readSession(id);
    results.push({ id, ok: true, version: snapshot.session.version, events: snapshot.events.length });
  } catch (error) {
    results.push({ id, ok: false, error: String(error?.message ?? error).slice(0, 200) });
  }
}
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({
  total: results.length,
  opened: results.length - failed.length,
  failed: failed.length,
  errorClasses: [...new Set(failed.map((r) => (r.error.match(/unsupported descriptor version \d+/)?.[0] ?? r.error.slice(0, 60))))],
  results,
}, null, 1));
process.exit(0);
