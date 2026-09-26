/**
 * phase-swap-bash 子代理相位契约测试（票据 14 方案 A；与 phase-swap-bash.test.mjs 同一 seam）。
 *
 * 覆盖豁免锚定的子代理（includeSubagents: false 默认 + delegationDepth > 0）：
 *   1. 首步结算后独立 swap（不依赖自己的 tool/call 提权）
 *   2. 首轮 turn/start 不提前换相，step/end 才换沙箱
 *   3. 冷恢复且日志已有结算 step → turn/start 即换相
 *   4. includeSubagents: true 仍跟随主会话锚定周期（配置生效，非硬编码）
 *   5. tool:* 指引段不过滤（与全量目录口径一致），主会话未 promote 仍过滤
 *   6. compaction 后回 persistent，下次 step 结算再换相
 *
 * 运行：node --test presets/minimal-plus/phase-swap-bash-subagent.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { boot, makeAgent, fireEvent, fireToolCall, fireToolResult, fireStepStart, fireStepEnd, runAssemble, PARAM_KEYS, VIEW } =
  await import("./test-helpers.mjs");
const plugin = await import("./phase-swap-bash.mjs");

/** boot + 挂载被测插件（与 phase-swap-bash.test.mjs 同款）。 */
function bootWithPlugin(options) {
  const bootState = boot(options);
  plugin.apply(bootState.root, options?.config ?? {});
  return bootState;
}

/** 造一个 delegationDepth > 0 的子代理（主会话 delegationDepth 缺省 = 0）。 */
function makeSubagent(bootState, id, events = []) {
  const sub = makeAgent(bootState, id, events);
  sub.session.header = { delegationDepth: 1 };
  return sub;
}

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

test("子代理豁免锚定（默认 includeSubagents: false）：首步结算后独立 swap", async () => {
  const bootState = bootWithPlugin();
  const parent = makeAgent(bootState, "sess-parent");
  const sub = makeSubagent(bootState, "sess-sub");
  // 父先完成一个 step → swap 父
  await fireStepStart(bootState, parent.session);
  await fireToolCall(bootState, parent.session);
  await fireToolResult(bootState, parent.session);
  await fireStepEnd(bootState, parent.session);
  assert.ok(PARAM_KEYS(VIEW(parent.ctx).get("bash")).includes("sandbox_permissions"));
  // 子代理豁免锚定：不靠自己的 tool/call 提权，但首步结算前不得换相
  const bashSub = VIEW(sub.ctx).get("bash");
  assert.deepEqual(PARAM_KEYS(bashSub), ["command"]);
  // 子首步结算（无需自己的 tool/call）即独立 swap
  await fireStepStart(bootState, sub.session);
  await fireStepEnd(bootState, sub.session);
  assert.ok(PARAM_KEYS(VIEW(sub.ctx).get("bash")).includes("sandbox_permissions"));
});

test("子代理首轮：turn/start 不提前换相，首步结算后 step/end 才换沙箱", async () => {
  const bootState = bootWithPlugin();
  const sub = makeSubagent(bootState, "sess-sub-first");
  // 真实 loop：turn/start 排在首次请求装配之前；豁免锚定不得让它提前换相
  await fireEvent(bootState, sub.session, { type: "turn/start", seq: 0, data: {} });
  assert.deepEqual(
    PARAM_KEYS(VIEW(sub.ctx).get("bash")),
    ["command"],
    "子代理首轮请求必须仍按 persistent schema 装配",
  );
  await fireStepStart(bootState, sub.session);
  await fireStepEnd(bootState, sub.session);
  assert.ok(PARAM_KEYS(VIEW(sub.ctx).get("bash")).includes("sandbox_permissions"), "首步结算后应换沙箱");
});

test("子代理冷恢复：日志已有结算 step → turn/start 即换相", async () => {
  const bootState = bootWithPlugin();
  const sub = makeSubagent(bootState, "sess-sub-resume", [{ type: "step/end", seq: 1, data: {} }]);
  await fireEvent(bootState, sub.session, { type: "turn/start", seq: 2, data: {} });
  assert.ok(
    PARAM_KEYS(VIEW(sub.ctx).get("bash")).includes("sandbox_permissions"),
    "已完成首步的子代理恢复时应在 turn/start 换相",
  );
});

test("includeSubagents: true：子代理跟随主会话锚定周期（配置生效，非硬编码）", async () => {
  const bootState = bootWithPlugin({ config: { includeSubagents: true } });
  const sub = makeSubagent(bootState, "sess-sub-anchored");
  await fireEvent(bootState, sub.session, { type: "turn/start", seq: 0, data: {} });
  assert.deepEqual(PARAM_KEYS(VIEW(sub.ctx).get("bash")), ["command"], "未 promotion 不得换相");
  await fireStepStart(bootState, sub.session);
  await fireStepEnd(bootState, sub.session);
  assert.deepEqual(PARAM_KEYS(VIEW(sub.ctx).get("bash")), ["command"], "没有 tool/call 不触发 promotion");
  // 自己的 tool/call 触发 promotion，step 结算后换相
  await fireStepStart(bootState, sub.session);
  await fireToolCall(bootState, sub.session);
  await fireToolResult(bootState, sub.session);
  await fireStepEnd(bootState, sub.session);
  assert.ok(PARAM_KEYS(VIEW(sub.ctx).get("bash")).includes("sandbox_permissions"), "promotion 后 step 结算应换相");
});

test("首轮净化一致性：子代理豁免 → tool:* 指引段不过滤，与全量目录口径一致", async () => {
  const bootState = bootWithPlugin();
  const main = makeAgent(bootState, "sess-main-sections");
  const sub = makeSubagent(bootState, "sess-sub-sections");
  // 主会话未 promote：tool:* 过滤
  const mainOut = await runAssemble(bootState, main, assembledWithSections());
  assert.ok(
    !mainOut.sections.some((section) => section.name.startsWith("tool:")),
    `主会话未 promote 应过滤 tool:*，实际: ${mainOut.sections.map((section) => section.name).join(",")}`,
  );
  // 子代理首轮即 promoted：tool:* 全量放行
  const subOut = await runAssemble(bootState, sub, assembledWithSections());
  assert.deepEqual(
    subOut.sections.map((section) => section.name),
    assembledWithSections().sections.map((section) => section.name),
    "子代理目录已全量时 tool:* 指引段不得仍按锚定过滤",
  );
});

test("子代理 compaction 后回 persistent，下次 step 结算再换相", async () => {
  const bootState = bootWithPlugin();
  const sub = makeSubagent(bootState, "sess-sub-compact");
  await fireStepStart(bootState, sub.session);
  await fireStepEnd(bootState, sub.session);
  assert.ok(PARAM_KEYS(VIEW(sub.ctx).get("bash")).includes("sandbox_permissions"));
  await fireEvent(bootState, sub.session, { type: "compaction/end", seq: 100, data: {} });
  assert.deepEqual(PARAM_KEYS(VIEW(sub.ctx).get("bash")), ["command"], "compaction 后应回 persistent");
  await fireEvent(bootState, sub.session, { type: "step/end", seq: 101, data: {} });
  assert.ok(PARAM_KEYS(VIEW(sub.ctx).get("bash")).includes("sandbox_permissions"), "下一次 step 结算再换相");
});
