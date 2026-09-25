/**
 * minimal-plus smoke driver — 无 LLM 的两轮目录冒烟。
 *
 * 在 headless 组合里创建 agent 并挂载 minimal-plus preset，然后：
 *   R1. system-prompt/assemble → 首轮可见目录（应为 {bash persistent, str_replace_editor}）
 *   R1. agent/pre-step → 首轮注入（应无 agent-instructions / skill-catalog）
 *   ↳  append step/start + tool/call（promotion）→ 断言目录未变；tool/result + step/end
 *      （step 结算，同步注册）后 R2 assembly 才看到沙箱 bash（finding 12-2 多调用残留：
 *      换 schema 只发生在 step/end / turn/start，step 中途的装配不得换）
 *   R2. system-prompt/assemble → 二轮目录（bash 应带 sandbox_permissions）
 *   R2. agent/pre-step → 二轮注入（应含 agent-instructions）
 *
 * 挂载方式：boot 脚本把真源生成 0.1.7 bundle，隔离 profile 选择该 bundle（registry +
 * 声明行），本插件再由补丁插入并挂载 preset。
 * 运行：node presets/minimal-plus/smoke-boot.mjs
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";

export const name = "minimal-plus-smoke";
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
  const presetName = process.env.SMOKE_PRESET ?? "minimal-plus";
  // 载体断言（票据 07）：0.1.7 声明行真的进了 roster，且展示名来自 preset.yml。
  const roster = await agentPresets.list();
  const rosterEntry = roster.find((entry) => entry.id === presetName);
  if (rosterEntry === undefined) {
    throw new Error(`smoke: preset ${presetName} not declared (roster: ${roster.map((entry) => entry.id).join(", ") || "<empty>"})`);
  }
  if (rosterEntry.broken !== undefined) throw new Error(`smoke: preset ${presetName} failed to activate: ${rosterEntry.broken}`);
  if (typeof rosterEntry.name !== "string" || rosterEntry.name.length === 0) throw new Error(`smoke: preset ${presetName} has no display name`);
  console.log("ROSTER preset:", JSON.stringify(rosterEntry));
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

  // 首个 durable tool/call（promotion）→ step 结算（step/end）时同步 swap（finding 12-2
  // 多调用残留：一个 step 可携带多条调用，只有 step/end 之后才是安全的换 schema 点，
  // 且必须同步注册才能赶在下一次请求装配前生效）。
  // 0.1.7 会话格式 V4：事件序列必须满足 turn/step/tool 生命周期（tool/result 还要求
  // first-class message：id + role=tool + source.kind=tool + callId 对齐），否则后台
  // 持久化直接拒写。
  agent.session.append("turn/start", { turn: 1 });
  agent.session.append("step/start", { turn: 1, step: 1 });
  agent.session.append(
    "assistant/message",
    {
      stream: [],
      message: {
        id: "smoke-assistant-1",
        role: "assistant",
        source: { kind: "model" },
        content: [{ type: "tool-call", id: "smoke-1", name: "bash", arguments: "{}" }],
      },
    },
    { surfaceOp: "append" },
  );
  const callSeq = agent.session.append("tool/call", { callId: "smoke-1", name: "bash", arguments: "{}" }).seq;
  await new Promise((resolve) => setTimeout(resolve, 200));
  // step 未结束（tool/call 落盘、调用未结算）：此刻的装配不得 swap，参数仍按 persistent schema 校验
  const pending = summary(await agent.ctx.systemPrompt.assemble(context));
  console.log("ROUND1.5 catalog (pending call):", JSON.stringify(pending));
  assert.ok(!pending.bashParams.includes("sandbox_permissions"), "tool/call 未结算时不得 swap");
  agent.session.append(
    "tool/result",
    {
      message: {
        id: "smoke-result-1",
        role: "tool",
        toolCallId: "smoke-1",
        source: { kind: "tool", callId: "smoke-1" },
        content: [],
        isError: false,
      },
    },
    { surfaceOp: "append", sourceEventSeqs: [callSeq] },
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  // step 仍未结束：装配依旧不得 swap（openSteps 守卫）
  const afterResult = summary(await agent.ctx.systemPrompt.assemble(context));
  assert.ok(!afterResult.bashParams.includes("sandbox_permissions"), "step 结算前装配不得 swap");
  agent.session.append("step/end", { turn: 1, step: 1 });
  await new Promise((resolve) => setTimeout(resolve, 200));

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
