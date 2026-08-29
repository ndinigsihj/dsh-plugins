# dsh-tui（第三方） × DeepSeek Harness rc.8 — 能力对照与上游适配现状

> 目标：评估 `@deepseek-harness-tui/dsh-tui`（**第三方** TUI 包，`endless-tui` profile 曾装 **0.8.4**，升级目标 **0.8.5**）能否发挥 [DeepSeek Harness v0.1.0-rc.8](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.8) 的新能力，以及该第三方 dsh-tui 仓库的适配进展。
>
> **术语**：本文「官方」仅指 dsh（DeepSeek Harness）本身；`@deepseek-harness-tui/dsh-tui` 是第三方包，现仅作自研 TUI 的功能参考。`endless-tui` profile 已弃用，本文属于历史评估。
>
> 全部结论来自一手证据：npm 发布的 rc.8 包 + `@deepseek-harness-tui/dsh-tui@0.8.5` 编译产物（`lib/types/*.js`）+ GitHub API（dsh-tui 上游 release notes、issue/PR、main 分支源码）。证据行标注了来源。
>
> 关联文档：[`rewind-file-restore-plugin.md`](rewind-file-restore-plugin.md)（rewind 文件回撤插件方案，已在实现）。

---

## 1. 结论先行

| 维度 | 结论 |
|---|---|
| dsh-tui 0.8.5 能否发挥 rc.8 全部新能力 | 🟡 **部分**：多模态"聊天带图 + @文件"✅；`@会话`引用、`/goal`/`/plan` 带图 ❌；Codex/Claude 子代理只有列表无管理 UI；Windows PTY 无 TUI 面板 |
| 升级到 rc.8 是否破坏现有使用 | 🟢 不破坏：peer 范围兼容、契约校验只警告不硬失败（见 §4） |
| 第三方 dsh-tui 是否有 rc.8 适配 | ❌ **没有**：契约仍是 rc.7 单线，无 issue/PR/commit 提及 rc.8（见 §5） |
| 建议 | 🟢 可升；可接受 ~23 行启动 drift 警告；审批面板 dsh-tui PR #383 未合，当时本地 approval-tui（已随 endless-tui 弃用删除）已覆盖 |

---

## 2. rc.8 新能力速览（官方 release notes 原文提取）

来源：GitHub release `dsh-v0.1.0-rc.8`（2026-08-19，`prerelease: true`）。

### 新增功能
1. **多模态增强**：DeepSeek 模型适配器支持配置启用**原生图片请求**；`/goal`、`/plan` 等命令可接收**图文输入**；`@` 菜单支持**引用文件和会话**。
2. **Claude Code / Codex 子代理**：均可作为 Profile Bundle 按需安装；Codex 额外支持**非交互权限模式**和**多个命名实例**。
3. **Windows PTY 持久 PowerShell 会话**：并在此后的 Minimal 预设默认启用。

### 修复 / 优化（与本评估相关）
- 取消流式生成后，已展示的回复前缀带入后续提问和 fork（对应 dsh-session `turn/end` 新增 `interrupted?: true`）。
- `web_search` 支持并发查询；子代理 `reportDelivery` 及时反馈并唤醒父任务。
- 大历史会话的 fork 性能大幅改善。
- SQLite 后端读写/fork 性能提升但**存储格式不兼容**（`endless-tui` 用的是 JSONL，不受影响，见 dsh-endless 侧评估）。

---

## 3. rc.8 新能力 × dsh-tui 0.8.5 能力对照

证据来源：`@deepseek-harness-tui/dsh-tui@0.8.5` 发布包编译产物（下文路径相对 `lib/types/`）。

| rc.8 新能力 | TUI 能否发挥 | 证据 / 说明 |
|---|---|---|
| 聊天带图（原生图片请求） | ✅ **能** | `Ctrl+V` 粘贴 → `channel.stageImage()`（`dsh-adapter/channel.js` `stageImage`）→ 输入框 `[Image #N]` → 提交时 `expandMentions()` 把 token 展开成 `{type:'image', attachment}` block（`dsh-adapter/channel.js` `expandMentions`） |
| `@` 引用文件 | ✅ **能** | `FileSuggestions` + `utils/mentions.js`（只解析路径）；展开成 `<attached-file>`/`<attached-directory>` 文本块或图片块 |
| `@` 引用**会话** | ❌ **不能** | `utils/mentions.js` 只有 `MentionToken`（路径），**无 session 引用类型**；`@` 菜单无会话条目 |
| `/goal` `/plan` **图文输入** | ❌ **不能** | 命令走 `runCommand` → default → `runExternalCommand` → `executeRegistryCommand` → **`commandService.execute(agent, '/goal [Image #1]', ...)`**：`[Image #N]` 当纯文本传，**不经 `expandMentions`，不展开成 image block** |
| Codex / Claude Code 子代理 | 🟡 **部分** | `/agents` 能列子代理（`listSubagents` → `subagents.listChildren`）；**无命名实例 / 非交互权限模式的管理 UI**（那是 profile 层配置） |
| Windows PTY 持久 PowerShell | 🔴 **基本不能** | TUI 是纯聊天前门，**无内嵌 PTY 面板**；`tool_pwsh` 只以工具卡片呈现 |
| web_search 并发 / 子代理唤醒父任务 | 🟢 **透明生效** | dsh 侧行为，TUI 经工具卡片/活动行/会话事件天然呈现，无需改动 |
| 大历史 fork 性能 | 🟢 **自动受益** | dsh 侧优化，TUI 无感 |

### 3.1 关键机制说明（为什么命令路径不带图）

普通消息路径：`submit()` → `deliverUserText()` → `expandMentions()` → `createUserMessage({content: blocks})` → `agent.followup/steer()`。**带图**。

命令路径：`PromptInput` 提交时 `text.startsWith('/')` → `onRunCommand(name, rawInput)` → `runCommand` switch（`/goal` `/plan` 不在内置 case）→ default → `runExternalCommand` → `executeRegistryCommand` → `commandService.execute(agent, '/goal [Image #1]', ...)`。**纯文本，不带图**。

> 结论：rc.8 让 **dsh 侧** `/goal` `/plan` 能接收图文，但 **TUI 的命令提交路径没把图喂进去**。这是 TUI 本体的分发点缺口，按"优先插件/不改本体"的偏好，**难以用薄插件补**（它不是裸事件/标准服务接缝，是 channel 内部逻辑）；要么等 dsh-tui 上游，要么改 dsh-tui 本体（PR）或自己 fork。

---

## 4. 升级到 rc.8 的兼容性（已实证）

### 4.1 peer 依赖兼容
- dsh-tui 0.8.5 全部 23 个 blessed 包 peerDeps 为 `^0.1.0-rc.7`。
- semver 实测：`0.1.0-rc.8` 满足 `^0.1.0-rc.7`（`>=0.1.0-rc.7 <0.2.0`）。**无 peer 冲突**。

### 4.2 契约校验行为（只警告，不硬失败）
- 0.8.5 契约：`lib/types/dsh-adapter/contract.js` `UPSTREAM_VALIDATED_VERSION = '0.1.0-rc.7'`，逐包 `rcNumber(installed) === 7`。
- 装 rc.8 后所有 blessed 包 `8 ≠ 7` → 启动 `console.warn("[dsh-tui] upstream drift: ...")` **约 23 行**（仅警告）。
- dsh-tui 的 CI `verify:upstream-contract` 会挂（其自己声明的门禁行为）。

### 4.3 端到端 API 面（对 endless 栈）
已独立核实（见 dsh-endless 侧文档 §2）：消费的 15 个包只有 `dsh-llm`（纯新增）+ `dsh-session`（纯新增）类型变化，其余 13 个 0 变化。

---

## 5. dsh-tui 仓库（第三方）适配现状

来源：GitHub API（`ccch1mneyyy/dsh-TUI`，main 分支）。

| 检查项 | 结果 |
|---|---|
| 仓库活跃度 | ✅ 2026-08-20 仍在 push，2.1k stars |
| **rc.8 适配** | ❌ **零**：无 open PR、无 issue、无 commit 提及 rc.8 |
| 契约基线 | main 与 0.8.5 都是 `UPSTREAM_VALIDATED_VERSION = '0.1.0-rc.7'`（**单线**） |
| peer 范围 | main 仍是 23 个包全 `^0.1.0-rc.7` |
| 相关 PR #383（**open，未合并**） | "优化权限审批面板显示"：write/edit 审批弹窗从原始 JSON 改成**文件路径 + diff 预览**（write 绿色 `+`、edit 红绿 diff、8 行预览）。**与当时本地 approval-tui（已删除）同领域，dsh-tui 在推进** |
| 相关 PR #330（**open**） | `/agents` 支持进入只读子代理会话（对应子代理管理方向） |
| 相关 PR #354（**closed，merged: False**） | "支持 0.1.0-rc.6 核心线" **未合并**：dsh-tui 连 rc.6 双线都没进 main，更谈不上 rc.8 |

> 说明：#354 我先前误报为"已合并"，核实 PR API 为 `merged: False`（分支 `feat/rc6-compat` 被关未合）。dsh-tui 目前**只认 rc.7 单线**。

---

## 6. 升级决策建议

### 6.1 升不升
**可以升**。原因：peer 兼容、API 不破坏、契约只警告。收益：多模态聊天带图、web_search 并发、fork 性能、SQLite 不是你的后端。

### 6.2 可执行动作（历史建议；`endless-tui` 已弃用，仅作存档）
```bash
cd ~/.dsh/profiles/endless-tui
# 1. dsh-base → rc.8（package.json 或 pnpm up 指定）
pnpm up "@deepseek-ai/dsh-base@^0.1.0-rc.8"
# 2. dsh-tui → 0.8.5（顺手）
pnpm up "@deepseek-harness-tui/dsh-tui@^0.8.5"
```
升级前：备份 `node_modules`（延续 `node_modules.bak-*` 习惯）；确认 `~/.endless/endless.db` 备份（虽不受影响，稳妥起见）。

### 6.3 风险清单
| 风险 | 影响 | 处置 |
|---|---|---|
| ~23 行启动 drift 警告 | 无害，仅噪音 | 接受，或等 dsh-tui 上游 rc.8 适配，或 fork `contract.ts`（偏离 dsh-tui 校验，需自担验证） |
| `dsh-llm` retry 2→5 | distill 失败重试变多，最长等待变长 | endless-distill 有 `timeoutMs:30s` + `AbortSignal` 兜底，可接受 |
| 审批面板 dsh-tui PR #383 未合 | dsh-tui 的 write/edit 可读化尚未发布 | 当时本地 approval-tui（已删除）已覆盖工具+原因显示；如需 diff 预览可跟进 PR #383 |

---

## 7. 相关文档
- [`rewind-file-restore-plugin.md`](rewind-file-restore-plugin.md)：rewind 文件回撤插件方案（独立 `/rewind` 命令插件，绕开 DecisionEvents）。
- `~/dev/dsh-endless/docs/rc8-upgrade-assessment.md`：dsh-endless × rc.8 升级评估 + 多模态记忆设计草案。
