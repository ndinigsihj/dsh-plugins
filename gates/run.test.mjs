/**
 * 回归闸门纯函数单测（票据 03）：重复 id 判定、稳定哈希、计数、报告对比。
 *
 * 端到端行为（退出码三态、隔离、豁免）由 `scripts/regression-gate.sh` 的实跑举证，
 * 这里只钉住最容易被改坏的判定逻辑——尤其「group 内嵌套 id 重复」这一类导出与
 * boot 都不会主动报错的冲突。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { diffRealHome, parseTestCounts, stableJson } from "./gate-helpers.mjs";
import { parseCompositionDump } from "./dump-parse.mjs";
import { strictIsolationDiffs } from "./run.mjs";
import { countEntries, findDuplicateIds } from "./unique-ids.mjs";

test("findDuplicateIds: 顶层重复 id 被抓", () => {
  const duplicates = findDuplicateIds([
    { id: "a", name: "x" },
    { id: "b", name: "y" },
    { id: "a", name: "z" },
  ]);
  assert.deepEqual(duplicates, [{ path: "", id: "a", count: 2 }]);
});

test("findDuplicateIds: group 内嵌套重复 id 被抓（导出本身不检测，必须递归）", () => {
  const duplicates = findDuplicateIds([
    { id: "base", name: "x" },
    {
      id: "group",
      name: "cordis:group",
      group: true,
      config: [{ id: "row", name: "a" }, { id: "row", name: "b" }],
    },
  ]);
  assert.deepEqual(duplicates, [{ path: "group", id: "row", count: 2 }]);
});

test("findDuplicateIds: 不同 group 的同名 id 不算冲突（判定域是同层兄弟）", () => {
  const entries = [
    { id: "g1", name: "cordis:group", group: true, config: [{ id: "row", name: "a" }] },
    { id: "g2", name: "cordis:group", group: true, config: [{ id: "row", name: "b" }] },
  ];
  assert.deepEqual(findDuplicateIds(entries), []);
});

test("countEntries: 递归统计 group 与 id 数", () => {
  const counts = countEntries([
    { id: "a", name: "x" },
    {
      id: "group",
      name: "cordis:group",
      group: true,
      config: [{ id: "row-1", name: "p" }, { id: "row-2", name: "q", group: true, config: [{ id: "deep", name: "r" }] }],
    },
  ]);
  assert.equal(counts.ids, 5);
  assert.equal(counts.groups, 2);
  assert.equal(counts.maxDepth, 2);
});

test("stableJson: 对象键序不影响哈希输入", () => {
  assert.equal(stableJson({ b: 1, a: [2, { d: 3, c: 4 }] }), stableJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
  assert.notEqual(stableJson([1, 2]), stableJson([2, 1]));
});

test("parseTestCounts: spec（ℹ）与 TAP（#）两种统计行都认", () => {
  assert.deepEqual(parseTestCounts("ℹ tests 117\nℹ pass 117\nℹ fail 0\n"), { tests: 117, pass: 117, fail: 0 });
  assert.deepEqual(parseTestCounts("# tests 5\n# pass 4\n# fail 1\n"), { tests: 5, pass: 4, fail: 1 });
});

test("parseCompositionDump: 解析 !!js 标量的 dump，并可用于重复 id 递归计数", () => {
  const dump = [
    "# == @deepseek-ai/dsh-base",
    "- id: llm",
    "  name: '@deepseek-ai/dsh-llm'",
    "- id: runner",
    "  config:",
    "    preset: !!js process.env.CC_TUI_PRESET ?? 'minimal-plus-next'",
    "",
  ].join("\n");
  const parsed = parseCompositionDump(dump);
  assert.equal(parsed.error, undefined);
  assert.deepEqual(findDuplicateIds(parsed.entries), []);
  assert.equal(parsed.entries[1].config.preset.__jsExpr, "process.env.CC_TUI_PRESET ?? 'minimal-plus-next'");

  const duplicate = parseCompositionDump("- id: a\n- id: a\n");
  assert.deepEqual(findDuplicateIds(duplicate.entries), [{ path: "", id: "a", count: 2 }]);

  const broken = parseCompositionDump("not: [a");
  assert.ok(typeof broken.error === "string" && broken.error.length > 0);
});

test("diffRealHome: 检出签名变化与消失的区", () => {
  const before = { profiles: { exists: true, entries: 2, signature: "aa" }, sessions: { exists: true, entries: 10 } };
  const after = {
    profiles: { exists: true, entries: 3, signature: "bb" },
    sessions: { exists: true, entries: 10 },
  };
  assert.deepEqual(diffRealHome(before, after), [{ zone: "profiles", change: "changed", before: 2, after: 3 }]);
  assert.deepEqual(diffRealHome(before, { ...after, profiles: undefined }), [{ zone: "profiles", change: "gone" }]);
  assert.deepEqual(diffRealHome(before, before), []);
});

test("strictIsolationDiffs: 活跃写入区（strict:false）只记录不判红", () => {
  const before = {
    profiles: { exists: true, entries: 2, signature: "aa" },
    storages: { exists: true, entries: 5, signature: "cc", strict: false },
  };
  const diffs = [
    { zone: "profiles", change: "changed", before: 2, after: 3 },
    { zone: "storages", change: "changed", before: 5, after: 6 },
  ];
  assert.deepEqual(strictIsolationDiffs(before, diffs), [{ zone: "profiles", change: "changed", before: 2, after: 3 }]);
  assert.deepEqual(strictIsolationDiffs(before, diffs.slice(1)), []);
});
