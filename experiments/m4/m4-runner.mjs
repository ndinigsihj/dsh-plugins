/**
 * M4 对比实验 runner（重建版）— 与历史 M4 同口径的 headless 统计批次。
 *
 * 历史 runner（m4-runner/m4-driver）已随 liangshen-plus 删除，本文件按
 * `experiments/m4/results-liangshen-bash-E-C-A-2026-08-21T17-55-50.jsonl`
 * 的记录结构重建，任务模板逐字沿用。
 *
 * 用法：
 *   M4_GROUPS=E,C M4_RUNS=9 M4_OUT=/tmp/m4-new.jsonl \
 *     dsh --profile headless --patch experiments/m4/m4.patch.yml
 *
 * 每组每次：真实 LLM 完成三步任务（查看目录 → 写 probe 文件 → bash 确认），
 * 记录 firstMessage/firstToolCall/r2/header/toolSequence/error/elapsedMs。
 */
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { installModelSelection } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-agent/lib/index.js";
import { SessionId } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-session/lib/index.js";
import { createUserMessage } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-llm/lib/index.js";

export const name = "m4-runner";
export const inject = [];

const DEPLOYED_PRESETS = {
  E: "minimal-plus",
  C: "liangshen", // 2026-09-03 已随更名删除，仅历史；重跑 C 需先恢复基线
  A: "liangshen-plus", // 历史组已删除；保留键位以便脚本兼容旧 env
};

function taskTemplate(group, run) {
  return `你的工作目录是 /Users/vito/data/dev/dsh-plugins。请完成以下任务：\n1. 先查看工作目录里有哪些文件和目录；\n2. 然后创建一个文本文件 m4-probe-${group}${run}.txt，内容写 'M4 probe ${group}-${run}'；\n3. 最后用 bash 确认文件已创建并展示其内容。`;
}

function unique(parts) {
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    if (part === undefined || part === null) continue;
    if (seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }
  return out;
}

/** 首个 assistant/message 的开场与首个工具调用。 */
function firstAssistant(events) {
  const message = events.find((event) => event.type === "assistant/message");
  if (message === undefined) {
    return { text: "", firstLine: "", classification: "none", firstToolCall: null };
  }
  const text = message.data.message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  const firstLine = text.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  const toolBlocks = message.data.message.content.filter((block) => block.type === "tool-call");
  const classification = toolBlocks.length > 0 ? "tool call" : (text.trim().length > 0 ? "text" : "none");
  const firstToolCall = toolBlocks.length > 0
    ? {
        name: toolBlocks[0].name,
        args: typeof toolBlocks[0].arguments === "string"
          ? toolBlocks[0].arguments
          : JSON.stringify(toolBlocks[0].arguments ?? {}),
        turn: message.data.turn ?? 1,
      }
    : null;
  return { text, firstLine, classification, firstToolCall };
}

/** R2（promotion 后）目录/注入/header 快照，口径对齐历史记录。 */
async function round2(agent) {
  const signal = new AbortController().signal;
  const context = { agent, scope: agent, signal };
  const assembled = await agent.ctx.systemPrompt.assemble(context);
  const tools = (assembled.tools ?? []).map((tool) => tool.name).sort();
  const bash = (assembled.tools ?? []).find((tool) => tool.name === "bash");
  const bashParams = Object.keys(bash?.parameters?.properties ?? {});

  // 二轮注入从真实会话事件取：首个 tool/call（promotion）之后落盘的 user/message
  // 就是第二轮请求实际发送的注入（历史 M4 的 injectedEvents 同源）。
  const firstToolCallIdx = agent.session.events.findIndex((event) => event.type === "tool/call");
  const after = firstToolCallIdx === -1 ? agent.session.events : agent.session.events.slice(firstToolCallIdx + 1);
  const injectedEvents = unique([
    "user",
    ...after
      .filter((event) => event.type === "user/message")
      .map((event) => event.data?.source?.kind),
  ]);

  const headers = agent.session.events.filter((event) => event.type === "request/header");
  const lastHeader = headers.at(-1);
  const headerTools = (lastHeader?.data?.header?.tools ?? []).map((tool) => tool.name).sort();
  const headerBash = (lastHeader?.data?.header?.tools ?? []).find((tool) => tool.name === "bash");
  const headerBashParams = Object.keys(headerBash?.parameters?.properties ?? {});

  return {
    assemblyTools: tools,
    assemblyBashParams: bashParams,
    bashHasSandbox: bashParams.includes("sandbox_permissions"),
    injectedEvents,
    hasAgentInstructions: injectedEvents.includes("agent-instructions"),
    hasMarker: null,
    marker: null,
    headerReason: lastHeader?.data?.reason ?? null,
    headerTools,
    headerBashParams,
  };
}

/** 按 turn 聚合全部工具调用序列。 */
function toolSequence(events) {
  const byRound = new Map();
  for (const event of events) {
    if (event.type !== "assistant/message") continue;
    const turn = event.data.turn ?? 1;
    const calls = event.data.message.content
      .filter((block) => block.type === "tool-call")
      .map((block) => block.name);
    if (calls.length === 0) continue;
    const list = byRound.get(turn) ?? [];
    list.push(...calls);
    byRound.set(turn, list);
  }
  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, calls]) => ({ round, calls }));
}

async function runOne(ctx, agents, agentPresets, defaultModel, group, run) {
  const started = Date.now();
  const preset = DEPLOYED_PRESETS[group];
  if (preset === undefined) throw new Error(`unknown group ${group}`);
  const selection = defaultModel.currentSelection();
  const { agent } = await agents.create({
    sessionId: SessionId(`session-m4-${group}${run}-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: async (agentCtx) => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined });
      await agentPresets.mount(agentCtx, preset);
    },
  });
  await agent.whenIdle();

  const task = taskTemplate(group, run);
  agent.followup(createUserMessage({
    content: [{ type: "text", text: task }],
    source: { kind: "user" },
  }));
  await agent.whenIdle();

  const first = firstAssistant(agent.session.events);
  return {
    ts: new Date().toISOString(),
    group,
    run,
    preset,
    model: `${selection.provider}/${selection.model}`,
    task,
    firstMessage: { text: first.text, firstLine: first.firstLine, classification: first.classification },
    firstToolCall: first.firstToolCall,
    r2: await round2(agent),
    toolSequence: toolSequence(agent.session.events),
    error: null,
    elapsedMs: Date.now() - started,
  };
}

async function run(ctx) {
  await ctx.get("loader")?.await();
  const agents = ctx.get("agents");
  const agentPresets = ctx.get("agentPresets");
  const defaultModel = ctx.get("agentDefaultModel");
  if (agents === undefined || agentPresets === undefined || defaultModel === undefined) {
    throw new Error("m4-runner: missing agents/agentPresets/agentDefaultModel services");
  }
  const groups = (process.env.M4_GROUPS ?? "E,C").split(",").map((g) => g.trim()).filter(Boolean);
  const runs = Number(process.env.M4_RUNS ?? 9);
  const out = process.env.M4_OUT ?? "/tmp/m4-new.jsonl";

  for (const group of groups) {
    for (let run = 1; run <= runs; run++) {
      let record;
      try {
        record = await runOne(ctx, agents, agentPresets, defaultModel, group, run);
      } catch (error) {
        record = {
          ts: new Date().toISOString(),
          group,
          run,
          preset: DEPLOYED_PRESETS[group] ?? null,
          model: null,
          task: null,
          firstMessage: null,
          firstToolCall: null,
          r2: null,
          toolSequence: null,
          error: error instanceof Error ? error.message : String(error),
          elapsedMs: null,
        };
      }
      appendFileSync(out, JSON.stringify(record) + "\n");
      console.log(`m4 ${group}${run} done: ${record.error === null ? "ok" : `error=${record.error}`}`);
    }
  }
  process.exit(0);
}

export function apply(ctx) {
  run(ctx).catch((error) => {
    console.error("M4 RUNNER FAILED:", error);
    process.exit(1);
  });
}