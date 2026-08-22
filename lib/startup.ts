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
    .option("--resume <sessionId>", "resume a persisted session instead of creating a new one")
    .helpOption("-h, --help", "show this help");
}

interface TuiStartupValue {
  resume?: string;
}

function apply(ctx: {
  provide(key: string, value: TuiStartupValue): void;
}): void {
  const program = tuiCommand();
  program.action((opts: { resume?: string }) => {
    // Env fallback keeps the rewind plugin's execve handoff and the launcher's
    // DSH_CC_RESUME_SESSION habit working without a --resume flag.
    ctx.provide(TUI_STARTUP_SERVICE, { resume: opts.resume ?? process.env.DSH_CC_RESUME_SESSION });
  });
  parseCmdline(ctx as never, program);
}

export type { TuiStartupValue };

export { TUI_STARTUP_SERVICE, apply, inject, name };
