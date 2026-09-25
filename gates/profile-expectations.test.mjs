/**
 * Profile 维度工具面期望的单测（票据 09）。
 *
 * 两件事分开钉：
 *   1. 期望数据本身可从 `gates/expectations.json` 的 `profiles` 段完整求值，
 *      且与 08 的实测归档（PTY tui-dev / PTY tui-team / 进程内对照）逐项一致；
 *   2. 求值与 diff 的纯函数语义（行级差异、回退口径、非法变更行报错）。
 *
 * 08 证据是这些期望的来源；作为测试输入是有意的——期望与实测漂移必须红。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyToolChanges,
  diffToolSets,
  fallbackProblems,
  formatToolDiff,
  readExpectations,
  resolveProfileExpectation,
} from "./profile-expectations.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const EVIDENCE_DIR = join(REPO_ROOT, "docs", "tickets", "dsh-v0.1.7-rc.1-upgrade", "evidence");

function evidence(name) {
  return JSON.parse(readFileSync(join(EVIDENCE_DIR, name), "utf8"));
}

test("expectations: 所有声明的 profile 期望都可求值，工具无重复，变更行自带方向与理由", () => {
  const expectations = readExpectations();
  const names = Object.keys(expectations.profiles);
  // 声明的 profile 集合就是本票要维护的三种形态；新增第四个必须显式改这里并补证据。
  assert.deepEqual([...names].sort(), ["headless-team", "tui-dev", "tui-team"]);
  for (const name of names) {
    const resolved = resolveProfileExpectation(expectations, name);
    assert.ok(resolved !== undefined, `${name} must be declared`);
    assert.equal(resolved.tools.length, new Set(resolved.tools).size, `${name} tools must be unique`);
    assert.ok(resolved.tools.length > 0, `${name} tools must not be empty`);
    for (const change of resolved.changes) {
      for (const key of ["tool", "direction", "reason"]) {
        assert.equal(typeof change[key], "string", `${name}: every change line needs ${key}`);
        assert.ok(change[key].length > 0, `${name}: ${key} must not be empty`);
      }
      assert.ok(["added", "removed"].includes(change.direction), `${name}: ${change.tool} direction must be added|removed`);
    }
  }
  assert.equal(resolveProfileExpectation(expectations, "no-such-profile"), undefined);
});

test("expectations: tui-dev 期望 = 08 PTY 实测的 35 工具（非 Team 基线不变）", () => {
  const resolved = resolveProfileExpectation(readExpectations(), "tui-dev");
  const measured = evidence("08-pty-tui-dev.json").modelVisibleTools;
  assert.equal(resolved.tools.length, 35);
  assert.deepEqual(resolved.tools, [...measured].sort());
  assert.ok(resolved.tools.includes("subagent"));
  assert.ok(resolved.tools.includes("subagent_fork"));
  assert.ok(!resolved.tools.includes("spawn_teammate"));
});

test("expectations: tui-team 期望 = 08 PTY 实测的 40 工具（+6/−1，preset 与 Team 工具并存）", () => {
  const resolved = resolveProfileExpectation(readExpectations(), "tui-team");
  const measured = evidence("08-pty-team.json").modelVisibleTools;
  assert.equal(resolved.tools.length, 40);
  assert.deepEqual(resolved.tools, [...measured].sort());
  assert.ok(resolved.tools.includes("subagent"));
  assert.ok(resolved.tools.includes("list_subagent_models"));
  assert.ok(resolved.tools.includes("spawn_teammate"));
  assert.ok(!resolved.tools.includes("subagent_fork"));
});

test("expectations: headless-team 期望 = 08 进程内对照实测的 34 工具", () => {
  const resolved = resolveProfileExpectation(readExpectations(), "headless-team");
  const measured = evidence("08-control-team-overlay.json").facts.teamOverlay.lead.registryTools;
  assert.equal(resolved.tools.length, 34);
  assert.deepEqual(resolved.tools, [...measured].sort());
  assert.ok(!resolved.tools.includes("subagent_fork"));
  assert.ok(resolved.tools.includes("list_subagent_models"));
});

test("expectations: Team 形态的差异可从非 Team 基线逐行复现（禁止整文件再生成）", () => {
  const expectations = readExpectations();
  const dev = resolveProfileExpectation(expectations, "tui-dev");
  const team = resolveProfileExpectation(expectations, "tui-team");
  const added = team.changes.filter((change) => change.direction === "added").map((change) => change.tool).sort();
  const removed = team.changes.filter((change) => change.direction === "removed").map((change) => change.tool).sort();
  assert.deepEqual(added, ["spawn_teammate", "team_task_create", "team_task_get", "team_task_list", "team_task_update", "wait_agent"]);
  assert.deepEqual(removed, ["subagent_fork"]);
  assert.deepEqual(team.tools, applyToolChanges(dev.tools, team.changes).sort());
});

test("diffToolSets / formatToolDiff: 逐行列出缺失与多出的工具", () => {
  const diff = diffToolSets(["bash", "read", "spawn_teammate"], ["bash", "read", "subagent_fork"]);
  assert.equal(diff.ok, false);
  assert.deepEqual(diff.missing, ["spawn_teammate"]);
  assert.deepEqual(diff.unexpected, ["subagent_fork"]);
  assert.deepEqual(formatToolDiff(diff), ["- spawn_teammate", "+ subagent_fork"]);
  assert.deepEqual(diffToolSets(["bash"], ["bash"]), { ok: true, missing: [], unexpected: [], expectedCount: 1, actualCount: 1 });
});

test("fallbackProblems: 回退口径只核对 Team 组合面，不对 preset 增量做声称", () => {
  const fallback = {
    requiredPresent: ["spawn_teammate", "wait_agent"],
    requiredAbsent: ["skill_search", "subagent_fork"],
  };
  assert.deepEqual(fallbackProblems({ fallback }, ["spawn_teammate", "wait_agent", "bash"]), []);
  const violated = fallbackProblems({ fallback }, ["spawn_teammate", "skill_search", "subagent_fork"]);
  assert.deepEqual(violated, ["missing wait_agent", "unexpected skill_search", "unexpected subagent_fork"]);
  assert.deepEqual(fallbackProblems({}, []), ["no fallback convention declared"]);
});

test("fallback: tui-team 的回退口径声明完整且可判定（preset 不下沉时记「未测」）", () => {
  const team = resolveProfileExpectation(readExpectations(), "tui-team");
  assert.equal(team.fallback?.preset, null);
  assert.equal(team.fallback?.status, "unmeasured");
  assert.deepEqual(
    [...team.fallback.requiredPresent].sort(),
    ["spawn_teammate", "team_task_create", "team_task_get", "team_task_list", "team_task_update", "wait_agent"],
  );
  assert.deepEqual([...team.fallback.requiredAbsent].sort(), ["list_subagent_models", "skill_search", "subagent", "subagent_fork"]);
  assert.deepEqual(fallbackProblems(team, [...team.fallback.requiredPresent, "bash"]), []);
  assert.deepEqual(fallbackProblems(team, [...team.fallback.requiredPresent, "skill_search"]), ["unexpected skill_search"]);
});

test("applyToolChanges: 重复添加 / 缺失删除 / 未知方向 / 缺理由都报错", () => {
  assert.deepEqual(applyToolChanges(["bash"], [{ tool: "read", direction: "added", reason: "x" }]), ["bash", "read"]);
  assert.deepEqual(applyToolChanges(["bash", "read"], [{ tool: "read", direction: "removed", reason: "x" }]), ["bash"]);
  assert.throws(() => applyToolChanges(["read"], [{ tool: "read", direction: "added", reason: "x" }]), /already present/u);
  assert.throws(() => applyToolChanges(["bash"], [{ tool: "read", direction: "removed", reason: "x" }]), /not present/u);
  assert.throws(() => applyToolChanges(["bash"], [{ tool: "read", direction: "kept", reason: "x" }]), /direction/u);
  assert.throws(() => applyToolChanges(["bash"], [{ tool: "read", direction: "added", reason: "" }]), /reason/u);
});

test("resolveProfileExpectation: 引用不可解析时报错，不静默给空集", () => {
  assert.throws(() => resolveProfileExpectation({ profiles: { broken: { basedOn: "no.such.ref", changes: [] } } }, "broken"), /cannot resolve/u);
  assert.throws(
    () => resolveProfileExpectation({ profiles: { broken: { basedOn: "presets.p.round1.tools", changes: [{ tool: "x", direction: "removed", reason: "x" }] } }, presets: { p: { round1: { tools: [] } } } }, "broken"),
    /not present/u,
  );
});
