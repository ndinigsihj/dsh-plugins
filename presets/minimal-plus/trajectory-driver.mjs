/**
 * minimal-plus 轨迹实测 driver — headless 单会话，验证首个 request/header 锚定。
 *
 * 用法（由 scripts/run-trajectory.sh 或手工）：
 *   TRAJECTORY_TASK="列出当前目录" TRAJECTORY_OUT=/tmp/traj-1.json \
 *     dsh --profile headless --patch presets/minimal-plus/trajectory.patch.yml
 *
 * 与 smoke-driver 的区别：本 driver 真实调用 LLM 跑一个简单任务，然后从
 * session 事件里提取：
 *  - 首个 request/header 的 tools（应为 ['bash','str_replace_editor']）
 *  - 该请求之前 user/message 的 source.kind（bootstrap 应剥掉
 *    agent-instructions / skill-catalog / instruction-hint）
 *  - 首个 assistant/message 的首行（不应是 "Let me"/"I'll"/"我们" 式未锚定开场）
 *
 * 判定按文档 §4 #5 / Phase 3：5 会话全过 = 5/5 锚定。
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { installModelSelection } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-agent/lib/index.js";
import { SessionId } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-session/lib/index.js";
import { createUserMessage } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-llm/lib/index.js";

export const name = "liangshen-trajectory";
export const inject = [];

/** 提取一个会话的轨迹判定。 */
export function analyze(events) {
  const headerIdx = events.findIndex((event) => event.type === "request/header");
  if (headerIdx === -1) {
    return { error: "no request/header", pass: false };
  }
  const header = events[headerIdx].data.header;
  const tools = (header.tools ?? []).map((tool) => tool.name).sort();
  const before = events.slice(0, headerIdx);
  const injected = before
    .filter((event) => event.type === "user/message")
    .map((event) => event.data?.source?.kind)
    .filter((kind) => kind !== undefined && kind !== "user");
  const assistant = events.slice(headerIdx + 1).find((event) => event.type === "assistant/message");
  const text = assistant
    ? assistant.data.message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
    : "";
  const firstLine = text.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  const unanchored = /^(let me\b|i'?ll\b|i will\b|we need\b|we will\b|we'?ll\b|我来|我们)/i.test(firstLine);

  const toolsOk = JSON.stringify(tools) === JSON.stringify(["bash", "str_replace_editor"].sort());
  const injectOk = injected.length === 0;
  const openOk = !unanchored;
  return {
    tools,
    injected,
    firstLine,
    toolsOk,
    injectOk,
    openOk,
    pass: toolsOk && injectOk && openOk,
  };
}

/** 跑一个真实 LLM 会话并按 env 写结果。 */
async function run(ctx) {
  await ctx.get("loader")?.await();
  const agents = ctx.get("agents");
  const agentPresets = ctx.get("agentPresets");
  const defaultModel = ctx.get("agentDefaultModel");
  if (agents === undefined || agentPresets === undefined || defaultModel === undefined) {
    throw new Error("trajectory: missing agents/agentPresets/agentDefaultModel services");
  }
  const selection = defaultModel.currentSelection();
  const task = process.env.TRAJECTORY_TASK ?? "列出当前目录";
  const { agent } = await agents.create({
    sessionId: SessionId(`session-trajectory-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: async (agentCtx) => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined });
      await agentPresets.mount(agentCtx, "minimal-plus");
    },
  });
  await agent.whenIdle();

  agent.followup(createUserMessage({
    content: [{ type: "text", text: task }],
    source: { kind: "user" },
  }));
  await agent.whenIdle();

  const outcome = analyze(agent.session.events);
  const record = {
    task,
    provider: selection.provider,
    model: selection.model,
    sessionId: agent.session.id,
    ...outcome,
  };
  const out = process.env.TRAJECTORY_OUT;
  if (out !== undefined) {
    writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
  } else {
    console.log(JSON.stringify(record, null, 2));
  }
  process.exit(outcome.pass ? 0 : 1);
}

export function apply(ctx) {
  run(ctx).catch((error) => {
    console.error("TRAJECTORY FAILED:", error);
    process.exit(1);
  });
}