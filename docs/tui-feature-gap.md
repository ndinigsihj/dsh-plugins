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
| M1c ✅ /model 会话中切换 | 已落地（2026-08-22 fork 官方 recipe；2026-08-27 改为热切换）：同一会话安装 `installModelSelection` 可变引用，写 `selectionRef.current` 下一轮生效；保留 fork 作无 seam 降级；effort 透传，新路由不支持则清空；路由真值 = `liveRoute`（同步改），选择器 current 标记据此显示。设计：`docs/model-hot-switch-design.md`；spike：`experiments/model-hot-switch-spike.test.ts` + `model-hot-switch-live-spike.mjs` | tsc 通过；真实树 spike 通过；TUI 手工验收见设计稿 §5.2 |
| S1 ✅ 补全（2026-08-22 落地，原定半天 spike） | Editor 接 `CombinedAutocompleteProvider`：命令源 = `services.commands.list(agent)` 全量注册表 + 本地别名（resume/preset 带参数补全，走既有 picker 数据），文件源 = cwd（pi-tui 原生 `@`/`#` 自动触发 + Tab 上下文分支：斜杠上下文→命令菜单，否则→文件补全；列表打开时 ↑/↓ 选、Tab 应用、Enter 应用并提交斜杠命令、Esc 取消）。顺带修两处全局按键交互：空闲 Esc 放行给编辑器（补全菜单可用 Esc 关闭，此前被全局 handler 吞掉）、空闲 Ctrl+C 改为双击退出（此前单按即退出，会误伤关菜单） | 冒烟通过（/前缀模糊过滤、/resume 参数补全、@ 不抛错）；待活体验证 |
| M1 ✅ 白送档（2026-08-22 落地） | `/new`（M1a）；`/compact` 转发核心注册表 command-compact（dsh-base 已挂，compaction/end 事件进 transcript；顺带修正 execute 调用签名 images/signal 位）；`/cost` = projections `tokenUsage` 扁平四桶（wire view 即桶对象、无 `totals` 包裹层，2026-08-23 对安装包源码核实并修正；全零桶视作零样本走 meter 回退）+ billed/grand 汇总（无定价数据，token 口径），无投影时回退 tokenMeter 估算；`/tokens` = `contextPressure` 的 window/next-request/pct/last-reported + meter total；Ctrl+O 全局折叠思考与工具详情（默认收起，错误行保持可见，redrawAll 重绘）；rename/rewind 已随 tui profile 迁移并入 | tsc 通过；待活体复测 |
| M2 小活档 ✅ | 已落地（2026-08-22）：会话浏览器预览（/resume 选中即显 turns/route/时间范围/首问；300ms 防抖 + 按会话缓存 + 代际防竞态）、`/export` Markdown（lib/export.ts 纯序列化，工具卡有界渲染）、多选问卷（接通 multiSelect 线字段 → CheckboxList，space/a/enter/esc）、状态行增强（流式 ~t/s 滑窗粗估 + out token 明细；可牺牲前缀语义，ctx gauge 永不截断） | 导出 markdown 可读；问卷 Space 多选提交正确；待活体复测 |
| M3 中活档 ✅ | 图片附件已随 B2 落地；双击 Esc 回溯 UI 已落地（2026-08-26，设计 docs/m3-rewind-ui-design.md）：任意 idle Esc 武装 600ms 窗口（D1=A；取消/移除图片等 consume 路径不武装），双击弹 `pickRewindPoint` 选择器（`[seq] 摘要` 与 /rewind 列表同规则同截断），选中合成 `/rewind <seq>` 走 commands.execute 原路下发——fork + 文件逆向恢复 + execve resume 全部留在插件，引擎零改动；未挂 dsh-rewind 时 notice 降级。落地后连修四点：粘键 `ctrl+alt+[` 映射、resume 数据源兜底、触发键 consume、fork flush + argv 剥旧 --resume + 失败降级新会话 | tsc 通过；✅ 活体验证通过（2026-08-26，含 V2 全链路：fork 重启 + 边界截断） |
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

## 9. host 0.1.1-rc.2 能力盘点：可用未接清单（2026-08-24，续盘 2026-08-27）

口径：`dsh-base` bundle 已把绝大部分 host 服务挂进每个 profile（含 sqlite 会话查询、
压缩、spill、审批瀑布），"未利用"分两种——服务在跑但 TUI 前端没接（A 组/B 组），
和整链未挂载。逐项实现，顺序即排期。

> 2026-08-27 续盘：新增 A7–A10（已挂载/低配可开）、B6–B10（小量接线）、C 组细化与
> 不适用项补全。A3 行同步修正为"计数/时间范围已覆盖、时序细分留给 B6"。

### 9.1 A 组：服务已在跑，TUI 直接可吃

| # | 能力 | 现状 | TUI 落地点 |
|---|---|---|---|
| A1 | `dsh-session-projection-cache`（持久投影缓存 + 冷读阶梯） | 已挂未消费 | ✅ 两步落地（2026-08-24）。spike 结论：cache 服务的是投影不是转录行，重建加速不成立；第一步 resume//new//model 种子改读注册表整值（seedProjections）；第二步注册自有 `tuiPreview` 投影单元（counts/route/时间范围/首末问），`/resume` 预览走 `coldSnapshot(id)` 冷读阶梯（缓存行 + 尾部回放 + 写回），全量 readSession 降为兜底。cache 以 writeEveryEvents=400/writeIntervalMs=30s 挂入 tui 与 tui-dev |
| A2 | `dsh-permission-presets`（sandbox 档 + approval 策略 select，写会话事件） | base 已挂无入口 | ✅ 落地（2026-08-24）：`/permission` 选择器——preset 表声明序 + `current` 折叠标注 ← current，custom 状态先提示再选；写走 `set()`（记录 preset 意图 + knob 事实，回放权威）；running 否决对齐 /effort |
| A3 | `dsh-session-stats`（整段对话计数 + LLM/tool/TTFT/decode 墙钟投影） | 未挂载；计数与时间范围已由 A1 `tuiPreview` 覆盖 | counts/time 不重复引入；**时序细分（llmMs/toolMs/ttftMs/decodeMs+decodeTokens）仍可吃 → B6** |
| A4 | `ctx.jobs` 后台任务注册表 | 工具已挂前端无显示 | ✅ 落地（2026-08-24）：底部 `▣ jobs` 行，与子代理行同构（折叠一行 ×N · 最新 label；Ctrl+O 展开逐条、stopping 置灰）；owner-fenced `list(agent)` 同步读，复用 tool/turn 生命周期触发刷新 |
| A5 | `dsh-spill-policy`（超长工具结果落盘 + 定位符） | base 已生效 | ✅ 落地（2026-08-24）：ToolRow 对 terminal/generic 卡结果做后处理，spill 通知句渲染为 `⤓ full result <locator>` 黄色徽标（正则单次匹配、无 lookbehind） |
| A6 | `dsh-goal` + `/goal`（同会话目标状态） | 工具已挂无显示 | ✅ 落地（2026-08-24）：目标常驻条 `◎ objective · round N/M`（phase 着色：active 青/paused 白/blocked 红/complete 绿），读 goal 投影整值；goal/* 事件与 tool/turn 触发刷新，boot//new/model 切换同步重种 |
| A7 | `sessionQuery.traceSession()`（会话血缘：ancestors→root + descendants 树） | 已挂载未消费 | `/trace`：当前会话的 fork 祖先/后代树；`/resume`/rewind 预览可标 `forked from …`；纯服务接线 |
| A8 | `sessionQuery.traceEvent()/readEvent()/listEvents()`（事件级溯源、邻近窗口、轻量事件列表） | 已挂载未消费 | 工具卡 drill-down：查看被 shadowed 前的事件或相邻窗口；rewind 选择器可展示被替换链 |
| A9 | `sessionQuery.searchSessions()/searchEvents()`（FTS5 会话全文） | 已挂载但 `openAt: never`（SQLite 不开，搜索恒报 `SESSION_QUERY_SEARCH_DISABLED`） | profile patch 给 `session-query-sqlite` 行配 `openAt: first-search` + 持久 `path`；加 `/search [query]` 跨会话搜索，返回 session hit + snippet（240 字）列表；搜索范围与命中定位分析见 §9.6 |
| A10 | `dsh-command-feedback`（`/feedback <text>`） | base 已挂全局命令，走注册表 | 免费：slash 菜单应已能出；补 HELP_TEXT 一行 + 可选 notice；无需新挂载 |

### 9.2 B 组：小量接线

| # | 能力 | 现状 | TUI 落地点 |
|---|---|---|---|
| B1 | `dsh-file-reference-local`（@file 标准语法 + 模糊索引） | 补全用 pi-tui 自带 cwd 遍历 | ✅ 落地（2026-08-25）：FileReferenceAutocomplete 组合 provider——命令与语法仍由 pi-tui 处理，@ 上下文候选项替换为 harness 发现阶段结果（空/失败回退 cwd walk；applyCompletion 原样委托，item/prefix 保持内层约定）；挂载进 tui-dev |
| B2 | `dsh-attachment(-local)`（内容寻址附件存储） | 整链未挂 | ✅ 落地（2026-08-25，设计 docs/image-attachment-design.md）：`/img <path>…` 队列 + 粘贴图片路径自动入队 + ambient chips 行（esc 移除）；提交时 saveImage 逐张入库、失败整条退回；消息组装 text+image blocks；转录/导出 `[图片 id]` 占位。attachment-local 挂载进 tui-dev |
| B3 | `dsh-session-reference`（跨会话快照引用） | 未用 | ✅ 落地（2026-08-25）：@ 菜单并入 session 候选（`remoteExportCandidates` cwd 亲和排序，`⌗ label · cwd · 时间`），选中插入规范 `@[label](dsh-session:…)` mention；resolver 自挂 pre-step 在请求时展开快照（预算/去重/排除自身均服务内建）；挂载进 tui-dev |
| B4 | `dsh-mcp-client`（MCP 服务器桥接） | 全链未挂 | ✅ 落地（2026-08-26，设计 docs/mcp-inventory-design.md）：mcp-everything（官方测试器）挂进 tui-dev 验链路；`/tools [filter]` 每次现读 agent-scope `schemas()`——天然反映 MCP 再同步/重连后的目录，mcp__ 工具按 server 聚合逐条带截断描述、原生折叠名单 |
| B5 | `dsh-plan-mode`（计划评审退出） | preset 已挂走通用审批卡 | ✅ 落地（2026-08-25）：exit_plan_mode 的 ask 特化为 PlanReviewCard（📋 标题 + 计划正文内嵌 14 行预览/全文指向转录卡；a 批准并退出 / r 继续规划 / esc 取消）；Approve 按服务比对常量原样返回，非批准由服务自述叙事；挂载面不变（base 已有）|
| B6 | `dsh-session-stats`（`sessionStats` 投影：turns/steps/llmMs/toolMs/ttftMs/decodeMs±tokens） | 未挂载 | 一行挂载；`/stats` 或状态行加 `llm 12s · tool 3s · ttft 1.2s · 32 tok/s decode`；值走 `sessionProjections.snapshot`，与 A3 不重复 |
| B7 | `dsh-message-feedback`（每条 finalized assistant 消息持久 ±note，CAS 版本） | 未挂载 | 一行挂载（inject `storageDomain`/`sessionPersistence`/`sessions`，config `maxNoteBytes`）；transcript 行保留 `message.id`，行内键 `f` 评 +/-、可加 note；小 UI |
| B8 | `dsh-workspace`（workspace 注册表：标题/顺序/归档/会话归属） | 未挂载 | 一行挂载（inject `storageDomain`/`sessionPersistence`）；`/workspace` 列出/新建/重命名/归档；TUI 的 workspace 概念从 `basename(cwd)` 升级为注册实体 |
| B9 | `dsh-schedule`（会话级持久 after/at/every 提醒） | 未挂载 | 挂载后根 agent 自动获得 `schedule_*` 模型工具；TUI 可额外折叠 `schedule/change` 事件显示 `⏰ N reminders`；纯模型面也可先用；语义与应用场景见 §9.7 |
| B10 | `dsh-authorization`（OAuth/粘贴码式凭据获取） | 未挂载 | 挂载后 `ctx.authorization`；TUI `/login` 用现有 Ask/Notice 弹层渲染 text/secret/select prompt；当前无 OAuth provider 时低优先 |

### 9.3 C 组：可选/实验

| 能力 | 说明 |
|---|---|
| `dsh-schedule`（会话级持久 after/at/every 提醒） | 有 `schedule_*` 模型工具（B9）；TUI 只做提醒显示则自包一层折叠 |
| `dsh-code-runtime-worker-thread` + `dsh-agent-tool-presentation` | 官方 Code Mode：preset 加 presentation row（`mode: code/both`）+ 挂 worker runtime；模型面变单 `run_code`；需动 preset |
| `dsh-terminal` + `dsh-terminal-bash` + `dsh-tool-bash-persistent`（+ pwsh 同族） | 持久 PTY 栈：模型可开 owner-scoped shell；TUI 潜在 `/shells` 面板（list/read/send/signal/kill） |
| `dsh-tool-cordis` + `dsh-cordis-host-runner` | 动态插件：模型可 define/run Cordis 插件；TUI `/plugins` 不必挂 Remote-only 的 host-plugin-inventory，同进程直接读 `ctx.loader` 即可 |
| `dsh-time-context` / `dsh-tmux-context` | 模型每步上下文（当前时间 / tmux pane）；非 TUI 表面，需要时间/tmux 感知再挂 |

### 9.4 明确不适用

`client-ui-*` 全家（Web 渲染半边）、host-webserver/frontend-static/api-gateway/
api-remotes（Web 托管栈）、telemetry/typert/invariants（基础设施）、theme/locale
（不做档）、directory-picker（Web GUI host）、pwsh/windows-acl/landlock（非本机场景）。
另：`dsh-session-log-export` 的 Web `/export`（ZIP）与本 TUI 已有 Markdown `/export` 命令
冲突，不挂；`dsh-host-plugin-inventory` 是 Remote-only，TUI 同进程直接读 `ctx.loader` 即可，不必挂。

### 9.5 实施顺序

A1 → A2 → A3 → A4 → B2（并入 M3 图片附件）→ A5 → A6 → B1 → B3 → B5 → B4 → C 组按需。
每项独立 commit，先小 spike 验服务语义再接 UI。

2026-08-27 续盘候选顺序：A7/A8（纯接线，免费）→ A10（帮助文本）→ A9（spike 验 FTS 配置与 Node 22 sqlite 行为）→ B6（小）→ B7/B8/B9/B10（中）→ C 组按需。

### 9.6 A9 全文检索：搜索范围与命中定位分析（2026-08-27）

A9 继续探讨的定稿：`searchSessions` / `searchEvents` 的语义、可定位粒度与 TUI 呈现边界。

#### 9.6.1 搜索范围：不只是当前会话

| 方法 | 搜索范围 | 返回粒度 |
|---|---|---|
| `searchSessions(q)` | 跨会话：全部 live + persisted 的 session（可按 `cwd`、时间、availability、parent 过滤） | 按 session 分组，每个 session 只给 `bestMatch`（最强命中的一条事件） |
| `searchEvents(q, sessionId)` | 单个指定 session 内 | 该 session 的**所有命中事件**，逐条返回 |

TUI `/search` 天然两段式：

1. 全局搜 → 列表显示 `session 标题 · 命中摘要 · 时间`（`bestMatch.snippet`）。
2. 选中 session → 若为当前会话，`searchEvents` 列出全部命中；若为其他会话，`readEvent(sessionId, seq, before/after)` 读上下文预览，再 `/resume` 跳过去。

#### 9.6.2 可定位性：事件级（seq），非字符偏移

| 字段 | 含义 | 定位能力 |
|---|---|---|
| `hit.seq` | 命中所属 session 内的事件序号 | ✅ 精确到事件 |
| `hit.snippet` | FTS5 highlight 摘出的纯文本片段（默认 ≤240 字符） | 显示命中上下文，但**不提供字符级 offset** |
| `hit.type / surface` | 事件类型、current/shadowed/log-only | 决定是否可直接跳当前 transcript（如 shadowed 行当前不可见） |

TUI 定位能力：

- **当前会话内**：transcript 行本身带 `seq`（`TranscriptRow.seq`），`searchEvents` 返回 `seq` 后可滚动/高亮到对应行，再在行内按 snippet 首现二次匹配定位显示。
- **跨会话**：不能直接跳目标 transcript（不在内存），但 `readEvent({ sessionId, seq, before, after })` 可取命中事件 + 前后窗口做 preview；确认后 `/resume <id>`，重建 transcript 后再按 `seq` 跳行。
- **不提供的**：无"命中在整条 assistant 消息内第 N 个字符"的精确坐标；snippet 已环绕命中高亮片段，配合行内匹配足够定位到显示位置。

#### 9.6.3 两个坑

| 坑 | 说明 | 对策 |
|---|---|---|
| FTS5 是 token 匹配，不是子串 | `unicode61` 分词下 `AI` 搜不到 `BRAID`；语义是词/短语，不是 grep | 需要字面子串时用 `sessionQuery.filterEvents({ kind: 'text', text })`（字面量扫描），速度与高亮不如 FTS；UI 提示"全文检索是词匹配" |
| 跨会话只给 bestMatch | `searchSessions` 每 session 只给最强一条，看全部命中需再 `searchEvents` | 两段式 UI 天然覆盖：先选会话，再看该会话全部命中 |

#### 9.6.4 建议交互（仅设计，未排期）

```
/search <query>
├─ 跨会话结果：session 列表（标题 + best snippet + 时间）
│  ├─ 选中当前会话 → searchEvents 列出全部命中，滚动到 seq 行并高亮 snippet
│  └─ 选中其他会话 → readEvent 预览窗口（命中 + 上下文）→ /resume <id> 后跳 seq
└─ 支持 cwd: 过滤（默认当前 workspace？）
```

结论：**能定位**。跨会话定位到"事件 + 上下文"，当前会话还能进一步定位到 transcript 行内命中；服务端不提供字符级坐标，但对 TUI 交互不是障碍。落地前建议先做小 spike 验证 `searchSessions/searchEvents` 返回的 snippet 与 seq 在真实日志上的对应，再定 UI 细节。

### 9.7 B9 dsh-schedule：概念与应用场景（2026-08-27）

一句话定位：**dsh-schedule = "给这个 agent 会话自己设的闹钟"**。你（或模型）在对话里
跟 agent 说"30 分钟后提醒我做 X"，到点后 agent 会在同一个会话里主动开口提醒——它不会像
cron 那样在后台独立干活，也不会弹系统通知。

#### 9.7.1 典型场景

| 场景 | 具体例子 | 为什么适合 |
|---|---|---|
| 延迟跟进 | "20 分钟后提醒我检查测试结果" | 提醒落在原会话里，agent 记住上下文，能直接继续看结果 |
| 会话内周期汇报 | 长任务中"每 30 分钟给我汇总一次进展" | agent 到点自己插话汇报，不需要你反复催 |
| 跨重启的待办 | "2 小时后提醒我重新权衡这个方案"；中途进程关了 | `schedule/change` 写在会话日志里，resume 后 agent 会补处理 overdue |
| 让 agent 自管理节奏 | 多步骤任务里"每步完成后 5 分钟提醒我 review" | 模型可以自己创建/删除提醒，控制权在对话内 |

#### 9.7.2 完整画面

```
45 分钟后提醒我部署前再看一眼 migration
→ agent 调 schedule_create({ after_seconds: 2700, prompt: "..." })
→ 会话日志记一条 schedule/change

45 分钟后（会话还开着、agent idle）：
→ 调度器向 agent 队列塞一条提醒
→ agent 主动回复："提醒你：现在该检查 migration 了。"
→ 继续对话

若 45 分钟前已关闭 TUI：
→ 不响；下次 /resume 回来发现 overdue，补提醒一次
```

#### 9.7.3 与 cron 的边界（它不做什么）

| 你可能想要的 | dsh-schedule 能不能 |
|---|---|
| 凌晨 3 点自动跑备份（当时没有会话） | ❌ 会话不活就不跑 |
| 手机/桌面弹通知 | ❌ 只投递到会话 transcript |
| `0 2 * * *` 这种 cron 表达式 | ❌ 只支持 after / at / every（≥5 分钟） |
| 独立执行 shell 脚本 | ❌ 只投递给模型，让模型决定怎么做 |
| 错过多个周期后逐个补跑 | ❌ every 只补最近一次，避免 backlog 堆积 |

#### 9.7.4 判断标准

- 想要"**这个 agent 到点了自己提醒我/自己继续**" → 合适。
- 想要"**机器到点自动执行某个动作，和人/会话无关**" → 不合适，走系统 cron 或独立服务。

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
