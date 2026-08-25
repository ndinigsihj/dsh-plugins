# 自研 TUI 吸收官方 dsh-TUI 常用功能 — 差距分析与路线

> 背景：对 `@deepseek-harness-tui/dsh-tui` 的使用体验持续不满意，评估将其常用功能吸收进本仓库的 pi-tui 版 TUI（`lib/app.ts` 等，约 1,900 行 TS）的成本。
>
> 对照基线：官方 npm 包 **0.8.1** 编译产物（本机全局 node_modules 一手核对，305 个 JS 文件 ≈ 51k 行）+ 其 README 快捷键/命令表；pi-tui `^0.84.1`（`node_modules/@earendil-works/pi-tui/dist/*.d.ts` 类型声明一手核对）。
>
> 关联文档：[`rc8-capability-assessment.md`](rc8-capability-assessment.md)（官方对 rc.8 的适配现状）、[`rewind-file-restore-plugin.md`](rewind-file-restore-plugin.md)（/rewind 插件方案）。
>
> **实现原则（2026-08-22 定）**：实现首先遵循 dsh 本体 / harness 标准服务的语义与机制，**不要求**与 `@deepseek-harness-tui/dsh-tui` 保持一致。官方实现只作交互参考与语义对照；凡 dsh 有原生机制的一律走原生（如 `ctx.settings` 命名空间、agentPresets roster、会话日志事实、commands 注册表），不为"跟官方一致"引入其私有约定（数据目录、环境变量等）。

---

## 1. 结论先行

| 问题 | 结论 |
|---|---|
| 能否直接搬官方代码 | ❌ 渲染器不同（自移植 Ink core/React reconciler vs pi-tui），只能照交互逻辑重写 UI 层 |
| 数据/服务层是否同构 | ✅ 两边都是 cordis 插件、消费同一批 `@deepseek-ai/dsh-*` 标准服务；官方命令自称"均走 DSH 官方链路"，意味着其能力在本 TUI 同样可取 |
| 吸收常用功能的成本 | 第一二档（白送 + 小活）合计约 **2–4 人日**，日常体验可达官方七八成 |
| 原 biggest risk（@ 文件补全） | 已排除：pi-tui Editor 内置完整 AutocompleteProvider 框架（见 §5） |
| 建议 | 按 §7 分档推进；先花半天做补全接线 spike 消掉最后一处不确定性 |

## 2. 两边基本盘

| | 本仓库 TUI | 官方 `@deepseek-harness-tui/dsh-tui` 0.8.1 |
|---|---|---|
| 渲染器 | pi-tui（第三方成熟库，命令式组件） | 自移植 Ink core（React 19 + react-reconciler） |
| 规模 | ~3,200 行 TS（`lib/`） | 305 个编译后 JS 文件，~51,000 行（另有 vendor/dsh-std workspace 包） |
| 挂载方式 | cordis 插件 patch-insert 进 profile | cordis 插件 bundle.patch + plugin-host/extensions 平台 |
| 已有能力 | 流式 markdown、思考折叠行、工具卡（presenter 视图）、`/resume` 搜索选择器、ask_user_question 单选 overlay、审批对话框、ctx% 占用、子代理状态行（5s 轮询）、execve 重启式 resume、OSC52→原生剪贴板 | 下表全集 |

## 3. 官方功能面盘点

来源：README 快捷键/本地命令表 + `lib/types/components/` 组件清单。

| 分组 | 内容 |
|---|---|
| 输入体验 | `@` 文件引用补全（任意位置、目录递归深入、图片持久附件）、命令补全菜单、Ctrl+R 历史、Ctrl+X `$EDITOR` 编辑、Ctrl+V 粘贴文本/图片、vim 模式 |
| 浏览导航 | `/` 会话全文搜索（n/N）、Shift+↑ 消息选择模式、Ctrl+O 展开/收起思考与工具详情、双击 Esc 时间回溯（rewind/fork） |
| 命令全集 | 会话：`/new` `/resume`（浏览器）/`/rename` `/workspace` `/clear` `/compact` `/export` `/trace`；状态：`/context` `/status` `/cost` `/doctor` `/config` `/init`；模型：`/model` `/thinking` `/tokens` `/theme` `/lang`；账号策略：`/provider` `/login` `/permissions` `/add-dir` `/hooks` `/mcp`；技能组：`/audit` `/bug` `/review` …；其它：`/agents` `/update` `/connect` |
| 状态展示 | 实时工作状态行、上下文分段进度条、TPS 仪表、缓存命中率、token in/out、git/会话信息、鲸鱼顶栏大字 |
| 渲染工程 | 流式 markdown、split diff 工具卡、消息虚拟化、差分终端输出、inline/altscreen 双模式、鼠标选区复制滚轮 |
| 产品化外壳 | 主题系统、i18n、自动更新 `/update`、VS Code companion 扩展、plugin-host/extensions/scenes/settings-sections |

## 4. 差距分级

| 档位 | 功能 | 预估 | 依据 |
|---|---|---|---|
| 白送 | `/new` `/compact` `/cost` `/tokens` | 每项 1–2h | 纯服务接线；compact 可先试经 `services.commands.execute(agent, "/compact")` 转发核心注册表；tokenMeter 已注入 |
| 白送 | `/rename` `/rewind` | ≈0 | `plugins/rename-session.ts`、`plugins/rewind-dsh.ts`（631 行含单测）已实现，并入 profile 即可 |
| 白送 | Ctrl+O 思考/工具详情折叠 | 半天 | `AssistantRow.reasoning` 字段已在，加折叠态即可 |
| 小活 | `/resume` 升级会话浏览器（预览面板、跨项目） | 0.5–1d | 搜索选择器已有；预览 = 读 session events 渲染前几条；`listSessions()` 已返回 cwd |
| 小活 | `/export` 导出 Markdown | 半天 | 从 TranscriptRow 序列化，纯函数可单测 |
| 小活 | 多选问卷（Space 勾选）、TPS/token 明细状态行 | 各半天 | SelectList 换自绘 checkbox list；TPS 从 chunk 流现算 |
| 中活 | `/` + `@` 命令与文件补全菜单 | ~1d | pi-tui 原生框架（§5）；主要工作是接 commands 注册表数据源 + 样式 |
| 中活 | 双击 Esc 时间回溯 UI | ~1d | fork/回滚逻辑 rewind-dsh 已有，缺触发方式 + 选择器 UI |
| 大活 | 会话全文搜索、消息选择模式、鼠标选区复制、图片粘贴附件 | 每项 1–3d | 依赖 pi-tui 能力边界，需逐个验证后再排 |
| 不做 | 鲸鱼顶栏/主题/i18n//update/VS Code companion/plugin-host 扩展平台 | — | 官方包的产品化外壳，非常用功能，与本 TUI 轻量定位冲突 |

## 5. 关键发现：pi-tui 自带补全框架

原以为 `@` 文件补全是最大风险（需 Editor 光标感知 + 补全下拉 + 插入回调）。一手核对 `dist/editor-component.d.ts` 与 `dist/autocomplete.d.ts` 后确认：

- `Editor.setAutocompleteProvider(provider)` / `setAutocompleteMaxVisible(n)` 原生暴露；
- `CombinedAutocompleteProvider` 开箱支持 slash 命令补全（`SlashCommand` 含 argumentHint、参数级 `getArgumentCompletions`）与文件补全（basePath + 可选 fd/rg 快速路径）；
- Provider 协议自带 triggerCharacters、光标行列感知（`cursorLine/cursorCol`）与 `applyCompletion` 回填。

官方是在 Ink 上手搓了这一整套；本 TUI 侧近乎白送，剩余工作只有两件：把 commands 注册表喂给 provider、调整补全下拉样式。降级为半天 spike（S1）。

## 6. 可直接复用的既有资产

| 资产 | 说明 |
|---|---|
| `plugins/rename-session.ts` | `/rename <title>`，走 `sessionTitle.rename()` 标准服务，注册表 handler 优先于 TUI 本地名 |
| `plugins/rewind-dsh.ts` + `.test.ts` | `/rewind <seq>`：sessions.fork 回退对话 + 工具日志逆向恢复文件 + execve 重启 resume；纯函数已单测 |
| `lib/app.ts#ApprovalCard` | 卡片式审批对话框（⚠ 标题 + tool/reason + 单键 a/r，待决调用行同步 ⚠ 高亮；allowed-once 是 seam 唯一授权项） |
| `lib/index.ts#relaunchToResume` | flush → chdir → execve 重启带 `--resume`，`/new` 与回溯类功能可直接复用该机制 |

## 7. 建议路线

| 阶段 | 内容 | 验收 |
|---|---|---|
| M0 圈清单 | 已定（2026-08-22）：本期范围 = /preset /new /resume 的会话生命周期，见 M1a | 本文档标注勾选结果 |
| M1a ✅ 会话生命周期 | 已落地（2026-08-22，同日按实现原则重构）：`lib/presets.ts` 结构化接入 `agentPresets`（零新依赖）；blank 判定走 recompose + `agent-preset/selected` 日志事实，非 blank 经 `ctx.settings` 写 `agent-presets` 命名空间默认值（roster defaultId 热生效）；部署钉选 = 本插件 patch 层 `preset:` config；/new 为 in-process 建 agent + 全量重绑定，/resume 保持 execve 重启（跨 cwd 持久化正确性） | tsc 通过；presets 纯函数冒烟通过 |
| M1b ✅ /model + /resume 收敛 | 已落地（2026-08-22）：/model 选择器走 `llm.listProviders/listModels`；/resume 与 /sessions 默认只列当前工作区（header.cwd 过滤），跨项目仍可 `/resume <id>`；未知命令不再静默无反馈；/resume 标签改用 readTitleSnapshots（去掉 50 次全量 readSession 的解码+回放校验，多 MB 日志下 30s→秒级）；resume 路由 = 用户规则（优先于官方 #67）：会话记录路由始终优先，**部署钉选只作用于新会话、不覆盖 resume**，记录缺失或已不存在才回退默认；路由真值统一为 `liveRoute`（boot//model 切换//new 都写它），状态栏标签与 /model current 判定同源 | tsc 通过；待活体复测 |
| M1b-fix ✅ /resume 窗口缺陷 | 缺陷（2026-08-23 发现）：`loadSessionItems` 先 `slice(0,30)` 截断再隐藏无标题——workflow 并发测试在同一 workspace 持久化约 19 个**带标题**的 continuable 子代理会话（首条消息是 spliced 目标文本，LLM 起了标题），一夜之间刷满最新 30 槽位，8/22 及更早的全部交互会话（含长 session）被无声挤出列表，表象为"只剩 29 个"。数据零删失，`/resume <id>` 始终不受窗口限制。修正设计：① picker 过滤 `header.origin === "subagent"`（core `filterSessions` 无 origin 子句，插件侧过滤；运行时 header 携带该字段）；② 先对全量本地记录读 readTitleSnapshots（projectMany 折叠，秒级）、隐藏无标题空壳后再截断 30——空壳不再白占槽位；③ `/sessions` 输出补 "N older hidden" 提示，截断不再无声 | tsc 通过；真实数据冒烟通过（本工作区 20 条带标题交互会话全部回到窗口，含全部长 session） |
| M1c ✅ /model 会话中切换 | 已落地（2026-08-22，官方 switchModel 同构）：running 否决 → `sessions.fork(agent.session)` 全量日志做种子 → 新 sessionId `agents.create`（同 preset、新路由）→ 回放种子事件 + adoptAgent 式全量重绑定；`saveSelection` best-effort 同步默认。路由真值 = 最后一条 `request/context` 记录（activeRoute()），选择器 current 标记据此显示 | tsc 通过；待活体复测 |
| S1 ✅ 补全（2026-08-22 落地，原定半天 spike） | Editor 接 `CombinedAutocompleteProvider`：命令源 = `services.commands.list(agent)` 全量注册表 + 本地别名（resume/preset 带参数补全，走既有 picker 数据），文件源 = cwd（pi-tui 原生 `@`/`#` 自动触发 + Tab 上下文分支：斜杠上下文→命令菜单，否则→文件补全；列表打开时 ↑/↓ 选、Tab 应用、Enter 应用并提交斜杠命令、Esc 取消）。顺带修两处全局按键交互：空闲 Esc 放行给编辑器（补全菜单可用 Esc 关闭，此前被全局 handler 吞掉）、空闲 Ctrl+C 改为双击退出（此前单按即退出，会误伤关菜单） | 冒烟通过（/前缀模糊过滤、/resume 参数补全、@ 不抛错）；待活体验证 |
| M1 ✅ 白送档（2026-08-22 落地） | `/new`（M1a）；`/compact` 转发核心注册表 command-compact（dsh-base 已挂，compaction/end 事件进 transcript；顺带修正 execute 调用签名 images/signal 位）；`/cost` = projections `tokenUsage` 扁平四桶（wire view 即桶对象、无 `totals` 包裹层，2026-08-23 对安装包源码核实并修正；全零桶视作零样本走 meter 回退）+ billed/grand 汇总（无定价数据，token 口径），无投影时回退 tokenMeter 估算；`/tokens` = `contextPressure` 的 window/next-request/pct/last-reported + meter total；Ctrl+O 全局折叠思考与工具详情（默认收起，错误行保持可见，redrawAll 重绘）；rename/rewind 已随 tui profile 迁移并入 | tsc 通过；待活体复测 |
| M2 小活档 ✅ | 已落地（2026-08-22）：会话浏览器预览（/resume 选中即显 turns/route/时间范围/首问；300ms 防抖 + 按会话缓存 + 代际防竞态）、`/export` Markdown（lib/export.ts 纯序列化，工具卡有界渲染）、多选问卷（接通 multiSelect 线字段 → CheckboxList，space/a/enter/esc）、状态行增强（流式 ~t/s 滑窗粗估 + out token 明细；可牺牲前缀语义，ctx gauge 永不截断） | 导出 markdown 可读；问卷 Space 多选提交正确；待活体复测 |
| M3 中活档（按需） | 双击 Esc 回溯 UI、`@` 图片附件 | rewind 全流程不丢文件变更 |
| E1 思考强度 ✅ | 已落地（2026-08-23，实现 afd8f92）：`/effort` 选择器（resolveModelInfo 列档位、current/default 标注、会话作用域单写 ref、下一轮生效）+ 状态栏 `think <name>`（cyan）+ 欢迎屏 meta 追加；boot//new 先解析后渲染 banner，`/model` 切换后异步刷新。全骑官方缝：agentDefaultModel 读写 + resolveModelInfo + installModelSelection ref。设计：`docs/reasoning-effort-design.md` | tsc 通过；待活体复测 |
| 不做 | §4 "不做" 行所列产品化外壳 | — |

排序原则：先白送后小活，中活仅在 spike 通过后进入；每阶段独立 commit。

## 8. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| pi-tui Editor 光标 API 与 provider 签名的实际匹配度未经运行验证 | S1 可能超时 | S1 就是为此设的 spike，半天封顶 |
| `/compact` 经 commands 注册表转发的行为未知（可能要求特定 agent 状态） | M1 排期偏差 | 先手动验证，不通改走 sessions 服务直连 |
| 官方 0.8.x 迭代快，差距清单会漂移 | 追不全 | 只追"常用功能"档位，不追全集；版本差异在本文档记录基线 |
| rc.7→rc.8 peer 契约 drift（启动警告等） | 与官方包共用时的已知问题 | 见 [`rc8-capability-assessment.md`](rc8-capability-assessment.md) §4；本 TUI 直连 rc.8 服务不受影响 |

## 9. host 0.1.1-rc.2 能力盘点：可用未接清单（2026-08-24）

口径：`dsh-base` bundle 已把绝大部分 host 服务挂进每个 profile（含 sqlite 会话查询、
压缩、spill、审批瀑布），"未利用"分两种——服务在跑但 TUI 前端没接（A 组/B 组），
和整链未挂载。逐项实现，顺序即排期。

### 9.1 A 组：服务已在跑，TUI 直接可吃

| # | 能力 | 现状 | TUI 落地点 |
|---|---|---|---|
| A1 | `dsh-session-projection-cache`（持久投影缓存 + 冷读阶梯） | 已挂未消费 | ✅ 两步落地（2026-08-24）。spike 结论：cache 服务的是投影不是转录行，重建加速不成立；第一步 resume//new//model 种子改读注册表整值（seedProjections）；第二步注册自有 `tuiPreview` 投影单元（counts/route/时间范围/首末问），`/resume` 预览走 `coldSnapshot(id)` 冷读阶梯（缓存行 + 尾部回放 + 写回），全量 readSession 降为兜底。cache 以 writeEveryEvents=400/writeIntervalMs=30s 挂入 tui 与 tui-dev |
| A2 | `dsh-permission-presets`（sandbox 档 + approval 策略 select，写会话事件） | base 已挂无入口 | ✅ 落地（2026-08-24）：`/permission` 选择器——preset 表声明序 + `current` 折叠标注 ← current，custom 状态先提示再选；写走 `set()`（记录 preset 意图 + knob 事实，回放权威）；running 否决对齐 /effort |
| A3 | `dsh-session-stats`（整段对话计数 + 墙钟时间投影） | 未用，且无需挂载 | 由 A1 的自有 `tuiPreview` 单元覆盖（counts + 时间范围），不引入 dsh-session-stats |
| A4 | `ctx.jobs` 后台任务注册表 | 工具已挂前端无显示 | ✅ 落地（2026-08-24）：底部 `▣ jobs` 行，与子代理行同构（折叠一行 ×N · 最新 label；Ctrl+O 展开逐条、stopping 置灰）；owner-fenced `list(agent)` 同步读，复用 tool/turn 生命周期触发刷新 |
| A5 | `dsh-spill-policy`（超长工具结果落盘 + 定位符） | base 已生效 | ✅ 落地（2026-08-24）：ToolRow 对 terminal/generic 卡结果做后处理，spill 通知句渲染为 `⤓ full result <locator>` 黄色徽标（正则单次匹配、无 lookbehind） |
| A6 | `dsh-goal` + `/goal`（同会话目标状态） | 工具已挂无显示 | ✅ 落地（2026-08-24）：目标常驻条 `◎ objective · round N/M`（phase 着色：active 青/paused 白/blocked 红/complete 绿），读 goal 投影整值；goal/* 事件与 tool/turn 触发刷新，boot//new/model 切换同步重种 |

### 9.2 B 组：小量接线

| # | 能力 | 现状 | TUI 落地点 |
|---|---|---|---|
| B1 | `dsh-file-reference-local`（@file 标准语法 + 模糊索引） | 补全用 pi-tui 自带 cwd 遍历 | ✅ 落地（2026-08-25）：FileReferenceAutocomplete 组合 provider——命令与语法仍由 pi-tui 处理，@ 上下文候选项替换为 harness 发现阶段结果（空/失败回退 cwd walk；applyCompletion 原样委托，item/prefix 保持内层约定）；挂载进 tui-dev |
| B2 | `dsh-attachment(-local)`（内容寻址附件存储） | 整链未挂 | ✅ 落地（2026-08-25，设计 docs/image-attachment-design.md）：`/img <path>…` 队列 + 粘贴图片路径自动入队 + ambient chips 行（esc 移除）；提交时 saveImage 逐张入库、失败整条退回；消息组装 text+image blocks；转录/导出 `[图片 id]` 占位。attachment-local 挂载进 tui-dev |
| B3 | `dsh-session-reference`（跨会话快照引用） | 未用 | ✅ 落地（2026-08-25）：@ 菜单并入 session 候选（`remoteExportCandidates` cwd 亲和排序，`⌗ label · cwd · 时间`），选中插入规范 `@[label](dsh-session:…)` mention；resolver 自挂 pre-step 在请求时展开快照（预算/去重/排除自身均服务内建）；挂载进 tui-dev |
| B4 | `dsh-mcp-client`（MCP 服务器桥接） | 全链未挂 | 外部工具生态入口 + TUI 工具清单展示 |
| B5 | `dsh-plan-mode`（计划评审退出） | preset 已挂走通用审批卡 | ✅ 落地（2026-08-25）：exit_plan_mode 的 ask 特化为 PlanReviewCard（📋 标题 + 计划正文内嵌 14 行预览/全文指向转录卡；a 批准并退出 / r 继续规划 / esc 取消）；Approve 按服务比对常量原样返回，非批准由服务自述叙事；挂载面不变（base 已有）|

### 9.3 C 组：可选/实验

| 能力 | 说明 |
|---|---|
| `dsh-schedule`（会话级持久 after/at/fixed-rate 提醒） | 无模型工具面，需自包一层 |
| `dsh-code-runtime` + `dsh-agent-tool-presentation` | 官方 code preset 的 Code Mode（单 run_code），动 preset 可试 |
| `dsh-terminal(-bash)` 持久 PTY | preset 已挂 persistent bash；未来 `/shells` 面板 |

### 9.4 明确不适用

`client-ui-*` 全家（Web 渲染半边）、host-webserver/frontend-static/api-gateway/
api-remotes（Web 托管栈）、telemetry/typert/invariants（基础设施）、theme/locale
（不做档）、directory-picker（Web GUI host）、pwsh/windows-acl/landlock（非本机场景）。

### 9.5 实施顺序

A1 → A2 → A3 → A4 → B2（并入 M3 图片附件）→ A5 → A6 → B1 → B3 → B5 → B4 → C 组按需。
每项独立 commit，先小 spike 验服务语义再接 UI。

## 10. api-gateway 与自建 relay 的边界（2026-08-24 问答定稿）

问题：api-gateway 能否当 relay-server？多 relay-client 能否接入一个 api-gateway？

结论：

| 问 | 答 |
|---|---|
| api-gateway 是 server 吗 | 不是。它是 host 内的 Typert Remote 方法**分发器**（transport-agnostic）；真正对外的是 `dsh-host-webserver` 上由 `dsh-client-connection` 挂载的 `/api` 前缀——HTTP POST 上行 + WebSocket 事件流下行 |
| 多客户端接一个 host | 这正是它的设计场景（dsh web 即此形态）：ConnectionController 支持多连接，session 按 scope 隔离；非回环部署须声明 `trustedHosts`（浏览器信任栅栏，DNS-rebinding/跨站防御），特权方法钉死 loopback |
| 协议是谁的 | 官方 Typert remote 集（BFF 由 dsh-api-remotes 组装），不是自定义协议；认证是 trust fence 而非 token |
| 对 dsh-relay 的意义 | relay-server 若换成「跑 web 表面 + 讲官方 /api 协议」，可白得重连、事件复用、会话路由，但被绑进官方 wire 词汇表，且 endless 自有事件仍要自己带外传；relay 的 token 鉴权模型与 trust fence 不同构。多 host 聚合（一个 hub 收多个 host）api-gateway 不解决——那仍是自建 hub 的职责 |

落地建议：维持自建 relay 现状（协议自主、已测试）；若未来要"多个官方客户端连同一个
host"，直接启用 web 表面即可，不必经过 relay；两套并存时以场景划界——官方客户端走
/api，endless 同步走 relay。
