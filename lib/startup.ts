// Command-line provider for the TUI app. Mirrors the dsh-headless startup:
// parse this app's own flags via `cmdlineArgs`, then publish `tuiStartup` so
// the runner's lazy config can consume it.

import { Command } from "commander";
import { parseCmdline } from "@deepseek-ai/dsh-cmdline";

/** Stable Cordis plugin name. */
const name = "tui-startup";

/** Services required before the app's flags can be resolved. */
const inject = ["cmdlineArgs"];

/** Service provided by this plugin and injected by the TUI runner. */
const TUI_STARTUP_SERVICE = "tuiStartup";

function tuiCommand(): Command {
  return new Command()
    .name("dsh --profile tui")
    .description("Boot the interactive terminal coding agent.")
    .helpOption("-h, --help", "show this help");
}

function apply(ctx: {
  provide(key: string, value: Record<string, unknown>): void;
}): void {
  const program = tuiCommand();
  program.action(() => {
    ctx.provide(TUI_STARTUP_SERVICE, {});
  });
  parseCmdline(ctx as never, program);
}

export { TUI_STARTUP_SERVICE, apply, inject, name };
