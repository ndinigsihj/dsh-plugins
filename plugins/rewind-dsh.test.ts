/**
 * dsh-rewind 纯函数单测：边界计算 / hunk 反向应用 / 恢复计划。
 * 运行：node --test plugins/rewind-dsh.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyReverseSteps,
  buildRestorePlan,
  buildReverseSteps,
  computeRewindBoundary,
  diffsFromMeta,
  filePathFromArgs,
  replaceOnce,
} from "./rewind-dsh.ts";

/* ---------------- computeRewindBoundary ---------------- */

function ev(seq: number, type: string): { seq: number; type: string; data?: unknown } {
  return { seq, type, data: {} };
}

test("boundary: user message inside a turn → before that turn/start", () => {
  const events = [
    ev(0, "turn/start"),
    ev(1, "user/message"),
    ev(2, "assistant/message"),
    ev(3, "turn/end"),
    ev(4, "turn/start"),
    ev(5, "user/message"),
    ev(6, "assistant/message"),
    ev(7, "turn/end"),
  ];
  // 选中 seq 5（第二条 user 消息），其 turn/start 在 seq 4 → boundary 3。
  assert.equal(computeRewindBoundary(events, 5), 3);
  // 选中 seq 1 → boundary 0（turn/start 在 0 → 0-1 = -1 → undefined）。
  assert.equal(computeRewindBoundary(events, 1), undefined);
});

test("boundary: out of range / not a user msg seq", () => {
  const events = [ev(0, "turn/start"), ev(1, "user/message")];
  assert.equal(computeRewindBoundary(events, 0), undefined); // turn/start
  assert.equal(computeRewindBoundary(events, 5), undefined); // 越界
  assert.equal(computeRewindBoundary(events, -1), undefined);
});

test("boundary: message after a completed turn (between turns)", () => {
  const events = [
    ev(0, "turn/start"),
    ev(1, "user/message"),
    ev(2, "turn/end"),
    ev(3, "user/message"), // 两个 turn 之间（罕见）→ boundary = 3
  ];
  assert.equal(computeRewindBoundary(events, 3), 3);
});

/* ---------------- replaceOnce / applyReverseSteps ---------------- */

test("replaceOnce: unique match", () => {
  assert.equal(replaceOnce("aXbZc", "X", "Y"), "aYbZc");
  assert.equal(replaceOnce("hello world", "world", "there"), "hello there");
});

test("replaceOnce: missing / ambiguous returns null", () => {
  assert.equal(replaceOnce("abc", "z", "q"), null);
  assert.equal(replaceOnce("aXbXcX", "X", "Y"), null); // 3 hits
});

test("applyReverseSteps: single edit reverse", () => {
  const current = "line1\nline2 NEW\nline3";
  const steps = [{ op: "edit", newText: "line2 NEW", oldText: "line2 OLD" }];
  assert.equal(applyReverseSteps(current, steps), "line1\nline2 OLD\nline3");
});

test("applyReverseSteps: multiple hunks reversed in order", () => {
  const current = "a\nB\nc\nd\nE\nf";
  const reverseSteps = [
    { op: "edit", newText: "E", oldText: "e" }, // 最新的改动先回退
    { op: "edit", newText: "B", oldText: "b" },
  ];
  assert.equal(applyReverseSteps(current, reverseSteps), "a\nb\nc\nd\ne\nf");
});

test("applyReverseSteps: deleteAfter marks deletion", () => {
  const current = "file created by rewind-after op";
  const steps = [{ op: "write", newText: "", oldText: null, deleteAfter: true }];
  assert.equal(applyReverseSteps(current, steps), "\u0000DELETE\u0000");
});

test("applyReverseSteps: null oldText (pure insert) → null (cannot reverse)", () => {
  const current = "abc";
  const steps = [{ op: "edit", newText: "x", oldText: null }];
  assert.equal(applyReverseSteps(current, steps), null);
});

test("applyReverseSteps: ambiguous match → null (fail closed)", () => {
  const current = "dup\nTARGET\ndup\nTARGET";
  const steps = [{ op: "edit", newText: "TARGET", oldText: "OLD" }];
  assert.equal(applyReverseSteps(current, steps), null);
});

/* ---------------- filePathFromArgs / diffsFromMeta ---------------- */

test("filePathFromArgs: file_path / path / malformed", () => {
  assert.equal(filePathFromArgs('{"file_path":"a.ts"}'), "a.ts");
  assert.equal(filePathFromArgs('{"path":"b.txt"}'), "b.txt");
  assert.equal(filePathFromArgs("not json"), undefined);
  assert.equal(filePathFromArgs("{}"), undefined);
});

test("diffsFromMeta: valid / malformed", () => {
  const meta = {
    diffs: [{ path: "a.ts", oldText: "old", newText: "new" }],
  };
  assert.deepEqual(diffsFromMeta(meta), [{ path: "a.ts", oldText: "old", newText: "new" }]);
  assert.equal(diffsFromMeta(undefined), undefined);
  assert.equal(diffsFromMeta({ diffs: [] }), undefined);
  assert.equal(diffsFromMeta({ diffs: [{ path: "a", oldText: 42, newText: "x" }] }), undefined);
});

/* ---------------- buildRestorePlan ---------------- */

function toolCall(seq: number, callId: string, name: string, argumentsJson: string) {
  return { seq, type: "tool/call", data: { callId, name, arguments: argumentsJson } };
}
function toolResult(seq: number, callId: string, meta?: unknown, messageContent?: unknown) {
  return {
    seq,
    type: "tool/result",
    data: { callId, meta, message: { content: messageContent } },
  };
}

test("buildRestorePlan: write+edit via diffs, in order", () => {
  const events = [
    toolCall(10, "c1", "write", '{"file_path":"a.txt","content":"v2"}'),
    toolResult(11, "c1", { diffs: [{ path: "a.txt", oldText: "v1", newText: "v2" }] }),
    toolCall(12, "c2", "edit", '{"file_path":"a.txt","old_string":"v2","new_string":"v3"}'),
    toolResult(13, "c2", { diffs: [{ path: "a.txt", oldText: "v2", newText: "v3" }] }),
  ];
  const { steps, skipped } = buildRestorePlan(events, 9);
  assert.equal(skipped.length, 0);
  const a = steps.get("a.txt")!;
  // chrono 从旧到新：v1→v2 (write)，v2→v3 (edit)
  assert.equal(a.length, 2);
  assert.deepEqual(a[0], { op: "write", newText: "v2", oldText: "v1" });
  assert.deepEqual(a[1], { op: "edit", newText: "v3", oldText: "v2" });
});

test("buildRestorePlan: write create (no diffs, Created) → deleteAfter", () => {
  const events = [
    toolCall(10, "c1", "write", '{"file_path":"new.txt","content":"hello"}'),
    toolResult(11, "c1", undefined, [{ type: "text", text: "<path>new.txt</path>\n<type>file</type>\n<content>\nCreated file\n</content>" }]),
  ];
  const { steps } = buildRestorePlan(events, 9);
  assert.deepEqual(steps.get("new.txt"), [{ op: "write", newText: "", oldText: null, deleteAfter: true }]);
});

test("buildRestorePlan: write update with no before → skipped", () => {
  const events = [
    toolCall(10, "c1", "write", '{"file_path":"b.txt","content":"x"}'),
    toolResult(11, "c1", undefined, [{ type: "text", text: "Updated file" }]),
  ];
  const { steps, skipped } = buildRestorePlan(events, 9);
  assert.equal(steps.size, 0);
  assert.equal(skipped.length, 1);
  const firstSkipped = skipped[0];
  assert.ok(firstSkipped);
  assert.match(firstSkipped, /no before-content/);
});

test("buildRestorePlan: bash → skipped", () => {
  const events = [
    toolCall(10, "c1", "bash", '{"command":"echo hi >> a.txt"}'),
    toolResult(11, "c1", undefined, "done"),
  ];
  const { steps, skipped } = buildRestorePlan(events, 9);
  assert.equal(steps.size, 0);
  const firstSkipped = skipped[0];
  assert.ok(firstSkipped);
  assert.match(firstSkipped, /bash/);
});

test("buildRestorePlan: str_replace_editor str_replace / insert / create", () => {
  const events = [
    toolCall(10, "s1", "str_replace_editor", '{"command":"str_replace","path":"f.ts","old_str":"A","new_str":"B"}'),
    toolResult(11, "s1", undefined, "ok"),
    toolCall(12, "s2", "str_replace_editor", '{"command":"insert","path":"f.ts","insert_line":2,"new_str":"X"}'),
    toolResult(13, "s2", undefined, "ok"),
    toolCall(14, "s3", "str_replace_editor", '{"command":"create","path":"g.ts","file_text":"t"}'),
    toolResult(15, "s3", undefined, "ok"),
  ];
  const { steps } = buildRestorePlan(events, 9);
  assert.equal(steps.get("f.ts")!.length, 2);
  assert.deepEqual(steps.get("f.ts")![0], { op: "str_replace_editor", newText: "B", oldText: "A" });
  assert.equal(steps.get("f.ts")![1]!.newText, "\nX"); // insert 反向片段
  assert.deepEqual(steps.get("g.ts"), [{ op: "str_replace_editor", newText: "", oldText: null, deleteAfter: true }]);
});

test("buildRestorePlan: ignores events at/before boundary", () => {
  const events = [
    toolCall(5, "c0", "write", '{"file_path":"keep.txt","content":"old"}'),
    toolResult(6, "c0", { diffs: [{ path: "keep.txt", oldText: "x", newText: "old" }] }),
    toolCall(10, "c1", "write", '{"file_path":"a.txt","content":"v2"}'),
    toolResult(11, "c1", { diffs: [{ path: "a.txt", oldText: "v1", newText: "v2" }] }),
  ];
  const { steps } = buildRestorePlan(events, 9);
  assert.equal(steps.has("keep.txt"), false);
  assert.ok(steps.get("a.txt"));
});

/* ---------------- buildReverseSteps ---------------- */

test("buildReverseSteps: reverses chrono order", () => {
  const chrono = [
    { op: "edit", newText: "b", oldText: "a" },
    { op: "edit", newText: "c", oldText: "b" },
  ];
  assert.deepEqual(buildReverseSteps(chrono), [
    { op: "edit", newText: "c", oldText: "b" },
    { op: "edit", newText: "b", oldText: "a" },
  ]);
});

test("buildReverseSteps: create (deleteAfter) is oldest → lands last after reverse", () => {
  const chrono = [
    { op: "write", newText: "", oldText: null, deleteAfter: true },
    { op: "edit", newText: "b", oldText: "a" },
  ];
  const reverse = buildReverseSteps(chrono);
  assert.ok(reverse);
  assert.equal(reverse.length, 2);
  assert.equal(reverse[0]?.deleteAfter, undefined); // 先回退编辑
  assert.equal(reverse[1]?.deleteAfter, true); // 最后删除
});

test("buildReverseSteps: deleteAfter not at index 0 → invalid (null)", () => {
  const chrono = [
    { op: "edit", newText: "b", oldText: "a" },
    { op: "write", newText: "", oldText: null, deleteAfter: true },
  ];
  assert.equal(buildReverseSteps(chrono), null);
});

test("buildReverseSteps: empty → null", () => {
  assert.equal(buildReverseSteps([]), null);
});

/* ---------------- 端到端：事件 → 计划 → 反向应用 → 文件内容 ---------------- */

import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("e2e: full restore pipeline on a temp workspace", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-rewind-"));
  try {
    // 起始状态（边界点，seq 0-8 已存在）
    const aPath = join(dir, "a.txt");
    const bPath = join(dir, "b.txt");
    const cPath = join(dir, "c.txt");
    writeFileSync(aPath, "line1\nline2 OLD\nline3\n");
    writeFileSync(bPath, "keep\n");

    // seq 10+: write a.txt (OLD→NEW), edit a.txt (NEW→NEW2), write c.txt (create)
    const events = [
      toolCall(10, "w1", "write", JSON.stringify({ file_path: "a.txt", content: "line1\nline2 NEW\nline3\n" })),
      toolResult(11, "w1", { diffs: [{ path: "a.txt", oldText: "line1\nline2 OLD\nline3", newText: "line1\nline2 NEW\nline3" }] }),
      toolCall(12, "e1", "edit", JSON.stringify({ file_path: "a.txt", old_string: "NEW", new_string: "NEW2" })),
      toolResult(13, "e1", { diffs: [{ path: "a.txt", oldText: "line2 NEW", newText: "line2 NEW2" }] }),
      toolCall(14, "w2", "write", JSON.stringify({ file_path: "c.txt", content: "created\n" })),
      toolResult(15, "w2", undefined, [{ type: "text", text: "<path>c.txt</path>\n<type>file</type>\n<content>\nCreated file\n</content>" }]),
    ];

    // 磁盘当前状态 = 最后一次操作后
    writeFileSync(aPath, "line1\nline2 NEW2\nline3\n");
    writeFileSync(cPath, "created\n");

    const boundary = 9;
    const { steps, skipped } = buildRestorePlan(events, boundary);
    assert.equal(skipped.length, 0);

    const restored: string[] = [];
    for (const [path, chronoSteps] of steps) {
      const reverse = buildReverseSteps(chronoSteps);
      assert.ok(reverse);
      const abs = path.startsWith("/") ? path : join(dir, path);
      const current = readFileSync(abs, "utf8");
      const result = applyReverseSteps(current, reverse!);
      assert.ok(result);
      if (result === "\u0000DELETE\u0000") {
        if (existsSync(abs)) unlinkSync(abs);
        restored.push(path);
      } else {
        writeFileSync(abs, result);
        restored.push(path);
      }
    }

    // a.txt 回到边界点；c.txt 被删；b.txt 未动
    assert.equal(readFileSync(aPath, "utf8"), "line1\nline2 OLD\nline3\n");
    assert.equal(existsSync(cPath), false);
    assert.equal(readFileSync(bPath, "utf8"), "keep\n");
    assert.deepEqual(restored.sort(), ["a.txt", "c.txt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("e2e: ambiguous match fails closed (file untouched)", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-rewind-"));
  try {
    const fPath = join(dir, "dup.txt");
    writeFileSync(fPath, "A\nB\nA\nB\n");
    // 一次 edit 命中两处相同的 newText → 反向歧义，应整体放弃
    const events = [
      toolCall(10, "d1", "edit", JSON.stringify({ file_path: "dup.txt", old_string: "B", new_string: "X" })),
      toolResult(11, "d1", { diffs: [{ path: "dup.txt", oldText: "B", newText: "X" }] }),
    ];
    const { steps } = buildRestorePlan(events, 9);
    const chrono = steps.get("dup.txt")!;
    const reverse = buildReverseSteps(chrono)!;
    // 当前磁盘是 after 状态（两处 X）
    writeFileSync(fPath, "A\nX\nA\nX\n");
    const result = applyReverseSteps(readFileSync(fPath, "utf8"), reverse);
    assert.equal(result, null); // 失败，不写盘
    assert.equal(readFileSync(fPath, "utf8"), "A\nX\nA\nX\n"); // 未被写坏
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
