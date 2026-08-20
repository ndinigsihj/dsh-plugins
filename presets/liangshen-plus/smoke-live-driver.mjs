/**
 * liangshen-plus live smoke driver — 三轮回合真实 LLM 驱动。
 * 被 smoke-live.mjs 的 patch insert 挂载。
 */
import { randomUUID } from "node:crypto";
import { installModelSelection } from "/Users/vito/.dsh/profiles/endless-tui/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-agent/lib/index.js";
import { createUserMessage } from "/Users/vito/.dsh/profiles/endless-tui/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-llm/lib/index.js";
import { SessionId } from "/Users/vito/.dsh/profiles/endless-tui/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-session/lib/index.js";

export const name = "liangshen-plus-live-driver";
export const inject = [];

function lastText(agent) {
  let text = "";
  for (const event of agent.session.events) {
    if (event.type === "assistant/message") {
      const joined = (event.data.message.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (joined !== "") text = joined;
    }
  }
  return text.slice(0, 400);
}

async function turn(agent, task, label) {
  const before = agent.session.seq;
  agent.followup(createUserMessage({ content: [{ type: "text", text: task }], source: { kind: "user" } }));
  await agent.whenIdle();
  // 收集该轮工具调用
  const calls = [];
  for (const event of agent.session.events) {
    if (event.seq >= before && event.type === "tool/call") {
      calls.push(`${event.data.name}:${JSON.stringify(event.data.arguments ?? {}).slice(0, 60)}`);
    }
  }
  console.log(`[${label}] tools-called: ${JSON.stringify(calls)}`);
  console.log(`[${label}] reply: ${JSON.stringify(lastText(agent).replace(/\n/g, " ").slice(0, 300))}`);
}

export function apply(ctx) {
  run(ctx).catch((error) => {
    console.error("LIVE DRIVER FAILED:", error);
    process.exit(1);
  });
}

async function run(ctx) {
  await ctx.get("loader")?.await();
  const agents = ctx.get("agents");
  const agentPresets = ctx.get("agentPresets");
  const defaultModel = ctx.get("agentDefaultModel");
  if (!agents || !agentPresets || !defaultModel) throw new Error("missing services");
  const selection = defaultModel.currentSelection();
  const { agent } = await agents.create({
    sessionId: SessionId(`session-live-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: async (agentCtx) => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined });
      await agentPresets.mount(agentCtx, "liangshen-plus");
    },
  });
  await agent.whenIdle();

  console.log("=== R1: 首轮（禁止工具）===");
  await turn(agent, "不要调用任何工具，直接文字回答：你现在有哪些可用工具？", "R1");

  console.log("=== R2: 触发 promotion（调用 bash）===");
  await turn(agent, "用 bash 执行：pwd && git log --oneline -2", "R2");

  console.log("=== R3: 二轮（禁止工具）===");
  await turn(agent, "不要调用任何工具，直接文字回答：现在你有哪些可用工具？bash 工具的参数有哪些？", "R3");

  process.exit(0);
}
