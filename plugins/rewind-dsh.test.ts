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
  eventAtSeq,
  filePathFromArgs,
  replaceOnce,
  resolveUnderReal,
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

test("eventAtSeq: sparse relay session finds by seq, not array index", () => {
  const events = [
    ev(100, "turn/start"),
    ev(101, "user/message"),
    ev(16315, "user/message"), // relay mirror 里的 seq 可能从大数开始
  ];
  assert.equal(eventAtSeq(events, 16315)?.seq, 16315);
  assert.equal(eventAtSeq(events, 42), undefined);
});

test("boundary: sparse relay session (array index ≠ seq)", () => {
  const events = [
    ev(16300, "turn/start"),
    ev(16301, "user/message"),
    ev(16302, "assistant/message"),
    ev(16303, "turn/end"),
    ev(16304, "turn/start"),
    ev(16305, "user/message"), // 选中 16305
    ev(16306, "assistant/message"),
    ev(16307, "turn/end"),
  ];
  assert.equal(computeRewindBoundary(events, 16305), 16303);
  assert.equal(computeRewindBoundary(events, 16301), 16299); // 回退到该 turn 之前
  assert.equal(computeRewindBoundary(events, 42), undefined); // 越界
  // 第一个 turn（seq 0）之后、且 seq 稀疏：boundary 落到 -1 → undefined
  const firstTurn = [ev(0, "turn/start"), ev(16301, "user/message")];
  assert.equal(computeRewindBoundary(firstTurn, 16301), undefined);
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

test("applyReverseSteps: null oldText (pure insert) → remove newText", () => {
  // dsh-tool-fs 对纯插入/write 到空文件产出 oldText:null；反向是删除 newText。
  assert.equal(applyReverseSteps("xabc", [{ op: "edit", newText: "x", oldText: null }]), "abc");
  assert.equal(applyReverseSteps("abc", [{ op: "edit", newText: "abc", oldText: null }]), "");
});

test("applyReverseSteps: null oldText with ambiguous newText → null (fail closed)", () => {
  const current = "TARGET\nkeep\nTARGET";
  const steps = [{ op: "edit", newText: "TARGET", oldText: null }];
  assert.equal(applyReverseSteps(current, steps), null);
});

test("replaceOnce: empty target is always ambiguous → null", () => {
  assert.equal(replaceOnce("foo", "", "x"), null);
  assert.equal(replaceOnce("", "", ""), null);
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
  // Real shape: tool-result envelope's content is ContentBlock[]; callers that
  // pass a bare string (older fixtures) get it normalized to a text block so
  // the fixture matches the harness contract.
  const inner =
    typeof messageContent === "string"
      ? [{ type: "text", text: messageContent }]
      : messageContent;
  return {
    seq,
    type: "tool/result",
    data: {
      meta,
      // Real dsh shape: no top-level callId; it lives in message.source.callId
      // and message.content[].toolCallId, with text nested under the
      // tool-result envelope's own content.
      message: {
        source: { kind: "tool", callId },
        content: [
          {
            type: "tool-result",
            toolCallId: callId,
            content: inner,
            isError: false,
          },
        ],
      },
    },
  };
}

function toolResultFailed(seq: number, callId: string) {
  return {
    seq,
    type: "tool/result",
    data: {
      message: {
        source: { kind: "tool", callId },
        content: [
          {
            type: "tool-result",
            toolCallId: callId,
            content: [{ type: "text", text: "Error: boom" }],
            isError: true,
          },
        ],
      },
    },
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

test("buildRestorePlan: insert_line 0 uses no leading newline in reverse fragment", () => {
  const events = [
    toolCall(10, "i0", "str_replace_editor", '{"command":"insert","path":"f.ts","insert_line":0,"new_str":"X"}'),
    toolResult(11, "i0", undefined, "ok"),
  ];
  const { steps } = buildRestorePlan(events, 9);
  assert.equal(steps.get("f.ts")?.length, 1);
  assert.deepEqual(steps.get("f.ts")![0], { op: "str_replace_editor", newText: "X\n", oldText: "" });
});

test("buildRestorePlan: insert reverse fragment keeps trailing newline (insert_line 0)", () => {
  const events = [
    toolCall(10, "i0nl", "str_replace_editor", '{"command":"insert","path":"f.ts","insert_line":0,"new_str":"X\\n"}'),
    toolResult(11, "i0nl", undefined, "ok"),
  ];
  const { steps } = buildRestorePlan(events, 9);
  assert.deepEqual(steps.get("f.ts")![0], { op: "str_replace_editor", newText: "X\n\n", oldText: "" });
});

test("buildRestorePlan: insert reverse fragment keeps leading newline (insert_line > 0)", () => {
  const events = [
    toolCall(10, "i1nl", "str_replace_editor", '{"command":"insert","path":"f.ts","insert_line":2,"new_str":"\\nc"}'),
    toolResult(11, "i1nl", undefined, "ok"),
  ];
  const { steps } = buildRestorePlan(events, 9);
  assert.deepEqual(steps.get("f.ts")![0], { op: "str_replace_editor", newText: "\n\nc", oldText: "" });
});

test("applyReverseSteps: insert reverse restores exact file bytes", () => {
  // insert_line:0 + new_str "X\n" → after text "X\n\nc"; reverse removes "X\n\n" → "c"
  const steps0 = [{ op: "str_replace_editor", newText: "X\n\n", oldText: "" }];
  assert.equal(applyReverseSteps("X\n\nc", steps0), "c");
  // insert_line>0 + new_str "\nc" → after "a\n\nc\nb"; reverse removes "\n\nc" → "a\nb"
  const steps1 = [{ op: "str_replace_editor", newText: "\n\nc", oldText: "" }];
  assert.equal(applyReverseSteps("a\n\nc\nb", steps1), "a\nb");
});

test("buildRestorePlan: failed tool result is skipped, not restored", () => {
  const events = [
    toolCall(10, "f1", "write", '{"file_path":"a.txt","content":"v2"}'),
    toolResultFailed(11, "f1"),
    toolCall(12, "f2", "edit", '{"file_path":"a.txt","old_string":"v1","new_string":"v2"}'),
    toolResult(13, "f2", { diffs: [{ path: "a.txt", oldText: "v1", newText: "v2" }] }),
  ];
  const { steps, skipped } = buildRestorePlan(events, 9);
  assert.equal(steps.get("a.txt")?.length, 1);
  const firstSkipped = skipped[0];
  assert.ok(firstSkipped);
  assert.match(firstSkipped, /failed result/);
});

test("buildRestorePlan: real-shape callId extraction drives non-empty steps", () => {
  // Regression for H1: production tool/result has no top-level data.callId.
  const events = [
    toolCall(10, "call_real_1", "write", '{"file_path":"a.txt","content":"v2"}'),
    {
      seq: 11,
      type: "tool/result",
      data: {
        message: {
          source: { kind: "tool", callId: "call_real_1" },
          content: [
            {
              type: "tool-result",
              toolCallId: "call_real_1",
              content: [{ type: "text", text: "ok" }],
              isError: false,
            },
          ],
        },
        meta: { diffs: [{ path: "a.txt", oldText: "v1", newText: "v2" }] },
      },
    },
  ];
  const { steps, skipped } = buildRestorePlan(events, 9);
  assert.equal(skipped.length, 0);
  assert.equal(steps.get("a.txt")?.length, 1);
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

import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, unlinkSync, symlinkSync } from "node:fs";
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

test("resolveUnderReal: workspace-internal symlink to outside is rejected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-rewind-real-"));
  const outside = mkdtempSync(join(tmpdir(), "dsh-rewind-outside-"));
  try {
    const link = join(dir, "link");
    symlinkSync(outside, link, "dir");
    // 词法上在 workspace 内、但指向外部的 symlink → 拒绝
    assert.equal(await resolveUnderReal(dir, "link/secret.txt"), undefined);
    // 绝对路径直接越界 → 拒绝（词法层）
    assert.equal(await resolveUnderReal(dir, outside), undefined);
    // workspace 内普通文件 → 放行
    writeFileSync(join(dir, "ok.txt"), "x");
    assert.equal((await resolveUnderReal(dir, "ok.txt"))?.abs, join(dir, "ok.txt"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
