# dsh 0.1.1-rc.2 → 0.1.5-alpha.1 升级计划

> 日期：2026-09-09  
> 状态：**计划稿，仅调查与设计，不包含代码修改，不执行安装、提交或推送**。  
> 范围：DeepSeek Harness 官方 npm 包及其官方 GitHub release notes；评估 `dsh-plugins`、`dsh-relay`、`dsh-endless` 三个仓库的兼容性与新增功能。

## 1. 执行摘要

当前本地运行时是 `@deepseek-ai/dsh@0.1.1-rc.2`，三个仓库的 package manifest 仍以 `0.1.0-rc.6` 为依赖基线。目标 `0.1.5-alpha.1` 已发布到 npm 的 `alpha` tag，但不是稳定版：npm `latest` / `next` 仍为 `0.1.2-rc.1`。

这不是一次普通的依赖升级。必须按以下顺序处理：

1. **先完成 API 与会话格式适配**：`Session.events` 移除、`SessionHandle`/单写锁、异步 agent 创建、Inbox API、V2/V3 日志迁移。
2. **再升级三仓库依赖和 profile**：统一所有 `@deepseek-ai/*` 包到 `0.1.5-alpha.1`，禁止混用旧运行时树。
3. **最后做功能增强**：优先做远端模型目录/子代理控制、V3 事件与长期记忆、图片记忆；Sidebar 和 Web 专属体验不属于这三个仓库的优先范围。

建议采用 **兼容层 + 分阶段切换**，不要一次性把现有 v2/v3 relay 协议与 dsh API 改动混在一个大 diff 中。

## 2. 版本事实与证据边界

### 2.1 npm 状态

截至 2026-09-09，官方包 `@deepseek-ai/dsh`：

| 项目 | 结果 |
|---|---|
| 当前本地运行时 | `0.1.1-rc.2` |
| 目标版本 | `0.1.5-alpha.1` |
| `latest` | `0.1.2-rc.1` |
| `next` | `0.1.2-rc.1` |
| `alpha` | `0.1.5-alpha.1` |
| 正式 `0.1.5` | 不存在，npm 返回 `E404` |
| 正式 `0.1.3` | 不存在，npm 返回 `E404` |

目标 alpha 的完整 dsh CLI 依赖树也已切到 `^0.1.5-alpha.1`，并新增了 `dsh-http-proxy`、`dsh-webhook`、`dsh-sdk-*`、`dsh-hooks-*`、实验性 Agent Team 等包；不能只替换 CLI 顶层版本而保留旧的全局 `@deepseek-ai` 树。

来源：

- npm Registry：<https://registry.npmjs.org/@deepseek-ai%2fdsh>
- 目标包元数据：<https://registry.npmjs.org/@deepseek-ai%2fdsh/0.1.5-alpha.1>

### 2.2 官方 release 线

npm 中存在的目标范围版本为：

`0.1.1-rc.2 → 0.1.2-alpha.2 → 0.1.2-alpha.3 → 0.1.2-alpha.4 → 0.1.2-alpha.5 → 0.1.2-rc.1 → 0.1.3-alpha.2 → 0.1.5-alpha.1`

GitHub release notes 还提供 `0.1.2-alpha.1` 与 `0.1.3-alpha.1`，虽然前者没有进入 npm 版本列表，后者也不是当前 npm 可安装版本，但它们包含关键变更，必须纳入迁移分析。官方 GitHub API 中没有 `0.1.0-rc.2`、`rc.3`、`rc.6` 的独立 release note 条目；这些版本出现在 npm 历史中，但不能凭空补写其 release 内容。因此本稿对它们只把 `0.1.1-rc.2` 作为明确基线，不把缺失的说明推测成事实。

官方 release notes：

- [`v0.1.1-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.2)
- [`v0.1.2-alpha.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.1)
- [`v0.1.2-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2)
- [`v0.1.2-alpha.3`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.3)
- [`v0.1.2-alpha.4`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.4)
- [`v0.1.2-alpha.5`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.5)
- [`v0.1.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1)
- [`v0.1.3-alpha.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.3-alpha.1)
- [`v0.1.3-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.3-alpha.2)
- [`v0.1.5-alpha.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-alpha.1)

## 3. 从基线到目标的完整差异

以下按功能和风险归并；同一功能在多个 alpha 中重复列出时，只在首次引入处描述，后续版本只列增量。

### 3.1 基线：0.1.1-rc.2

官方 notes 只有两项体验改进：

- DeepSeek adapter 优先使用 Files API 上传和复用图片。
- 按模型要求自动缩放、转换图片格式。

这意味着当前运行时已经有图片上传基础，但没有后续 0.1.2 的通用文件附件、持续子代理图片投递和图片事件完整回放能力。

### 3.2 0.1.2-alpha.1：第一轮大功能集

新增：

- 默认折叠过程内容和 system prompt。
- 会话正文宽度自适应/拖拽、字号调节、Markdown 表格随字号缩放。
- 回合导航、精确 token 用量、provider 登录控件、第三方 UI 语言。
- 子代理可在授权范围选择 provider/model/reasoning；调用方可指定 provider、model、reasoning effort、max output；Claude Code/Codex 可配置模型。
- ACP 的会话控制、模型设置、MCP、权限、取消能力补齐。
- DeepSeek 请求可带启用插件的包名/版本；可选 Session 日志增量上传，默认关闭。
- 任意已支持模型的原生图片请求；图片立即显示、后台压缩上传；图片计入 compaction；轨迹显示用户/助手/工具图片；本地文件系统模式可以定位上传图片。
- PTC mode、公开 `web_fetch` 默认启用并带 SSRF 防护；Headless 进度写 stderr、stdout 保持最终结果。

重要变更与修复：

- `Code Mode` 更名为 `PTC mode`，旧记录可读。
- Remote 旧 `ApiProxy` 向 `@Remote` 迁移并移除旧接口。
- 网络 Web UI 使用一次性 token。
- 持久 Bash/PowerShell、WebSocket 心跳、Node 24 启动/HMR、Agent Preset 启动路径等修复。
- Minimal preset 移除不适用的 `/goal`。

### 3.3 0.1.2-alpha.2 ～ alpha.5：稳定化与 Session 读取 API 转向

`alpha.2`：

- 连接失败状态、自动重试、立即重连。
- 活动 Schedule 显示。
- Remote 网关统一 `RemoteError`。
- 恢复 `SessionEvent.ignorable`。

`alpha.3`：

- 长会话分页预览和跳转、渲染内存/高亮优化。
- 运行中的会话或持续子代理可追加/排队图片。
- `read_image` 可识别无扩展名附件。
- 移除可选 SQLite Session persistence backend；已有内容不删除，但需旧版本导出。

`alpha.4`：

- 父 Agent 与可持续子 Agent 通过 `send_message` 双向传递后续消息，替代单向 `report`。
- 自定义模型目录搜索/筛选，复用 Profile 请求头。
- Python SDK、Headless、ACP、自定义 Profile 默认 `web_fetch`。
- **移除 `Session.events`**，改用 `seq`、`eventAt()`、`snapshotEvents()`；`SessionSeq` 与 `SessionLogOffset` 强类型区分。

`alpha.5`：

- 专门修复从 `0.1.1-rc.2` 或 `0.1.2-alpha.3` 升级时可能启动失败、会话标题丢失的问题。
- 这证明基线直升存在真实迁移风险，必须保留升级前备份与启动/会话列表验收。

### 3.4 0.1.2-rc.1：汇总候选版

除合并前述功能外，新增/明确：

- 连接状态、短暂服务端卡顿容忍、自动重试/立即重连。
- 插件可向 Models 设置页添加 provider 登录配置。
- 子代理 provider/model/reasoning/max output 的显式调用配置。
- `send_message` 双向父子代理通信。
- 实验性 Inspector 与 Web Preview。
- 远端请求的插件包版本信息与可选 Session 日志增量上传。
- `web_search` 错误报告实际端点和详细错误。
- 公开 WebFetch 默认开启；相关运行模式默认提供 `web_fetch`。
- 可选 SQLite Session persistence 移除。
- **`Session.events` → `seq`/`eventAt()`/`snapshotEvents()`**。
- Headless stdout/stderr 语义固定；Remote APIProxy 完成移除。

### 3.5 0.1.3-alpha.1：生命周期与持久化的破坏性切换

新增：

- Web 任意类型文件上传，文件/图片混排，后台上传进度、取消、切换会话续显；模型用已保存路径按需读取。
- 所有出站请求遵循 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`。
- 自定义 provider `models` 对象、原生 Anthropic model list，以及模型名/上下文窗口/max output 回填。
- `read_image` 顶层和 PTC 嵌套调用直接渲染图片。
- Skill picker 模糊搜索。
- Agent Team `send_message` 统一 steer 语义，并在跨 Agent、冷恢复中保留发送者和顺序。

关键破坏性变更：

- Session persistence API 改为生命周期持有的 **`SessionHandle`**。
- `agentLoop.create()` 改为异步。
- 新增 Session lock：一个 Session 同时只能被一个进程持有。
- Session format 升级到 **V2**：旧 v0/v1 通过相邻 generation 迁移；assistant 流按 attempt 聚合为持久 settlement；Web 仍保留实时增量显示。
- 官方明确标注本版本存在历史 Session 加载性能回退。

### 3.6 0.1.3-alpha.2：长会话、持续子代理控制和默认工具

新增：

- `pi-ai` 升到 0.85.1，支持更多模型。
- Web “Open in” workspace：编辑器、IDE、终端、文件管理器等。
- 持续子代理消息排队、编辑、删除、单条/全部 Steer、Stop。
- PTC 命令及输出可展开。

修复/变更：

- Web 断线自动恢复。
- 长会话打开/恢复/继续时减少卡顿和内存。
- 排队消息显示 Sending 状态，发送完成前禁止编辑/删除/Steer。
- SDK、Headless、ACP 默认文件编辑工具改为 `read`/`write`/`edit`；Web minimal 与 sdk-minimal 不变。
- 自定义 persona 配置拆成 prefix/suffix。
- 普通 subprocess handle 移除 pid，terminal handle 不变。
- Windows/Python SDK 启动和多平台进程清理修复。

### 3.7 0.1.5-alpha.1：Session V3、Agent API 和动态 prompt

新增：

- 支持在模型明确声明支持时动态修改 system prompt 而不破坏 KV Cache。
- Web 实验性右侧 Sidebar：tabs、split panes、fullscreen，文件/产出链接可在 Sidebar 打开；原 Detail panel 移除。

体验与修复：

- 会话统计拆为轮次/速度和精确 Token/cache hit 摘要。
- 内置 slash command 说明支持中文，并随语言即时更新。
- Codex/Claude Code 运行时更新；显式模型配置保持不变。
- 忙碌会话的发送按钮与 Enter 统一遵循 queue/steer 设置。
- 暂停目标后必须由用户恢复，模型不可自行恢复。
- 修复工作区外 POSIX 绝对路径图片显示。
- 拒绝空文本、空白队列编辑，但保留纯图片/纯文件消息。
- 项目根查找遇到权限/I/O 错误时不再错误使用上级项目指令。
- macOS/Linux 不再因 `fs-ext` 要求本地编译。

关键破坏性变更：

- **Session format V3**：恢复受支持历史 Session 时生成新版日志并保留原文件；system prompt 纳入消息历史；旧 PTC 事件和 `code` preset 引用自动迁移；升级后的 Session 不支持降级读取；自定义日志 reader 必须适配 V3。
- **插件 Agent API**：移除 `ctx.agent`，调用方必须显式传递 Agent；持续子代理的归属修正，root-only 调度不再误收子代理。
- **Inbox API**：`Inbox` 变成 type-only interface，不再导出可构造运行时类；插件通过 `agent.inbox` 访问；`hasPending`/`claim` 不再属于公共接口。

目标包声明级证据：从旧包与目标包下载的 `dsh-session`、`dsh-session-persistence`、`dsh-agent`、`dsh-agent-loop` `.d.ts` 对比显示：旧的 `events`、`prepare/load/append` persistence 形态已被按需 snapshot、per-session handle、`create/open/flush/stat/list` 形态替代；`AgentSetup` 增加显式 `agent` 参数；`agentLoop.create` 返回 `Promise<Agent>`。

## 4. 三仓库影响矩阵

### 4.1 dsh-plugins

| 影响 | 级别 | 证据/位置 | 处理 |
|---|---:|---|---|
| `agent.session.events` 仍被 TUI 主循环多处直接读取 | P0 | `lib/index.ts` 1503, 1568, 1610, 1860, 2092, 2162-2164, 2211, 2222, 2250, 2622, 3235, 3510 | 统一 `sessionEvents()` 兼容 helper；生产路径使用 `snapshotEvents()`，查询快照的 `.events` 保留不误改 |
| `/rewind` 直接读取 `root.session.events` | P0 | `plugins/rewind-dsh.ts:515` | 使用 `snapshotEvents()`；fork boundary 使用强类型 seq；验证新旧日志迁移 |
| fork/flush 与旧 Session persistence 假设耦合 | P0 | `plugins/rewind-dsh.ts:619-637`、相关文档 | 对照 `SessionHandle` 实际实现，确认 `sessions.fork` 返回值与 flush 责任；不重新注入已被 core 接管的 persistence |
| 测试 helper/trajectory/experiment 使用可变 `.events` | P1 | `presets/minimal-plus/*.test.mjs`、`trajectory-driver.mjs`、`experiments/` | 测试替身可保留自己的数组；真实 runtime helper 改为 snapshot，避免测试掩盖生产 API 缺失 |
| `ctx.agent` | P1 | 当前生产代码未发现直接使用 | 增加 typecheck/grep 门禁，避免新插件沿用旧 API |
| `Inbox` | P1 | 当前 TUI 主要通过 agent surface 操作 | 不构造 Inbox、不依赖公共 `hasPending/claim`；只使用 `agent.inbox` 中目标仍公开的能力，需 alpha 实测确认 |
| PTC / 默认工具 | P1 | minimal-plus preset、工具 bootstrap | 验证 read/write/edit 默认变化是否与自研 `custom-bash`、tool promotion 冲突；不主动覆盖官方默认值 |
| provider/model 子代理配置 | P2 | 当前 TUI `/model` 与 model selection | 值得加入 `/subagent` 或任务启动配置，但应先确认 TUI 是否有合适 UI seam，不把 Web 专属面板搬入 TUI |
| token/cache 展示 | P2 | 已有 `/cost`、`/tokens` 与 token meter | 使用新事件/投影补 per-turn 统计和 cache hit；属于高价值、低跨仓库风险功能 |
| 动态 system prompt/KV cache | P2 | 0.1.5 新能力 | 评估给 `/model`、preset 或 endless profile 变更使用；只有模型 capability 明确声明支持时才启用，不能强制刷新 prompt |

### 4.2 dsh-relay

| 影响 | 级别 | 证据/位置 | 处理 |
|---|---:|---|---|
| worker/server 对 `session.events` 多处读取 | P0 | `src/worker.ts:748,827,917,1040`；`src/server.ts:590,976` | 抽取 relay 自己的 `sessionEvents`/`eventsSince` 适配层，优先 `snapshotEvents(from,to)`；所有 backfill、rewind、task ledger 回归测试覆盖空洞 seq |
| SessionHandle 单写锁 | P0 | worker resume/fork、server resume、controller resume | 每个 live agent 绑定并持有明确 handle；连接断开不立即误释放可恢复 Session；同 session 的 owner/worker resume 失败要映射为协议级 `session-owned`/`busy`，不能让整个 hub 崩溃 |
| 异步 `agentLoop.create` | P0 | `worker.ts:1379`、`server.ts:799`、`controller.ts:137` 以及测试 fake | 所有创建路径 await 完成后再发送 `stream-open-ack`/`session-start`；禁止先宣布 stream 再补 agent；加入 setup 失败回滚和超时测试 |
| persistence API 从 service batch 变 per-session handle | P0 | `worker.ts:496-511,717`，历史 `sessionPersistence` 读取 | 先确认目标 dsh 的 JSONL backend 对 `stat/list/open(read)`、`handle.read/flush` 的实际导出；将索引/backfill/replay 从旧 `readRaw/load/readFrom` 迁到新接口；不能假定 service 级 `append` 仍存在 |
| V2/V3 Session 日志含迁移/新事件 | P0 | worker backfill、hub journal、rewind、decode-v3 | 升级前备份；协议继续只传规范化 `session-event`，但 reader 必须接受 V3；保留原始 seq、attempt、system prompt、PTC 迁移事件，不在 relay 侧重写语义 |
| relay wire v3 的 seq 水位 | P0 | `protocol-v3.ts`, `hub.ts`, `worker.ts` | 继续以 `(deviceId, sessionId, seq)` 去重；不要把 V3 的 `SessionLogOffset` 与 wire seq 混用；`agent/inbox/spliced` 仍过滤，session event gap 要通过日志回放补齐 |
| `send_message` 双向父子 Agent | P1 | v0.1.2-alpha.4、v0.1.3-alpha.1 | 这是 relay 最值得适配的新能力：新增/扩展 `subagent-message` 或复用 `user-input`/`steer` 的带 `sourceAgentId`、`targetAgentId`、message id、ordering 字段；hub 路由 owner/observer 可见事件，worker 保留 attribution；先写协议计划再实现 |
| 持续子代理 queue/edit/remove/steer/stop | P1 | v0.1.3-alpha.2 | 在 relay 中把子代理控制建模为有序命令和幂等 message id；支持 `queue-edit/remove/steer-all/stop` 的最小协议；不要只转发文本，否则冷恢复无法保持顺序 |
| 远端 model catalog / provider/model selection | P1 | 现有 `model-selection` 与 `model-catalog` seam | 目标 dsh 的 provider discovery 支持 custom `models` 与 Anthropic list；让 hub 转发远端真实目录及 context/max output，TUI 只显示远端可用项；模型目录响应需要 capability/version 字段 |
| 连接重试/断线恢复 | P1 | dsh 自身 alpha.2/alpha.3 修复 | relay 已有 WS heartbeat、resume、水位；升级后做真实断线、后台 stall、V3 migration replay 验收，不能简单声称“上游已修复所以 relay 无需测” |
| 任意附件/图片 | P2 | alpha.1/alpha.3/alpha.2 | 若跨机器传图片/文件，不能把 base64 塞进普通事件或无限增大 WS frame；设计 attachment transfer/reference，复用路径或 content-addressed object，设置大小、权限和过期策略 |
| `RemoteError` | P2 | alpha.2 | 将远端错误标准化为 `{code,message,details,source}`，前端显示可读错误，保留原始错误用于诊断；避免继续暴露旧 ApiProxy 名称 |

### 4.3 dsh-endless

| 影响 | 级别 | 证据/位置 | 处理 |
|---|---:|---|---|
| `session/event` 捕获仍可工作，但事件形状增多 | P0 | `src/capture.ts` | 保持未知事件 fail-soft；针对 V2/V3 `assistant/attempt`、system prompt、PTC 迁移事件写 fixture；只把明确的用户/助手/工具事实纳入折叠，避免把迁移元数据蒸馏成记忆 |
| `Session.events` | P1 | endless 主要消费 `session/event`，少量 session/header 访问 | 当前生产代码没有关键 `.events` 读取，但检查所有 profile/辅助脚本；不要因 `session/event` 正常就跳过 V3 验证 |
| AgentHandle/SessionHandle | P1 | `inject.ts` agent map、session start/dispose | agent 生命周期事件要绑定 exact handle/agent identity；`agent/disposed` 清理必须在 resume、fork、子代理结束时正确触发 |
| Inbox API | P0 | `src/inject.ts:223,262`、`inject-v3.ts` | 继续通过 `agent.inbox.prepend` 注入；移除任何对 Inbox 类、`hasPending`、`claim` 公共方法的假设；验证 V3 agent loop 中 prepend 仍是非唤醒的持久 splice |
| V3 system prompt 纳入历史 | P1 | inject/digest/compaction bridge | capture 必须识别 system prompt 是宪法/运行时上下文还是 endless 自己的经验，默认不蒸馏静态宪法，避免 V3 迁移后重复沉淀；为 `system/message`/相关事件做显式过滤测试 |
| V3 session 不可降级 | P0 | 0.1.5 release note | endless 自己的 SQLite 不受 dsh Session 文件格式直接影响，但升级/回滚流程不能让旧 dsh 读取已迁移日志；发布前做 DB/Session 双备份，并记录禁止降级读取 |
| 多模态记忆 | P1 | rc.8 起图片链路，endless 现为纯文本 | 最值得做的 endless 新功能：capture 保存图片引用/元数据而非 base64；distill 可带图但输出仍为文本实体；inject/recall 只注入图片路径/引用并提示 `read_image` 按需读取；模型不支持图片时退化为文本 |
| token/cache/turn stats | P2 | alpha.2/0.1.5 | 将 provider usage、cache hit、耗时作为蒸馏质量/成本信号，而不是记忆正文；可为 distill 调度做预算和重试策略 |
| 动态 system prompt | P2 | 0.1.5 | endless 可在 profile/working-state 更新后请求动态 prompt 更新，减少 KV cache 破坏；必须先确认 dsh 的 capability 声明和 plugin-facing API，不能通过重建 agent 伪造该能力 |
| 远端中央记忆 | P1 | 当前已有 `inject-v3` 计划 | 继续执行已有 `docs/relay-v2-worker-endless-inject.md` 方案：hub 中央 capture/distill，worker 通过 `context-inject` 收 digest；V3 下补 compaction 后重注入和 session handle 生命周期。 |

## 5. 值得加入的功能排序

### 5.1 dsh-plugins：优先级

**P0：升级兼容与体验恢复**

- `sessionEvents()` 兼容层覆盖 TUI、rewind、model hot-switch、token/cost、preset promotion。
- 真实 V2/V3 日志恢复、fork、resume、rewind 回归。
- 新默认工具、PTC、图片-only/file-only 消息和空队列边界验证。

**P1：按轮次的 token/cache/耗时视图**

已有 `/cost`、`/tokens`，但新 dsh 的 per-answer 统计更适合 TUI；实现应复用 `dsh-token-meter`/session usage 事件，不重新扫描全部历史日志。验收：当前轮、上一轮、累计值、cache hit 缺失值都能稳定显示。

**P1：远端/子代理模型选择**

对 relay 会话，TUI 的 `/model` 应展示 worker 实际 provider/model catalog，包括 context window 和 max output；子代理启动命令可增加显式 provider/model/reasoning/max output，但必须先确认当前命令注册和权限边界。

**P2：动态 prompt capability**

可用于切换 preset/profile 或 endless digest 更新，但只对声明支持的模型开启，并提供失败回退到普通 prompt 更新的路径。不能把它作为首轮升级阻塞项。

**不建议加入**：Web Sidebar、Web Preview、Inspector、Open in。这些是官方 Web UI 的体验能力，不适合以 TUI 插件重复实现。

### 5.2 dsh-relay：优先级

**P0：完成 dsh 0.1.5 runtime 适配**

- Session snapshot API。
- SessionHandle ownership 与 resume/断线/worker 重连。
- async create 后再 ack。
- V3 reader/backfill/rewind/seq watermark。
- 旧 v2 wire 保持冻结，只让本地降级路径继续工作。

**P1：双向可持续子代理控制**

这是 relay 最有差异化价值的功能。dsh 已经有 queue/edit/remove/steer/stop 和双向 `send_message`，relay 可以把它们变成跨设备可操作的控制面。必须带：

- target agent/session identity；
- message id 与幂等；
- sender attribution；
- queue order；
- cold-resume 后的重放规则；
- owner 权限与 fail-closed。

**P1：远端模型目录与模型选择**

现有 `model-catalog`/`model-selection` 已有基础，应补 provider capability、Anthropic/custom `models`、context/max output 回填，以及切换失败的 RemoteError。

**P2：附件引用传输**

只有在真实工作流确实需要“本地 TUI 上传图片，远端 worker 读取”时再做。优先传有权限和生命周期的 attachment reference，不直接复制任意路径或裸 base64。

### 5.3 dsh-endless：优先级

**P0：V3 兼容与记忆不污染**

- 过滤 system prompt/迁移元数据，不让静态宪法被蒸馏为偏好。
- 校验 assistant attempt 聚合后的 capture 行为。
- compaction/resume/fork/agent dispose 回归。
- 保持 Inbox 注入只走 `agent.inbox`。

**P1：多模态记忆**

这是 endless 唯一明确能把上游新能力转化为自身核心价值的功能：截图、设计稿、错误图片可进入 capture → 带图 distill → 文本实体 → 按需 `read_image`。事实库只存引用/元数据，不存二进制，避免数据库和上下文爆炸。

**P1：relay 中央记忆闭环**

完成现有 `inject-v3` 设计的 worker 注入缺口，并补“压缩后重新注入”策略。中央库 single-writer、worker mirror、projectKey 绑定必须继续保持现有设计不变量。

**P2：usage-aware distill**

用 token/cache/耗时决定是否蒸馏、蒸馏预算和重试，不把统计污染为知识实体。收益是成本可控和更稳定的 7x24 运行。

## 6. 建议的实施阶段

### Phase 0：冻结基线与回滚点

**涉及：三个仓库，配置/文档为主。**

1. 记录当前全局 dsh、每个 `@deepseek-ai/*` 依赖、Node 版本、profile patch、`DSH_HOME` 和 Session 根目录。
2. 备份 dsh Session 目录、endless SQLite、relay hub watermark/journal/buffer。
3. 保存当前 `npm test`、`tsc --noEmit`、relay real-tree smoke、endless resume/compaction 实证结果。
4. 明确目标是 alpha 试验树，不修改 `latest` 语义；所有启动命令显式使用 `@alpha` 或精确版本。

验收：旧版本可以恢复一个已有 session；备份可读；工作区无非本轮改动被覆盖。

### Phase 1：依赖树和最小启动

**不实现新功能。**

1. 安装 `@deepseek-ai/dsh@0.1.5-alpha.1` 到隔离 global/npm prefix，避免污染旧运行时。
2. 更新/重建三个仓库的 `@deepseek-ai/*` 链接或 lockfile，使运行时与编译依赖统一。
3. 先用 `headless`/最小 profile 启动，再启动 dsh-plugins TUI、relay worker/server/controller、endless profile。
4. 验证 Node 22.19+、代理环境、Web token、图片依赖、profile preset roots。

验收：三个仓库 typecheck 能进入真实模块加载；空 key 启动失败是可解释的 credential 错误，而不是 API/import/Session 格式异常。

### Phase 2：Session/API 兼容层

**先 dsh-plugins，再 relay，最后 endless。**

1. dsh-plugins：替换真实 `.events` 读取，保留 query snapshot 的 `.events`；更新 rewind/fork/flush 类型和测试替身。
2. relay：集中改 worker/server/controller 的 snapshot/backfill/rewind；建立 SessionHandle registry 与连接 owner 关系；异步 create 完成后再 ack。
3. endless：审查 agent/dispose、Inbox prepend、capture event filter；为 system prompt、assistant attempt、V3 migration 写 fixtures。
4. 全部组件禁止使用 `ctx.agent`、Inbox runtime class、旧 `sessionPersistence.append/load/prepare` 假设。

验收：`tsc --noEmit`、单测、真实 profile boot、已有 session resume、fork/rewind、relay attach/resume 全通过。

### Phase 3：V2/V3 持久化和网络回放

1. 在 relay worker 上验证目标 persistence backend 的 `create/open/read/write/flush/stat/list` 实际接口。
2. 用备份副本测试旧 Session 冷恢复和自动迁移，不直接拿唯一生产日志试错。
3. 验证 V3 system prompt、PTC legacy event、`code` preset migration；目标 alpha 读取升级后的日志，旧 dsh 读取被拒绝属于预期。
4. 验证 `(deviceId, sessionId, seq)` 水位、V3 日志回放、断线补传、hub journal、rewind 和 mirror capture 不重复。
5. 补 `SessionHandle` ownership 竞争、旧连接被替换、新连接胜出、worker 崩溃恢复的故障注入测试。

验收：断线、进程重启、同 session 双 owner、V3 migration、回放缺口都不会丢事件或重复蒸馏。

### Phase 4：首批高价值功能

按风险排序：

1. dsh-plugins per-turn token/cache/耗时。
2. dsh-relay 远端 model catalog 与 provider/model selection。
3. dsh-endless V3 过滤与中央 inject-v3 补齐。
4. dsh-relay 双向可持续子代理控制。
5. dsh-endless 多模态记忆 spike，再决定正式 schema。
6. 动态 system prompt/KV cache capability spike。

每项功能先写对应仓库计划文档和契约测试，再实现；跨组件协议变更必须先得到设计确认。

### Phase 5：稳定化与发布决策

1. 运行至少一轮真实长会话、resume、compact、rewind、relay attach、worker 重启和图片工作流。
2. 对比旧版与 alpha 的响应延迟、内存、Session 文件大小、hub buffer、endless distill 成本。
3. 明确 alpha 的已知风险：不能降级读取 V3、SessionHandle 单写限制、上游 alpha 可能继续破坏 API。
4. 只有回归结果稳定后，才决定是否将 alpha 作为工作环境默认版本；不要因为 npm `latest` 尚未前移而误以为 alpha 已稳定。

## 7. 第一轮必须覆盖的测试矩阵

| 场景 | dsh-plugins | dsh-relay | dsh-endless |
|---|---:|---:|---:|
| 新建/恢复已有 Session | 必须 | 必须 | 必须 |
| `snapshotEvents` 空/区间/末尾 | 必须 | 必须 | 间接 |
| V2/V3 migration 后读取 | 必须 | 必须 | 必须过滤 |
| fork/rewind/flush | 必须 | 必须 | 不重复捕获 |
| 同 Session 双进程 ownership | 观察错误 | 必须 | 观察 dispose |
| agent 创建异步失败 | profile boot | 必须 | profile boot |
| Inbox prepend/claim 语义 | 不构造 Inbox | relay context inject | 必须 |
| system prompt 不进入错误记忆 | 观察 UI | 透明转发 | 必须 |
| 图片/文件 only message | TUI 显示 | 附件暂不跨线或明确拒绝 | 多模态 spike |
| 断线、重连、回放缺口 | TUI 恢复 | 必须 | 不重复蒸馏 |
| 子代理双向消息 | 后续 UI | P1 必须 | capture attribution |
| 动态 prompt capability 缺失 | 降级 | 转发 capability | 不破坏注入 |

## 8. 暂不做的事项

- 不把 Web Sidebar、Web Preview、Inspector、Open in 复制到自研 TUI。
- 不立即实现 relay 图片裸传；先完成引用/权限/生命周期设计。
- 不以 `latest` 标签作为升级目标；当前 `latest` 仍是旧 rc。
- 不为兼容 alpha 而删除现有 v2 relay 降级通道。
- 不在没有真实 persistence API 验证前批量改写所有历史 Session reader。
- 不把动态 prompt 当作默认能力；必须以模型 capability 为闸门。

## 9. 下一步决策点

在进入代码实施前，需要确认以下顺序：

1. 是否接受 `0.1.5-alpha.1` 作为隔离测试运行时，而不是覆盖当前 `0.1.1-rc.2`。
2. 是否先做 Phase 0～3 的兼容和回放验收，再做功能增强。
3. relay 的双向子代理控制是否作为第一项跨组件协议升级；若确认，先单独维护协议计划，不与 Session API 迁移混做。
4. endless 多模态记忆是否先执行一条真实图片 distill spike，再决定附件存储方案。

本稿只形成升级路线和评估，不代表已获准修改三个仓库代码。
