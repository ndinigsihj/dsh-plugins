/**
 * 票据 11 行为探针 — 官方子代理模型选择（rc.1）在 minimal-plus-next + 开启基线下的实跑验收。
 *
 * 运行：experiments/subagent-model-selection/run.sh
 *   （预置 /tmp/dsh-ticket11/settings.yaml 副本 + 旧会话副本，再跑
 *    dsh --profile headless --patch experiments/subagent-model-selection/probe.patch.yml）
 *
 * 覆盖票据 11 的 12 条验收：宿主设置服务与部署基线、开启后的委派 schema、发现工具、
 * 显式 provider/model、显式 reasoning effort、省略时继承父路由、子会话继承策略、
 * 事后编辑设置不改写已记录策略、旧会话保持关闭、集合外路由无法选定、fork 同路由且
 * 不参与选择、工具名与两种上下文来源语义不变。
 *
 * 结果写 $PROBE_OUT（默认 /tmp/dsh-ticket11/probe.json）；全 PASS 退出码 0。
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { installModelSelection } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-agent/lib/index.js";
import { SessionId } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-session/lib/index.js";
import { ToolCallId, createUserMessage } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-llm/lib/index.js";

export const name = "ticket11-probe";
export const inject = [];

const PRESET = "minimal-plus-next";
/** 父会话路由：票据 07/08/10 M4 批次同源，工具调用能力已验证。 */
const PARENT = { provider: "opencode-go", model: "deepseek-v4-flash" };
/** 探针部署基线（与 ~/.dsh/profiles/tui-dev/cordis.patch.yml 逐字段一致）。 */
const ALLOWED_X = [
  { provider: "opencode-go", model: "deepseek-v4-flash" },
  { provider: "commandcode", model: "deepseek/deepseek-v4-flash" },
  { provider: "deepseek-official", model: "deepseek-v4-flash" },
  { provider: "opencode-go", model: "deepseek-flash" },
];
/** 事后编辑到用户层的集合：与 X 不相交，便于区分"已记录"与"当前设置"。 */
const SETTINGS_Y = { enabled: true, allowedModels: [{ provider: "gjx", model: "gpt-5.6-sol" }] };
const EXPLICIT = { provider: "opencode-go", model: "deepseek-flash", reasoning_effort: "low" };
const FORBIDDEN = { provider: "volcengine", model: "deepseek-v4-flash-ga-260731" };
const MODEL_PARAMS = ["provider", "model", "reasoning_effort"];
const CHILD_PROMPT = "Reply with exactly: OK";
/** 首轮锚定（tool-bootstrap）只放行 bash/str_replace_editor；先让模型真发一次工具调用完成 promotion。 */
const WARMUP_PROMPT = [
  "请调用 bash 工具执行命令 echo ticket11-warmup（command 参数为 \"echo ticket11-warmup\"）。",
  "调用完成后只回复 done。",
].join("\n");
const COMPLIANCE_PROMPT = [
  "请调用 subagent 工具做一次委派，参数必须精确如下（不要增加也不要修改）：",
  '- description: "route probe"',
  `- prompt: "${CHILD_PROMPT}"`,
  `- provider: "${EXPLICIT.provider}"`,
  `- model: "${EXPLICIT.model}"`,
  `- reasoning_effort: "${EXPLICIT.reasoning_effort}"`,
  "- run_in_background: false",
  "调用完成后只回复 done。",
].join("\n");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const routeKey = (route) => `${route.provider}\u0000${route.model}`;
const routesEqual = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.map(routeKey).join(",") === b.map(routeKey).join(",");

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
    policyOf: (id) => eventsOf(id).find((event) => event.type === "subagent/model-selection-policy")?.data?.allowedModels ?? null,
    routeOf: (id) => eventsOf(id).filter((event) => event.type === "request/header").at(-1)?.data?.header?.config ?? null,
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

async function execTool(agent, name, args) {
  return agent.ctx.tools.execute({
    callId: ToolCallId(`probe-${randomUUID()}`),
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

const toolOf = (tools, name) => tools.find((tool) => tool.name === name);
const paramsOf = (tools, name) => Object.keys(toolOf(tools, name)?.parameters?.properties ?? {});

/** 一次前台委派：返回工具结果与父会话新登记的 childId。 */
async function delegate(feed, agent, tool, args) {
  const before = feed.catalogChildIds(agent.session.id);
  const result = await execTool(agent, tool, { description: "ticket11 probe", prompt: CHILD_PROMPT, run_in_background: false, ...args });
  const after = feed.catalogChildIds(agent.session.id);
  return { result, childId: after.length > before.length ? after[before.length] : null };
}

async function createFresh(services, label) {
  const sessionId = SessionId(`session-ticket11-${label}-${randomUUID()}`);
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

function record(report, id, pass, detail) {
  report.checks.push({ id, pass: pass === true, detail });
  console.log(`${pass === true ? "PASS" : "FAIL"} ${id}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
}

/** 首轮锚定前置：真实模型发一次 bash 工具调用 → promotion，之后才看得到完整目录。 */
async function warmUp(report, agent) {
  agent.followup(createUserMessage({ content: [{ type: "text", text: WARMUP_PROMPT }], source: { kind: "user" } }));
  await agent.whenIdle();
  const tools = (await schemasOf(agent)).map((tool) => tool.name);
  record(report, "a00-promotion-precondition", tools.length > 2, { count: tools.length, tools });
}

/** 票 1：设置服务在宿主作用域，且部署基线 = enabled + 4 条允许路由。 */
function checkHostService(report, subagentSettings) {
  const current = subagentSettings.current();
  record(report, "a1-host-service-mounted", current.enabled === true && routesEqual(current.allowedModels, ALLOWED_X), current);
  report.facts.baseline = current;
}

/** 票 2/3/12：开启后的委派 schema、发现工具、工具名与两种上下文来源语义。 */
function checkSchema(report, tools) {
  const subagent = toolOf(tools, "subagent");
  const fork = toolOf(tools, "subagent_fork");
  const subagentParams = paramsOf(tools, "subagent");
  const forkParams = paramsOf(tools, "subagent_fork");
  report.facts.assembledTools = tools.map((tool) => tool.name).sort();
  record(report, "a2-preset-model-selection-schema", MODEL_PARAMS.every((key) => subagentParams.includes(key)), { subagentParams });
  record(report, "a3-discovery-tool-visible", toolOf(tools, "list_subagent_models") !== undefined, {
    count: tools.length,
    tools: report.facts.assembledTools,
  });
  record(
    report,
    "a13-tool-names-and-context-sources",
    subagent !== undefined &&
      fork !== undefined &&
      subagent.description.includes("it does not see this conversation") &&
      fork.description.includes("inherits this conversation") &&
      !MODEL_PARAMS.some((key) => forkParams.includes(key)),
    { subagentParams, forkParams, forkDescription: fork?.description?.slice(0, 80) },
  );
}

/** 票 3 + 票 10（发现侧）：按 provider 列模型 / 集合外 provider 被拒。 */
async function checkDiscovery(report, agent) {
  const providers = await execTool(agent, "list_subagent_models", {});
  const opencode = await execTool(agent, "list_subagent_models", { provider: "opencode-go" });
  const commandcode = await execTool(agent, "list_subagent_models", { provider: "commandcode" });
  const outside = await execTool(agent, "list_subagent_models", { provider: "volcengine" });
  const providersText = resultText(providers);
  const opencodeText = resultText(opencode);
  const commandcodeText = resultText(commandcode);
  const outsideText = resultText(outside);
  record(
    report,
    "a4-discovery-by-provider",
    ["opencode-go", "commandcode", "deepseek-official"].every((id) => providersText.includes(id)) &&
      !providersText.includes("volcengine") &&
      opencodeText.includes("opencode-go/deepseek-v4-flash") &&
      opencodeText.includes("opencode-go/deepseek-flash") &&
      !opencodeText.includes("muse-spark") &&
      commandcodeText.includes("commandcode/deepseek/deepseek-v4-flash") &&
      outside.isError === true &&
      outsideText.includes("not allowed"),
    { providersText, opencodeText, commandcodeText, outsideText },
  );
}

/** 票 4/5/7：显式路由 + 显式 effort 生效；子会话继承已记录策略。 */
async function checkExplicit(report, feed, agent) {
  const { result, childId } = await delegate(feed, agent, "subagent", EXPLICIT);
  const route = childId === null ? null : feed.routeOf(childId);
  const policy = childId === null ? null : feed.policyOf(childId);
  record(report, "a5-explicit-route-used", childId !== null && route?.provider === EXPLICIT.provider && route?.model === EXPLICIT.model, {
    childId,
    route,
    result: resultText(result).slice(0, 120),
  });
  record(report, "a6-explicit-effort-used", route?.reasoningEffort === EXPLICIT.reasoning_effort, { childId, effort: route?.reasoningEffort });
  record(report, "a8-child-inherits-policy", routesEqual(policy, ALLOWED_X), { childId, policy });
}

/** 票 6：省略路由 → 子代理继承调用方路由（含 reasoning effort，票据 11 L16 口径）。 */
async function checkInheritance(report, feed, agent) {
  const parentRoute = feed.routeOf(agent.session.id);
  const { childId } = await delegate(feed, agent, "subagent", {});
  const route = childId === null ? null : feed.routeOf(childId);
  record(
    report,
    "a7-omitted-route-inherits",
    childId !== null &&
      route?.provider === parentRoute?.provider &&
      route?.model === parentRoute?.model &&
      route?.reasoningEffort === parentRoute?.reasoningEffort,
    { childId, parentRoute, childRoute: route },
  );
}

/** 票 10：集合外路由在创建前被拒，且不产生子会话。 */
async function checkForbidden(report, feed, agent) {
  const { result, childId } = await delegate(feed, agent, "subagent", FORBIDDEN);
  const text = resultText(result);
  record(report, "a11-forbidden-route-rejected", result.isError === true && text.includes("not allowed") && childId === null, {
    childId,
    text: text.slice(0, 160),
  });
}

/** 票 11：fork 工具无模型字段，fork 子代理与父会话同路由。 */
async function checkFork(report, feed, agent) {
  const parentRoute = feed.routeOf(agent.session.id);
  const { result, childId } = await delegate(feed, agent, "subagent_fork", {});
  const route = childId === null ? null : feed.routeOf(childId);
  record(
    report,
    "a12-fork-same-route-no-selection",
    childId !== null && route?.provider === parentRoute?.provider && route?.model === parentRoute?.model,
    { childId, parentRoute, forkRoute: route, result: resultText(result).slice(0, 120) },
  );
}

/** 票 8：设置编辑后新会话用新集合；已记录策略的会话不被改写。 */
async function checkSettingsEdit(report, services, feed, agent) {
  const before = services.settings.describe().find((descriptor) => descriptor.ns === "subagent-model-selection");
  await services.settings.update("subagent-model-selection", SETTINGS_Y);
  const published = await waitFor(() => routesEqual(services.subagentSettings.current().allowedModels, SETTINGS_Y.allowedModels), 5000);
  const fresh = await createFresh(services, "post-edit");
  const newPolicy = feed.policyOf(fresh.session.id);
  const oldPolicy = feed.policyOf(agent.session.id);
  const freshListY = resultText(await execTool(fresh, "list_subagent_models", { provider: "gjx" }));
  const freshListX = resultText(await execTool(fresh, "list_subagent_models", { provider: "opencode-go" }));
  const stale = await delegate(feed, agent, "subagent", { provider: "gjx", model: "gpt-5.6-sol" });
  const staleText = resultText(stale.result);
  record(
    report,
    "a9-settings-edit-does-not-rewrite",
    published &&
      routesEqual(newPolicy, SETTINGS_Y.allowedModels) &&
      routesEqual(oldPolicy, ALLOWED_X) &&
      freshListY.includes("gjx/gpt-5.6-sol") &&
      freshListX.startsWith("ERROR") &&
      stale.result.isError === true &&
      staleText.includes("not allowed") &&
      stale.childId === null,
    { before: { base: before?.base, user: before?.user }, published, newPolicy, oldPolicy, freshListY, freshListX, staleText: staleText.slice(0, 160) },
  );
  return fresh;
}

/** 票 9：没有记录策略的旧会话（票据 10 的 M4 会话副本）恢复后能力保持关闭。 */
async function checkOldSession(report, services, oldSessionId) {
  const { agent, dispose } = await services.agents.resume({
    resumeSessionId: SessionId(oldSessionId),
    agentOptions: { ...PARENT },
    setup: async (agentCtx) => {
      installModelSelection(agentCtx, { current: { ...PARENT }, assembled: undefined });
      await services.agentPresets.mount(agentCtx, PRESET);
    },
  });
  const tools = await schemasOf(agent);
  const params = paramsOf(tools, "subagent");
  record(
    report,
    "a10-old-session-stays-off",
    toolOf(tools, "list_subagent_models") === undefined && !MODEL_PARAMS.some((key) => params.includes(key)),
    { oldSessionId, count: tools.length, subagentParams: params },
  );
  await dispose();
}

/** 真实模型路径：模型自己按 schema 指定 provider/model/effort 并实际生效。 */
async function checkModelCompliance(report, feed, agent) {
  const before = feed.catalogChildIds(agent.session.id).length;
  agent.followup(createUserMessage({ content: [{ type: "text", text: COMPLIANCE_PROMPT }], source: { kind: "user" } }));
  await agent.whenIdle();
  const childId = feed.catalogChildIds(agent.session.id)[before] ?? null;
  await waitFor(() => childId !== null && feed.routeOf(childId) !== null, 15000);
  const route = childId === null ? null : feed.routeOf(childId);
  const call = feed.eventsOf(agent.session.id).filter((event) => event.type === "tool/call" && event.data?.name === "subagent").at(-1);
  record(
    report,
    "a14-model-driven-selection",
    childId !== null && route?.provider === EXPLICIT.provider && route?.model === EXPLICIT.model && route?.reasoningEffort === EXPLICIT.reasoning_effort,
    { childId, route, call: call?.data?.arguments ?? call?.data?.args ?? null },
  );
}

async function run(ctx) {
  await ctx.get("loader")?.await();
  const services = {
    agents: ctx.get("agents"),
    agentPresets: ctx.get("agentPresets"),
    settings: ctx.get("settings"),
    subagentSettings: ctx.get("subagentModelSelection"),
  };
  for (const [key, value] of Object.entries(services)) if (value === undefined) throw new Error(`ticket11-probe: missing service ${key}`);
  const oldSessionId = process.env.PROBE_OLD_SESSION_ID;
  if (oldSessionId === undefined || oldSessionId.length === 0) throw new Error("ticket11-probe: PROBE_OLD_SESSION_ID is required (see run.sh)");

  const report = { startedAt: new Date().toISOString(), parent: PARENT, allowedX: ALLOWED_X, checks: [], facts: {} };
  const feed = createFeed(ctx);

  checkHostService(report, services.subagentSettings);
  const agent = await createFresh(services, "main");
  await warmUp(report, agent);
  const tools = await schemasOf(agent);
  checkSchema(report, tools);
  record(report, "a0-session-records-policy", routesEqual(feed.policyOf(agent.session.id), ALLOWED_X), {
    policy: feed.policyOf(agent.session.id),
    parentRoute: feed.routeOf(agent.session.id),
  });
  await checkDiscovery(report, agent);
  await checkExplicit(report, feed, agent);
  await checkInheritance(report, feed, agent);
  await checkForbidden(report, feed, agent);
  await checkFork(report, feed, agent);
  await checkModelCompliance(report, feed, agent);
  await checkSettingsEdit(report, services, feed, agent);
  await checkOldSession(report, services, oldSessionId);

  report.finishedAt = new Date().toISOString();
  const passed = report.checks.filter((check) => check.pass).length;
  report.summary = `${passed}/${report.checks.length} pass`;
  writeFileSync(process.env.PROBE_OUT ?? "/tmp/dsh-ticket11/probe.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(`ticket11 probe: ${report.summary}`);
  process.exit(passed === report.checks.length ? 0 : 1);
}

export function apply(ctx) {
  run(ctx).catch((error) => {
    console.error("TICKET11 PROBE FAILED:", error);
    process.exit(1);
  });
}
