// C0 probe (fact ④): does the 0.1.7-rc.1 preset registry discover a legacy
// $DSH_HOME/.agent-presets/<id>/ directory preset?
// Expected: only the declared row is listed; the legacy directory is ignored.
//
// Usage (must run inside the temp CLI install tree; the c0base profile must
// carry the registry + one declared preset row, see 02-preflight-repro.sh):
//   DSH_HOME=<temp-home> node 02-preflight-probe-preset.mjs
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { boot, loadProfile } from '@deepseek-ai/dsh-app-boot';

const require = createRequire(import.meta.url);
const anchor = require.resolve('@deepseek-ai/dsh/package.json');
const profile = loadProfile('dsh', 'c0base', anchor);
const patches = [...profile.layers.flatMap((layer) => layer.patches), ...profile.patches];
const ctx = await boot('c0-presetprobe', join(profile.dir, 'cordis.yml'), patches);
await ctx.get('loader')?.await();
const registry = ctx.get('agentPresets');
const ids = (await registry.list()).map((preset) => preset.id ?? preset).sort();
let declaredListed = ids.includes('declared-c0');
let resolveSentinel;
try {
  await registry.resolve('c0-sentinel');
  resolveSentinel = 'resolved';
} catch (error) {
  resolveSentinel = `rejected: ${String(error?.message ?? error)}`;
}
console.log(JSON.stringify({
  ids,
  declaredListed,
  sentinelListed: ids.includes('c0-sentinel'),
  resolveSentinel,
}, null, 1));
process.exit(0);
