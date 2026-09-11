# 票据 04 证据 — 会话事件读取迁移（宽重构）

日期：2026-09-10
执行：ask-matt-flow Stage 5 Implement，票据 04（本窗口）
环境：Node v22.22.1；全局宿主 `@deepseek-ai/dsh@0.1.5-rc.1`；stable 隔离运行时 rc.2 未触碰
用户裁定（本窗口开工前确认）：

1. rc.1 移除 `userQuestions.registerProvider` 会导致票据 05 冷启动直接失败 → **并入票据 04** 一起迁移（与 03-1 同处置）。
2. `npm test` 的 5 个 preset 测试条目从冻结的 `minimal-plus`（rc.2 时代码）切到开发侧 `minimal-plus-next`。

## 0. 验收清单对照

| 票据 04 检查项 | 结果 | 证据 |
| --- | --- | --- |
| TUI 生产路径不再读取已移除的事件接口 | 通过 | §1：`lib/index.ts` 13 处 `agent.session.events` 全部改走 `snapshotEvents()` / 新接口；`assistant/chunk` 直播路径改走 `agent/assistant-stream` |
| 回退插件的会话记录读取改走快照接口 | 通过 | §2：`rewindSource` 与 live root 均以 `snapshotEvents()` 读取 |
| 回退边界使用强类型的会话位置 | 通过 | §2：`computeRewindBoundary` 返回官方 `SessionSeq`（品牌类型），`SessionsService.fork` 的 boundary 参数同型 |
| preset 自研插件不再读取已移除的事件数组 | 通过 | §3：`compaction-epoch.mjs` 冷扫描改 `snapshotEvents()`；其实机冒烟见 §5 |
| agent 创建按异步接口等待完成后再继续 | 通过（核实性） | §4：4 处 `agents.create/resume` 均已 `await` 并 `await agent.whenIdle()`；rc.1 仅确认签名一致 |
| 未构造 Inbox 运行时对象、未使用已移除的插件侧代理上下文 | 通过（缺席核实） | §6：全范围 grep 无 `inbox`/`ctx.agent`/`hasPending`/`claim(` 命中 |
| 未依赖已移除的旧持久化方法 | 通过 | §6：`sessionProjectionCache.coldSnapshot` 已从「服务自己读盘」迁到 rc.1 的「调用方给全量日志」；无 `sessionPersistence`/`persist(` 直调 |
| 既有单元用例通过（含 phase-swap-bash 6 红转绿） | 通过 | §7：`npm test` 97/97（开工前 91/97，6 红）；`tsc` 0 错误（开工前 5 错） |

## 1. TUI 生产路径（`lib/index.ts`）

`agent.session.events` 是 rc.2 的 getter，rc.1 已移除（改为 `eventAt(seq)` / `snapshotEvents(from, to)` / `ownEvents()`）。

| 位置 | 开工前 | 迁移后 |
| --- | --- | --- |
| `resumeHint` / `showBootBanner` / `switchToPreset` 的空白判定 | `sessionIsBlank(...events)` | `sessionIsBlank(...snapshotEvents())` |
| rewind picker 候选 | `rewindCandidates(...events ?? [])` | `rewindCandidates(...snapshotEvents())` |
| 投影 fallback（cache rate / todo 扫描） | 两次直接读 `...events` | 一次 `snapshotEvents()` 局部快照，两处复用 |
| `/model` fork 种子 | `fork(...).events` | `[...fork(...).snapshotEvents()]` |
| `/model` 记录 preset / 重建 transcript | `...events` + `{skipStreamDeltas:true}` | `...snapshotEvents()`（rc.1 日志无 chunk 事件，flag 已无意义） |
| 上下文占用 fallback | `lastUsageReport(...events)` | `lastUsageReport(...snapshotEvents())` |
| 会话列表 hover 预览 | `coldSnapshot(sessionId)`（服务自己读盘） | `readSession(id)` → `coldSnapshot(header, inheritedEventCount, events)`（rc.1 契约：调用方给全量日志） |
| `/permission` 当前档 | `permissionPresets.current(events)` | `permissionPresets.current(session)`（rc.1 改折 live session） |

直播流（rc.1 不再把 chunk 写进 session 日志）：

- 移除 `session/event` 里的 `assistant/chunk` 分支（text-delta 的 token-rate 与气泡文本都从这里消失）。
- 新增 `agent/assistant-stream` 订阅：`frame.type === "chunk"` → `app.model.applyStreamChunk(chunk)` + `noteStreamText(text)` + 重绘；`payload.agent` 存在且非当前 root 时丢弃（子代理流不污染主 transcript）。
- 终态仍由 durable `assistant/message` 经 `session/event` 收口（`transcript.apply` 更新开着的行并置 `done`）。

`userQuestions`（本窗口用户裁定并入）：

- rc.1 移除 provider 注册，改为 scope-filtered `user-questions/request` waterfall。
- `registerProvider({ask})` → `ctx.on("user-questions/request", async (request) => ...)`，请求/答案形状与旧 `ask()` 逐字段一致（含 plan-review 卡片分支、dismissed → `{answers: []}`）；监听器随 `ctx.effect` 一起 dispose。
- 保留「服务未挂载则不订阅」的等价守卫；`CoreServices.userQuestions` 结构类型改为 rc.1 的 `ask`。

## 2. 回退插件（`plugins/rewind-dsh.ts`）

- `SessionLike` 的 `events: readonly SessionEvent[]` → `snapshotEvents(): readonly SessionEvent[]`；`rewindSource` 服务契约同步改为 `snapshotEvents()`（提供方 `lib/index.ts` 与消费方同窗口改，无跨版本兼容分支）。
- `computeRewindBoundary` 返回 `SessionSeq | undefined`（`import type { SessionSeq } from "@deepseek-ai/dsh-session"`，纯类型导入、无新增运行时依赖）；`SessionsService.fork(source, boundary?: SessionSeq, childSessionId?)` 与 rc.1 官方签名同型。
- 纯函数用例未改（`=== number` 在品牌类型下运行时等价），`plugins/rewind-dsh.test.ts` 全绿。
- 本票只做接口迁移；fork/flush 与文件恢复的端到端属票据 06。

## 3. preset 自研插件（`presets/minimal-plus-next/`）

- `compaction-epoch.mjs` 的冷扫描 `for (const event of session.events)` → `session.snapshotEvents()`（注释记录 rc.1 移除 getter）。该模块同时服务 tool-bootstrap / phase-swap-bash / instruction-hint 的 `promotion.status()`，一处迁移三条链同时恢复。
- `phase-swap-bash.mjs`：swap 的 spy ctx 为 rc.1 `dsh-tool-bash.apply()` 补 `getSectionOrder()`（rc.1 用 `ctx.systemPrompt.getSectionOrder("TOOL_BASH")` 注册指引 section；旧 stub 缺此方法导致 6 个红用例）。
- 测试替身改为 rc.1 形状（关键：替身不再暴露 `events`，插件若回读旧接口即红）：
  - `test-helpers.mjs`：`makeSession()` 提供 `snapshotEvents()/eventAt()/seq`，底层数组放 WeakMap；`boot()` 的 `systemPrompt` stub 补 `getSectionOrder`；`fireEvent/fireToolCall` 走 WeakMap。
  - `phase-swap-bash.test.mjs`：文件内同名替身同步改造；`assistant/chunk` 夹具改为 `assistant/message`。
  - `tool-bootstrap.test.mjs`：fail-open 用例改为 `snapshotEvents` 抛错（原为 `events = {}` 非可迭代）。
- 本票未动 `presets/minimal-plus/`（stable 源，rc.2 接口）与 `presets/minimal-plus-next/trajectory-driver.mjs`（测量工具，票据 07）。

## 4. agent 创建异步（核实性）

`lib/index.ts` 四处创建/恢复均已等待完成后再继续：boot resume、boot create、`/new`、`/model` fork，均为 `await services.agents.resume/create(...)` 后 `await agent.whenIdle()`。rc.1 的 `AgentRegistry.create()` 签名（返回 `Promise<AgentHandle>`）与现状一致，无需改动；本票以行号核对记录。

## 5. 实机验证（rc.1，无 LLM）

命令（独立 `DSH_HOME`，不碰真实 `~/.dsh` 与共享 farm）：

```sh
# 1) 初始化独立 home 的 headless profile（此步不触发 farm 自愈）
DSH_HOME=/tmp/dsh-ticket04-home dsh --profile headless --dump-config > /dev/null
# 2) 按 rc.1 installAnchor 自愈临时 farm（dsh CLI 的 composeProfile 会做，dump 路径不会）
cat > /tmp/heal-ticket04-farm.mjs <<'EOF'
import { healProfilesModuleFallback, loadProfile } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js";
const ANCHOR = "/Users/vito/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/package.json";
const profile = loadProfile("dsh", "headless", ANCHOR);
await healProfilesModuleFallback({ installAnchor: ANCHOR, profile, home: process.env.DSH_HOME });
EOF
DSH_HOME=/tmp/dsh-ticket04-home node /tmp/heal-ticket04-farm.mjs
# 3) 冒烟：temp home 需至少一个 model-invocable skill（否则 host skill-catalog 按设计保持空目录）
cd /tmp/dsh-ticket04-ws   # 含 AGENTS.md 的合成工作区
DSH_HOME=/tmp/dsh-ticket04-home SMOKE_PRESET=minimal-plus-next \
  node /Users/vito/data/dev/dsh-plugins/presets/minimal-plus-next/smoke-boot.mjs
```

输出（exit 0）：

```
ROUND1 catalog: {"tools":["bash","str_replace_editor"],"bashParams":["command"],...}
ROUND1 pre-step sources: []
ROUND2 catalog: {"tools":["ask_user_question","bash",...,"skill_load","skill_search",...],
                 "bashParams":["command","description","timeoutMs","workdir","run_in_background","sandbox_permissions","justification"],...}
WARNINGS: []
ROUND2 pre-step sources: ["agent-instructions","skill-catalog","instruction-hint"]
WARNINGS: []
```

即：首轮锚定对正确；append `tool/call` 后 promotion 生效（全量目录 + 沙箱 bash + 二轮三种注入恢复）——这同时证明 `compaction-epoch` 在真实 rc.1 `Session` 上的 `snapshotEvents()` 冷扫描可用。

环境注意事项（复现用）：临时 home 需放一个 `model-invocable` skill；只放 `disable-model-invocation: true` 的 skill（如 `ask-matt-flow`）会让 host catalog 按设计返回空目录，`skill-catalog` 断言不成立（本窗口已实测两种情形）。end-to-end 的 TUI 可用性仍属票据 05。

## 6. 缺席核实（grep 全范围：`lib/`、`plugins/`、`presets/minimal-plus-next/`）

- `inbox` / `new Inbox` / `hasPending` / `.claim(`：0 命中。
- `ctx.agent`：0 命中（rc.1 已移除的插件侧代理上下文）。
- `SessionHandle` / `sessionPersistence.` / `persist(`：0 命中；持久化只经 `sessions.flush()` 与投影缓存（已按 rc.1 新契约调用）。
- `assistant/chunk`：生产代码 0 命中；仅 `lib/transcript-area.test.ts` 保留两条「日志不再含 chunk、旧形状事件被忽略」的迁移断言。

## 7. 验证数字

| 项目 | 开工前 | 完成后 |
| --- | --- | --- |
| `npm test` | 97 tests / 91 pass / 6 fail | **97 / 97 / 0** |
| `presets/minimal-plus-next` 5 个测试文件 | 43 / 37 / 6 | **43 / 43 / 0** |
| `npx tsc --noEmit` | 5 错（全在 `lib/transcript.ts`：`assistant/chunk` 类型已移除） | **0 错** |
| rc.1 无 LLM 冒烟 | 票据 03 时在 `system-prompt/assemble` 抛 `session.events is not iterable` | **exit 0**（§5） |

稳定侧核对：`git status --short presets/minimal-plus` 为空；未动稳定 profile、稳定运行时、部署位副本。未 commit / 未 push。

## 8. 本票发现（转后续票据）

1. **会话列表 hover 预览失去「零日志读取」快路径。** rc.1 的 `coldSnapshot(meta, inheritedEventCount, events)` 要求调用方先给全量日志（服务不再自己读盘），因此每次预览至少一次完整 `readSession`。行为正确、冷读缓存仍生效（避免重复折叠），但 hover 延迟与大日志成本需票据 06/09 复核是否需要把 `listSessions` 的 header 缓存进 picker 回调。
2. **迁移面外的残留 `agent.session.events` 读取**（本票按范围纪律未动）：`presets/minimal-plus-next/trajectory-driver.mjs:91`、`experiments/m4/m4-runner.mjs`（4 处）、`experiments/model-hot-switch-live-spike.mjs:92`。前者属票据 07（测量工具迁移），后两者为实验脚本，建议票据 07 一并收拾或显式标注作废。
3. **rc.1 `commands.execute` 第三参语义更名**（`images` → `submittedAttachments`，支持 file receipt）。TUI 目前传空数组，无运行时影响；若后续在 slash 命令上带图/文件需适配（票据 05 备查）。
4. **`agent/assistant-stream` 是进程内事件。** relay worker 模式的镜像会话是否由 attach-client 转发该事件未验证（relay 本轮 out of scope）；票据 06 或 relay 适配轮次需确认真人流式显示不回归。
5. **复现环境要求**（§5）：独立 home 需自愈临时 farm + 至少一个 model-invocable skill；`dsh --dump-config` 不做 farm 自愈。

## 9. 未做

- 未 commit、未 push、未打 tag；未改 stable 侧任何文件与部署位。
- 未做组合去重（票据 09）、未接模型选择（票据 11）、未冷启动 TUI（票据 05）。
- 未借机重构 `sessionPreview`/`seedProjections` 的既有逻辑（仅按 rc.1 契约替换读取方式）。
