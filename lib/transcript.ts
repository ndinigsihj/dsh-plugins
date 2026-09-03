// Transcript model: folds the session/event feed into renderable rows.
//
// The model is append-only and renderer-agnostic. Rows carry plain text plus
// optional presenter views; the renderer (app.ts) turns rows into terminal
// lines. Every mutation bumps `revision` so the renderer can cache its output
// keyed by (revision, width) instead of rebuilding text nodes each frame.

import type { SessionEvent } from "@deepseek-ai/dsh-session/types";
import type { ToolCallView, ToolResultView } from "@deepseek-ai/dsh-tools/presentation";

export type TranscriptRow =
  | { kind: "user"; text: string; images?: string[]; seq: number }
  | {
      kind: "assistant";
      /** Visible markdown text; reasoning is folded into a dim section. */
      text: string;
      reasoning: string;
      done: boolean;
      seq: number;
    }
  | {
      kind: "tool";
      name: string;
      args: unknown;
      seq: number;
      callView?: ToolCallView;
      resultView?: ToolResultView;
      error?: { name: string; code: string };
      /** Set while an approval dialog is open for this still-pending call. */
      awaitingApproval?: boolean;
    }
  | { kind: "notice"; text: string; seq: number }
  | { kind: "error"; text: string; seq: number }
  | { kind: "context"; text: string; seq: number }
  | {
      /** Boot-time welcome block (blank sessions only); carries pre-styled
       * text and is skipped by /export. */
      kind: "banner";
      text: string;
      seq: number;
    };

/** One entry of the model's todo list (todo/write snapshots, last-write-wins). */
export interface TodoItem {
  content: string;
  status: string;
}

interface ContentLike {
  type: string;
  text?: unknown;
  id?: unknown;
  toolCallId?: unknown;
  content?: unknown;
}

/** Extract visible text and reasoning text from a message content array. */
function splitContent(content: ReadonlyArray<ContentLike>): { text: string; reasoning: string } {
  let text = "";
  let reasoning = "";
  for (const block of content) {
    if (block.type === "text") text += String(block.text ?? "");
    else if (block.type === "reasoning") reasoning += String(block.text ?? "");
  }
  return { text, reasoning };
}

/** Presenter signature the model uses to decorate tool rows. */
export interface ToolPresenters {
  presentCall(name: string, args: unknown): ToolCallView | undefined;
  presentResult(
    name: string,
    args: unknown,
    result: { content: ReadonlyArray<ContentLike>; isError: boolean; meta?: unknown },
  ): ToolResultView | undefined;
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** Shared empty result for takeDirtySeqs() — avoids allocating per frame. */
const EMPTY_DIRTY: ReadonlySet<number> = new Set<number>();

export class TranscriptModel {
  private rows: TranscriptRow[] = [];
  private revision = 0;
  private openAssistant: Extract<TranscriptRow, { kind: "assistant" }> | null = null;
  private toolByCall = new Map<string, Extract<TranscriptRow, { kind: "tool" }>>();
  private lastSeq = -1;
  private noticeSeq = -1;
  /** Seqs mutated in place since the last takeDirtySeqs() — streaming chunk
   * folds, tool-result backfills, finalizations. The windowed TranscriptArea
   * updates only these mounted components (a plain length check can't see
   * in-place changes; missing this was the "resumed session stops
   * displaying live turns" regression of 2026-08-26). */
  private readonly dirtySeqs = new Set<number>();
  /** seq → position in rows, maintained at push time. The authoritative
   * ordering map for the UI layer: notice/banner rows carry negative seqs
   * and interleave by insertion order, so seq-sorted views cannot reconstruct
   * positions (2026-08-26 boot-crash follow-up). */
  private readonly rowIndex = new Map<number, number>();

  get snapshot(): ReadonlyArray<TranscriptRow> {
    return this.rows;
  }

  get currentRevision(): number {
    return this.revision;
  }

  /** Live row count — the UI slot list sizes itself to this. */
  get rowCount(): number {
    return this.rows.length;
  }

  /** Authoritative row by position (slots and rows share insertion order). */
  rowAt(index: number): TranscriptRow | undefined {
    return this.rows[index];
  }

  /** Authoritative row by seq (push-time index map, notice-safe). */
  rowBySeq(seq: number): TranscriptRow | undefined {
    const idx = this.rowIndex.get(seq);
    return idx === undefined ? undefined : this.rows[idx];
  }

  /** Register a push: index bookkeeping + dirty marking in one place. */
  private pushRow(row: TranscriptRow): void {
    this.rows.push(row);
    this.rowIndex.set(row.seq, this.rows.length - 1);
    this.markDirty(row.seq);
  }

  /** Drain the in-place mutation set (append-only growth is tracked by the
   * caller via snapshot length). */
  takeDirtySeqs(): ReadonlySet<number> {
    if (this.dirtySeqs.size === 0) return EMPTY_DIRTY;
    const drained = new Set(this.dirtySeqs);
    this.dirtySeqs.clear();
    return drained;
  }

  private markDirty(seq: number): void {
    this.dirtySeqs.add(seq);
  }

  private bump(): void {
    this.revision += 1;
  }

  /** Append a non-session row (command output). */
  addNotice(text: string): void {
    this.pushRow({ kind: "notice", text, seq: this.noticeSeq });
    this.noticeSeq -= 1;
    this.bump();
  }

  /** Append the boot-time welcome block (client-side only, never exported). */
  addBanner(text: string): void {
    this.pushRow({ kind: "banner", text, seq: this.noticeSeq });
    this.noticeSeq -= 1;
    this.bump();
  }

  /** Flag the newest still-pending call of `toolName` for the approval card
   * to point at; false when no matching pending row exists. */
  flagPendingTool(toolName: string): boolean {
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      const row = this.rows[i];
      if (row === undefined || row.kind !== "tool") continue;
      if (row.resultView !== undefined || row.error !== undefined) continue;
      if (row.name !== toolName) continue;
      row.awaitingApproval = true;
      this.markDirty(row.seq);
      this.bump();
      return true;
    }
    return false;
  }

  /** Drop every approval flag; true when anything changed. */
  clearApprovalFlags(): boolean {
    let changed = false;
    for (const row of this.rows) {
      if (row.kind === "tool" && row.awaitingApproval === true) {
        row.awaitingApproval = undefined;
        this.markDirty(row.seq);
        changed = true;
      }
    }
    if (changed) this.bump();
    return changed;
  }

  clear(): void {
    this.rows = [];
    this.openAssistant = null;
    this.toolByCall.clear();
    this.dirtySeqs.clear();
    this.rowIndex.clear();
    this.lastSeq = -1;
    this.noticeSeq = -1;
    this.bump();
  }

  /** Rebuild transcript from an already-materialized session log (resume path).
   * `skipStreamDeltas` folds from assistant/message final states instead of
   * replaying every persisted streaming delta: a large resumed log expands
   * to hundreds of thousands of chunk events whose only contribution here is
   * re-deriving text the final message already contains (2026-08-26
   * resume-perf analysis, docs/resume-memory-render-analysis.md §3-B).
   * Interrupted streams that never reached a final message lose their
   * partial bubble — cosmetic, and the session log keeps everything. Live
   * streaming still applies chunks; this flag is for bulk replay only. */
  rebuild(
    events: readonly SessionEvent[],
    presenters: ToolPresenters,
    opts: { skipStreamDeltas?: boolean } = {},
  ): void {
    this.clear();
    const skipDeltas = opts.skipStreamDeltas === true;
    for (const event of events) {
      if (skipDeltas && event.type === "assistant/chunk") continue;
      this.apply(event, presenters);
    }
  }

  apply(event: SessionEvent, presenters: ToolPresenters): void {
    if (event.seq <= this.lastSeq) return; // ignore out-of-order / replayed feed
    this.lastSeq = event.seq;

    // Plugin-merged events (compaction) are not part of the core SessionEvent
    // type union; handle them by string discriminant before the typed switch.
    const typeName = (event as { type: string }).type;
    if (typeName === "compaction/end") {
      const data = (event as unknown as { data?: { error?: string } }).data;
      if (data?.error !== undefined) {
        this.pushRow({ kind: "error", text: `Compaction failed: ${data.error}`, seq: event.seq });
      } else {
        this.pushRow({
          kind: "notice",
          text: "… earlier context was compacted …",
          seq: event.seq,
        });
      }
      this.bump();
      return;
    }

    switch (event.type) {
      case "user/message": {
        // External feed: never trust the envelope shape — a malformed event
        // must be skipped, not thrown through ctx.on's dispatch chain.
        const data = (event.data ?? {}) as {
          content?: ReadonlyArray<ContentLike>;
          source?: { kind?: string };
        };
        const content = Array.isArray(data.content) ? data.content : [];
        const { text, reasoning } = splitContent(content);
        const imageLabels = content
          .filter((b) => (b as { type?: unknown }).type === "image")
          .map((b) => {
            const att = (b as { attachment?: { attachmentId?: unknown } }).attachment;
            const id = typeof att?.attachmentId === "string" ? att.attachmentId : "";
            return `[图片 ${id.slice(0, 8) || "?"}]`;
          });
        const joined = text || reasoning;
        if (joined === "" && imageLabels.length === 0) break;
        // Injected context (runtime snapshots, reminders) is plugin-sourced;
        // render it dim, distinct from a human user message.
        if (data.source?.kind === "plugin") {
          this.pushRow({ kind: "context", text: joined, seq: event.seq });
        } else {
          this.pushRow({
            kind: "user",
            text: joined,
            images: imageLabels.length > 0 ? imageLabels : undefined,
            seq: event.seq,
          });
        }
        this.bump();
        break;
      }
      case "assistant/chunk": {
        const chunk = (
          event.data as { chunk?: { type: string; text?: string; block?: ContentLike } } | undefined
        )?.chunk;
        if (chunk === undefined) break;
        if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") {
          const delta = chunk.text ?? "";
          if (delta === "") break;
          const row = (this.openAssistant ??= this.pushAssistant(event.seq));
          if (chunk.type === "text-delta") row.text += delta;
          else row.reasoning += delta;
          this.markDirty(row.seq);
          this.bump();
        } else if (chunk.type === "block-end" && chunk.block?.type === "text") {
          if (this.openAssistant === null) {
            this.openAssistant = this.pushAssistant(event.seq);
            // A fresh block-end with no earlier text-delta must bump so the
            // windowed TranscriptArea mounts the new row immediately.
            this.bump();
          }
        }
        break;
      }
      case "assistant/message": {
        const message = (
          event.data as { message?: { content?: ReadonlyArray<ContentLike> } } | undefined
        )?.message;
        if (message === undefined) break;
        const { text, reasoning } = splitContent(Array.isArray(message.content) ? message.content : []);
        if (this.openAssistant === null) {
          if (text === "" && reasoning === "") break;
          this.pushRow({ kind: "assistant", text, reasoning, done: true, seq: event.seq });
        } else {
          this.openAssistant.text = text;
          this.openAssistant.reasoning = reasoning;
          this.openAssistant.done = true;
          this.markDirty(this.openAssistant.seq);
          this.openAssistant = null;
        }
        this.bump();
        break;
      }
      case "tool/call": {
        const data = event.data as Partial<{ callId: string; name: string; arguments: string }> | undefined;
        if (typeof data?.callId !== "string" || typeof data.name !== "string") break;
        const args = parseArgs(data.arguments ?? "");
        const row: Extract<TranscriptRow, { kind: "tool" }> = {
          kind: "tool",
          name: data.name,
          args,
          seq: event.seq,
          callView: presenters.presentCall(data.name, args),
        };
        this.pushRow(row);
        this.toolByCall.set(data.callId, row);
        this.bump();
        break;
      }
      case "tool/result": {
        const data = event.data as
          | {
              message?: { content?: ReadonlyArray<ContentLike> };
              error?: { name: string; code: string };
              meta?: unknown;
            }
          | undefined;
        if (data === undefined) break;
        const content = Array.isArray(data.message?.content) ? data.message.content : [];
        const resultBlock = content.find((b) => b.type === "tool-result");
        const callId = String(resultBlock?.toolCallId ?? "");
        const row = this.toolByCall.get(callId);
        if (row !== undefined) {
          const contentError = content.some(
            (b) => (b as { isError?: unknown }).isError === true,
          );
          row.resultView = presenters.presentResult(row.name, row.args, {
            content,
            isError: data.error !== undefined || contentError,
            meta: data.meta,
          });
          if (data.error !== undefined) row.error = data.error;
          this.markDirty(row.seq);
        }
        this.bump();
        break;
      }
      case "turn/end": {
        const reason = (
          event.data as
            | { reason?: { kind: string; error?: { code: string; message: string } } }
            | undefined
        )?.reason;
        if (reason === undefined) break;
        let notice = "";
        if (reason.kind === "error") {
          this.pushRow({
            kind: "error",
            text: `${reason.error?.code ?? "error"}: ${reason.error?.message ?? "unknown"}`,
            seq: event.seq,
          });
        } else if (reason.kind === "max-tokens") notice = "Turn ended: max tokens reached.";
        else if (reason.kind === "aborted") notice = "Turn stopped.";
        else if (reason.kind === "rejected") notice = "Turn rejected.";
        else if (reason.kind === "interrupted") notice = "Turn interrupted.";
        else if (reason.kind !== "completed") notice = `Turn ended: ${reason.kind}.`;
        if (notice !== "") this.pushRow({ kind: "notice", text: notice, seq: event.seq });
        // An interrupted/aborted turn can end without an assistant/message
        // finalizer; close any open streaming bubble so the NEXT turn's chunks
        // start a fresh row instead of appending to this one ("Hel"+"Hi" bug).
        if (this.openAssistant !== null) {
          this.openAssistant.done = true;
          this.markDirty(this.openAssistant.seq);
          this.openAssistant = null;
        }
        this.bump();
        break;
      }
      default:
        // todo/write is consumed by the ambient gauge (app layer), not folded
        // into transcript rows — one source of truth, no duplicate cards.
        break;
    }
  }

  private pushAssistant(seq: number): Extract<TranscriptRow, { kind: "assistant" }> {
    const row: Extract<TranscriptRow, { kind: "assistant" }> = {
      kind: "assistant",
      text: "",
      reasoning: "",
      done: false,
      seq,
    };
    this.pushRow(row);
    return row;
  }
}
