/**
 * 共享测试脚手架 — liangshen-bash preset 契约测试的真实 dsh 运行时 boot。
 *
 * 与 phase-swap-bash.test.mjs 同款：直接加载 repo node_modules 里的
 * @deepseek-ai 运行时（cordis / dsh-scope / dsh-tools / dsh-tool-bash-persistent），
 * 不依赖已删除的 @deepseek-harness-tui/dsh-tui vendor 树。
 *
 * 运行：node --test presets/liangshen-bash/<file>.test.mjs
 */

const DEP = "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai";
const { Context } = await import(`${DEP}/cordis/lib/index.js`);
const { createScope, scopeOf } = await import(`${DEP}/dsh-scope/lib/index.js`);
const { ToolRuntime } = await import(`${DEP}/dsh-tools/lib/index.js`);
const persistentBash = await import(`${DEP}/dsh-tool-bash-persistent/lib/index.js`);

export const PERSISTENT_DESC = "persistent probe bash";
export const PARAM_KEYS = (tool) => Object.keys(tool?.parameters?.properties ?? {});
export const VIEW = (agentCtx) => agentCtx.tools.view(scopeOf(agentCtx)).visible;

/** 构建一个带 host 服务 + ToolRuntime + agents 存根的根 ctx。 */
export function boot({ withSandboxPolicy = true, sandboxPolicyMode = "workspace-write" } = {}) {
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

/** 造一个 agent：scoped ctx + session + 注册进 store。 */
export function makeAgent(bootState, id, events = []) {
  const agentScope = createScope(bootState.root, id);
  const agent = {
    id,
    session: { id, events, header: {} },
    ctx: agentScope.ctx,
  };
  bootState.agentStore.set(id, agent);
  return agent;
}

/** 触发任意 session 事件（模拟 session.append：先写 log 再以 (session,event) 调监听器）。 */
export async function fireEvent(bootState, session, event) {
  session.events.push(event);
  for (const listener of bootState.listeners.session) {
    listener(session, event);
  }
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

/** 触发一个 tool/call session 事件（首个 durable tool call → promotion）。 */
export async function fireToolCall(bootState, session) {
  const event = { type: "tool/call", seq: session.events.length, data: {} };
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