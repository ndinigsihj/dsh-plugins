/**
 * tui-rename-session: a thin extension plugin for the published
 * `@deepseek-harness-tui/dsh-tui` bundle that adds a `/rename <title>`
 * command to set the current session's title explicitly.
 *
 * It does not touch dsh-tui itself: it only consumes two standard harness
 * services — `sessionTitle` (from `@deepseek-ai/dsh-session-title`, whose
 * `rename()` accepts an explicit user title, pins it against automatic
 * retitling, and appends the durable `session/title` event) and `commands`
 * (from `@deepseek-ai/dsh-commands`, whose registry merges plugin commands
 * into the TUI's `/` menu — registry handlers win over local names).
 *
 * Mount in a profile patch:
 *   - id: tui-rename-session
 *     name: '<abs path>/plugins/rename-session.ts'
 *     inject: [sessionTitle, commands, agents]
 */

import { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

const name = "tui-rename-session";
const inject = ["sessionTitle", "commands", "agents"];
const Config = z.object({});

interface SessionTitleService {
  rename(session: unknown, title: string): unknown;
}

interface CommandResult {
  kind: "success" | "error";
  text?: string;
}

/** Fetch a service off the context with a runtime key (untyped get). */
function getService<T>(ctx: Context, key: string): T | undefined {
  return (ctx as unknown as { get(key: string): unknown }).get(key) as T | undefined;
}

function apply(ctx: Context): void {
  const sessionTitle = getService<SessionTitleService>(ctx, "sessionTitle");
  const commands = getService<{ register(def: unknown): () => void }>(ctx, "commands");
  const agents = getService<{ roots(): Array<{ session: unknown }> }>(ctx, "agents");
  if (sessionTitle === undefined || commands === undefined || agents === undefined) {
    ctx.logger?.warn("tui-rename-session: missing sessionTitle/commands/agents — /rename not registered");
    return;
  }

  commands.register({
    name: "rename",
    description: "Rename the current session (pins it against automatic retitling)",
    input: { hint: "<new title>" },
    recordInput: true,
    handler: (invocation: { rawInput: string }): CommandResult => {
      // rawInput includes the separator whitespace after the command name.
      const title = invocation.rawInput.trim();
      if (title.length === 0) {
        return { kind: "error", text: "usage: /rename <new title>" };
      }
      const roots = agents.roots();
      const session = roots[0]?.session;
      if (session === undefined) {
        return { kind: "error", text: "no live root session to rename" };
      }
      try {
        sessionTitle.rename(session, title);
      } catch (error) {
        return {
          kind: "error",
          text: `rename failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      return { kind: "success", text: `session renamed: ${title}` };
    },
  });
}

export { Config, apply, inject, name };
