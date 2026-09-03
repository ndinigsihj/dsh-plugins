/**
 * phase-swap-bash 集成单测（真实 dsh 运行时）。
 *
 * 使用 repo 的 node_modules（`/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai`）。
 * 原 endless-tui profile（第三方 @deepseek-harness-tui/dsh-tui）已删除，本测试不再依赖它。
 *
 * 运行：node --test presets/liangshen-bash/phase-swap-bash.test.mjs
 *
 * 覆盖：
 *  1. 首轮（未 promote）agent 看到 persistent bash（仅 command 参数）
 *  2. tool/call 后 swap：agent 的 view 显示沙箱 bash（含 sandbox_permissions/justification）
 *  3. swap 幂等：同一 session 二次 tool/call 不重复 swap
 *  4. per-agent 隔离：agent A swap 后 agent B 仍看 persistent bash
 *  5. 失败降级：swap 抛错（缺 sandboxPolicy）→ warn once + 不 rethrow + persistent 保留
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// ── 部署包绝对路径（rc.8 运行时）─────────────────────────────────────────────
const DEP = "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai";
const CORDIS = "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/cordis/lib/index.js";
const SCOPE = "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-scope/lib/index.js";

const { Context } = await import(CORDIS);
const { createScope, scopeOf } = await import(SCOPE);
const { ToolRuntime } = await import(`${DEP}/dsh-tools/lib/index.js`);
const persistentBash = await import(`${DEP}/dsh-tool-bash-persistent/lib/index.js`);
const sandboxBash = await import(`${DEP}/dsh-tool-bash/lib/index.js`);
const plugin = await import("./phase-swap-bash.mjs");

const PERSISTENT_DESC = "persistent probe bash";
const PARAM_KEYS = (tool) => Object.keys(tool?.parameters?.properties ?? {});
const VIEW = (agentCtx) => agentCtx.tools.view(scopeOf(agentCtx)).visible;

/** 构建一个带 host 服务 + ToolRuntime + agents 存根的根 ctx。 */
function boot(sandboxPolicyMode = "workspace-write", withSandboxPolicy = true) {
  const root = new Context();
  root.provide("systemPrompt", { tools() {}, section() {} });
  const tools = new ToolRuntime(root, {});
  tools.layers.onChange = () => {};
  root.provide("shell", { sandboxMode: sandboxPolicyMode });
  if (withSandboxPolicy) {
    root.provide("sandboxPolicy", {
      resolve: () => ({ mode: sandboxPolicyMode, workspaceRoot: process.cwd() }),
    });
  }
  root.provide("approval", { request: async () => ({}) });
  root.provide("shellEnv", { collect: () => ({}) });
  const warnings = [];
  // cordis 的 ctx.logger 是内建 LoggerService（provide 覆盖不了）；用 exporter 接日志。
  // 注意：默认 effective level=1 < warn(2)，会过滤掉 warn——必须显式 levels 提到 3。
  // exporter 收到结构化 message {args,...}（无 .text），取 args 拼接。
  root.logger.exporter({ levels: { default: 3 }, export: (msg) => warnings.push([msg.type, ...(msg.args ?? [])].join(" ")) });
  const agentStore = new Map();
  root.provide("agents", { get: (id) => agentStore.get(id) });

  // 捕获插件注册的 session/event 监听器（真实 harness 用 invokeContainedSessionObservers
  // 以 (session, event) 直接调用，不经 cordis 的 ctx.emit——后者会把事件名当第一个参数）。
  const sessionListeners = [];
  const assembleListeners = [];
  const origOn = root.on.bind(root);
  root.on = (name, listener) => {
    if (name === "session/event") sessionListeners.push(listener);
    if (name === "system-prompt/assemble") assembleListeners.push(listener);
    return origOn(name, listener);
  };

  // 注册全局 persistent bash（模拟 preset 的 persistent-shell 组）
  persistentBash.apply(root, {
    backendType: "shell",
    timeoutMs: 300000,
    maxOutputChars: 16000,
    description: PERSISTENT_DESC,
  });

  // 挂载插件
  plugin.apply(root, {});

  return { root, tools, warnings, agentStore, sessionListeners, assembleListeners };
}

/** 造一个 agent：scoped ctx + session + 注册进 store。 */
function makeAgent(bootState, id, events = []) {
  const agentScope = createScope(bootState.root, id);
  const agent = {
    id,
    session: { id, events, header: {} },
    ctx: agentScope.ctx,
  };
  bootState.agentStore.set(id, agent);
  return agent;
}

/** 触发一个 tool/call session 事件（模拟首个 durable tool call：先 append 再以 (session,event) 调监听器）。 */
async function fireToolCall(bootState, session) {
  const event = { type: "tool/call", seq: session.events.length, data: {} };
  session.events.push(event); // 模拟 session.append：先写 log
  for (const listener of bootState.sessionListeners) {
    listener(session, event);
  }
  // 让 async 监听器（swap）跑完
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("首轮：agent 看到 persistent bash（仅 command 参数）", () => {
  const bootState = boot();
  const agent = makeAgent(bootState, "sess-1");
  const bash = VIEW(agent.ctx).get("bash");
  assert.ok(bash, "agent 应能看到 bash");
  assert.deepEqual(PARAM_KEYS(bash), ["command"]);
  assert.equal(bash.description, PERSISTENT_DESC);
});

test("tool/call 后 swap：agent view 显示沙箱 bash（含 sandbox_permissions）", async () => {
  const bootState = boot();
  const agent = makeAgent(bootState, "sess-1");
  // 先清空 events 使 promotion scan 从未 promote → 发 tool/call 后 promote
  await fireToolCall(bootState, agent.session);
  const bash = VIEW(agent.ctx).get("bash");
  const params = PARAM_KEYS(bash);
  assert.ok(params.includes("sandbox_permissions"), `应含 sandbox_permissions，实际: ${params.join(",")}`);
  assert.ok(params.includes("justification"), "应含 justification");
  assert.ok(params.includes("run_in_background"), "D3: 应含 run_in_background");
  assert.deepEqual(bash.parameters.properties.sandbox_permissions.enum, ["workspace-write", "danger-full-access"]);
  // 全局层 persistent bash 不受影响（未 dispose）
  assert.equal(bootState.tools.view(undefined).visible.get("bash").description, PERSISTENT_DESC);
});

test("swap 幂等：同一 session 二次 tool/call 不重复注册", async () => {
  const bootState = boot();
  const agent = makeAgent(bootState, "sess-1");
  await fireToolCall(bootState, agent.session);
  const scopedLayersAfterFirst = bootState.tools.layers.scoped.size;
  // 第二次 tool/call（新 seq）不应再次 swap
  await fireToolCall(bootState, agent.session);
  const scopedLayersAfterSecond = bootState.tools.layers.scoped.size;
  assert.equal(scopedLayersAfterFirst, scopedLayersAfterSecond);
  // 且 sandbox bash 仍可见
  assert.ok(PARAM_KEYS(VIEW(agent.ctx).get("bash")).includes("sandbox_permissions"));
});

test("per-agent 隔离：agent A swap 后 agent B 仍看 persistent bash", async () => {
  const bootState = boot();
  const agentA = makeAgent(bootState, "sess-A");
  const agentB = makeAgent(bootState, "sess-B");
  await fireToolCall(bootState, agentA.session);
  // A 已 swap → 沙箱
  assert.ok(PARAM_KEYS(VIEW(agentA.ctx).get("bash")).includes("sandbox_permissions"));
  // B 未 swap → 仍 persistent
  const bashB = VIEW(agentB.ctx).get("bash");
  assert.deepEqual(PARAM_KEYS(bashB), ["command"]);
  assert.equal(bashB.description, PERSISTENT_DESC);
});

test("includeSubagents：子代理独立 swap（各自 tool/call 后）", async () => {
  const bootState = boot();
  const parent = makeAgent(bootState, "sess-parent");
  const sub = makeAgent(bootState, "sess-sub", []);
  sub.session.header = { delegationDepth: 1 };
  // 父先 tool/call → swap 父
  await fireToolCall(bootState, parent.session);
  assert.ok(PARAM_KEYS(VIEW(parent.ctx).get("bash")).includes("sandbox_permissions"));
  // 子未 tool/call → 仍 persistent（includeSubagents: true 时子也走 bootstrap）
  const bashSub = VIEW(sub.ctx).get("bash");
  assert.deepEqual(PARAM_KEYS(bashSub), ["command"]);
  // 子 tool/call → 子也 swap
  await fireToolCall(bootState, sub.session);
  assert.ok(PARAM_KEYS(VIEW(sub.ctx).get("bash")).includes("sandbox_permissions"));
});

test("冷启动恢复：resume 已 promoted 会话时任意首个事件触发 swap", async () => {
  const bootState = boot();
  // 会话日志里已有 promotion tool/call（模拟 resume 一个已 promoted 会话）
  const preEvents = [{ type: "tool/call", seq: 5, data: {} }];
  const agent = makeAgent(bootState, "sess-resume", preEvents);
  // 只发一个非 tool/call 事件；swap 必须通过 promotion.status() 的冷扫描发现已 promoted
  const event = { type: "assistant/chunk", seq: 6, data: {} };
  agent.session.events.push(event);
  for (const listener of bootState.sessionListeners) {
    listener(agent.session, event);
  }
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const bash = VIEW(agent.ctx).get("bash");
  assert.ok(
    PARAM_KEYS(bash).includes("sandbox_permissions"),
    `resume 已 promoted 会话应冷启动即 swap，实际参数: ${PARAM_KEYS(bash).join(",")}`,
  );
});

test("失败降级：swap 抛错 → warn once + 不 rethrow + persistent 保留", async () => {
  // 不提供 sandboxPolicy → dsh-tool-bash.apply 会抛 "tool-bash: ... ctx.sandboxPolicy is missing"
  const bootState = boot("workspace-write", false);
  const agent = makeAgent(bootState, "sess-1");
  await fireToolCall(bootState, agent.session); // 不应 throw
  // warn 记录了一次（fiber 错误会先记一条 error，warnOnce 的 warn 在其后）
  assert.ok(bootState.warnings.length >= 1, "应有 warn 日志");
  assert.ok(
    bootState.warnings.some((w) => /swap to sandboxed bash failed/.test(w)),
    `应有 swap 失败 warn，实际: ${JSON.stringify(bootState.warnings)}`,
  );
  // persistent bash 保留（未 dispose，未被覆盖）
  const bash = VIEW(agent.ctx).get("bash");
  assert.deepEqual(PARAM_KEYS(bash), ["command"]);
  assert.equal(bash.description, PERSISTENT_DESC);
});

test("配置校验：未知 key / 非布尔 enableRunInBackground 在 apply 时抛错", () => {
  const bootState = boot();
  assert.throws(() => plugin.apply(bootState.root, { bogus: 1 }), /unknown config key/);
  assert.throws(() => plugin.apply(bootState.root, { enableRunInBackground: "yes" }), /must be a boolean/);
});

/* ---------------- 首轮净化：tool:* 指引 sections 过滤 ---------------- */

function assembledWithSections() {
  return {
    tools: [{ name: "bash" }],
    sections: [
      { name: "tool:read", text: "Use the read tool..." },
      { name: "tool:web_search", text: "Use the web_search tool..." },
      { name: "tool:goal", text: "Use goal tools..." },
      { name: "dsh-tui:status", text: "状态栏提示..." },
      { name: "persona", text: "You are a coding agent..." },
    ],
  };
}

async function runAssemble(bootState, agent) {
  const chain = [...bootState.assembleListeners];
  const next = async () => {
    const listener = chain.shift();
    return listener ? listener({}, { agent }, next) : assembledWithSections();
  };
  return next();
}

test("首轮净化：未 promote 时过滤 tool:* 指引 sections，promote 后放行", async () => {
  const bootState = boot();
  const agent = makeAgent(bootState, "sess-1");

  // 未 promote：tool:* 被过滤，非工具 sections 保留
  const before = await runAssemble(bootState, agent);
  const names = before.sections.map((s) => s.name);
  assert.ok(!names.some((n) => n.startsWith("tool:")), `未 promote 应过滤 tool:*，实际: ${names.join(",")}`);
  assert.ok(names.includes("dsh-tui:status"), "非 tool:* sections 应保留");
  assert.ok(names.includes("persona"), "persona section 应保留");

  // promote 后：tool:* 放行
  await fireToolCall(bootState, agent.session);
  const after = await runAssemble(bootState, agent);
  const namesAfter = after.sections.map((s) => s.name);
  assert.ok(namesAfter.includes("tool:read"), "promote 后应放行 tool:* sections");
  assert.ok(namesAfter.includes("tool:web_search"));
});

test("首轮净化：无 sections 的 assembly 原样返回", async () => {
  const bootState = boot();
  const agent = makeAgent(bootState, "sess-1");
  const chain = [...bootState.assembleListeners];
  const next = async () => ({ tools: [{ name: "bash" }], sections: [] });
  const out = await chain[0]({}, { agent }, next);
  assert.deepEqual(out.sections, []);
});
