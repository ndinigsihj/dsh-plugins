// dsh-tui main plugin: creates the root agent, mounts the TUI, and adapts
// the in-process interaction services (questions, approval, commands) to it.
//
// Mirrors the dsh-headless runner shape: wait for the tree to settle, create
// one agent through the core registry, then drive it. Unlike headless, this
// runner stays alive and is driven by terminal input and the session event
// feed instead of a single task.

import { basename } from "node:path";
import z from "@deepseek-ai/schemastery";
import { randomUUID } from "node:crypto";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { TuiApp, type AgentSurface } from "./app.ts";
import type { ToolPresenters } from "./transcript.ts";
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

/** Stable Cordis plugin name. */
const name = "tui-runner";

/** Core services required before the terminal front door can start. */
const inject = [
  "agentDefaultModel",
  "agents",
  "sessions",
  "userQuestions",
  "commands",
  "sessionQuery",
  "sessionProjections",
  "tokenMeter",
  "subagents",
  "timer",
  "tuiStartup",
];

const Config = z.object({});

type CordisContext = {
  get<T = unknown>(key: string): T | undefined;
  on(event: string, listener: (...args: any[]) => void): () => void;
  effect(disposer: () => void | (() => void)): void;
  interval(callback: () => void, ms: number): () => void;
};

const HELP_TEXT = [
  "/exit, /quit     exit the terminal front door",
  "/clear           clear the transcript",
  "/new             start a fresh session on the configured/saved default preset",
  "/preset [id]     switch agent presets (blank session swaps live; otherwise saved as default)",
  "/model           pick the default provider/model route (applies to new sessions)",
  "/sessions        list persisted sessions",
  "/resume <id>     resume a persisted session",
  "/session         show the current session id",
  "/help            show this help",
].join("\n");

function userMessage(text: string): unknown {
  return createUserMessage({
    content: [{ type: "text", text }],
    source: { kind: "user" },
  });
}

/** Truncate a label to a display width. */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
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

interface UsageLike {
  inputTokens?: unknown;
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
  const denom = num(usage.inputTokens) + read + num(usage.cacheWriteTokens);
  if (denom <= 0) return undefined;
  return Math.round((read / denom) * 1000) / 10;
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
  return {
    id: agent.id,
    status: agent.status,
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
    currentSelection(): { provider: string; model: string };
    /** Persist the default route (settings ns `agent-default-model`). */
    saveSelection?(next: { provider: string; model: string }): Promise<void>;
  };
  /** Model catalog for the /model picker (absent in bare boots). */
  llm?: {
    listProviders(): Array<{ id: string; name?: string }>;
    listModels(provider: string): Promise<Array<{ id: string; name?: string; description?: string }>>;
  };
  sessions: {
    flush(session: unknown): Promise<void>;
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
      signal: AbortSignal,
    ): Promise<{ result: { kind: string; text?: string } } | undefined>;
  };
  sessionQuery?: {
    listSessions(
      signal?: AbortSignal,
    ): Promise<
      Array<{ header: { id: string; cwd?: string; createdAt?: number }; live: boolean; persisted: boolean }>
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
    snapshot(
      session: unknown,
    ): { values: { contextPressure?: { projectedTokens?: number; contextWindow?: number } } };
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
  const tokenMeter = ctx.get<CoreServices["tokenMeter"]>("tokenMeter");
  const subagents = ctx.get<CoreServices["subagents"]>("subagents");
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
    tokenMeter,
    subagents,
    agentPresets,
    settings,
    llm,
    appExit,
  };
}

/** Plugin config (patch layer): `preset` pins the deployment's preset;
 * `provider`/`model` pin the model route. All optional. */
function parseConfig(config: unknown): { preset?: string; provider?: string; model?: string } {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return {};
  const cfg = config as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  return { preset: str(cfg.preset), provider: str(cfg.provider), model: str(cfg.model) };
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
  own: { preset?: string; provider?: string; model?: string },
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

  // Create (or resume) the root agent through the core registry. Resume is a
  // launcher-level decision: `dsh --profile tui --resume <id>` arrives through
  // tuiStartup and reconstructs the persisted session instead of a new one.
  // Effective route: patch-layer config pins (provider/model) win over the
  // harness's current default selection.
  const selection = services.agentDefaultModel.currentSelection();
  const resumeId = ctx.get<{ resume?: string }>("tuiStartup")?.resume;
  const agentOptions = {
    provider: own.provider ?? selection.provider,
    model: own.model ?? selection.model,
  };

  /** Model-selection + preset mount chain installed via the factory hook. */
  function makeSetup(
    composed: ComposedPreset,
  ): (agentCtx: Parameters<typeof installModelSelection>[0]) => void | Promise<void> {
    return (agentCtx) => {
      installModelSelection(agentCtx, { current: agentOptions, assembled: undefined });
      return composed.setup?.(agentCtx);
    };
  }
  const warnPreset = (message: string): void => {
    process.stderr.write(`dsh-tui: ${message}\n`);
  };

  /**
   * Preset for a resumed session: its own log wins over the deployment pin.
   * Sessions from before presets existed record none, so the patch-layer
   * `preset` key still applies to them.
   */
  async function bootResumePreset(id: string): Promise<string | undefined> {
    try {
      const snap = await services.sessionQuery?.readSession(id);
      if (snap !== undefined) {
        const recorded = recordedPresetOf(snap.events);
        if (recorded !== undefined) return recorded;
      }
    } catch {
      /* unreadable log — fall through */
    }
    return own.preset;
  }

  // Launch-time resolution: the deployment pin is the only override here; a
  // saved user choice lives in the roster's settings default and resolves
  // through defaultId when we request none (hot-reloaded document).
  const requestedPreset =
    resumeId !== undefined ? ((await bootResumePreset(resumeId)) ?? own.preset) : own.preset;
  const composed = await composePreset(services.agentPresets, requestedPreset, warnPreset);

  const created = resumeId !== undefined
    ? await services.agents.resume({
        resumeSessionId: SessionId(resumeId),
        agentOptions,
        setup: makeSetup(composed),
      })
    : await services.agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: {
          cwd: process.cwd(),
          ...(composed.agentPreset === undefined ? {} : { agentPreset: composed.agentPreset }),
        },
        agentOptions,
        setup: makeSetup(composed),
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

  const app = new TuiApp({
    agent: agentSurface(agent),
    modelLabel: `${selection.provider}/${selection.model}`,
    presenters,
    onPrompt: (text) => {
      if (text.startsWith("/")) {
        void runCommand(text);
        return;
      }
      const msg = userMessage(text);
      if (agent.status === "running") agent.steer(msg);
      else agent.followup(msg);
    },
    onCancel: () => agent.cancel({ kind: "user" }),
    onExit: () => stopAndExit(),
  });

  // On resume, rebuild the transcript from the persisted log before live events.
  if (resumeId !== undefined) {
    app.model.rebuild(agent.session.events as never, presenters);
    app.onSessionEvent();
    app.appendCommandOutput(`Resumed session ${agent.id}.`);
    const rate = lastCacheRate(agent.session.events);
    if (rate !== undefined) app.setCacheRate(rate);
  }
  updateContextPressure();
  refreshSubagents();

  async function stopAndExit(): Promise<void> {
    try {
      await services.sessions.flush(agent.session);
    } catch {
      /* flush failure still exits */
    }
    await app.stopAndExit(services.appExit);
  }

  /** The preset id the live agent currently runs, or undefined when none. */
  function currentPreset(): string | undefined {
    try {
      return services.agentPresets?.composedPreset(agent.ctx);
    } catch {
      return undefined;
    }
  }

  /** Rebind the app + every closure to a newly adopted agent (/new path). */
  async function adoptAgent(next: Agent): Promise<void> {
    agent = next;
    await next.whenIdle();
    presenters = presentersFor(next);
    app.setAgent(agentSurface(next));
    app.setCacheRate(null); // fresh session: no usage reported yet
    app.model.clear();
    app.onSessionEvent();
    updateContextPressure();
    refreshSubagents();
  }

  /** /new — fresh session in-process: create + rebind, keep this terminal. */
  async function startNewSession(): Promise<void> {
    if (agent.status === "running") {
      app.showNotice("Agent is running — Esc cancels it first.");
      return;
    }
    try {
      await services.sessions.flush(agent.session);
    } catch {
      /* flush failure still switches */
    }
    const requested = own.preset;
    const fresh = await composePreset(services.agentPresets, requested, (m) => app.showNotice(m));
    try {
      const result = await services.agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: {
          cwd: process.cwd(),
          ...(fresh.agentPreset === undefined ? {} : { agentPreset: fresh.agentPreset }),
        },
        agentOptions,
        setup: makeSetup(fresh),
      });
      await adoptAgent(result.agent);
      app.appendCommandOutput(
        `New session ${result.agent.id}` +
          (fresh.agentPreset === undefined ? "." : ` (preset ${fresh.agentPreset}).`),
      );
    } catch (error) {
      app.showNotice(
        `/new failed: ${error instanceof Error ? error.message : String(error)} — staying on ${agent.id}`,
      );
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

  /** /model — pick the default provider/model route from the llm catalog. */
  async function doModel(): Promise<void> {
    const llm = services.llm;
    if (llm === undefined) {
      app.showNotice("No llm service in this deployment.");
      return;
    }
    const current = services.agentDefaultModel.currentSelection();
    const routes: Array<{ provider: string; model: string }> = [];
    const items: Array<{ value: string; label: string; description?: string }> = [];
    const providers = llm.listProviders();
    const catalogs = await Promise.all(
      providers.map(async (p) => ({
        provider: p,
        models: await llm.listModels(p.id).catch(() => []),
      })),
    );
    for (const { provider, models } of catalogs) {
      for (const model of models) {
        const index = routes.length;
        routes.push({ provider: provider.id, model: model.id });
        const isCurrent = provider.id === current.provider && model.id === current.model;
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
    if (route.provider === current.provider && route.model === current.model) {
      app.showNotice(`Already on ${route.provider}/${route.model}.`);
      return;
    }
    if (services.agentDefaultModel.saveSelection === undefined) {
      app.showNotice("Cannot persist: no settings-backed default-model service.");
      return;
    }
    try {
      await services.agentDefaultModel.saveSelection(route);
      app.appendCommandOutput(
        `Default model set to ${route.provider}/${route.model} — applies to new sessions (/new or restart). ` +
          "The current session keeps its route.",
      );
    } catch (error) {
      app.showNotice(
        `/model failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
    if (row !== undefined && row.broken !== undefined) {
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
  }> {
    const query = services.sessionQuery;
    if (query === undefined) return { items: [], totalRecords: 0, localRecords: 0 };
    const records = await query.listSessions();
    // Scope to the current workspace: sessions persist keyed by cwd, and a
    // global newest-first list mostly shows other projects' logs.
    const cwd = process.cwd();
    const local = records.filter((rec) => rec.header.cwd === cwd);
    const recent = local.slice(0, 30);
    const snapshots = await query.readTitleSnapshots(recent.map((rec) => rec.header.id));
    const items = recent.map((rec, i) => {
      const snap = snapshots[i];
      const title = snap?.status === "fulfilled" ? snap.value?.title?.title : undefined;
      const state = rec.live ? "live" : rec.persisted ? "persisted" : "missing";
      const when = relativeTime(rec.header.createdAt);
      const marker = rec.header.id === agent.id ? " (current)" : "";
      return {
        value: rec.header.id,
        label: title !== undefined && title !== "" ? truncate(title, 60) : "(empty session)",
        description: `${when} · ${state}${marker}`,
      };
    });
    return { items, totalRecords: records.length, localRecords: local.length };
  }

  async function listSessions(): Promise<void> {
    try {
      const { items, totalRecords, localRecords } = await loadSessionItems();
      if (items.length === 0) {
        app.appendCommandOutput(
          `No sessions in this workspace (${totalRecords} in other workspaces). ` +
            "/resume <id> still works cross-project.",
        );
        return;
      }
      const lines = items.map((item, i) => `${String(i + 1).padStart(2)}. ${item.label} [${item.description}]`);
      app.appendCommandOutput(
        `Sessions in ${basename(process.cwd())} (${localRecords}` +
          (totalRecords > localRecords ? ` of ${totalRecords} total` : "") + "):\n" +
          `${lines.join("\n")}\n/resume to pick, or /resume <session-id>.`,
      );
    } catch (error) {
      app.showNotice(`dsh-tui: session list failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function doResume(line: string): Promise<void> {
    const id = line.split(/\s+/)[1];
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
      const { items, totalRecords } = await loadSessionItems();
      if (items.length === 0) {
        app.showNotice(
          `No sessions in this workspace (${totalRecords} elsewhere) — /resume <id> works cross-project.`,
        );
        return;
      }
      const picked = await app.pickSession(items);
      if (picked === null) {
        app.showNotice("Resume cancelled.");
        return;
      }
      await relaunchToResume(picked);
    } catch (error) {
      app.showNotice(`dsh-tui: resume failed: ${error instanceof Error ? error.message : String(error)}`);
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
    const records = services.sessionQuery === undefined ? [] : await services.sessionQuery.listSessions();
    const target = records.find((r) => r.header.id === id);
    const targetCwd = target?.header.cwd;
    if (targetCwd !== undefined) {
      try {
        process.chdir(targetCwd);
      } catch (error) {
        console.error(`dsh-tui: cannot enter ${targetCwd}: ${String(error)}`);
        services.appExit(1);
        return;
      }
    }
    app.stopTerminal();
    const relaunch = [process.execPath, ...process.argv.slice(1), "--resume", id];
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
    if (line === "/help") {
      app.showNotice(HELP_TEXT);
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
    if (services.commands !== undefined) {
      const execution = await services.commands.execute(agent, line, new AbortController().signal);
      if (execution === undefined) {
        app.showNotice(`Unknown command ${line.split(/\s+/)[0]} — /help lists what's available.`);
        return;
      }
      const text = execution.result.text;
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
          questions: Array<{
            id: string;
            question: string;
            options?: Array<{ label: string; description?: string }>;
          }>;
        };
        const answers: Array<{ id: string; selected: string[] }> = [];
        for (const item of req.questions ?? []) {
          const selected = await app.askQuestion({
            id: item.id,
            question: item.question,
            options: item.options,
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
      return app.askApproval({ toolName: request.toolName, reason: request.reason }) as Promise<
        unknown
      >;
    },
  );

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
        void startNewSession();
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "preset",
      description: "Switch agent presets: /preset [id]",
      handler: ({ rawInput }) => {
        void doPreset(rawInput === "" ? "/preset" : `/preset ${rawInput}`);
        return { kind: "success" };
      },
    });
    services.commands.register({
      name: "model",
      description: "Pick the default provider/model route",
      handler: () => {
        void doModel();
        return { kind: "success" };
      },
    });
  }

  // Context-window occupancy from the token-meter projection (projected
  // tokens / route capacity). Null until the provider reports usage.
  function updateContextPressure(): void {
    const proj = services.sessionProjections;
    if (proj === undefined) return;
    try {
      const pressure = proj.snapshot(agent.session).values.contextPressure;
      const windowTokens = pressure?.contextWindow;
      if (windowTokens === undefined || windowTokens <= 0) return;
      // Prefer the projection's next-request estimate; fall back to the meter's
      // heuristic total when the provider has not reported usage yet.
      let used: number | undefined = pressure?.projectedTokens;
      if (used === undefined && services.tokenMeter !== undefined) {
        try {
          used = services.tokenMeter.measure(agent.session).totalTokens;
        } catch {
          used = undefined;
        }
      }
      if (used === undefined) return;
      const pct = Math.max(0, Math.min(100, Math.round((used / windowTokens) * 100)));
      app.setContextOccupancy({ pct, usedTokens: used, windowTokens });
    } catch {
      /* projection not ready — leave the previous reading */
    }
  }

  // Running-subagent summary under the status line. Poll on a timer: child
  // sessions emit their own events (which the root sees but filters), so a
  // direct list call is the reliable "live" signal.
  function refreshSubagents(): void {
    const subs = services.subagents;
    if (subs === undefined) return;
    void subs
      .listChildren(agent.id)
      .then((children) => {
        const running = children
          .filter((c) => c.activity === "running")
          .map((c) => ({ id: c.id, mode: c.mode, label: c.label }));
        app.setSubagents(running);
      })
      .catch(() => {
        /* transient — leave the previous summary */
      });
  }
  const disposeSubagentPoll = ctx.interval(refreshSubagents, 5000);

  // Session event feed → transcript.
  const disposeSessionFeed = ctx.on(
    "session/event",
    (session: { id: string }, event: unknown) => {
      if (session.id !== agent.id) return;
      app.model.apply(event as never, presenters);
      const evt = event as { type?: string; data?: { usage?: UsageLike } };
      if (evt.type === "assistant/message") {
        const rate = cacheRateOf(evt.data?.usage);
        if (rate !== undefined) app.setCacheRate(rate);
      }
      app.onSessionEvent();
      updateContextPressure();
    },
  );

  // Agent status → footer.
  const disposeStatus = ctx.on("agent/status", (payload: { status: "idle" | "running" }) => {
    app.setStatus(payload.status);
  });

  ctx.effect(() => () => {
    disposeApproval();
    disposeSessionFeed();
    disposeStatus();
    disposeSubagentPoll();
  });

    app.start();
  }

export { Config, apply, inject, name };
