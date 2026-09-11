/**
 * skill-search 契约测试（真实 dsh 运行时）。
 *
 * 覆盖文档 §2.4：两个工具注册形状（名称/描述/参数/schema 逐字）、查询匹配/
 * 空查询/上限、load 未命中/命中注入形状、失败降级。
 *
 * 运行：node --test presets/minimal-plus-next/skill-search.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, makeAgent } from "./test-helpers.mjs";

/** 待测自研插件；Phase 1 时文件尚不存在 → 本文件先红。 */
const plugin = await import("./skill-search.mjs");

const SEARCH_DESCRIPTION =
  'Search the available skills by keyword and return matching skill names with short descriptions. This session keeps NO skill catalog in the prompt — if a task looks like it matches a skill (document conversion, image processing, game reviews, markdown, PDF, spreadsheets, …), call skill_search FIRST to find it, then skill_load to activate it. Do NOT assume skill names from memory.';
const LOAD_DESCRIPTION =
  'Load the full instructions of ONE skill by its exact name (from skill_search results) and inject them for the next request. Call this before acting on a task that matches the skill.';

const SEARCH_SCHEMA = {
  type: "object",
  properties: { query: { type: "string", description: "search keywords (e.g. \"pdf\", \"obsidian\", \"game review\")" } },
  required: ["query"],
  additionalProperties: false,
};

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { text: { type: "string" } },
  required: ["text"],
};

function bootWithPlugin(skills) {
  const bootState = boot();
  bootState.root.provide("skills", skills);
  plugin.apply(bootState.root);
  return bootState;
}

function visibleTools(bootState) {
  return bootState.tools.view(undefined).visible;
}

function execContext(agent) {
  return { agent, signal: new AbortController().signal };
}

test("注册形状：skill_search / skill_load 名称、描述、参数与输出 schema 逐字一致", () => {
  const bootState = bootWithPlugin({ list: async () => [], get: async () => ({}) });
  const tools = visibleTools(bootState);
  const search = tools.get("skill_search");
  const load = tools.get("skill_load");
  assert.ok(search, "应注册 skill_search");
  assert.ok(load, "应注册 skill_load");
  assert.equal(search.description, SEARCH_DESCRIPTION);
  assert.deepEqual(search.parameters, SEARCH_SCHEMA);
  assert.deepEqual(search.output.schema, OUTPUT_SCHEMA);
  assert.equal(load.description, LOAD_DESCRIPTION);
  assert.deepEqual(load.parameters, {
    type: "object",
    properties: { name: { type: "string", description: "exact skill name (kebab-case, from skill_search)" } },
    required: ["name"],
    additionalProperties: false,
  });
  assert.deepEqual(load.output.schema, OUTPUT_SCHEMA);
});

test("skill_search：token 全匹配、空查询返回全部、大小写不敏感", async () => {
  const skills = [
    { name: "pdf-tools", description: "Convert documents to PDF", whenToUse: "When handling PDF files" },
    { name: "markdown", description: "Write markdown files", whenToUse: "docs" },
    { name: "game-review", description: "Write game reviews", whenToUse: "reviews" },
  ];
  const bootState = bootWithPlugin({ list: async () => skills, get: async () => ({}) });
  const search = visibleTools(bootState).get("skill_search");
  const agent = makeAgent(bootState, "sess-search");
  agent.session.header = { cwd: process.cwd() };

  const hit = await search.execute({ query: "PDF" }, execContext(agent));
  assert.match(hit.text, /pdf-tools/);
  assert.doesNotMatch(hit.text, /markdown/);

  const all = await search.execute({ query: "" }, execContext(agent));
  assert.match(all.text, /pdf-tools/);
  assert.match(all.text, /markdown/);
  assert.match(all.text, /game-review/);
});

test("skill_search：上限 20 条 + 剩余计数；无命中给明确文本", async () => {
  const skills = Array.from({ length: 25 }, (_, i) => ({
    name: `skill-${i}`,
    description: `desc ${i}`,
    whenToUse: `use ${i}`,
  }));
  const bootState = bootWithPlugin({ list: async () => skills, get: async () => ({}) });
  const search = visibleTools(bootState).get("skill_search");
  const agent = makeAgent(bootState, "sess-limit");
  agent.session.header = { cwd: process.cwd() };

  const hit = await search.execute({ query: "" }, execContext(agent));
  assert.match(hit.text, /Matching skills \(25\):/);
  const lineCount = hit.text.split("\n").filter((line) => line.startsWith("- ")).length;
  assert.equal(lineCount, 20);
  assert.match(hit.text, /…\(5 more\)/);

  const miss = await search.execute({ query: "zzznope" }, execContext(agent));
  assert.match(miss.text, /No skills match "zzznope"/);
});

test("skill_load：未命中给明确文本，不注入", async () => {
  const bootState = bootWithPlugin({ list: async () => [], get: async () => undefined });
  const load = visibleTools(bootState).get("skill_load");
  const agent = makeAgent(bootState, "sess-load-miss");
  agent.session.header = { cwd: process.cwd() };
  agent.inject = () => { throw new Error("should not inject"); };
  const out = await load.execute({ name: "nope" }, execContext(agent));
  assert.match(out.text, /No skill named "nope"/);
});

test("skill_load：命中后注入指令（source.kind=skill-invocation）", async () => {
  const injected = [];
  const bootState = bootWithPlugin({
    list: async () => [],
    get: async (name) => {
      if (name === "pdf-tools") return { name, content: "PDF instructions body" };
      return undefined;
    },
  });
  const load = visibleTools(bootState).get("skill_load");
  const agent = makeAgent(bootState, "sess-load-hit");
  agent.session.header = { cwd: process.cwd() };
  agent.inject = (message) => injected.push(message);

  const out = await load.execute({ name: "pdf-tools" }, execContext(agent));
  assert.match(out.text, /Skill "pdf-tools" loaded/);
  assert.equal(injected.length, 1);
  const msg = injected[0];
  assert.match(msg.id, /^skill-load-pdf-tools-\d+$/);
  assert.equal(msg.role, "user");
  assert.deepEqual(msg.content, [{ type: "text", text: "PDF instructions body" }]);
  assert.deepEqual(msg.source, { kind: "skill-invocation", name: "pdf-tools", form: "instructions" });
});

test("skill_load：instructions/body 提取；无 body 给明确文本", async () => {
  const injected = [];
  const bootState = bootWithPlugin({
    list: async () => [],
    get: async (name) => {
      if (name === "by-instructions") return { name, instructions: "instructions body" };
      if (name === "by-body") return { name, body: ["line1", "line2"] };
      if (name === "empty") return { name };
      return undefined;
    },
  });
  const load = visibleTools(bootState).get("skill_load");
  const agent = makeAgent(bootState, "sess-load-extract");
  agent.session.header = { cwd: process.cwd() };
  agent.inject = (message) => injected.push(message);

  await load.execute({ name: "by-instructions" }, execContext(agent));
  assert.equal(injected.at(-1).content[0].text, "instructions body");
  await load.execute({ name: "by-body" }, execContext(agent));
  assert.equal(injected.at(-1).content[0].text, "line1\nline2");
  const empty = await load.execute({ name: "empty" }, execContext(agent));
  assert.match(empty.text, /has no loadable body/);
  assert.equal(injected.length, 2, "无 body 不应注入");
});

test("失败降级：skills 不可用返回错误文本而非 throw", async () => {
  const bootState = bootWithPlugin({
    list: async () => { throw new Error("list boom"); },
    get: async () => { throw new Error("get boom"); },
  });
  const tools = visibleTools(bootState);

  const search = await tools.get("skill_search").execute({ query: "pdf" }, execContext(makeAgent(bootState, "sess-err-list")));
  assert.match(search.text, /^skill_search unavailable: .*list boom/);

  const agent = makeAgent(bootState, "sess-err-get");
  agent.session.header = { cwd: process.cwd() };
  agent.inject = () => { throw new Error("should not inject"); };
  const load = await tools.get("skill_load").execute({ name: "pdf-tools" }, execContext(agent));
  assert.match(load.text, /^skill_load failed: .*get boom/);
});

test("skill_load：无 agent 上下文给明确文本", async () => {
  const bootState = bootWithPlugin({ list: async () => [], get: async () => ({}) });
  const load = visibleTools(bootState).get("skill_load");
  const out = await load.execute({ name: "pdf-tools" }, {
    signal: new AbortController().signal,
  });
  assert.match(out.text, /requires an agent context/);
});