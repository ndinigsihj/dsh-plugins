// C0 probe (fact ③ read open): boot a temp 0.1.7-rc.1 profile and read one
// persisted session through ctx.sessionQuery, which migrates historical input
// in memory only.
//
// Usage (must run inside the temp CLI install tree, where bare specifiers
// resolve to the temp 0.1.7-rc.1 host; see 02-preflight-repro.sh):
//   DSH_HOME=<temp-home> node 02-preflight-probe-read.mjs <session-id>
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { boot, loadProfile } from '@deepseek-ai/dsh-app-boot';

const require = createRequire(import.meta.url);
const anchor = require.resolve('@deepseek-ai/dsh/package.json');
const profile = loadProfile('dsh', 'c0base', anchor);
const patches = [...profile.layers.flatMap((layer) => layer.patches), ...profile.patches];
const ctx = await boot('c0-readprobe', join(profile.dir, 'cordis.yml'), patches);
await ctx.get('loader')?.await();
const snapshot = await ctx.get('sessionQuery').readSession(process.argv[2]);
console.log(JSON.stringify({
  ok: true,
  id: snapshot.session.id,
  version: snapshot.session.version,
  agentPreset: snapshot.session.agentPreset,
  events: snapshot.events.length,
}, null, 1));
process.exit(0);
