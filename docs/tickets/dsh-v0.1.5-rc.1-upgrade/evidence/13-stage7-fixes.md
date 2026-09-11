# Stage 7 修复证据 — Stage 6 review findings 的处置

日期：2026-09-11（本地 11:30–11:45；探针时间戳见 §1/§2）
执行：ask-matt-flow Stage 6（code-review 双轴并行）→ 用户 triage → Stage 7 Debug/Repair
范围：仅处置用户选中的三项；其余 findings 按「非必要不动」不修或仅记录。未 commit/push。

## 0. 裁决与处置对照

| Stage 6 finding | 用户裁决 | 本文件 |
| --- | --- | --- |
| Standards #4 契约文档未随改动更新 | 纳入 Stage 7 | §3 |
| Standards #5 分层契约冲突（forkPersistedChild） | 纳入（加注记，不改代码） | §3 |
| Spec #2 a7 未断言 effort 继承 | 纳入 Stage 7 | §2 |
| Spec #4 seeded 子会话 hover 预览失效（06-4） | 纳入 Stage 7 | §1 |
| Standards #1/#2/#3 与基线异味（300 行 / 50 行 / 重复代码 / 死接口面 / 命名） | 不修，仅记录 | §5 |
| Spec #1 commandcode 字面未裁剪 | 既有裁定（额度类保留）+ 复测开环 | 票据 13 开环项，14:21 后复测 |
| Spec #3 `.gitignore` 新增 `.dsh/` 属范围蔓延 | 未选中（视为驳回/仅记录） | §5 |

## 1. 关闭 finding 06-4：seeded（rewind/fork）子会话 hover 预览

### 1.1 根因（真实 fixture 复现）

`sessionQuery.readSession` 的 snapshot 构造要求 seeded 日志 `inheritedEventCount === events.length`；
fork/rewind 子会话 append 启动事件后必然违反。真实 fixture（票据 06 的 rewind 子会话
`session-6846f8fa-18eb-4ce8-8f85-4b6a36b37aff`，`~/.dsh/sessions/--private-tmp-dsh-ticket06-ws3--/`，
68 事件、inherited 34）实测抛：

```
seeded session constructor seed must equal its inherited prefix
```

现行 TUI `sessionPreview` 只走 `readSession`，异常被 `catch` 吞掉 → 预览恒为 null。

### 1.2 反馈回路（先红后绿）

运行：`experiments/session-preview-seeded/run.sh [sessionId]`（默认上述 fixture；零 LLM，只读会话）

- 红线（修复前实跑）：`red-readSession-rejects-seeded` PASS（复现根因）；`green-reader-module-present` FAIL → exit 1。
- 绿线（修复后实跑，2026-09-11T03:35:31Z → 03:35:33Z）：**8/8 pass**，exit 0。
  - `green-log-reconstructed`：2 个分块重建 68/68 事件（窗口 ≤50）；冷调用 598ms、二次调用 524ms。
  - `green-count-and-seq-match`：事件数 68 = `listEvents` 68，seq 0…67 逐一相等。
  - `green-inherited-count-recorded`：inheritedEventCount = 34。
  - 对照 `baseline-readSession-fastpath`：同目录非 seeded 父会话 `readSession` 65 事件 / 180ms。

原始报告：`evidence/13-seeded-preview-probe.json`（sha256 `015e6e18…`）。

### 1.3 修复设计（方向 A：语义等价回退）

- 新增 `lib/session-preview-log.ts`：`readPreviewLog(query, sessionId, windowSize=50)` 用
  `listEvents`（完整 seq/type 清单）+ `readEvent` 分窗（`after ≤ readWindowMax`，本部署默认 50，
  已核 dsh-base 与 profile dump 无覆盖）重建 `{session, inheritedEventCount, events}`；
  覆盖数/seq 与清单不一致、窗口缺失或调用方捕获到异常时返回 `undefined`。
- `lib/index.ts` 的 `sessionPreview` 抽出 `previewFrom()`：先试 `readSession`（快路径与缓存身份不变），
  失败后走 `readPreviewLog` 再喂同一 `coldSnapshot` + `buildPreviewFromEvents`；两步都失败仍返回 null。
- 成本与 UX：seeded 预览由 1 次 corpus 读变为 3 次（listEvents + 2 窗），600ms 量级；
  picker 已有 300ms 防抖 + 每会话结果缓存 + generation 丢弃（`lib/app.ts:1190-1219`），
  首次显示 loading、回看命中缓存，不阻塞选择。

### 1.4 残留与边界

- fixture 是机器本地会话；探针可用参数/`SEEDED_SESSION_ID` 换任一 seeded 会话，fixture 丢失时需另备。
- 本部署未覆盖 `session-query.readWindowMax`（默认 50）；若未来调小，`readEvent` 抛
  invalid-window，回退按设计返回 null（不比修复前差）。
- 修复只影响 hover 预览读取；`readSession` 的 seeded 限制本身属宿主行为，TUI 继续用
  `listEvents`/`readEvent` 绕行（与 `resumeFactEvents` 同源）。

## 2. Spec #2：a7 补 effort 继承断言

`experiments/subagent-model-selection/probe.mjs` 的 a7 由「provider/model 相等」改为
「provider/model/reasoningEffort 全部相等」，2026-09-11T03:36:15Z → 03:36:47Z 真实模型重跑：
**16/16 pass**；a7 父子同为 `opencode-go/deepseek-v4-flash` + `reasoningEffort: "max"`。

- `probe.mjs` sha256 `9ab95631…`（补强前 `6a51fdf2…`）
- `evidence/11-probe.json` sha256 `d448a2d5…`（重跑版；旧版 `eb986337…` 已在
  `evidence/11-subagent-model-selection.md` 记录）
- 证据文档 §1/§5/§7 已同步。

## 3. 契约文档同步（Standards #4/#5）

- `ARCHITECTURE.md` §3：`ctx.userQuestions` 行改为 rc.1
  `ctx.on('user-questions/request', …)` waterfall（服务对象只作挂载探测）。
- `ARCHITECTURE.md` §1：新增例外注记——`/rewind` 的 fork 子会话落盘经
  `tuiHandoff.forkPersistedChild` + `agents.create` 走宿主生命周期（票据 06 用户裁定），
  是分层原则的唯一例外，不扩展到其他 agent/session 操作。
- `README.md` §Agent presets：拆出 `minimal-plus`（stable）与
  `minimal-plus-next`（dev / rc.1）两节；后者记录 ADR-0002/0003 差异、`npm test` 指向、
  `sync-agent-presets.sh minimal-plus-next` 部署与模型选择文档入口。

## 4. 验证

| 项 | 结果 |
| --- | --- |
| 06-4 反馈回路（`experiments/session-preview-seeded/run.sh`） | 修复前 exit 1（红线）→ 修复后 8/8 exit 0 |
| `npx tsc --noEmit` | 0 错 |
| `npm test` | 97/97 |
| 模型选择探针（a7 含 effort） | 16/16 |
| 未触碰 | preset 内容、profile/settings、`presets/minimal-plus`（stable）、部署位、stable 运行时 |

## 5. 未采纳项（仅记录，未改）

- `probe.mjs` 377 行、`phase-swap-bash.test.mjs` 306 行、`phase-swap-bash.mjs`/`tool-bootstrap.mjs`/
  `compaction-epoch.mjs` 的函数超 50 行：本轮不重构。
- `probe.mjs`/`route-probe.mjs`/两份 patch 的重复路由表与 helper 重复：按需再抽。
- `lib/index.ts` 死接口面（`userQuestions.ask` 仅作挂载探测）与 306 行 diff 的 Divergent Change：
  按「非必要不动」保留，注释已说明用途。
- `trajectory-driver.mjs` 的 `name = "liangshen-trajectory"` 未随分叉改名（不影响行为）。
- `.gitignore` 的 `.dsh/` 忽略行保留（ask-matt-flow 状态非交付物）。

## 6. 改动清单（仓库）

| 文件 | 改动 | sha256 |
| --- | --- | --- |
| `lib/session-preview-log.ts` | 新增：seeded 预览日志回退读取器 | `ecedc0f9…` |
| `lib/index.ts` | `sessionPreview` 抽出 `previewFrom()` + 接回退；`readEvent` 类型补窗口字段 | `746f8e65…` |
| `experiments/session-preview-seeded/probe.mjs` | 新增：06-4 探针（红线/绿线 + 成本） | `88abd593…` |
| `experiments/session-preview-seeded/probe.patch.yml` | 新增：headless overlay（settings 副本；不重定向 sessions） | `31a6ef9c…` |
| `experiments/session-preview-seeded/run.sh` | 新增：运行器 | `4747aa5f…` |
| `experiments/subagent-model-selection/probe.mjs` | a7 补 reasoningEffort 断言 | `9ab95631…` |
| `docs/tickets/.../evidence/11-probe.json` | 探针报告（重跑版） | `d448a2d5…` |
| `docs/tickets/.../evidence/11-subagent-model-selection.md` | a7/§1/§5/§7 同步 | `d700906b…` |
| `docs/tickets/.../evidence/13-seeded-preview-probe.json` | 06-4 探针原始报告（8/8） | `015e6e18…` |
| `ARCHITECTURE.md` | userQuestions 行 + 分层例外注记 | `ef6c1298…` |
| `README.md` | preset 两节（stable/dev） | `c93e616f…` |
| 本文 | Stage 7 证据 | — |

**未提交**：以上改动（含 `lib/`）均未 commit/push，等待审阅。
