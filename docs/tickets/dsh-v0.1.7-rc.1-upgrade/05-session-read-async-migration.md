# 05 — 会话读取路径异步化迁移

**What to build:** C0 ① 已核实：rc.1 的 `snapshotEvents` / `eventAt` / `ownEvents` 签名与 0.1.5-rc.2 逐字相同（仅 `@deprecated`），宿主升级**不**要求迁移；异步替代面是 `ctx.sessionQuery`（`readSession` / `listEvents` / `readEvent` 等，dsh-base 默认挂载）。本票因此降级为**可选结构性改造**：若要迁移，把 TUI、回退插件与 Preset 插件的会话读取路径逐处迁到 `ctx.sessionQuery`，只替换读取方式，不借机重构；若不迁，票面记录 defer 与理由（上游允许存量调用暂不迁移）。完成后单测与两种 Profile 形态的零 LLM/假模型闸门全绿。

**Blocked by:** 02 — 已完成（C0 ① 给出结论）；04 — 宿主升级与两个工作 Profile 到位。本票非宿主升级前置（C0 ①），可在升级窗口之外单独取舍。

**Status:** deferred — 2026-09-24 用户裁决：本轮维持同步读取、不迁移；本票保留待未来需要时再评估（非宿主升级前置，见 C0 ①）

**施工图:** `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Implementation Decisions：接口异步化迁移）；升级计划 §6 P0 行

- [ ] 依赖同步读取的调用点全部迁移，静态检索无遗留命中
- [ ] 迁移只改变读取方式，不改变聚合/记录/统计口径
- [ ] `npm test` 全绿；零 LLM 与假模型闸门在两种 Profile 形态下全绿
- [ ] 启动等待语义按新生命周期接口核对：首个模型请求前无竞态
- [ ] 不新增跨版本兼容分支
- [ ] 证据归档到本票

**范围外（本票不做）:** 功能行为变化（子会话显示等归功能计划）；工具面调整。
