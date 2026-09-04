// dsh-tui main plugin: creates the root agent, mounts the TUI, and adapts
// the in-process interaction services (questions, approval, commands) to it.
//
// Mirrors the dsh-headless runner shape: wait for the tree to settle, create
// one agent through the core registry, then drive it. Unlike headless, this
// runner stays alive and is driven by terminal input and the session event
// feed instead of a single task.

import { basename, join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { writeFile, readFile, readdir, rm, rename } from "node:fs/promises";
import { homedir } from "node:os";
import z from "@deepseek-ai/schemastery";
import { randomUUID } from "node:crypto";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { z as zod } from "zod";
import { visibleWidth } from "@earendil-works/pi-tui";
import { TuiApp, formatTokens, type AgentSurface, type AutocompleteCommand, type GoalSummary, type RunningJob } from "./app.ts";
import { createPalette } from "./palette.ts";
import { sanitizeDisplay } from "./sanitize.ts";
import { renderTranscriptMarkdown } from "./export.ts";
import type { ToolPresenters, TodoItem } from "./transcript.ts";
import {
  AGENT_PRESETS_NS,
  composePreset,
  recordedPresetOf,
  sessionIsBlank,
  type ComposedPreset,
  type PresetRoster,
  type PresetRow,
  type SettingsSeam,
} from "./presets.ts";

/** Version string from this repo's package.json, for the boot banner only. */
function readPkgVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "";
  } catch {
    return "";
  }
}

/** DeepSeek harness whale: official favicon silhouette as a half-block raster
 * (each char row = two pixel rows), displayed in brand blue via 24-bit color.
 * Glyphs: █ both halves · ▀ top · ▄ bottom. */
const WHALE_BLUE = "\u001b[38;2;77;107;254m";
const WHALE_RESET = "\u001b[39m";
const WHALE_GLYPHS = [
  "          ▄▄▄▄ ▀ ▄▄",
  "    ▄██████▄██████▄  ▀▀█▄▄▄    ▄▄",
  "   █████████████████▄  ▀█████▄ ▄███▄▄▄",
  "  █████████████████████▄ ▀▀████████████▄",
  " ████████████████████████▄▄ ▀███████████",
  " ███████████████████████████  ▀███████▀",
  " ██▀▀▀██████████████████████▀█▄██▀▀▀",
  "███     ██████████▀▀███████████▀",
  "███▄     ▀███████▀█▀ ████████▀",
  "▀███       ████████  ██████▀",
  " ████       ████████████████",
  " ████▄       █████████████▀",
  " ▀████▄   ▄▄ ▀▀██████████",
  "  █████▄  ███▄▄ ▀████████",
  "   ██████▄ █████▄ ▀███████▄▄",
  "    ████████████████▄▄████████▄",
  "     ▀█████████████▀▀▀",
];

/** Stable Cordis plugin name. */
const name = "tui-runner";

/** Core services required before the terminal front door can start. Everything
 * else in resolveServices is optional-by-design and must stay out of inject so
 * bare boots can still reach their fallback paths. */
const inject = ["agentDefaultModel", "agents", "sessions", "tuiStartup", "appExit"];

const Config = z.object({});

type CordisContext = {
  get<T = unknown>(key: string): T | undefined;
  // Present on the runtime ctx (tui-startup already relies on it); typed here
  // so the runner can publish services for sibling plugins.
  provide(key: string, value: unknown): void;
  // `never[]` is deliberate: parameters check contravariantly, so listeners
  // may declare their concrete payload types while the bus stays untyped here
  // (no `any`).
  on(event: string, listener: (...args: never[]) => void): () => void;
  effect(disposer: () => void | (() => void)): void;
  interval(callback: () => void, ms: number): () => void;
};

const HELP_TEXT = [
  "/exit, /quit     exit the terminal front door",
  "/clear           clear the transcript",
  "/new             start a fresh session on the configured/saved default preset",
  "/preset [id]     switch agent presets (blank session swaps live; otherwise saved as default)",
  "/model           switch THIS session's model only (history carries over; default untouched)",
  "/effort          switch THIS session's reasoning effort (next turn on; default untouched)",
  "/img <path>…     attach image files to your next message",
  "/permission      switch THIS session's sandbox/approval bundle (permission presets)",
  "/compact         fold older history into a summary (core command)",
  "/cost            cumulative provider-reported token usage",
  "/tokens          current context-window occupancy detail",
  "/tools [filter]  list registered tools (native + MCP)",
  "/export [file]   export this conversation to a Markdown file",
  "/sessions        list persisted sessions",
  "/resume <id>     resume a persisted session",
  "/bg <prompt>     start a background task on the worker (worker mode)",
  "/background      alias of /bg",
  "/task <id>       check a background task status (worker mode)",
  "/tasks           list recent background tasks (worker mode)",
  "/rm <prefix>     delete a session (log + projection cache; confirmed)",
  "/session         show the current session id",
  "/rewind          rewind to a past message (restores file edits)",
  "/help            show this help",
  "双击 Esc         打开回退选择器",
  "补全：/ + Tab 出命令菜单 · @ + Tab 出文件引用 · @选中目录后按 Tab 下钻",
  "Ctrl+O          展开/收起思考与工具详情",
].join("\n");

/** Sniff the real image format from magic bytes — extensions lie (renamed
 * files are common), and dsh-attachment-local verifies declared type against
 * fully decoded bytes before accepting anything. */
function sniffImageMediaType(data: Uint8Array): string | undefined {
  const b = data;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    b.length >= 6 &&
    b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 &&
    (b[3] === 0x37 || b[3] === 0x39)
  ) {
    return "image/gif";
  }
  return undefined;
}

interface PreviewEvent {
  type?: string;
  time?: number;
  data?: {
    content?: Array<{ type?: string; text?: unknown }>;
    source?: { kind?: unknown };
    usage?: UsageLike;
    provider?: unknown;
    model?: unknown;
    contextWindow?: unknown;
  };
}

/** Extract the visible text of a message-content block array. */
function messageText(event: PreviewEvent): string {
  const blocks = event.data?.content ?? [];
  return blocks
    .filter((b) => b.type === "text")
    .map((b) => (typeof b.text === "string" ? b.text : ""))
    .join("")
    .trim();
}

function formatStamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** /resume preview for one session: shape of the conversation, the route it
 * rode, and its latest real (non-injected) prompt. Pure — the caller decodes
 * the log. */
function buildPreviewFromEvents(events: ReadonlyArray<PreviewEvent>): string | null {
  if (events.length === 0) return null;

  let prompts = 0;
  let replies = 0;
  let tools = 0;
  let lastPrompt = "";
  let firstTime: number | undefined;
  let lastTime: number | undefined;
  let route = "";
  for (const event of events) {
    if (typeof event.time === "number") {
      if (firstTime === undefined || event.time < firstTime) firstTime = event.time;
      if (lastTime === undefined || event.time > lastTime) lastTime = event.time;
    }
    switch (event.type) {
      case "user/message": {
        // Injected context (endless memory splices etc.) logs as user messages
        // with a plugin source — it is noise for both the count and the excerpt.
        const isHuman = event.data?.source?.kind === "user";
        if (!isHuman) break;
        prompts += 1;
        const text = messageText(event).replace(/\s+/g, " ");
        if (text !== "") {
          lastPrompt = text.length > 160 ? `${text.slice(0, 159)}…` : text;
        }
        break;
      }
      case "assistant/message":
        replies += 1;
        break;
      case "tool/call":
        tools += 1;
        break;
      case "request/context": {
        const { provider, model } = event.data ?? {};
        if (typeof provider === "string" && typeof model === "string") {
          route = `${provider}/${model}`;
        }
        break;
      }
    }
  }

  const lines = [
    `prompts ${prompts} · replies ${replies} · tool calls ${tools}`,
    route !== "" ? `route ${route}` : "",
    firstTime !== undefined && lastTime !== undefined
      ? `${formatStamp(firstTime)} → ${formatStamp(lastTime)}`
      : "",
    "",
    lastPrompt !== "" ? `❝ ${lastPrompt}` : "(no user prompt)",
  ].filter((l) => l !== "");
  return lines.map((l) => `  ${l}`).join("\n");
}

/** Same shape as buildPreviewFromEvents, sourced from the `tuiPreview`
 * projection values instead of a decoded log. */
function formatPreviewFromValues(v: TuiPreviewValue): string | null {
  if (v.prompts === 0 && v.replies === 0 && v.tools === 0) return null;
  const lines = [
    `prompts ${v.prompts} · replies ${v.replies} · tool calls ${v.tools}`,
    v.route !== null ? `route ${v.route.provider}/${v.route.model}` : "",
    v.firstTime !== null && v.lastTime !== null
      ? `${formatStamp(v.firstTime)} → ${formatStamp(v.lastTime)}`
      : "",
    "",
    v.lastPrompt !== null && v.lastPrompt !== "" ? `❝ ${v.lastPrompt}` : "(no user prompt)",
  ].filter((l) => l !== "");
  return lines.map((l) => `  ${l}`).join("\n");
}

/** Human-prompt excerpt cap shared by the preview builder and its projection. */
function promptExcerpt(text: string): string {
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

/** Register the plugin-owned `tuiPreview` projection unit: conversation
 * counts, time range, route, and first/last human-prompt excerpts as whole
 * values. Cells fold lazily over the in-memory log even when events predate
 * registration, and once dsh-session-projection-cache is mounted these
 * values ride its cold ladder — /resume previews stop paying full reads.
 * Failures are contained: the legacy readSession preview stays as fallback. */
function registerPreviewUnit(proj: NonNullable<CoreServices["sessionProjections"]>): void {
  const valueSchema = zod.object({
    prompts: zod.number(),
    replies: zod.number(),
    tools: zod.number(),
    route: zod.union([zod.object({ provider: zod.string(), model: zod.string() }), zod.null()]),
    firstTime: zod.union([zod.number(), zod.null()]),
    lastTime: zod.union([zod.number(), zod.null()]),
    firstPrompt: zod.union([zod.string(), zod.null()]),
    lastPrompt: zod.union([zod.string(), zod.null()]),
  });
  try {
    proj.register({
      key: "tuiPreview",
      stateVersion: 1,
      stateSchema: valueSchema,
      init: () => ({
        prompts: 0,
        replies: 0,
        tools: 0,
        route: null,
        firstTime: null,
        lastTime: null,
        firstPrompt: null,
        lastPrompt: null,
      }),
      apply: (state, event) => {
        const s = { ...(state as TuiPreviewValue) };
        if (typeof event.time === "number") {
          if (s.firstTime === null || event.time < s.firstTime) s.firstTime = event.time;
          if (s.lastTime === null || event.time > s.lastTime) s.lastTime = event.time;
        }
        switch (event.type) {
          case "user/message": {
            if (event.data?.source?.kind !== "user") break;
            s.prompts += 1;
            const text = promptExcerpt(messageText(event).replace(/\s+/g, " "));
            if (text !== "") {
              if (s.firstPrompt === null) s.firstPrompt = text;
              s.lastPrompt = text;
            }
            break;
          }
          case "assistant/message":
            s.replies += 1;
            break;
          case "tool/call":
            s.tools += 1;
            break;
          case "request/context": {
            const { provider, model } = event.data ?? {};
            if (typeof provider === "string" && typeof model === "string") {
              s.route = { provider, model };
            }
            break;
          }
        }
        return s;
      },
      wire: { viewSchema: valueSchema, view: (state) => state },
    });
  } catch (error) {
    console.error(
      `dsh-tui: tuiPreview projection unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Truncate a label to a display width (CJK/wide chars count as two columns). */
function truncate(text: string, max: number): string {
  if (visibleWidth(text) <= max) return text;
  let out = "";
  let w = 0;
  const limit = max - 1; // room for the ellipsis
  for (const ch of text) {
    const cw = visibleWidth(ch);
    if (w + cw > limit) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

/** Relative "…ago" label for a timestamp. */
function relativeTime(ms?: number): string {
  if (ms === undefined) return "";
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** The projection values this TUI consumes off sessionProjections (rc.8
 * dsh-token-meter views; `tokenUsage` exposes totals only — no live sample). */
interface ProjectionValues {
  /** Sample-anchored occupancy: last provider sample plus signed surface
   * movement since it, so a compaction's shadowed tokens are already folded
   * in and `projectedTokens` drops the moment the summary lands. */
  contextPressure?: {
    projectedTokens?: number;
    pressureTokens?: number;
    contextWindow?: number;
  };
  /** Cumulative disjoint buckets (/cost, status-bar `out`); the wire view is
   * the flat bucket object itself (dsh-token-meter `view: state.totals`). */
  tokenUsage?: {
    uncachedInputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  /** Latest todo snapshot (dsh-tool-todo registers the unit). */
  todos?: TodoItem[];
  /** Current session goal (dsh-goal's projection unit; null when none). */
  goal?: {
    goal: {
      objective: string;
      phase: "active" | "paused" | "blocked" | "complete";
      maxGoalRounds: number;
    };
    roundsStarted: number;
  } | null;
  /** This plugin's own preview unit: whole conversation shape for /resume
   * previews, served from the projection-cache cold ladder without a full
   * log read. */
  tuiPreview?: TuiPreviewValue;
}

/** Whole-value wire shape of the `tuiPreview` projection unit. */
interface TuiPreviewValue {
  prompts: number;
  replies: number;
  tools: number;
  route: { provider: string; model: string } | null;
  firstTime: number | null;
  lastTime: number | null;
  firstPrompt: string | null;
  lastPrompt: string | null;
}

/** Reasoning-effort metadata of one route (dsh-llm LlmModelReasoningInfo slice). */
interface EffortMeta {
  efforts: ReadonlyArray<{ id: string; name: string; description?: string }>;
  defaultEffort?: string;
}

interface UsageLike {
  /** Live usage events report this as `inputTokens`; the projection's token
   * totals expose the same disjoint bucket as `uncachedInputTokens`. */
  inputTokens?: unknown;
  uncachedInputTokens?: unknown;
  outputTokens?: unknown;
  cacheReadTokens?: unknown;
  cacheWriteTokens?: unknown;
}

/**
 * Cache hit rate from one usage record, in percent with one decimal.
 * TokenUsage counts are disjoint (input is uncached only), so the hit rate
 * reads over billed input: read / (input + read + write).
 */
function cacheRateOf(usage: UsageLike | undefined): number | undefined {
  if (usage === undefined || typeof usage !== "object") return undefined;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const read = num(usage.cacheReadTokens);
  const input = num(usage.uncachedInputTokens ?? usage.inputTokens);
  const denom = input + read + num(usage.cacheWriteTokens);
  if (denom <= 0) return undefined;
  return Math.round((read / denom) * 1000) / 10;
}

/**
 * Last provider-reported usage + context capacity straight from a session log
 * (last-resort source only: bare boots without the projection/meter services).
 */
function lastUsageReport(
  events: ReadonlyArray<unknown>,
): { promptTokens: number; contextWindow?: number } | undefined {
  let promptTokens: number | undefined;
  let contextWindow: number | undefined;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as { type?: string; data?: Record<string, unknown> } | undefined;
    if (event === undefined) continue;
    const data = event.data ?? {};
    if (promptTokens === undefined && event.type === "assistant/message") {
      const usage = data.usage as UsageLike | undefined;
      if (usage !== undefined && typeof usage === "object") {
        const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
        promptTokens = num(usage.uncachedInputTokens ?? usage.inputTokens) + num(usage.cacheReadTokens) + num(usage.cacheWriteTokens);
        if (promptTokens <= 0) promptTokens = undefined; // meaningless zero — keep scanning
      }
    }
    if (contextWindow === undefined && event.type === "request/context") {
      const window = data.contextWindow;
      if (typeof window === "number" && Number.isFinite(window) && window > 0) {
        contextWindow = window;
      }
    }
    if (promptTokens !== undefined && contextWindow !== undefined) break;
  }
  return promptTokens === undefined ? undefined : { promptTokens, contextWindow };
}

/** Scan events backwards for the last `assistant/message` that reported usage. */
function lastCacheRate(events: ReadonlyArray<unknown>): number | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as { type?: string; data?: { usage?: UsageLike } } | undefined;
    if (event?.type !== "assistant/message") continue;
    const rate = cacheRateOf(event.data?.usage);
    if (rate !== undefined) return rate;
  }
  return undefined;
}

/**
 * The route a session last rode: the latest `request/context` event (logged
 * whenever the route or capacity changes). undefined when none recorded yet.
 */
function recordedRouteOf(
  events: ReadonlyArray<unknown>,
): { provider: string; model: string } | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as { type?: string; data?: { provider?: unknown; model?: unknown } } | undefined;
    if (event?.type !== "request/context") continue;
    const provider = event.data?.provider;
    const model = event.data?.model;
    if (typeof provider === "string" && typeof model === "string") return { provider, model };
  }
  return undefined;
}

/** The reasoning effort a session last rode: the latest `request/header`
 * snapshot's call config (effort IS logged there, unlike request/context).
 * A header that omits `reasoningEffort` means the provider default applies —
 * it must NOT fall back to an older explicit header (that would resurrect a
 * stale effort after the user reset it). undefined when no header records it. */
function recordedEffortOf(
  events: ReadonlyArray<unknown>,
): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as
      | { type?: string; data?: { header?: { config?: { reasoningEffort?: unknown } } } }
      | undefined;
    if (event?.type !== "request/header") continue;
    const effort = event.data?.header?.config?.reasoningEffort;
    return typeof effort === "string" ? effort : undefined;
  }
  return undefined;
}

/** Distilled agent status shown to the app. The real Agent's `status` is a
 *  read-only getter (assigning it throws), so the app surface rides this
 *  variable, updated from `agent/status` events (local harness and relay
 *  attach-client both emit it). */
let surfaceStatus: "idle" | "running" = "idle";

/** Narrow the real Agent handle to the surface the app drives. */
function agentSurface(agent: {
  id: string;
  status: "idle" | "running";
  session: unknown;
  ctx: { get<T = unknown>(key: string): T | undefined };
  followup(message: unknown): void;
  steer(message: unknown): void;
  cancel(cause: { kind: "user" }): void;
  whenIdle(): Promise<void>;
}): AgentSurface {
  surfaceStatus = agent.status;
  return {
    id: agent.id,
    // Live getter: the harness mutates agent.status; a copied value would
    // freeze at boot-time "idle" and break every running-state check.
    get status() {
      return surfaceStatus;
    },
    followup: (m) => agent.followup(m),
    steer: (m) => agent.steer(m),
    cancel: () => agent.cancel({ kind: "user" }),
    whenIdle: () => agent.whenIdle(),
  };
}

interface CoreServices {
  agents: {
    create(options: unknown): Promise<{ agent: Agent }>;
    resume(options: {
      resumeSessionId: unknown;
      agentOptions?: unknown;
      setup?: (ctx: Parameters<typeof installModelSelection>[0]) => void | Promise<void>;
    }): Promise<{ agent: Agent }>;
  };
  agentDefaultModel: {
    currentSelection(): {
      provider: string;
      model: string;
      reasoningEffort?: string;
    };
    /** Persist the default route (settings ns `agent-default-model`). */
    saveSelection?(next: { provider: string; model: string }): Promise<void>;
  };
  /** Model catalog for the /model picker (absent in bare boots). */
  llm?: {
    listProviders(): Array<{ id: string; name?: string }>;
    listModels(provider: string): Promise<Array<{ id: string; name?: string; description?: string }>>;
    /** Exact-route metadata incl. selectable reasoning efforts (absent effort → provider default). */
    resolveModelInfo?(
      provider: string,
      model: string,
      signal?: AbortSignal,
    ): Promise<{
      reasoning?: {
        efforts: ReadonlyArray<{ id: string; name: string; description?: string }>;
        defaultEffort?: string;
      };
    }>;
  };
  sessions: {
    flush(session: unknown): Promise<void>;
    /** Fork a session log; no boundary = whole log, no childId = in-memory. */
    fork?(source: unknown): { events: unknown[] };
  };
  userQuestions?: {
    registerProvider(provider: { ask(request: unknown): Promise<unknown> }): () => void;
  };
  commands?: {
    register(definition: {
      name: string;
      description: string;
      handler: (inv: { rawInput: string }) => { kind: string; text?: string };
    }): () => void;
    execute(
      agent: Agent,
      line: string,
      images?: unknown[],
      signal?: AbortSignal,
    ): Promise<{ result: { kind: string; text?: string } } | undefined>;
  };
  sessionQuery?: {
    listSessions(
      signal?: AbortSignal,
    ): Promise<
      Array<{ header: { id: string; cwd?: string; createdAt?: number; origin?: string }; live: boolean; persisted: boolean }>
    >;
    readTitleSnapshots(
      ids: string[],
      signal?: AbortSignal,
    ): Promise<
      Array<{
        status: "fulfilled" | "rejected";
        reason?: unknown;
        value?: { session?: unknown; title?: { title?: string } };
      }>
    >;
    readSession(
      sessionId: string,
    ): Promise<{ events: Array<{ type: string; data: Record<string, unknown> }> }>;
  };
  sessionProjections?: {
    snapshot(session: unknown): { values: ProjectionValues };
    register(definition: {
      key: string;
      stateVersion: number;
      stateSchema: unknown;
      init: () => unknown;
      apply: (state: unknown, event: PreviewEvent) => unknown;
      wire?: { viewSchema?: unknown; view: (state: unknown) => unknown };
    }): () => void;
  };
  /** Persisted projection checkpoints (mounted by the tui profile patch);
   * coldSnapshot walks cached-row + tail-replay and writes the row back. */
  sessionProjectionCache?: {
    coldSnapshot(
      sessionId: string,
      signal?: AbortSignal,
    ): Promise<{ values: ProjectionValues }>;
  };
  /** Permission presets (base-mounted): sandbox/approval bundles with a
   * durable log write path. */
  permissionPresets?: {
    readonly names: readonly string[];
    current(events: unknown): string;
    optionOf(name: string): { label?: string; description?: string };
    set(session: unknown, name: string): void;
  };
  tokenMeter?: {
    measure(session: unknown): { totalTokens: number };
  };
  subagents?: {
    listChildren(
      parentSessionId: string,
      signal?: AbortSignal,
    ): Promise<
      Array<{ id: string; activity: "running" | "inactive"; mode: "one-shot" | "continuable"; label?: string }>
    >;
  };
  /** Background-job registry (base-mounted); list is owner-fenced + sync. */
  jobs?: {
    list(caller?: unknown): Array<{
      id: unknown;
      label?: unknown;
      status: string;
    }>;
  };
  /** Harness @-file discovery (mounted by the tui-dev profile patch). */
  fileReferences?: {
    list(
      agent: unknown,
      query: string,
      signal: AbortSignal,
    ): Promise<Array<{ path: string; kind: string }>>;
  };
  /** Cross-session mention candidates (mounted by the tui-dev profile patch);
   * mentions carry the canonical markdown the resolver expands at pre-step. */
  sessionReferenceResolver?: {
    remoteExportCandidates(
      agent: unknown,
      query: string,
      signal?: AbortSignal,
    ): Promise<Array<{ mention: string; label: string; cwd?: string; createdAt?: number }>>;
  };
  /** Content-addressed image store (mounted by the tui-dev profile patch). */
  attachments?: {
    saveImage(input: {
      data: Uint8Array;
      mediaType: string;
      name?: string;
    }): Promise<Record<string, unknown>>;
  };
  /** Optional roster over ~/.dsh/.agent-presets (absent in bare boots). */
  agentPresets?: PresetRoster;
  /** User-settings seam; the /preset default persists through its ns. */
  settings?: SettingsSeam;
  appExit: (code: number) => void;
}

interface Agent {
  id: string;
  status: "idle" | "running";
  session: { events: unknown[]; append?(type: string, data: unknown): void };
  ctx: { get<T = unknown>(key: string): T | undefined };
  followup(message: unknown): void;
  steer(message: unknown): void;
  cancel(cause: { kind: "user" }): void;
  whenIdle(): Promise<void>;
}

function resolveServices(ctx: CordisContext): CoreServices | undefined {
  const agents = ctx.get<CoreServices["agents"]>("agents");
  const agentDefaultModel = ctx.get<CoreServices["agentDefaultModel"]>("agentDefaultModel");
  const sessions = ctx.get<CoreServices["sessions"]>("sessions");
  const userQuestions = ctx.get<CoreServices["userQuestions"]>("userQuestions");
  const commands = ctx.get<CoreServices["commands"]>("commands");
  const sessionQuery = ctx.get<CoreServices["sessionQuery"]>("sessionQuery");
  const sessionProjections = ctx.get<CoreServices["sessionProjections"]>("sessionProjections");
  const permissionPresets = ctx.get<CoreServices["permissionPresets"]>("permissionPresets");
  const tokenMeter = ctx.get<CoreServices["tokenMeter"]>("tokenMeter");
  const subagents = ctx.get<CoreServices["subagents"]>("subagents");
  const jobs = ctx.get<CoreServices["jobs"]>("jobs");
  const fileReferences = ctx.get<CoreServices["fileReferences"]>("fileReferences");
  const sessionReferenceResolver = ctx.get<CoreServices["sessionReferenceResolver"]>(
    "sessionReferenceResolver",
  );
  const attachments = ctx.get<CoreServices["attachments"]>("attachments");
  const agentPresets = ctx.get<PresetRoster>("agentPresets");
  const settings = ctx.get<SettingsSeam>("settings");
  const llm = ctx.get<CoreServices["llm"]>("llm");
  const appExit = ctx.get<CoreServices["appExit"]>("appExit");
  if (agents === undefined || agentDefaultModel === undefined || sessions === undefined) return undefined;
  if (appExit === undefined) {
    throw new Error("dsh-tui: the launcher must provide ctx.appExit before the tree mounts");
  }
  return {
    agents,
    agentDefaultModel,
    sessions,
    userQuestions,
    commands,
    sessionQuery,
    sessionProjections,
    permissionPresets,
    tokenMeter,
    subagents,
    jobs,
    fileReferences,
    sessionReferenceResolver,
    attachments,
    agentPresets,
    settings,
    llm,
    appExit,
  };
}

/** Plugin config (patch layer): `preset` pins the deployment's preset;
 * `provider`/`model` pin the model route; `mirrorRoot` pins the relay mirror
 * session cwd to a fixed root (同 id 不跨 cwd 根重复, docs relay-v2-tui-mirror-root).
 * All optional. */
function parseConfig(config: unknown): { preset?: string; provider?: string; model?: string; mirrorRoot?: string } {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return {};
  const cfg = config as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  return { preset: str(cfg.preset), provider: str(cfg.provider), model: str(cfg.model), mirrorRoot: str(cfg.mirrorRoot) };
}

function apply(ctx: CordisContext, config?: unknown): void {
  // Fire-and-forget the whole front door: apply must return so the plugin
  // settles, otherwise `loader.await()` inside run() deadlocks on us.
  void run(ctx, parseConfig(config)).catch((error: unknown) => {
    process.stderr.write(`dsh-tui: ${error instanceof Error ? error.message : String(error)}\n`);
    ctx.get<(code: number) => void>("appExit")?.(1);
  });
}

async function run(
  ctx: CordisContext,
  own: { preset?: string; provider?: string; model?: string; mirrorRoot?: string },
): Promise<void> {
  await ctx.get<{ await(): Promise<void> }>("loader")?.await();

  // Fail loud before any screen takeover when the streams are not TTYs.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("dsh-tui: stdin and stdout must be TTYs; refusing to boot.\n");
    ctx.get<(code: number) => void>("appExit")?.(1);
    return;
  }

  const resolved = resolveServices(ctx);
  if (resolved === undefined) return;
  const services = resolved; // narrowed copy, visible inside closures

  // Register before any preview can fire; lazy folds pick the unit up even
  // for sessions opened earlier.
  if (services.sessionProjections !== undefined) {
    registerPreviewUnit(services.sessionProjections);
  }

  // Create (or resume) the root agent through the core registry. Resume is a
  // launcher-level decision: `dsh --profile tui --resume <id>` arrives through
  // tuiStartup and reconstructs the persisted session instead of a new one.
  // Effective route for NEW sessions: patch-layer config pins (provider/model)
  // win over the harness's current default selection.
  const selection = services.agentDefaultModel.currentSelection();
  const bootedResumeId = ctx.get<{ resume?: string }>("tuiStartup")?.resume;
  let resumeId = bootedResumeId;
  const agentOptions = {
    provider: own.provider ?? selection.provider,
    model: own.model ?? selection.model,
    // Consumed by makeSetup's selection ref (agents.create's AgentOptions
    // ignores it) — seeds the session's initial reasoning effort.
    reasoningEffort: selection.reasoningEffort,
  };
  // Resume route (user rule, overrides official #67): the session's own
  // recorded route wins — a deployment pin affects NEW sessions only, never
  // history. The recorded model missing/no longer existing falls back to the
  // default (pin ?? saved default).
  let resumeRouteOverride: { provider: string; model: string } | undefined;
  /** Effort the resumed session rides (last header record ?? settings default). */
  let resumeEffort: string | undefined;

  /**
   * Model-selection + preset mount chain installed via the factory hook.
   * Always installs a concrete route: besides request routing, the selection
   * supplies the `provider`/`model` prompt variables that the deployment
   * persona (and preset personas) render as `{{model}}` — a resumed session
   * whose route comes from its own records still needs that variable value.
   */
  function makeSetup(
    composed: ComposedPreset,
    route: { provider: string; model: string; reasoningEffort?: string },
  ): (agentCtx: Parameters<typeof installModelSelection>[0]) => void | Promise<void> {
    return (agentCtx) => {
      // Keep the ref handle: /effort writes through it (session-scoped,
      // effective next turn) — the official mutable-selection seam.
      // Cast: our slice carries reasoningEffort as plain string; the official
      // param brands it (ReasoningEffortId) — identical at runtime.
      selectionRef = { current: route, assembled: undefined };
      installModelSelection(agentCtx, selectionRef as Parameters<typeof installModelSelection>[1]);
      return composed.setup?.(agentCtx);
    };
  }
  const warnPreset = (message: string): void => {
    process.stderr.write(`dsh-tui: ${message}\n`);
  };

  /**
   * Facts read once from a resumed session's log: its recorded preset, its
   * last recorded route (the latest `request/context` event), and its last
   * used reasoning effort (the latest `request/header` call config).
   */
  async function bootResumeFacts(id: string): Promise<{
    presetId?: string;
    recordedRoute?: { provider: string; model: string };
    recordedEffort?: string;
  }> {
    try {
      const snap = await services.sessionQuery?.readSession(id);
      if (snap !== undefined) {
        return {
          presetId: recordedPresetOf(snap.events),
          recordedRoute: recordedRouteOf(snap.events),
          recordedEffort: recordedEffortOf(snap.events),
        };
      }
    } catch {
      /* unreadable log — fall through */
    }
    return {};
  }

  /** Whether the llm catalog still supplies this route. Uncheckable → true. */
  async function routeExists(route: { provider: string; model: string }): Promise<boolean> {
    const llm = services.llm;
    if (llm === undefined) return true;
    let providers: Array<{ id: string }>;
    try {
      providers = llm.listProviders();
    } catch {
      return true; // uncheckable → assume present
    }
    if (!providers.some((p) => p.id === route.provider)) return false;
    // listModels failure is a transient catalog hiccup, not proof the model is
    // gone — treat it as uncheckable (assume present), matching listProviders.
    const models = await llm.listModels(route.provider).catch(() => undefined);
    if (models === undefined) return true;
    return models.some((m) => m.id === route.model);
  }

  // Launch-time resolution. Fresh sessions ride the deployment pin ?? the
  // saved default; resumes ride the session's own records, falling back to
  // the default only when no record exists or the recorded model is gone.
  let requestedPreset = own.preset;
  // The route the booted agent ACTUALLY rides; single source of truth for the
  // status-bar label and the /model "current" check.
  let liveRoute: { provider: string; model: string } = agentOptions;
  /** Live selection ref of the adopted agent (makeSetup hands it back here);
   * /effort writes reasoningEffort through it — session-scoped, next turn.
   * Shape mirrors dsh-agent's ModelSelectionRef. */
  let selectionRef:
    | {
        current: { provider: string; model: string; reasoningEffort?: string } | undefined;
        assembled: { provider: string; model: string; reasoningEffort?: string } | undefined;
      }
    | undefined;
  /** Resolved reasoning-effort metadata for the active route (null = none exposed). */
  let effortMeta: EffortMeta | undefined;
  /** Route key effortMeta was resolved for + refresh generation (race guard:
   * a slow resolve for an old route must never overwrite a newer one). */
  let effortMetaKey = "";
  let effortGeneration = 0;
  /** worker 模式（已 attach）标志：本地 /new 用 process.cwd()，worker /new 用 mirrorRoot（2b）。 */
  let workerMode = false;
  /** 当前 worker 的 workspace 绝对路径（本地模式为空；/attach、/workspace、/detach 时更新）。 */
  let currentWorkspacePath = "";
  /** 当前内存里的模型选择：ref 优先，其次 liveRoute，最后启动默认。 */
  function currentModelSelection(): { provider: string; model: string; reasoningEffort?: string } {
    return selectionRef?.current ?? liveRoute ?? agentOptions;
  }
  /** 把 worker 的绝对 workspace 压成 `~/...`（macOS /Users/<u>、Linux /home/<u> 均识别）。 */
  function homeRelativeDir(path: string): string {
    const m = path.match(/^(\/Users\/[^/]+|\/home\/[^/]+)(\/.*)?$/);
    if (m === null) return path;
    return m[2] === undefined ? "~" : `~${m[2]}`;
  }
  let resumeTrace = "no-resume";
  if (resumeId !== undefined) {
    const facts = await bootResumeFacts(resumeId);
    requestedPreset = facts.presetId ?? own.preset;
    // Effort restore (design §3.3): the session's last-used effort wins over
    // the settings default; no header record yet → settings default.
    resumeEffort = facts.recordedEffort ?? selection.reasoningEffort;
    if (facts.recordedRoute === undefined) {
      resumeRouteOverride = agentOptions; // no record — ride the default
      resumeTrace = "no-record→default";
    } else if (!(await routeExists(facts.recordedRoute))) {
      resumeRouteOverride = agentOptions; // recorded model gone — default
      resumeTrace = "missing-recorded→default";
    } else {
      resumeRouteOverride = undefined; // records win; install nothing
      liveRoute = facts.recordedRoute;
      resumeTrace = `records→${facts.recordedRoute.provider}/${facts.recordedRoute.model}`;
    }
    process.stderr.write(`dsh-tui boot: resume=${resumeId} ${resumeTrace}\n`);
  }
  const composed = await composePreset(services.agentPresets, requestedPreset, warnPreset);

  // A missing/failed resume target (e.g. a rewind handoff whose flush lost
  // the race) must degrade to a fresh session — dying here strands the user
  // outside the TUI with only a stderr line.
  let created: Awaited<ReturnType<typeof services.agents.resume>> | undefined;
  if (resumeId !== undefined) {
    try {
      created = await services.agents.resume({
        resumeSessionId: SessionId(resumeId),
        // OFFICIAL SHAPE — always pass the object. Undefined halves mean "the
        // session's own records supply the route"; omitting agentOptions
        // entirely yields a routeless agent ("has no provider/model").
        // Session's own records supply the route AND the effort (last
        // request/header snapshot); settings default only fills gaps.
        agentOptions: {
          provider: resumeRouteOverride?.provider,
          model: resumeRouteOverride?.model,
        },
        setup: makeSetup(composed, {
          ...(resumeRouteOverride ?? liveRoute),
          reasoningEffort: resumeEffort ?? selection.reasoningEffort,
        }),
      });
    } catch (error) {
      process.stderr.write(
        `dsh-tui: resume ${resumeId} failed: ${error instanceof Error ? error.message : String(error)} — composing a fresh session\n`,
      );
      resumeId = undefined;
      liveRoute = agentOptions;
    }
  }
  created ??= await services.agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: {
      // boot 默认本地模式：cwd 跟随启动目录；worker 模式的新会话在 startNewSession 里用 mirrorRoot。
      cwd: process.cwd(),
      ...(composed.agentPreset === undefined ? {} : { agentPreset: composed.agentPreset }),
    },
    agentOptions,
    setup: makeSetup(composed, agentOptions),
  });
  let agent: Agent = created.agent;
  await agent.whenIdle();

  function presentersFor(target: Agent): ToolPresenters {
    const tools = target.ctx.get<{
      get(n: string):
        | {
            presentCall?: (a: unknown) => unknown;
            presentResult?: (a: unknown, r: unknown) => unknown;
          }
        | undefined;
    }>("tools");
    return {
      presentCall: (toolName, args) => tools?.get(toolName)?.presentCall?.(args) as never,
      presentResult: (toolName, args, result) =>
        tools?.get(toolName)?.presentResult?.(args, result) as never,
    };
  }
  let presenters: ToolPresenters = presentersFor(agent);
  /** Monotonic guard for refreshSubagents(): a newer refresh supersedes an
   * older in-flight response. Declared before any early refresh call to
   * avoid TDZ on first boot. */
  let subagentRefreshGeneration = 0;

  /**
   * Slash-command catalog for the editor menu: the full commands registry
   * (which already carries our registered commands) plus local aliases, with
   * argument completions wired for the picker-backed commands.
   */
  function autocompleteCommands(): AutocompleteCommand[] {
    const out: Array<AutocompleteCommand> = [];
    const registry = services.commands as
      | (CoreServices["commands"] & { list?(a: unknown): unknown[] })
      | undefined;
    if (registry?.list !== undefined) {
      try {
        for (const desc of registry.list(agent)) {
          const d = desc as { name?: unknown; description?: unknown };
          if (typeof d.name === "string" && d.name !== "") {
            out.push({
              name: d.name,
              description: typeof d.description === "string" ? d.description : undefined,
            });
          }
        }
      } catch {
        /* enumeration failure degrades to the local list below */
      }
    }
    const locals: AutocompleteCommand[] = [
      { name: "exit", description: "Exit the terminal front door" },
      { name: "quit", description: "Exit the terminal front door" },
      { name: "clear", description: "Clear the transcript" },
      { name: "help", description: "Show dsh-tui help" },
      { name: "session", description: "Show the current session id" },
      { name: "effort", description: "Pick the reasoning effort for this session" },
      { name: "img", description: "Attach image files to your next message" },
      { name: "permission", description: "Switch this session's sandbox/approval bundle" },
      { name: "new", description: "Start a fresh session on the configured/saved default preset" },
      {
        name: "preset",
        description: "Switch agent presets",
        argumentHint: "[id]",
        getArgumentCompletions: async () => {
          const roster = services.agentPresets;
          if (roster === undefined) return null;
          try {
            const rows = await roster.list();
            return rows.map((p) => ({
              value: p.id,
              label: p.name ?? p.id,
              description: p.description,
            }));
          } catch {
            return null;
          }
        },
      },
      { name: "sessions", description: "List sessions in this workspace" },
      { name: "rm", description: "Delete a session (confirmed)", argumentHint: "<id-prefix>" },
      {
        name: "resume",
        description: "Resume a persisted session",
        argumentHint: "<id>",
        getArgumentCompletions: async () => {
          try {
            const { items } = await loadSessionItems();
            return items.slice(0, 10).map((i) => ({
              value: i.value,
              label: i.label,
              description: i.description,
            }));
          } catch {
            return null;
          }
        },
      },
      { name: "model", description: "Switch this session's model (history carries over)" },
      {
        name: "workspace",
        description: "Worker mode: switch workspace on the attached launcher",
        argumentHint: "[dir]",
        getArgumentCompletions: async (prefix) => {
          const relayClient = ctx.get<{
            currentDevice(): string;
            listWorkspaces(deviceId: string): Promise<Array<{ path: string; kind: "dir" | "running"; deviceId?: string }>>;
          }>("relayClient");
          if (relayClient === undefined) return null;
          const current = relayClient.currentDevice();
          if (current === "") return null;
          const launcher = current.includes("--") ? current.slice(0, current.indexOf("--")) : current;
          try {
            const workspaces = await relayClient.listWorkspaces(launcher);
            const needle = prefix.trim();
            const rows = workspaces
              .filter((w) => needle === "" || w.path.startsWith(needle))
              .slice(0, 20);
            if (rows.length === 0) {
              app.showNotice(
                workspaces.length === 0
                  ? "No workspaces available on this worker."
                  : "No matching workspaces on this worker.",
              );
              return null;
            }
            return rows.map((w) => ({
              value: w.path,
              label: w.path,
              description: w.kind === "running" ? `running · ${w.deviceId ?? ""}` : "directory",
            }));
          } catch {
            return null;
          }
        },
      },
      { name: "tools", description: "List registered tools (native + MCP)", argumentHint: "[filter]" },
    ];
    for (const local of locals) {
      const existing = out.find((c) => c.name === local.name);
      if (existing !== undefined) {
        if (existing.getArgumentCompletions === undefined && local.getArgumentCompletions !== undefined) {
          existing.getArgumentCompletions = local.getArgumentCompletions;
        }
        continue;
      }
      out.push(local);
    }
    return out;
  }

  // Terminal command catalog.
  if (services.commands !== undefined) {
    services.commands.register({
      name: "exit",
      description: "Exit the terminal front door",
      handler: () => {
        void stopAndExit();
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "clear",
      description: "Clear the transcript",
      handler: () => {
        app.model.clear();
        app.onSessionEvent();
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "help",
      description: "Show dsh-tui help",
      handler: () => ({ kind: "success", text: HELP_TEXT }),
    });
    services.commands.register({
      name: "sessions",
      description: "List persisted sessions",
      handler: () => {
        void listSessions();
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "rm",
      description: "Delete a session by id prefix (confirmed): /rm <prefix>",
      handler: ({ rawInput }) => {
        void doRm(rawInput);
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "resume",
      description: "Resume a persisted session: /resume <session-id>",
      handler: ({ rawInput }) => {
        void doResume(`/resume ${rawInput}`);
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "new",
      description: "Start a fresh session",
      handler: () => {
        void startNewSession().catch((error) => {
          app.showNotice(`/new failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "preset",
      description: "Switch agent presets: /preset [id]",
      handler: ({ rawInput }) => {
        void doPreset(rawInput === "" ? "/preset" : `/preset ${rawInput}`).catch((error) => {
          app.showNotice(`/preset failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "model",
      description: "Pick the default provider/model route",
      handler: () => {
        void doModel().catch((error) => {
          app.showNotice(`/model failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "attach",
      description: "Local→worker attach / worker device switch: /attach [id]",
      handler: ({ rawInput }) => {
        void doAttach(rawInput).catch((error) => {
          app.showNotice(`/attach failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "device",
      description: "alias of /attach (worker device switch)",
      handler: ({ rawInput }) => {
        void doAttach(rawInput).catch((error) => {
          app.showNotice(`/device failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "detach",
      description: "Return to local mode (leave the worker)",
      handler: () => {
        void doDetach().catch((error) => {
          app.showNotice(`/detach failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "workspace",
      description: "Worker mode: pick/switch workspace: /workspace [dir]",
      handler: ({ rawInput }) => {
        void doWorkspace(`/workspace ${rawInput}`).catch((error) => {
          app.showNotice(`/workspace failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "bg",
      description: "Worker mode: start a background task: /bg <prompt>",
      handler: ({ rawInput }) => {
        void doBg(rawInput.trim()).catch((error) => {
          app.showNotice(`/bg failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "background",
      description: "alias of /bg (start a background task)",
      handler: ({ rawInput }) => {
        void doBg(rawInput.trim()).catch((error) => {
          app.showNotice(`/background failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "task",
      description: "Worker mode: check a background task: /task <taskId>",
      handler: ({ rawInput }) => {
        void doTask(rawInput.trim()).catch((error) => {
          app.showNotice(`/task failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "tasks",
      description: "Worker mode: list recent background tasks: /tasks",
      handler: () => {
        void doTasks().catch((error) => {
          app.showNotice(`/tasks failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "effort",
      description: "Pick the reasoning effort for this session",
      handler: () => {
        void doEffort().catch((error) => {
          app.showNotice(`/effort failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "cost",
      description: "Show cumulative token usage",
      handler: () => {
        showCost();
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "tokens",
      description: "Show context-window occupancy detail",
      handler: () => {
        showTokens();
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "tools",
      description: "List registered tools (native + MCP)",
      handler: ({ rawInput }) => {
        showTools(rawInput);
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "export",
      description: "Export this conversation to a Markdown file",
      handler: (invocation: { rawInput: string }) => {
        void doExport(invocation.rawInput).catch((error) => {
          app.showNotice(`/export failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return { kind: "success", text: "Export started." };
      },
    });
  }

  const app = new TuiApp({
    agent: agentSurface(agent),
    modelLabel: `${liveRoute.provider}/${liveRoute.model}`,
    presenters,
    onPrompt: async (text, images) => {
      if (text.startsWith("/")) {
        void runCommand(text).catch((error) => {
          app.showNotice(`${text.split(/\s+/)[0]} failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return;
      }
      const relayClient = ctx.get<{ currentDevice(): string; isAttached(): boolean }>("relayClient");
      if (relayClient !== undefined && relayClient.currentDevice() !== "" && !relayClient.isAttached()) {
        // worker 模式且还没有流：首句输入自动在 worker 上建新会话（与本地首句建会话对齐）。
        const ok = await startNewSession();
        if (!ok) return;
      }
      const content = [{ type: "text", text }] as unknown as Parameters<
        typeof createUserMessage
      >[0]["content"];
      for (const img of images ?? []) {
        // Full ImageAttachmentRef — the pi-ai adapter resolves request
        // versions from it at assembly time.
        content.push({ type: "image", attachment: img.ref } as never);
      }
      const msg = createUserMessage({
        content,
        source: { kind: "user" },
      });
      if (agent.status === "running") agent.steer(msg);
      else agent.followup(msg);
    },
    saveImages:
      services.attachments === undefined
        ? undefined
        : async (paths) => {
            const saved: Array<{
              path: string;
              name: string;
              mediaType: string;
              attachmentId: string;
              ref: Record<string, unknown>;
            }> = [];
            for (const path of paths) {
              const data = new Uint8Array(await readFile(path));
              // Trust bytes, not the extension — admission decodes and
              // compares, so a renamed file must declare what it really is.
              const mediaType = sniffImageMediaType(data);
              if (mediaType === undefined) {
                throw new Error(
                  `${basename(path)} is not a decodable png/jpeg/webp/gif image`,
                );
              }
              const ref = await services.attachments!.saveImage({
                data,
                mediaType,
                name: basename(path),
              });
              saved.push({
                path,
                name: basename(path),
                mediaType,
                attachmentId: String(ref.attachmentId ?? ""),
                ref,
              });
            }
            return saved;
          },
    onCancel: () => agent.cancel({ kind: "user" }),
    onDoubleEscape: () => {
      void doRewindPicker();
    },
    onExit: () => stopAndExit(),
    autocomplete: { commands: autocompleteCommands() },
    fileCompletions:
      services.fileReferences === undefined
        ? undefined
        : (query, signal) =>
            services.fileReferences!.list(agent, query, signal).then((candidates) =>
              candidates.map((c) => ({
                path: c.path,
                kind: c.kind === "directory" ? ("directory" as const) : ("file" as const),
              })),
            ),
    sessionCompletions:
      services.sessionReferenceResolver === undefined
        ? undefined
        : (query, signal) =>
            services.sessionReferenceResolver!
              .remoteExportCandidates(agent, query, signal)
              .then((candidates) =>
                candidates.map((c) => ({
                  mention: c.mention,
                  label: c.label,
                  description: [
                    c.cwd !== undefined ? c.cwd.replace(/^\/Users\/[^/]+/, "~") : undefined,
                    typeof c.createdAt === "number" ? relativeTime(c.createdAt) : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                })),
              ),
    sessionPreview: async (sessionId) => {
      // Cold ladder first: cached checkpoint + persistence tail replay, no
      // full-log decode; the row is written back so repeat hovers get
      // cheaper. Falls through to the legacy full read when the cache is
      // absent, the session has no persisted log, or the unit is missing.
      const cacheSvc = services.sessionProjectionCache;
      if (cacheSvc !== undefined) {
        try {
          const cut = await cacheSvc.coldSnapshot(sessionId);
          const fromValues = cut.values.tuiPreview;
          if (fromValues !== undefined) {
            const formatted = formatPreviewFromValues(fromValues);
            if (formatted !== null) return formatted;
          }
        } catch {
          /* fall through to the legacy path */
        }
      }
      const query = services.sessionQuery;
      if (query === undefined) return null;
      return query
        .readSession(sessionId)
        .then((loaded) => buildPreviewFromEvents((loaded.events ?? []) as ReadonlyArray<PreviewEvent>))
        .catch(() => null);
    },
  });

  // On resume, rebuild the transcript from the persisted log before live events.
  // skipStreamDeltas: fold from assistant/message final states — a large log
  // expands to ~10× its line count in chunk events whose replay only re-derives
  // text the final messages already carry (resume-perf analysis §3-B).
  if (resumeId !== undefined) {
    app.model.rebuild(agent.session.events as never, presenters, { skipStreamDeltas: true });
    app.onSessionEvent();
    app.appendCommandOutput(`Resumed session ${agent.id}.`);
    seedProjections();
  }
  await refreshEffortMeta(); // resolve route efforts before the banner renders
  // relay 模式（attach-client）：worker 会话事件流才是模型权威。resume 后
  // attach-client 从回放的 request/context 恢复 route 并 emit 到这里，静默
  // 同步本地状态栏（不发 wire 帧、不刷 command output）。
  ctx.on("relay/model-restored", (payload: { provider?: unknown; model?: unknown; reasoningEffort?: unknown }) => {
    if (typeof payload.provider !== "string" || typeof payload.model !== "string") return;
    const route = { provider: payload.provider, model: payload.model };
    if (selectionRef !== undefined) {
      selectionRef.current = {
        provider: route.provider,
        model: route.model,
        ...(typeof payload.reasoningEffort === "string" ? { reasoningEffort: payload.reasoningEffort } : {}),
      };
    }
    liveRoute = route;
    app.setModelLabel(`${liveRoute.provider}/${liveRoute.model}`);
    void refreshEffortMeta();
  });
  // 本地/worker 双模式：attach-client 上报当前设备；"" = 本地模式。
  ctx.on("relay/device-changed", (payload: { deviceId?: unknown }) => {
    const id = typeof payload?.deviceId === "string" ? payload.deviceId : "";
    workerMode = id !== "";
    if (id === "") {
    // 保留 currentWorkspacePath：降级只是清空设备标签，恢复后按原设备路径继续显示。
    app.setDeviceLabel("");
    return;
  }
    const host = id.includes("--") ? id.slice(0, id.indexOf("--")) : id;
    const dir = currentWorkspacePath === "" ? "" : homeRelativeDir(currentWorkspacePath);
    app.setDeviceLabel(dir === "" ? host : `${host}:${dir}`);
  });
  // boot 默认本地模式：状态栏 workspace 槽显示本地 cwd（attach 事件到达后再覆盖）。
  app.setDeviceLabel("");
  showBootBanner();
  updateContextPressure();
  refreshSubagents();
  refreshGoal();

  async function stopAndExit(): Promise<void> {
    try {
      await services.sessions.flush(agent.session);
    } catch {
      /* flush failure still exits */
    }
    // 先优雅关闭 relay 连接再退出：不关 ws 时 active socket 会让 appExit
    // 的优雅退出卡在 exiting…，且连接半开会让 hub 上的 stream/owner 残留。
    const relayClient = ctx.get<{ shutdown?(): Promise<void> }>("relayClient");
    try {
      await relayClient?.shutdown?.();
    } catch {
      /* shutdown failure still exits */
    }
    await app.stopAndExit(services.appExit, resumeHint());
  }

  /** Parting hint printed after the TUI tears down: the command that reopens
   * this session (harness convention: `--resume <sessionId>`). Assumes the
   * usual `dsh …` launcher — aliases and absolute paths are not reconstructed.
   * Blank sessions have nothing worth reopening — skip the noise. */
  function resumeHint(): string | undefined {
    if (sessionIsBlank(agent.session.events as Array<{ type?: string }>)) return undefined;
    const args = argvWithoutResume(process.argv.slice(2)).map(quoteIfNeeded);
    return `\nResume with the command below:\n  dsh ${[...args, "--resume", quoteIfNeeded(agent.id)].join(" ")}\n`;
  }

  /** Single-quote a token for shell use only when needed, so the common path
   * (`--profile tui`) stays visually identical to what the user typed. */
  function quoteIfNeeded(token: string): string {
    return /^[A-Za-z0-9_@%+=:,./-]+$/.test(token) ? token : `'${token.replaceAll("'", "'\\''")}'`;
  }

  /** Copy of launch args with any --resume target removed (callers append
   * their own); shared by the relaunch execve and the exit hint so a stale
   * `--resume` from this boot can never shadow the new target. */
  function argvWithoutResume(args: ReadonlyArray<string>): string[] {
    const kept: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i] ?? "";
      if (arg === "--resume") {
        i += 1; // skip its value too
        continue;
      }
      if (arg.startsWith("--resume=")) continue;
      kept.push(arg);
    }
    return kept;
  }

  /** The preset id the live agent currently runs, or undefined when none. */
  function currentPreset(): string | undefined {
    try {
      return services.agentPresets?.composedPreset(agent.ctx);
    } catch {
      return undefined;
    }
  }

  /** Boot-time welcome block (blank sessions only): whale + route/preset/
   * workspace + key hints. Client-side chrome — styled here (the whale carries
   * its own 24-bit color), rendered verbatim by the transcript, never exported.
   * Whale and slogan are centered on the widest banner line. */
  function showBootBanner(): void {
    if (!sessionIsBlank(agent.session.events as Array<{ type?: string }>)) return;
    const p = createPalette(true);
    const version = readPkgVersion();
    const preset = currentPreset();
    const thinkName = effectiveEffortName();
    const meta = [
      sanitizeDisplay(`${liveRoute.provider}/${liveRoute.model}`),
      ...(preset === undefined ? [] : [`preset ${sanitizeDisplay(preset)}`]),
      ...(thinkName === undefined ? [] : [`think ${sanitizeDisplay(thinkName)}`]),
      sanitizeDisplay(process.cwd()),
    ].join(" · ");
    const title = `✻ dsh-tui${version === "" ? "" : ` v${version}`} · deepseek harness`;
    const hint = "/help 命令一览 · @ 文件补全 · Ctrl+O 展开思考 · Esc 打断";
    const sloganText = "探索未至之境";
    // Canvas = the widest text line; glyph chars are single-width, the
    // slogan is 6 CJK chars (12 columns).
    const canvas = Math.max(
      Math.max(...WHALE_GLYPHS.map((l) => l.length)) + 4,
      visibleWidth(title),
      visibleWidth(meta),
      visibleWidth(hint),
      12,
    );
    const whalePad = " ".repeat(Math.max(0, Math.floor((canvas - Math.max(...WHALE_GLYPHS.map((l) => l.length))) / 2)));
    const art = WHALE_GLYPHS.map((line) => `${whalePad}${WHALE_BLUE}${line}${WHALE_RESET}`).join("\n");
    const slogan = p.fg(`${" ".repeat(Math.max(0, Math.floor((canvas - 12) / 2)))}探索未至之境`, "brightBlue");
    app.appendBanner(
      [art, "", slogan, "", p.bold(title), p.dim(meta), "", p.dim(hint)].join("\n"),
    );
  }

  /** Rebind the app + every closure to a newly adopted agent (/new path). */
  async function adoptAgent(next: Agent): Promise<void> {
    await next.whenIdle();
    agent = next;
    presenters = presentersFor(next);
    app.setAgent(agentSurface(next));
    app.setCacheRate(null); // fresh session: no usage reported yet
    app.model.clear();
    app.onSessionEvent();
    updateContextPressure();
    refreshSubagents();
    refreshGoal();
  }

  /** /new — fresh session in-process: create + rebind, keep this terminal.
   * @returns true 成功；false 被 veto 或创建失败（/device 用返回值回滚）。 */
  async function startNewSession(): Promise<boolean> {
    if (agent.status === "running") {
      app.showNotice("Agent is running — Esc cancels it first.");
      return false;
    }
    try {
      await services.sessions.flush(agent.session);
    } catch {
      /* flush failure still switches */
    }
    const route = currentModelSelection();
    const requested = own.preset;
    const fresh = await composePreset(services.agentPresets, requested, (m) => app.showNotice(m));
    try {
      const result = await services.agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: {
          // worker 模式：镜像固定根（2b），避免同 id 跨 cwd 根重复；本地模式跟 process.cwd()。
          cwd: workerMode && own.mirrorRoot !== undefined ? own.mirrorRoot : process.cwd(),
          ...(fresh.agentPreset === undefined ? {} : { agentPreset: fresh.agentPreset }),
        },
        agentOptions: route,
        setup: makeSetup(fresh, route),
      });
      await adoptAgent(result.agent);
      liveRoute = { provider: route.provider, model: route.model }; // /new rides the chosen route
      await refreshEffortMeta(); // new route metadata for the banner below
      showBootBanner(); // fresh blank session: welcome block again
      app.appendCommandOutput(
        `New session ${result.agent.id}` +
          (fresh.agentPreset === undefined ? "." : ` (preset ${fresh.agentPreset}).`),
      );
      return true;
    } catch (error) {
      app.showNotice(
        `/new failed: ${error instanceof Error ? error.message : String(error)} — staying on ${agent.id}`,
      );
      return false;
    }
  }

  /** /preset [id] — list/switch agent presets via the picker or a direct id. */
  async function doPreset(line: string): Promise<void> {
    const roster = services.agentPresets;
    if (roster === undefined) {
      app.showNotice("No agent-preset roster in this deployment.");
      return;
    }
    let rows: PresetRow[];
    try {
      rows = await roster.list();
    } catch (error) {
      app.showNotice(`/preset failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (rows.length === 0) {
      app.showNotice("Preset roster is empty.");
      return;
    }
    const arg = line.slice("/preset".length).trim();
    if (arg === "") {
      const current = currentPreset();
      let defaultId: string | undefined;
      try {
        defaultId = roster.defaultId;
      } catch {
        defaultId = undefined;
      }
      const items = rows.map((p) => ({
        value: p.id,
        label:
          (p.name ?? p.id) +
          (p.broken !== undefined ? " (broken)" : "") +
          (p.id === current ? "  ← current" : "") +
          (p.id === defaultId ? "  · default" : ""),
        description:
          [p.trust, p.description]
            .filter((v) => v !== undefined)
            .join(" · ") || undefined,
      }));
      const picked = await app.pickSession(items);
      if (picked === null) {
        app.showNotice("Preset switch cancelled.");
        return;
      }
      await switchToPreset(roster, picked, rows.find((p) => p.id === picked));
      return;
    }
    await switchToPreset(roster, arg, rows.find((p) => p.id === arg));
  }

  /** The route the live agent is actually riding (single source of truth). */
  function activeRoute(): { provider: string; model: string } {
    return liveRoute;
  }

  /** Effective effort id: the session's EXPLICIT selection only. Absent →
   * the adapter default applies at request time; the settings default only
   * seeds the initial ref, so keeping it in this display chain made the label
   * diverge from runtime after picking the default entry. */
  function effectiveEffortId(): string | undefined {
    return selectionRef?.current?.reasoningEffort;
  }

  /** Display name of the effective effort from the resolved route metadata. */
  function effectiveEffortName(): string | undefined {
    if (effortMeta === undefined) return undefined;
    const id = effectiveEffortId();
    const hit =
      id === undefined
        ? effortMeta.efforts.find((e) => e.id === effortMeta?.defaultEffort)
        : effortMeta.efforts.find((e) => e.id === id);
    return hit?.name;
  }

  /** Sync the status-bar think label from current state (no I/O). */
  function refreshEffortLabel(): void {
    app.setThinkLabel(effectiveEffortName() ?? null);
  }

  /** Re-resolve route reasoning metadata and refresh the think label.
   * Cached per route key; a generation guard drops stale async results. */
  async function refreshEffortMeta(): Promise<void> {
    const gen = ++effortGeneration;
    const key = `${activeRoute().provider}/${activeRoute().model}`;
    if (key === effortMetaKey) {
      refreshEffortLabel();
      return;
    }
    effortMeta = undefined;
    app.setThinkLabel(null);
    const llm = services.llm;
    if (llm?.resolveModelInfo === undefined) return;
    let next: EffortMeta | undefined;
    try {
      // Call through the service object: detaching the method loses its
      // receiver and the internals crash on a missing adapter registry.
      const info = await llm.resolveModelInfo(activeRoute().provider, activeRoute().model);
      next = info.reasoning ?? undefined;
    } catch (error) {
      console.error(
        `dsh-tui: effort metadata for ${key} unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return; // superseded or adapter hiccup: keep the segment hidden
    }
    if (gen !== effortGeneration) return; // a newer refresh won
    effortMeta = next;
    effortMetaKey = key;
    refreshEffortLabel();
  }

  /** /effort — pick the reasoning effort for THIS session (next turn on).
   * Session-scoped by design: writes only the selection ref, never the
   * saved default — same contract as /model. */
  async function doEffort(): Promise<void> {
    if (agent.status === "running") {
      app.showNotice("Agent is running — Esc cancels it first.");
      return;
    }
    if (effortMeta === undefined || effortMeta.efforts.length === 0) {
      app.showNotice("Current route exposes no reasoning efforts.");
      return;
    }
    const meta = effortMeta;
    const current = effectiveEffortId();
    const items = meta.efforts.map((e) => ({
      value: e.id,
      label:
        `${e.name}${e.id === current ? "  ← current" : ""}` +
        `${e.id === meta.defaultEffort ? "  ← default" : ""}`,
      description: e.description,
    }));
    const picked = await app.pickSession(items);
    if (picked === null) {
      app.showNotice("Effort selection cancelled.");
      return;
    }
    const id = String(picked);
    // Picking the adapter default clears the explicit override: absent effort
    // materializes defaultEffort per installModelSelection semantics.
    const nextEffort = id === meta.defaultEffort ? undefined : id;
    if (selectionRef !== undefined && selectionRef.current !== undefined) {
      selectionRef.current = { ...selectionRef.current, reasoningEffort: nextEffort };
    }
    refreshEffortLabel();
    const name = meta.efforts.find((e) => e.id === id)?.name ?? id;
    app.appendCommandOutput(`Thinking effort set to ${name} — takes effect next turn.`);
  }

  /** /permission — switch this session's sandbox/approval bundle via the
   * harness's permission-presets service. Read: preset table + effective
   * current folded from the log; write: set() records preset intent plus
   * knob facts, so replay and the projection stay authoritative. */
  async function doPermission(): Promise<void> {
    const pp = services.permissionPresets;
    if (pp === undefined) {
      app.showNotice("Permission presets unavailable in this boot.");
      return;
    }
    if (agent.status === "running") {
      app.showNotice("Agent is running — Esc cancels it first.");
      return;
    }
    const current = pp.current(agent.session.events as never);
    if (current === "custom") {
      app.showNotice("Effective values match no preset (custom) — pick one to normalize.");
    }
    const items = pp.names.map((name) => {
      const opt = pp.optionOf(name);
      return {
        value: name,
        label: `${opt.label ?? name}${name === current ? "  ← current" : ""}`,
        description: opt.description,
      };
    });
    const picked = await app.pickSession(items);
    if (picked === null) {
      app.showNotice("Permission selection cancelled.");
      return;
    }
    const name = String(picked);
    try {
      pp.set(agent.session, name);
      app.appendCommandOutput(`Permission preset set to ${name}.`);
    } catch (error) {
      app.showNotice(
        `Permission switch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** /cost — cumulative provider-reported usage for this session. */
  function showCost(): void {
    let totals: ProjectionValues["tokenUsage"] | undefined;
    try {
      totals = projectionValues().tokenUsage;
    } catch {
      /* projections not ready */
    }
    const t = totals;
    const n = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    // The projection emits all-zero buckets from init, before any provider
    // usage exists — treat an all-zero reading as "nothing recorded" so a
    // fresh session gets the meter fallback instead of a proud row of zeros.
    const hasAny =
      t !== undefined &&
      (n(t.uncachedInputTokens) > 0 ||
        n(t.outputTokens) > 0 ||
        n(t.cacheReadTokens) > 0 ||
        n(t.cacheWriteTokens) > 0);
    if (!hasAny) {
      let total: number | undefined;
      try {
        total = services.tokenMeter?.measure(agent.session).totalTokens;
      } catch {
        /* meter absent */
      }
      app.appendCommandOutput(
        total === undefined
          ? "No usage recorded yet."
          : `Usage (meter estimate): ${formatTokens(total)} tokens.`,
      );
      return;
    }
    const billedInput = n(t?.uncachedInputTokens) + n(t?.cacheReadTokens) + n(t?.cacheWriteTokens);
    app.appendCommandOutput(
      [
        "Usage (provider-reported, session totals):",
        `  input (uncached)  ${formatTokens(n(t?.uncachedInputTokens))}`,
        `  cache read        ${formatTokens(n(t?.cacheReadTokens))}`,
        `  cache write       ${formatTokens(n(t?.cacheWriteTokens))}`,
        `  output            ${formatTokens(n(t?.outputTokens))}`,
        `  billed input ${formatTokens(billedInput)} · grand total ${formatTokens(billedInput + n(t?.outputTokens))}`,
      ].join("\n"),
    );
  }

  /** /tokens — current context-window occupancy detail. */
  function showTokens(): void {
    const lines: string[] = ["Context tokens:"];
    let pressure:
      | { projectedTokens?: number; contextWindow?: number; pressureTokens?: number }
      | undefined;
    try {
      pressure = projectionValues().contextPressure;
    } catch {
      /* projections not ready */
    }
    if (pressure === undefined) {
      lines.push("  projections unavailable.");
    } else {
      if (pressure.contextWindow !== undefined) {
        lines.push(`  window         ${formatTokens(pressure.contextWindow)}`);
      }
      if (pressure.projectedTokens !== undefined) {
        const pct =
          pressure.contextWindow !== undefined && pressure.contextWindow > 0
            ? Math.round((pressure.projectedTokens / pressure.contextWindow) * 100)
            : undefined;
        lines.push(
          `  next request   ${formatTokens(pressure.projectedTokens)}${pct !== undefined ? ` (${pct}%)` : ""}`,
        );
      }
      if (pressure.pressureTokens !== undefined) {
        lines.push(`  last reported  ${formatTokens(pressure.pressureTokens)}`);
      }
    }
    try {
      const total = services.tokenMeter?.measure(agent.session).totalTokens;
      if (total !== undefined) lines.push(`  meter total    ${formatTokens(total)}`);
    } catch {
      /* meter absent */
    }
    app.appendCommandOutput(lines.join("\n"));
  }

  /**
   * /tools [filter] — the visible tool inventory (native + mcp__ servers).
   * Read live from the registry on every invocation: MCP list_changed
   * re-syncs and reconnect recoveries mutate the catalog behind us, so a
   * snapshot would stale. Agent scope first — its schemas() folds agent
   * shadowing/restrict into what THIS session presents; the host plane
   * covers the boot window before an agent exists.
   */
  function showTools(rawInput: string): void {
    type Row = { name: string; description?: string };
    const readFrom = (
      source: { get<T = unknown>(key: string): T | undefined } | undefined,
    ): Row[] | undefined => {
      if (source === undefined) return undefined;
      try {
        return source.get<{ schemas?(): Row[] }>("tools")?.schemas?.();
      } catch {
        return undefined; // registry absent on this plane
      }
    };
    const rows = readFrom(agent?.ctx) ?? readFrom(ctx);
    if (rows === undefined) {
      app.appendCommandOutput("Tool registry unavailable.");
      return;
    }
    const query = rawInput.trim().toLowerCase();
    const filtered =
      query === ""
        ? rows
        : rows.filter(
            (r) =>
              r.name.toLowerCase().includes(query) ||
              (r.description ?? "").toLowerCase().includes(query),
          );
    if (filtered.length === 0) {
      app.appendCommandOutput(`No tools match "${rawInput.trim()}".`);
      return;
    }

    // Group under the mcp__<server>__<raw> naming convention (dsh-mcp-client);
    // everything else is native. MCP servers get per-tool lines, native stays
    // a folded name list — the interesting delta is always the MCP side.
    const groups = new Map<string, Row[]>();
    for (const row of filtered) {
      const server = /^mcp__([A-Za-z0-9_-]+)__/.exec(row.name)?.[1] ?? "";
      const bucket = groups.get(server);
      if (bucket === undefined) groups.set(server, [row]);
      else bucket.push(row);
    }
    const mcpGroups = [...groups.entries()].filter(([server]) => server !== "");
    const native = groups.get("") ?? [];
    const mcpCount = mcpGroups.reduce((sum, [, list]) => sum + list.length, 0);
    const header =
      `${filtered.length}${filtered.length === rows.length ? "" : ` of ${rows.length}`} tools · ` +
      `native ${native.length}` +
      (mcpCount > 0 ? ` · mcp ${mcpCount} (${mcpGroups.map(([s]) => s).join(", ")})` : "");

    /** First description line, hard-clamped so one tool never wraps wide. */
    const brief = (text: string | undefined): string => {
      const first = (text ?? "").split("\n", 1)[0]?.trim() ?? "";
      return first.length > 90 ? `${first.slice(0, 89)}…` : first;
    };

    const lines: string[] = [header];
    for (const [server, list] of mcpGroups) {
      lines.push(`${server} (${list.length})`);
      for (const row of list) lines.push(`  ${row.name} — ${brief(row.description)}`);
    }
    if (native.length > 0) {
      lines.push(`native (${native.length})`);
      lines.push(`  ${native.map((r) => r.name).join(" · ")}`);
    }
    app.appendCommandOutput(lines.join("\n"));
  }

  /** Concatenated text of a user/message content payload (string or text
   * blocks) — mirrors the dsh-rewind plugin's textBlocks for list parity. */
  function rewindMessageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .filter(
        (b): b is { type: string; text?: unknown } =>
          typeof b === "object" && b !== null && (b as { type?: string }).type === "text",
      )
      .map((b) => String(b.text ?? ""))
      .join("");
  }

  /** Rewind candidates from one event source — same filter/truncation as
   * the dsh-rewind plugin's bare /rewind list (user messages only). */
  function rewindCandidates(
    source: ReadonlyArray<unknown>,
  ): Array<{ seq: number; summary: string }> {
    const events = source as ReadonlyArray<{
      seq?: number;
      type?: string;
      data?: { content?: unknown; source?: { kind?: string } };
    }>;
    const items: Array<{ seq: number; summary: string }> = [];
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event?.type !== "user/message" || typeof event.seq !== "number") continue;
      if (event.data?.source?.kind !== undefined && event.data.source.kind !== "user") continue;
      const text = rewindMessageText(event.data?.content).replace(/\s+/g, " ").trim();
      items.push({ seq: event.seq, summary: text === "" ? "(empty)" : truncate(text, 60) });
    }
    return items;
  }

  /**
   * Double-Esc rewind picker (docs/m3-rewind-ui-design.md §3.4): list this
   * session's user messages with the same rule the dsh-rewind plugin uses,
   * then hand the picked seq to the very same command path a typed
   * `/rewind <seq>` takes — fork, file restore, and execve resume stay
   * entirely inside the plugin. A resumed session may carry no in-memory
   * history yet, so an empty agent log falls back to sessionQuery's.
   */
  async function doRewindPicker(): Promise<void> {
    let items = rewindCandidates(agent.session.events ?? []);
    if (items.length === 0 && services.sessionQuery !== undefined) {
      try {
        const snap = await services.sessionQuery.readSession(agent.id);
        if (snap !== undefined) {
          items = rewindCandidates(snap.events);
          // 内存日志为空（冷启动/resume）：把磁盘快照借给 rewindSource，
          // 让后续 /rewind <seq> 的执行路径与 picker 看到同一份事件。
          rewindFallbackEvents = snap.events;
        }
      } catch {
        /* unreadable log — empty list handled below */
      }
    }
    process.stderr.write(`dsh-tui: rewind picker: ${items.length} candidate(s)\n`);
    if (items.length === 0) {
      app.showNotice("No past user messages to rewind to.");
      return;
    }
    const seq = await app.pickRewindPoint(items);
    if (seq === null) return;
    await runCommand(`/rewind ${seq}`);
  }

  /** /export [file] — serialize the transcript to Markdown on disk. */
  async function doExport(rawPath: string): Promise<void> {
    const rows = app.model.snapshot;
    const markdown = renderTranscriptMarkdown(rows);
    const arg = rawPath.trim();
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const fallback = `dsh-export-${agent.id.slice(0, 8)}-${stamp}.md`;
    const target = resolve(process.cwd(), arg === "" ? fallback : arg);
    try {
      await writeFile(target, markdown, "utf8");
      app.appendCommandOutput(`Exported ${rows.length} rows → ${target}`);
    } catch (error) {
      app.showNotice(
        `Export failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Projection values of the live session (throws when unavailable). */
  function projectionValues(): ProjectionValues {
    const proj = services.sessionProjections;
    if (proj === undefined) throw new Error("sessionProjections unavailable");
    return proj.snapshot(agent.session).values as ProjectionValues;
  }

  /** Seed cache-rate + todo gauge from the projection registry's whole
   * values: cells fold lazily over the in-memory log on first snapshot and
   * memoize by watermark, so one call replaces the per-key event scans.
   * Falls back to direct scans when the registry is missing OR a read ever
   * throws — seeding must never be the reason a boot dies. */
  function seedProjections(): void {
    try {
      const proj = services.sessionProjections;
      if (proj !== undefined) {
        const values = proj.snapshot(agent.session).values as ProjectionValues;
        app.setCacheRate(cacheRateOf(values.tokenUsage) ?? null);
        if (Array.isArray(values.todos)) app.setTodos(values.todos);
        return;
      }
    } catch {
      /* registry hiccup — fall through to direct scans */
    }
    app.setCacheRate(lastCacheRate(agent.session.events) ?? null);
    for (let i = agent.session.events.length - 1; i >= 0; i -= 1) {
      const evt = agent.session.events[i] as
        | { type?: string; data?: { todos?: TodoItem[] } }
        | undefined;
      if (evt?.type === "todo/write") {
        if (Array.isArray(evt.data?.todos)) app.setTodos(evt.data.todos);
        break;
      }
    }
  }

  /**
   * /model hot switch: same session via installModelSelection mutable ref.
   * Takes effect next turn, keeps session id/history; falls back to the
   * fork recipe when the seam is absent.
   */
  async function switchModelHot(provider: string, model: string): Promise<void> {
    const ref = selectionRef;
    if (ref === undefined || ref.current === undefined) {
      await switchModelLive(provider, model);
      return;
    }
    const carried = ref.current.reasoningEffort;
    let nextEffort = carried;
    const llm = services.llm;
    if (carried !== undefined && llm?.resolveModelInfo !== undefined) {
      try {
        const info = await llm.resolveModelInfo(provider, model);
        const efforts = info.reasoning?.efforts ?? [];
        if (!efforts.some((e) => e.id === carried)) nextEffort = undefined;
      } catch {
        nextEffort = undefined; // metadata unavailable: drop the carried effort
      }
    }
    ref.current = {
      provider,
      model,
      ...(nextEffort === undefined ? {} : { reasoningEffort: nextEffort }),
    };
    liveRoute = { provider, model };
    app.setModelLabel(`${liveRoute.provider}/${liveRoute.model}`);
    void refreshEffortMeta();
    app.appendCommandOutput(`Switched to ${provider}/${model} — takes effect next turn.`);
  }

  /**
   * /model fork recipe (fallback when the mutable-selection seam is absent):
   * fork the whole log as seed, create a NEW session on the new route with
   * the SAME preset, then replay history. The conversation continues
   * untouched — only the request model changes.
   */
  async function switchModelLive(provider: string, model: string): Promise<void> {
    const fork = services.sessions.fork;
    if (fork === undefined) {
      app.showNotice("Model switch unavailable: sessions service lacks fork.");
      return;
    }
    let seed: unknown[];
    try {
      seed = fork.call(services.sessions, agent.session).events;
    } catch (error) {
      app.showNotice(
        `Model switch failed at fork: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    // The forked conversation keeps the session's own preset — only the
    // request route changes (same rule as rewind).
    const composed = await composePreset(
      services.agentPresets,
      recordedPresetOf(agent.session.events as Array<{ type: string; data?: unknown }>) ?? currentPreset(),
      (m) => app.showNotice(m),
    );
    try {
      // Carry the session's chosen effort across the route switch (design §3.3);
      // an unsupported level is rejected pre-flight by the harness.
      const carriedEffort = selectionRef?.current?.reasoningEffort;
      const result = await services.agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        seed,
        meta: {
          cwd: process.cwd(),
          parentSession: agent.id,
          ...(composed.agentPreset === undefined ? {} : { agentPreset: composed.agentPreset }),
        },
        agentOptions: { provider, model },
        setup: makeSetup(composed, { provider, model, reasoningEffort: carriedEffort }),
      });
      const next = result.agent;
      await next.whenIdle();
      agent = next;
      presenters = presentersFor(next);
      app.setAgent(agentSurface(next));
      liveRoute = { provider, model };
      app.setModelLabel(`${liveRoute.provider}/${liveRoute.model}`);
      // Registry fold re-reads for the new session: cache-rate and the todo
      // gauge both re-seed so in-flight todos survive the switch.
      seedProjections();
      app.model.clear();
      app.model.rebuild(next.session.events as never, presenters, { skipStreamDeltas: true });
      app.onSessionEvent();
      void services.sessions.flush(next.session).catch(() => {});
      updateContextPressure();
      refreshSubagents();
      refreshGoal();
      // New route → re-resolve its reasoning metadata (label may change or hide).
      void refreshEffortMeta();
      // Deliberately NOT touching the saved default: /model is session-scoped;
      // the default changes only via dsh settings (settings.yaml).
      app.appendCommandOutput(
        `Switched to ${provider}/${model} — history carried into ${next.id.slice(0, 13)}…`,
      );
    } catch (error) {
      app.showNotice(
        `Model switch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** /attach — 本地/worker 双模式：本地模式进入 worker（新 worker 会话），worker 模式换设备。
   * currentDevice() === "" = 本地模式。 */
  async function doAttach(rawInput: string): Promise<void> {
    const relayClient = ctx.get<{
      listDevices(): Promise<Array<{ deviceId: string; platform?: string; capabilities?: string[]; streams: number; workspace?: string }>>;
      attach(deviceId: string): void;
      detach(): void;
      switchDevice(deviceId: string): void;
      reattach(): void;
      currentDevice(): string;
    }>("relayClient");
    if (relayClient === undefined) {
      app.showNotice("/attach is only available in relay-capable profiles.");
      return;
    }
    if (agent.status === "running") {
      app.showNotice("Agent is running — Esc cancels it first.");
      return;
    }
    const current = relayClient.currentDevice(); // "" = 本地模式
    let target = "";
    let devices: Array<{ deviceId: string; platform?: string; capabilities?: string[]; streams: number; workspace?: string }> = [];
    const arg = rawInput.trim();
    if (arg === "") {
      devices = await relayClient.listDevices();
      if (devices.length === 0) {
        app.showNotice("No online devices.");
        return;
      }
      const items = devices.map((d, i) => ({
        value: String(i),
        label: `${d.deviceId}${d.deviceId === current ? "  ← current" : ""}`,
        description:
          [d.platform, (d.capabilities ?? []).join(","), `${d.streams} stream${d.streams === 1 ? "" : "s"}`]
            .filter(Boolean)
            .join(" · ") || undefined,
      }));
      const picked = await app.pickSession(items);
      if (picked === null) {
        app.showNotice("Selection cancelled.");
        return;
      }
      target = devices[Number(picked)]?.deviceId ?? "";
    } else {
      target = arg;
      devices = await relayClient.listDevices(); // 直连参数：校验目标在线，避免 attach-target-missing
    }
    if (target === "" || target === current) {
      app.showNotice(target === "" ? "Unknown device." : `Already on ${current}.`);
      return;
    }
    if (!devices.some((d) => d.deviceId === target)) {
      app.showNotice(`Device ${target} is not online.`);
      return;
    }
    const previousWorkspacePath = currentWorkspacePath;
    const targetInfo = devices.find((d) => d.deviceId === target);
    currentWorkspacePath = targetInfo?.workspace ?? "";
    if (current === "") {
      // 本地模式 → attach：arm + 开新 worker 会话（agent/created 触发 attach 到 target）。
      relayClient.attach(target);
      const ok = await startNewSession();
      if (!ok) {
        void relayClient.detach(); // 新会话失败 → 回本地
        currentWorkspacePath = "";
        app.showNotice(`/attach failed — stayed local.`);
        return;
      }
      app.showNotice(`Attached to ${target} — fresh worker session.`);
    } else {
      // worker 模式 → 换设备（新会话）。
      relayClient.switchDevice(target);
      const ok = await startNewSession();
      if (!ok) {
        relayClient.switchDevice(current);
        relayClient.reattach();
        currentWorkspacePath = previousWorkspacePath;
        app.showNotice(`/attach failed — stayed on ${current}.`);
        return;
      }
      app.showNotice(`Switched to device ${target} — fresh session.`);
    }
  }

  /** /detach — 退出 worker 模式，回到本地（当前会话保留在 worker，本地可续本地会话）。 */
  async function doDetach(): Promise<void> {
    const relayClient = ctx.get<{
      detach(): Promise<void>;
      currentDevice(): string;
      listDevices(): Promise<Array<{ deviceId: string; workspace?: string }>>;
      stopWorkspace(deviceId: string, childDeviceId: string): Promise<{ ok: boolean; error?: string }>;
    }>("relayClient");
    if (relayClient === undefined) {
      app.showNotice("/detach is only available in relay-capable profiles.");
      return;
    }
    const childDeviceId = relayClient.currentDevice();
    if (childDeviceId === "") {
      app.showNotice("Already in local mode.");
      return;
    }
    await relayClient.detach();
    currentWorkspacePath = "";
    // /detach 回收：仅当刚离开的是 workspace child（deviceId 含 "--"）且仍在线时
    // 才请求回收（hub 仅空闲才转发）。base worker 也带 workspace 字段，不能仅凭它判断。
    const isWorkspaceChild = childDeviceId.includes("--");
    const devices = await relayClient.listDevices();
    const child = isWorkspaceChild
      ? devices.find((d) => d.deviceId === childDeviceId && d.workspace !== undefined)
      : undefined;
    if (child !== undefined) {
      const baseDeviceId = childDeviceId.slice(0, childDeviceId.indexOf("--")) || childDeviceId;
      const stop = await relayClient.stopWorkspace(baseDeviceId, childDeviceId);
      if (stop.ok) {
        app.showNotice(`Detached — workspace child ${childDeviceId} reclaimed.`);
      } else if (stop.error === "unknown child") {
        // 该 child 不是 launcher spawn 的（外部/手动启动）：前端已 detach，
        // 但 launcher 无法回收它，进程继续运行。
        app.showNotice(
          `Detached — child ${childDeviceId} is not managed by this launcher (started externally); it stays running. Use /workspace to spawn managed children.`,
        );
      } else {
        app.showNotice(`Detached — ${stop.error ?? "workspace child not reclaimed"}.`);
      }
      return;
    }
    app.showNotice("Detached — back to local mode.");
  }

  /** /workspace — worker 模式内选择/切换 workspace（launcher 子 worker）。 */
  async function doWorkspace(line: string): Promise<void> {
    const relayClient = ctx.get<{
      currentDevice(): string;
      listDevices(): Promise<Array<{ deviceId: string; workspace?: string }>>;
      listWorkspaces(deviceId: string, path?: string): Promise<Array<{ path: string; kind: "dir" | "running"; deviceId?: string }>>;
      spawnWorkspace(deviceId: string, workspace: string): Promise<{ ok: boolean; deviceId?: string; error?: string }>;
      switchDevice(deviceId: string): void;
    }>("relayClient");
    if (relayClient === undefined) {
      app.showNotice("/workspace is only available in relay-capable profiles.");
      return;
    }
    const current = relayClient.currentDevice();
    if (current === "") {
      app.showNotice("Already in local mode — /attach first to enter worker mode.");
      return;
    }
    if (agent.status === "running") {
      app.showNotice("Agent is running — Esc cancels it first.");
      return;
    }
    // 当前可能是 workspace child：切 workspace 都走其 launcher（"--" 前为 base）。
    const launcherDeviceId = current.includes("--") ? current.slice(0, current.indexOf("--")) : current;
    const arg = line.trim().split(/\s+/)[1] ?? "";
    let workspace = "";
    if (arg === "") {
      let browsing: string | undefined; // undefined = roots 总览
      let done = false;
      while (!done) {
        app.showNotice(browsing === undefined ? "Loading workspaces…" : `Loading ${browsing}…`);
        const workspaces = await relayClient.listWorkspaces(launcherDeviceId, browsing);
        if (workspaces.length === 0 && browsing === undefined) {
          app.showNotice("No workspaces available on this worker.");
          return;
        }
        const items: Array<{ value: string; label: string; description?: string }> = [];
        if (browsing !== undefined) {
          items.push(
            { value: "__use__", label: "✓ 使用当前目录", description: browsing },
            { value: "__back__", label: "↑ 返回 roots 总览", description: "回到根目录列表" },
          );
        }
        items.push(
          ...workspaces.map((w) => ({
            value: w.kind === "running" && w.deviceId !== undefined ? `__run__:${w.deviceId}` : `__dir__:${w.path}`,
            label: w.kind === "running" ? `${basename(w.path)} (running)` : `${basename(w.path)}/`,
            description: w.kind === "running" ? `running · ${w.deviceId ?? ""}` : w.path,
          })),
        );
        const picked = await app.pickSession(items);
        if (picked === null) {
          app.showNotice("Workspace selection cancelled.");
          return;
        }
        // pickSession 回传的就是选中项的 value（如 "__dir__:/path"），
        // 不是索引 —— 直接用 picked，不能用 items[Number(picked)] 反查。
        const value = picked;
        if (value === "__use__") {
          workspace = browsing ?? "";
          done = true;
        } else if (value === "__back__") {
          browsing = undefined;
        } else if (value.startsWith("__run__:")) {
          workspace = workspaces.find((w) => w.deviceId === value.slice("__run__:".length))?.path ?? "";
          done = true;
        } else if (value.startsWith("__dir__:")) {
          browsing = value.slice("__dir__:".length);
        }
      }
    } else {
      workspace = arg;
    }
    if (workspace === "") {
      app.showNotice("Unknown workspace.");
      return;
    }
    const result = await relayClient.spawnWorkspace(launcherDeviceId, workspace);
    if (!result.ok) {
      app.showNotice(`/workspace failed: ${result.error ?? "unknown error"}`);
      return;
    }
    let resolvedWorkspace = workspace;
    if (result.deviceId !== undefined) {
      const devices = await relayClient.listDevices();
      const info = devices.find((d) => d.deviceId === result.deviceId);
      if (info?.workspace !== undefined) resolvedWorkspace = info.workspace;
    }
    currentWorkspacePath = resolvedWorkspace;
    relayClient.switchDevice(result.deviceId ?? "");
    app.showNotice(`Workspace set to ${resolvedWorkspace} — 直接输入首句、/new 或 /resume on ${result.deviceId}.`);
  }

  /** /model — pick a route and switch THIS session onto it (history intact). */
  async function doModel(): Promise<void> {
    // Same veto as /new: a live switch forks the log mid-turn and strands the
    // old agent still running in the background.
    if (agent.status === "running") {
      app.showNotice("Agent is running — Esc cancels it first.");
      return;
    }
    const llm = services.llm;
    if (llm === undefined) {
      app.showNotice("No llm service in this deployment.");
      return;
    }
    const relayClient = ctx.get<{
      currentDevice(): string;
      isAttached(): boolean;
      listModelCatalog(deviceId: string): Promise<Array<{ id: string; name?: string; models: Array<{ id: string; name?: string; description?: string }> }>>;
      setNextModel(model: { provider: string; model: string; reasoningEffort?: string }): void;
      switchModel(provider: string, model: string, reasoningEffort?: string): Promise<{ ok: boolean; error?: string }>;
    }>("relayClient");
    const active = activeRoute();
    const routes: Array<{ provider: string; model: string }> = [];
    const items: Array<{ value: string; label: string; description?: string }> = [];
    let catalogs: Array<{
      provider: { id: string; name?: string };
      models: Array<{ id: string; name?: string; description?: string }>;
    }>;
    if (relayClient !== undefined && relayClient.currentDevice() !== "") {
      // relay 模式：列表必须来自远端 worker 的真实 LLM 目录，避免选出远端没有的 provider。
      const remoteProviders = await relayClient.listModelCatalog(relayClient.currentDevice());
      if (remoteProviders.length === 0) {
        app.showNotice("No model catalog available on this worker.");
        return;
      }
      catalogs = remoteProviders.map((p) => ({
        provider: { id: p.id, name: p.name },
        models: p.models,
      }));
    } else {
      catalogs = await Promise.all(
        llm.listProviders().map(async (p) => ({
          provider: p,
          models: await llm.listModels(p.id).catch(() => []),
        })),
      );
    }
    for (const { provider, models } of catalogs) {
      for (const model of models) {
        const index = routes.length;
        routes.push({ provider: provider.id, model: model.id });
        const isCurrent = provider.id === active.provider && model.id === active.model;
        items.push({
          value: String(index),
          label: `${provider.id}/${model.id}${isCurrent ? "  ← current" : ""}`,
          description:
            [provider.name !== provider.id ? provider.name : undefined, model.name !== model.id ? model.name : undefined, model.description]
              .filter((v) => v !== undefined)
              .join(" · ") || undefined,
        });
      }
    }
    if (items.length === 0) {
      app.showNotice("Model catalog is empty.");
      return;
    }
    const picked = await app.pickSession(items);
    if (picked === null) {
      app.showNotice("Model selection cancelled.");
      return;
    }
    const route = routes[Number(picked)];
    if (route === undefined) return;
    if (route.provider === active.provider && route.model === active.model) {
      app.showNotice(`Already riding ${active.provider}/${active.model}.`);
      return;
    }
    // dsh-relay 集成：relay 模式下 relayClient 会把模型选择发到 worker；
    // 本地仍走 hot switch，保证状态栏与降级后一致性。
    const effort = selectionRef?.current?.reasoningEffort;
    if (relayClient !== undefined && relayClient.currentDevice() !== "" && !relayClient.isAttached()) {
      // worker 模式且还没有会话：跟本地一样只改内存 ref，并预置到下一次 fresh attach。
      relayClient.setNextModel({
        provider: route.provider,
        model: route.model,
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
      });
      await switchModelHot(route.provider, route.model);
      return;
    }
    if (relayClient !== undefined) {
      const result = await relayClient.switchModel(route.provider, route.model, effort);
      if (!result.ok) {
        app.showNotice(`Model switch to worker failed: ${result.error ?? "unknown error"}`);
        return;
      }
    }
    await switchModelHot(route.provider, route.model);
  }

  /** Persist a preset choice through the settings seam (`agent-presets` ns). */
  async function saveDefault(id: string): Promise<string | undefined> {
    const seam = services.settings;
    if (seam === undefined) return "no settings service in this deployment";
    try {
      await seam.update(AGENT_PRESETS_NS, { default: id });
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Apply one preset choice. Harness rule (dsh-agent-presets): only a blank
   * session may recompose live — a started session's logged tool calls would
   * strand under a different tool set, so the choice persists through the
   * settings default instead (the roster's hot-reloaded defaultId picks it up
   * on the next session).
   */
  async function switchToPreset(roster: PresetRoster, id: string, row?: PresetRow): Promise<void> {
    if (row === undefined) {
      app.showNotice(`Unknown preset "${id}" — run /preset with no argument to list them.`);
      return;
    }
    if (row.broken !== undefined) {
      app.showNotice(`Preset "${id}" is broken: ${row.broken}`);
      return;
    }
    if (id === currentPreset()) {
      app.showNotice(`Already on preset "${id}".`);
      return;
    }
    if (!sessionIsBlank(agent.session.events as Array<{ type?: string }>)) {
      const failed = await saveDefault(id);
      if (failed !== undefined) {
        app.showNotice(`Could not save "${id}" as roster default: ${failed}`);
        return;
      }
      app.appendCommandOutput(
        `Session ${agent.id} already started — kept on ${currentPreset() ?? "host composition"}. ` +
          `"${id}" saved as roster default for /new.`,
      );
      return;
    }
    try {
      await roster.recompose(agent.ctx, id);
      agent.session.append?.("agent-preset/selected", { agentPreset: id });
      const failed = await saveDefault(id);
      app.appendCommandOutput(
        `Preset switched to "${id}" (blank session recomposed live)` +
          (failed === undefined ? "." : `; saving default failed: ${failed}`),
      );
    } catch (error) {
      app.showNotice(
        `Preset switch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Load picker rows for THIS workspace's sessions. Labels come from the
   * harness's title snapshots (readTitleSnapshots) instead of full-log reads:
   * the old path called readSession per session (complete decode + replay
   * validation) just to find the first user message — seconds per multi-MB
   * log. Cross-project resume stays available via `/resume <id>`.
   */
  async function loadSessionItems(): Promise<{
    items: Array<{ value: string; label: string; description: string }>;
    totalRecords: number;
    localRecords: number;
    hiddenUntitled: number;
    hiddenOlder: number;
  }> {
    const query = services.sessionQuery;
    if (query === undefined) {
      return { items: [], totalRecords: 0, localRecords: 0, hiddenUntitled: 0, hiddenOlder: 0 };
    }
    const records = await query.listSessions();
    // Scope to the current workspace: sessions persist keyed by cwd, and a
    // global newest-first list mostly shows other projects' logs. Subagent
    // children persist under the parent's workspace too and carry LLM titles
    // (their first message is the spliced brief) — left in, they flood the
    // recency window and crowd interactive history out of it.
    const cwd = process.cwd();
    const local = records.filter(
      (rec) => rec.header.cwd === cwd && rec.header.origin !== "subagent",
    );
    // Untitled shells (a boot that never got a message) are dropped BEFORE the
    // recency cut: slicing first let an empty boot occupy a slot while pushing
    // real sessions out of the window.
    const snapshots = await query.readTitleSnapshots(local.map((rec) => rec.header.id));
    let hiddenUntitled = 0;
    const titled: Array<{ rec: (typeof records)[number]; title: string }> = [];
    for (let i = 0; i < local.length; i += 1) {
      const rec = local[i];
      if (rec === undefined) continue;
      const snap = snapshots[i];
      const title = snap?.status === "fulfilled" ? snap.value?.title?.title : undefined;
      if (title === undefined || title.trim() === "") {
        hiddenUntitled += 1;
        continue;
      }
      titled.push({ rec, title });
    }
    // No recency cap (design D1=B): titled+local is already the filtered set,
    // the picker filters by text, and the cleanup path (/rm) owns bloat.
    const items: Array<{ value: string; label: string; description: string }> = [];
    for (const { rec, title } of titled) {
      const state = rec.live ? "live" : rec.persisted ? "persisted" : "missing";
      const when = relativeTime(rec.header.createdAt);
      const marker = rec.header.id === agent.id ? " (current)" : "";
      items.push({
        value: rec.header.id,
        label: truncate(title, 60),
        description: `${when} · ${state}${marker}`,
      });
    }
    return {
      items,
      totalRecords: records.length,
      localRecords: local.length,
      hiddenUntitled,
      hiddenOlder: 0,
    };
  }

  async function listSessions(): Promise<void> {
    try {
      const { items, totalRecords, localRecords, hiddenUntitled, hiddenOlder } =
        await loadSessionItems();
      if (items.length === 0) {
        app.appendCommandOutput(
          `No titled sessions in this workspace` +
            ` (${hiddenUntitled} untitled hidden · ${totalRecords} in other workspaces). ` +
            "/resume <id> still works cross-project.",
        );
        return;
      }
      const hiddenNote =
        (hiddenUntitled > 0 ? ` · ${hiddenUntitled} untitled hidden` : "") +
        (hiddenOlder > 0 ? ` · ${hiddenOlder} older hidden` : "");
      const lines = items.map((item, i) => `${String(i + 1).padStart(2)}. ${item.label} [${item.description}]`);
      app.appendCommandOutput(
        `Sessions in ${basename(process.cwd())} (${localRecords}` +
          (totalRecords > localRecords ? ` of ${totalRecords} total` : "") + `${hiddenNote}):\n` +
          `${lines.join("\n")}\n/resume to pick, or /resume <session-id>.`,
      );
    } catch (error) {
      app.showNotice(`dsh-tui: session list failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** /bg：向当前 worker 发起后台任务（专用 task session，受理即返回）。 */
  async function doBg(prompt: string): Promise<void> {
    const relayClient = ctx.get<{
      currentDevice(): string;
      dispatchTask(
        deviceId: string,
        prompt: string,
        model?: { provider: string; model: string; reasoningEffort?: string },
      ): Promise<{ taskId: string; sessionId: string; error?: string }>;
    }>("relayClient");
    const device = relayClient?.currentDevice() ?? "";
    if (relayClient === undefined || device === "") {
      app.showNotice("/bg is only available after /attach enters worker mode.");
      return;
    }
    if (prompt === "") {
      app.showNotice("usage: /bg <prompt>");
      return;
    }
    try {
      // 后台任务会话独立于交互会话，必须显式带上当前模型，否则 worker 用默认模型。
      const result = await relayClient.dispatchTask(device, prompt, {
        provider: liveRoute.provider,
        model: liveRoute.model,
      });
      if (result.error !== undefined && result.error !== "") {
        app.showNotice(`/bg failed: ${result.error}`);
        return;
      }
      app.showNotice(
        `task started: ${result.taskId} (session ${result.sessionId}); /task ${result.taskId} to check, /resume ${result.sessionId} to watch`,
      );
    } catch (error) {
      app.showNotice(`/bg failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** /task <id>：查询后台任务状态。 */
  async function doTask(taskId: string): Promise<void> {
    const relayClient = ctx.get<{
      currentDevice(): string;
      taskStatus(deviceId: string, taskId: string): Promise<{
        status: string;
        sessionId?: string;
        result?: unknown;
        error?: string;
      }>;
    }>("relayClient");
    const device = relayClient?.currentDevice() ?? "";
    if (relayClient === undefined || device === "") {
      app.showNotice("/task is only available after /attach enters worker mode.");
      return;
    }
    if (taskId === "") {
      app.showNotice("usage: /task <taskId>");
      return;
    }
    try {
      const status = await relayClient.taskStatus(device, taskId);
      if (status.error !== undefined && status.error !== "") {
        app.showNotice(`/task ${taskId}: ${status.error}`);
        return;
      }
      if (status.status === "running") {
        app.showNotice(`task ${taskId}: running (session ${status.sessionId ?? "?"})`);
        return;
      }
      if (status.status === "cancelled") {
        app.showNotice(`task ${taskId}: cancelled`);
        return;
      }
      if (status.status === "unknown") {
        app.showNotice(`task ${taskId}: unknown (worker may have restarted)`);
        return;
      }
      const sessionNote = status.sessionId !== undefined ? ` (session ${status.sessionId})` : "";
      const rawText =
        typeof status.result === "object" && status.result !== null &&
        "text" in (status.result as { text?: unknown }) ? (status.result as { text?: unknown }).text : undefined;
      const text =
        typeof rawText === "string" && rawText !== ""
          ? rawText
          : JSON.stringify(status.result ?? status.error ?? "done");
      app.showNotice(`task ${taskId}: done${sessionNote}\n${text}`);
    } catch (error) {
      app.showNotice(`/task failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** /tasks：列出当前 worker 最近任务（running 优先，已完成的带结果摘要）。 */
  async function doTasks(): Promise<void> {
    const relayClient = ctx.get<{
      currentDevice(): string;
      listTasks(deviceId: string): Promise<Array<{
        taskId: string;
        status: string;
        sessionId?: string;
        result?: unknown;
        error?: string;
        createdAt?: number;
        finishedAt?: number;
      }>>;
    }>("relayClient");
    const device = relayClient?.currentDevice() ?? "";
    if (relayClient === undefined || device === "") {
      app.showNotice("/tasks is only available after /attach enters worker mode.");
      return;
    }
    try {
      const tasks = await relayClient.listTasks(device);
      if (tasks.length === 0) {
        app.showNotice("No tasks on this worker yet. Use /bg <prompt> to start one.");
        return;
      }
      const lines = tasks.map((task) => {
        const session = task.sessionId !== undefined ? task.sessionId.slice(0, 13) : "-";
        if (task.status === "running") return `${task.taskId}  running  ${session}`;
        if (task.status === "cancelled") return `${task.taskId}  cancelled  ${session}`;
        const rawText =
          typeof task.result === "object" && task.result !== null &&
          "text" in (task.result as { text?: unknown }) ? (task.result as { text?: unknown }).text : undefined;
        const summary =
          typeof rawText === "string" && rawText !== ""
            ? truncate(rawText, 40)
            : task.error ?? truncate(JSON.stringify(task.result ?? "done"), 40);
        return `${task.taskId}  ${task.status}  ${session}  ${summary}`;
      });
      app.appendCommandOutput(
        `Tasks on ${device} (session 显示前 13 位，完整 id 用 /task <taskId> 查看):\n${lines.join("\n")}`,
      );
    } catch (error) {
      app.showNotice(`/tasks failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** worker 模式 /resume：attach 到 worker 的显式会话 id（本地新镜像，worker 重放历史）。
   * 不混合本地：只操作 worker 会话。 */
  async function resumeWorkerSession(deviceId: string, sessionId: string): Promise<void> {
    const relayClient = ctx.get<{ attachSession(d: string, s: string): void; detach(): void }>("relayClient");
    if (relayClient === undefined) return;
    if (agent.status === "running") {
      app.showNotice("Agent is running — Esc cancels it first.");
      return;
    }
    relayClient.attachSession(deviceId, sessionId);
    const ok = await startNewSession(); // 新镜像 agent → reattach 到 worker sessionId
    if (!ok) {
      void relayClient.detach(); // 清 override + 回本地
      app.showNotice("Worker resume failed — back to local mode.");
      return;
    }
    app.showNotice(`Resumed worker session ${sessionId.slice(0, 13)}…`);
  }

  async function doResume(line: string): Promise<void> {
    const relayClient = ctx.get<{
      currentDevice(): string;
      listSessions(deviceId: string): Promise<Array<{ id: string; cwd?: string; createdAt: number; title?: string }>>;
      deleteSession(deviceId: string, sessionId: string): Promise<{ ok: boolean; error?: string }>;
    }>("relayClient");
    const device = relayClient?.currentDevice() ?? ""; // "" = 本地模式
    const id = line.trim().split(/\s+/)[1];
    if (device !== "") {
      // worker 模式：/resume 只列/续 worker 会话（不混合本地）。
      if (id !== undefined) {
        if (id === agent.id) {
          app.showNotice("already in this session");
          return;
        }
        await resumeWorkerSession(device, id);
        return;
      }
      try {
        app.showNotice("Loading worker sessions…");
        const sessions = await relayClient!.listSessions(device);
        if (sessions.length === 0) {
          app.showNotice("No sessions on this worker.");
          return;
        }
        const items = sessions.map((s) => ({
          value: s.id,
          label: truncate(s.title ?? s.id, 60),
          description: `${relativeTime(s.createdAt)} · ${s.cwd ?? ""}`,
        }));
        const picked = await app.pickSession(items, {
          onRequestDelete: (deleteId) => deleteWorkerSessionFlow(device, deleteId),
        });
        if (picked === null) {
          app.showNotice("Resume cancelled.");
          return;
        }
        if (picked === agent.id) {
          app.showNotice("already in this session");
          return;
        }
        await resumeWorkerSession(device, picked);
      } catch (error) {
        app.showNotice(`dsh-tui: worker resume failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    // 本地模式：现有逻辑（本地会话列表 + relaunch）。
    if (id !== undefined) {
      if (id === agent.id) {
        app.showNotice("already in this session");
        return;
      }
      await relaunchToResume(id);
      return;
    }
    // No id: open the interactive picker (search + Up/Down + Enter).
    try {
      app.showNotice("Loading sessions…");
      const { items, totalRecords, hiddenUntitled } = await loadSessionItems();
      if (items.length === 0) {
        app.showNotice(
          `No titled sessions here (${hiddenUntitled} untitled hidden · ${totalRecords} elsewhere) — /resume <id> works cross-project.`,
        );
        return;
      }
      const picked = await app.pickSession(items, {
        onRequestDelete: (id) => deleteSessionFlow(id),
      });
      if (picked === null) {
        app.showNotice("Resume cancelled.");
        return;
      }
      await relaunchToResume(picked);
    } catch (error) {
      app.showNotice(`dsh-tui: resume failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Host dsh home directory: honor DSH_HOME when set, else ~/.dsh. */
  function dshHomeDir(): string {
    const envHome = process.env.DSH_HOME?.trim();
    if (envHome !== undefined && envHome !== "") {
      if (envHome === "~") return homedir();
      if (envHome.startsWith("~/")) return join(homedir(), envHome.slice(2));
      return envHome;
    }
    return join(homedir(), ".dsh");
  }

  /** Sessions root of the host deployment (~/.dsh/sessions, one dir per
   * workspace slug). Only used for the plugin-plane delete below — dsh has
   * no standard delete seam; persistence "remove" is internal bookkeeping. */
  const sessionsRoot = join(dshHomeDir(), "sessions");

  /** Locate the log dir for a session id across every workspace slug. */
  async function findSessionDir(id: string): Promise<string | undefined> {
    let slugs: string[];
    try {
      slugs = await readdir(sessionsRoot);
    } catch {
      return undefined;
    }
    for (const slug of slugs) {
      const candidate = join(sessionsRoot, slug, id);
      try {
        await readdir(candidate);
        return candidate;
      } catch {
        /* not under this slug */
      }
    }
    return undefined;
  }

  /** Drop the session's row from the projection cache (keyed by id), keeping
   * a stale row from resurrecting ghost gauge/todo state in UI reads. */
  async function pruneProjectionCache(id: string): Promise<void> {
    const file = join(dshHomeDir(), "storages", "session_projcache.json");
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      return; // no cache file — nothing to prune
    }
    let parsed: { tables?: Record<string, Record<string, unknown>> };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      return;
    }
    const table = parsed.tables?.sessions;
    if (table === undefined || table[id] === undefined) return;
    delete table[id];
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(parsed), "utf8");
    await rename(tmp, file);
  }

  /**
   * /rm + picker Ctrl+D shared flow (docs/session-list-delete-design.md):
   * guard → approval card → remove log dir → prune projection cache. Returns
   * true only when the session was actually deleted.
   */
  async function deleteSessionFlow(id: string, knownLabel?: string): Promise<boolean> {
    if (services.sessionQuery === undefined) {
      app.showNotice("Session deletion unavailable: no sessionQuery service.");
      return false;
    }
    if (id === agent.id) {
      app.showNotice("Refusing to delete the current session.");
      return false;
    }
    let label = knownLabel;
    if (label === undefined) {
      try {
        const snaps = await services.sessionQuery.readTitleSnapshots([id]);
        label =
          snaps[0]?.status === "fulfilled" ? snaps[0]?.value?.title?.title : undefined;
      } catch {
        /* untitled fallback below */
      }
    }
    try {
      const records = await services.sessionQuery.listSessions();
      if (records.some((rec) => rec.header.id === id && rec.live)) {
        app.showNotice("Refusing: that session is live in the store.");
        return false;
      }
    } catch {
      /* listing failed — proceed to confirmation without the live check */
    }
    const outcome = await app.askApproval({
      toolName: "/rm",
      reason: `删除会话「${label ?? "(untitled)"}」\n${id}\n日志与投影缓存一并移除，不可恢复 —— a 确认 · r/esc 取消`,
    });
    if (outcome !== "allowed-once") return false;
    const dir = await findSessionDir(id);
    if (dir === undefined) {
      app.showNotice(`No on-disk log found for ${id} (already gone?).`);
      return false;
    }
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      app.showNotice(
        `rm failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
    try {
      await pruneProjectionCache(id);
    } catch (error) {
      // Log is already gone; cache pruning is best-effort. Report the leftover
      // but still return true — the session WAS deleted, so a retry must not
      // claim failure and force the user into a phantom "No on-disk log" loop.
      process.stderr.write(
        `dsh-tui: rm session ${id}: projection cache prune failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    process.stderr.write(`dsh-tui: rm session ${id}\n`);
    return true;
  }

  /** worker 模式 /resume 选择器 Ctrl+D：确认后远程删除 worker 端会话。 */
  async function deleteWorkerSessionFlow(deviceId: string, sessionId: string): Promise<boolean> {
    const relayClient = ctx.get<{
      deleteSession(deviceId: string, sessionId: string): Promise<{ ok: boolean; error?: string }>;
    }>("relayClient");
    if (relayClient === undefined) {
      app.showNotice("Session deletion unavailable: no relay client.");
      return false;
    }
    const outcome = await app.askApproval({
      toolName: "/rm",
      reason: `删除 worker 会话「${sessionId.slice(0, 13)}…」\n${sessionId}\nworker 端日志一并移除，不可恢复 —— a 确认 · r/esc 取消`,
    });
    if (outcome !== "allowed-once") return false;
    const result = await relayClient.deleteSession(deviceId, sessionId);
    if (!result.ok) {
      app.showNotice(`Worker session delete failed: ${result.error ?? "unknown"}`);
      return false;
    }
    app.showNotice(`Deleted worker session ${sessionId.slice(0, 13)}…`);
    return true;
  }

  /** /rm <id-prefix> — resolve a unique prefix within this workspace's
   * titled sessions, then run the guarded delete flow. */
  async function doRm(rawInput: string): Promise<void> {
    const prefix = rawInput.trim().replace(/^session-/, "");
    if (prefix.length < 4) {
      app.showNotice("Usage: /rm <id-prefix> (at least 4 chars, see /sessions).");
      return;
    }
    if (services.sessionQuery === undefined) {
      app.showNotice("Session deletion unavailable: no sessionQuery service.");
      return;
    }
    try {
      const records = await services.sessionQuery.listSessions();
      const cwd = process.cwd();
      const matches = records.filter(
        (rec) =>
          rec.header.cwd === cwd && rec.header.id.startsWith(`session-${prefix}`),
      );
      if (matches.length === 0) {
        app.showNotice(`No session matches "${prefix}" in this workspace.`);
        return;
      }
      if (matches.length > 1) {
        app.showNotice(`"${prefix}" is ambiguous (${matches.length} matches) — more characters.`);
        return;
      }
      const rec = matches[0];
      if (rec === undefined) return;
      const snaps = await services.sessionQuery.readTitleSnapshots([rec.header.id]);
      const title =
        snaps[0]?.status === "fulfilled" ? snaps[0]?.value?.title?.title : undefined;
      const deleted = await deleteSessionFlow(rec.header.id, title ?? "(untitled)");
      if (deleted) app.showNotice(`Deleted ${rec.header.id}.`);
    } catch (error) {
      app.showNotice(
        `/rm failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Flush, restore the terminal, then replace the process with `--resume <id>`. */
  async function relaunchToResume(id: string): Promise<void> {
    try {
      await services.sessions.flush(agent.session);
    } catch {
      /* flush failure still relaunches */
    }
    // The persistence backend keys sessions by workspace (cwd). chdir to the
    // target session's original cwd so the resumed process finds its log.
    // A list failure must not become an unhandled rejection; without the cwd
    // we can still relaunch from the current directory.
    let records: Awaited<ReturnType<NonNullable<CoreServices["sessionQuery"]>["listSessions"]>> = [];
    if (services.sessionQuery !== undefined) {
      try {
        records = await services.sessionQuery.listSessions();
      } catch (error) {
        console.error(`dsh-tui: session list failed: ${String(error)}`);
      }
    }
    const target = records.find((r) => r.header.id === id);
    const targetCwd = target?.header.cwd;
    if (targetCwd !== undefined) {
      try {
        process.chdir(targetCwd);
      } catch (error) {
        console.error(`dsh-tui: cannot enter ${targetCwd}: ${String(error)}`);
        app.stopTerminal();
        services.appExit(1);
        return;
      }
    }
    app.stopTerminal();
    // Drop any --resume already on the command line (chained /resume): the new
    // target must win regardless of how the runtime parses duplicates.
    const priorArgv = argvWithoutResume(process.argv.slice(1));
    const relaunch = [process.execPath, ...(process.execArgv ?? []), ...priorArgv, "--resume", id];
    if (process.execve === undefined) {
      console.error("dsh-tui: process.execve is unavailable on this platform");
      services.appExit(1);
      return;
    }
    try {
      process.execve(process.execPath, relaunch, process.env);
    } catch (error) {
      console.error(`dsh-tui: relaunch failed: ${String(error)}`);
      services.appExit(1);
    }
  }

  // Publish the terminal-owning handoff so sibling plugins (dsh-rewind) can
  // restart into another session without duplicating teardown. An execve that
  // skips stopTerminal() strands our kitty-protocol push on the terminal's
  // stack — the shell then keeps receiving CSI-u keypresses (`:3A` on every
  // arrow key) until the tab is reset (2026-08-26 exit-leak report).
  ctx.provide("tuiHandoff", {
    relaunchToResume: (id: string) => relaunchToResume(id),
    // relay rewind：worker 端已 fork 出 child，前端 detach 旧流并 resume child。
    resumeRemoteChild: (deviceId: string, childId: string) => resumeWorkerSession(deviceId, childId),
  });

  // 让 dsh-rewind 与双击 Esc picker 共享同一会话源：relay /resume 后当前
  // agent 是带回放历史的 mirror，而 agents.roots()[0] 可能仍是启动时的旧
  // root（session 为空），导致选中的 seq 在 /rewind 侧找不到。
  // 冷启动内存日志为空时，picker 已从 sessionQuery 读盘列出候选；把读到的
  // 快照暂存为 fallback，/rewind <seq> 走同一条 rewindSource 也能找到事件。
  let rewindFallbackEvents: ReadonlyArray<unknown> | undefined;
  ctx.provide("rewindSource", {
    get id() {
      return agent.id;
    },
    get events() {
      const live = agent.session.events ?? [];
      if (live.length > 0) return live;
      return rewindFallbackEvents ?? [];
    },
  });

  async function runCommand(line: string): Promise<void> {
    if (line === "/exit" || line === "/quit") {
      await stopAndExit();
      return;
    }
    if (line === "/clear") {
      app.model.clear();
      app.onSessionEvent();
      return;
    }
    if (line === "/new") {
      await startNewSession();
      return;
    }
    if (line === "/preset" || line.startsWith("/preset ")) {
      await doPreset(line);
      return;
    }
    if (line === "/model") {
      await doModel();
      return;
    }
    if (line === "/img" || line.startsWith("/img ")) {
      const paths = line.slice(4).trim().split(/\s+/).filter((p) => p !== "");
      if (paths.length === 0) {
        app.showNotice("Usage: /img <path> [<path>…] — png/jpeg/webp/gif.");
        return;
      }
      app.addPendingImagePaths(paths);
      return;
    }
    if (line === "/effort") {
      await doEffort();
      return;
    }
    if (line === "/permission") {
      await doPermission();
      return;
    }
    if (line === "/cost") {
      showCost();
      return;
    }
    if (line === "/tokens") {
      showTokens();
      return;
    }
    if (line === "/export" || line.startsWith("/export ")) {
      await doExport(line.slice("/export".length).trim());
      return;
    }
    if (line === "/help") {
      app.appendCommandOutput(HELP_TEXT);
      return;
    }
    if (line === "/session") {
      app.showNotice(`Current session: ${agent.id}`);
      return;
    }
    if (line === "/sessions") {
      await listSessions();
      return;
    }
    if (line === "/resume" || line.startsWith("/resume ")) {
      await doResume(line);
      return;
    }
    if (line === "/compact") {
      // Core registry command (dsh-base command-compact); progress lands in
      // the transcript via compaction/end events. The indicator persists for
      // the whole operation (timeoutMs 0) and is cleared below on completion.
      app.showNotice("Compacting…", 0);
    }
    if (services.commands !== undefined) {
      let execution: Awaited<ReturnType<NonNullable<CoreServices["commands"]>["execute"]>> | undefined;
      try {
        execution = await services.commands.execute(agent, line, [], new AbortController().signal);
      } catch (error) {
        if (line === "/compact") app.clearNotice();
        app.showNotice(
          `${line.split(/\s+/)[0]} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      if (execution === undefined) {
        if (line === "/compact") app.clearNotice();
        app.showNotice(`Unknown command ${line.split(/\s+/)[0]} — /help lists what's available.`);
        return;
      }
      const text = execution.result.text;
      if (line === "/compact") {
        // The outcome goes into the transcript as a durable row: a status-bar
        // notice alone gets repainted away by the burst of session events
        // (compaction/end, splices, status flips) that trails this command.
        app.clearNotice();
        if (execution.result.kind !== "success") {
          app.appendCommandOutput(`Compaction failed: ${text ?? "unknown error"}.`);
        } else {
          app.appendCommandOutput(text ?? "Compaction finished.");
          updateContextPressure(); // surface shrank — refresh ctx immediately
        }
        return;
      }
      if (text !== undefined && text !== "") app.showNotice(text);
    } else {
      app.showNotice(`Unknown command ${line.split(/\s+/)[0]} — /help lists what's available.`);
    }
  }

  // Model asks the human: FIFO through the TUI question overlay.
  if (services.userQuestions !== undefined) {
    const disposeProvider = services.userQuestions.registerProvider({
      ask: async (request) => {
        const req = request as {
          signal?: AbortSignal;
          questions: Array<{
            id: string;
            question: string;
            detail?: string;
            intent?: { kind?: string };
            options?: Array<{ label: string; description?: string }>;
            multiSelect?: boolean;
          }>;
        };
        const answers: Array<{ id: string; selected: string[] }> = [];
        for (const item of req.questions ?? []) {
          // B5: dsh-plan-mode's exit review carries the full plan in `detail`
          // and compares the answer against its exact "Approve" label. The
          // dedicated card renders that body; null answers mean
          // keep-planning/dismissed, which the service narrates itself.
          if (item.intent?.kind === "plan-review" && typeof item.detail === "string" && item.detail !== "") {
            const picked = await app.askPlanReview({
              question: item.question,
              plan: item.detail,
              signal: req.signal,
            });
            if (picked === null) return { answers: [] };
            answers.push({ id: item.id, selected: [picked] });
            continue;
          }
          const selected = await app.askQuestion({
            id: item.id,
            question: item.question,
            options: item.options,
            multiSelect: item.multiSelect,
            signal: req.signal,
          });
          if (selected === null) return { answers: [] };
          answers.push({ id: item.id, selected });
        }
        return { answers };
      },
    });
    ctx.effect(() => disposeProvider);
  }

  // Tool approval: surface the 'approval/request' waterfall as a TUI dialog.
  const disposeApproval = ctx.on(
    "approval/request",
    (req: unknown, next: () => Promise<unknown>) => {
      const request = req as { toolName: string; reason?: string; signal?: AbortSignal };
      if (request.signal?.aborted === true) {
        return Promise.resolve("cancelled");
      }
      return app.askApproval({
        toolName: request.toolName,
        reason: request.reason,
        signal: request.signal,
      }) as Promise<unknown>;
    },
  );

  // Route filler for agent/request (official adapter parity): a resumed agent's
  // FIRST request cannot rely on the host's in-memory header flag — its route
  // may legitimately live only in the persisted log, so complete an otherwise
  // empty proposal from the live route we resolved at boot. Subagents that
  // already carry their own concrete route stay authoritative.
  const disposeRouteFiller = ctx.on(
    "agent/request",
    async (_payload: unknown, next: () => Promise<unknown>) => {
      const resolved = (await next()) as { provider?: unknown; model?: unknown } | null;
      if (
        resolved !== null &&
        typeof resolved === "object" &&
        typeof resolved.provider === "string" &&
        resolved.provider.length > 0 &&
        typeof resolved.model === "string" &&
        resolved.model.length > 0
      ) {
        return resolved;
      }
      return { ...resolved, provider: liveRoute.provider, model: liveRoute.model };
    },
  );


  // Context-window occupancy. Preferred source: the contextPressure
  // projection — its numerator is the last provider sample plus signed
  // surface movement since that sample, so a compaction drops the figure
  // immediately (rc.8 token-meter folds shadowed ranges). Fallbacks: the
  // token meter's live surface estimate, then a raw log scan.
  function updateContextPressure(): void {
    let used: number | undefined;
    let windowTokens: number | undefined;
    let outTotal: number | null = null;
    const proj = services.sessionProjections;
    if (proj !== undefined) {
      try {
        const values = proj.snapshot(agent.session).values as ProjectionValues;
        const pressure = values.contextPressure;
        windowTokens = pressure?.contextWindow;
        // A failed request can log an all-zero usage chunk; the projection's
        // last-wins sample then reads 0 while the surface is intact — treat
        // that as "no usable sample" and fall through to the meter.
        if (pressure?.projectedTokens !== undefined && pressure.projectedTokens > 0) {
          used = pressure.projectedTokens;
        }
        // Session-total output for the status bar (/cost's same source); one
        // snapshot read serves both gauges. The wire view is the flat bucket
        // object (no `totals` wrapper). Hidden until first usage lands.
        const out = values.tokenUsage?.outputTokens;
        if (typeof out === "number" && out > 0) outTotal = out;
      } catch {
        /* projection not ready — fall through to the meter */
      }
    }
    app.setOutputTotal(outTotal);
    if (used === undefined && services.tokenMeter !== undefined) {
      try {
        used = services.tokenMeter.measure(agent.session).totalTokens;
      } catch {
        /* meter unavailable — fall through to the log scan */
      }
    }
    if (used === undefined || windowTokens === undefined || windowTokens <= 0) {
      const report = lastUsageReport(agent.session.events as ReadonlyArray<unknown>);
      if (report === undefined) {
        app.setContextOccupancy(null);
        return;
      }
      used = report.promptTokens;
      if (windowTokens === undefined || windowTokens <= 0) windowTokens = report.contextWindow;
    }
    if (windowTokens === undefined || windowTokens <= 0) {
      app.setContextOccupancy(null);
      return;
    }
    const pct = Math.max(0, Math.min(100, Math.round((used / windowTokens) * 100)));
    app.setContextOccupancy({ pct, usedTokens: used, windowTokens });
  }

  // Running-subagent summary under the status line. Event-triggered refresh:
  // child state lives in projection-backed runtime data (listChildren), but
  // waiting on a fixed poll lags starts/finishes by up to the interval — so
  // every lifecycle-relevant session event triggers an immediate re-read.
  function refreshSubagents(): void {
    const subs = services.subagents;
    if (subs === undefined) return;
    const generation = ++subagentRefreshGeneration;
    void subs
      .listChildren(agent.id)
      .then((children) => {
        if (generation !== subagentRefreshGeneration) return; // stale response
        const running = children
          .filter((c) => c.activity === "running")
          .map((c) => ({ id: c.id, mode: c.mode, label: c.label }));
        app.setSubagents(running);
      })
      .catch(() => {
        /* transient — leave the previous summary */
      });
  }

  /** Live background-job summary: the owner-fenced registry list is
   * synchronous and cheap; it rides the same lifecycle triggers as the
   * subagent gauge (tool/turn events), which cover job start via bash and
   * settle via completion activity. */
  function refreshJobs(): void {
    const jobs = services.jobs;
    if (jobs === undefined) return;
    try {
      const live: RunningJob[] = [];
      for (const job of jobs.list(agent as never)) {
        if (job.status !== "running" && job.status !== "stopping") continue;
        live.push({
          id: String(job.id),
          label: typeof job.label === "string" ? job.label : "",
          status: job.status,
        });
      }
      app.setJobs(live);
    } catch {
      /* transient — leave the previous summary */
    }
  }

  /** Goal bar: read the goal projection's whole value (registry fold or
   * cache-seeded) and mirror phase/rounds into the ambient row. */
  function refreshGoal(): void {
    if (services.sessionProjections === undefined) return;
    try {
      const g = projectionValues().goal ?? null;
      const summary: GoalSummary | null =
        g === null
          ? null
          : {
              objective: g.goal.objective,
              phase: g.goal.phase,
              roundsStarted: g.roundsStarted,
              maxGoalRounds: g.goal.maxGoalRounds,
            };
      app.setGoal(summary);
    } catch {
      /* projections not ready — leave the previous bar */
    }
  }

  // Session event feed → transcript.
  const disposeSessionFeed = ctx.on(
    "session/event",
    (session: { id: string }, event: unknown) => {
      if (session.id !== agent.id) return;
      app.model.apply(event as never, presenters);
      const evt = event as { type?: string; data?: Record<string, unknown> };
      if (evt.type === "assistant/message") {
        const usage = evt.data?.usage as UsageLike | undefined;
        const rate = cacheRateOf(usage);
        if (rate !== undefined) app.setCacheRate(rate);
        // Session-total `out` rides updateContextPressure (projection-backed),
        // so the per-event outputTokens value is no longer consumed here.
      } else if (evt.type === "assistant/chunk") {
        const chunk = evt.data?.chunk as { type?: string; text?: string } | undefined;
        if (chunk?.type === "text-delta" && typeof chunk.text === "string" && chunk.text !== "") {
          app.noteStreamText(chunk.text);
        }
      } else if (evt.type === "todo/write") {
        const todos = evt.data?.todos as TodoItem[] | undefined;
        if (Array.isArray(todos)) app.setTodos(todos);
      }
      // Subagent lifecycle rides tool/call + tool/result (and turn bounds for
      // background continuable children) — refresh the summary right away.
      if (
        evt.type === "tool/call" ||
        evt.type === "tool/result" ||
        evt.type === "turn/start" ||
        evt.type === "turn/end" ||
        (evt.type !== undefined && evt.type.startsWith("goal/"))
      ) {
        refreshSubagents();
        refreshJobs();
        refreshGoal();
      }
      app.onSessionEvent();
      updateContextPressure();
    },
  );

  // Agent status → footer + the app-facing surface status. Relay (attach-client)
  // emits this from remote turn/start|end; the real Agent.status is a read-only
  // getter so writing it throws and kills the wire loop — ride surfaceStatus.
  // The subscription is unscoped, so it also sees subagent status flips; only
  // the adopted root agent may drive the status bar (dsh-agent injects
  // `payload.agent`, while older emitters may omit it — accept those).
  const disposeStatus = ctx.on(
    "agent/status",
    (payload: { status?: "idle" | "running"; agent?: { id?: unknown } }) => {
      if (payload.agent !== undefined && payload.agent.id !== agent.id) return;
      if (payload.status !== "idle" && payload.status !== "running") return;
      app.setStatus(payload.status);
      surfaceStatus = payload.status;
    },
  );

  ctx.effect(() => () => {
    disposeApproval();
    disposeRouteFiller();
    disposeSessionFeed();
    disposeStatus();
  });

    app.start();
  }

export { Config, apply, inject, name };
