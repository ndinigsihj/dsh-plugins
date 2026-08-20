# liangshen-plus 手工会话冒烟步骤（M3 前置验证）

> 目标：在真实 TUI 里肉眼验证三合一组合 preset 的四个检查点——
> ① 首轮锚定对（目录 = {bash, str_replace_editor}）；② 首轮零注入；
> ③ promotion 后二轮完整目录；④ 二轮 AGENTS.md 注入 + bash 沙箱提权。
>
> M2（2026-08-20）已用 headless 组合 + assemble/pre-step 瀑布完成等价验证
> （见设计文档 §6.1）；本节是真实 LLM 会话的人工复核。

## 0. 前置检查

| 检查 | 命令 | 期望 |
|---|---|---|
| preset 已部署 | `ls ~/.dsh/.agent-presets/liangshen-plus/` | `agent.cordis.yml` + `preset.yml` 存在 |
| preset 可发现 | `dsh --profile endless-tui --dump-config`（或 M2 冒烟） | 组合正常，无报错 |
| 单测绿（可选） | `cd ~/dev/dsh-tui && node --test presets/liangshen-plus/phase-swap-bash.test.mjs` | 7/7 通过 |

## 1. 启动（stderr 重定向，避免 TUI 吞错误）

```bash
cd /Users/vito/data/dev/dsh-tui
CC_TUI_PRESET=liangshen-plus dsh --profile endless-tui 2>/tmp/liangshen-plus-tui.err
```

- 若之前用别的 preset 开过会话：先 `/new` 开全新会话（promotion 状态按 session 记，
  旧会话可能已 promoted）。
- 若想确认当前 preset：TUI 标题栏/状态区应显示预设名，或 `/preset` 查看。
- 出错时看 `/tmp/liangshen-plus-tui.err`（本仓库调试偏好：stderr 落文件再读）。

## 2. 冒烟会话脚本（四步，对应四个检查点）

### 第 1 步：首轮目录 = 锚定对（检查点 ① + ②）

**发**：`你当前有哪些可用工具？请按名称完整列出。另外，你的上下文里有没有"工作区指令/AGENTS.md"摘要？`

**预期**：
- 工具清单**只有 2 个**：`bash` + `str_replace_editor`（无 read/grep/glob/write 等）。
- 对 AGENTS.md 的回答是「没有/未提供」（首轮注入被 tool-bootstrap 剥掉）。
- 若模型开始就出现 `read`/`grep` 等工具 → 锚定对未生效，**先停**，查 preset 是否
  真的被选中（`/preset`、stderr 文件）。

### 第 2 步：触发 promotion（首个 durable tool/call）

**发**：`用 bash 打印当前目录和 git 状态。`

**预期**：
- 模型调用 `bash`（persistent），输出正常。
- 这一步之后 promotion 生效（首个 durable tool/call）。

### 第 3 步：二轮目录 = 完整 + bash 提权（检查点 ③）

**发**：`再次列出你当前的所有可用工具，并说明 bash 工具的完整参数。`

**预期**：
- 工具清单明显变全（20+ 个：read/write/edit/grep/glob/subagent/todo_write/
  web_search 等完整 standard 面）。
- `bash` 的描述/参数应包含**沙箱与提权语义**（`sandbox_permissions` /
  `justification`、一次性提权说明、`run_in_background`）。
- 若清单仍只有 2 个 → swap/promotion 未生效，查 stderr 文件里
  `phase-swap-bash: swap ... failed` 警告。

### 第 4 步：二轮注入 + 提权实证（检查点 ④）

**发 A（注入）**：`你的系统提示词或上下文中现在有没有工作区指令（AGENTS.md/CLAUDE.md）摘要？大致讲了什么？`

**预期**：模型能复述工作区规则要点（如本仓库 AGENTS.md 的工具偏好/代码规范）——
二轮起 `dsh-agent-instructions` 注入恢复。

**发 B（提权）**：`读取 ~/.dsh/settings.yaml 并总结内容。`

**预期**：
- **TUI 弹出审批**（sandbox 提权请求：workspace-write → danger-full-access +
  justification），可批准/拒绝 → 证明二轮 bash 是**沙箱版**（persistent bash
  没有审批概念，全目录直通）。
- 拒绝后模型应收到 `[sandbox: ...]` 拒绝标记，不得绕过。

## 3. 判定汇总

| # | 检查点 | 操作 | 通过标准 |
|---|---|---|---|
| ① | 首轮锚定对 | 第 1 步 | 工具仅 `{bash, str_replace_editor}` |
| ② | 首轮零注入 | 第 1 步 | 无 AGENTS.md/CLAUDE.md 摘要 |
| ③ | 二轮完整目录 | 第 3 步 | 20+ 工具；bash 带提权参数描述 |
| ④ | 二轮注入 + 提权 | 第 4 步 | 能复述 AGENTS.md；读 ~/.dsh 触发审批弹窗 |

全部通过 → M3 冒烟通过，可进入 M4（§5 实验 A/B/C/D）。

## 4. 可选：子代理锚定验证（includeSubagents）

第 2 步后发：`spawn 一个子代理，让它报告自己有哪些工具。`

**预期**：子代理首轮同样只见 `{bash, str_replace_editor}`（includeSubagents: true，
全局 persistent bash 仍在）；子代理自己首个 tool/call 后才独立 swap 为沙箱。

## 5. 排障

| 现象 | 处置 |
|---|---|
| 首轮就有 read/grep | preset 未生效：`/preset` 确认选中 liangshen-plus；`2>` 文件看 boot 警告 |
| 二轮仍只有 2 工具 | 看 stderr：`phase-swap-bash: swap to sandboxed bash failed ...` → 按警告排查（缺 sandboxPolicy 等） |
| 二轮无审批弹窗 | 二轮 bash 可能仍是 persistent：第 3 步确认 bash 参数描述；或 `DSH_PERMISSION_MODE` 被设为 never |
| 启动即崩 | `cat /tmp/liangshen-plus-tui.err`；常见：profile patch 路径错配、preset yaml 语法错误 |
