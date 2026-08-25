// The TUI application: pi-tui renderer mounted inside the dsh process.
//
// Owns terminal input and presentation only. Agent lifecycle, session
// persistence, tool execution, approval, and the model-facing question tool
// stay as separate in-process services; this module consumes them.

import { basename } from "node:path";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import {
  CombinedAutocompleteProvider,
  Container,
  Editor,
  Markdown,
  ProcessTerminal,
  ScrollView,
  SelectList,
  Text,
  TuiAltScreen,
  VStack,
  isViewportTUI,
  isKeyRelease,
  isKeyRepeat,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type EditorTheme,
  type MarkdownTheme,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
  type OverlayHandle,
  type SelectItem,
  type SelectListTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import { lineDiff } from "./diff.ts";
import { createPalette, type Palette } from "./palette.ts";
import { sanitizeDisplay } from "./sanitize.ts";
import { ClipboardTerminal } from "./terminal.ts";
import {
  TranscriptModel,
  type ToolPresenters,
  type TranscriptRow,
  type TodoItem,
} from "./transcript.ts";

/** The live agent surface the app drives. Narrow enough to be testable. */
export interface AgentSurface {
  id: string;
  status: "idle" | "running";
  followup(message: unknown): void;
  steer(message: unknown): void;
  cancel(): void;
  whenIdle(): Promise<void>;
}

export interface AskQuestionRequest {
  questions: Array<{
    id: string;
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    /** Harness wire flag: more than one option may be selected. */
    multiSelect?: boolean;
  }>;
}

export interface ApprovalRequest {
  toolName: string;
  reason?: string;
}

export interface RunningSubagent {
  id: string;
  mode: "one-shot" | "continuable";
  label?: string;
}

/** One live background job (ctx.jobs snapshot slice) for the ambient gauge. */
export interface RunningJob {
  id: string;
  label: string;
  status: "running" | "stopping";
}

/** The session's current goal, sliced from dsh-goal's projection value. */
export interface GoalSummary {
  objective: string;
  phase: "active" | "paused" | "blocked" | "complete";
  roundsStarted: number;
  maxGoalRounds: number;
}

/** One entry of the editor's slash-command menu (structural SlashCommand). */
export interface AutocompleteCommand {
  name: string;
  description?: string;
  argumentHint?: string;
  getArgumentCompletions?(
    argumentPrefix: string,
  ):
    | Array<{ value: string; label: string; description?: string }>
    | null
    | Promise<Array<{ value: string; label: string; description?: string }> | null>;
}

export interface TuiAppOptions {
  agent: AgentSurface;
  modelLabel: string;
  presenters: ToolPresenters;
  /** User submitted a non-command line. Decide send-vs-steer and dispatch. */
  onPrompt(text: string): void;
  /** Esc/Ctrl+C while a turn is running. */
  onCancel(): void;
  /** Exit requested (e.g. /exit). */
  onExit(): Promise<void>;
  /** Editor slash-command + @-file completion catalog (optional). */
  autocomplete?: { commands: AutocompleteCommand[] };
  /** Harness file-reference discovery as the @-completion source (optional;
   * absent → pi-tui's cwd-walk provider stays the only file source). */
  fileCompletions?: (
    query: string,
    signal: AbortSignal,
  ) => Promise<Array<{ path: string; kind: "file" | "directory" }>>;
  /** Cross-session mentions merged into the same @ menu (optional). Each
   * entry carries its canonical markdown mention ready for insertion. */
  sessionCompletions?: (
    query: string,
    signal: AbortSignal,
  ) => Promise<Array<{ mention: string; label: string; description?: string }>>;
  /** Async preview text for the highlighted session in the /resume picker. */
  sessionPreview?: SessionPreviewLoader;
}

function markdownTheme(p: Palette): MarkdownTheme {
  return {
    heading: (s) => p.bold(s),
    link: (s) => p.fg(s, "blue"),
    linkUrl: (s) => p.dim(s),
    code: (s) => p.fg(s, "cyan"),
    codeBlock: (s) => p.fg(s, "cyan"),
    codeBlockBorder: (s) => p.dim(s),
    quote: (s) => p.dim(s),
    quoteBorder: (s) => p.dim(s),
    hr: (s) => p.dim(s),
    listBullet: (s) => p.bold(s),
    bold: (s) => p.bold(s),
    italic: (s) => s,
    strikethrough: (s) => s,
    underline: (s) => p.underline(s),
  };
}

/** Printable input for the picker search field: not an escape sequence or control char. */
function isPrintableInput(data: string): boolean {
  if (data.startsWith("")) return false;
  if (data === "\r" || data === "\n" || data === "\t") return false;
  return data.codePointAt(0) !== undefined && data.codePointAt(0)! >= 0x20;
}

/** Compact token count: 999 → "999", 120_000 → "120k", 1_048_576 → "1m". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m < 10 ? m.toFixed(1) : String(Math.round(m))}m`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** Sliding window behind the live t/s gauge. */
const STREAM_WINDOW_MS = 3000;

/** Per-child line cap for the expanded subagent checklist. */
const SUBAGENTS_EXPAND_CAP = 12;

/** Rough live token estimate for streamed text: CJK ≈ 1 token/char, other
 * scripts ≈ 0.25. Only feeds the transient gauge — never any accounting. */
function estimateStreamTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    tokens += ch.codePointAt(0)! >= 0x2e80 ? 1 : 0.25;
  }
  return tokens;
}

/** One context-pressure reading for the status bar's right side. */
export interface ContextOccupancy {
  pct: number;
  usedTokens?: number;
  windowTokens?: number;
}

/**
 * The footer status bar: left-aligned facts (model id, cache hit rate,
 * workspace directory name), right-aligned context gauge. Rendered as one
 * padded line at the live terminal width; a transient notice replaces the
 * whole bar until it times out or is explicitly cleared.
 */
export class StatusLine implements Component {
  private readonly p: Palette;
  private left = "";
  private right = "";
  private notice: string[] | null = null;

  constructor(p: Palette) {
    this.p = p;
  }

  /** New facts; leaves any transient notice up: notices retire on their own
   * timer, an explicit clear, or a newer notice — never on a repaint, which
   * races event bursts and would erase them before they can be read. */
  setParts(left: string, right: string): void {
    this.left = left;
    this.right = right;
  }

  showNotice(text: string): void {
    this.notice = text.split("\n");
  }

  /** Retire the transient text; parts underneath keep their current values. */
  clearNotice(): void {
    this.notice = null;
  }

  render(width: number): string[] {
    if (this.notice !== null) return this.notice.map((line) => this.p.dim(line));
    const avail = Math.max(0, width);
    const sep = " · ";
    // The ctx gauge (right) is the payload and is truncated last; the left
    // segment clips from its tail (workspace name goes first).
    const right = truncateToWidth(this.right, Math.max(0, avail - 2));
    const maxLeft = Math.max(0, avail - visibleWidth(right) - 2);
    const left = truncateToWidth(this.left, maxLeft);
    const pad = Math.max(1, avail - visibleWidth(left) - visibleWidth(right));
    return [`${left}${" ".repeat(pad)}${right}`];
  }

  invalidate(): void {}
}

function selectListTheme(p: Palette): SelectListTheme {
  return {
    selectedPrefix: (s) => p.reverse(` ${s} `),
    selectedText: (s) => p.bold(s),
    description: (s) => p.dim(s),
    scrollInfo: (s) => p.dim(s),
    noMatch: (s) => p.dim(s),
  };
}

function editorTheme(p: Palette): EditorTheme {
  return {
    borderColor: (s) => p.dim(s),
    selectList: selectListTheme(p),
  };
}

/** A persisted row component: wraps a box, updates its children in place. */
interface RowComponent extends Component {
  update(row: TranscriptRow): void;
}

class UserRow implements RowComponent {
  private readonly box = new Container();
  private readonly text: Text;
  private readonly p: Palette;
  constructor(p: Palette, row: Extract<TranscriptRow, { kind: "user" }>) {
    this.p = p;
    this.text = new Text("", 1, 1);
    this.box.addChild(this.text);
    this.update(row);
  }
  update(row: Extract<TranscriptRow, { kind: "user" }>): void {
    this.text.setText(this.p.fg(this.boxPrefix() + row.text, "yellow"));
  }
  private boxPrefix(): string {
    return "> ";
  }
  render(width: number): string[] {
    return this.box.render(width);
  }
  invalidate(): void {
    this.box.invalidate();
  }
}

/** Braille spin frames for the collapsed thinking header (time-based frame). */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Hard-cap one ANSI-free line to `budget` display columns, appending an
 * ellipsis when anything was cut — keeps the line from wrapping inside a Text
 * component. Plain-text only on purpose: truncateToWidth closes the kept
 * fragment with an SGR reset BEFORE its ellipsis, so any wrapping dim/color
 * would not reach the marker. Inputs here are sanitizeDisplay'd (no escapes),
 * which makes the hand-rolled width walk both correct and cheaper. */
function fitColumns(line: string, budget: number): string {
  if (budget <= 0) return "";
  if (visibleWidth(line) <= budget) return line;
  let out = "";
  let w = 0;
  const limit = budget - 1; // room for the ellipsis itself
  for (const ch of line) {
    const cw = visibleWidth(ch);
    if (w + cw > limit) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

/** Max diff lines shown in collapsed mode before a "… N more" stub. */
const DIFF_COLLAPSED_CAP = 24;

/** Grace period for agent.whenIdle() during shutdown before forcing exit. */
const IDLE_EXIT_GRACE_MS = 5_000;

/** Max body lines rendered by an expanded tool card before an "… N more" stub. */
const TOOL_LINES_CAP = 40;

/** dsh-spill-policy's trailing notice inside oversized tool results:
 * '(N bytes omitted … Full formatted result stored at: <locator>. <hint>)'.
 * The locator is rendered as a compact badge instead of prose. */
const SPILL_NOTICE_RE = /\([^()]*Full formatted result stored at: (.+?)\. /;

class AssistantRow implements RowComponent {
  private readonly box = new Container();
  private readonly reasoning: Text;
  private readonly markdown: Markdown;
  private readonly p: Palette;
  private readonly isExpanded: () => boolean;
  private readonly getWidth: () => number;
  private reasoningText = "";
  private done = false;
  /** Terminal width the collapsed block was last formatted for. */
  private formattedAtWidth = -1;
  constructor(
    p: Palette,
    row: Extract<TranscriptRow, { kind: "assistant" }>,
    isExpanded: () => boolean,
    getWidth: () => number,
  ) {
    this.p = p;
    this.isExpanded = isExpanded;
    this.getWidth = getWidth;
    this.reasoning = new Text("", 1, 0);
    this.markdown = new Markdown("", 1, 1, markdownTheme(p));
    this.box.addChild(this.reasoning);
    this.box.addChild(this.markdown);
    this.update(row);
  }
  update(row: Extract<TranscriptRow, { kind: "assistant" }>): void {
    const reasoning = row.reasoning === "" ? "" : sanitizeDisplay(row.reasoning);
    this.reasoningText = reasoning;
    this.done = row.done;
    this.markdown.setText(sanitizeDisplay(row.text));
    if (this.isExpanded() || reasoning === "") {
      this.reasoning.setText(reasoning === "" ? "" : this.p.dim(`⏤ ${reasoning}`));
      return;
    }
    this.buildCollapsed(reasoning, row.done);
  }

  /** Collapsed: white spinner while streaming (frozen glyph once done), size +
   * expand hint, and — while streaming only — the newest three lines as a live
   * preview. The preview always reserves three rows — padding with blanks
   * while the reasoning is short — so the block height never changes
   * mid-stream and the transcript below does not jump around. Preview lines
   * are capped by DISPLAY COLUMNS, not characters: a char cap lets CJK lines
   * wrap inside Text and the block height starts breathing again. Once done
   * the whole thing folds to its single summary line. */
  private buildCollapsed(reasoning: string, done: boolean): void {
    const icon = done
      ? this.p.fg("✻", "brightWhite")
      : this.p.fg(
          SPINNER_FRAMES[Math.floor(Date.now() / 110) % SPINNER_FRAMES.length] ?? "✻",
          "brightWhite",
        );
    const head = `${icon} ${this.p.fg(`thinking · ${reasoning.length} chars · Ctrl+O expands`, "brightWhite")}`;
    this.formattedAtWidth = this.getWidth() || 80;
    if (done) {
      this.reasoning.setText(head);
      return;
    }
    // Text carries paddingX=1 on each side; the two-space indent costs two
    // more — whatever is left is the hard budget for one unwrapped line.
    const usedWidth = this.getWidth() || 80;
    const budget = Math.max(0, usedWidth - 4);
    const recent = reasoning.split("\n").filter((line) => line.trim() !== "").slice(-3);
    const preview = [0, 1, 2].map((i) => {
      const line = recent[i];
      if (line === undefined) return "";
      return this.p.dim(`  ${fitColumns(line, budget)}`);
    });
    this.formattedAtWidth = usedWidth;
    this.reasoning.setText([head, ...preview].join("\n"));
  }
  render(width: number): string[] {
    // Re-flow exactly once per resize: a stale budget would let Text re-wrap
    // lines at its new width and the block height breathe again. Normal
    // frames are a no-op (width matches), so the update()-driven repaint
    // rhythm stays untouched.
    if (!this.isExpanded() && this.reasoningText !== "" && width !== this.formattedAtWidth) {
      this.buildCollapsed(this.reasoningText, this.done);
    }
    return this.box.render(width);
  }
  /** Advance the spinner one step while still streaming. pi-tui renders on
   * demand only, so without an external tick a silent model looks frozen;
   * done/empty/expanded rows have nothing time-driven left. */
  tick(): boolean {
    if (this.done || this.reasoningText === "" || this.isExpanded()) return false;
    this.buildCollapsed(this.reasoningText, false);
    return true;
  }
  invalidate(): void {
    this.box.invalidate();
  }
}

class ToolRow implements RowComponent {
  private readonly box = new Container();
  private readonly header: Text;
  private readonly body: Text;
  private readonly p: Palette;
  private readonly isExpanded: () => boolean;
  constructor(
    p: Palette,
    row: Extract<TranscriptRow, { kind: "tool" }>,
    isExpanded: () => boolean,
  ) {
    this.header = new Text("", 1, 1);
    this.body = new Text("", 1, 0);
    this.box.addChild(this.header);
    this.box.addChild(this.body);
    this.p = p;
    this.isExpanded = isExpanded;
    this.update(row);
  }
  /** Restyle spill notices into a compact locator badge: the prose sentence
   * dsh-spill-policy appends becomes '⤓ full result <locator>' so the path
   * is scannable instead of buried in boilerplate. */
  private styleSpillNotices(text: string): string {
    return text.replace(SPILL_NOTICE_RE, (_match, locator: string) => {
      const clean = sanitizeDisplay(locator.trim());
      return this.p.dim("(…omitted) ") + this.p.fg(`⤓ full result ${clean}`, "yellow");
    });
  }
  update(row: Extract<TranscriptRow, { kind: "tool" }>): void {
    const title = row.resultView?.card === "diff" && row.resultView.title !== undefined
      ? row.resultView.title
      : row.callView?.title ?? row.name;
    // While its approval dialog is open, mark the pending call so the user
    // can see which action the card is asking about.
    const badge = row.awaitingApproval === true ? this.p.fg("⚠ ", "yellow") : "";
    this.header.setText(`${badge}${this.p.fg(`Tool / ${sanitizeDisplay(title)}`, "cyan")}`);
    // File edits render as an inline diff (pending call previews the intended
    // change; the result view shows what was applied). Collapsed caps the
    // lines with a stub; errors always stay visible.
    const diffDiffs =
      row.resultView !== undefined && row.resultView.card === "diff"
        ? row.resultView.diffs
        : row.callView !== undefined && row.callView.card === "diff"
          ? row.callView.diffs
          : undefined;
    if (diffDiffs !== undefined) {
      const rendered: string[] = [];
      for (const d of diffDiffs) {
        rendered.push(this.p.bold(`${d.oldText === null ? "+ " : "~ "}${sanitizeDisplay(d.path)}`));
        for (const line of lineDiff(d.oldText, d.newText)) {
          if (line.kind === "add") rendered.push(this.p.fg(`+ ${sanitizeDisplay(line.text)}`, "green"));
          else if (line.kind === "del") rendered.push(this.p.fg(`- ${sanitizeDisplay(line.text)}`, "red"));
          else rendered.push(this.p.dim(`  ${sanitizeDisplay(line.text)}`));
        }
      }
      if (!this.isExpanded() && rendered.length > DIFF_COLLAPSED_CAP) {
        const kept = rendered.slice(0, DIFF_COLLAPSED_CAP);
        kept.push(this.p.dim(`… ${rendered.length - DIFF_COLLAPSED_CAP} more lines · Ctrl+O expands`));
        this.body.setText(kept.join("\n"));
        return;
      }
      this.body.setText(rendered.join("\n"));
      return;
    }
    // Collapsed keeps only the header (errors stay visible); expanded shows
    // the full result body.
    if (!this.isExpanded() && row.error === undefined) {
      this.body.setText("");
      return;
    }
    const lines: string[] = [];
    if (row.error !== undefined) lines.push(this.p.fg(`${row.error.name}: ${row.error.code}`, "red"));
    const view = row.resultView;
    if (view !== undefined && view.card === "terminal") {
      if (view.output !== undefined && view.output !== "")
        lines.push(this.styleSpillNotices(sanitizeDisplay(view.output)));
      if (view.exitCode !== undefined) lines.push(this.p.dim(`exit ${view.exitCode}`));
      else if (view.signal !== undefined) lines.push(this.p.dim(`signal ${view.signal}`));
    } else if (view !== undefined && view.card === "generic" && view.content !== undefined) {
      const text = view.content
        .filter((b) => b.type === "text")
        .map((b) => String((b as { text?: unknown }).text ?? ""))
        .join("");
      if (text !== "") lines.push(this.styleSpillNotices(sanitizeDisplay(text)));
    } else if (view !== undefined && view.card === "search") {
      if (view.shape === "paths") {
        for (const p of view.paths) lines.push(sanitizeDisplay(p));
      } else {
        for (const file of view.files) {
          lines.push(this.p.bold(sanitizeDisplay(file.path)));
          for (const m of file.matches) {
            lines.push(`${this.p.dim(String(m.lineNumber))} ${sanitizeDisplay(m.line)}`);
          }
        }
      }
      if (view.truncated) lines.push(this.p.dim(`(${view.total} matches total)`));
    } else if (view !== undefined && view.card === "read") {
      lines.push(this.p.bold(sanitizeDisplay(view.path)));
      for (const l of view.lines) {
        lines.push(`${this.p.dim(String(l.number))} ${sanitizeDisplay(l.text)}`);
      }
      lines.push(this.p.dim(`showing ${view.lines.length} of ${view.totalLines} lines`));
    } else if (view !== undefined && view.card === "web") {
      if (view.kind === "search") {
        for (const s of view.sources) {
          lines.push(`- ${s.title !== undefined ? sanitizeDisplay(s.title) : "(untitled)"} ${this.p.dim(s.url)}`);
        }
        if (view.truncated) lines.push(this.p.dim("(sources truncated)"));
      } else {
        lines.push(`${sanitizeDisplay(view.url)} ${this.p.dim(`· HTTP ${view.statusCode}`)}`);
        if (view.truncated) lines.push(this.p.dim("(body truncated)"));
      }
    }
    if (lines.length > TOOL_LINES_CAP) {
      const extra = lines.length - TOOL_LINES_CAP;
      lines.length = TOOL_LINES_CAP;
      lines.push(this.p.dim(`… ${extra} more lines`));
    }
    this.body.setText(lines.length === 0 ? this.p.dim("…") : this.p.dim(lines.join("\n")));
  }
  render(width: number): string[] {
    return this.box.render(width);
  }
  invalidate(): void {
    this.box.invalidate();
  }
}

class NoticeRow implements RowComponent {
  private readonly text: Text;
  constructor(
    p: Palette,
    row: Extract<TranscriptRow, { kind: "notice" | "error" | "context" }>,
  ) {
    const color = row.kind === "error" ? "red" : null;
    this.text = new Text(color === null ? p.dim(row.text) : p.fg(row.text, color), 1, 1);
  }
  update(): void {
    /* static content */
  }
  render(width: number): string[] {
    return this.text.render(width);
  }
  invalidate(): void {
    this.text.invalidate();
  }
}

/** Boot-time welcome block: the row carries pre-styled lines (whale art +
 * route/preset/workspace + hints), rendered verbatim. */
class BannerRow implements RowComponent {
  private readonly text: Text;
  constructor(row: Extract<TranscriptRow, { kind: "banner" }>) {
    this.text = new Text(row.text, 1, 1);
  }
  update(): void {
    /* static content */
  }
  render(width: number): string[] {
    return this.text.render(width);
  }
  invalidate(): void {
    this.text.invalidate();
  }
}

function buildRowComponent(
  p: Palette,
  row: TranscriptRow,
  isExpanded: () => boolean,
  getWidth: () => number,
): RowComponent {
  switch (row.kind) {
    case "user":
      return new UserRow(p, row);
    case "assistant":
      return new AssistantRow(p, row, isExpanded, getWidth);
    case "tool":
      return new ToolRow(p, row, isExpanded);
    case "notice":
    case "error":
    case "context":
      return new NoticeRow(p, row);
    case "banner":
      return new BannerRow(row);
  }
}

/** Marker + color for one todo status. */
function todoMarker(p: Palette, status: string): string {
  if (status === "completed") return p.fg("✓", "green");
  if (status === "in_progress") return p.fg("▸", "yellow");
  return p.dim("○");
}

/** One component per transcript row, persisted and updated via update(). */
class TranscriptArea extends Container {
  private readonly bySeq = new Map<number, RowComponent>();
  private lastRevision = -1;
  private readonly model: TranscriptModel;
  private readonly p: Palette;
  private readonly isExpanded: () => boolean;
  private readonly getWidth: () => number;

  constructor(
    model: TranscriptModel,
    p: Palette,
    isExpanded: () => boolean,
    getWidth: () => number,
  ) {
    super();
    this.model = model;
    this.p = p;
    this.isExpanded = isExpanded;
    this.getWidth = getWidth;
  }

  /** Re-run every row's update() (details toggle changes render w/o revision). */
  redrawAll(): void {
    const byRowSeq = new Map(this.model.snapshot.map((r) => [r.seq, r]));
    for (const [seq, comp] of this.bySeq) {
      const row = byRowSeq.get(seq);
      if (row !== undefined) comp.update(row);
    }
  }

  /** Advance time-driven animation on streaming assistant rows; true when
   * any row actually moved (callers skip the repaint otherwise). */
  tickStreaming(): boolean {
    let animated = false;
    for (const comp of this.bySeq.values()) {
      if (comp instanceof AssistantRow && comp.tick()) animated = true;
    }
    return animated;
  }

  sync(): void {
    if (this.model.currentRevision === this.lastRevision) return;
    this.lastRevision = this.model.currentRevision;
    const seen = new Set<number>();
    for (const row of this.model.snapshot) {
      seen.add(row.seq);
      let comp = this.bySeq.get(row.seq);
      if (comp === undefined) {
        comp = buildRowComponent(this.p, row, this.isExpanded, this.getWidth);
        this.bySeq.set(row.seq, comp);
        this.addChild(comp);
      } else {
        comp.update(row);
      }
    }
    for (const [seq, comp] of this.bySeq) {
      if (!seen.has(seq)) {
        this.removeChild(comp);
        this.bySeq.delete(seq);
      }
    }
  }
}

/** One candidate row for the session picker. */
export interface SessionPickItem extends SelectItem {
  value: string;
  label: string;
  description?: string;
}

/** Async preview text for the highlighted session (null/throw = unavailable). */
export type SessionPreviewLoader = (sessionId: string) => Promise<string | null>;

/**
 * Full-viewport picker with a search field + keyboard-navigable list.
 * Renders a `search> …` line above a SelectList; typing filters by title or
 * id, Up/Down move, Enter resumes, Esc (or a second Esc with text) closes.
 */
class SessionPicker implements Component {
  private readonly queryText: Text;
  private readonly previewText: Text;
  private readonly p: Palette;
  private readonly previewLoader: SessionPreviewLoader | undefined;
  /** Decoded previews by session id; sessions are read more than once while
   * the user arrows around, and each read is a full log decode. */
  private readonly previewCache = new Map<string, string>();
  private previewGeneration = 0;
  private previewDebounce: ReturnType<typeof setTimeout> | undefined;
  private previewValue = "";
  private query = "";
  private items: SessionPickItem[];
  private select!: SelectList;
  private index = 0;
  private count = 0;

  onPick?: (value: string) => void;
  onCancel?: () => void;

  constructor(p: Palette, items: SessionPickItem[], previewLoader?: SessionPreviewLoader) {
    this.p = p;
    this.items = items;
    this.previewLoader = previewLoader;
    this.queryText = new Text("", 1, 1);
    this.previewText = new Text("", 0, 0);
    this.applyFilter();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      if (this.query !== "") {
        this.query = "";
        this.applyFilter();
      } else {
        this.onCancel?.();
      }
      return;
    }
    if (matchesKey(data, "enter")) {
      const item = this.select.getSelectedItem();
      if (item !== null) this.onPick?.(item.value);
      return;
    }
    if (matchesKey(data, "up")) {
      this.move(-1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.move(1);
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.query = this.query.slice(0, -1);
      this.applyFilter();
      return;
    }
    if (isPrintableInput(data)) {
      this.query += data;
      this.applyFilter();
    }
  }

  render(width: number): string[] {
    const lines = [...this.queryText.render(width), ...this.select.render(width)];
    if (this.previewValue !== "") {
      lines.push("");
      lines.push(...this.previewText.render(width));
    }
    return lines;
  }

  invalidate(): void {
    this.queryText.invalidate();
    this.select.invalidate();
    this.previewText.invalidate();
  }

  private buildSelect(items: SessionPickItem[]): SelectList {
    const select = new SelectList(items, Math.min(Math.max(items.length, 3), 12), selectListTheme(this.p));
    return select;
  }

  private applyFilter(): void {
    const q = this.query.toLowerCase();
    const filtered =
      q === ""
        ? this.items
        : this.items.filter(
            (i) => i.label.toLowerCase().includes(q) || i.value.toLowerCase().includes(q),
          );
    this.select = this.buildSelect(filtered);
    this.count = filtered.length;
    this.index = 0;
    this.refreshHeader();
    this.schedulePreview();
  }

  private move(dir: number): void {
    this.index = Math.max(0, Math.min(Math.max(this.count - 1, 0), this.index + dir));
    this.select.setSelectedIndex(this.index);
    this.schedulePreview();
  }

  /** Load the preview for the highlighted session: cached values render at
   * once; misses debounce briefly (a read decodes the whole log) and stale
   * results are discarded via a generation counter. */
  private schedulePreview(): void {
    if (this.previewLoader === undefined) return;
    const item = this.select.getSelectedItem();
    if (item === null) {
      this.previewValue = "";
      return;
    }
    const sessionId = item.value;
    const cached = this.previewCache.get(sessionId);
    if (cached !== undefined) {
      this.setPreview(cached);
      return;
    }
    this.setPreview("  loading preview…");
    const generation = ++this.previewGeneration;
    if (this.previewDebounce !== undefined) clearTimeout(this.previewDebounce);
    this.previewDebounce = setTimeout(() => {
      this.previewDebounce = undefined;
      void this.previewLoader?.(sessionId)
        .then((text) => {
          if (generation !== this.previewGeneration) return;
          const value =
            text === null || text.trim() === "" ? "  (preview unavailable)" : text;
          this.previewCache.set(sessionId, value);
          if (this.select.getSelectedItem()?.value === sessionId) this.setPreview(value);
        })
        .catch(() => {
          if (generation !== this.previewGeneration) return;
          this.previewCache.set(sessionId, "  (preview unavailable)");
          if (this.select.getSelectedItem()?.value === sessionId) {
            this.setPreview("  (preview unavailable)");
          }
        });
    }, 300);
  }

  private setPreview(text: string): void {
    this.previewValue = text;
    this.previewText.setText(text);
  }

  private refreshHeader(): void {
    this.queryText.setText(`search> ${this.query}${this.query === "" ? " " : ""}`);
  }
}

/** Width cap and label column for the approval card. */
const APPROVAL_CARD_MAX = 76;
const APPROVAL_LABEL_PAD = 10;

/**
 * Bordered approval card: names the tool, shows the harness-provided reason
 * wrapped to width, and answers with Allow once / Reject. Single keys a/r,
 * arrows + enter, Esc cancels. The pending call it refers to is flagged in
 * the transcript behind this overlay.
 */
class ApprovalCard implements Component {
  private readonly palette: Palette;
  private readonly toolName: string;
  private readonly reason: string | undefined;
  private readonly select: SelectList;

  onDecide?: (outcome: "allowed-once" | "rejected" | "cancelled") => void;

  constructor(palette: Palette, toolName: string, reason?: string) {
    this.palette = palette;
    this.toolName = toolName;
    this.reason = reason;
    this.select = new SelectList(
      [
        { value: "allowed-once", label: "Allow once" },
        { value: "rejected", label: "Reject" },
      ],
      2,
      selectListTheme(palette),
    );
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.onDecide?.("cancelled");
      return;
    }
    if (matchesKey(data, "enter")) {
      const item = this.select.getSelectedItem();
      if (item !== null) this.onDecide?.(item.value as "allowed-once" | "rejected");
      return;
    }
    if (matchesKey(data, "up")) {
      this.select.setSelectedIndex(0);
      return;
    }
    if (matchesKey(data, "down")) {
      this.select.setSelectedIndex(1);
      return;
    }
    if (isPrintableInput(data)) {
      const key = data.toLowerCase();
      if (key === "a") this.onDecide?.("allowed-once");
      else if (key === "r") this.onDecide?.("rejected");
    }
  }

  render(width: number): string[] {
    // Never exceed the available width; on a pathologically narrow terminal
    // the card degrades (padding clamps at 0) instead of overflowing.
    const cardWidth = Math.max(0, Math.min(width - 2, APPROVAL_CARD_MAX));
    const inner = cardWidth - 4; // border pipes plus one space each side
    const valueWidth = Math.max(16, inner - APPROVAL_LABEL_PAD);

    const content: string[] = [];
    content.push("");
    content.push(this.padLabel("Tool", this.palette.bold(this.toolName), valueWidth));
    const reasonLines =
      this.reason === undefined || this.reason.trim() === ""
        ? [this.palette.dim("(no reason provided)")]
        : wrapTextWithAnsi(this.reason, valueWidth);
    for (const [i, line] of reasonLines.entries()) {
      content.push(this.padLabel(i === 0 ? "Request" : "", line, valueWidth));
    }
    content.push("");
    content.push(...this.select.render(inner));
    content.push(
      this.palette.dim("  ↑↓ choose · enter confirm · a allow · r reject · esc cancel"),
    );
    content.push("");

    return [this.topRule(cardWidth), ...content.map((l) => this.bodyLine(l, cardWidth)), this.bottomRule(cardWidth)];
  }

  invalidate(): void {
    this.select.invalidate();
  }

  /** One content row padded to the card interior, flanked by dim borders. */
  private bodyLine(text: string, cardWidth: number): string {
    const pad = Math.max(0, cardWidth - 4 - visibleWidth(text));
    return `${this.palette.dim("│ ")}${text}${" ".repeat(pad)}${this.palette.dim(" │")}`;
  }

  private topRule(cardWidth: number): string {
    const title = this.palette.fg("⚠ Approval required", "yellow");
    const left = this.palette.dim("╭─ ");
    const right = this.palette.dim(" ─╮");
    const fill = Math.max(0, cardWidth - visibleWidth(left) - visibleWidth(title) - visibleWidth(right));
    return `${left}${title}${this.palette.dim("─".repeat(fill))}${right}`;
  }

  private bottomRule(cardWidth: number): string {
    return this.palette.dim(`╰${"─".repeat(Math.max(0, cardWidth - 2))}╯`);
  }

  /** Label column + value; continuation rows pass an empty label. */
  private padLabel(label: string, value: string, valueWidth: number): string {
    const pad = " ".repeat(APPROVAL_LABEL_PAD - visibleWidth(label));
    return `${this.palette.dim(label)}${pad}${truncateToWidth(value, valueWidth)}`;
  }
}

/** SGR mouse event as pi-tui's parser produces it; the button byte carries
 * xterm modifier bits (bit2 = shift, bit5 = motion, bit6 = wheel). */
interface ParsedMouseEvent {
  button: number;
  x: number;
  y: number;
  release: boolean;
}

/** The selection state pi-tui keeps private (and stable across 0.84.x) that
 * shift-extend needs: the anchor survives scrolling, so extending it across a
 * scrolled viewport resolves into absolute content coordinates. */
interface SelectionInternals {
  handleSelectionMouseEvent(event: ParsedMouseEvent): void;
  selectionAnchor?: { scrollView?: object };
  selectionPressActive: boolean;
  selectionDragged: boolean;
  getSelectionPoint(
    event: ParsedMouseEvent,
    scrollView?: object,
  ): { scrollView?: object; row: number; col: number } | undefined;
  updateSelectionFocus(point: object): void;
  copySelectionToClipboard(): void;
}

/**
 * Shift+click extends the live selection instead of starting a new one —
 * the large-block copy flow: drag-select the start, release, scroll to the
 * end, shift+click, and the whole span is copied. Upstream pi-tui has no
 * modifier handling at all (checked through 0.84.2), so this wraps the
 * instance's mouse handler; everything without shift passes through
 * untouched.
 */
function enableShiftClickExtend(tui: TuiAltScreen): void {
  const t = tui as unknown as SelectionInternals & { requestRender(): void };
  const original = t.handleSelectionMouseEvent.bind(t);
  t.handleSelectionMouseEvent = (event: ParsedMouseEvent) => {
    const isPress = !event.release && (event.button & (32 | 64)) === 0;
    const shiftPress = isPress && (event.button & 4) !== 0;
    if (!shiftPress || t.selectionAnchor === undefined) {
      original(event);
      return;
    }
    const point = t.getSelectionPoint(event, t.selectionAnchor.scrollView);
    if (point === undefined) {
      original(event);
      return;
    }
    // Not "press active": the next release must not re-run the drag path.
    t.selectionPressActive = false;
    t.selectionDragged = true;
    t.updateSelectionFocus(point);
    t.requestRender();
    t.copySelectionToClipboard();
  };
}

/** Multi-select question overlay: the harness `multiSelect` wire flag asks
 * for several of the options at once. Space toggles, a selects/deselects
 * all, Enter submits the checked labels (possibly empty), Esc cancels. */
class CheckboxList implements Component {
  private readonly palette: Palette;
  private readonly question: string;
  private readonly options: Array<{ label: string; description?: string }>;
  private readonly checked: boolean[];
  private cursor = 0;

  onSubmit?: (selected: string[]) => void;
  onCancel?: () => void;

  constructor(
    palette: Palette,
    question: string,
    options: Array<{ label: string; description?: string }>,
  ) {
    this.palette = palette;
    this.question = question;
    this.options = options;
    this.checked = options.map(() => false);
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.onCancel?.();
      return;
    }
    if (matchesKey(data, "enter")) {
      this.onSubmit?.(this.selectedLabels());
      return;
    }
    if (matchesKey(data, "up")) {
      this.move(-1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.move(1);
      return;
    }
    if (isPrintableInput(data)) {
      const key = data.toLowerCase();
      if (key === " ") {
        const current = this.checked[this.cursor];
        this.checked[this.cursor] = !(current ?? false);
        return;
      }
      if (key === "a") {
        const allOn = this.checked.every(Boolean);
        for (let i = 0; i < this.checked.length; i += 1) this.checked[i] = !allOn;
      }
    }
  }

  render(width: number): string[] {
    const lines = [this.palette.dim(this.question), ""];
    this.options.forEach((option, i) => {
      const cursor = i === this.cursor ? this.palette.fg("❯ ", "cyan") : "  ";
      const box = this.checked[i] === true ? this.palette.fg("[x]", "green") : this.palette.dim("[ ]");
      const desc =
        option.description !== undefined ? this.palette.dim(` — ${option.description}`) : "";
      lines.push(truncateToWidth(`${cursor}${box} ${option.label}${desc}`, Math.max(0, width - 2)));
    });
    lines.push("");
    lines.push(this.palette.dim("space toggle · a all/none · enter submit · esc cancel"));
    return lines;
  }

  invalidate(): void {}

  private move(delta: number): void {
    this.cursor = Math.max(0, Math.min(this.options.length - 1, this.cursor + delta));
  }

  private selectedLabels(): string[] {
    return this.options.filter((_, i) => this.checked[i] === true).map((o) => o.label);
  }
}

/** Phase marks/colors and the non-active phase tag, keyed exactly like
 * dsh-goal's projection phase values. */
function goalStyle(
  phase: GoalSummary["phase"],
): { mark: string; color: "cyan" | "brightWhite" | "red" | "green" } {
  return phase === "active"
    ? { mark: "◎", color: "cyan" }
    : phase === "paused"
      ? { mark: "⏸", color: "brightWhite" }
      : phase === "blocked"
        ? { mark: "⛔", color: "red" }
        : { mark: "✓", color: "green" };
}

/** Session-goal bar text, e.g. `◎ objective · round 1/5` — active unwrapped,
 * other phases get a ` · phase` tag. Truncates to the given terminal width
 * (floored at 20). Pure, so the display effect is unit-testable. */
export function formatGoalLine(p: Palette, goal: GoalSummary, width: number): string {
  const style = goalStyle(goal.phase);
  const tag = goal.phase === "active" ? "" : ` · ${goal.phase}`;
  const text =
    `${p.fg(style.mark, style.color)} ${goal.objective} ` +
    p.dim(`· round ${goal.roundsStarted}/${goal.maxGoalRounds}${tag}`);
  return truncateToWidth(text, Math.max(20, width));
}

/** @-prefix token before the cursor: `@query`, or an unterminated quoted
 * `@"query…`. null when the cursor is not in an @-context. Mirrors pi-tui's
 * delimiter grammar without lookbehind. */
function atPrefixBeforeCursor(line: string, cursorCol: number): string | null {
  const text = line.slice(0, cursorCol);
  const quoted = /(?:^|\s)(@"[^"]*)$/.exec(text);
  if (quoted) return quoted[1]!;
  const plain = /(?:^|\s)(@[^\s]*)$/.exec(text);
  return plain ? plain[1]! : null;
}

/** Live readdir candidates for escape-path queries (absolute, ~, ../): the
 * workspace-rooted discovery index cannot see these, but the parent
 * directory listing completes them just the same. Directories sort first
 * so drilling continues; capped to keep the menu usable. */
async function literalPathCandidates(
  rawQuery: string,
  signal: AbortSignal,
): Promise<Array<{ path: string; kind: "file" | "directory" }>> {
  const expanded = rawQuery === "~" || rawQuery.startsWith("~/") ? `${homedir()}${rawQuery.slice(1)}` : rawQuery;
  const slash = expanded.lastIndexOf("/");
  if (slash < 0) return [];
  const directory = expanded.slice(0, slash + 1) || "/";
  const fragment = expanded.slice(slash + 1);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  signal.throwIfAborted();
  return entries
    .filter((entry) => entry.name.startsWith(fragment))
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 8)
    .map((entry) => ({
      path: `${directory}${entry.name}`,
      kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
    }));
}

/** Provider composition: pi-tui keeps command + grammar handling; when an
 * @-context is active and the harness discovery seam is wired, its
 * candidates REPLACE the cwd-walk results — inner stays the fallback for
 * empty or failed discovery, and applyCompletion delegates untouched since
 * items and prefix keep the inner conventions (`@path`, quoted on spaces). */
class FileReferenceAutocomplete implements AutocompleteProvider {
  // Explicit fields: Node strip-only TS rejects parameter properties
  // (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX) — they require emit.
  private readonly inner: CombinedAutocompleteProvider;
  private readonly files: TuiAppOptions["fileCompletions"];
  private readonly sessions: TuiAppOptions["sessionCompletions"] | undefined;
  constructor(
    inner: CombinedAutocompleteProvider,
    files?: TuiAppOptions["fileCompletions"],
    sessions?: TuiAppOptions["sessionCompletions"],
  ) {
    this.inner = inner;
    this.files = files;
    this.sessions = sessions;
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const base = await this.inner.getSuggestions(lines, cursorLine, cursorCol, options);
    if (
      (this.files === undefined && this.sessions === undefined) ||
      !this.inner.shouldTriggerFileCompletion(lines, cursorLine, cursorCol)
    ) {
      return base;
    }
    const atPrefix = atPrefixBeforeCursor(lines[cursorLine] ?? "", cursorCol);
    if (atPrefix === null) return base;
    try {
      const query = atPrefix.startsWith(`@"`) ? atPrefix.slice(2, -1) : atPrefix.slice(1);
      // Out-of-workspace paths (/ ~ ../) are invisible to the rooted
      // discovery index — complete them with a live readdir of the parent
      // directory so absolute references stay first-class.
      const wantsLiteral =
        query.startsWith("/") ||
        query.startsWith("~/") ||
        query.startsWith("../") ||
        query === ".." ||
        query === "~";
      const toItem = (cand: { path: string; kind: "file" | "directory" }) => {
        const dir = cand.kind === "directory";
        const path = dir && !cand.path.endsWith("/") ? `${cand.path}/` : cand.path;
        const quoted = atPrefix.startsWith(`@"`) || path.includes(" ");
        return {
          value: quoted ? `@"${path}"` : `@${path}`,
          label: `${path.split("/").filter(Boolean).pop() ?? path}${dir ? "/" : ""}`,
          description: path,
        };
      };
      const [fileItems, sessionItems, literalItems] = await Promise.all([
        this.files === undefined || wantsLiteral
          ? Promise.resolve([])
          : this.files(query, options.signal).then((candidates) => candidates.map(toItem)),
        this.sessions === undefined
          ? Promise.resolve([])
          : this.sessions(query, options.signal).then((mentions) =>
              mentions.map((m) => ({
                value: m.mention,
                label: `⌗ ${m.label}`,
                description: m.description ?? "session snapshot",
              })),
            ),
        wantsLiteral ? literalPathCandidates(query, options.signal) : Promise.resolve([]),
      ]);
      const items = [...literalItems.map(toItem), ...fileItems, ...sessionItems];
      if (items.length === 0) return base;
      return { items, prefix: atPrefix };
    } catch {
      return base; // discovery failure degrades to the cwd walk
    }
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: { value: string; label: string; description?: string },
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    return this.inner.applyCompletion(lines, cursorLine, cursorCol, item as never, prefix);
  }
}

export class TuiApp {
  private readonly terminal = new ProcessTerminal();
  private readonly clipboardTerminal = new ClipboardTerminal(this.terminal);
  private readonly tui: TUI;
  private readonly p: Palette;
  private readonly transcript = new TranscriptModel();
  private readonly transcriptArea: TranscriptArea;
  private readonly transcriptScroll: ScrollView;
  private readonly editor: Editor;
  private readonly status: StatusLine;
  private readonly subagentsLine: Text;
  private subagentItems: RunningSubagent[] = [];
  private readonly jobsLine: Text;
  private jobItems: RunningJob[] = [];
  private readonly goalLine: Text;
  private readonly todosLine: Text;
  private agent: AgentSurface;
  private modelLabel: string;
  private statusValue: "idle" | "running" = "idle";
  private contextInfo: ContextOccupancy | null = null;
  private cacheRate: number | null = null;
  private readonly workspaceName: string;
  private stopping = false;
  private lastCtrlC = 0;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Drives the thinking-row spinner between chunks (pi-tui has no frame loop). */
  private thinkTimer: ReturnType<typeof setInterval> | undefined;
  private detailsExpanded = false;
  /** Sliding samples of streamed assistant text for the live t/s gauge. */
  private streamSamples: Array<{ at: number; tokens: number }> = [];
  /** Cumulative stream-text estimate; samples carry totals so the window
   * difference is monotonic (per-delta values made the rate flicker). */
  private streamTokensTotal = 0;
  private streamTimer: ReturnType<typeof setInterval> | undefined;
  private liveTps: number | null = null;
  /** Session-total output tokens (provider-reported, projection-backed). */
  private outputTotal: number | null = null;
  /** Reasoning-effort display name (null = hidden). */
  private thinkLabel: string | null = null;
  private todoItems: ReadonlyArray<TodoItem> = [];
  private readonly options: TuiAppOptions;

  constructor(options: TuiAppOptions) {
    this.options = options;
    this.p = createPalette(true);
    this.agent = options.agent;
    this.modelLabel = options.modelLabel;
    this.workspaceName = basename(process.cwd());

    this.tui = new TuiAltScreen(this.clipboardTerminal, true);
    enableShiftClickExtend(this.tui as TuiAltScreen);

    this.transcriptArea = new TranscriptArea(
      this.transcript,
      this.p,
      () => this.detailsExpanded,
      () => this.tui.terminal.columns,
    );
    this.transcriptScroll = new ScrollView(this.transcriptArea, {
      follow: "end",
      primary: true,
      overscroll: "chain",
      scrollbar: "auto",
    });

    this.status = new StatusLine(this.p);
    this.subagentsLine = new Text("", 1, 1);
    this.jobsLine = new Text("", 1, 1);
    this.goalLine = new Text("", 1, 1);
    this.todosLine = new Text("", 1, 0);
    this.editor = new Editor(this.tui, editorTheme(this.p));
    this.editor.onSubmit = (text) => this.handleSubmit(text);
    if (options.autocomplete !== undefined) {
      const provider = new CombinedAutocompleteProvider(
        options.autocomplete.commands as never,
        process.cwd(),
      );
      this.editor.setAutocompleteProvider(
        new FileReferenceAutocomplete(provider, options.fileCompletions, options.sessionCompletions),
      );
      this.editor.setAutocompleteMaxVisible?.(8);
    }

    const dock = new VStack([
      { component: this.editor, basis: "auto", grow: 0, shrink: 1, minSize: 3 },
      { component: this.status, shrink: 1, minSize: 1 },
    ]);
    const root = new VStack([
      { component: this.transcriptScroll, basis: 0, grow: 1, shrink: 1, minSize: 1 },
      { component: this.goalLine, shrink: 1, minSize: 0 },
      { component: this.subagentsLine, shrink: 1, minSize: 0 },
      { component: this.jobsLine, shrink: 1, minSize: 0 },
      { component: this.todosLine, shrink: 1, minSize: 0 },
      { component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
    ]);

    if (isViewportTUI(this.tui)) {
      this.tui.setLayoutRoot(root);
    } else {
      this.tui.addChild(root);
    }

    this.tui.addInputListener((data) => this.handleGlobalInput(data));
  }

  get tuiHandle(): TUI {
    return this.tui;
  }

  get model(): TranscriptModel {
    return this.transcript;
  }

  /** Rebind the agent surface (used once the live agent handle exists). */
  setAgent(agent: AgentSurface): void {
    this.agent = agent;
  }

  setModelLabel(label: string): void {
    this.modelLabel = label;
    this.updateStatus();
  }

  /** Context-window occupancy (null until the provider reports usage). */
  setContextOccupancy(info: ContextOccupancy | null): void {
    this.contextInfo = info;
    this.updateStatus();
    this.render();
  }

  /** Latest cache hit rate in percent (null when no usage reported yet). */
  setCacheRate(rate: number | null): void {
    this.cacheRate = rate;
    this.updateStatus();
    this.render();
  }

  /** Reasoning-effort display name for the status bar (null hides the segment). */
  setThinkLabel(label: string | null): void {
    this.thinkLabel = label;
    this.updateStatus();
    this.render();
  }

  /** Output tokens of the newest provider usage sample (null hides it). */
  setOutputTotal(tokens: number | null): void {
    this.outputTotal = tokens !== null && tokens > 0 ? tokens : null;
  }

  /** Feed streamed assistant text into the live token-rate window. */
  noteStreamText(text: string): void {
    const now = Date.now();
    this.streamTokensTotal += estimateStreamTokens(text);
    this.streamSamples.push({ at: now, tokens: this.streamTokensTotal });
    const cutoff = now - STREAM_WINDOW_MS - 1000;
    while (this.streamSamples.length > 2 && (this.streamSamples[0]?.at ?? 0) < cutoff) {
      this.streamSamples.shift();
    }
  }

  /** Ambient todo gauge pinned between the transcript and the editor: visible
   * while the list has open items (the transcript card scrolls away during
   * streaming), hidden when empty or all-completed. Ctrl+O expands the full
   * checklist in place. */
  setTodos(items: ReadonlyArray<TodoItem> | null): void {
    this.todoItems = items ?? [];
    this.renderTodosLine();
    this.render();
  }

  private renderTodosLine(): void {
    const items = this.todoItems;
    const done = items.filter((t) => t.status === "completed").length;
    // Empty list or everything done → no ambient line (the work is finished).
    if (items.length === 0 || done === items.length) {
      this.todosLine.setText("");
      return;
    }
    if (!this.detailsExpanded) {
      const current =
        items.find((t) => t.status === "in_progress") ??
        items.find((t) => t.status !== "completed");
      const focus =
        current !== undefined
          ? ` · ${todoMarker(this.p, current.status)} ${current.content}`
          : "";
      this.todosLine.setText(
        truncateToWidth(
          `${this.p.fg("☰ todos", "cyan")} ${this.p.dim(`${done}/${items.length}`)}${focus}`,
          Math.max(20, process.stdout.columns ?? 100),
        ),
      );
      return;
    }
    const lines = [this.p.fg(`☰ todos ${done}/${items.length}`, "cyan")];
    for (const item of items) {
      const text = item.status === "completed" ? this.p.dim(item.content) : item.content;
      lines.push(`  ${todoMarker(this.p, item.status)} ${text}`);
    }
    lines.push(this.p.dim("  Ctrl+O collapses"));
    this.todosLine.setText(lines.join("\n"));
  }

  private startStreamSampler(): void {
    if (this.streamTimer !== undefined) return; // already sampling this turn
    // Fresh turn starts blank: hidden until the first window computes, and
    // the cumulative baseline must begin at zero AFTER the guard so a
    // duplicate "running" status mid-turn cannot reset monotonicity.
    this.liveTps = null;
    this.streamTokensTotal = 0;
    this.streamTimer = setInterval(() => {
      // Only refresh on a computable window: during a tool tail (stream idle
      // >3s) the window goes degenerate and the LAST MEASURED rate stays up —
      // the reading drops only when a fresh turn resets it.
      const rate = this.computeWindowTps();
      if (rate !== null) this.liveTps = rate;
      this.updateStatus();
      this.render();
    }, 500);
    this.streamTimer.unref?.();
  }

  /** Rate over the sliding window; null when the window is degenerate.
   * Samples carry the cumulative estimate, so the difference is monotonic —
   * per-delta values made the reading flicker on and off. */
  private computeWindowTps(): number | null {
    const cutoff = Date.now() - STREAM_WINDOW_MS;
    const inWindow = this.streamSamples.filter((s) => s.at >= cutoff);
    const first = inWindow[0];
    const last = inWindow[inWindow.length - 1];
    if (
      first === undefined ||
      last === undefined ||
      last.at === first.at ||
      last.tokens <= first.tokens
    ) {
      return null;
    }
    return Math.round((last.tokens - first.tokens) / ((last.at - first.at) / 1000));
  }

  private stopStreamSampler(): void {
    if (this.streamTimer !== undefined) {
      clearInterval(this.streamTimer);
      this.streamTimer = undefined;
      // Freeze the final reading instead of blanking: the turn just ended,
      // which is exactly when you want to read the rate it streamed at. A
      // stale window (text stopped >3s before turn end, e.g. tool tail) keeps
      // the last tick's value rather than dropping to hidden.
      const finalRate = this.computeWindowTps();
      if (finalRate !== null) this.liveTps = finalRate;
    }
    this.streamSamples = [];
  }

  /** Spinner heartbeat, aligned to the 110ms frame math in buildCollapsed:
   * without it a stretch with zero arriving tokens renders as a frozen icon
   * and reads as "stuck". Only rows that actually advanced trigger a repaint
   * (pi-tui throttles requestRender anyway). */
  private startThinkSpinner(): void {
    if (this.thinkTimer !== undefined) return;
    this.thinkTimer = setInterval(() => {
      if (this.transcriptArea.tickStreaming()) this.render();
    }, 110);
    this.thinkTimer.unref?.();
  }

  private stopThinkSpinner(): void {
    if (this.thinkTimer === undefined) return;
    clearInterval(this.thinkTimer);
    this.thinkTimer = undefined;
  }

  /** Running-subagent summary under the status line (empty hides the row). */
  setSubagents(running: RunningSubagent[]): void {
    this.subagentItems = running;
    this.renderSubagentsLine();
    this.render();
  }

  /** Live background-job summary (empty hides the row). Same collapsed /
   * Ctrl+O-expanded contract as the subagents line. */
  setJobs(live: RunningJob[]): void {
    this.jobItems = live;
    this.renderJobsLine();
    this.render();
  }

  /** Session-goal bar above the ambient rows; null hides it. One line always
   * — the objective is the content, so there is nothing to expand. */
  setGoal(goal: GoalSummary | null): void {
    if (goal === null) {
      this.goalLine.setText("");
    } else {
      this.goalLine.setText(formatGoalLine(this.p, goal, process.stdout.columns ?? 100));
    }
    this.render();
  }

  /** Collapsed: one summary line with the newest job label. Expanded: one
   * line per live job, stopping jobs dimmed, capped like the subagent list. */
  private renderJobsLine(): void {
    const jobs = this.jobItems;
    if (jobs.length === 0) {
      this.jobsLine.setText("");
      return;
    }
    const width = Math.max(20, process.stdout.columns ?? 100);
    if (!this.detailsExpanded) {
      const latest = jobs[jobs.length - 1]!;
      const suffix = latest.status === "stopping" ? this.p.dim(" (stopping)") : "";
      this.jobsLine.setText(
        truncateToWidth(
          `${this.p.fg("▣ jobs", "yellow")} ${this.p.dim(`×${jobs.length}`)} · ${this.p.dim(latest.label || latest.id)}${suffix}${this.p.dim(" · Ctrl+O expands")}`,
          width,
        ),
      );
      return;
    }
    const shown = jobs.slice(-SUBAGENTS_EXPAND_CAP);
    const lines: string[] = [];
    if (jobs.length > shown.length) {
      lines.push(this.p.dim(`… ${jobs.length - shown.length} earlier`));
    }
    for (const job of shown) {
      const mark = job.status === "stopping" ? this.p.dim("●") : this.p.fg("●", "yellow");
      const tag = job.status === "stopping" ? this.p.dim(" (stopping)") : "";
      lines.push(truncateToWidth(`${mark} ${job.label || job.id}${tag}`, width));
    }
    lines.push(this.p.dim("  Ctrl+O collapses"));
    this.jobsLine.setText(lines.join("\n"));
  }

  /** Collapsed: one summary line (fan-out safe). Expanded via Ctrl+O: one
   * line per running child, newest last, capped so a large fan-out cannot
   * eat the viewport. */
  private renderSubagentsLine(): void {
    const running = this.subagentItems;
    if (running.length === 0) {
      this.subagentsLine.setText("");
      return;
    }
    const nameOf = (c: RunningSubagent): string => c.label ?? c.id.slice(0, 20);
    const width = Math.max(20, process.stdout.columns ?? 100);
    if (!this.detailsExpanded) {
      const latest = nameOf(running[running.length - 1]!);
      this.subagentsLine.setText(
        truncateToWidth(
          `${this.p.fg("◉ subagents", "cyan")} ${this.p.dim(`×${running.length}`)} · ${this.p.dim(latest)}`,
          width,
        ),
      );
      return;
    }
    const shown = running.slice(-SUBAGENTS_EXPAND_CAP);
    const lines: string[] = [];
    if (running.length > shown.length) {
      lines.push(this.p.dim(`… ${running.length - shown.length} earlier`));
    }
    for (const child of shown) {
      const bg = child.mode === "continuable" ? this.p.dim(" (bg)") : "";
      lines.push(truncateToWidth(`${this.p.fg("●", "green")} ${nameOf(child)}${bg}`, width));
    }
    lines.push(this.p.dim("  Ctrl+O collapses"));
    this.subagentsLine.setText(lines.join("\n"));
  }

  start(): void {
    this.updateStatus();
    this.render();
    this.tui.setFocus(this.editor);
    this.tui.start();
  }

  /** Idempotent shutdown: cancel active work, restore the terminal, print any
   * parting note (after teardown so it lands on the normal screen), exit.
   * whenIdle() is raced against a grace timeout so a wedged agent can never
   * leave the terminal in raw mode. */
  async stopAndExit(exit: (code: number) => void, note?: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    try {
      if (this.agent.status === "running") this.agent.cancel();
      await Promise.race([
        this.agent.whenIdle(),
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, IDLE_EXIT_GRACE_MS);
          t.unref?.(); // must not hold the process open if appExit isn't a hard exit
        }),
      ]);
      this.tui.stop();
      if (note !== undefined && note !== "") process.stdout.write(note);
      exit(0);
    } catch (error) {
      console.error(`dsh-tui: shutdown failed: ${String(error)}`);
      this.tui.stop();
      exit(1);
    }
  }

  /** Session events arrived; reconcile the transcript and repaint. */
  onSessionEvent(): void {
    this.transcriptArea.sync();
    this.render();
  }

  /** Restore the terminal and stop rendering, without exiting the process. */
  stopTerminal(): void {
    this.stopThinkSpinner();
    this.tui.stop();
  }

  /** Append multi-line command output as a notice row. */
  appendCommandOutput(text: string): void {
    this.transcript.addNotice(text);
    this.transcriptArea.sync();
    this.render();
  }

  /** Append the boot-time welcome block (blank sessions only, never exported). */
  appendBanner(text: string): void {
    this.transcript.addBanner(text);
    this.transcriptArea.sync();
    this.render();
  }

  setStatus(status: "idle" | "running"): void {
    this.statusValue = status;
    if (status === "running") this.startStreamSampler();
    else this.stopStreamSampler();
    if (status === "running") this.startThinkSpinner();
    else this.stopThinkSpinner();
    this.updateStatus();
    this.render();
  }

  render(): void {
    this.tui.requestRender();
  }

  /** Ctrl+O — expand/collapse reasoning + tool details across the transcript. */
  toggleDetails(): void {
    this.detailsExpanded = !this.detailsExpanded;
    this.transcriptArea.redrawAll();
    this.renderTodosLine(); // the ambient gauge expands with everything else
    this.renderSubagentsLine();
    this.renderJobsLine();
    this.render();
  }

  /** Surface a transient notice on the status line; the bar reverts to the
   * session state after `timeoutMs`, when cleared explicitly, or when a new
   * notice replaces it — unrelated status updates never retire it. */
  showNotice(text: string, timeoutMs = 8000): void {
    this.status.showNotice(text);
    this.clearNoticeTimer();
    if (timeoutMs > 0) {
      this.noticeTimer = setTimeout(() => {
        this.noticeTimer = undefined;
        this.status.clearNotice(); // retire the text itself — setParts no longer does
        this.updateStatus();
        this.render();
      }, timeoutMs);
    }
    this.render();
  }

  /** Retire any pending notice immediately and restore the status bar. */
  clearNotice(): void {
    this.clearNoticeTimer();
    this.status.clearNotice();
    this.updateStatus();
    this.render();
  }

  private clearNoticeTimer(): void {
    if (this.noticeTimer !== undefined) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = undefined;
    }
  }

  private updateStatus(): void {
    // Deliberately no notice handling here: notices retire via their own
    // timer / clearNotice() only. Cancelling the timer from a gauge refresh
    // would strand the notice text on the bar forever.
    const running = this.statusValue === "running";
    const dot = running ? this.p.fg("●", "yellow") : this.p.fg("●", "green");
    const sep = this.p.dim(" · ");
    const left = [`${dot} ${this.p.dim(this.modelLabel)}`];
    // Bare effort name — no prefix, keep the bar lean (banner carries labels).
    if (this.thinkLabel !== null) left.push(this.p.fg(this.thinkLabel, "cyan"));
    if (this.cacheRate !== null) left.push(this.p.dim(`cache ${this.cacheRate}%`));
    // Stream rate persists across the turn boundary: bright while live, dim
    // once idle so a standing number is never mistaken for an active stream.
    if (this.liveTps !== null && this.liveTps > 0) {
      const rate = `~${this.liveTps} t/s`;
      left.push(running ? rate : this.p.dim(rate));
    }
    // Session-total output (same source as /cost); hidden until first usage.
    if (this.outputTotal !== null) left.push(this.p.dim(`out ${formatTokens(this.outputTotal)}`));
    left.push(this.p.dim(this.workspaceName));
    let right = "";
    if (this.contextInfo !== null) {
      const { pct, usedTokens, windowTokens } = this.contextInfo;
      const detail =
        usedTokens !== undefined && windowTokens !== undefined
          ? ` (${formatTokens(usedTokens)}/${formatTokens(windowTokens)})`
          : "";
      const text = `ctx ${pct}%${detail}`;
      right = pct >= 80 ? this.p.fg(text, "yellow") : this.p.dim(text);
    }
    this.status.setParts(left.join(sep), right);
  }

  /** Prompt the human for one question, returning the chosen label or null on cancel. */
  askQuestion(item: AskQuestionRequest["questions"][number]): Promise<string[] | null> {
    if (item.multiSelect === true && (item.options?.length ?? 0) > 0) {
      return new Promise((resolve) => {
        const list = new CheckboxList(this.p, item.question, item.options ?? []);
        const handle = this.tui.showOverlay(list, { anchor: "bottom-left", margin: 1 });
        list.onSubmit = (selected) => {
          handle.hide();
          resolve(selected);
        };
        list.onCancel = () => {
          handle.hide();
          resolve(null);
        };
        this.tui.setFocus(list);
      });
    }
    return new Promise((resolve) => {
      const items: SelectItem[] = (item.options ?? []).map((o) => ({
        value: o.label,
        label: o.label,
        description: o.description,
      }));
      if (items.length === 0) {
        items.push({ value: "OK", label: "OK" });
      }
      const select = new SelectList(items, Math.min(items.length, 8), selectListTheme(this.p));
      const handle = this.tui.showOverlay(select, { anchor: "bottom-left", margin: 1 });
      select.onSelect = (sel) => {
        handle.hide();
        resolve([sel.value]);
      };
      select.onCancel = () => {
        handle.hide();
        resolve(null);
      };
      this.tui.setFocus(select);
    });
  }

  /** Pick one session from the list, or null on cancel. */
  pickSession(sessions: SessionPickItem[]): Promise<string | null> {
    return new Promise((resolve) => {
      const picker = new SessionPicker(this.p, sessions, this.options.sessionPreview);
      picker.onPick = (value) => {
        this.tui.hideOverlay();
        resolve(value);
      };
      picker.onCancel = () => {
        this.tui.hideOverlay();
        resolve(null);
      };
      this.tui.showOverlay(picker, { anchor: "center", margin: 1 });
      this.tui.setFocus(picker);
    });
  }

  /** Prompt the human to approve a tool call via the approval card. */
  askApproval(req: ApprovalRequest): Promise<"allowed-once" | "rejected" | "cancelled"> {
    return new Promise((resolve) => {
      const card = new ApprovalCard(this.p, req.toolName, req.reason);
      const finish = (outcome: "allowed-once" | "rejected" | "cancelled") => {
        if (this.transcript.clearApprovalFlags()) this.transcriptArea.redrawAll();
        handle.hide();
        resolve(outcome);
      };
      card.onDecide = finish;
      const handle = this.tui.showOverlay(card, { anchor: "bottom-center", margin: 1 });
      // Point at the pending call the card is about, behind the overlay.
      if (this.transcript.flagPendingTool(req.toolName)) this.transcriptArea.redrawAll();
      this.tui.setFocus(card);
    });
  }

  private handleGlobalInput(data: string): { consume?: boolean } | undefined {
    // Kitty-protocol terminals report key releases (and repeats): without this
    // guard a single Ctrl+O press toggles twice (expand → instantly collapse)
    // and a held Ctrl+C trips the double-press exit.
    if (isKeyRelease(data) || isKeyRepeat(data)) return undefined;
    // While an overlay (picker / question / approval) is open, let it handle
    // Escape / Ctrl+C instead of the global cancel-or-exit actions.
    const overlayOpen = this.tui.hasOverlay();
    if (matchesKey(data, "ctrl+c")) {
      if (overlayOpen) return undefined;
      if (this.agent.status === "running") {
        this.options.onCancel();
        return { consume: true };
      }
      // Double Ctrl+C exits; a single one only hints (a lone Ctrl+C elsewhere
      // might be dismissing the editor's autocomplete menu).
      const now = Date.now();
      if (now - this.lastCtrlC < 600) {
        this.lastCtrlC = 0;
        void this.options.onExit();
      } else {
        this.lastCtrlC = now;
        this.showNotice("Press Ctrl+C again to exit.");
      }
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+o")) {
      if (overlayOpen) return undefined;
      this.toggleDetails();
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+d")) {
      if (overlayOpen) return undefined;
      void this.options.onExit();
      return { consume: true };
    }
    if (matchesKey(data, "escape")) {
      if (overlayOpen) return undefined;
      if (this.agent.status === "running") {
        this.options.onCancel();
        return { consume: true };
      }
      // Idle: pass Esc through — the editor owns it (dismisses its
      // autocomplete menu); a bare Esc with no menu is a harmless no-op.
      return undefined;
    }
    return undefined;
  }

  private handleSubmit(text: string): void {
    const trimmed = text.trim();
    if (trimmed === "") return;
    this.editor.addToHistory(text);
    this.editor.setText("");
    this.options.onPrompt(trimmed);
    this.render();
  }
}
