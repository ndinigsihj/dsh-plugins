# 13 — 文档收口

**What to build:** 把升级后的真实状态写回文档：目标版本与依据、破坏性变更、新增能力、被取代的旧设计方向、已知风险与测量结论，使下一个维护者不必重新调研。

**Blocked by:** 12 — 允许路由真实验证

**Status:** done — 2026-09-11 用户验收（文档收口 + Stage 6/7 修复 + commandcode 复测关闭）；未提交，用户决定暂不 commit/push

**Evidence:** `docs/dsh-v0.1.5-rc.1-upgrade-closeout.md`（as-built 收口）、`docs/subagent-model-selection.md`（机制与允许路由维护）、`docs/dsh-v0.1.5-upgrade-plan.md`（目标版本与差异清单已更新）、`evidence/13-stage7-fixes.md`（Stage 6 findings 的 Stage 7 处置，含 06-4 预览修复与 a7 断言补强）

- [x] 升级计划文档的目标版本与差异清单更新到本次候选版 — `docs/dsh-v0.1.5-upgrade-plan.md`：目标 `0.1.5-alpha.1` → `0.1.5-rc.1`；补 §3.8–§3.10（alpha.2 / rc.1 / rc.2）；标注 dsh-plugins 已实施、relay/endless 仍为计划
- [x] 子代理模型选择说明成文，含允许路由的维护方式 — `docs/subagent-model-selection.md`：机制语义、当前部署基线（sha256）、4 条路由验证状态、增/删/关闭与复测程序、残留风险
- [x] 被取代的旧设计方向已标注作废 — ADR-0001（自研 purpose 路由整套作废）、closeout §5、`docs/dsh-v0.1.2-rc.1-tui-impact.md` 与 `docs/dsh-v0.1.5-alpha.1-npm-status.md` 加过时标注
- [x] 破坏性字段迁移（persona 前缀/后缀、会话接口、会话格式）记录在案 — closeout §3（会话接口 / 生命周期与 V3 / persona 与工具面三组对照表，逐项指向票据与证据）
- [x] 测量结论与残留风险记录在案 — closeout §6（M4 两份基线、模型选择与路由探针、回归闸门）与 §7（开环项 + 已记录残留）
- [x] 未提交，等待审阅 — 保持未提交；用户 2026-09-11 审阅通过并决定暂不 commit/push（Stage 8 交接文档 `/tmp/dsh-plugins-handoff-2026-09-11.md` 已接受）

**票据 12 转入的开环项（已关闭）：** 2026-09-11 14:21（`2026-09-11T06:21:41Z → 06:22:12Z`）复跑
`experiments/subagent-model-selection/run-route-probe.sh`：**4/4 通过**，commandcode 首次尝试即完成
bash 工具调用（6.6s，marker 回显），基线未改。证据：`evidence/12-route-probe-retest-2026-09-11.json`
（sha256 `ecf23663…`）与 `evidence/12-allowed-route-verification.md` §3.1。
