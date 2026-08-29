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

The active deployment profiles are **`tui`** (stable) and **`tui-dev`** (dev),
both mounting the self-built pi-tui front end (`lib/`) from this repo. The
`@deepseek-harness-tui/dsh-tui` package is a **third-party** TUI, used only as a
functional reference while building this front end; the legacy `endless-tui`
profile that ran it is deprecated and no longer referenced.

## Prerequisites

- Node `^22.19` (published dsh runs `.ts` via native type-stripping)
- A DeepSeek key: `export DEEPSEEK_API_KEY=...` (or configure through the dsh web Models page)
- The tool-calling model route must support tools (the stock `deepseek-v4-flash` catalog entry 404s on tool calls with some keys — configure a working route)

## Development loop

The profile's `cordis.patch.yml` inserts the local plugin files by absolute path, so there is no build step:

```yaml
- insert:
    - id: tui-startup
      name: '/Users/vito/data/dev/dsh-plugins/lib/startup.ts'
    - id: tui-runner
      name: '/Users/vito/data/dev/dsh-plugins/lib/index.ts'
```

1. `npm install` (project has its own node_modules so the `.ts` imports resolve)
2. `scripts/link-global-dsh.sh` — the `.ts` sources import `@deepseek-ai/*` packages that are not declared in `package.json`; this links them to the globally installed dsh dependency tree (idempotent, re-run after `npm i -g @deepseek-ai/dsh`)
3. Ensure `~/.dsh/profiles/tui/package.json` declares the `dsh-base` bundle (see below)
4. Run `npx dsh --profile tui`

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
| `lib/export.ts` | `/export` Markdown serializer (pure rows → document) |
| `lib/presets.ts` | agent-preset roster resolution for boot / `/preset` / `/new` |
| `lib/diff.ts` | bounded line diff shared by tool cards and the exporter |
| `lib/palette.ts` | 16-color SGR palette |
| `lib/sanitize.ts` | ANSI hygiene (strip CSI/OSC escapes, escape stray C0/C1) |
| `lib/terminal.ts` | ProcessTerminal wrapper adding OSC-52 clipboard support |
| `lib/clipboard.ts` | local clipboard fallback when the host terminal has none |

## Extension plugins

Thin Cordis plugins (no self-built TUI modification) mounted into a profile's
`cordis.patch.yml` via absolute-path `insert`. They are part of the self-built
TUI: they register dsh-standard commands through the `commands` registry and
consume standard harness services (`sessionTitle`, `sessions`, `ctx.fs`).
The old `approval-tui.ts` (for the deprecated `endless-tui` profile) was
removed — the self-built front end in `lib/` has its own approval card:

| File | Purpose |
|---|---|
| `plugins/rename-session.ts` | `/rename <title>` — self-built TUI command; consumes standard `sessionTitle.rename()` via the `commands` registry |
| `plugins/rewind-dsh.ts` | `/rewind [<seq>]` — self-built TUI command: fork + file-restore + relaunch (see `docs/rewind-file-restore-plugin.md`) |

## Relay / fleet（dsh-relay 集成）

dsh-relay 的 `remote-client`、`fleet-client` 与 `memory-sink` 通过标准 harness 服务
（`commands` / `tools` / `approval`）与 TUI 协作，**本仓库不需要写命令代码**：
插件在 profile 里挂载后，`/workers`、`/spawn <dir>`、`/worker-stop`、`/fleet …`
会自动出现在 TUI 的 `/` 菜单（commands 注册表 handler 优先于 TUI 本地命令）。

mac TUI 的 `tui` / `tui-dev` profile 挂载 `remote-client`（示意）：

```yaml
- insert:
    - id: relay-client
      name: '/path/to/dsh-relay/src/client.ts'
      inject: [loader, agents, sessions, userQuestions, endlessStorage, tools, timer, approval]
      config:
        url: !!js process.env.DSH_RELAY_URL ?? ''      # 空 = 本地直连
        token: !!js process.env.DSH_RELAY_TOKEN ?? ''
        memorySinkUrl: !!js process.env.DSH_RELAY_MEMORY_SINK_URL ?? ''   # 可选
        memorySinkToken: !!js process.env.DSH_RELAY_MEMORY_SINK_TOKEN ?? ''
```

hub 侧的 `fleet-client` / `memory-sink`、worker 侧的 `remote-server` 挂载不在本仓库，
完整 YAML 与配置项见 [dsh-relay README](../dev/dsh-relay/README.md)（实现 / 设计见
`docs/relay-v1.1-fleet-design.md`）。

| 命令 | 来源 | 说明 | 状态 |
|---|---|---|---|
| `/workers` | remote-client | 列出 bootstrap 上的 workspace worker | ✅ 已实现 |
| `/spawn <dir>` | remote-client | spawn workspace worker 并重连 | ✅ 已实现 |
| `/worker-stop <dir\|port>` | remote-client | 回收 worker | ✅ 已实现 |
| `/open <device> <dir>` | remote-client | 一步式连设备 → spawn → 重连 | ⏳ 待 dsh-relay 实现 |
| `/fleet …` | fleet-client | 列表 / 派发 / 取消 | ✅ 已实现 |
| `/device <id>` | fleet-client | 会话级当前设备绑定 | ⏳ 待 dsh-relay 实现 |

## Agent presets (liangshen-bash)

`presets/liangshen-bash/` keeps the liangshen preset **verbatim** (Minimal
persona with `includeRuntimeContext: false`, `instruction-hint`, `skill-search`)
and adds only two behaviors (design: `docs/liangshen-bash-preset-design.md`):

1. **Round-2+ bash privilege swap** — `phase-swap-bash.mjs` shadows the shared
   persistent bash with the sandboxed `dsh-tool-bash` (per-agent scope layer),
   re-adding `sandbox_permissions`/`justification` escalation after anchoring.
2. **Explicit round-2 AGENTS.md injection** — an `dsh-agent-instructions` row
   (the host layer already provides this source, so the row makes the intent
   explicit and self-contained).

Known tradeoff: with `includeRuntimeContext: false` the model sees the
`sandbox_permissions` schema but not the current file-policy snapshot.

| File | Purpose |
|---|---|
| `agent.cordis.yml` | Preset composition (liangshen base + 2 rows; deployed to `~/.dsh/.agent-presets/liangshen-bash/`) |
| `preset.yml` | Display name/description for `/preset` |
| `phase-swap-bash.mjs` | The swap plugin (per-agent shadow) |
| `phase-swap-bash.test.mjs` | Unit tests (node --test) |
| `smoke-boot.mjs` / `smoke-driver.mjs` | No-LLM composition smoke (round-1 catalog, round-2 swap+injection) |

Use: `CC_TUI_PRESET=liangshen-bash dsh --profile tui` then `/new`.

## Tested

Boot, fullscreen takeover, prompt submit, streaming assistant rendering, reasoning (dim), injected-context dimming, error cards, status line, `/help` `/clear` `/exit`, clean exit (code 0). Approval dialogs, question panels, and tool cards are wired to the documented service APIs but need a tool-capable model route to exercise end to end.
