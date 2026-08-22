// Agent-preset integration for the TUI runner.
//
// Built on the standard `agentPresets` cordis service, without importing the
// package: every type here is structural, so the plugin stays loadable in
// rosterless deployments where the service simply resolves to undefined.
//
// Principle: follow the harness's own semantics first — NOT any particular
// front door's conventions. Concretely:
//   - Resolution happens BEFORE create/resume; the mount runs inside the
//     agent factory's setup hook, where a failure rolls back the creation.
//   - Resolution failure degrades to the host composition with a loud
//     warning — a session that cannot start is worse than one running
//     without its preset.
//   - Only a blank session (no turn ever ran) may recompose live; anything
//     else persists the choice through the harness settings seam (the
//     `agent-presets` namespace dsh-agent-presets itself registers), and the
//     roster's hot-reloaded default picks it up on the next session.
//   - A successful live switch appends `agent-preset/selected` to the
//     session log so resumes/forks resolve the NEW composition.

/** The settings namespace dsh-agent-presets registers (`{ default }`). */
export const AGENT_PRESETS_NS = "agent-presets";

/** Structural seam over the `settings` cordis service the runner writes. */
export interface SettingsSeam {
  get(ns: string): unknown;
  update(ns: string, patch: object): Promise<void>;
}

/** One roster row (structural view of AgentPresets.list()). */
export interface PresetRow {
  readonly id: string;
  /** "system" (ships with the deployment) or "user" (locally authored). */
  readonly trust?: string;
  /** Display name from preset.yml; absent falls back to the id. */
  readonly name?: string;
  readonly description?: string;
  /** Why this preset cannot compose a session; absent when mountable. */
  readonly broken?: string;
}

/** The slice of the agentPresets cordis service the TUI consumes. */
export interface PresetRoster {
  list(): Promise<PresetRow[]>;
  resolve(id?: string): Promise<{ id: string }>;
  mount(agentCtx: unknown, id?: string): Promise<unknown>;
  recompose(agentCtx: unknown, id: string): Promise<unknown>;
  composedPreset(agentCtx: unknown): string | undefined;
  readonly defaultId: string;
}

/** Preset resolution output consumed by agents.create/resume. */
export interface ComposedPreset {
  /** Resolved id; recorded into the created session's header meta. */
  agentPreset?: string;
  /** Setup-hook fragment that mounts the preset (chained by the caller). */
  setup?(agentCtx: unknown): Promise<void>;
}

/** Ids a preset directory may use (dsh-agent-presets' own boundary). */
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Resolve a preset request ahead of create/resume and produce the setup
 * fragment that mounts it. `requested === undefined` adopts the roster
 * default. A rosterless deployment composes nothing.
 */
export async function composePreset(
  roster: PresetRoster | undefined,
  requested: string | undefined,
  warn: (message: string) => void,
): Promise<ComposedPreset> {
  if (roster === undefined) return {};
  let resolvedId: string;
  try {
    resolvedId = (await roster.resolve(requested)).id;
  } catch (error) {
    warn(
      `agent preset ${requested === undefined ? "(default)" : `"${requested}"`} unavailable ` +
        `(${error instanceof Error ? error.message : String(error)}) — composing the session without a preset`,
    );
    return {};
  }
  return {
    agentPreset: resolvedId,
    setup: async (agentCtx) => {
      await roster.mount(agentCtx, resolvedId);
    },
  };
}

/**
 * The preset a session LOG records: the last `agent-preset/selected` event
 * wins. undefined when none recorded (the caller's fallback chain applies).
 */
export function recordedPresetOf(
  events: ReadonlyArray<{ type: string; data?: unknown }>,
): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event === undefined || event.type !== "agent-preset/selected") continue;
    const id = (event.data as { agentPreset?: unknown } | undefined)?.agentPreset;
    if (typeof id === "string" && PRESET_ID.test(id)) return id;
  }
  return undefined;
}

/**
 * Official blank-session rule (dsh-agent-presets): only a session that has
 * produced nothing may swap compositions — a started session's logged tool
 * calls would strand under a different tool set.
 */
export function sessionIsBlank(events: ReadonlyArray<{ type?: string }>): boolean {
  return !events.some((event) => event?.type === "turn/start");
}
