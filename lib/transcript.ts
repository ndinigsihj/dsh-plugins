// Transcript model: folds the session/event feed into renderable rows.
//
// The model is append-only and renderer-agnostic. Rows carry plain text plus
// optional presenter views; the renderer (app.ts) turns rows into terminal
// lines. Every mutation bumps `revision` so the renderer can cache its output
// keyed by (revision, width) instead of rebuilding text nodes each frame.

import type { SessionEvent } from "@deepseek-ai/dsh-session/types";
import type { ToolCallView, ToolResultView } from "@deepseek-ai/dsh-tools/presentation";

export type TranscriptRow =
  | { kind: "user"; text: string; seq: number }
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
  | { kind: "context"; text: string; seq: number };

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

export class TranscriptModel {
  private rows: TranscriptRow[] = [];
  private revision = 0;
  private openAssistant: Extract<TranscriptRow, { kind: "assistant" }> | null = null;
  private toolByCall = new Map<string, Extract<TranscriptRow, { kind: "tool" }>>();
  private lastSeq = -1;
  private noticeSeq = -1;

  get snapshot(): ReadonlyArray<TranscriptRow> {
    return this.rows;
  }

  get currentRevision(): number {
    return this.revision;
  }

  private bump(): void {
    this.revision += 1;
  }

  /** Append a non-session row (command output). */
  addNotice(text: string): void {
    this.rows.push({ kind: "notice", text, seq: this.noticeSeq });
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
    this.lastSeq = -1;
    this.noticeSeq = -1;
    this.bump();
  }

  /** Rebuild transcript from an already-materialized session log (resume path). */
  rebuild(events: readonly SessionEvent[], presenters: ToolPresenters): void {
    this.clear();
    for (const event of events) this.apply(event, presenters);
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
        this.rows.push({ kind: "error", text: `Compaction failed: ${data.error}`, seq: event.seq });
      } else {
        this.rows.push({
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
        const content = data.content ?? [];
        const { text, reasoning } = splitContent(content);
        const joined = text || reasoning;
        if (joined === "") break;
        // Injected context (runtime snapshots, reminders) is plugin-sourced;
        // render it dim, distinct from a human user message.
        if (data.source?.kind === "plugin") {
          this.rows.push({ kind: "context", text: joined, seq: event.seq });
        } else {
          this.rows.push({ kind: "user", text: joined, seq: event.seq });
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
          this.bump();
        } else if (chunk.type === "block-end" && chunk.block?.type === "text") {
          this.openAssistant ??= this.pushAssistant(event.seq);
        }
        break;
      }
      case "assistant/message": {
        const message = (
          event.data as { message?: { content?: ReadonlyArray<ContentLike> } } | undefined
        )?.message;
        if (message === undefined) break;
        const { text, reasoning } = splitContent(message.content ?? []);
        if (this.openAssistant === null) {
          if (text === "" && reasoning === "") break;
          this.rows.push({ kind: "assistant", text, reasoning, done: true, seq: event.seq });
        } else {
          this.openAssistant.text = text;
          this.openAssistant.reasoning = reasoning;
          this.openAssistant.done = true;
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
        this.rows.push(row);
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
        const content = data.message?.content ?? [];
        const resultBlock = content.find((b) => b.type === "tool-result");
        const callId = String(resultBlock?.toolCallId ?? "");
        const row = this.toolByCall.get(callId);
        if (row !== undefined) {
          row.resultView = presenters.presentResult(row.name, row.args, {
            content,
            isError: data.error !== undefined,
            meta: data.meta,
          });
          if (data.error !== undefined) row.error = data.error;
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
          this.rows.push({
            kind: "error",
            text: `${reason.error?.code ?? "error"}: ${reason.error?.message ?? "unknown"}`,
            seq: event.seq,
          });
        } else if (reason.kind === "max-tokens") notice = "Turn ended: max tokens reached.";
        else if (reason.kind === "aborted") notice = "Turn stopped.";
        else if (reason.kind === "rejected") notice = "Turn rejected.";
        else if (reason.kind === "interrupted") notice = "Turn interrupted.";
        else if (reason.kind !== "completed") notice = `Turn ended: ${reason.kind}.`;
        if (notice !== "") this.rows.push({ kind: "notice", text: notice, seq: event.seq });
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
    this.rows.push(row);
    return row;
  }
}
