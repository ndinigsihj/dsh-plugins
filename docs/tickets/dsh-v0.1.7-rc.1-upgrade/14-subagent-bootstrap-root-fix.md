# 14 — 子代理豁免锚定（includeSubagents 统一 false）

**What to build:** 让子代理（`delegationDepth > 0`）不再走 minimal-plus 首轮锚定：首轮即暴露全量工具目录，避免子代理把「当前请求没有 read_image 等工具」误判为「工具不存在」而无法完成任务。主会话（`delegationDepth == 0`）首轮锚定语义**保持不变**——`includeSubagents` 只分支子会话（`compaction-epoch.mjs` `status()`）。

**改动面（方案 A，2026-09-25 裁决）**

- `presets/minimal-plus/agent.cordis.yml`：`tool-bootstrap` 与 `instruction-hint` 两行配置的 `includeSubagents` 改为 `false`（或删除取默认语义）。
- `presets/minimal-plus/phase-swap-bash.mjs`：把硬编码的 `includeSubagents: true` 改为读配置/与 tool-bootstrap 一致的 `false`，避免「子代理工具目录已全量但 `tool:*` 指引段仍被过滤」的不一致；复核子代理 swap/提权时机（首轮 persistent bash → step/end 后沙箱 bash 的语义应保留）。
- 契约测试与冒烟同步：`tool-bootstrap.test.mjs` / `phase-swap-bash.test.mjs` / `instruction-hint.test.mjs` 增加「子代理首轮全量、主会话首轮仍锚定」的断言；`smoke-boot.mjs` 断言子代理 ROUND1 全量、主会话 ROUND1 仍为 `[bash, str_replace_editor]`。

**Blocked by:** 04 — 宿主升级与两个工作 Profile 到位；07 — Preset 载体迁移（改动落在 0.1.7 生成形态上）

**Status:** implemented（仓库真源 + 产物 + gate 组合闸门；部署位仍是旧 `includeSubagents: true` 形态、real/PTY 未跑——留待用户批准部署刷新，见证据 §5）

**施工图:** `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Implementation Decisions：子代理锚定）；升级计划 §1.1、§3.6、§6 P1 行

- [x] 三处 `includeSubagents` 语义统一为 `false`；phase-swap-bash 不再硬编码
- [x] 契约测试更新：子代理首轮全量、主会话首轮仍锚定、phase-swap 与 section 过滤一致
- [x] 冒烟断言：子代理 ROUND1 全量、主会话 ROUND1 仍 `[bash, str_replace_editor]`
- [x] 与 07 生成的新 preset 形态一致，产物指纹含本改动
- [x] 闸门全绿（`--tier 0,1,2 --composition gate` **81/0/0**；唯一豁免 = 部署位滞后，real/PTY 随部署刷新后复跑）；expectations 工具面变化按行级 diff + 理由登记
- [x] 证据归档到本票：`evidence/14-subagent-bootstrap-root-fix.md`

**范围外（本票不做）:** 主会话首轮锚定语义调整；子代理 pre-promotion note（方案 B）；部署位真实写入（12）；preset 瘦身/退役评估（§3.6）。
