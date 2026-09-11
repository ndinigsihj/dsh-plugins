/**
 * tool-bootstrap 契约测试（真实 dsh 运行时）。
 *
 * 覆盖文档 §2.2：fresh / promoted / compaction / resume 四态 assembled.tools、
 * pre-step messages 过滤与 reject 放行、缺工具 fail-open、过滤器抛错 fail-open、
 * 配置校验入口（含 bootstrapMaxTokens 仅校验不生效）。
 *
 * 运行：node --test presets/minimal-plus-next/tool-bootstrap.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boot,
  makeAgent,
  fireToolCall,
  fireEvent,
  runAssemble,
  runPreStep,
} from "./test-helpers.mjs";

/** 待测自研插件；Phase 1 时文件尚不存在 → 本文件先红。 */
const plugin = await import("./tool-bootstrap.mjs");

const BOOTSTRAP_TOOLS = ["bash", "str_replace_editor"];

function baseAssembly() {
  return {
    tools: [
      { name: "bash" },
      { name: "str_replace_editor" },
      { name: "read" },
      { name: "web_search" },
      { name: "goal" },
    ],
    sections: [
      { name: "persona", text: "You are a helpful assistant." },
      { name: "tool:read", text: "Use the read tool..." },
      { name: "tool:web_search", text: "Use web_search..." },
    ],
  };
}

function catalogs(bootState, config = {}) {
  plugin.apply(bootState.root, {
    bootstrapTools: BOOTSTRAP_TOOLS,
    promoteOn: "tool-call",
    includeSubagents: true,
    ...config,
  });
  return bootState;
}

const toolNames = (assembly) => (assembly.tools ?? []).map((t) => t.name).sort();
const sectionNames = (assembly) => (assembly.sections ?? []).map((s) => s.name).sort();

test("fresh：未 promote 时 assembled.tools 只保留 bootstrap 对", async () => {
  const bootState = catalogs(boot());
  const agent = makeAgent(bootState, "sess-fresh");
  const out = await runAssemble(bootState, agent, baseAssembly());
  assert.deepEqual(toolNames(out), BOOTSTRAP_TOOLS.slice().sort());
  assert.deepEqual(sectionNames(out), sectionNames(baseAssembly()), "sections 不应被 tool-bootstrap 改动");
});

test("promoted：首个 tool/call 后放行全量目录", async () => {
  const bootState = catalogs(boot());
  const agent = makeAgent(bootState, "sess-promo");
  await fireToolCall(bootState, agent.session);
  const out = await runAssemble(bootState, agent, baseAssembly());
  assert.deepEqual(toolNames(out), ["bash", "str_replace_editor", "read", "web_search", "goal"].sort());
});

test("compaction 后：回到 bootstrap 对（boundary>=0 时追加 compactionTools）", async () => {
  const bootState = catalogs(boot());
  const agent = makeAgent(bootState, "sess-compact");
  await fireToolCall(bootState, agent.session);
  await fireEvent(bootState, agent.session, { type: "compaction/end", seq: 100, data: {} });
  let out = await runAssemble(bootState, agent, baseAssembly());
  assert.deepEqual(toolNames(out), BOOTSTRAP_TOOLS.slice().sort(), "compaction 后应回到 bootstrap 对");

  // compactionTools 非空时，compaction 后追加工作集
  const bootState2 = catalogs(boot(), { compactionTools: ["web_search"] });
  const agent2 = makeAgent(bootState2, "sess-compact2");
  await fireToolCall(bootState2, agent2.session);
  await fireEvent(bootState2, agent2.session, { type: "compaction/end", seq: 200, data: {} });
  out = await runAssemble(bootState2, agent2, baseAssembly());
  assert.deepEqual(toolNames(out), ["bash", "str_replace_editor", "web_search"].sort());

  // 新 durable tool/call（seq 超过边界）重新 promote → 全量
  await fireEvent(bootState2, agent2.session, { type: "tool/call", seq: 201, data: {} });
  out = await runAssemble(bootState2, agent2, baseAssembly());
  assert.deepEqual(toolNames(out), ["bash", "str_replace_editor", "read", "web_search", "goal"].sort());
});

test("resume：冷扫描已 promoted 会话 → 直接放行全量", async () => {
  const bootState = catalogs(boot());
  const agent = makeAgent(bootState, "sess-resume", [{ type: "tool/call", seq: 5, data: {} }]);
  const out = await runAssemble(bootState, agent, baseAssembly());
  assert.deepEqual(toolNames(out), ["bash", "str_replace_editor", "read", "web_search", "goal"].sort());
});

test("缺 bootstrap 工具 → fail-open 暴露全量目录（warn once）", async () => {
  const bootState = catalogs(boot());
  const agent = makeAgent(bootState, "sess-missing");
  const degraded = { tools: [{ name: "read" }, { name: "web_search" }], sections: [] };
  const out = await runAssemble(bootState, agent, degraded);
  assert.deepEqual(toolNames(out), ["read", "web_search"], "缺工具必须返回原样全量目录");
  assert.ok(
    bootState.warnings.some((w) => /bootstrap disabled, full catalog exposed/.test(w)),
    `应有 fail-open warn，实际: ${JSON.stringify(bootState.warnings)}`,
  );
});

test("过滤器抛错 → fail-open 返回原样（assemble 与 pre-step）", async () => {
  const bootState = catalogs(boot());
  const agent = makeAgent(bootState, "sess-broken");
  agent.session.snapshotEvents = () => {
    throw new TypeError("session log unavailable"); // 快照读取失败 → promotion.status 会抛错
  };
  const out = await runAssemble(bootState, agent, baseAssembly());
  assert.deepEqual(toolNames(out), toolNames(baseAssembly()), "assemble 过滤器抛错应返回原样");

  const decision = { kind: "enter", messages: [] };
  const pre = await runPreStep(bootState, agent, decision);
  assert.deepEqual(pre, decision, "pre-step 过滤器抛错应返回原样 decision");
  assert.ok(bootState.warnings.some((w) => /filter failed/.test(w)), `应有降级 warn，实际: ${JSON.stringify(bootState.warnings)}`);
});

test("pre-step：未 promote 剥掉 suppressed 源，非 suppressed 保留", async () => {
  const bootState = catalogs(boot());
  const agent = makeAgent(bootState, "sess-pre");
  const decision = {
    kind: "enter",
    messages: [
      { id: "a", role: "user", content: [], source: { kind: "agent-instructions" } },
      { id: "b", role: "user", content: [], source: { kind: "skill-catalog" } },
      { id: "c", role: "user", content: [], source: { kind: "skill-invocation", name: "pdf" } },
      { id: "d", role: "user", content: [], source: { kind: "user" } },
    ],
  };
  const out = await runPreStep(bootState, agent, decision);
  assert.deepEqual(
    out.messages.map((m) => m.id),
    ["c", "d"],
    "未 promote 应剥掉 agent-instructions/skill-catalog，保留 user 手势",
  );
});

test("pre-step：promoted 后不过滤；suppressedContextSources=[] 时始终不过滤", async () => {
  const bootState = catalogs(boot());
  const agent = makeAgent(bootState, "sess-pre-promo");
  await fireToolCall(bootState, agent.session);
  const decision = {
    kind: "enter",
    messages: [
      { id: "a", role: "user", content: [], source: { kind: "agent-instructions" } },
      { id: "b", role: "user", content: [], source: { kind: "skill-catalog" } },
    ],
  };
  const out = await runPreStep(bootState, agent, decision);
  assert.deepEqual(out.messages.map((m) => m.id), ["a", "b"], "promoted 后应放行全部注入");

  const bootState2 = catalogs(boot(), { suppressedContextSources: [] });
  const agent2 = makeAgent(bootState2, "sess-pre-empty");
  const out2 = await runPreStep(bootState2, agent2, decision);
  assert.deepEqual(out2.messages.map((m) => m.id), ["a", "b"], "显式空数组禁用上下文过滤");
});

test("pre-step：reject 决策原样放行；messages 非数组原样放行", async () => {
  const bootState = catalogs(boot());
  const agent = makeAgent(bootState, "sess-reject");
  const reject = { kind: "reject", messages: [{ id: "a", role: "user", content: [], source: { kind: "agent-instructions" } }] };
  assert.deepEqual(await runPreStep(bootState, agent, reject), reject);

  const noMessages = { kind: "enter" };
  assert.deepEqual(await runPreStep(bootState, agent, noMessages), noMessages);
});

test("配置校验：未知 key / 非法 promoteOn / 非法工具表 / 非法 maxTokens 在 apply 时抛错", () => {
  assert.throws(() => catalogs(boot(), { bogus: 1 }), /unknown config key/);
  assert.throws(() => catalogs(boot(), { promoteOn: "bogus" }), /promoteOn/);
  assert.throws(() => catalogs(boot(), { bootstrapTools: [] }), /bootstrapTools/);
  assert.throws(() => catalogs(boot(), { bootstrapMaxTokens: 0 }), /bootstrapMaxTokens/);
  assert.throws(() => catalogs(boot(), { bootstrapMaxTokens: -1 }), /bootstrapMaxTokens/);
  assert.throws(() => catalogs(boot(), { includeSubagents: "yes" }), /includeSubagents/);
  assert.throws(() => catalogs(boot(), { suppressedContextSources: [""] }), /suppressedContextSources/);
  // 本期只保留校验入口：合法 bootstrapMaxTokens 允许配置，不实现裁剪行为
  assert.doesNotThrow(() => catalogs(boot(), { bootstrapMaxTokens: 1024 }));
});