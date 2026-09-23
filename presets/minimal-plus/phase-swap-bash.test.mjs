/**
 * phase-swap-bash 集成单测（真实 dsh 运行时）。
 *
 * 使用 repo 的 node_modules（`node_modules/@deepseek-ai` 由 `scripts/link-global-dsh.sh` 指向全局宿主）。
 * 原 endless-tui profile（第三方 @deepseek-harness-tui/dsh-tui）已删除，本测试不再依赖它。
 *
 * 运行：node --test presets/minimal-plus/phase-swap-bash.test.mjs
 *
 * 覆盖：
 *  1. 首轮（未 promote）agent 看到 persistent bash（仅 command 参数）
 *  2. step 中途不 swap，step/end 同步 swap：view 显示沙箱 bash（含 sandbox_permissions/justification）
 *  3. 多调用 step（批量 bash）：step/end 之前两条调用都不换 schema（12-2 多调用残留）
 *  4. 换相点白名单：tool/call + tool/result 本身不触发 swap
 *  5. swap 幂等：同一 session 二次 step/end 不重复 swap
 *  6. per-agent 隔离：agent A swap 后 agent B 仍看 persistent bash
 *  7. 失败降级：swap 抛错（缺 sandboxPolicy）→ warn once + 不 rethrow + persistent 保留
 *
 * boot 桩自 2026-09-11（票据 08 桩统一）起走共享 test-helpers.mjs；session/event
 * 与 system-prompt/assemble 监听器仍是直接捕获后按注册顺序直驱（不经 cordis emit）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// ── boot 桩走共享 test-helpers；宿主包按裸包名导入（深路径会被 exports 拒绝）──
const { boot, makeAgent, fireEvent, fireToolCall, fireToolResult, fireStepStart, fireStepEnd, runAssemble, PERSISTENT_DESC, PARAM_KEYS, VIEW } =
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

test("step 中途不 swap，step/end 同步 swap：view 显示沙箱 bash", async () => {
  const bootState = bootWithPlugin();
  const agent = makeAgent(bootState, "sess-1");
  // finding 12-2：触发 promotion 的调用所在 step 未结算前换 schema，会让同一 step
  // 已产出的参数被沙箱 schema 拒（missing required property "description"）。
  await fireStepStart(bootState, agent.session);
  await fireToolCall(bootState, agent.session);
  assert.deepEqual(PARAM_KEYS(VIEW(agent.ctx).get("bash")), ["command"], "tool/call 落盘瞬间不得 swap");
  await fireToolResult(bootState, agent.session);
  assert.deepEqual(PARAM_KEYS(VIEW(agent.ctx).get("bash")), ["command"], "step 结算前不得 swap（同 step 可能还有调用）");
  // step/end：同步注册，保证下一次请求装配（loop 在 preStep 里 await）看到新 schema
  await fireStepEnd(bootState, agent.session);
  const bash = VIEW(agent.ctx).get("bash");
  const params = PARAM_KEYS(bash);
  assert.ok(params.includes("sandbox_permissions"), `应含 sandbox_permissions，实际: ${params.join(",")}`);
  assert.ok(params.includes("justification"), "应含 justification");
  assert.ok(params.includes("run_in_background"), "D3: 应含 run_in_background");
  assert.deepEqual(bash.parameters.properties.sandbox_permissions.enum, ["workspace-write", "danger-full-access"]);
  // 全局层 persistent bash 不受影响（未 dispose）
  assert.equal(bootState.tools.view(undefined).visible.get("bash").description, PERSISTENT_DESC);
});

test("多调用 step（批量 bash）：step/end 之前两条调用都不换 schema", async () => {
  const bootState = bootWithPlugin();
  const agent = makeAgent(bootState, "sess-batch");
  // 模拟模型一条 assistant 消息里发两条 bash：loop 逐条 appendToolCall → dispatch → result。
  // step/end 之前（无论几条）都必须按 persistent schema 校验。
  await fireStepStart(bootState, agent.session);
  await fireToolCall(bootState, agent.session);
  await fireToolResult(bootState, agent.session, "call-1");
  assert.deepEqual(
    PARAM_KEYS(VIEW(agent.ctx).get("bash")),
    ["command"],
    "同一 step 第一条调用结算后不得 swap（后面还有 pending 调用）",
  );
  await fireToolCall(bootState, agent.session);
  await fireToolResult(bootState, agent.session, "call-2");
  assert.deepEqual(PARAM_KEYS(VIEW(agent.ctx).get("bash")), ["command"], "step 结算前不得 swap");
  await fireStepEnd(bootState, agent.session);
  assert.ok(
    PARAM_KEYS(VIEW(agent.ctx).get("bash")).includes("sandbox_permissions"),
    "step/end（该 step 全部调用结算）后应同步 swap",
  );
});

test("换相点白名单：tool/call + tool/result 本身不触发 swap", async () => {
  const bootState = bootWithPlugin();
  const agent = makeAgent(bootState, "sess-whitelist");
  // 未标记 step 开合时也不在调用事件上换相（只有 step/end 与 turn/start 是安全点）
  await fireToolCall(bootState, agent.session);
  await fireToolResult(bootState, agent.session);
  assert.deepEqual(PARAM_KEYS(VIEW(agent.ctx).get("bash")), ["command"], "tool/call、tool/result 不是换相点");
  await fireStepEnd(bootState, agent.session);
  assert.ok(PARAM_KEYS(VIEW(agent.ctx).get("bash")).includes("sandbox_permissions"), "step/end 应 swap");
});

test("swap 幂等：同一 session 二次 step/end 不重复注册", async () => {
  const bootState = bootWithPlugin();
  const agent = makeAgent(bootState, "sess-1");
  await fireStepStart(bootState, agent.session);
  await fireToolCall(bootState, agent.session);
  await fireToolResult(bootState, agent.session);
  await fireStepEnd(bootState, agent.session);
  const scopedLayersAfterFirst = bootState.tools.layers.scoped.size;
  // 第二个 step：已 swap 的 session 直接幂等返回，不重复注册
  await fireStepStart(bootState, agent.session);
  await fireToolCall(bootState, agent.session);
  await fireToolResult(bootState, agent.session);
  await fireStepEnd(bootState, agent.session);
  const scopedLayersAfterSecond = bootState.tools.layers.scoped.size;
  assert.equal(scopedLayersAfterFirst, scopedLayersAfterSecond);
  // 且 sandbox bash 仍可见
  assert.ok(PARAM_KEYS(VIEW(agent.ctx).get("bash")).includes("sandbox_permissions"));
});

test("per-agent 隔离：agent A swap 后 agent B 仍看 persistent bash", async () => {
  const bootState = bootWithPlugin();
  const agentA = makeAgent(bootState, "sess-A");
  const agentB = makeAgent(bootState, "sess-B");
  await fireStepStart(bootState, agentA.session);
  await fireToolCall(bootState, agentA.session);
  await fireToolResult(bootState, agentA.session);
  await fireStepEnd(bootState, agentA.session);
  // A 已 swap → 沙箱
  assert.ok(PARAM_KEYS(VIEW(agentA.ctx).get("bash")).includes("sandbox_permissions"));
  // B 未 swap → 仍 persistent
  const bashB = VIEW(agentB.ctx).get("bash");
  assert.deepEqual(PARAM_KEYS(bashB), ["command"]);
  assert.equal(bashB.description, PERSISTENT_DESC);
});

test("includeSubagents：子代理独立 swap（各自 step 结算后）", async () => {
  const bootState = bootWithPlugin();
  const parent = makeAgent(bootState, "sess-parent");
  const sub = makeAgent(bootState, "sess-sub", []);
  sub.session.header = { delegationDepth: 1 };
  // 父先完成一个 step → swap 父
  await fireStepStart(bootState, parent.session);
  await fireToolCall(bootState, parent.session);
  await fireToolResult(bootState, parent.session);
  await fireStepEnd(bootState, parent.session);
  assert.ok(PARAM_KEYS(VIEW(parent.ctx).get("bash")).includes("sandbox_permissions"));
  // 子未 tool/call → 仍 persistent（includeSubagents: true 时子也走 bootstrap）
  const bashSub = VIEW(sub.ctx).get("bash");
  assert.deepEqual(PARAM_KEYS(bashSub), ["command"]);
  // 子 step 结算后同样 swap
  await fireStepStart(bootState, sub.session);
  await fireToolCall(bootState, sub.session);
  await fireToolResult(bootState, sub.session);
  assert.deepEqual(PARAM_KEYS(VIEW(sub.ctx).get("bash")), ["command"]);
  await fireStepEnd(bootState, sub.session);
  assert.ok(PARAM_KEYS(VIEW(sub.ctx).get("bash")).includes("sandbox_permissions"));
});

test("冷启动恢复：resume 已 promoted 会话在首个 turn/start 即 swap", async () => {
  const bootState = bootWithPlugin();
  // 会话日志里已有 promotion tool/call（模拟 resume 一个已 promoted 会话）
  const preEvents = [{ type: "tool/call", seq: 5, data: {} }];
  const agent = makeAgent(bootState, "sess-resume", preEvents);
  // turn/start 在第一次请求装配之前：promotion.status() 冷扫描日志发现已 promoted
  await fireEvent(bootState, agent.session, { type: "turn/start", seq: 6, data: {} });
  const bash = VIEW(agent.ctx).get("bash");
  assert.ok(
    PARAM_KEYS(bash).includes("sandbox_permissions"),
    `resume 已 promoted 会话应在 turn/start 冷启动 swap，实际参数: ${PARAM_KEYS(bash).join(",")}`,
  );
});

test("冷启动：step/end 才换相（首轮调用仍按 persistent schema）", async () => {
  const bootState = bootWithPlugin();
  // 会话日志里已有 promotion（resume 一个已 promoted 会话），新 step 开始
  const agent = makeAgent(bootState, "sess-resume-call", [{ type: "tool/call", seq: 5, data: {} }]);
  await fireEvent(bootState, agent.session, { type: "step/start", seq: 6, data: {} });
  await fireEvent(bootState, agent.session, { type: "tool/call", seq: 7, data: {} });
  await fireEvent(bootState, agent.session, { type: "tool/result", seq: 8, data: {} });
  assert.deepEqual(
    PARAM_KEYS(VIEW(agent.ctx).get("bash")),
    ["command"],
    "该调用参数按旧 schema 产出，step 结算前不得 swap",
  );
  await fireEvent(bootState, agent.session, { type: "step/end", seq: 9, data: {} });
  assert.ok(PARAM_KEYS(VIEW(agent.ctx).get("bash")).includes("sandbox_permissions"), "step/end 应 swap");
});

test("compaction 后回到 controlled phase：persistent 重新可见，再 promote 再 swap", async () => {
  const bootState = bootWithPlugin();
  const agent = makeAgent(bootState, "sess-compact");
  await fireStepStart(bootState, agent.session);
  await fireToolCall(bootState, agent.session);
  await fireToolResult(bootState, agent.session);
  await fireStepEnd(bootState, agent.session);
  assert.ok(PARAM_KEYS(VIEW(agent.ctx).get("bash")).includes("sandbox_permissions"));

  await fireEvent(bootState, agent.session, { type: "compaction/end", seq: 100, data: {} });
  const reverted = VIEW(agent.ctx).get("bash");
  assert.deepEqual(
    PARAM_KEYS(reverted),
    ["command"],
    `compaction 后应回到 persistent bash，实际参数: ${PARAM_KEYS(reverted).join(",")}`,
  );
  assert.ok(!PARAM_KEYS(reverted).includes("sandbox_permissions"), "persistent bash 不应含 sandbox_permissions");
  // compaction 边界之后无新 promotion：新 step 结算也不得 swap
  await fireEvent(bootState, agent.session, { type: "step/end", seq: 100.5, data: {} });
  assert.deepEqual(PARAM_KEYS(VIEW(agent.ctx).get("bash")), ["command"], "compaction 后无新 promotion 不得 swap");

  // 新一轮 tool/call（seq 必须超过 compaction 边界）重新 promote，step 结算才 swap
  await fireEvent(bootState, agent.session, { type: "step/start", seq: 101, data: {} });
  await fireEvent(bootState, agent.session, { type: "tool/call", seq: 102, data: {} });
  await fireEvent(bootState, agent.session, { type: "tool/result", seq: 103, data: {} });
  assert.deepEqual(PARAM_KEYS(VIEW(agent.ctx).get("bash")), ["command"], "compaction 后的新调用结算不触发 swap");
  await fireEvent(bootState, agent.session, { type: "step/end", seq: 104, data: {} });
  assert.ok(
    PARAM_KEYS(VIEW(agent.ctx).get("bash")).includes("sandbox_permissions"),
    "compaction 后的新 promotion 应在 step 结算时重新 swap 回沙箱 bash",
  );
});

test("失败降级：swap 抛错 → warn once + 不 rethrow + persistent 保留", async () => {
  // 不提供 sandboxPolicy → dsh-tool-bash.apply 会抛 "tool-bash: ... ctx.sandboxPolicy is missing"
  const bootState = bootWithPlugin({ withSandboxPolicy: false });
  const agent = makeAgent(bootState, "sess-1");
  await fireStepStart(bootState, agent.session);
  await fireToolCall(bootState, agent.session);
  await fireToolResult(bootState, agent.session);
  await fireStepEnd(bootState, agent.session); // step 结算时尝试 swap；不应 throw
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
