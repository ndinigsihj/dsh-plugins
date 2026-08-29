# dsh v0.1.2-alpha.1 对自研 TUI 的影响分析

> 日期：2026-08-29
> 范围：仅分析与结论，不包含任何代码修改。相关 release：
> [deepseek-harness Release dsh-v0.1.2-alpha.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.1)

## 1. 结论先行

| 问题 | 结论 |
| --- | --- |
| 自研 TUI 是否必须为 v0.1.2-alpha.1 改代码？ | **不必须**。TUI 使用的进程内服务 seam（agents / sessions / commands / sessionTitle / approval / llm / agentPresets）在 v0.1.2-alpha.1 中均保持兼容，未发现运行时破坏。 |
| 升级 host 到 v0.1.2-alpha.1 时 profile 是否要动？ | **要**，但只是配置清理：三个 profile（tui / tui-dev / tui-central）的 patch 中有 4 个行会被新 `dsh-base` 重复挂载，另有 1 处 `agent-presets` roots 指向已删除的旧 shipped preset 目录。 |
| 有哪些值得新增的 TUI 功能？ | 可选的只有 2 项较有价值：每轮 token 用量明细、子代理模型/推理力度选择。都不是必需，建议按后续需求再定。 |
| 现在能直接升级吗？ | 暂不能走 `npm install`：公开 npm 上 `@deepseek-ai/dsh` 仍是 `0.1.1-rc.2`（latest/next 都不是 0.1.2-alpha.1），`@deepseek-ai/dsh-app-boot` 同样没有该版本。v0.1.2-alpha.1 目前只有 GitHub release tag，升级需要源码构建或内部源。 |

## 2. 版本状态

| 渠道 | 状态 |
| --- | --- |
| GitHub Release | `dsh-v0.1.2-alpha.1`，2026-08-27 发布，ahead 1079 commits |
| npm `@deepseek-ai/dsh` | `latest`/`next` 均为 `0.1.1-rc.2`，无 0.1.2-alpha.1 |
| npm `@deepseek-ai/dsh-app-boot` | `latest` 0.1.0-rc.6 / `next` 0.1.1-rc.2，无 0.1.2-alpha.1 |
| npmmirror | 同公开 npm，无 0.1.2-alpha.1 |
| 本地当前安装 | `~/.dsh/profiles/node_modules/@deepseek-ai/*` 均为 0.1.1-rc.2 |

因此本分析基于 GitHub tag 源码对比（`dsh-v0.1.1-rc.2...dsh-v0.1.2-alpha.1`）。

## 3. TUI 依赖 seam 兼容性

TUI 不 import 官方 web UI 的 `dsh-client-runtime`，只消费宿主进程内的标准服务；逐项对照如下。

| TUI 使用的 seam / API | TUI 用途 | v0.1.2 变化 | 影响 |
| --- | --- | --- | --- |
| `agents.create / resume` | 建会话、resume、`/model` fork 重建 | `CreateAgentOptions`/`ResumeAgentOptions` 结构不变；`AgentOptions` 新增 `reasoningEffort` | ✅ 兼容（新字段为增量） |
| `sessions.fork / flush` | `/rewind`、`/model` 降级路径、落盘 | `SessionStore` 签名不变（`fork(source, boundary?, childId?)`、`flush(session)`） | ✅ 兼容 |
| `commands.register / execute / list` | `/rename` 等插件命令、`runCommand` 委托 | 仅内部 `randomUUID` 换成工具包，公开 API 不变 | ✅ 兼容 |
| `sessionTitle.rename` | `/rename` | 无变化 | ✅ 兼容 |
| `approval/request` | 内建审批卡 | 事件载荷重构为 `ApprovalRequestEvent`（`this` 从 `Scoped<ApprovalService>` 改为 `Scoped<Agent>`），运行时字段 `toolName/reason/signal` 不变 | ✅ 兼容（升级后可按新类型补标注，非必须） |
| `llm.createUserMessage / resolveModelInfo` | 发消息、`/model` 元数据 | `createUserMessage` 无变化；`resolveModelInfo` 签名不变 | ✅ 兼容 |
| `SessionEvent`（dsh-session/types） | transcript 渲染、todos 监听 | `CallId`→`ToolCallId` 更名；`todo/write` 类型声明移到 `@deepseek-ai/dsh-tool-todo`（事件仍在日志里出现）；`SessionEvent.ignorable` 字段移除 | ✅ 兼容（TUI 未 import 被改类型，运行时读 `todo/write` 不变） |
| `dsh-tools/presentation` | 工具卡片 | `presentation.ts` 无变化（`code-mode`→`ptc` 的内部更名不涉及该导出） | ✅ 兼容 |
| `agentPresets`（结构服务） | `/preset`、preset 组合 | 新增 `includeShippedRoot` 与健康检查 `broken`；`list/resolve/mount/recompose/composedPreset` 保持 | ✅ 兼容；TUI 已支持展示 `broken` 标记 |
| `dsh-cmdline.parseCmdline` | `tui-startup` 启动参数 | 签名不变；新增 `appReady` / `exitOnStdinEnd`（launcher 侧） | ✅ 兼容 |
| `dsh-app-boot / dsh CLI` | `dsh --profile tui` 启动 | 统一 `dsh` Profile 启动；custom profile 默认 `patchReload: live`；patch 中相对插件路径自动锚定；shipped preset 移入 `dsh-agent-presets` | ⚠️ 基本兼容，但 profile patch 有清理点（见 §4） |

## 4. 升级 host 时需要清理的 profile 配置

v0.1.2 的 `dsh-base` bundle 新增了 storage 栈与 projection cache 行；而我们的三个 profile patch 在旧版因为 base 没有这些行而手动 `insert`。升级后重复 `insert` 会让同一服务挂两遍（storage / storage-json / storage-domain / session-projection-cache 各两份），可能造成服务冲突或双重写。

同时，v0.1.2 把 shipped agent presets 从 `@deepseek-ai/dsh/config/agent-presets/` 移进 `@deepseek-ai/dsh-agent-presets` 内置的 `SHIPPED_PRESET_ROOT`，旧目录已被移除；我们 patch 里 `agent-presets` 的 `roots` 仍指向旧目录，在新版本下变成 ENOENT 空根。

| Profile | 需移除的重复 insert 行 | 需处理的 agent-presets roots |
| --- | --- | --- |
| `~/.dsh/profiles/tui/cordis.patch.yml` | `storage`、`storage-json`、`storage-domain`、`session-projection-cache` | 删除 `roots`（保留 `default: standard`），`includeShippedRoot` 默认 true 会自动带 shipped presets |
| `~/.dsh/profiles/tui-dev/cordis.patch.yml` | 同上 | 同上 |
| `~/.dsh/profiles/tui-central/cordis.patch.yml` | 同上 | 同上 |

说明：

- `storage-json` 的 root：base 新配置为 `dshHomePath('storages')`，与 tui-dev 现有 `/Users/vito/.dsh/storages` 等价，删除重复行后行为一致。
- `session-projection-cache`：base 默认 `writeEveryEvents: 200 / writeIntervalMs: 5000`，我们旧改为 400/30000。若想保留旧频率，应把该行从 `insert` 改成**配置 patch**（`id: session-projection-cache` + `config`），而不是继续 insert。注意配置 patch 只在 v0.1.2 base 上有目标行，旧版上会 warn 跳过。
- 这些修改应在 host 真正切到 v0.1.2-alpha.1 时做；当前仍在 0.1.1-rc.2 上时不应改（否则旧 base 会缺行）。

## 5. 可选新增功能（按性价比排序）

| 候选 | 说明 | 建议 |
| --- | --- | --- |
| 每轮 token 用量明细 | 对应 release「每个已完成回答后可展开查看精确 token 用量」；TUI 已有 `/cost`（累计）与 `/tokens`（当前窗口），缺的是按 turn 的明细展示 | 中收益，可在 `/cost` 或事件流里补 per-turn 行；非必需 |
| 子代理模型/推理力度选择 | release 支持启动子代理时指定 provider/model/effort；当前 TUI 只展示子代理，不手动起子代理 | 低优先，等有实际手动起子代理需求再做 |
| 用 `model/selection` 事件跟踪当前模型 | v0.1.2 事件词汇新增 `model/selection`；TUI 现在靠 `request/context` + relayClient 已能工作 | 低优先，暂不依赖新事件 |

## 6. 暂不跟进（web UI 为主）

- 会话流折叠、宽度拖拽、字号、Markdown 表格缩放、`/` `@` 菜单图标
- 图片上传即时显示、压缩策略、轨迹图片
- 提问卡片草稿保留、消息排队、回合导航
- PTC Mode（原 Code Mode）、ACP、headless stderr 进度
- ApiProxy 移除（TUI 不走 ApiProxy）、`@Remote` 网关（TUI 进程内）
- 遥测/session-log 增量上传、plugin package inventory、web_fetch 默认开启
- 持久 Bash/PowerShell 修复（dsh 核心修复，TUI 无需改）

## 7. 升级后回归建议

当拿到 v0.1.2-alpha.1 可安装版本后：

1. 先改一个 profile（建议 `tui-dev`）做 §4 清理；
2. 启动 `dsh --profile tui-dev`，确认无 duplicate storage / service conflict 日志；
3. 回归：`/model` 热切换、`/effort`、`/rename`、`/rewind`、审批卡、`/preset`（含 broken 标记）、`/sessions` `/resume`；
4. 通过后再同步 `tui` / `tui-central`（stable 工作区未动，等下次 release 一并带上）。