/**
 * 共享测试脚手架 — minimal-plus-next preset 契约测试的真实 dsh 运行时 boot。
 *
 * 与 phase-swap-bash.test.mjs 同款：直接加载 repo node_modules 里的
 * @deepseek-ai 运行时（cordis / dsh-scope / dsh-tools / dsh-tool-bash-persistent），
 * 不依赖已删除的 @deepseek-harness-tui/dsh-tui vendor 树。
 *
 * 运行：node --test presets/minimal-plus-next/<file>.test.mjs
 */

const { Context } = await import("@deepseek-ai/cordis");
const { createScope, scopeOf } = await import("@deepseek-ai/dsh-scope");
const { ToolRuntime } = await import("@deepseek-ai/dsh-tools");
const persistentBash = await import("@deepseek-ai/dsh-tool-bash-persistent");

export const PERSISTENT_DESC = "persistent probe bash";
export const PARAM_KEYS = (tool) => Object.keys(tool?.parameters?.properties ?? {});
export const VIEW = (agentCtx) => agentCtx.tools.view(scopeOf(agentCtx)).visible;

/** 构建一个带 host 服务 + ToolRuntime + agents 存根的根 ctx。 */
export function boot({ withSandboxPolicy = true, sandboxPolicyMode = "workspace-write" } = {}) {
  const root = new Context();
  // rc.1 dsh-tool-bash registers its guidance section with an explicit ordering
  // key, so the stub must answer getSectionOrder like the real service.
  root.provide("systemPrompt", { tools() {}, section() {}, getSectionOrder: () => 0 });
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
  root.logger.exporter({ levels: { default: 3 }, export: (msg) => warnings.push([msg.type, ...(msg.args ?? [])].join(" ")) });
  const agentStore = new Map();
  root.provide("agents", { get: (id) => agentStore.get(id) });

  // 捕获插件注册的监听器（真实 harness 用 invokeContainedSessionObservers 与
  // dispatch.waterfall 调用；测试直接按注册顺序驱动 listener 链）。
  const listeners = { session: [], assemble: [], preStep: [] };
  const origOn = root.on.bind(root);
  root.on = (name, listener) => {
    if (name === "session/event") listeners.session.push(listener);
    if (name === "system-prompt/assemble") listeners.assemble.push(listener);
    if (name === "agent/pre-step") listeners.preStep.push(listener);
    return origOn(name, listener);
  };

  // 注册全局 persistent bash（模拟 preset 的 persistent-shell 组）
  persistentBash.apply(root, {
    backendType: "shell",
    timeoutMs: 300000,
    maxOutputChars: 16000,
    description: PERSISTENT_DESC,
  });

  return { root, tools, warnings, agentStore, listeners };
}

/** Backing logs of the fake sessions — kept off the object so plugin code
 *  cannot sneak back to the removed rc.1 `session.events` array. */
const sessionLogs = new WeakMap();

/** Fake session owned by a test: rc.1 reads go through snapshotEvents(). */
export function makeSession(id, events = []) {
  const log = [...events];
  const session = {
    id,
    header: {},
    snapshotEvents: () => log,
    eventAt: (seq) => log.find((event) => event.seq === seq),
    get seq() {
      return log.length;
    },
  };
  sessionLogs.set(session, log);
  return session;
}

/** Backing log of one fake session (test bookkeeping only). */
export function sessionLog(session) {
  const log = sessionLogs.get(session);
  if (log === undefined) throw new Error("not a fake session from makeSession()");
  return log;
}

/** 造一个 agent：scoped ctx + session + 注册进 store。 */
export function makeAgent(bootState, id, events = []) {
  const agentScope = createScope(bootState.root, id);
  const agent = {
    id,
    session: makeSession(id, events),
    ctx: agentScope.ctx,
  };
  bootState.agentStore.set(id, agent);
  return agent;
}

/** 触发任意 session 事件（模拟 session.append：先写 log 再以 (session,event) 调监听器）。 */
export async function fireEvent(bootState, session, event) {
  sessionLog(session).push(event);
  for (const listener of bootState.listeners.session) {
    listener(session, event);
  }
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

/** 触发一个 tool/call session 事件（首个 durable tool call → promotion）。 */
export async function fireToolCall(bootState, session) {
  const event = { type: "tool/call", seq: sessionLog(session).length, data: {} };
  await fireEvent(bootState, session, event);
}

/**
 * 触发一个 tool/result session 事件（结算上一条 tool/call）。
 * finding 12-2 起，phase-swap-bash 的 swap 以此事件为触发点：tool/call 只 promotion、
 * 不换 schema，避免同一 step 已产出的参数被沙箱 schema 拒。
 */
export async function fireToolResult(bootState, session, callId = "call-1") {
  const event = {
    type: "tool/result",
    seq: sessionLog(session).length,
    data: { message: { content: [{ type: "tool-result", toolCallId: callId, content: [], isError: false }] } },
  };
  await fireEvent(bootState, session, event);
}

/** 以链式 next 跑 system-prompt/assemble 监听器；base 为最终底层组装结果。 */
export async function runAssemble(bootState, agent, base) {
  const chain = [...bootState.listeners.assemble];
  const next = async () => {
    const listener = chain.shift();
    return listener ? listener({}, { agent }, next) : base;
  };
  return next();
}

/** 以链式 next 跑 agent/pre-step 监听器；decision 为最终底层决策。 */
export async function runPreStep(bootState, agent, decision) {
  const chain = [...bootState.listeners.preStep];
  const signal = new AbortController().signal;
  const next = async () => {
    const listener = chain.shift();
    return listener ? listener({ agent, signal }, next) : decision;
  };
  return next();
}

/** 注册一个用于目录断言的最小假工具。 */
export function registerFakeTool(bootState, name, extra = {}) {
  bootState.root.tools.register({
    name,
    description: `fake ${name}`,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
      render: () => [],
    },
    execute: async () => ({}),
    ...extra,
  });
}