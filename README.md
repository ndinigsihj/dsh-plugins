# dsh-tui

Interactive terminal front door for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): a Cordis plugin bundle that mounts the `@earendil-works/pi-tui` renderer **inside the dsh process**, consuming the in-process services directly (`agent.send/steer`, `session/event` feed, `userQuestions`, `approval`, `commands`).

This is a faithful reconstruction of the TUI package DeepSeek removed before the public release (`2026-08-04-remove-tui-package`), built from the archived design notes. See `ARCHITECTURE.md` for the design.

## How it works

`dsh` is a launcher that boots a profile — an ordered stack of plugin-bundle patch layers. `dsh-tui` is a bundle (`dsh.bundle.patch`), mounted over `dsh-base`:

```
dsh --profile tui
└─ ~/.dsh/profiles/tui/          (package.json bundles + cordis.patch.yml)
   ├─ @deepseek-ai/dsh-base       core: agent, session, llm, sandbox, approval, tools
   ├─ dsh-tui/startup             parses this app's CLI, provides `tuiStartup`
   └─ dsh-tui                     owns the terminal; consumes in-process services
```

## Prerequisites

- Node `^22.19` (published dsh runs `.ts` via native type-stripping)
- A DeepSeek key: `export DEEPSEEK_API_KEY=...` (or configure through the dsh web Models page)
- The tool-calling model route must support tools (the stock `deepseek-v4-flash` catalog entry 404s on tool calls with some keys — configure a working route)

## Development loop

The profile's `cordis.patch.yml` inserts the local plugin files by absolute path, so there is no build step:

```yaml
- insert:
    - id: tui-startup
      name: '/Users/vito/data/dev/dsh-tui/lib/startup.ts'
    - id: tui-runner
      name: '/Users/vito/data/dev/dsh-tui/lib/index.ts'
```

1. `npm install` (project has its own node_modules so the `.ts` imports resolve)
2. Ensure `~/.dsh/profiles/tui/package.json` declares the `dsh-base` bundle (see below)
3. Run `npx dsh --profile tui`

```json
// ~/.dsh/profiles/tui/package.json
{
  "name": "dsh-profile-tui",
  "private": true,
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base"] } }
}
```

## Keys

- Type a prompt, `Enter` to send (steers a running turn)
- `Esc` — cancel the active turn
- `Ctrl+C` — cancel while running; exit while idle
- `Ctrl+D` — exit

The status line shows `ctx N%` — context-window occupancy from the token-meter
projection (`projected / route capacity`, heuristic before the provider reports
usage). It turns yellow at `>=80%`, which is also the `thresholdRatio` where
`compaction-basic` auto-compacts.

## Commands

- `/help` — command list
- `/clear` — clear the transcript
- `/exit` / `/quit` — exit (same as idle `Ctrl+C` / `Ctrl+D`)
- `/sessions` — list persisted sessions, each labelled by its first user message (empty sessions show `(empty session)`) with relative age and live/persisted state
- `/session` — show the current session id
- `/resume` — full-viewport picker: type to filter by first-message text or id, `↑`/`↓` navigate, `Enter` resumes, `Esc` clears then cancels
- `/resume <session-id>` — resume directly (same as `dsh --profile tui --resume <id>`). Both flush the current session, chdir to the target workspace, restore the terminal, and `execve`-relaunch — the same handoff path the original dsh host used.

## Structure

| File | Purpose |
|---|---|
| `cordis.patch.yml` | The bundle patch: persona, HMR off, insert `tui-startup` + `tui-runner` |
| `lib/startup.ts` | `tui-startup` plugin: parse cmdline, provide `tuiStartup` |
| `lib/index.ts` | `tui-runner` plugin: create agent, wire services, own the terminal |
| `lib/app.ts` | pi-tui app: alt-screen layout, transcript area, prompt editor, dialogs |
| `lib/transcript.ts` | session/event → transcript rows (append-only, revision-tracked) |
| `lib/palette.ts` | 16-color SGR palette |
| `lib/sanitize.ts` | ANSI hygiene (strip escapes, escape stray C0/C1) |

## Extension plugins

Thin Cordis plugins (no dsh-tui modification) mounted into a profile's
`cordis.patch.yml` via absolute-path `insert`:

| File | Purpose |
|---|---|
| `plugins/rename-session.ts` | `/rename <title>` — set session title (pins against auto-retitle) |
| `plugins/rewind-dsh.ts` | `/rewind [<seq>]` — **standalone rewind**: fork + file-restore + relaunch, overriding the built-in rewind (see `docs/rewind-file-restore-plugin.md`) |
| `approval-tui.ts` | Route `approval/request` to the TUI question panel |

## Agent presets (liangshen-plus)

`presets/liangshen-plus/` is a combination agent preset that merges three
behaviors into one composition (design: `docs/liangshen-plus-preset-design.md`):

1. **Round-1 anchoring** — the first request only exposes the Minimal tool pair
   (`persistent bash` + `str_replace_editor`), free of injected workspace/skill
   context, so the session anchors on direct tool use (verified 5/5-style
   behavior; M4 replication §5.6).
2. **Round-2+ AGENTS.md injection** — `dsh-agent-instructions` is restored after
   the first durable tool call, so workspace/`~/.dsh/AGENTS.md` instructions
   reach the model from round 2 on.
3. **Round-2+ bash privilege swap** — `phase-swap-bash.mjs` shadows the shared
   persistent bash with the sandboxed `dsh-tool-bash` (per-agent scope layer),
   re-adding `sandbox_permissions`/`justification` escalation after anchoring.

| File | Purpose |
|---|---|
| `agent.cordis.yml` | The preset composition (source of truth; deployed to `~/.dsh/.agent-presets/liangshen-plus/`) |
| `phase-swap-bash.mjs` | The swap plugin (per-agent shadow, rc.8 verified) |
| `phase-swap-bash.test.mjs` | 9 unit tests (node --test) |
| `smoke-boot.mjs` / `smoke-driver.mjs` | No-LLM composition smoke (round-1 catalog, round-2 swap+injection) |
| `smoke-live.mjs` / `smoke-live-driver.mjs` | Real-LLM 3-round live smoke |
| `m4-runner.mjs` / `m4-driver.mjs` | M4 anchoring replication runner (A/B/C/D, results in `experiments/m4/`) |

Use: `CC_TUI_PRESET=liangshen-plus dsh --profile endless-tui` then `/new`
(preset mounts at session creation; resumed sessions keep their old preset).
Manual smoke checklist: `docs/liangshen-plus-manual-smoke.md`.

## Tested

Boot, fullscreen takeover, prompt submit, streaming assistant rendering, reasoning (dim), injected-context dimming, error cards, status line, `/help` `/clear` `/exit`, clean exit (code 0). Approval dialogs, question panels, and tool cards are wired to the documented service APIs but need a tool-capable model route to exercise end to end.
