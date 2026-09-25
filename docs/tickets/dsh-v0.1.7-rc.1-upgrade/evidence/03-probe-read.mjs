// T03 restore drill: open one restored session with the local 0.1.5-rc.2 host copy
// through its read path (ctx.sessionQuery.readSession), and report observed facts.
import { join } from 'node:path';
import { boot, loadProfile } from '@deepseek-ai/dsh-app-boot';

const pkgDir = process.env.T03_PKG;
const home = process.env.T03_HOME;
const id = process.argv[2];
if (!pkgDir || !home || !id) {
  console.error('usage: T03_PKG=<host-copy> T03_HOME=<scratch-home> node probe-read.mjs <session-id>');
  process.exit(2);
}
const anchor = join(pkgDir, 'package.json');
const profile = loadProfile('dsh', 'drill-base', anchor, home);
const patches = [...profile.layers.flatMap((layer) => layer.patches), ...profile.patches];
const ctx = await boot('t03-read', join(profile.dir, 'cordis.yml'), patches);
const loader = ctx.get('loader');
if (loader?.await) await loader.await();
const snapshot = await ctx.get('sessionQuery').readSession(id);

const subagentEvents = snapshot.events.filter((e) => String(e.type).startsWith('subagent')).length;
const attachmentIds = new Set();
for (const e of snapshot.events) {
  for (const m of JSON.stringify(e).matchAll(/"attachmentId":"(sha256:[0-9a-f]{64})"/g)) attachmentIds.add(m[1]);
}
console.log(JSON.stringify({
  ok: true,
  id: snapshot.session.id,
  version: snapshot.session.version,
  parentSession: snapshot.session.parentSession ?? null,
  delegationDepth: snapshot.session.delegationDepth ?? null,
  origin: snapshot.session.origin ?? null,
  cwd: snapshot.session.cwd,
  events: snapshot.events.length,
  subagentEvents,
  attachmentIdCount: attachmentIds.size,
  attachmentIds: [...attachmentIds],
  firstEventType: snapshot.events[0]?.type ?? null,
  lastEventType: snapshot.events[snapshot.events.length - 1]?.type ?? null,
}, null, 1));
process.exit(0);
