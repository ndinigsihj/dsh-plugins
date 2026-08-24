/**
 * 目标条（session-goal bar, A6）显示效果单测：phase 着色 / 标记 / 轮次计数 /
 * 截断 / 宽度下限。纯函数 formatGoalLine 单测，构造真实 palette 验证 SGR 输出。
 * 运行：node --test lib/goal-bar.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatGoalLine, type GoalSummary } from "./app.ts";
import { createPalette } from "./palette.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

const ESC = "\x1b";
const p = createPalette(true);

function goal(partial: Partial<GoalSummary> = {}): GoalSummary {
  return {
    objective: "测试目标条显示效果",
    phase: "active",
    roundsStarted: 1,
    maxGoalRounds: 5,
    ...partial,
  };
}

/** 去掉 ANSI 序列后应看到的纯文本。 */
function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

test("active: ◎ 青色标记，无 phase 标签，round 计数暗色", () => {
  const out = formatGoalLine(p, goal(), 100);
  assert.equal(
    out,
    `${ESC}[36m◎${ESC}[39m 测试目标条显示效果 ${ESC}[2;39m· round 1/5${ESC}[22;39m`,
  );
});

test("paused: ⏸ brightWhite 标记 + · paused 标签", () => {
  const out = formatGoalLine(p, goal({ phase: "paused", roundsStarted: 2 }), 100);
  assert.equal(
    out,
    `${ESC}[97m⏸${ESC}[39m 测试目标条显示效果 ${ESC}[2;39m· round 2/5 · paused${ESC}[22;39m`,
  );
});

test("blocked: ⛔ 红色标记 + · blocked 标签", () => {
  const out = formatGoalLine(p, goal({ phase: "blocked" }), 100);
  assert.equal(
    out,
    `${ESC}[31m⛔${ESC}[39m 测试目标条显示效果 ${ESC}[2;39m· round 1/5 · blocked${ESC}[22;39m`,
  );
});

test("complete: ✓ 绿色标记 + · complete 标签", () => {
  const out = formatGoalLine(p, goal({ phase: "complete", roundsStarted: 5 }), 100);
  assert.equal(
    out,
    `${ESC}[32m✓${ESC}[39m 测试目标条显示效果 ${ESC}[2;39m· round 5/5 · complete${ESC}[22;39m`,
  );
});

test("截断：长目标折进宽度内并以 … 结尾，ANSI 不残留", () => {
  const out = formatGoalLine(p, goal({ objective: "目标".repeat(50) }), 30);
  assert.ok(visibleWidth(out) <= 30, `visibleWidth(${visibleWidth(out)}) 应 ≤ 30`);
  assert.match(plain(out), /\.\.\.$/);
});

test("宽度下限：width<20 按 20 处理，不做 5 宽截断", () => {
  const narrow = formatGoalLine(p, goal({ objective: "短目标" }), 5);
  const floored = formatGoalLine(p, goal({ objective: "短目标" }), 20);
  assert.equal(narrow, floored); // 下限一致 ⇒ 同一渲染
  assert.ok(visibleWidth(narrow) > 5); // 未按 5 截断
  assert.equal(plain(narrow), "◎ 短目标 · round 1/5");
});

test("超宽内容在窄终端下也不会返回空串", () => {
  const out = formatGoalLine(p, goal({ objective: "目标".repeat(50) }), 5);
  assert.ok(visibleWidth(out) > 0 && visibleWidth(out) <= 20);
});