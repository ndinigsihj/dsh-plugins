# B1 取证：Agent Team 组合期确认（0.1.7-rc.1）

> 日期：2026-09-23　执行：临时前缀安装，未触碰真实 `~/.dsh` / profile / 部署位
> 上游版本：`@deepseek-ai/dsh@0.1.7-rc.1`（npm 精确版本，非 `next` 浮动）
> 关联：`docs/dsh-v0.1.7-rc.1-upgrade-plan.md` §5.0、§5.3 票 B1

## 1. 方法（可复现）

```sh
ROOT=/tmp/dsh-b1-<ts>
mkdir -p "$ROOT/home" "$ROOT/cli" && cd "$ROOT/cli"
npm init -y && npm i --no-audit --no-fund --no-package-lock --cache "$ROOT/npm-cache" @deepseek-ai/dsh@0.1.7-rc.1
# 两个最小 profile，node_modules 用 symlink 复用 CLI 安装树（避免二次下载）
#   $ROOT/home/profiles/b1      bundles: [@deepseek-ai/dsh-base]
#   $ROOT/home/profiles/b1team  bundles: [@deepseek-ai/dsh-base, @deepseek-ai/dsh-experimental-agent-team-profile]
DSH_HOME="$ROOT/home" node "$ROOT/cli/node_modules/@deepseek-ai/dsh/lib/bin.js" --profile b1     --dump-config > 01-dump-base.yml
DSH_HOME="$ROOT/home" node "$ROOT/cli/node_modules/@deepseek-ai/dsh/lib/bin.js" --profile b1team --dump-config > 01-dump-team.yml
```

两份 dump 均 exit 0。`b1` 92 个 loader id、`b1team` 95 个，**递归计数均为 1（无重复 id）**。

## 2. 结论

| 项 | 结果 |
| --- | --- |
| 是否随安装默认启用 | **否**。`dsh-app-boot/lib/index.js` 定义 `OPTIONAL_BUNDLES = ["@deepseek-ai/dsh-experimental-voice-input-bundle", "@deepseek-ai/dsh-experimental-agent-team-profile"]`，注释："each a runtime dependency of the installation that declares `dsh.bundle.patch`, selected by no shipped template, and offered switched off by the plugin manager"。`PROFILE_TEMPLATES` 只有 `acp` / `web` / `headless` / `sdk` / `sdk-minimal`，均不含 Team |
| 启用方式 | 插件页开关，或 `dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-agent-team-profile` |
| 组合增量 | 仅 3 行：`agent-team`、`tool-agent-team`、`ui-agent-team` |
| 被禁用的行 | `tool-subagent-control`、`tool-subagent-list-agents`、`tool-subagent`、`tool-subagent-fork` 四行在 team 树中全部 `disabled: true`（**组合期禁用**，不是运行期拒绝） |
| Team 配置 | `maxMembers: 8`、`maxTasks: 256`、`maxPendingMessagesPerMember: 64`、`maxMessageBytes: 65536`、`disposalTimeoutMs: 5000`；`tool-agent-team` 为 `freshProvider: spawn` / `forkProvider: fork` |
| 队友上限口径 | 服务默认 `DEFAULT_MAX_MEMBERS = 16`，但**组合包 patch 显式覆盖为 8**；release notes 的"8 → 16"指服务默认 |
| Team 工具面 | `spawn_teammate` / `send_message` / `list_agents` / `wait_agent` / `interrupt_agent` / `team_task_create` / `team_task_list` / `team_task_get` / `team_task_update`（9 个，注册在确切 Agent 作用域），另加 `team:policy` 系统提示段 |
| 模型路由 | `spawn_teammate` 参数仅 `name` / `description` / `prompt` / `context(fresh\|fork)`，**无 provider / model / reasoning_effort** |

### 2.1 disabled 对照（两份 dump 实测）

| loader id | base | team |
| --- | --- | --- |
| `tool-subagent-control` | enabled | disabled |
| `tool-subagent-list-agents` | enabled | disabled |
| `tool-subagent` | enabled | disabled |
| `tool-subagent-fork` | enabled | disabled |
| `agent-team` | — | enabled |
| `tool-agent-team` | — | enabled |
| `ui-agent-team` | — | enabled |

## 3. 关键源码摘录

`agent-team-profile/cordis.patch.yml`：

```yaml
# Experimental Agent Teams profile layer. Apply after dsh-base so these replacements
# keep direct delegation and coordination on the Team tools.
- id: tool-subagent-control
  disabled: true
- id: tool-subagent-list-agents
  disabled: true
- id: tool-subagent
  disabled: true
- id: tool-subagent-fork
  disabled: true
- insert:
    - id: agent-team
      name: '@deepseek-ai/dsh-experimental-agent-team'
      config: { maxMembers: 8, maxTasks: 256, maxPendingMessagesPerMember: 64, maxMessageBytes: 65536, disposalTimeoutMs: 5000 }
    - id: tool-agent-team
      name: '@deepseek-ai/dsh-experimental-tool-agent-team'
      config: { freshProvider: spawn, forkProvider: fork }
    - id: ui-agent-team
      name: '@deepseek-ai/dsh-experimental-client-ui-agent-team'
```

组合包 README 自陈的限制（与本仓库直接相关）：

- **共享 checkout**：所有 teammate 观察同一工作目录，无 worktree 隔离、无文件系统锁。
- **预设内的子代理控件**：*Web 预设仍可在预设作用域挂载 continuable Subagent 控件；顶层组合包不会替换这些注册。*
- Workflow 仍用 base 的 `spawn` provider 创建 fresh 一次性子代理。

## 4. 顺带核实：HMR 仍需要 `--expose-internals`

`@deepseek-ai/dsh-hmr@0.1.7-rc.1`（取代 `@deepseek-ai/cordis-plugin-hmr`）构造函数内：

```js
if (!this.ctx.loader.internal) throw new Error("--expose-internals is required for HMR service");
```

→ `~/.dsh/bin/dsh` 的 wrapper 保持 `node --expose-internals` 不变。

## 5. 未决项（进入 B2 前必须实测）

本仓库 `presets/minimal-plus/agent.cordis.yml:163-193` 在 **preset 层**挂 `tool-subagent`（`modelSelectionSettings: true`）。上游明确"顶层组合包不会替换预设作用域的注册"，因此 profile 级禁用与 preset 级挂载**可能并存**。`--dump-config` 只反映 profile 层，看不到 per-agent 的 preset 挂载 → 需要一次真实组合冒烟（见 `docs/tickets/dsh-v0.1.7-rc.1-upgrade/` 后续票据）。

## 6. 证据文件

| 文件 | sha256 |
| --- | --- |
| `01-dump-base.yml` | `f3fd7e7a3c116897237d9dd6e62ca5193ddf0c7838c91cc467c73ff7eb2423b6` |
| `01-dump-team.yml` | `83b8066728994e35b271acd67139c5a6317a69f61c72608f5fd6247eda9f3d60` |

原始临时目录：`/tmp/dsh-b1-20260923-224232`（含 CLI 安装树，约 492M；未纳入版本库）。
