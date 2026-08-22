// The TUI application: pi-tui renderer mounted inside the dsh process.
//
// Owns terminal input and presentation only. Agent lifecycle, session
// persistence, tool execution, approval, and the model-facing question tool
// stay as separate in-process services; this module consumes them.

import { basename } from "node:path";
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
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type EditorTheme,
  type MarkdownTheme,
  type OverlayHandle,
  type SelectItem,
  type SelectListTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import { createPalette, type Palette } from "./palette.ts";
import { sanitizeDisplay } from "./sanitize.ts";
import { ClipboardTerminal } from "./terminal.ts";
import { TranscriptModel, type ToolPresenters, type TranscriptRow } from "./transcript.ts";

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
 * whole bar until the next state change.
 */
export class StatusLine implements Component {
  private readonly p: Palette;
  private left = "";
  private right = "";
  private notice: string[] | null = null;

  constructor(p: Palette) {
    this.p = p;
  }

  /** New facts; clears any transient notice. Either side may be empty. */
  setParts(left: string, right: string): void {
    this.left = left;
    this.right = right;
    this.notice = null;
  }

  showNotice(text: string): void {
    this.notice = text.split("\n");
  }

  render(width: number): string[] {
    if (this.notice !== null) return this.notice.map((line) => this.p.dim(line));
    const avail = Math.max(0, width);
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
  constructor(p: Palette, row: Extract<TranscriptRow, { kind: "user" }>) {
    this.text = new Text("", 1, 1);
    this.box.addChild(this.text);
    this.update(row);
  }
  update(row: Extract<TranscriptRow, { kind: "user" }>): void {
    this.text.setText(this.boxPrefix() + row.text);
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

class AssistantRow implements RowComponent {
  private readonly box = new Container();
  private readonly reasoning: Text;
  private readonly markdown: Markdown;
  private readonly p: Palette;
  private readonly isExpanded: () => boolean;
  constructor(
    p: Palette,
    row: Extract<TranscriptRow, { kind: "assistant" }>,
    isExpanded: () => boolean,
  ) {
    this.p = p;
    this.isExpanded = isExpanded;
    this.reasoning = new Text("", 1, 0);
    this.markdown = new Markdown("", 1, 1, markdownTheme(p));
    this.box.addChild(this.reasoning);
    this.box.addChild(this.markdown);
    this.update(row);
  }
  update(row: Extract<TranscriptRow, { kind: "assistant" }>): void {
    const reasoning = row.reasoning === "" ? "" : sanitizeDisplay(row.reasoning);
    this.markdown.setText(sanitizeDisplay(row.text));
    if (this.isExpanded() || reasoning === "") {
      this.reasoning.setText(reasoning === "" ? "" : this.p.dim(`⏤ ${reasoning}`));
      return;
    }
    // Collapsed: light-blue spinner while streaming (frozen glyph once done),
    // size + expand hint, then the newest three lines as a live preview.
    const icon = row.done
      ? this.p.fg("✻", "brightCyan")
      : this.p.fg(
          SPINNER_FRAMES[Math.floor(Date.now() / 110) % SPINNER_FRAMES.length] ?? "✻",
          "brightCyan",
        );
    const head = `${icon} ${this.p.dim(`thinking · ${reasoning.length} chars · Ctrl+O expands`)}`;
    const preview = reasoning
      .split("\n")
      .filter((line) => line.trim() !== "")
      .slice(-3)
      .map((line) =>
        this.p.dim(line.length > 160 ? `  ${line.slice(0, 159)}…` : `  ${line}`),
      );
    this.reasoning.setText([head, ...preview].join("\n"));
  }
  render(width: number): string[] {
    return this.box.render(width);
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
  update(row: Extract<TranscriptRow, { kind: "tool" }>): void {
    const title = row.callView?.title ?? row.name;
    this.header.setText(this.p.fg(`Tool / ${title}`, "cyan"));
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
      if (view.output !== undefined && view.output !== "") lines.push(sanitizeDisplay(view.output));
      if (view.exitCode !== undefined) lines.push(this.p.dim(`exit ${view.exitCode}`));
      else if (view.signal !== undefined) lines.push(this.p.dim(`signal ${view.signal}`));
    } else if (view !== undefined && view.card === "generic" && view.content !== undefined) {
      const text = view.content
        .filter((b) => b.type === "text")
        .map((b) => String((b as { text?: unknown }).text ?? ""))
        .join("");
      if (text !== "") lines.push(sanitizeDisplay(text));
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

function buildRowComponent(
  p: Palette,
  row: TranscriptRow,
  isExpanded: () => boolean,
): RowComponent {
  switch (row.kind) {
    case "user":
      return new UserRow(p, row);
    case "assistant":
      return new AssistantRow(p, row, isExpanded);
    case "tool":
      return new ToolRow(p, row, isExpanded);
    case "notice":
    case "error":
    case "context":
      return new NoticeRow(p, row);
  }
}

/** One component per transcript row, persisted and updated via update(). */
class TranscriptArea extends Container {
  private readonly bySeq = new Map<number, RowComponent>();
  private lastRevision = -1;
  private readonly model: TranscriptModel;
  private readonly p: Palette;
  private readonly isExpanded: () => boolean;

  constructor(model: TranscriptModel, p: Palette, isExpanded: () => boolean) {
    super();
    this.model = model;
    this.p = p;
    this.isExpanded = isExpanded;
  }

  /** Re-run every row's update() (details toggle changes render w/o revision). */
  redrawAll(): void {
    const byRowSeq = new Map(this.model.snapshot.map((r) => [r.seq, r]));
    for (const [seq, comp] of this.bySeq) {
      const row = byRowSeq.get(seq);
      if (row !== undefined) comp.update(row);
    }
  }

  sync(): void {
    if (this.model.currentRevision === this.lastRevision) return;
    this.lastRevision = this.model.currentRevision;
    const seen = new Set<number>();
    for (const row of this.model.snapshot) {
      seen.add(row.seq);
      let comp = this.bySeq.get(row.seq);
      if (comp === undefined) {
        comp = buildRowComponent(this.p, row, this.isExpanded);
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

/**
 * Full-viewport picker with a search field + keyboard-navigable list.
 * Renders a `search> …` line above a SelectList; typing filters by title or
 * id, Up/Down move, Enter resumes, Esc (or a second Esc with text) closes.
 */
class SessionPicker implements Component {
  private readonly queryText: Text;
  private readonly p: Palette;
  private query = "";
  private items: SessionPickItem[];
  private select!: SelectList;
  private index = 0;
  private count = 0;

  onPick?: (value: string) => void;
  onCancel?: () => void;

  constructor(p: Palette, items: SessionPickItem[]) {
    this.p = p;
    this.items = items;
    this.queryText = new Text("", 1, 1);
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
    return [...this.queryText.render(width), ...this.select.render(width)];
  }

  invalidate(): void {
    this.queryText.invalidate();
    this.select.invalidate();
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
  }

  private move(dir: number): void {
    this.index = Math.max(0, Math.min(Math.max(this.count - 1, 0), this.index + dir));
    this.select.setSelectedIndex(this.index);
  }

  private refreshHeader(): void {
    this.queryText.setText(`search> ${this.query}${this.query === "" ? " " : ""}`);
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
  private agent: AgentSurface;
  private modelLabel: string;
  private statusValue: "idle" | "running" = "idle";
  private contextInfo: ContextOccupancy | null = null;
  private cacheRate: number | null = null;
  private readonly workspaceName: string;
  private stopping = false;
  private lastCtrlC = 0;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private detailsExpanded = false;
  private readonly options: TuiAppOptions;

  constructor(options: TuiAppOptions) {
    this.options = options;
    this.p = createPalette(true);
    this.agent = options.agent;
    this.modelLabel = options.modelLabel;
    this.workspaceName = basename(process.cwd());

    this.tui = new TuiAltScreen(this.clipboardTerminal, true);

    this.transcriptArea = new TranscriptArea(this.transcript, this.p, () => this.detailsExpanded);
    this.transcriptScroll = new ScrollView(this.transcriptArea, {
      follow: "end",
      primary: true,
      overscroll: "chain",
      scrollbar: "auto",
    });

    this.status = new StatusLine(this.p);
    this.subagentsLine = new Text("", 1, 1);
    this.editor = new Editor(this.tui, editorTheme(this.p));
    this.editor.onSubmit = (text) => this.handleSubmit(text);
    if (options.autocomplete !== undefined) {
      const provider = new CombinedAutocompleteProvider(
        options.autocomplete.commands as never,
        process.cwd(),
      );
      this.editor.setAutocompleteProvider(provider);
      this.editor.setAutocompleteMaxVisible?.(8);
    }

    const dock = new VStack([
      { component: this.editor, basis: "auto", grow: 0, shrink: 1, minSize: 3 },
      { component: this.status, shrink: 1, minSize: 1 },
      { component: this.subagentsLine, shrink: 1, minSize: 0 },
    ]);
    const root = new VStack([
      { component: this.transcriptScroll, basis: 0, grow: 1, shrink: 1, minSize: 1 },
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

  /** Running-subagent summary under the status line (empty hides the row). */
  setSubagents(running: RunningSubagent[]): void {
    if (running.length === 0) {
      this.subagentsLine.setText("");
      this.render();
      return;
    }
    const lines = running.map((c) => {
      const name = c.label ?? c.id.slice(0, 20);
      const dot = this.p.fg("●", "green");
      const line = c.mode === "continuable" ? `${dot} ${name} (bg)` : `${dot} ${name}`;
      return line.length > 72 ? `${line.slice(0, 71)}…` : line;
    });
    this.subagentsLine.setText(lines.join("\n"));
    this.render();
  }

  start(): void {
    this.updateStatus();
    this.render();
    this.tui.setFocus(this.editor);
    this.tui.start();
  }

  /** Idempotent shutdown: cancel active work, restore the terminal, exit. */
  async stopAndExit(exit: (code: number) => void): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    try {
      if (this.agent.status === "running") this.agent.cancel();
      await this.agent.whenIdle();
      this.tui.stop();
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
    this.tui.stop();
  }

  /** Append multi-line command output as a notice row. */
  appendCommandOutput(text: string): void {
    this.transcript.addNotice(text);
    this.transcriptArea.sync();
    this.render();
  }

  setStatus(status: "idle" | "running"): void {
    this.statusValue = status;
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
    this.render();
  }

  /** Surface a transient notice on the status line; the bar reverts to the
   * session state after `timeoutMs` (or at the next state change). */
  showNotice(text: string, timeoutMs = 8000): void {
    this.status.showNotice(text);
    this.clearNoticeTimer();
    if (timeoutMs > 0) {
      this.noticeTimer = setTimeout(() => {
        this.noticeTimer = undefined;
        this.updateStatus(); // setParts clears the notice and repaints
        this.render();
      }, timeoutMs);
    }
    this.render();
  }

  private clearNoticeTimer(): void {
    if (this.noticeTimer !== undefined) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = undefined;
    }
  }

  private updateStatus(): void {
    this.clearNoticeTimer(); // a real state change retires any pending notice
    const running = this.statusValue === "running";
    const dot = running ? this.p.fg("●", "yellow") : this.p.fg("●", "green");
    const sep = this.p.dim(" · ");
    const left = [`${dot} ${this.p.dim(this.modelLabel)}`];
    if (this.cacheRate !== null) left.push(this.p.dim(`cache ${this.cacheRate}%`));
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
      const picker = new SessionPicker(this.p, sessions);
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

  /** Prompt the human to approve a tool call. */
  askApproval(req: ApprovalRequest): Promise<"allowed-once" | "rejected" | "cancelled"> {
    return new Promise((resolve) => {
      const items: SelectItem[] = [
        { value: "allowed-once", label: "Allow" },
        { value: "rejected", label: "Reject" },
      ];
      const select = new SelectList(items, 2, selectListTheme(this.p));
      const handle = this.tui.showOverlay(select, { anchor: "bottom-left", margin: 1 });
      select.onSelect = (sel) => {
        handle.hide();
        resolve(sel.value as "allowed-once" | "rejected");
      };
      select.onCancel = () => {
        handle.hide();
        resolve("cancelled");
      };
      this.tui.setFocus(select);
    });
  }

  private handleGlobalInput(data: string): { consume?: boolean } | undefined {
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
