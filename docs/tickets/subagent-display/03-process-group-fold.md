# A3 — 四档展示模式（Ctrl+O 循环）〔deferred：已摘出第一切片〕

**Status:** deferred（2026-09-28 二稿；三轮 grilling 裁决摘出第一切片，另行立票时重新论证）

**摘出理由（2026-09-28 裁决）**

- 它是第一切片里唯一与子代理无关、且改动面最广的一票（`detailsExpanded` 被思考/工具/diff/气氛行共享），与「让 0.1.7 已有能力可见」的切片目标不内聚。
- 自评最大不确定性是「compact 与 standard 体感差异弱」——存在白做一档甚至白做一票的可能，需要它自己的签收口径。
- 二稿契约复核补正：上游 Web 的四档真实控制面不止「收起已完成轮次」——`dsh-client-ui-chat/lib/client.js:11916-11945` 的策略矩阵还含 `stepGrouping`（`collapsed`/`history`/`none`）、`liveProcessDetail`、`settledReasoningPreview` 三轴（`docs/tui-feature-plan.md` §3.4）。本 TUI 是扁平行列表、没有 turn-level 过程组，四档映射必须重新论证，不能靠名称对齐成立。
- 因此本票**不在第一切片**：`docs/tui-feature-plan.md` §1/§5/§7 已同步；下面的设计保留为一稿输入，另行立票（含自己的 grilling 与 spike）时重新裁决。

---

## 一稿正文（保留待重新论证；状态与施工图引用均为一稿口径）

**What to build:** 把 `Ctrl+O` 从「展开/折叠」布尔升级为四档循环 `compact → standard → detailed → verbose`，对齐上游 Web 的档位词汇（简洁/标准/详细/完全展开），但只作用于本 TUI 现有的折叠面（思考、工具卡、diff、注入/气氛行）——上游的 turn-level 过程组不在本票。

**Blocked by:** 无；因改动面最广，排在 A1/A2/A4 之后执行。

**Status（一稿）:** proposed（2026-09-28；待功能计划批准后开工）→ 现行状态见文首 `deferred`

**施工图:** `docs/tui-feature-plan.md` §3.4、§4.3

**改动面**

- `lib/app.ts`：
  - 新 `type DisplayMode = "compact" | "standard" | "detailed" | "verbose"`（对齐 0.1.7-rc.1 `TRANSCRIPT_VIEW_MODES`；上游 legacy 值 `expanded`/`normal` 不采用，本票不读 settings） + 纯函数 `nextDisplayMode(mode)`；默认 `standard`。
  - `detailsExpanded`（1926）改为派生：`mode === "detailed" || mode === "verbose"`；新增 `isFull()`（仅 verbose）供 cap 解除。`isExpanded()` 的现有消费者（AssistantRow 412/458/467、ToolRow 522/533、气氛行 2102/2233/2269）语义不变。
  - `toggleDetails()`（2375-2382）→ `cycleDisplayMode()`：切换后照旧 `transcriptArea.redrawAll()` + `renderTodosLine()`/`renderSubagentsLine()`/`renderJobsLine()` + `render()`；切换时 `showNotice` 报档位名（含档位短说明）。
  - cap 语义：`compact` 收紧 diff 折叠（建议 8 行）；`verbose` 解除 `DIFF_COLLAPSED_CAP = 24`（349）与 `TOOL_LINES_CAP = 40`（355，含 diff stub、工具体截断）；`standard`/`detailed` 维持现状 cap。
  - 思考行：`compact` 不显示流式 3 行预览（只留摘要行，`buildCollapsed` 427-451 分支）；`standard` 现状；`detailed`/`verbose` 全文。
  - 文案（434、524、2124、2238、2254、2288）改为档位感知，不再写死 `Ctrl+O expands`；`HELP_TEXT`（`lib/index.ts:98-125`，Ctrl+O 行 124）补一行四档说明。注意现状：subagents 折叠行（2261-2276）本来就没有 Ctrl+O 字样，需**新增**而非替换；ToolRow 的 40 行截断 stub（599-602）也只有 `… N more lines`、无提示。
- 测试：
  - 单测：`nextDisplayMode` 循环、派生 `detailsExpanded`/`isFull`、四档下 `ToolRow`/`AssistantRow` 渲染差异、resize 下 compact 预览不回流。
  - `lib/app.test.ts` 目前没有 Ctrl+O 断言：本票补四档循环与逐档渲染的 T4a 断言；既有断言若受档位影响必须显式更新，`lib/transcript-area.test.ts` 保持绿。

**验收**

- [ ] 四档循环与派生契约单测通过；`compact`/`standard`/`detailed`/`verbose` 渲染差异逐档断言
- [ ] `verbose` 解除两个 cap；`compact` 收紧 diff 折叠；无档位下内容不可见性回归
- [ ] resize 后 compact 不出现流式预览回流（宽度变化触发重排的既有契约保持）
- [ ] 提示文案与 `HELP_TEXT` 同步；不再出现「Ctrl+O collapses」这类二义文案
- [ ] `lib/app.test.ts` 新增四档循环断言；受影响的既有断言显式更新（不得静默改口径）
- [ ] `npx tsc --noEmit` exit 0；`npm test` 全绿；`scripts/regression-gate.sh --tier 0,1` 零豁免
- [ ] 证据归档（T4a 输出 + 切片收口 PTY 双 profile）

**未决（立票时请用户签收）:** compact 与 standard 的体感差异；不足则由用户裁决砍成三档；四档与 Web 三轴策略（`stepGrouping`/`liveProcessDetail`/`settledReasoningPreview`）的映射口径。

**范围外:** 上游 turn-level 过程组（组头/组状态机）、档位持久化（settings 命名空间）、主题/i18n、气氛行之外的布局变化。
