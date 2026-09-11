# 04 — 会话事件读取迁移（宽重构）

**What to build:** TUI、回退插件与 preset 自研插件不再读取已被移除的会话事件数组，改为按需快照与按下标取事件；agent 创建按异步接口等待完成后再继续。本票是一次跨多处的接口迁移，单独无法保持端到端可用，由票据 05 承担集成验证。

**Blocked by:** 02 — 宿主升级与依赖方处置

**Status:** done — 2026-09-10（票据 13 文档收口时按证据回填；验收 8/8，端到端由票据 05/06 承接）

**Evidence:** `evidence/04-session-event-migration.md`

**范围扩展（票据 03 实机发现，用户 2026-09-10 裁定并入本票）：** `presets/minimal-plus-next/` 的自研插件同样读 `session.events`——`compaction-epoch.mjs:36` 直接迭代，`phase-swap-bash.mjs` / `tool-bootstrap.mjs` 经 `promotion.status(agent)` 走到它；rc.1 下 `system-prompt/assemble` 即抛 `session.events is not iterable`，`phase-swap-bash.test.mjs` 6 个用例红（未改动的 `presets/minimal-plus/` 同代码同样红）。不迁它，票据 05 无法冷启动。证据 `evidence/03-composition-fork-persona.md` §5.3、§7.1。

- [x] TUI 生产路径不再读取已移除的事件接口 — `lib/index.ts` 13 处改 `snapshotEvents()`；直播流改 `agent/assistant-stream`（证据 §1）
- [x] 回退插件的会话记录读取改走快照接口 — `rewindSource` 契约改 `snapshotEvents()`（证据 §2）
- [x] 回退边界使用强类型的会话位置 — `SessionSeq`（type-only import）（证据 §2）
- [x] preset 自研插件（compaction-epoch / phase-swap-bash / tool-bootstrap 的 promotion 状态）不再读取已移除的事件数组 — `compaction-epoch.mjs` 冷扫描改快照（证据 §3）
- [x] agent 创建按异步接口等待完成后再继续 — 4 处 `agents.create/resume` 均 await（核实性，证据 §4）
- [x] 未构造 Inbox 运行时对象、未使用已移除的插件侧代理上下文 — 全范围 grep 无命中（缺席核实，证据 §6）
- [x] 未依赖已移除的旧持久化方法 — projection cache 改调用方给全量日志（证据 §6）
- [x] 既有单元用例通过（含 phase-swap-bash 的 6 个红用例转绿；本票不保证端到端可用） — `npm test` 97/97、`tsc` 0 错（开工前 91/97、5 错；证据 §7）
