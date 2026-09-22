/**
 * 票据 12 允许路由真实验证探针 — 对当前允许集合中的每条路由实跑一次真实 bash 工具调用。
 *
 * 运行：experiments/subagent-model-selection/run-route-probe.sh
 *   （把 ~/.dsh/settings.yaml 复制到 /tmp/dsh-ticket12 作隔离设置，再跑
 *    dsh --profile headless --patch experiments/subagent-model-selection/route-probe.patch.yml）
 *
 * 口径：探针从宿主设置服务读取允许集合本身（probe patch 行 = 部署基线当前值）；
 * 父会话用 opencode-go/deepseek-v4-flash（票据 07/08/10 M4 实测），先由真实模型发一次
 * bash 调用完成 promotion（开启会话的 30 工具形状），再逐条以子代理显式 provider/model
 * 委派一次「调用 bash 执行 echo <marker>」。断言链：子会话 header 路由 = 指定路由、
 * 子会话存在 bash tool/call、对应 tool/result 成功且回显 marker；首轮未发工具调用时
 * 最多重试一次（更严格提示），两条尝试都记入报告。某条路由失败不影响后续路由。
 *
 * 结果写 $PROBE_OUT（默认 /tmp/dsh-ticket12/route-probe.json）；全部通过退出码 0。
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import { ToolCallId, createUserMessage } from "@deepseek-ai/dsh-llm";

export const name = "ticket12-route-probe";
export const inject = [];

const PRESET = "minimal-plus";
/**
 * 父会话路由（2026-09-12 起）：opencode-go 月度额度停用后改用 commandcode 的 v4.1-flash，
 * 与 M4 基线同源，工具调用能力已验证。
 * 可用 env 覆盖（`ROUTE_PROBE_PARENT_PROVIDER` / `ROUTE_PROBE_PARENT_MODEL`）：T3 真实模型层
 * 在默认路由遇额度/传输不可用时做机制验证跑，报告会记录实际路由；不设 env 时行为不变。
 */
const PARENT = {
  provider: process.env.ROUTE_PROBE_PARENT_PROVIDER ?? "commandcode",
  model: process.env.ROUTE_PROBE_PARENT_MODEL ?? "deepseek/deepseek-v4.1-flash",
};
const MAX_ATTEMPTS = 2;
/** 首轮锚定（tool-bootstrap）只放行 bash/str_replace_editor；父会话先真发一次工具调用完成 promotion。 */
const WARMUP_PROMPT = [
  "请调用 bash 工具执行命令 echo ticket12-warmup（command 参数为 \"echo ticket12-warmup\"）。",
  "调用完成后只回复 done。",
].join("\n");
const MODEL_PARAMS = ["provider", "model"];

const routeLabel = (route) => `${route.provider}/${route.model}`;
const routeSlug = (route) => routeLabel(route).replace(/[^a-zA-Z0-9]+/g, "-");

function childPrompt(marker, attempt) {
  const args = `command="echo ${marker}"、description="Echo route probe marker"`;
  const ask =
    attempt === 1
      ? `请立刻调用 bash 工具一次，参数必须精确为 ${args}。收到工具结果后只回复 done。`
      : `上一次你没有调用工具。现在必须调用 bash 工具，且只允许这一次调用，参数必须精确为 ${args}；工具返回后回复 done。`;
  return ["这是一次允许路由能力探测任务。", ask, "必须真实调用 bash 工具，不要用文字回答代替工具调用。"].join("\n");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(100);
  }
  return false;
}

/** session/event + agent/created 采集：根 ctx 监听，父子会话事件都在这里。 */
function createFeed(ctx) {
  const logs = new Map();
  ctx.on("session/event", (session, event) => {
    const list = logs.get(session.id) ?? [];
    list.push(event);
    logs.set(session.id, list);
  });
  const eventsOf = (id) => logs.get(id) ?? [];
  return {
    eventsOf,
    catalogChildIds: (parentId) =>
      eventsOf(parentId)
        .filter((event) => event.type === "subagent/catalog")
        .map((event) => event.data?.childId)
        .filter((id) => typeof id === "string"),
    routeOf: (id) => eventsOf(id).filter((event) => event.type === "request/header").at(-1)?.data?.header?.config ?? null,
    contextOf: (id) => eventsOf(id).filter((event) => event.type === "request/context").at(-1) ?? null,
  };
}

function failureText(error) {
  if (error !== null && typeof error === "object") {
    if (typeof error.message === "string") return error.message;
    if (typeof error.name === "string") return error.name;
  }
  return String(error);
}

function resultText(result) {
  if (result.isError === true) return `ERROR: ${failureText(result.error)}`;
  if (typeof result.value === "string") return result.value;
  return (result.content ?? []).map((block) => (block.type === "text" ? block.text : "")).join("");
}

function blocksToText(blocks) {
  return (blocks ?? [])
    .map((block) => {
      if (block?.type === "text") return block.text;
      if (block?.type === "tool-result") return blocksToText(block.content);
      return "";
    })
    .join("");
}

/** 将 tool/result 事件摊平成 {callId,isError,text}（一条事件含一个 tool-result block）。 */
function toolResultsOf(events) {
  return events
    .filter((event) => event.type === "tool/result")
    .flatMap((event) =>
      (event.data?.message?.content ?? [])
        .filter((block) => block?.type === "tool-result")
        .map((block) => ({ callId: block.toolCallId, isError: block.isError === true, text: blocksToText(block.content) })),
    );
}

function turnErrorsOf(events) {
  return events
    .filter((event) => event.type === "turn/end" && event.data?.reason?.kind === "error")
    .map((event) => {
      const error = event.data.reason.error ?? {};
      return { code: error.code ?? null, status: error.status ?? null, message: error.message ?? failureText(error) };
    });
}

async function execTool(agent, name, args) {
  return agent.ctx.tools.execute({
    callId: ToolCallId(`route-probe-${randomUUID()}`),
    name,
    arguments: args,
    agent,
    signal: new AbortController().signal,
  });
}

async function schemasOf(agent) {
  const assembled = await agent.ctx.systemPrompt.assemble({ agent, scope: agent, signal: new AbortController().signal });
  return assembled.tools ?? [];
}

async function createFresh(services, label) {
  const sessionId = SessionId(`session-ticket12-${label}-${randomUUID()}`);
  const { agent } = await services.agents.create({
    sessionId,
    meta: { cwd: process.cwd() },
    agentOptions: { ...PARENT },
    setup: async (agentCtx) => {
      installModelSelection(agentCtx, { current: { ...PARENT }, assembled: undefined });
      await services.agentPresets.mount(agentCtx, PRESET);
    },
  });
  await agent.whenIdle();
  return agent;
}

function classify(subagent, childId, childRoute, toolCalls, toolResults, marker) {
  if (subagent.isError === true) return "subagent-error";
  if (childId === null) return "no-child-session";
  if (childRoute === null) return "no-route-header";
  const bashCalls = toolCalls.filter((call) => call.name === "bash");
  if (bashCalls.length === 0) return "no-tool-call";
  const executed = bashCalls.some((call) =>
    toolResults.some((entry) => entry.callId === call.callId && entry.isError !== true && entry.text.includes(marker)),
  );
  if (executed) return null;
  if (toolResults.some((entry) => entry.isError === true)) return "tool-error";
  return "marker-missing";
}

/** 对一条路由做一轮前台委派并给出该轮的可观察结果。 */
async function attemptRoute(feed, parent, route, attempt) {
  const marker = `ticket12-${routeSlug(route)}`;
  const startedAt = Date.now();
  const before = feed.catalogChildIds(parent.session.id);
  const subagent = await execTool(parent, "subagent", {
    description: `route probe ${routeLabel(route)}`,
    prompt: childPrompt(marker, attempt),
    provider: route.provider,
    model: route.model,
    run_in_background: false,
  });
  const after = feed.catalogChildIds(parent.session.id);
  const childId = after.length > before.length ? after[before.length] : null;
  if (childId !== null) await waitFor(() => feed.routeOf(childId) !== null, 15000);
  const events = childId === null ? [] : feed.eventsOf(childId);
  const childRoute = childId === null ? null : feed.routeOf(childId);
  const toolCalls = events
    .filter((event) => event.type === "tool/call")
    .map((event) => ({ name: event.data?.name, callId: event.data?.callId, arguments: event.data?.arguments }));
  const toolResults = toolResultsOf(events);
  const turnErrors = turnErrorsOf(events);
  const routeMatches = childRoute !== null && childRoute.provider === route.provider && childRoute.model === route.model;
  const failureKind = classify(subagent, childId, childRoute, toolCalls, toolResults, marker);
  return {
    attempt,
    pass: failureKind === null && routeMatches,
    failureKind: failureKind ?? (routeMatches ? null : "route-mismatch"),
    durationMs: Date.now() - startedAt,
    childId,
    childRoute,
    context: childId === null ? null : feed.contextOf(childId),
    subagentResult: { isError: subagent.isError === true, text: resultText(subagent).slice(0, 400) },
    toolCalls,
    toolResults,
    turnErrors,
    marker,
    markerSeen: toolResults.some((entry) => entry.text.includes(marker)),
  };
}

function record(report, value) {
  report.routes.push(value);
  console.log(`${value.pass ? "PASS" : "FAIL"} ${routeLabel(value.route)}${value.pass ? "" : ` (${value.attempts.at(-1).failureKind})`}`);
}

async function probeRoute(feed, parent, route) {
  const attempts = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await attemptRoute(feed, parent, route, attempt);
    attempts.push(result);
    if (result.pass) break;
    // 只有「子会话跑通但模型没发工具调用」才值得用更严格提示重试；其余失败重试成本高且不改变结论。
    if (result.failureKind !== "no-tool-call") break;
  }
  return { route: { ...route }, pass: attempts.some((attempt) => attempt.pass), attempts };
}

async function run(ctx) {
  await ctx.get("loader")?.await();
  const services = {
    agents: ctx.get("agents"),
    agentPresets: ctx.get("agentPresets"),
    subagentSettings: ctx.get("subagentModelSelection"),
  };
  for (const [key, value] of Object.entries(services)) if (value === undefined) throw new Error(`ticket12-route-probe: missing service ${key}`);
  const configured = services.subagentSettings.current();
  if (configured.enabled !== true || configured.allowedModels.length === 0)
    throw new Error(`ticket12-route-probe: model selection not enabled with routes: ${JSON.stringify(configured)}`);

  const report = { startedAt: new Date().toISOString(), parent: PARENT, allowed: configured.allowedModels, routes: [], facts: {} };
  const feed = createFeed(ctx);
  const parent = await createFresh(services, "main");

  parent.followup(createUserMessage({ content: [{ type: "text", text: WARMUP_PROMPT }], source: { kind: "user" } }));
  await parent.whenIdle();
  const tools = await schemasOf(parent);
  report.facts.promotedTools = tools.map((tool) => tool.name).sort();
  const subagentParams = Object.keys(tools.find((tool) => tool.name === "subagent")?.parameters?.properties ?? {});
  if (!MODEL_PARAMS.every((key) => subagentParams.includes(key))) throw new Error(`ticket12-route-probe: subagent lacks model params after promotion: ${JSON.stringify(subagentParams)}`);

  for (const route of configured.allowedModels) record(report, await probeRoute(feed, parent, route));

  report.finishedAt = new Date().toISOString();
  const passed = report.routes.filter((entry) => entry.pass).length;
  report.summary = `${passed}/${report.routes.length} pass`;
  writeFileSync(process.env.PROBE_OUT ?? "/tmp/dsh-ticket12/route-probe.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(`ticket12 route probe: ${report.summary}`);
  process.exit(passed === report.routes.length ? 0 : 1);
}

export function apply(ctx) {
  run(ctx).catch((error) => {
    console.error("TICKET12 ROUTE PROBE FAILED:", error);
    process.exit(1);
  });
}
