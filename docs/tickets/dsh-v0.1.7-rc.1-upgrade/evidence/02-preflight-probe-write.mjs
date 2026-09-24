// C0 probe (fact ③ write open): exercise a write open of one persisted session
// through ctx.sessionPersistence.open(id, 'write') and close it, without
// driving an app. The backend migrates historical input and publishes a new
// current-format successor; the source generation stays byte-identical.
//
// Usage (must run inside the temp CLI install tree, where bare specifiers
// resolve to the temp 0.1.7-rc.1 host; see 02-preflight-repro.sh):
//   DSH_HOME=<temp-home> node 02-preflight-probe-write.mjs <session-id>
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { boot, loadProfile } from '@deepseek-ai/dsh-app-boot';

const require = createRequire(import.meta.url);
const anchor = require.resolve('@deepseek-ai/dsh/package.json');
const profile = loadProfile('dsh', 'c0base', anchor);
const patches = [...profile.layers.flatMap((layer) => layer.patches), ...profile.patches];
const ctx = await boot('c0-writeopen', join(profile.dir, 'cordis.yml'), patches);
await ctx.get('loader')?.await();
const handle = await ctx.get('sessionPersistence').open(process.argv[2], 'write');
await handle.close();
console.log(JSON.stringify({ ok: true, id: process.argv[2] }, null, 1));
process.exit(0);
