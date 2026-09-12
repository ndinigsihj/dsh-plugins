/**
 * M4 对比实验 runner（重建版）— 与历史 M4 同口径的 headless 统计批次。
 *
 * 历史 runner（m4-runner/m4-driver）已随 liangshen-plus 删除，本文件按
 * `experiments/m4/results-liangshen-bash-E-C-A-2026-08-21T17-55-50.jsonl`
 * 的记录结构重建，任务模板逐字沿用。
 *
 * 用法：
 *   M4_GROUPS=E M4_RUNS=9 M4_MODEL=commandcode/deepseek/deepseek-v4.1-flash \
 *     dsh --profile headless --patch experiments/m4/m4.patch.yml
 *
 * 每组每次：真实 LLM 完成三步任务（查看目录 → 写 probe 文件 → bash 确认），
 * 记录 firstMessage/firstToolCall/r2/header/toolSequence/error/elapsedMs。
 *
 * 2026-09-10 升级 rc.1：会话事件读取改 snapshotEvents()（events getter 已移除）；
 * 组表 E 指向开发侧组合 minimal-plus-next（旧名 liangshen-bash → minimal-plus，
 * rc.1 分叉后开发侧为 minimal-plus-next）；M4_MODEL 可显式覆盖宿主默认路由
 * （默认路由额度期时用，值必须为 provider/model，记录字段 model 反映实际路由）。
 *
 * 2026-09-11 票 05：报告默认归档到 <repo>/experiments/regression-gate/results-m4-<日期>.jsonl
 * （M4_OUT 可覆盖）；会话根由 m4.patch.yml 指向隔离目录（M4_SESSION_ROOT 可覆盖）。
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";

export const name = "m4-runner";
export const inject = [];

/** 仓库根（本文件位于 <repo>/experiments/m4/，上溯两级）。 */
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** 默认报告路径：按日归档到仓库实验目录约定下（票 05 / Q7）。 */
function defaultOutPath() {
  return join(REPO_ROOT, "experiments", "regression-gate", `results-m4-${new Date().toISOString().slice(0, 10)}.jsonl`);
}

const DEPLOYED_PRESETS = {
  E: "minimal-plus-next", // rc.1 开发侧组合；历史名 liangshen-bash → minimal-plus 后于 2026-09-10 分叉
  C: "liangshen", // 2026-09-03 已随更名删除，仅历史；重跑 C 需先恢复基线
  A: "liangshen-plus", // 历史组已删除；保留键位以便脚本兼容旧 env
};

/** 本批实际路由：默认取宿主设置，M4_MODEL=provider/model 可显式覆盖。 */
function batchSelection(defaultModel) {
  const override = (process.env.M4_MODEL ?? "").trim();
  if (override.length === 0) return defaultModel.currentSelection();
  const slash = override.indexOf("/");
  if (slash <= 0 || slash === override.length - 1) {
    throw new Error(`M4_MODEL must be "provider/model", got "${override}"`);
  }
  return { provider: override.slice(0, slash), model: override.slice(slash + 1) };
}

function taskTemplate(group, run) {
  // 工作目录取自进程 cwd（与 agents.create 的 meta.cwd 同源），换 checkout 无需改文案。
  return `你的工作目录是 ${process.cwd()}。请完成以下任务：\n1. 先查看工作目录里有哪些文件和目录；\n2. 然后创建一个文本文件 m4-probe-${group}${run}.txt，内容写 'M4 probe ${group}-${run}'；\n3. 最后用 bash 确认文件已创建并展示其内容。`;
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
  const events = agent.session.snapshotEvents(); // rc.1：按需快照，取代已移除的 events getter
  const signal = new AbortController().signal;
  const context = { agent, scope: agent, signal };
  const assembled = await agent.ctx.systemPrompt.assemble(context);
  const tools = (assembled.tools ?? []).map((tool) => tool.name).sort();
  const bash = (assembled.tools ?? []).find((tool) => tool.name === "bash");
  const bashParams = Object.keys(bash?.parameters?.properties ?? {});

  // 二轮注入从真实会话事件取：首个 tool/call（promotion）之后落盘的 user/message
  // 就是第二轮请求实际发送的注入（历史 M4 的 injectedEvents 同源）。
  const firstToolCallIdx = events.findIndex((event) => event.type === "tool/call");
  const after = firstToolCallIdx === -1 ? events : events.slice(firstToolCallIdx + 1);
  const injectedEvents = unique([
    "user",
    ...after
      .filter((event) => event.type === "user/message")
      .map((event) => event.data?.source?.kind),
  ]);

  const headers = events.filter((event) => event.type === "request/header");
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
  const selection = batchSelection(defaultModel);
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

  const events = agent.session.snapshotEvents(); // rc.1：按需快照，取代已移除的 events getter
  const first = firstAssistant(events);
  const r2 = await round2(agent);
  return {
    ts: new Date().toISOString(),
    group,
    run,
    sessionId: agent.session.id,
    preset,
    model: `${selection.provider}/${selection.model}`,
    task,
    firstMessage: { text: first.text, firstLine: first.firstLine, classification: first.classification },
    firstToolCall: first.firstToolCall,
    r2,
    toolSequence: toolSequence(events),
    // 票据 11：turn 级模型错误（额度/传输分类）显式落记录，T3 报告才不用猜「0 工具调用」的原因。
    turnErrors: events
      .filter((event) => event.type === "turn/end" && event.data?.reason?.kind === "error")
      .map((event) => ({
        turn: event.data.turn ?? null,
        code: event.data.reason.error?.code ?? null,
        message: event.data.reason.error?.message ?? null,
      })),
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
  const groups = (process.env.M4_GROUPS ?? "E").split(",").map((g) => g.trim()).filter(Boolean);
  const runs = Number(process.env.M4_RUNS ?? 9);
  const out = process.env.M4_OUT ?? defaultOutPath();
  mkdirSync(dirname(out), { recursive: true });
  console.log(`m4 report: ${out}`);

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
          sessionId: null,
          preset: DEPLOYED_PRESETS[group] ?? null,
          model: null,
          task: null,
          firstMessage: null,
          firstToolCall: null,
          r2: null,
          toolSequence: null,
          turnErrors: [],
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