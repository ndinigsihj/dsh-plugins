# A2 — 子会话只读视图（/agents）

**What to build:** `/agents` 列出直接子代理（label / mode / state / 相对时间），选中后打开其 transcript 的**只读**视图；root transcript 与 root 过滤保持不变，子会话实时流不进入 root。

**Blocked by:** A1（清单数据复用 `summarizeSubagents`）。

**Status:** proposed（2026-09-28 二稿；三轮 grilling 已裁决刷新契约与形态门槛，待开工）

**施工图:** `docs/tui-feature-plan.md` §3.1、§4.2

**改动面**

- `lib/app.ts`：
  - 新 overlay 组件 `AgentPicker`（骨架同 `SessionPicker`：`↑`/`↓`、`Enter`、`Esc`；候选行含 mode/state/相对时间），`TuiApp` 暴露服务无关的 `showAgentPicker(rows, loadTranscript)`（便于 T4a 注入假数据）。**只列直接子代理**；嵌套后代与 `listDescendants` 诊断行不在本切片。
  - 新 overlay 组件 `SubagentViewer`：**独立** `TranscriptModel` 实例 + `TranscriptArea` 渲染；行数按终端高度封顶；`↑`/`↓`/`PgUp`/`PgDn` 滚动、`r` 手动重读、`Esc` 返回 picker；无输入框、无提交/steer。
- `lib/index.ts`：
  - 经 `services.commands.register` 注册 `/agents`（同 `/sessions`，自动进 slash 菜单；无子代理时 notice）。命名已核对无冲突（宿主内建命令只有 compact/export/feedback/file/goal/permission/plan，本仓库 22 个注册命令中无 agents/agent/subagents）。
  - 读取：`ctx.subagents.listChildren(agent.id)`（A1 摘要）+ `readPreviewLog(services.sessionQuery, childId)`（`lib/session-preview-log.ts:53-99`，seeded 子会话走 06-4 路径）→ 喂 viewer 的 `TranscriptModel.rebuild(events, presenters)`。
  - **presenters**：活体子代理用 `presentersFor(childAgent)`，冷子代理回落当前 root `presenters`（`lib/index.ts:1079-1094`）；不做预防性抽象，出现实际误渲再改。
  - **刷新契约（二稿定）**：picker 每次打开与每次返回都重读清单；viewer 打开时取一次快照、头部标「快照于 HH:MM:SS」，`r` 键手动重读；Esc 逐级返回（viewer → picker → 会话）。不做自动刷新、不做流式。
  - 失败面：query 缺席 / 日志不可读 / 子会话不可见 → notice 带子会话 id 前缀，不静默、不崩。**这是常规路径**：`sessionQuery` 是 live-preferred，remote/ACP 与未持久化子会话读不到（`dsh-subagent/lib/index.js:1269-1277` 明示持久化是 best-effort）。
- 文档：`HELP_TEXT`（`lib/index.ts:98-125`）+ `README.md` 命令表补 `/agents`；`CONTEXT.md` 补「子会话只读视图」术语；票面写明「嵌套后代不可见」这一已知限制。
- 测试：`lib/app.test.ts` 用 FakeTerminal 注入假 rows + 假 loader：打开 picker、导航、打开 viewer、滚动、`r` 重读、Esc 逐级返回；断言 root transcript 行数前后不变；seeded/无标题/不可读三种 loader 结果。

**形态门槛（二稿新增）**

pi-tui 现成 overlay 只有居中弹窗（`SessionPicker` 默认宽 `min(80, 屏幕-2)`、高 ≤12 行），仓库无全屏 overlay 先例。A2 第一步是 **½ 天 spike**（fake terminal 驱动）验证 viewer 能否撑满终端；**spike 结论单独停下汇报**——撑不满就退回 `/resume` 同构的「清单 + 预览面板」形态，形态变更由用户重新拍板，不静默降级。

**验收**

- [ ] `/agents` 可列直接子代理；无子代理/读取失败给出明确 notice
- [ ] picker → viewer 导航与滚动可用；`r` 重读与 Esc 逐级返回符合契约；viewer 打开/关闭不影响 root transcript（T4a 断言行数/内容不变）
- [ ] viewer 使用独立 `TranscriptModel`；`lib/index.ts:3763`、`3802` 的 root 过滤未改
- [ ] seeded 子会话可读（`readPreviewLog`），不触发 `readSession` 的 seeded snapshot 报错；不可读路径给出带 id 前缀的 notice
- [ ] spike 结论已汇报并按结论定形态（全屏或退化面板）
- [ ] `HELP_TEXT` + README 命令表已更新；`CONTEXT.md` 术语按需
- [ ] `npx tsc --noEmit` exit 0；`npm test` 全绿（新测试文件需登记进 `package.json` 的 test 清单）；`scripts/regression-gate.sh --tier 0,1` 零豁免；`gates/composition/render-real.test.mjs` 保持绿
- [ ] 证据归档（T4a 输出；切片收口时并入 PTY 双 profile）

**范围外:** 子会话实时流与写操作（prompt/steer/interrupt）、嵌套后代树与 `listDescendants` 诊断行、Team 任务板、多选/过滤等 picker 增强、非本机子代理的可读性。
