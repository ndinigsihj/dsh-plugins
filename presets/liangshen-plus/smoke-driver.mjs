/**
 * liangshen-plus smoke driver — 无 LLM 的两轮目录冒烟。
 *
 * 在 headless 组合里创建 agent 并挂载 liangshen-plus preset，然后：
 *   R1. system-prompt/assemble → 首轮可见目录（应为 {bash persistent, str_replace_editor}）
 *   R1. agent/pre-step → 首轮注入（应无 agent-instructions / skill-catalog）
 *   ↳  append tool/call（promotion）→ phase-swap-bash 对该 agent swap
 *   R2. system-prompt/assemble → 二轮目录（bash 应带 sandbox_permissions）
 *   R2. agent/pre-step → 二轮注入（应含 agent-instructions）
 *
 * 挂载方式：由 boot 脚本通过 patch insert 本插件 + agent-presets 行。
 * 运行：node scripts/liangshen-plus-smoke.mjs（见文件头注释）
 */
import { randomUUID } from "node:crypto";
import { installModelSelection } from "/Users/vito/.dsh/profiles/endless-tui/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-agent/lib/index.js";
import { SessionId } from "/Users/vito/.dsh/profiles/endless-tui/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-session/lib/index.js";

export const name = "liangshen-plus-smoke";
export const inject = [];

function summary(assembly) {
  return {
    tools: (assembly.tools ?? []).map((t) => t.name).sort(),
    bashParams: Object.keys(
      (assembly.tools ?? []).find((t) => t.name === "bash")?.parameters?.properties ?? {},
    ),
    contexts: (assembly.contexts ?? []).map((c) => c.name),
    sections: (assembly.sections ?? []).map((s) => s.name),
  };
}

export function apply(ctx) {
  run(ctx).catch((error) => {
    console.error("SMOKE FAILED:", error);
    process.exit(1);
  });
}

async function run(ctx) {
  await ctx.get("loader")?.await();
  const agents = ctx.get("agents");
  const agentPresets = ctx.get("agentPresets");
  const defaultModel = ctx.get("agentDefaultModel");
  if (agents === undefined || agentPresets === undefined || defaultModel === undefined) {
    throw new Error("smoke: missing agents/agentPresets/agentDefaultModel services");
  }
  const selection = defaultModel.currentSelection();
  const { agent } = await agents.create({
    sessionId: SessionId(`session-smoke-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: async (agentCtx) => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined });
      await agentPresets.mount(agentCtx, "liangshen-plus");
    },
  });
  await agent.whenIdle();

  const context = { agent, scope: agent, signal: new AbortController().signal };

  // 捕获 warn（swap 失败会 warnOnce）
  const warnings = [];
  ctx.logger.exporter({ levels: { default: 3 }, export: (msg) => warnings.push([msg.type, ...(msg.args ?? [])].join(" ")) });

  // R1 assembly（目录）
  const r1 = await agent.ctx.systemPrompt.assemble(context);
  console.log("ROUND1 catalog:", JSON.stringify(summary(r1)));

  // R1 pre-step（注入）
  const r1Pre = await agent.dispatch.waterfall(
    "agent/pre-step",
    { agent, messages: [], signal: context.signal },
    () => Promise.resolve({ kind: "enter", messages: [] }),
  );
  console.log("ROUND1 pre-step sources:", JSON.stringify((r1Pre.messages ?? []).map((m) => m.source?.kind)));

  // 首个 durable tool/call（promotion）→ swap
  agent.session.append("tool/call", { callId: "smoke-1", name: "bash", arguments: "{}" });
  await new Promise((resolve) => setTimeout(resolve, 500));

  // R2 assembly（swap 结果以 R2 目录为准：bash 应为沙箱 schema）
  const r2 = await agent.ctx.systemPrompt.assemble(context);
  console.log("ROUND2 catalog:", JSON.stringify(summary(r2)));

  // R2 pre-step（注入恢复）
  const r2Pre = await agent.dispatch.waterfall(
    "agent/pre-step",
    { agent, messages: [], signal: context.signal },
    () => Promise.resolve({ kind: "enter", messages: [] }),
  );
  console.log("ROUND2 pre-step sources:", JSON.stringify((r2Pre.messages ?? []).map((m) => m.source?.kind)));
  console.log("WARNINGS:", JSON.stringify(warnings));

  process.exit(0);
}
