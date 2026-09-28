# TUI 功能计划 — 第一切片：子代理显示（A1 + A2 + A4）

> 状态：**revised**（2026-09-28 二稿；三轮 grilling 复核后 A3 摘出、事实纠错落定，待开工）。
> 缘起：0.1.7-rc.1 升级收口（`docs/dsh-v0.1.7-rc.1-upgrade-closeout.md`）后，宿主能力已可用而 TUI 显示层未接。升级计划（`docs/dsh-v0.1.7-rc.1-upgrade-plan.md`）§4.3/§5.3 把体验工作拆为两个切片：**第一切片 = 子代理显示**、第二切片 = B2–B4（Team 体验）。当时「功能计划」只以票面输入散在计划里，没有独立文件；本文是第一切片的施工图（收口文档 §7.3 登记的是第二切片，不因本文而变）。
>
> 裁决记录（2026-09-28）：一稿 = A1–A4 全部；**二稿经三轮 grilling 裁决：A3（四档展示模式）摘出第一切片**，本切片 = A1 + A2 + A4，A3 票面原位保留为 `deferred`，另行立票时重新论证（理由见 §3.4、§7）。第二切片只登记范围，不在本次批准内。
>
> 实现纪律（沿用本仓库惯例）：每票完成停下汇报，用户确认后才提交；不自动 commit/push。
> 编号口径：本计划的 A1–A4 / B2–B4 继承自升级计划，与 `docs/tui-feature-gap.md` §9 的 A1–A10 / B1–B10 是**两套互不相关的编号**；引用后者时一律写「gap §9 A7」这样的限定形式。

## 1. 范围与生效面

**含**：A1 目录与状态对齐、A2 子会话只读视图（`/agents`）、A4 settle 通知呈现。（A3 四档展示模式已摘出，见 §7。）

**不含**：A3 四档展示模式（`deferred`，独立立票）、Team 显示层（B2–B4）、上游 Web 的 turn-level「过程组」、子会话实时流与写操作、one-shot 完成信号、非本机子代理状态、stable 通道迁移、gap §9 其余未接项（gap §9 A7–A10、gap §9 B6–B10）。

**改动面与部署关系**：

| 项 | 结论 |
|---|---|
| 代码面 | 仅 `lib/`（TUI 本体）+ 测试 + 文档；不改 preset 真源、profile、闸门期望 |
| 部署 | **不需要** `sync-agent-presets` / 部署位刷新（无 preset 改动）；若实施中被迫碰 preset，必须停回本计划追加部署步骤（收口 §7.1 #4 口径） |
| 生效面 | `tui-dev` / `tui-team`（profile 以绝对路径挂载本仓库 `lib/`，重启 TUI 即生效） |
| 不受影响 | stable `tui`（0.1.5 自包含树，`~/.dsh/.agent-presets/minimal-plus` 旧目录载体） |
| 术语 | 沿用 `CONTEXT.md`；A2 引入的「子会话只读视图」落地时补术语表 |

## 2. 现状（as-built，2026-09-28 读代码，HEAD `b440edf`）

| 面 | 现状 | 位置 |
|---|---|---|
| 气氛行数据模型 | `RunningSubagent { id, mode: "one-shot"\|"continuable"\|"unknown", label? }` | `lib/app.ts:82-86` |
| 气氛行筛选 | `selectRunningSubagents(children, isRunning)` 只保留 `agents.get(id)?.status === "running"` 的直接子代理 | `lib/app.ts:1687-1697`；`lib/index.ts:3704-3707` |
| 气氛行渲染 | 折叠一行 `◉ subagents ×N · 最新 label`；Ctrl+O 展开每行 `● label (bg)`，cap `SUBAGENTS_EXPAND_CAP = 12`、超出 `… N earlier` | `lib/app.ts:2261-2290`、`lib/app.ts:195` |
| 刷新触发 | `refreshSubagents()` = `ctx.subagents.listChildren(agent.id)` + 注册表状态连接；tool/turn/goal 事件与子代理 `agent/status` 翻转触发（调用点 1635/1743/2347/3785/3826） | `lib/index.ts:3696-3713`、`3760-3792`、`3822-3833` |
| 子会话流 | `session/event` 只接受 `session.id === agent.id`；`agent/assistant-stream` 只接受 root agent —— 子代理实时文本被显式丢弃 | `lib/index.ts:3763`、`3799-3812`（root 过滤 3802） |
| 注入行 | `user/message` 中一切非 `user` source 渲染为 dim context 行（0.1.7 producer-owned source kind 适配） | `lib/transcript.ts:261-298`（286-287 分支） |
| settle 通知 | 收到但不可辨：整个内容按 context 行 dim 呈现，与普通注入无区别 | 同上 |
| 展示详情 | `detailsExpanded` 单一布尔（`lib/app.ts:1926`），`toggleDetails()` Ctrl+O 全局切换；AssistantRow 思考、ToolRow 体、todos/subagents/jobs 气氛行共用 | `lib/app.ts:381-474`、`476-616`、`2375-2382`、`2672-2675` |
| 子会话视图 | 不存在：`/agents` 未实现；无子会话 transcript 视图（日志读取可复用 `lib/session-preview-log.ts`）；`teammate`/`agentTeam` 在 `lib/` 零命中；`/agents` 命名无冲突（宿主内建命令只有 compact/export/feedback/file/goal/permission/plan，本仓库 22 个注册命令中无 agents/agent/subagents） | — |
| 现有测试 | `lib/app.test.ts`（T4a，subagent gauge 用例 276-312、断言 283-290/299-307）；`lib/transcript-area.test.ts`（窗口/滚动/重建，不用 FakeTerminal） | — |

## 3. 上游 0.1.7 契约（安装包一手核对）

核对对象：全局 `@deepseek-ai/dsh@0.1.7-rc.1`；二稿并由只读核查逐条复核（见 §9）。

### 3.1 目录与状态

- `SubagentCatalogEntry`（`dsh-subagent/lib/types/projection-types.d.ts:8-20`）：`{ id, createdAt } & (one-shot{label?} | continuable{label} | unknown{label?})`。**没有 phase / error / activity 字段**；catalog v0 记录已知模式，v1 起保留 `mode: 'unknown'`（`catalog.d.ts:11,19-30`）。
- `listChildren(parentSessionId, signal?)`：父会话拥有的 durable direct-child catalog，读取不加载、不恢复子 Agent（`index.d.ts:209-218`）。
- `listDescendants(rootId)`：完整后代树，普通条目带 `activity: 'running' | 'inactive'`、`parentId`、`depth`；另有 `kind: 'diagnostic'` 行（`corrupt | unsupported | unavailable`）——**诊断行没有 activity**，且 `unsupported` 在当前实现中永不产生（`control-types.d.ts:20-62`）。
- `ctx.agents.get(id)`：活体注册表，`AgentStatus = 'idle' | 'running'`（定义在 `dsh-agent/lib/types/runtime-types.d.ts:83-90`；dispose 即离开注册表，没有第三态）。已 settle 未 dispose 的 one-shot 会短暂读作 `idle`；remote/ACP 子代理 `localAgent === undefined`，本机注册表查不到（`dsh-subagent/lib/types/types.d.ts:299-304`）。
- `subagentTiming` 投影（`projection-types.d.ts:21-37`）：`settledMs`、`active?: { since, through }`、`lastTurnCompleted?`。投影 key 由插件全局注册（`index.js:3015-3020`），**任何 session 的 snapshot 都能取到**；非 descriptor-backed 会话返回 `{ settledMs: 0 }` 而非 undefined（`projection.js:41,79-86`）——「读不到」的真实形态是字段缺席或 `settledMs === 0`，不是 key 不存在。
- 生命周期事件：`subagent/start` / `subagent/end` 成对，按委派父级作用域过滤；`SubagentRunEndInfo` 带 `stopReason` 与 `lastAssistantMessage?`（`types.d.ts:93-110`）；continuable 子代理每次冷恢复是一个新 `runId` 纪元（`index.d.ts`、`types.d.ts`）。

### 3.2 settle 通知

`createSettlementMessage`（`dsh-subagent/lib/index.js:613-654`）生成一条 parent 会话内的 user 角色消息：

- content = `[summary, …]`：`summary` 依 stopReason（`completed` / `aborted` / `max-tokens` / `refusal` / `error` / 未知）文案形如 `Background subagent <childId> finished and will do no further work unless you send it more.`；随后是 `It left no closing message.` 或 `Its closing message:` + 收尾文本块。
- source = `{ kind: 'subagent-settled', form: 'notice', summary, senderSessionId }`；`senderSessionId` 指向**子会话**。
- 与 `agent-message`（`form: 'relay'`）是不同 source kind：这是 continuation manager 对「子代理变成了什么」的记账，不是子代理自己说的话（`continuation-messages.d.ts:19-34` 原文语义）。
- **只覆盖 continuable**：唯一调用点在 continuation manager 的 disposal 路径（`index.js:1248-1268`），且需 `announced` 与父 Agent 仍 live；one-shot 结束只发 `subagent/end`（`index.js:255-275`），结果回调用方/后台 job，**不给父会话投 user 消息**。因此 A4 的 settle 行不可能来自 one-shot（见 §4.4）。

### 3.3 旧票面纠偏（本计划对升级计划 A1 行的修订）

升级计划 §4.3 票 A1 写「展示 phase（`provisioning` / `active` / `failed`）与 `error`」——这是 **Team 成员快照**的词汇（`TeamMemberPhase`，`dsh-experimental-agent-team/lib/types/types.d.ts:29-30`），普通子代理的目录/服务不提供。本计划按真实可用的轴重建验收（二稿复核：纠偏成立）：

| 旧票面 | 实际契约 |
|---|---|
| phase provisioning/active/failed | ❌ 普通子代理没有；改为 `mode × 活体驻留 × subagentTiming` |
| error | ❌ catalog 无 error；失败只在 `subagent/end` 的 `stopReason`（live 事件）与 settle 通知 summary 里出现，分别归 A4 与后续 |
| unknown 模式 | ✅ 保留：`unknown` 必须可辨且绝不渲染为可继续 |

### 3.4 四档展示模式（A3 已摘出，仅存参照）

上游 Web（`dsh-client-ui-chat/README.zh.md:81`）：**简洁、标准、详细、完全展开**。枚举与 legacy 值见 `chat-settings.d.ts:8-17`（中文「完全展开」= `verbose`；`normal`/`expanded` 只是 legacy 输入值，不再写回）。

二稿复核补正：Web 的真实控制面不止「收起已完成轮次」——`client.js:11916-11945` 的策略矩阵还含 `stepGrouping`（`collapsed`/`history`/`none`）、`liveProcessDetail`、`settledReasoningPreview` 三轴。本 TUI 是扁平行列表、没有 turn-level 过程组结构，要「语义对齐」必须重新论证映射，**故 A3 摘出第一切片**：票面（`docs/tickets/subagent-display/03-process-group-fold.md`）保留原设计、状态 `deferred`，另行立票时重新论证。

## 4. 设计

### 4.1 子代理条目模型（A1）

```ts
type SubagentState = "running" | "idle" | "inactive";
interface SubagentEntry {
  id: string;
  mode: "one-shot" | "continuable" | "unknown";
  label?: string;
  state: SubagentState;
  createdAt?: number;
  activeSince?: number;   // subagentTiming.active.since（仅驻留）
  settledMs?: number;     // subagentTiming.settledMs（仅驻留）
}
summarizeSubagents(
  children: ReadonlyArray<CatalogRow>,
  liveOf: (id: string) => { status: "idle" | "running"; timing?: { activeSince?: number; settledMs?: number } } | undefined,
  now?: number,
): SubagentEntry[]
```

- `state`：注册表存在且 `status === "running"` → `running`；存在但非 running → `idle`（continuable 的驻留等待，或 one-shot 收尾瞬态）；注册表无 → `inactive`（one-shot 已终结/dispose、continuable 冷、或非本机子代理）。
- 计时：仅对驻留子代理读 `sessionProjections.snapshot(child.session).values.subagentTiming`；`active.since` 存在渲染 `⏱ <MmSs>`；`active` 缺席或 `settledMs === 0` 视为无数据省略——**不伪造、不阻塞渲染**。
- **计时刷新（二稿新增）**：现有气氛行是事件驱动静态行，父侧事件稀疏时秒表会冻在错误值上；加 **1s 低配 tick**：仅在存在 running|idle 条目时启停，只重算气氛行（复用仓库既有 `setInterval` 模式，不引入新的渲染原语）。若 pi-tui 侧出现重绘抖动，回落为静态计时并在票面写明「非实时」，**宁可砍掉 running 计时也不显示错值**。
- 气氛行可见规则（二稿裁决）：存在 `running` 或 `idle` 条目才显示（**活体指示器**）；折叠行 `N` = **活条目数**；展开态列**全部 catalog children**（含 inactive），排序 `running → idle → inactive`、组内保持 catalog 输入序，cap `SUBAGENTS_EXPAND_CAP = 12`，超出 `… N earlier`。冷子代理的完整目录归 A2 的 `/agents`——「气氛行=活体指示器，目录真相=/agents」的分工写进票面。
- 文案：折叠 `◉ subagents ×N · <最新 label> <state tag>`；展开 `<mark> <label> · <mode tag> · <state tag> · <计时>`：
  - mode tag：`continuable → (bg)`、`one-shot → (one-shot)`、`unknown → (? unknown)`（dim/yellow，绝不出 `(bg)`）；
  - state mark：`running → ● 绿`、`idle → ◐ 黄`、`inactive → ○ dim`；`idle` 文案不承诺「可继续」（one-shot 收尾瞬态也落在 idle）。
- 已知限制（二稿裁定，写进票面）：one-shot 完成不产生任何 UI 信号；非本机（remote/ACP）子代理一律显示 `inactive`。

### 4.2 子会话只读视图（A2，`/agents`）

- **入口**：`/agents` 经 `services.commands.register` 注册（与 `/sessions` 同构，自动进 slash 菜单）。命名已核对无冲突（见 §2）。
- **定位（二稿裁决）**：事后/明细查看，**不承诺实时**。picker 每次打开与每次返回都重读清单；viewer 打开时取一次快照、头部标「快照于 HH:MM:SS」，`r` 键手动重读；Esc 逐级返回（viewer → picker → 会话）。无自动刷新、无流式。
- **picker**：直接子代理清单（复用 A1 `summarizeSubagents`），label/mode/state/相对时间；`↑`/`↓` 选择、`Enter` 打开、`Esc` 关闭；空列表给 notice。**只列直接子代理**——嵌套后代与 `listDescendants` 诊断行不在本切片（已知限制写进票面，避免把 `/agents` 误当全景）。
- **viewer**：只读 overlay，独立 `TranscriptModel` 实例 + `readPreviewLog`（`lib/session-preview-log.ts:53-99`，`listEvents` + 分窗 `readEvent`，seeded 子会话可用）+ `TranscriptArea` 渲染；行数按终端高度封顶；`↑`/`↓`/`PgUp`/`PgDn` 滚动、`Esc` 返回 picker；无输入框、不可提交/steer/中断。
- **全屏形态（二稿新增）**：pi-tui 现成 overlay 只有居中弹窗（`SessionPicker` 默认宽 `min(80, 屏幕-2)`、高 ≤12 行），仓库无全屏 overlay 先例 → A2 第一步是 **½ 天 spike**，结论**单独停下汇报**；撑不满则退回 `/resume` 同构的「清单 + 预览面板」形态——形态变更须由用户重新拍板，**不静默降级**。
- **presenters（二稿定）**：活体子代理用 `presentersFor(childAgent)`，冷子代理回落当前 root `presenters`（`lib/index.ts:1079-1094`）。
- **root 隔离**：绝不触碰 root `app.model`；`lib/index.ts:3763`、`3802` 的 root 过滤原样保留。viewer 只经 TuiApp 新增 API 注入数据与 loader（服务无关，便于 T4a）。
- **失败面**：日志不可读 / query 缺席 / 子会话不可见 → 明确 notice（原因 + 子会话 id 前缀），不静默空白、不崩。**这是常规路径而非边缘**：`sessionQuery` 是 live-preferred，remote/ACP 与未持久化的子会话读不到（`subagent/index.js:1269-1277` 明示 continuable 的持久化是 best-effort）。

### 4.3 四档展示模式（A3）— 已摘出

A3 不在本切片（见 §3.4、§7）。票面 `docs/tickets/subagent-display/03-process-group-fold.md` 原位保留为 `deferred`：`Ctrl+O` 从布尔改循环、四档映射到现有折叠面、档位持久化等，都要在自己的立票轮里重新论证（Web 三轴策略与本 TUI 扁平行不是名称对齐就能等价的）。

### 4.4 settle 通知行（A4）

`lib/transcript.ts` 的 `user/message` 分支（261-298）先判 `source.kind === "subagent-settled"`，命中则推独立行：

```
| { kind: "settled"; text: string; closing?: string; childId?: string; seq: number }
```

- `text` = `source.summary`（缺失回退首个 text 块）；`closing` = 收尾文本（无正文时保留 `It left no closing message.` 的等价文案）；`childId` = `source.senderSessionId`（指向子会话）。
- 渲染：首行 `◌ subagent <id8> · <summary>`（不套 dim 正文）；有 `closing` 时续 dim `↳ <closing>`。**绝不当 user 气泡**。
- **覆盖面（二稿确认）**：只覆盖 continuable 的 settle；one-shot 完成不产生该行（信号不投递，见 §3.2）。one-shot 的完成可见性登记为后续票，不在本切片（用户已裁定接受无痕）。
- `rebuild`（231-236）走同一判定，落盘与回放一致。
- `lib/export.ts`（15-55，switch 22-52）为该行补导出分支（引用块，不丢内容）。
- 同源的 `agent-message`（peer 消息）**不在本票**：现状仍是 context 行，是否需要独立呈现属后续决策。

### 4.5 分层与归属

纯函数（`summarizeSubagents`、计时合并、settle 行分类）→ 单测；`lib/app.ts` 增展示 API 与组件；`lib/index.ts` 只做服务接线（含 1s tick 的启停）；agent 归属判定不动。

## 5. 票面与推荐顺序

| 票 | 文件 | 内容 | 依赖 | 顺序 |
|---|---|---|---|---|
| A1 | `docs/tickets/subagent-display/01-catalog-status-alignment.md` | 目录与状态对齐（含 1s 计时 tick） | 无 | 1 |
| A2 | `docs/tickets/subagent-display/02-subagent-session-view.md` | 子会话只读视图（全屏 spike 结论单独停一次） | A1（清单数据） | 2 |
| A4 | `docs/tickets/subagent-display/04-settle-notice.md` | settle 通知呈现（仅 continuable） | 无（可与 A2 并行，仍按票停汇报） | 3 |
| — | `docs/tickets/subagent-display/03-process-group-fold.md` | 四档展示模式：**已摘出**，Status=`deferred` | — | — |

## 6. 验收与闸门

- **每票**：`npx tsc --noEmit`；`npm test`（注意：`package.json` 的 test 是显式文件清单，新增测试文件必须手动登记，T0 只校验已声明文件存在）；`scripts/regression-gate.sh --tier 0,1` 零豁免。
- **切片收口**：`scripts/regression-gate.sh --tier 0,1,2 --composition real`（当前基线 85/0/0、零豁免）+ `scripts/tui-pty-smoke.sh --profile tui-dev --probe-tools` 与 `--profile tui-team --probe-tools`（当前基线各 16/16；**不带 `--probe-tools` 只有 14 条**）+ 人工签收。
- **人工签收问题（二稿定，单一问题）**：在 tui-dev / tui-team 里真跑一轮子代理后，能否**一眼**答出「有几个子代理、哪些在跑、哪些可继续」；答不出即 A1 未达标，回炉而不是加字堆信息。
- **失败判据**：闸门/PTY 零豁免是硬门槛；任一票若被迫碰 preset/profile/闸门期望，立刻停并补部署步骤。
- **文档回填**：`README.md` 命令表、`HELP_TEXT`（`/agents`）、`CONTEXT.md` 新术语（A2）；收口时与 closeout §7.3 对账（§7.3 只登记第二切片）。
- **不做部署位同步**（§1）；若某票实际改了 preset，视为计划外变更，停在原地补部署与零豁免复验。

## 7. 非目标

- A3 四档展示模式（`deferred`：`Ctrl+O` 改循环、四档映射、档位持久化）——独立立票时重新论证。
- 上游 Web 的 turn-level 过程组（组头、组状态机、三轴策略）。
- Team 显示层（B2 成员视图/任务板）、Team 使用规范（B3）、Team 风险与不变量（B4）——即第二切片，不在本次批准内。
- 子会话实时流、子会话写操作（prompt/steer/interrupt）、team task 视图。
- one-shot 完成信号（需在 TUI 侧新造呈现，另立票）。
- 非本机（remote/ACP）子代理的状态正确性与日志可读性。
- gap §9 其余未接项（gap §9 A7–A10、gap §9 B6–B10）。
- stable 通道迁移与 0.1.5 兼容；`~/.dsh/.agent-presets/minimal-plus` 旧目录处置。

## 8. 风险与未决

| 风险 | 影响 | 缓解 |
|---|---|---|
| 1s tick 与气氛行重绘（pi-tui 重绘粒度未实测） | 低中 | tick 仅在存在 running\|idle 时启停、只重算该行；抖动则回落静态计时并在票面写明「非实时」（宁可砍掉 running 计时） |
| `subagentTiming` 的降级形态与计划原描述不同（0/缺席，非 key 不存在） | 低 | 票面已按真实降级路径改写：无数据即省略，A1 主体不依赖 timing |
| 全屏 viewer 形态未经实测（pi-tui 无全屏 overlay 先例） | 中 | A2 第一步 ½ 天 spike，结论单独停；退化 = `/resume` 同构面板，形态变更由用户重新拍板 |
| 冷子代理 viewer 回落 root presenters，个别子代理专属工具渲染可能退化 | 低 | 写进票面；出现实际误渲再改，不做预防性抽象 |
| 展开态改「活体优先」排序，与既有时间序断言不同 | 低 | `lib/app.test.ts` 相关断言显式更新（不得静默改口径） |
| 非本机子代理显示为 `inactive` 的已知误判 | 低 | 写进票面；与「非本机不可读」一起留给后续票 |
| 上游 0.1.7 之后契约漂移（catalog v1/timing 细节） | 低 | 契约核对以 `gates/manifest.json` 的 hostVersion 为准，升级轮重新核对 |

## 9. 事实来源

- 安装包（一手）：`node_modules/@deepseek-ai/dsh-subagent@0.1.7-rc.1` 的 `projection-types.d.ts`、`catalog.d.ts`、`list-children.d.ts`、`control-types.d.ts`、`index.d.ts`、`types.d.ts`、`continuation-messages.d.ts`、`lib/index.js:613-654/1248-1268/255-275`、`lib/types/projection.js:30-86`；`dsh-agent/lib/types/runtime-types.d.ts:83-90`；`dsh-experimental-agent-team/lib/types/types.d.ts:29-30`；`dsh-client-ui-chat/README.zh.md:81`、`lib/types/chat-settings.d.ts:8-17`、`lib/client.js:11916-11945`。
- 仓库：`docs/dsh-v0.1.7-rc.1-upgrade-plan.md` §4.3/§5.3、`docs/dsh-v0.1.7-rc.1-upgrade-closeout.md` §7、`docs/tui-feature-gap.md` §9、§2 表所列代码位置（HEAD `b440edf`）。
- 二稿只读核查（2026-09-28，三个子代理并行）：仓库代码锚点逐条核对（引用行号已按 HEAD `b440edf` 复核）、上游 0.1.7-rc.1 契约逐条核对（§3 引用 0 条不存在，6 处收紧已并入本文）、闸门/PTY 与文档一致性（发现 §6 PTY 命令漏 `--probe-tools`，已修）。核查同时确认：`/agents` 无命名冲突；`sessionQuery` live-preferred，非本机/未持久化子会话不可读是常规路径。
- 裁决记录（2026-09-28，三轮 grilling）：① 第一轮 = A3 摘出、A2 事后查看定位 + 全屏 viewer、气氛行=活体指示器 + 目录归 `/agents`、失败判据三条；② 第二轮 = 开工前一次性文档修订、1s 低配 tick（覆盖第一轮的「不新增定时重绘」）、展开态活体优先排序、A2 刷新契约（picker 重读 / viewer 快照 + `r` 键 / Esc 逐级）、只列直接子代理、one-shot 无痕（初裁）；③ 第三轮 = one-shot 无痕维持、接受非本机状态误判、A2 spike 结论单独停。
