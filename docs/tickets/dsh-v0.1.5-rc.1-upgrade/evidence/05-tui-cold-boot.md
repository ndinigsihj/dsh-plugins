# 票据 05 证据 — TUI 在新宿主上冷启动（首个可演示切片）

日期：2026-09-10
执行：ask-matt-flow Stage 5 Implement，票据 05（本窗口）
环境：Node v22.22.1；全局宿主 `@deepseek-ai/dsh@0.1.5-rc.1`（`dsh --version` → 0.1.5-rc.1）；stable 隔离运行时 rc.2 未触碰
结论：**验收 5/5 通过**。冷启动、消息提交、助手流式响应、状态行、干净退出均实测；过程中处置了两个启动/发送阻塞项（05-1 profile 重复 id、部署位 preset 漂移）。

## 0. 验收清单对照

| 票据 05 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 开发 profile 冷启动进入全屏终端界面 | 通过 | §4.1：PTY 全屏渲染 banner 与状态行；无 `duplicate loader entry id`、无挂载/服务冲突 |
| 提交一条消息并收到助手流式响应 | 通过 | §4.3：`thinking · 31→97→163→252 chars` 递增渲染后输出正文 `411`；§5 durable `assistant/message`（reasoning+text） |
| 状态行与模型标签正常显示 | 通过 | §4.2/§4.3：`● opencode-go/deepseek-v4-flash · Max · dsh-plugins`，`cache 0% · out 63 · ctx 0% (2k/1.0m)` |
| 干净退出且退出码为 0 | 通过 | §4.4：`exiting…` → 备用屏恢复（`[?1049l`）→ 子进程 `exp6 0 0`（exit 0） |
| 启动过程无组合挂载或服务冲突错误 | 通过 | §1 dump 每个 id 计数为 1；§4.1 启动日志无 duplicate/冲突 |

## 1. 处置 finding 05-1：开发 profile 重复 loader entry id

对象：`~/.dsh/profiles/tui-dev/cordis.patch.yml`（工作区外文件；改动前副本备份于临时目录，已随 §8 清理）。

改动：

1. 删除 `insert` 中的 `storage` / `storage-json` / `storage-domain` 三行——rc.1 `dsh-base/cordis.patch.yml` L145–157 已挂载等价行（`storage-json.root: !!js dshHomePath('storages')`、`storage-domain.backend: json`）。
2. `session-projection-cache` 移出 `insert`，改为文件末尾的**按 id config 覆盖**（patch 语义：非 insert 条目为字段级覆盖）：
   `writeEveryEvents: 400` / `writeIntervalMs: 30000`，保留本 profile 原有节流值（base 默认 200/5000）。
3. 头部注释补记本处置。

验证（临时 `DSH_HOME`，不触碰真实 `~/.dsh`）：

```
修复前：4 个 id（storage / storage-json / storage-domain / session-projection-cache）各 2 条
修复后：全部 `- id:` 计数均为 1；session-projection-cache.config 为 400/30000；dump exit 0、stderr 无告警
```

`tui-central`（已停用，目录 `tui-central.parked-0.1.5-rc.1`）与 `tui`（stable 侧）**未动**：前者解除停用时按同样方式处理（PARKED.md 已记录条件），后者 rc.2 base 不含这 4 个 id、插入是唯一来源。

## 2. 处置（新 finding 05-5）：部署位 preset 与仓库漂移

现象：profile 修复后冷启动成功，但提交消息即报 `UNKNOWN: session.events is not iterable`（`system-prompt/assemble` 路径）。

根因：TUI 从**部署位** `~/.dsh/.agent-presets/minimal-plus-next/` 加载 preset；该副本同步于 9月10日 15:37，早于票据 04 的迁移落地，其中 `compaction-epoch.mjs:36` 仍是 `for (const event of session.events)`（`tool-bootstrap.mjs` 经 `promotion.status` 走到它）；仓库内 `presets/minimal-plus-next/` 已迁移，但未重新同步。即票据 04 的单元回归绿灯证明的是仓库代码，没有证明部署位副本。

处置：`scripts/sync-agent-presets.sh minimal-plus-next`（依赖目标按脚本逻辑取当前全局宿主 rc.1 的 `@deepseek-ai/dsh/node_modules/@deepseek-ai`）。同步后 8 个文件与仓库 sha256 一致，例如：

```
a17cdce7…4feb  presets/minimal-plus-next/compaction-epoch.mjs
a17cdce7…4feb  ~/.dsh/.agent-presets/minimal-plus-next/compaction-epoch.mjs
084316a3…1690  presets/minimal-plus-next/phase-swap-bash.mjs
084316a3…1690  ~/.dsh/.agent-presets/minimal-plus-next/phase-swap-bash.mjs
```

stable 侧 `~/.dsh/.agent-presets/minimal-plus` 未触碰（mtime 仍为 9月9日 17:02）；同步后发送消息正常，见 §4.3。

## 3. 复查 finding 05-4：`x-opencode-session` 本地补丁

两处安装的 `dsh-llm-pi-ai/lib/index.js` 均含 `x-opencode-session`、均不再匹配未打补丁标记 `requestHeaders(profile.headers)`：

- 全局 rc.1：`~/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js`
- stable rc.2：`~/data/dev/dsh-runtime/stable/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js`

本次验收的 opencode-go 请求未再出现 `MissingSessionID`（§5 请求头 provider 为 opencode-go，响应正常完成）。

## 4. 冷启动 PTY 验收

驱动：`expect` 在真实 PTY 中启动 `dsh --profile tui-dev`（沙箱默认拒绝 `/dev/ptmx`，本窗口以临时提权运行）；脚本与原始日志为临时产物，已清理，关键输出如下。

### 4.1 冷启动 / 全屏渲染

```
✻ dsh-tui v0.1.7 · deepseek harness
commandcode/deepseek/deepseek-v4-flash · preset minimal-plus-next · think Max  · /Users/vito/data/dev/dsh-plugins
/help 命令一览 · @ 文件补全 · Ctrl+O 展开思考 · Esc 打断
● commandcode/deepseek/deepseek-v4-flash · Max · dsh-plugins
```

无 `duplicate loader entry id`、无服务冲突错误；banner 出现即视为挂载完成（驱动以 `dsh-tui v0.1.7` 为同步点）。

### 4.2 模型切换（/model 选择器，opencode-go）

默认路由 `commandcode/deepseek/deepseek-v4-flash` 命中 429 weekly limit（见 finding 05-6），故经 `/model` 选择器切到 opencode-go：

```
search> opencode-go/deepseek-v4-flash
→ opencode-go/deepseek-v4-flash   DeepSeek V4 Flash
Switched to opencode-go/deepseek-v4-flash — takes effect next turn.
● opencode-go/deepseek-v4-flash · Max · dsh-plugins
```

### 4.3 消息提交与流式响应

发送 `Compute 137 times 3. Reply with only the number.`，实时渲染（同一 turn 内的连续帧，证明按增量到达而非一次性整段）：

```
⠧ thinking · 31 chars · Ctrl+O expands
⠇ thinking · 97 chars · Ctrl+O expands
⠇ thinking · 163 chars · Ctrl+O expands
✻ thinking · 252 chars · Ctrl+O expands
411
● opencode-go/deepseek-v4-flash · Max · cache 0% · out 63 ·...  ctx 0% (2k/1.0m)
```

### 4.4 退出

```
/exit → exiting… → [?1049l（备用屏恢复）→ Resume with the command below: dsh --profile tui-dev --resume session-1fa6fc2f-…
WAIT: <pid> exp6 0 0   → EXITCODE: 0
```

## 5. durable 会话证据

本次验收会话 `session-1fa6fc2f-651b-4df2-8132-ad208529ac5c`（`~/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/`，V3 zstd）：

| 事件 | 内容 |
| --- | --- |
| `request/header` | `provider: opencode-go`、`model: deepseek-v4-flash`、`reasoningEffort: max` |
| `user/message` | `Compute 137 times 3. Reply with only the number.` |
| `assistant/message` | reasoning（含 `137 * 3 = 411`）+ text `411` |
| `turn/end` | `{"kind":"completed"}`（非 aborted） |

首轮尝试（修复 preset 前）的会话 `session-8011949b-…` 以 `aborted/user` 结束且无 `assistant/message`，作为对照留在磁盘。

## 6. 回归

- `npx tsc --noEmit` → 0 错误
- `npm test` → 97 pass / 0 fail（与票据 04 收尾一致）
- 本窗口未改仓库代码；改动仅两处工作区外部署位（`~/.dsh/profiles/tui-dev/cordis.patch.yml`、`~/.dsh/.agent-presets/minimal-plus-next/`）

## 7. 新 findings（转后续票据）

- **05-5（部署漂移）**：部署位 preset 与仓库的一致性靠人工 `sync-agent-presets.sh`，票据 04 的绿灯没有覆盖部署位。建议票据 09 的配置闸门或票据 13 收尾加入「部署位 preset 8 文件 sha256 == 仓库」检查，并把 sync 列入宿主升级检查单。
- **05-6（外部额度）**：默认路由 `commandcode/deepseek/deepseek-v4-flash` 返回 `RATE_LIMIT: 429`（weekly limit，重置时间 `2026-09-11T06:21:01.800Z`），非代码问题；本次验收以 `/model` 切到 opencode-go 完成。若需在默认路由上复验，等额度恢复即可。
- **05-7（预期副作用）**：`1mdsh-dev` 冷启动在真实 farm 上触发了一次 rc.1 整代自愈（finding 03-2 的预期行为）；运行后 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-base` 指向全局 rc.1，stable 下次启动会按其 anchor 翻回。
- **05-2 仍未关闭**：`--dump-config` 对重复 id 不报错；本次用「每个 id 计数为 1」的脚本化检查补上，票据 09 的闸门应按此实现。

## 8. 边界与清理

- 临时 expect 驱动与 PTY 原始日志（`.dsh/tmp05/`）收尾时已删除；`.dsh/` 本身为 gitignore 的流程目录。
- 可回滚副本保留在 `.dsh/ask-matt-flow/backups/`：`tui-dev.cordis.patch.yml.pre-ticket05`（profile 改动前逐字节副本）、`tui-dev.dump-{before,after}-ticket05.yml`（修复前后 dump）。票据 01 备份树中的 tui-dev patch 是 9月7日 版本、不含票据 03 之后的改动，故另留此份。
- `presets/minimal-plus/`（stable 副本）、`~/.dsh/.agent-presets/minimal-plus`、`~/.dsh/profiles/tui`、stable 运行时均未触碰。
- relay/endless 适配不在本轮范围，本轮仅冷启动实测到它们的挂载路径可加载（endless 注入、relay-client 均未报错）。
