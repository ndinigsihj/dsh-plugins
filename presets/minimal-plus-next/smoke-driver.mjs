/**
 * minimal-plus-next smoke driver — 无 LLM 的两轮目录冒烟。
 *
 * 在 headless 组合里创建 agent 并挂载 minimal-plus-next preset，然后：
 *   R1. system-prompt/assemble → 首轮可见目录（应为 {bash persistent, str_replace_editor}）
 *   R1. agent/pre-step → 首轮注入（应无 agent-instructions / skill-catalog）
 *   ↳  append tool/call（promotion）→ phase-swap-bash 对该 agent swap
 *   R2. system-prompt/assemble → 二轮目录（bash 应带 sandbox_permissions）
 *   R2. agent/pre-step → 二轮注入（应含 agent-instructions）
 *
 * 挂载方式：由 boot 脚本通过 patch insert 本插件 + agent-presets 行。
 * 运行：node presets/minimal-plus-next/smoke-boot.mjs
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { installModelSelection } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-agent/lib/index.js";
import { SessionId } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-session/lib/index.js";

export const name = "minimal-plus-next-smoke";
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
  const presetName = process.env.SMOKE_PRESET ?? "minimal-plus-next";
  console.log(`SMOKE preset: ${presetName}`);
  const { agent } = await agents.create({
    sessionId: SessionId(`session-smoke-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: async (agentCtx) => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined });
      await agentPresets.mount(agentCtx, presetName);
    },
  });
  await agent.whenIdle();

  const context = { agent, scope: agent, signal: new AbortController().signal };

  // 捕获 warn（swap 失败会 warnOnce）
  const warnings = [];
  ctx.logger.exporter({ levels: { default: 3 }, export: (msg) => warnings.push([msg.type, ...(msg.args ?? [])].join(" ")) });

  // R1 assembly（目录）
  const r1 = await agent.ctx.systemPrompt.assemble(context);
  const s1 = summary(r1);
  console.log("ROUND1 catalog:", JSON.stringify(s1));
  assert.ok(s1.tools.includes("bash"), "R1 must expose bash");
  assert.ok(s1.tools.includes("str_replace_editor"), "R1 must expose str_replace_editor");
  assert.ok(!s1.bashParams.includes("sandbox_permissions"), "R1 persistent bash must not expose sandbox_permissions");

  // R1 pre-step（注入）
  const r1Pre = await agent.dispatch.waterfall(
    "agent/pre-step",
    { agent, messages: [], signal: context.signal },
    () => Promise.resolve({ kind: "enter", messages: [] }),
  );
  const r1Sources = (r1Pre.messages ?? []).map((m) => m.source?.kind);
  console.log("ROUND1 pre-step sources:", JSON.stringify(r1Sources));
  assert.ok(!r1Sources.includes("agent-instructions"), "R1 must not inject agent-instructions");
  assert.ok(!r1Sources.includes("skill-catalog"), "R1 must not inject skill-catalog");

  // 首个 durable tool/call（promotion）→ swap
  agent.session.append("tool/call", { callId: "smoke-1", name: "bash", arguments: "{}" });
  await new Promise((resolve) => setTimeout(resolve, 500));

  // R2 assembly（swap 结果以 R2 目录为准：bash 应为沙箱 schema）
  const r2 = await agent.ctx.systemPrompt.assemble(context);
  const s2 = summary(r2);
  console.log("ROUND2 catalog:", JSON.stringify(s2));
  console.log("WARNINGS:", JSON.stringify(warnings));
  assert.ok(s2.tools.includes("bash"), "R2 must expose bash");
  assert.ok(s2.tools.includes("str_replace_editor"), "R2 must expose str_replace_editor");
  assert.ok(s2.bashParams.includes("sandbox_permissions"), "R2 sandbox bash must expose sandbox_permissions");
  assert.ok(s2.tools.includes("skill_search"), "R2 must expose skill_search (skill-search row)");
  assert.ok(s2.tools.includes("skill_load"), "R2 must expose skill_load (skill-search row)");

  // R2 pre-step（注入恢复）
  const r2Pre = await agent.dispatch.waterfall(
    "agent/pre-step",
    { agent, messages: [], signal: context.signal },
    () => Promise.resolve({ kind: "enter", messages: [] }),
  );
  const r2Sources = (r2Pre.messages ?? []).map((m) => m.source?.kind);
  console.log("ROUND2 pre-step sources:", JSON.stringify(r2Sources));
  assert.ok(r2Sources.includes("agent-instructions"), "R2 must inject agent-instructions");
  assert.ok(r2Sources.includes("instruction-hint"), "R2 must inject instruction-hint (self-hosted)");
  assert.ok(r2Sources.includes("skill-catalog"), "R2 host must resume skill-catalog after promotion (design: host layer restores it)");
  console.log("WARNINGS:", JSON.stringify(warnings));

  process.exit(0);
}
