# im-dsh-tui

Interactive terminal front door for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): a Cordis plugin bundle that mounts the `@earendil-works/pi-tui` renderer **inside the dsh process**, consuming the in-process services directly (`agent.send/steer`, `session/event` feed, `userQuestions`, `approval`, `commands`).

This is a faithful reconstruction of the TUI package DeepSeek removed before the public release (`2026-08-04-remove-tui-package`), built from the archived design notes. See `ARCHITECTURE.md` for the design.

## How it works

`dsh` is a launcher that boots a profile — an ordered stack of plugin-bundle patch layers. `im-dsh-tui` is a bundle (`dsh.bundle.patch`), mounted over `dsh-base`:

```
dsh --profile tui
└─ ~/.dsh/profiles/tui/          (package.json bundles + cordis.patch.yml)
   ├─ @deepseek-ai/dsh-base       core: agent, session, llm, sandbox, approval, tools
   ├─ im-dsh-tui/startup             parses this app's CLI, provides `tuiStartup`
   └─ im-dsh-tui                     owns the terminal; consumes in-process services
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
      name: '<repo>/lib/startup.ts'      # 换成当前 checkout 的绝对路径
    - id: tui-runner
      name: '<repo>/lib/index.ts'
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
| `/fleet …` | fleet-client | 列表 / 派发 / 取消（hub controller 侧） | ✅ 已实现 |
| `/device <id>` | fleet-client | 会话级当前设备绑定（TUI alias `/attach`） | ✅ 已实现 |
| `/bg <prompt>` | attach-client | worker 模式发起后台任务 | ✅ 已实现 |
| `/background <prompt>` | attach-client | alias of `/bg` | ✅ 已实现 |
| `/task <id>` | attach-client | 查询后台任务状态 | ✅ 已实现 |
| `/tasks` | attach-client | 列出最近后台任务 | ✅ 已实现 |

## Agent preset (minimal-plus)

`presets/minimal-plus/` 是当前唯一自研 preset，stable（`tui`）与 dev（`tui-dev`）共用同一份组合。
2026-09-22 宿主统一到 0.1.5-rc.1/rc.2 后，原 `minimal-plus` 收敛回 `minimal-plus`：
ADR-0002 的「dev/stable 宿主不同代、必须分叉」前提已消失。

- persona 使用 0.1.5 宿主的 `prefix` 正文键（旧 `text` 键在 rc.1/rc.2 会被 schema 拒）。
- 按 ADR-0003 只声明与 rc.1 `dsh-base` 的差异：不重复 base 已有的挂载行，保留恒禁的
  `tool-bash` 与承载官方子代理模型选择的 `tool-subagent`（`modelSelectionSettings: true`）。
- 两个行为：`phase-swap-bash.mjs` 二轮 bash 提权（`sandbox_permissions`）；二轮
  `agent-instructions` 注入由宿主 base 行提供。
- `modelSelectionSettings` 需要宿主作用域挂载 `subagent-model-selection-settings`：**凡是
  可能挂载本 preset 的 profile 都必须有这一行**，否则挂载即失败（`tool-subagent:
  modelSelectionSettings requires … in the Host scope`）。当前部署：`tui` / `tui-dev`
  enabled + 2 条允许路由，`worker` / `headless` 已挂但 `enabled: false`（保持固定路由口径）。
  维护与探针见 `docs/subagent-model-selection.md`。
- 部署：`scripts/sync-agent-presets.sh`（无参即同步 `minimal-plus`）；冷启动加载的是
  `~/.dsh/.agent-presets/minimal-plus/` 副本，preset 改完必须重新同步并核 sha。
- Use: `CC_TUI_PRESET=minimal-plus dsh --profile tui` then `/new`.

## Regression gate（回归闸门）

单一入口 `scripts/regression-gate.sh`（施工图：`docs/regression-test-automation-plan.md`）。闸门的输入全部取自
仓库资产 + 隔离临时 home（`DSH_HOME`/`HOME` 都指过去），真实 `~/.dsh` 只读；**闸门不自动同步部署位**。

```bash
scripts/regression-gate.sh --tier 0,1                              # 日常：静态层 + 零 LLM 组合层
scripts/regression-gate.sh --tier 0,1,2 --skip-deployment-check    # 部署位缺席（CI 口径）
scripts/regression-gate.sh --tier 0,1,2 --composition real         # 交付前：真实 tui-dev 组合
scripts/regression-gate.sh --tier 3                                # 按需：真实模型层（需凭据，永不进 release/CI）
scripts/tui-pty-smoke.sh                                           # 按需：独立 PTY 冒烟（T4b，不进 release）
```

退出码：全过 `0`；任一断言失败 `1`；环境前置不满足 `2`（宿主或会话格式与 `gates/manifest.json` 不符、
组合渲染缺依赖、`real` 缺相邻 `../dsh-relay`/`../dsh-endless`、T3 版本/基线来源不符或真实 settings 缺失）。

| 层 | 内容 | 说明 |
|---|---|---|
| T0 | `tsc --noEmit` + `npm test` | 静态层；工作流触发路径存在性断言与进程内 app 层（T4a，`lib/app.test.ts`，注入假 Terminal）随 `npm test` 执行 |
| T1 | 零 LLM 组合层 | 组合导出、逐 loader id 唯一、反 stub 劫持、首轮锚定/二轮提升冒烟、降级 fail-open、seeded 预览探针、部署位 sha、宿主钉版、真实 home 零写入 |
| T2 | 假模型行为层 | `gates/stub/**` 脚本化 provider：首请求路由、12-2 沙箱 bash 红绿、compaction 回退、V3 恢复路由、委派策略 |
| T3 | 真实模型层（按需） | M4 行为基线 + 模型选择/允许路由探针；需真实 `~/.dsh/settings.yaml`，永不进 release/CI |
| T4b | PTY 冒烟（按需） | `scripts/tui-pty-smoke.sh`，真 PTY + stub provider；独立入口，不进 release（D8） |

**两种豁免**（默认拒绝；被豁免时报告写 `exemptions[]` 并在 stdout 打醒目警告，绝不静默变绿）：

- `--allow-stale-deployment`：只豁免「仓库 preset ↔ `~/.dsh/.agent-presets/<preset>` sha 一致」这一层。
  豁免状态下冒烟/探针验的是**旧副本**，不代表仓库当前内容。
- `--skip-deployment-check`：只用于部署位**不存在**（CI/隔离环境），报告记 `reason: "absent"`。
- release 路径（`scripts/release.sh`）永不传任何豁免参数。

**报告**：默认 `experiments/regression-gate/results-<UTC 日期>.json`（`--json` 可改）；
T3 产物另按 `experiments/regression-gate/t3-<UTC 时间戳>/` 归档，跨轮次不覆盖。

**仓库绿灯 ≠ 部署位生效**：`gate` 组合把仓库资产渲染进隔离临时 home 验证，而运行中的 TUI 加载的是
`~/.dsh/.agent-presets/<preset>` 副本。交付前必须显式执行 `scripts/sync-agent-presets.sh <preset>` 同步部署位，
再用 `--composition real` 跑真实 `tui-dev` 组合；序列：同步 → `--tier 0,1,2 --composition real` 全绿 → T3 按需 → 人工签收。

**边界**：闸门面向 `tui-dev` / `minimal-plus` / dev 侧脚本；stable `tui` 组合本身不在闸门内——
`--composition real` 验的是 `tui-dev` 渲染副本，改 stable profile / stable 工作树必须在 stable 运行时手验
（本次收敛已用隔离 HOME + 真 PTY 实跑验证）。

**CI**：`.github/workflows/regression-gate.yml` 在托管 macOS runner 上零密钥跑 T0/T1/T2（宿主从公共 registry
按 `gates/manifest.json` 的版本安装），部署位按「缺席」记账；T3 与 T4b 不进 CI。Windows 侧另见
`.github/workflows/custom-bash-win-smoke.yml`（触发路径 = `presets/minimal-plus/**`，脚本 preset 路径由
`CUSTOM_BASH_PRESET_ROOT` 参数化）。

两个工作流的触发路径由 T0 常驻断言校验（`gates/workflow-triggers.mjs`，随 `npm test`）：逐事件检查
`paths` / `paths-ignore` 的每条模式——目录 glob 断言其 base 目录存在、精确路径断言文件存在，
防止再次出现「触发路径指向已删除目录 → 工作流永不触发」的静默失效。

## Tested

Boot, fullscreen takeover, prompt submit, streaming assistant rendering, reasoning (dim), injected-context dimming, error cards, status line, `/help` `/clear` `/exit`, clean exit (code 0). Approval dialogs, question panels, and tool cards are wired to the documented service APIs but need a tool-capable model route to exercise end to end.
