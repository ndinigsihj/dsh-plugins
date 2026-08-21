/**
 * M4 driver — §5 A/B/C/D 锚定复测实验（真实 LLM，N 跑/组）。
 *
 * 每跑 = 全新 session（避免 promotion memo 与 tool seed 串扰），同一模型
 * （agentDefaultModel 当前 selection）、同一任务模板、adapter default maxTokens。
 *
 * 组配置（preset 名 = ~/.dsh/.agent-presets 目录名）：
 *   A → liangshen-plus（三合一）
 *   B → liangshen-plus + 工作区放有实际内容的 AGENTS.md（构造注入体）
 *   C → liangshen（对照组：复现 5/5 锚定基线）
 *   D → standard-bootstrap（对照组：复现 11/11 标准行为基线）
 *   E → liangshen-bash（liangshen 全量基底 + 二轮提权 + 二轮注入；docs/liangshen-bash-preset-design.md §5.2）
 *
 * 每跑记录（§5.3）：
 *   1. 首行原文 + 分类（let me / we need / tool call / other）
 *   2. 首次 tool 调用：工具名 + 参数概要 + 轮次
 *   3. 二轮注入：扫会话 user/message 事件的 source.kind（真实请求地面真相；
 *      B 组再查唯一 marker 是否出现在 agent-instructions 文本里）
 *   4. 二轮 bash schema：是否含 sandbox_permissions / justification
 *      （assembly 快照 + request/header 双观测）
 *   5. （B 组）二轮起连续 5 轮工具序列
 *
 * env 配置：
 *   M4_GROUPS     默认 "A,B,C,D"
 *   M4_RUNS       默认 9（对齐 0/9 与 11/11 量级；锚定率达 5/5 量级可提前判过）
 *   M4_TASK       覆盖任务模板（{cwd} {group} {run} 占位符）
 *   M4_OUT        默认 experiments/m4/results-<ts>.jsonl（追加写）
 *   M4_B_WORKSPACE_ROOT 默认 /tmp/liangshen-plus-m4-workspaces
 *   M4_TIMEOUT_MS       每跑超时，默认 240000（B 组 6 轮建议 480000）
 *   M4_KEEP       1 时保留 B 组临时工作区（默认清理）
 *
 * 注意：issues #6/#11 复现实验的任务 prompt 原文不可得（§7#1），模板为 runner
 * 内置默认，A/B/C/D 四组同一模板 → 组间比较有效；绝对值口径以 C 组基线为准。
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { installModelSelection } from "/Users/vito/.dsh/profiles/endless-tui/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-agent/lib/index.js";
import { createUserMessage } from "/Users/vito/.dsh/profiles/endless-tui/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-llm/lib/index.js";
import { SessionId } from "/Users/vito/.dsh/profiles/endless-tui/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-session/lib/index.js";

export const name = "m4-driver";
export const inject = [];

const GROUP_PRESET = { A: "liangshen-plus", B: "liangshen-plus", C: "liangshen", D: "standard-bootstrap", E: "liangshen-bash" };

const DEFAULT_TASK = `你的工作目录是 {cwd}。请完成以下任务：
1. 先查看工作目录里有哪些文件和目录；
2. 然后创建一个文本文件 m4-probe-{group}{run}.txt，内容写 'M4 probe {group}-{run}'；
3. 最后用 bash 确认文件已创建并展示其内容。`;

const R2_TASK = "现在用 bash 执行 pwd 并报告输出。";
// B 组二轮起连续 5 轮（含二轮）的小任务序列
const B_ROUND_TASKS = [
  "用 bash 执行 pwd 并报告输出。",
  "列出当前工作目录的所有文件。",
  "创建一个文本文件 m4-seq-1.txt，内容写 'seq-1'。",
  "读取 m4-seq-1.txt 的内容。",
  "用 bash 执行 ls -la 并报告输出。",
];

const PER_RUN_TIMEOUT_MS = Number(process.env.M4_TIMEOUT_MS ?? 240000);

function latestHeader(agent) {
  const events = agent.session.events;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "request/header") return events[i].data;
  }
  return null;
}

function toolNames(headerData) {
  const tools = headerData?.header?.tools;
  return Array.isArray(tools) ? tools.map((t) => t.name).sort() : [];
}

function bashParams(headerData) {
  const tools = headerData?.header?.tools;
  const bash = Array.isArray(tools) ? tools.find((t) => t.name === "bash") : undefined;
  return Object.keys(bash?.parameters?.properties ?? {});
}

function classifyFirstLine(text, hasToolCall) {
  const line = (text ?? "").split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  // 首行是散文前导（含 let me / we need / I'll 等措辞）→ 非锚定；首行为空且
  // 直接出工具调用 → 锚定（"首行直接干活"）。contains 而非行首匹配：D 组实证
  // 模型会写 "I'll complete these three steps. Let me start by ..." 单段首行。
  if (/let['’]?s?\s+me|让我|我先|我来|让我看看|先让我|稍等|我先来/i.test(line)) return "let me";
  if (/we\s+(need|should|can|will|want)|我们需要|我们要|咱们|^i'?ll\b|^i\s+will\b/i.test(line)) return "we need";
  if (line === "" && hasToolCall) return "tool call";
  return "other";
}

export function apply(ctx) {
  run(ctx).catch((error) => {
    console.error("M4 DRIVER FAILED:", error);
    process.exit(1);
  });
}

async function run(ctx) {
  await ctx.get("loader")?.await();
  const agents = ctx.get("agents");
  const agentPresets = ctx.get("agentPresets");
  const defaultModel = ctx.get("agentDefaultModel");
  if (agents === undefined || agentPresets === undefined || defaultModel === undefined) {
    throw new Error("m4: missing agents/agentPresets/agentDefaultModel services");
  }

  const config = {
    groups: (process.env.M4_GROUPS ?? "A,B,C,D").split(",").map((s) => s.trim()).filter(Boolean),
    runs: Number(process.env.M4_RUNS ?? 9),
    task: process.env.M4_TASK ?? DEFAULT_TASK,
    out: process.env.M4_OUT ?? `experiments/m4/results-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
    workspaceRoot: process.env.M4_B_WORKSPACE_ROOT ?? "/tmp/liangshen-plus-m4-workspaces",
    keepWorkspace: process.env.M4_KEEP === "1",
  };

  const selection = defaultModel.currentSelection();
  console.log(`M4 config: groups=${config.groups.join(",")} runs=${config.runs} model=${selection.provider}/${selection.model}`);
  console.log(`M4 output: ${config.out}`);

  mkdirSync(join(process.cwd(), "experiments", "m4"), { recursive: true });
  if (!existsSync(config.out)) {
    appendFileSync(config.out, `# m4 experiment ts=${new Date().toISOString()} groups=${config.groups.join(",")} runs=${config.runs} model=${selection.provider}/${selection.model}\n`);
  }

  const rows = [];
  for (const group of config.groups) {
    if (!(group in GROUP_PRESET)) throw new Error(`m4: unknown group ${group}`);
    for (let run = 1; run <= config.runs; run++) {
      const row = await runOne(ctx, agents, agentPresets, selection, config, group, run);
      rows.push(row);
      appendFileSync(config.out, JSON.stringify(row) + "\n");
      console.log(`[${group}#${run}] ${row.firstMessage?.classification ?? "?"} | firstTool=${row.firstToolCall?.name ?? "-"} | toolsR2=${row.r2?.headerTools?.length ?? "?"} bashSandbox=${row.r2?.bashHasSandbox ?? "?"} injected=${JSON.stringify(row.r2?.injectedEvents ?? [])}`);
    }
  }

  printSummary(rows);
  process.exit(0);
}

async function runOne(ctx, agents, agentPresets, selection, config, group, run) {
  const row = {
    ts: new Date().toISOString(),
    group,
    run,
    preset: GROUP_PRESET[group],
    model: `${selection.provider}/${selection.model}`,
    task: config.task.replaceAll("{cwd}", process.cwd()).replaceAll("{group}", group).replaceAll("{run}", String(run)),
    firstMessage: null,
    firstToolCall: null,
    r2: null,
    toolSequence: [],
    error: null,
  };
  const started = Date.now();
  try {
    const result = await Promise.race([
      runOneInner(agents, agentPresets, selection, config, group, run),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`run timeout ${PER_RUN_TIMEOUT_MS}ms`)), PER_RUN_TIMEOUT_MS)),
    ]);
    Object.assign(row, result);
  } catch (error) {
    row.error = String(error?.stack ?? error);
  }
  row.elapsedMs = Date.now() - started;
  return row;
}

async function runOneInner(agents, agentPresets, selection, config, group, run) {
  const presetName = GROUP_PRESET[group];
  const marker = group === "B" ? `M4B-MARKER-${randomUUID()}` : null;
  const cwd = process.cwd();
  const workspace = group === "B" ? join(config.workspaceRoot, randomUUID()) : cwd;
  if (group === "B") {
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "AGENTS.md"), [
      `# M4-B Workspace（构造注入体）`,
      ``,
      `## 项目规范`,
      `- 文件命名一律使用 kebab-case。`,
      `- 所有创建的 .txt 文件内容必须包含一行版本号 \`v1\`。`,
      `- 使用 bash 时优先用 \`ls\`，避免 \`find\`。`,
      ``,
      `## 特殊标记`,
      marker,
      ``,
    ].join("\n"));
  }

  const { agent } = await agents.create({
    sessionId: SessionId(`m4-${group}-${run}-${randomUUID()}`),
    meta: { cwd: workspace },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: async (agentCtx) => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined });
      await agentPresets.mount(agentCtx, presetName);
    },
  });
  await agent.whenIdle();

  const outcome = { firstMessage: null, firstToolCall: null, r2: null, toolSequence: [], error: null };

  // ── R1：锚定任务 ────────────────────────────────────────────────
  const r1Before = agent.session.seq;
  agent.followup(createUserMessage({ content: [{ type: "text", text: rowTask(config, group, run) }], source: { kind: "user" } }));
  await agent.whenIdle();

  const events = agent.session.events;
  const r1Events = events.filter((e) => e.seq > r1Before);
  const firstAssistant = r1Events.find((e) => e.type === "assistant/message");
  const firstText = firstAssistant ? textOf(firstAssistant.data.message) : "";
  const firstToolEvent = r1Events.find((e) => e.type === "tool/call");
  outcome.firstMessage = {
    text: firstText.slice(0, 500),
    firstLine: (firstText.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "").slice(0, 120),
    classification: classifyFirstLine(firstText, firstAssistant ? hasToolCall(firstAssistant.data.message) : false),
  };
  if (firstToolEvent) {
    outcome.firstToolCall = {
      name: firstToolEvent.data.name,
      args: String(firstToolEvent.data.arguments ?? "").slice(0, 120),
      turn: firstToolEvent.data.turn ?? 1,
    };
  }

  // ── promotion 后快照（= 二轮请求将看到的状态）────────────────────
  // 注：注入的观测以会话事件为准（真实请求的 pre-step 决策消息会以
  // user/message 事件落进 session，含 source.kind=agent-instructions）——
  // 手动重跑 pre-step 瀑布不可靠：真实回合后基线已可见，compose 去重返回
  // undefined（探针实证，2026-08-20）。
  const context = { agent, scope: agent, signal: new AbortController().signal };
  const r2Assembly = await agent.ctx.systemPrompt.assemble(context);
  const injected = scanInjections(agent.session.events, r1Before, marker);
  outcome.r2 = {
    assemblyTools: (r2Assembly.tools ?? []).map((t) => t.name).sort(),
    assemblyBashParams: Object.keys((r2Assembly.tools ?? []).find((t) => t.name === "bash")?.parameters?.properties ?? {}),
    bashHasSandbox: ["sandbox_permissions", "justification"].every((k) =>
      Object.keys((r2Assembly.tools ?? []).find((t) => t.name === "bash")?.parameters?.properties ?? {}).includes(k),
    ),
    injectedEvents: injected.sources,
    hasAgentInstructions: injected.hasAgentInstructions,
    hasMarker: injected.hasMarker,
    marker,
  };

  // ── R2 及（B 组）后续轮：request/header + 工具序列 ────────────────
  const roundTasks = group === "B" ? B_ROUND_TASKS : [R2_TASK];
  for (let i = 0; i < roundTasks.length; i++) {
    const before = agent.session.seq;
    agent.followup(createUserMessage({ content: [{ type: "text", text: roundTasks[i] }], source: { kind: "user" } }));
    await agent.whenIdle();
    const roundEvents = agent.session.events.filter((e) => e.seq > before);
    const calls = roundEvents.filter((e) => e.type === "tool/call").map((e) => e.data.name);
    outcome.toolSequence.push({ round: i + 2, calls });
    if (i === 0) {
      const header = latestHeader(agent);
      outcome.r2.headerReason = header?.reason ?? null;
      outcome.r2.headerTools = toolNames(header);
      outcome.r2.headerBashParams = bashParams(header);
    }
  }

  if (group === "B" && !config.keepWorkspace) rmSync(workspace, { recursive: true, force: true });
  return outcome;
}

function rowTask(config, group, run) {
  return config.task.replaceAll("{cwd}", process.cwd()).replaceAll("{group}", group).replaceAll("{run}", String(run));
}

function textOf(message) {
  return (message?.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function hasToolCall(message) {
  return (message?.content ?? []).some((b) => b.type === "tool-call");
}

/** 扫描会话事件里的注入（user/message with source.kind），返回来源清单 + B 组 marker 命中。 */
function scanInjections(events, afterSeq, marker) {
  const sources = [];
  let hasMarker = marker === null ? null : false;
  let textAll = "";
  for (const event of events) {
    if (event.seq <= afterSeq) continue;
    if (event.type !== "user/message") continue;
    const source = event.data?.source;
    const kind = source?.kind;
    if (typeof kind === "string") sources.push(kind);
    if (hasMarker !== null && kind === "agent-instructions") {
      const c = event.data?.content;
      let text = "";
      if (typeof c === "string") text = c;
      else if (Array.isArray(c)) text = c.map((b) => (typeof b === "object" && b !== null ? b.text ?? "" : "")).join("");
      textAll += text;
    }
  }
  if (hasMarker !== null) hasMarker = textAll.includes(marker);
  return { sources, hasAgentInstructions: sources.includes("agent-instructions"), hasMarker };
}

function printSummary(rows) {
  const byGroup = new Map();
  for (const row of rows) {
    if (!byGroup.has(row.group)) byGroup.set(row.group, []);
    byGroup.get(row.group).push(row);
  }
  console.log("\n=== M4 SUMMARY ===");
  for (const [group, groupRows] of byGroup) {
    const cls = {};
    for (const r of groupRows) {
      const c = r.firstMessage?.classification ?? `error:${r.error ? "run-failed" : "?"}`;
      cls[c] = (cls[c] ?? 0) + 1;
    }
    const letMe = cls["let me"] ?? 0;
    const anchorRate = groupRows.length ? 1 - letMe / groupRows.length : 0;
    const check3 = groupRows.filter((r) => r.r2?.hasAgentInstructions).length;
    const check4 = groupRows.filter((r) => r.r2?.bashHasSandbox).length;
    console.log(`[${group}] n=${groupRows.length} classifications=${JSON.stringify(cls)} anchorRate=${(anchorRate * 100).toFixed(0)}% check3(agent-instructions)=${check3}/${groupRows.length} check4(sandbox bash)=${check4}/${groupRows.length}`);
    if (group === "B") {
      for (const r of groupRows) {
        const seq = r.toolSequence.map((t) => `R${t.round}:${t.calls.join("+") || "-"}`).join(" ");
        console.log(`  B#${r.run} marker=${r.r2?.hasMarker ? "INJECTED" : "MISSING"} seq=${seq}`);
      }
    }
    const firstLines = groupRows.map((r) => `  ${r.group}#${r.run} [${r.firstMessage?.classification ?? "?"}] ${r.firstMessage?.firstLine ?? ""}`).join("\n");
    if (firstLines) console.log(firstLines);
  }
}
