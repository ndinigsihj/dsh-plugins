/**
 * phase-swap-bash 集成单测（真实 dsh 运行时）。
 *
 * 使用 repo 的 node_modules（`node_modules/@deepseek-ai` 由 `scripts/link-global-dsh.sh` 指向全局宿主）。
 * 原 endless-tui profile（第三方 @deepseek-harness-tui/dsh-tui）已删除，本测试不再依赖它。
 *
 * 运行：node --test presets/minimal-plus-next/phase-swap-bash.test.mjs
 *
 * 覆盖：
 *  1. 首轮（未 promote）agent 看到 persistent bash（仅 command 参数）
 *  2. tool/call 后 swap：agent 的 view 显示沙箱 bash（含 sandbox_permissions/justification）
 *  3. swap 幂等：同一 session 二次 tool/call 不重复 swap
 *  4. per-agent 隔离：agent A swap 后 agent B 仍看 persistent bash
 *  5. 失败降级：swap 抛错（缺 sandboxPolicy）→ warn once + 不 rethrow + persistent 保留
 *
 * boot 桩自 2026-09-11（票据 08 桩统一）起走共享 test-helpers.mjs；session/event
 * 与 system-prompt/assemble 监听器仍是直接捕获后按注册顺序直驱（不经 cordis emit）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// ── boot 桩走共享 test-helpers；宿主包按裸包名导入（深路径会被 exports 拒绝）──
const { boot, makeAgent, fireEvent, fireToolCall, fireToolResult, runAssemble, PERSISTENT_DESC, PARAM_KEYS, VIEW } =
  await import("./test-helpers.mjs");
const sandboxBash = await import("@deepseek-ai/dsh-tool-bash");
const plugin = await import("./phase-swap-bash.mjs");

/** boot + 挂载被测插件（test-helpers 的 boot 只铺 host 存根，不装 preset 插件）。 */
function bootWithPlugin(options) {
  const bootState = boot(options);
  plugin.apply(bootState.root, {});
  return bootState;
}

test("首轮：agent 看到 persistent bash（仅 command 参数）", () => {
  const bootState = bootWithPlugin();
  const agent = makeAgent(bootState, "sess-1");
  const bash = VIEW(agent.ctx).get("bash");
  assert.ok(bash, "agent 应能看到 bash");
  assert.deepEqual(PARAM_KEYS(bash), ["command"]);
  assert.equal(bash.description, PERSISTENT_DESC);
});

test("tool/call 只 promotion 不 swap，tool/result 结算后才 swap：view 显示沙箱 bash", async () => {
  const bootState = bootWithPlugin();
  const agent = makeAgent(bootState, "sess-1");
  // finding 12-2：触发 promotion 的调用还没结算，此刻换 schema 会让同一 step 已产出的
  // 参数被沙箱 schema 拒（missing required property "description"）。
  await fireToolCall(bootState, agent.session);
  assert.deepEqual(PARAM_KEYS(VIEW(agent.ctx).get("bash")), ["command"], "tool/call 落盘瞬间不得 swap");
  await fireToolResult(bootState, agent.session);
  const bash = VIEW(agent.ctx).get("bash");
  const params = PARAM_KEYS(bash);
  assert.ok(params.includes("sandbox_permissions"), `应含 sandbox_permissions，实际: ${params.join(",")}`);
  assert.ok(params.includes("justification"), "应含 justification");
  assert.ok(params.includes("run_in_background"), "D3: 应含 run_in_background");
  assert.deepEqual(bash.parameters.properties.sandbox_permissions.enum, ["workspace-write", "danger-full-access"]);
  // 全局层 persistent bash 不受影响（未 dispose）
  assert.equal(bootState.tools.view(undefined).visible.get("bash").description, PERSISTENT_DESC);
});

test("swap 幂等：同一 session 二次 tool/call+result 不重复注册", async () => {
  const bootState = bootWithPlugin();
  const agent = makeAgent(bootState, "sess-1");
  await fireToolCall(bootState, agent.session);
  await fireToolResult(bootState, agent.session);
  const scopedLayersAfterFirst = bootState.tools.layers.scoped.size;
  // 第二次 tool/call（新 seq）：已 swap 的 session 直接幂等返回，结算后也不重复注册
  await fireToolCall(bootState, agent.session);
  await fireToolResult(bootState, agent.session);
  const scopedLayersAfterSecond = bootState.tools.layers.scoped.size;
  assert.equal(scopedLayersAfterFirst, scopedLayersAfterSecond);
  // 且 sandbox bash 仍可见
  assert.ok(PARAM_KEYS(VIEW(agent.ctx).get("bash")).includes("sandbox_permissions"));
});

test("per-agent 隔离：agent A swap 后 agent B 仍看 persistent bash", async () => {
  const bootState = bootWithPlugin();
  const agentA = makeAgent(bootState, "sess-A");
  const agentB = makeAgent(bootState, "sess-B");
  await fireToolCall(bootState, agentA.session);
  await fireToolResult(bootState, agentA.session);
  // A 已 swap → 沙箱
  assert.ok(PARAM_KEYS(VIEW(agentA.ctx).get("bash")).includes("sandbox_permissions"));
  // B 未 swap → 仍 persistent
  const bashB = VIEW(agentB.ctx).get("bash");
  assert.deepEqual(PARAM_KEYS(bashB), ["command"]);
  assert.equal(bashB.description, PERSISTENT_DESC);
});

test("includeSubagents：子代理独立 swap（各自 tool/result 结算后）", async () => {
  const bootState = bootWithPlugin();
  const parent = makeAgent(bootState, "sess-parent");
  const sub = makeAgent(bootState, "sess-sub", []);
  sub.session.header = { delegationDepth: 1 };
  // 父先 tool/call+result → swap 父
  await fireToolCall(bootState, parent.session);
  await fireToolResult(bootState, parent.session);
  assert.ok(PARAM_KEYS(VIEW(parent.ctx).get("bash")).includes("sandbox_permissions"));
  // 子未 tool/call → 仍 persistent（includeSubagents: true 时子也走 bootstrap）
  const bashSub = VIEW(sub.ctx).get("bash");
  assert.deepEqual(PARAM_KEYS(bashSub), ["command"]);
  // 子 tool/call → 仍 persistent（延后）；结算后子也 swap
  await fireToolCall(bootState, sub.session);
  assert.deepEqual(PARAM_KEYS(VIEW(sub.ctx).get("bash")), ["command"]);
  await fireToolResult(bootState, sub.session);
  assert.ok(PARAM_KEYS(VIEW(sub.ctx).get("bash")).includes("sandbox_permissions"));
});

test("冷启动恢复：resume 已 promoted 会话时任意首个事件触发 swap", async () => {
  const bootState = bootWithPlugin();
  // 会话日志里已有 promotion tool/call（模拟 resume 一个已 promoted 会话）
  const preEvents = [{ type: "tool/call", seq: 5, data: {} }];
  const agent = makeAgent(bootState, "sess-resume", preEvents);
  // 只发一个非 tool/call 事件；swap 必须通过 promotion.status() 的冷扫描发现已 promoted
  await fireEvent(bootState, agent.session, { type: "assistant/message", seq: 6, data: {} });
  const bash = VIEW(agent.ctx).get("bash");
  assert.ok(
    PARAM_KEYS(bash).includes("sandbox_permissions"),
    `resume 已 promoted 会话应冷启动即 swap，实际参数: ${PARAM_KEYS(bash).join(",")}`,
  );
});

test("冷启动：首个事件恰是 tool/call 时同样延后到结算（12-2）", async () => {
  const bootState = bootWithPlugin();
  // 会话日志里已有 promotion（resume 一个已 promoted 会话），首个事件又是新的 tool/call
  const agent = makeAgent(bootState, "sess-resume-call", [{ type: "tool/call", seq: 5, data: {} }]);
  await fireEvent(bootState, agent.session, { type: "tool/call", seq: 6, data: {} });
  assert.deepEqual(
    PARAM_KEYS(VIEW(agent.ctx).get("bash")),
    ["command"],
    "冷启动首个事件是 tool/call 时不得 swap（该调用参数按旧 schema 产出）",
  );
  await fireEvent(bootState, agent.session, { type: "tool/result", seq: 7, data: {} });
  assert.ok(PARAM_KEYS(VIEW(agent.ctx).get("bash")).includes("sandbox_permissions"), "结算后应 swap");
});

test("compaction 后回到 controlled phase：persistent 重新可见，再 promote 再 swap", async () => {
  const bootState = bootWithPlugin();
  const agent = makeAgent(bootState, "sess-compact");
  await fireToolCall(bootState, agent.session);
  await fireToolResult(bootState, agent.session);
  assert.ok(PARAM_KEYS(VIEW(agent.ctx).get("bash")).includes("sandbox_permissions"));

  await fireEvent(bootState, agent.session, { type: "compaction/end", seq: 100, data: {} });
  const reverted = VIEW(agent.ctx).get("bash");
  assert.deepEqual(
    PARAM_KEYS(reverted),
    ["command"],
    `compaction 后应回到 persistent bash，实际参数: ${PARAM_KEYS(reverted).join(",")}`,
  );
  assert.ok(!PARAM_KEYS(reverted).includes("sandbox_permissions"), "persistent bash 不应含 sandbox_permissions");

  // 新一轮 tool/call（seq 必须超过 compaction 边界）重新 promote，但仍延后到结算才 swap
  await fireEvent(bootState, agent.session, { type: "tool/call", seq: 101, data: {} });
  assert.deepEqual(PARAM_KEYS(VIEW(agent.ctx).get("bash")), ["command"], "compaction 后的新 tool/call 同样延后");
  await fireEvent(bootState, agent.session, { type: "tool/result", seq: 102, data: {} });
  assert.ok(
    PARAM_KEYS(VIEW(agent.ctx).get("bash")).includes("sandbox_permissions"),
    "compaction 后的新 promotion 应在结算后重新 swap 回沙箱 bash",
  );
});

test("失败降级：swap 抛错 → warn once + 不 rethrow + persistent 保留", async () => {
  // 不提供 sandboxPolicy → dsh-tool-bash.apply 会抛 "tool-bash: ... ctx.sandboxPolicy is missing"
  const bootState = bootWithPlugin({ withSandboxPolicy: false });
  const agent = makeAgent(bootState, "sess-1");
  await fireToolCall(bootState, agent.session);
  await fireToolResult(bootState, agent.session); // 结算后才真正尝试 swap；不应 throw
  // warn 记录了一次（fiber 错误会先记一条 error，warnOnce 的 warn 在其后）
  assert.ok(bootState.warnings.length >= 1, "应有 warn 日志");
  assert.ok(
    bootState.warnings.some((w) => /swap to sandboxed bash failed/.test(w)),
    `应有 swap 失败 warn，实际: ${JSON.stringify(bootState.warnings)}`,
  );
  // persistent bash 保留（未 dispose，未被覆盖）
  const bash = VIEW(agent.ctx).get("bash");
  assert.deepEqual(PARAM_KEYS(bash), ["command"]);
  assert.equal(bash.description, PERSISTENT_DESC);
});

test("配置校验：未知 key / 非布尔 enableRunInBackground 在 apply 时抛错", () => {
  const bootState = bootWithPlugin();
  assert.throws(() => plugin.apply(bootState.root, { bogus: 1 }), /unknown config key/);
  assert.throws(() => plugin.apply(bootState.root, { enableRunInBackground: "yes" }), /must be a boolean/);
});

/* ---------------- 首轮净化：tool:* 指引 sections 过滤 ---------------- */

function assembledWithSections() {
  return {
    tools: [{ name: "bash" }],
    sections: [
      { name: "tool:read", text: "Use the read tool..." },
      { name: "tool:web_search", text: "Use the web_search tool..." },
      { name: "tool:goal", text: "Use goal tools..." },
      { name: "dsh-tui:status", text: "状态栏提示..." },
      { name: "persona", text: "You are a coding agent..." },
    ],
  };
}

test("首轮净化：未 promote 时过滤 tool:* 指引 sections，promote 后放行", async () => {
  const bootState = bootWithPlugin();
  const agent = makeAgent(bootState, "sess-1");

  // 未 promote：tool:* 被过滤，非工具 sections 保留
  const before = await runAssemble(bootState, agent, assembledWithSections());
  const names = before.sections.map((s) => s.name);
  assert.ok(!names.some((n) => n.startsWith("tool:")), `未 promote 应过滤 tool:*，实际: ${names.join(",")}`);
  assert.ok(names.includes("dsh-tui:status"), "非 tool:* sections 应保留");
  assert.ok(names.includes("persona"), "persona section 应保留");

  // promote 后：tool:* 放行
  await fireToolCall(bootState, agent.session);
  const after = await runAssemble(bootState, agent, assembledWithSections());
  const namesAfter = after.sections.map((s) => s.name);
  assert.ok(namesAfter.includes("tool:read"), "promote 后应放行 tool:* sections");
  assert.ok(namesAfter.includes("tool:web_search"));
});

test("首轮净化：无 sections 的 assembly 原样返回", async () => {
  const bootState = bootWithPlugin();
  const agent = makeAgent(bootState, "sess-1");
  const chain = [...bootState.listeners.assemble];
  const next = async () => ({ tools: [{ name: "bash" }], sections: [] });
  const out = await chain[0]({}, { agent }, next);
  assert.deepEqual(out.sections, []);
});
