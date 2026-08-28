# /model 热切换设计（ModelSelectionRef 可变 seam）

> 状态：**已实施（2026-08-27）；seam 级 spike 通过（`experiments/model-hot-switch-spike.test.ts` 3/3），真实树自动化 spike 通过（`experiments/model-hot-switch-live-spike.mjs`）；TUI 手工验收通过（2026-08-29，`session-d6d6d6b1-49df-4f3b-9148-856a9ed9c9e7`）**。
> 目标：把 `/model` 从「fork 全量日志 + 新 session + 回放历史」改成与 `/effort` 同源的
> `installModelSelection` 可变引用热切换：同一 session、下一轮生效、不重建会话。
> 关联：`docs/reasoning-effort-design.md`（effort 已骑同一 seam）、`docs/tui-feature-gap.md` M1c。

## 1. 现状

当前 `/model` 走官方 switchModel recipe（`lib/index.ts#switchModelLive`）：

| 步骤 | 行为 |
|---|---|
| 入口 | running 否决（同 `/new` `/effort`） |
| 选择 | `llm.listProviders/listModels` → picker → 目标 route |
| 切换 | `sessions.fork(agent.session).events` 全量日志作 seed |
| 建新会话 | `agents.create`（新 sessionId、同 preset、新 route、`makeSetup` 装新 selection ref） |
| 重绑定 | `whenIdle()` → `agent = next` → presenter/TUI 重建 → 投影/cache/goal/subagent 重种 |
| 默认 | 不写 `saveSelection`（会话级切换，不动全局默认） |

问题：切换代价重——新 session id、全量 replay/rebuild、投影重种；而且 fork 的“历史原样”实际是复制了一份历史，不是原地续用。

## 2. 动机

`/effort` 已经证明 `installModelSelection` 是可用且更轻的会话级可变 seam。且从
`@deepseek-ai/dsh-agent` 源码看，该 seam **不只管 effort**：

```ts
// node_modules/@deepseek-ai/dsh-agent/lib/types/model-selection.d.ts
interface ModelSelectionRef {
  /** Model selected for the next step that enters prompt assembly. */
  current: ModelSelection | undefined;
  /** Selection captured when the current step entered prompt assembly. */
  assembled: ModelSelection | undefined;
}
```

实现里：

- `system-prompt/assemble`：把 `selection.current` 的 `provider/model` 写进 prompt variables；
- `agent/request`：把 `selection.assembled`（进入 assembly 那一刻的快照）应用到本次请求的
  `provider/model/reasoningEffort`。

所以**改 `selection.current` 本身就能让下一轮换 provider/model**，与 effort 完全同构。

## 3. 目标行为

`/model` 热切换后：

| 项 | 行为 |
|---|---|
| 入口 | running 否决保留（避免步骤中途切裂） |
| 选择 | picker 不变 |
| 切换 | `selectionRef.current = { provider, model, reasoningEffort: 经新路由校验后的 effort }` |
| 会话 | **不变**：同一 session id、同一历史、不 fork、不 rebuild |
| 路由真值 | `liveRoute` 立即更新；状态栏与 `/model` current 判定同源 |
| effort | 随切换透传；新路由不支持当前档位 → 清空（回 provider 默认） |
| 近期请求 | 下一次 `agent/request` 起用新 route；`request/context` 应记录新 route |
| resume | 会话日志最后一条 `request/context` 成为新 route → `bootResumeFacts` 恢复新模型 |
| 默认 | 不写 `saveSelection`（与现状一致，会话级） |
| 缺 seam | `selectionRef === undefined`（理论上不会，TUI 总是 makeSetup 安装）→ 报错提示，保留 fork 路径作降级 |

## 4. 风险与验证点

| # | 风险 | 验证 |
|---|---|---|
| R1 | seam 是否真的把新的 `provider/model` 应用到下一次请求（而不只是 variables） | spike：fake ctx 触发 `system-prompt/assemble` + `agent/request`，改 ref 后再触发，断言新 route |
| R2 | `request/context` 是否记录新 route（resume 真源） | 真实 TUI：热切换后发一条消息，查日志最后一条 `request/context`；重启 resume 看 banner/状态栏 |
| R3 | effort 在新路由不支持时的行为 | 用 `resolveModelInfo(new route)` 校验；不支持 → `reasoningEffort: undefined`，避免 harness 请求前置拒绝 |
| R4 | 步骤中途切换撕裂 | 保留 running 否决；seam 的 `current/assembled` 快照本身防并发撕裂（spike 加一条：assemble 后立刻改 ref，request 仍用快照） |
| R5 | 某些 route 相关初始化（工具/预设）只在 agents.create 时发生 | 真实 TUI 冒烟：热切换后新路由的 tools/skills 是否照常；若发现依赖创建时初始化，则本方案不成立，保留 fork |

## 5. spike 计划

### 5.1 seam 级单测（✅ 已通过，2026-08-27）

用 fake Cordis ctx + `installModelSelection`，验证（`experiments/model-hot-switch-spike.test.ts`，3/3 pass）：

1. 初始 ref A → assemble/request 都用 A；
2. 改 `ref.current = B` → 下一次 assemble/request 用 B（provider/model/effort 都命中）；
3. assemble 后、request 前改 ref → request 仍用 assemble 时快照（防撕裂语义）；
4. `reasoningEffort: undefined` → 请求结果里不带 effort（恢复 provider 默认）。

落点：`experiments/model-hot-switch-spike.test.ts`。

### 5.2 真实树 spike 与 TUI 手工验收（✅ 2026-08-29 全部通过）

`experiments/model-hot-switch-live-spike.mjs` 用 headless profile 真实 dsh 树 + `installModelSelection`
创建真实 agent：第一轮 route A → 热改 `selection.current = route B` → 第二轮 `request/context`
记录 B。已实测：A=`opencode-go/deepseek-v4-flash` → B=`deepseek-official/deepseek-v4-flash`，PASS。

真实 TUI 手工验收（2026-08-29，`session-d6d6d6b1-…`）全部通过：

| 步骤 | 结果 |
|---|---|
| TUI boot → `/model` 切到另一 provider/model | ✅ 状态栏即时变新 route |
| 发一条消息 | ✅ `request/context` 记录新 route；日志可辨 |
| `/effort` 切档后再 `/model` | ✅ effort 透传（`max` 带到新 route，新 route 支持则保留） |
| 重启 `/resume` 该会话 | ✅ banner/状态栏恢复新 route |
| 新路由工具调用 | ✅ tools 照常（R5 确认） |

## 6. 实施步骤（spike 通过后）

1. `doModel` 去 fork：改用 `switchModelHot(route)`；
2. 写 `selectionRef.current`，同步 `liveRoute`、状态栏、`refreshEffortMeta()`；
3. 保留 `switchModelLive` 作为 `selectionRef === undefined` 的降级路径；
4. 更新 `docs/tui-feature-gap.md` M1c 与 `ARCHITECTURE.md` 相关行；
5. `npm test` + `tsc` 全绿；活体复测后定稿。

## 7. 不做

- 不合并 `/effort` 进 `/model` picker（维持现状，先验证热切换）。
- 不写 `saveSelection`（默认仍只经 settings 通道变）。
- 不改 dsh-agent / dsh 本体（纯 TUI 侧接线）。