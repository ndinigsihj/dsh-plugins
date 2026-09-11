/**
 * /model 热切换真实树 spike（设计稿 docs/model-hot-switch-design.md §5.2 的自动化部分）。
 *
 * 用 headless profile 完整 dsh 树 + installModelSelection 创建真实 agent：
 *   1. 第一轮用 route A，读 request/context 确认 A；
 *   2. 热改 selection.current = route B；
 *   3. 第二轮读 request/context 确认 B（即使无 key 走到 MISSING_CREDENTIAL，
 *      request/context 在请求前置阶段就已落日志）。
 *
 * 运行：node experiments/model-hot-switch-live-spike.mjs
 * 可选：DEEPSEEK_API_KEY 或 ~/.dsh/.credentials.yaml（无 key 也能验证路由记录）。
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { installModelSelection } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-agent/lib/index.js";
import { createUserMessage } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-llm/lib/index.js";
import { SessionId } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-session/lib/index.js";
// 用 repo 的 dev 依赖树（link-global-dsh.sh → 全局 rc.1），与上方 dsh-agent/session/llm 同代；
// ~/.dsh/profiles/node_modules 共享 farm 会被最近一次 boot 的宿主整代重写（2026-09-10 实测）。
import { boot, loadProfile } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js";

// 自动注入 credentials（与 dsh CLI 同一解析来源；缺 key 也能跑路由记录验证）
try {
  const creds = readFileSync(`${process.env.HOME}/.dsh/.credentials.yaml`, "utf8");
  for (const line of creds.split("\n")) {
    const m = /^([A-Z_]+):\s*(\S+)/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {}

const INSTALL_ANCHOR = "/Users/vito/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/package.json";

const profile = loadProfile("dsh", "headless", INSTALL_ANCHOR);
const bundlePatches = profile.layers.flatMap((layer) => layer.patches);
const smokePatches = [
  { id: "headless-runner", disabled: true },
  { id: "headless-startup", disabled: true },
  { id: "tool-bash", disabled: true },
  { id: "session-persistence-jsonl", config: { root: "/tmp/model-hot-switch-spike-sessions" } },
];

const ctx = await boot("model-hot-switch-live-spike", join(profile.dir, "cordis.yml"), [
  ...bundlePatches,
  ...profile.patches,
  ...smokePatches,
]);
await ctx.get("loader")?.await();

const agents = ctx.get("agents");
const llm = ctx.get("llm");
const agentDefaultModel = ctx.get("agentDefaultModel");
if (!agents || !llm || !agentDefaultModel) {
  console.error("missing services: agents/llm/agentDefaultModel");
  process.exit(1);
}

// 选 route A = 当前默认；route B = 目录里第一个不同的路由
const defaultSelection = agentDefaultModel.currentSelection();
const routeA = { provider: defaultSelection.provider, model: defaultSelection.model };
const routes = [];
for (const provider of llm.listProviders()) {
  for (const model of await llm.listModels(provider.id).catch(() => [])) {
    routes.push({ provider: provider.id, model: model.id });
  }
}
const routeB = routes.find((r) => r.provider !== routeA.provider || r.model !== routeA.model);
if (routeB === undefined) {
  console.log("SKIP: llm catalog only has one route, cannot verify provider/model hot-switch");
  process.exit(0);
}
console.log(`routes: A=${routeA.provider}/${routeA.model}  B=${routeB.provider}/${routeB.model}`);

const selection = { current: routeA, assembled: undefined };
const { agent } = await agents.create({
  sessionId: SessionId(`session-model-hot-switch-${randomUUID()}`),
  meta: { cwd: process.cwd() },
  agentOptions: routeA,
  setup: (agentCtx) => {
    installModelSelection(agentCtx, selection);
  },
});
await agent.whenIdle();

async function lastRequestContext(label) {
  const before = agent.session.seq;
  agent.followup(
    createUserMessage({
      content: [{ type: "text", text: "不要调用工具，直接回复 OK。" }],
      source: { kind: "user" },
    }),
  );
  await agent.whenIdle();
  const events = agent.session.snapshotEvents().filter( // rc.1：按需快照，取代已移除的 events getter
    (e) => e.seq >= before && e.type === "request/context",
  );
  const last = events[events.length - 1];
  console.log(`[${label}] request/context = ${JSON.stringify(last?.data ?? null)}`);
  return last;
}

const first = await lastRequestContext("A");
if (first?.data?.provider !== routeA.provider || first?.data?.model !== routeA.model) {
  console.error("FAIL: first request/context did not record route A");
  process.exit(1);
}

selection.current = routeB;
const second = await lastRequestContext("B");
if (second?.data?.provider !== routeB.provider || second?.data?.model !== routeB.model) {
  console.error(`FAIL: second request/context did not record route B (got ${JSON.stringify(second?.data ?? null)})`);
  process.exit(1);
}

console.log("PASS: real-tree hot-switch — request/context records new route on next turn");
process.exit(0);