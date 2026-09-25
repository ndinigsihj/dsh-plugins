/**
 * 自研插件启停对称性契约测试（票据 06 其余兼容面：0.1.7 支持运行时卸载）。
 *
 * 0.1.7 的 `tools.register()` 把注销句柄挂在 ToolRuntime 自己的 root ctx 上，不随
 * 注册插件的 fiber 释放——不显式注销，运行时卸载后就会留下残留工具。本文件对五个
 * 自研插件各挂载一次、卸载一次：
 *   - tool-bootstrap / instruction-hint：只挂监听器，卸载后工具面不变；
 *   - skill-search / custom-bash：注册的工具随卸载注销，无残留注册；
 *   - phase-swap-bash：per-agent shadow 随卸载注销，无影子泄漏。
 *
 * 运行：node --test presets/minimal-plus/plugin-lifecycle.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boot,
  makeAgent,
  fireStepStart,
  fireToolCall,
  fireToolResult,
  fireStepEnd,
  PARAM_KEYS,
  PERSISTENT_DESC,
  VIEW,
} from "./test-helpers.mjs";

const toolBootstrap = await import("./tool-bootstrap.mjs");
const instructionHint = await import("./instruction-hint.mjs");
const skillSearch = await import("./skill-search.mjs");
const customBash = await import("./custom-bash.mjs");
const phaseSwap = await import("./phase-swap-bash.mjs");

function toolNames(bootState) {
  return [...bootState.tools.view(undefined).visible.keys()].sort();
}

test("启停对称：tool-bootstrap / instruction-hint 卸载后工具面不变", async () => {
  const bootState = boot();
  const before = toolNames(bootState);
  const bootstrapFiber = await bootState.root.plugin(toolBootstrap, {
    bootstrapTools: ["bash", "str_replace_editor"],
  });
  const hintFiber = await bootState.root.plugin(instructionHint, {});
  assert.deepEqual(toolNames(bootState), before, "两个插件都不注册工具，挂载前后工具面应相同");
  await bootstrapFiber.dispose();
  await hintFiber.dispose();
  assert.deepEqual(toolNames(bootState), before, "卸载后工具面仍应相同");
});

test("启停对称：skill-search 卸载后无残留工具注册", async () => {
  const bootState = boot();
  bootState.root.provide("skills", { list: async () => [], get: async () => undefined });
  const fiber = await bootState.root.plugin(skillSearch, {});
  assert.deepEqual(
    toolNames(bootState).filter((name) => name.startsWith("skill_")),
    ["skill_load", "skill_search"],
  );
  await fiber.dispose();
  assert.deepEqual(
    toolNames(bootState).filter((name) => name.startsWith("skill_")),
    [],
    "卸载后 skill_search / skill_load 都应注销（0.1.7 运行时卸载）",
  );
});

test("启停对称：custom-bash 卸载后注册的 bash 注销", async () => {
  const bootState = boot({ withPersistentBash: false });
  bootState.root.provide("subprocess", { resolveExecutable: async (candidate) => candidate });
  const fiber = await bootState.root.plugin(customBash, { bashPath: "/bin/bash" });
  assert.ok(toolNames(bootState).includes("bash"), "显式 bashPath 命中后应注册 bash");
  await fiber.dispose();
  assert.equal(toolNames(bootState).includes("bash"), false, "卸载后不应残留 bash 注册");
});

test("启停对称：phase-swap-bash 卸载后 per-agent shadow 注销（无影子泄漏）", async () => {
  const bootState = boot();
  const fiber = await bootState.root.plugin(phaseSwap, {});
  const agent = makeAgent(bootState, "sess-lifecycle");
  await fireStepStart(bootState, agent.session);
  await fireToolCall(bootState, agent.session);
  await fireToolResult(bootState, agent.session);
  await fireStepEnd(bootState, agent.session);
  assert.ok(
    PARAM_KEYS(VIEW(agent.ctx).get("bash")).includes("sandbox_permissions"),
    "step/end 后该 agent 应看到沙箱 bash",
  );
  await fiber.dispose();
  const bash = VIEW(agent.ctx).get("bash");
  assert.deepEqual(PARAM_KEYS(bash), ["command"], "卸载后 shadow 应注销，露出 persistent bash");
  assert.equal(bash.description, PERSISTENT_DESC);
  assert.equal(bootState.tools.layers.scoped.size, 0, "agent scope 的 shadow 层应随卸载清空");
});
