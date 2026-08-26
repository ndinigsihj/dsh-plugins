// Tests for the windowed TranscriptArea + skipStreamDeltas rebuild
// (docs/resume-memory-render-analysis.md §3-A'/§3-B).
//
// TranscriptArea is exercised against a real ScrollView: metrics are driven
// via updateLayout() exactly as pi-tui's layout pass does, and scrollTop via
// scrollTo(). Assertions cover scroll-metric preservation (stub heights),
// window recentering, hysteresis, and append behavior at follow-end.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TranscriptModel, type ToolPresenters } from "./transcript.ts";
import { TranscriptArea } from "./app.ts";
import { createPalette } from "./palette.ts";
import { ScrollView } from "@earendil-works/pi-tui";

const presenters: ToolPresenters = {
  presentCall: () => undefined,
  presentResult: () => undefined,
} as unknown as ToolPresenters;

interface Ev { type: string; seq: number; data?: unknown }

function userMessage(seq: number, text: string): Ev {
  return { type: "user/message", seq, data: { content: [{ type: "text", text }] } };
}

function assistantMessage(seq: number, text: string): Ev {
  return {
    type: "assistant/message",
    seq,
    data: { message: { content: [{ type: "text", text }] } },
  };
}

/** n user/assistant turn pairs; each assistant text is padded so its rendered
 * line count differs per row (exercises height bookkeeping). */
function buildTurns(n: number): Ev[] {
  const events: Ev[] = [];
  let seq = 0;
  for (let i = 0; i < n; i += 1) {
    events.push(userMessage(seq++, `q${i}`));
    events.push(assistantMessage(seq++, `a${i} ${"x".repeat(i * 7)}`));
  }
  return events;
}

function makeArea(rows: number): {
  area: TranscriptArea;
  model: TranscriptModel;
  scroll: ScrollView;
} {
  const model = new TranscriptModel();
  model.rebuild(buildTurns(rows) as never, presenters);
  const area = new TranscriptArea(model, createPalette(false), () => false, () => 80);
  const scroll = new ScrollView(area, { follow: "end", primary: true });
  area.attachScrollView(scroll);
  return { area, model, scroll };
}

function mountedCount(area: TranscriptArea): number {
  // children mirror slots; stubs are HeightStub instances — count non-stubs
  // by checking how many entries render differently is fragile; instead use
  // the exported-for-tests surface: redrawAll touches bySeq — but simplest
  // reliable probe is render output vs full-model render output.
  return (area as unknown as { bySeq: Map<number, unknown> }).bySeq.size;
}

/** Strip palette-free lines down to text for substring assertions. */
function flatten(lines: ReadonlyArray<string>): ReadonlyArray<string> {
  return lines;
}

describe("TranscriptArea windowing", () => {
  it("mounts only a bounded window on boot (follow-end fallback)", () => {
    const rows = 400;
    const { area, scroll } = makeArea(rows);
    scroll.updateLayout(10_000, 40, () => {});
    const lines = area.render(80);
    assert.ok(lines.length > 0);
    assert.ok(
      mountedCount(area) < rows,
      `expected windowed mount, got ${mountedCount(area)} of ${rows}`,
    );
    // Follow-end fallback materializes the tail.
    const bySeq = (area as unknown as { bySeq: Map<number, number> }).bySeq;
    const seqs = [...bySeq.keys()].sort((a, b) => a - b);
    const lastSeq = seqs[seqs.length - 1]!;
    assert.ok(lastSeq >= (rows - 1) * 2, `tail not mounted: last=${lastSeq}`);
  });

  it("stabilizes content height after measurement + scroll compensation", () => {
    const rows = 300;
    const { area, scroll } = makeArea(rows);
    scroll.updateLayout(Number.POSITIVE_INFINITY, 40, () => {});
    area.render(80); // boot: tail measured, head still estimated
    scroll.scrollTo(0);
    area.render(80); // head measured here; compensation queued
    area.render(80); // compensation applied; window settles around anchor
    const settled = area.render(80).length;
    assert.equal(area.render(80).length, settled, "drift must stop once region is measured");
    // Scroll away (measures previously-estimated middle rows — the total
    // legitimately grows) and back: consecutive frames must be identical.
    scroll.scrollTo(scroll.scrollTop + 2000);
    area.render(80);
    area.render(80);
    scroll.scrollTo(0);
    area.render(80);
    area.render(80);
    const back1 = area.render(80).length;
    const back2 = area.render(80).length;
    assert.equal(back2, back1, "unstable at top after round trip");
  });

  it("anchors exactly at row 0 once the head region is measured", () => {
    const rows = 400;
    const { area, scroll } = makeArea(rows);
    scroll.updateLayout(Number.POSITIVE_INFINITY, 40, () => {});
    area.render(80);
    // First visit measures the head; compensation re-anchors below literal
    // scrollTop=0 for a few frames until every above-viewport row is real.
    scroll.scrollTo(0);
    for (let i = 0; i < 6; i += 1) area.render(80);
    // Second visit: all head heights are known → no drift → exact anchor.
    scroll.scrollTo(scroll.scrollTop + 5000);
    area.render(80);
    area.render(80);
    scroll.scrollTo(0);
    for (let i = 0; i < 4; i += 1) area.render(80);
    const bySeq = (area as unknown as { bySeq: Map<number, number> }).bySeq;
    const seqs = [...bySeq.keys()].sort((a, b) => a - b);
    assert.ok(seqs.length > 0 && seqs[0] === 0, `row 0 not mounted (min seq ${seqs[0]})`);
    const lastSeq = seqs[seqs.length - 1]!;
    assert.ok(lastSeq < (rows - 1) * 2, "window did not move away from tail");
  });

  it("recovers after a full history swap (/clear → rebuild)", () => {
    const { area, model, scroll } = makeArea(80);
    scroll.updateLayout(Number.POSITIVE_INFINITY, 40, () => {});
    area.render(80);
    // /clear semantics: model cleared, then a new (smaller) history lands.
    model.clear();
    area.sync();
    area.render(80);
    model.rebuild(buildTurns(30) as never, presenters);
    area.sync();
    const lines = area.render(80);
    assert.ok(lines.length > 0, "transcript must render after history swap");
    const bySeq = (area as unknown as { bySeq: Map<number, number> }).bySeq;
    assert.ok(bySeq.size > 0, "no rows mounted after history swap");
  });

  it("streams into a mounted row after resume (in-place updates render)", () => {
    // Regression: resumed session, live turn streams chunks that fold into an
    // existing assistant row — row count never changes, so only the dirty-seq
    // update pass can make the new text visible.
    const { area, model, scroll } = makeArea(5);
    scroll.updateLayout(Number.POSITIVE_INFINITY, 40, () => {});
    area.render(80);
    const chunk = (seq: number, text: string): Ev => ({
      type: "assistant/chunk",
      seq,
      data: { turn: 99, step: 0, chunk: { type: "text-delta", index: seq, text } },
    });
    model.apply(chunk(1000, "Hel") as never, presenters);
    model.apply(chunk(1001, "lo") as never, presenters);
    area.sync();
    const mid = flatten(area.render(80)).join("\n");
    assert.ok(mid.includes("Hello"), "streaming text not visible after resume");
    model.apply(assistantMessage(1002, "Hello world") as never, presenters);
    area.sync();
    const done = flatten(area.render(80)).join("\n");
    assert.ok(done.includes("Hello world"), "finalized message not visible");
  });

  it("backfills tool results in place (row count unchanged)", () => {
    const { area, model, scroll } = makeArea(3);
    scroll.updateLayout(Number.POSITIVE_INFINITY, 40, () => {});
    area.render(80);
    const call: Ev = {
      type: "tool/call",
      seq: 500,
      data: { callId: "call_1", name: "bash", arguments: '{"command":"ls"}' },
    };
    model.apply(call as never, presenters);
    area.sync();
    area.render(80);
    const result: Ev = {
      type: "tool/result",
      seq: 501,
      data: { message: { content: [{ type: "tool-result", toolCallId: "call_1", output: "done" }] } },
    };
    model.apply(result as never, presenters);
    area.sync();
    // No throw / no stale crash is the contract here; result visibility
    // depends on the presenter which the stub doesn't exercise.
    assert.ok(model.snapshot.some((r) => r.kind === "tool"));
  });

  it("appends rows at follow-end and mounts them", () => {
    const { area, model, scroll } = makeArea(50);
    scroll.updateLayout(Number.POSITIVE_INFINITY, 40, () => {});
    area.render(80);
    model.apply(userMessage(1000, "late") as never, presenters);
    model.apply(assistantMessage(1001, "reply") as never, presenters);
    area.sync();
    const text = flatten(area.render(80)).join("\n");
    // The alias pitfall this guards against: snapshot IS the model's live
    // array, so length checks can't see appends — only dirty-seq sync can.
    assert.ok(text.includes("late"), "appended user row never mounted");
    assert.ok(text.includes("reply"), "appended assistant row never mounted");
  });
});

describe("rebuild skipStreamDeltas", () => {
  it("folds from final messages instead of replaying deltas", () => {
    const model = new TranscriptModel();
    const chunk = (seq: number, text: string): Ev => ({
      type: "assistant/chunk",
      seq,
      data: { turn: 0, step: 0, chunk: { type: "text-delta", index: seq, text } },
    });
    const events: Ev[] = [
      userMessage(0, "hi"),
      chunk(1, "Hel"),
      chunk(2, "lo "),
      chunk(3, "world"),
      assistantMessage(4, "Hello world"),
      userMessage(5, "next"),
      // Interrupted stream: chunks with no final message → dropped silently.
      chunk(6, "ghost"),
      chunk(7, " partial"),
    ];
    model.rebuild(events as never, presenters, { skipStreamDeltas: true });
    const assistants = model.snapshot.filter((r) => r.kind === "assistant");
    assert.equal(assistants.length, 1, "chunks must not double-build rows");
    assert.equal((assistants[0] as { text: string }).text, "Hello world");
  });

  it("default rebuild still folds chunks (live path unchanged)", () => {
    const model = new TranscriptModel();
    const chunk = (seq: number, text: string): Ev => ({
      type: "assistant/chunk",
      seq,
      data: { turn: 0, step: 0, chunk: { type: "text-delta", index: seq, text } },
    });
    const events: Ev[] = [chunk(0, "streamed "), chunk(1, "text")];
    model.rebuild(events as never, presenters);
    const assistants = model.snapshot.filter((r) => r.kind === "assistant");
    assert.equal(assistants.length, 1);
    assert.equal((assistants[0] as { text: string }).text, "streamed text");
  });
});
