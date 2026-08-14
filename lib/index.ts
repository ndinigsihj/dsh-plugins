// dsh-tui main plugin: creates the root agent, mounts the TUI, and adapts
// the in-process interaction services (questions, approval, commands) to it.
//
// Mirrors the dsh-headless runner shape: wait for the tree to settle, create
// one agent through the core registry, then drive it. Unlike headless, this
// runner stays alive and is driven by terminal input and the session event
// feed instead of a single task.

import z from "@deepseek-ai/schemastery";
import { randomUUID } from "node:crypto";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { TuiApp, type AgentSurface } from "./app.ts";
import type { ToolPresenters } from "./transcript.ts";

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
  "tuiStartup",
];

const Config = z.object({});

type CordisContext = {
  get<T = unknown>(key: string): T | undefined;
  on(event: string, listener: (...args: any[]) => void): () => void;
  effect(disposer: () => void | (() => void)): void;
};

const HELP_TEXT = [
  "/exit, /quit     exit the terminal front door",
  "/clear           clear the transcript",
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
      setup?: (ctx: Parameters<typeof installModelSelection>[0]) => void;
    }): Promise<{ agent: Agent }>;
  };
  agentDefaultModel: {
    currentSelection(): { provider: string; model: string };
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
    ): Promise<Array<{ header: { id: string; cwd?: string }; live: boolean; persisted: boolean }>>;
    readTitleSnapshots(
      ids: string[],
    ): Promise<Array<{ sessionId: string; status: string; title?: { title?: string } }>>;
  };
  appExit: (code: number) => void;
}

interface Agent {
  id: string;
  status: "idle" | "running";
  session: { events: unknown[] };
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
    appExit,
  };
}

function apply(ctx: CordisContext): void {
  // Fire-and-forget the whole front door: apply must return so the plugin
  // settles, otherwise `loader.await()` inside run() deadlocks on us.
  void run(ctx).catch((error: unknown) => {
    process.stderr.write(`dsh-tui: ${error instanceof Error ? error.message : String(error)}\n`);
    ctx.get<(code: number) => void>("appExit")?.(1);
  });
}

async function run(ctx: CordisContext): Promise<void> {
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
  const selection = services.agentDefaultModel.currentSelection();
  const resumeId = ctx.get<{ resume?: string }>("tuiStartup")?.resume;
  const agentOptions = { provider: selection.provider, model: selection.model };
  const setup = (agentCtx: Parameters<typeof installModelSelection>[0]): void => {
    installModelSelection(agentCtx, { current: selection, assembled: undefined });
  };
  const created = resumeId !== undefined
    ? await services.agents.resume({
        resumeSessionId: SessionId(resumeId),
        agentOptions,
        setup,
      })
    : await services.agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: { cwd: process.cwd() },
        agentOptions,
        setup,
      });
  const agent: Agent = created.agent;
  await agent.whenIdle();

  const tools = agent.ctx.get<{
    get(n: string):
      | {
          presentCall?: (a: unknown) => unknown;
          presentResult?: (a: unknown, r: unknown) => unknown;
        }
      | undefined;
  }>("tools");
  const presenters: ToolPresenters = {
    presentCall: (toolName, args) => tools?.get(toolName)?.presentCall?.(args) as never,
    presentResult: (toolName, args, result) =>
      tools?.get(toolName)?.presentResult?.(args, result) as never,
  };

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
  }

  async function stopAndExit(): Promise<void> {
    try {
      await services.sessions.flush(agent.session);
    } catch {
      /* flush failure still exits */
    }
    await app.stopAndExit(services.appExit);
  }

  /** Load persisted sessions as picker rows (id, title, live/persisted state). */
  async function loadSessionItems(): Promise<Array<{ value: string; label: string; description: string }>> {
    if (services.sessionQuery === undefined) return [];
    const records = await services.sessionQuery.listSessions();
    const titleResults = await services.sessionQuery.readTitleSnapshots(
      records.map((r) => r.header.id),
    );
    const titleBySession = new Map<string, string>();
    for (const t of titleResults) {
      if (t.status === "fulfilled") titleBySession.set(t.sessionId, t.title?.title ?? "");
    }
    return records.map((rec) => {
      const state = rec.live ? "live" : rec.persisted ? "persisted" : "missing";
      const title = titleBySession.get(rec.header.id) ?? "(untitled)";
      const marker = rec.header.id === agent.id ? " (current)" : "";
      return {
        value: rec.header.id,
        label: title,
        description: `${state} · ${rec.header.id}${marker}`,
      };
    });
  }

  async function listSessions(): Promise<void> {
    try {
      const items = await loadSessionItems();
      if (items.length === 0) {
        app.appendCommandOutput("No persisted sessions found.");
        return;
      }
      const lines = items.map((item, i) => `${String(i + 1).padStart(2)}. ${item.label} [${item.description}]`);
      app.appendCommandOutput(
        `Sessions (${items.length}):\n${lines.join("\n")}\n/resume to pick, or /resume <session-id>.`,
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
      const items = await loadSessionItems();
      if (items.length === 0) {
        app.showNotice("No persisted sessions to resume.");
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
      const text = execution?.result.text;
      if (text !== undefined && text !== "") app.showNotice(text);
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
  }

  // Session event feed → transcript.
  const disposeSessionFeed = ctx.on(
    "session/event",
    (session: { id: string }, event: unknown) => {
      if (session.id !== agent.id) return;
      app.model.apply(event as never, presenters);
      app.onSessionEvent();
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
  });

    app.start();
  }

export { Config, apply, inject, name };
