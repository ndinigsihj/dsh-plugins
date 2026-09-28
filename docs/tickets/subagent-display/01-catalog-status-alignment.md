# A1 — 子代理目录与状态对齐

**What to build:** 气氛行从「只显示 running 的直接子代理」升级为完整状态表达：`running` / `idle`（驻留等待，或 one-shot 收尾瞬态）/ `inactive`（不在注册表）分别可辨，unknown 模式绝不表现为可继续，可读时展示计时且随 1s 低配 tick 刷新。数据面取 0.1.7 真实契约（catalog + 活体注册表 + `subagentTiming`），不是旧票面里不存在的 phase/error。

**Blocked by:** 无（0.1.7 升级已收口、票据 14 已落地）。

**Status:** proposed（2026-09-28 二稿；三轮 grilling 已裁决口径，待开工）

**施工图:** `docs/tui-feature-plan.md` §3.1、§3.3、§4.1

**改动面**

- `lib/app.ts`：
  - `RunningSubagent`（82-86）→ `SubagentEntry`（`mode` / `state` / `label` / `createdAt` / `activeSince` / `settledMs`），`selectRunningSubagents`（1687-1697）→ 纯函数 `summarizeSubagents(children, liveOf, now?)`：running / idle / inactive 三态判定 + 计时合并 + 保持输入序。
  - `renderSubagentsLine`（2261-2290）：折叠 `◉ subagents ×N · <最新 label> <state tag>`（**N = 活条目数**；可见条件 = 存在 running|idle，活体指示器语义）；展开逐行 `<mark> <label> · <mode tag> · <state tag> · <计时>`，排序 **running → idle → inactive**（组内保持 catalog 输入序），cap `SUBAGENTS_EXPAND_CAP = 12`（195）与 `… N earlier` 保留；`unknown → (? unknown)`，绝不出 `(bg)`。
  - 新增 **1s 计时 tick**：仅在存在 running|idle 条目时启停，只重算气氛行（复用仓库既有 `setInterval` 模式，不引入新渲染原语）；抖动则回落静态计时并写明「非实时」。
- `lib/index.ts`：
  - `refreshSubagents()`（3696-3713）改为构造 `liveOf`：`agents.get(id)` 取 `status`；驻留时读 `sessionProjections.snapshot(child.session).values.subagentTiming`；**`active` 缺席或 `settledMs === 0` 视为无数据省略**（投影 key 对所有 session 都存在，真实降级形态不是「读不到」）。
  - `ProjectionValues`（365-397）补 `subagentTiming` 声明；`CoreServices.agents.get`（554-563）、`listChildren` 行类型（686-696）无需改签名。
  - 事件触发（3760-3792）：`subagent/start` / `subagent/end` 也调 `refreshSubagents()`（未作用域事件只作刷新信号，读取仍按 `agent.id` 围栏）；tick 启停挂在 `setSubagents()` 路径。
- 测试：
  - `lib/app.test.ts`：`summarizeSubagents` 纯函数断言（running/idle/inactive、unknown、one-shot、活体优先排序、cap 12）；gauge 用例（现有 **276-312**，断言 283-290 / 299-307）按新文案与可见条件显式更新，不得静默删。
  - `lib/transcript-area.test.ts`：无涉及，保持绿。

**已知限制（二稿裁定，实现后写进 README/说明）**

- one-shot 完成**不产生任何 UI 信号**（settle 行只覆盖 continuable，见 A4）；已 settle 未 dispose 的 one-shot 会短暂读作 `idle`，文案不承诺「可继续」。
- 非本机（remote/ACP）子代理一律显示 `inactive`（`ctx.agents.get` 查不到）；本切片只对本地子代理保证状态正确。

**验收**

- [ ] `summarizeSubagents` 纯函数：三态判定、unknown 永不标 `(bg)`、one-shot 终态可辨、活体优先排序、cap 12
- [ ] 气氛行可见条件（仅 running|idle 才显示）与折叠 N=活条目数；inactive 只在展开态出现
- [ ] `refreshSubagents` 接 `subagentTiming`（0/缺席即省略）+ `subagent/start|end` 触发 + 1s tick 启停；generation 防陈旧回填保留
- [ ] `npx tsc --noEmit` exit 0；`npm test` 全绿（新测试文件需登记进 `package.json` 的 test 清单）；`scripts/regression-gate.sh --tier 0,1` 零豁免
- [ ] 证据归档（测试输出 + tui-dev 实跑一轮子代理的手工记录；切片收口并入 T2 real + PTY 双 profile）

**范围外:** 子会话视图（A2）、四档展示模式（A3，已摘出切片）、one-shot 完成信号、非本机子代理状态、`listDescendants` 诊断行、Team 成员状态（第二切片）。
