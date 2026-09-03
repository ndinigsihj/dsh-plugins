/**
 * instruction-hint 契约测试（真实 dsh 运行时）。
 *
 * 覆盖文档 §2.3：promoted 注入一次、未 promoted 不注入、探测存在/不存在、
 * 注入消息形状与 source.kind、异常降级、配置校验。
 *
 * 运行：node --test presets/liangshen-bash/instruction-hint.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boot,
  makeAgent,
  fireToolCall,
  runPreStep,
} from "./test-helpers.mjs";

/** 待测自研插件；Phase 1 时文件尚不存在 → 本文件先红。 */
const plugin = await import("./instruction-hint.mjs");

/** 极简 fake fs：files 为存在的路径集合；resolve 按需拼接绝对/相对路径。 */
function fakeFs(files) {
  const isAbsolute = (p) => /^[\\/]|[A-Za-z]:[\\/]/.test(p);
  return {
    async resolve(path, { cwd } = {}) {
      return isAbsolute(path) ? path : `${cwd}\\${path}`.replace(/\\\\/g, "\\");
    },
    async stat(target) {
      return files.has(target) ? { type: "file" } : undefined;
    },
  };
}

function applyPlugin(bootState, config = { promoteOn: "tool-call" }) {
  plugin.apply(bootState.root, config);
  return bootState;
}

const baseDecision = () => ({ kind: "enter", messages: [{ id: "seed", role: "user", content: [], source: { kind: "user" } }] });
const hintKinds = (decision) => decision.messages.map((m) => m.source?.kind);

test("promoted：注入一次 hint，未 promote 不注入", async () => {
  const bootState = applyPlugin(boot());
  bootState.root.provide("fs", fakeFs(new Set(["/work/proj/.git", "/work/proj/AGENTS.md", "/work/proj/CLAUDE.md"])));
  const agent = makeAgent(bootState, "sess-hint");
  agent.session.header.cwd = "/work/proj";

  // 未 promote：不注入
  const fresh = await runPreStep(bootState, agent, baseDecision());
  assert.deepEqual(hintKinds(fresh), ["user"]);

  await fireToolCall(bootState, agent.session);
  const first = await runPreStep(bootState, agent, baseDecision());
  assert.deepEqual(hintKinds(first), ["user", "instruction-hint"]);
  const second = await runPreStep(bootState, agent, baseDecision());
  assert.deepEqual(hintKinds(second), ["user"], "同一会话只注入一次");
});

test("注入消息形状：role/content/source/原文措辞", async () => {
  const bootState = applyPlugin(boot());
  bootState.root.provide("fs", fakeFs(new Set(["/work/proj/.git", "/work/proj/AGENTS.md"])));
  const agent = makeAgent(bootState, "sess-shape");
  agent.session.header.cwd = "/work/proj";
  await fireToolCall(bootState, agent.session);
  const out = await runPreStep(bootState, agent, baseDecision());
  const hint = out.messages.find((m) => m.source?.kind === "instruction-hint");
  assert.ok(hint, "应有 instruction-hint 消息");
  assert.equal(hint.id, "instruction-hint-sess-shape");
  assert.equal(hint.role, "user");
  assert.deepEqual(hint.source, { kind: "instruction-hint", form: "hint" });
  assert.equal(hint.content[0].type, "text");
  assert.match(hint.content[0].text, /Workspace instruction files exist: AGENTS\.md \(project root: \/work\/proj\)\./);
  assert.match(hint.content[0].text, /Do NOT assume their content\. When a task touches this workspace, read the relevant instruction files first and follow them\./);
});

test("用户全局文件：DSH_HOME/AGENTS.md 存在时追加 section", async () => {
  const prevHome = process.env.DSH_HOME;
  const bootState = applyPlugin(boot());
  bootState.root.provide("fs", fakeFs(new Set(["/work/proj/.git", "/work/proj/AGENTS.md", "/home/u/.dsh/AGENTS.md"])));
  const agent = makeAgent(bootState, "sess-home");
  agent.session.header.cwd = "/work/proj";
  try {
    process.env.DSH_HOME = "/home/u/.dsh";
    await fireToolCall(bootState, agent.session);
    const out = await runPreStep(bootState, agent, baseDecision());
    const hint = out.messages.find((m) => m.source?.kind === "instruction-hint");
    assert.match(hint.content[0].text, /A user-global instruction file exists: AGENTS\.md\./);
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
  }
});

test("探测：无任何指令文件 → 不注入、decision 原样", async () => {
  const bootState = applyPlugin(boot());
  bootState.root.provide("fs", fakeFs(new Set([])));
  const agent = makeAgent(bootState, "sess-none");
  agent.session.header.cwd = "/empty";
  await fireToolCall(bootState, agent.session);
  const out = await runPreStep(bootState, agent, baseDecision());
  assert.deepEqual(out, baseDecision());
});

test("异常降级：注入阶段抛错 → warn once + 原样返回 decision", async () => {
  const bootState = applyPlugin(boot());
  bootState.root.provide("fs", fakeFs(new Set(["/work/proj/.git", "/work/proj/AGENTS.md"])));
  const agent = makeAgent(bootState, "sess-degrade");
  agent.session.header.cwd = "/work/proj";
  await fireToolCall(bootState, agent.session);
  // 探测成功但 decision.messages 缺失 → 构造注入消息时抛错，必须被外层 catch 兜住
  const malformed = { kind: "enter" };
  const out = await runPreStep(bootState, agent, malformed);
  assert.deepEqual(out, malformed, "异常必须原样返回");
  assert.ok(
    bootState.warnings.some((w) => /hint injection failed/.test(w)),
    `应有降级 warn，实际: ${JSON.stringify(bootState.warnings)}`,
  );
});

test("配置校验：非法 promoteOn / 非布尔 includeSubagents 在 apply 时抛错", () => {
  assert.throws(() => applyPlugin(boot(), { promoteOn: "bogus" }), /promoteOn/);
  assert.throws(() => applyPlugin(boot(), { promoteOn: "tool-call", includeSubagents: "yes" }), /includeSubagents/);
  // config 缺省也不应崩溃（预设实际显式传 config，但自研应容忍省略）
  assert.doesNotThrow(() => plugin.apply(boot().root, undefined));
});