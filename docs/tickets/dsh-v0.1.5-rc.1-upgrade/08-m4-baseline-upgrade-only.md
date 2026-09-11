# 08 — 行为基线：仅升级

**What to build:** 在"只升级宿主、组合尚未去重"的配置上采集一组行为基线，作为后续判断去重影响的对照。采集必须在确认 TUI 可用之后进行，避免把启动期问题带进基线。

**Blocked by:** 06 — 会话恢复与回退插件回归；07 — 批次测量工具迁移

**Status:** done — 2026-09-10（验收 7/7；复核后复用票据 07 的 rc.1 实跑数据并独立复算，差异逐项归因）

**Evidence:** `evidence/08-m4-baseline-upgrade-only.md`

- [x] 按历史样本量采集（每组 9 次）— E 组 N=9，error 0/9（C/A preset 已删除，E 为唯一可重跑组；复用复核见证据 §1）
- [x] 记录首轮锚定率 — 口径 67%（6 tool call / 3 we need / 0 let me）；行为锚定 9/9（首响应含工具调用、首工具 bash）；67% 的构成已解释
- [x] 记录第二轮注入是否发生 — check3 9/9，`injectedEvents` 含 `agent-instructions`
- [x] 记录第二轮 bash 是否切换为受沙箱约束的形态 — check4 9/9，assembly/header 的 bash 参数含 `sandbox_permissions`
- [x] 记录第二轮可见工具数量与请求头工具快照 — 9/9 为 29；assembly 与 header 逐跑一致，快照见证据 §3.5
- [x] 原始数据存档 — `experiments/m4/results-minimal-plus-next-upgrade-only-2026-09-10.jsonl`（sha256 `2fc45393…`）+ 会话留存
- [x] 与历史批次的差异仅作趋势参考，并注明宿主版本已变 — 证据 §4/§5；唯一工具差异 `web_fetch` 归因 rc.1 宿主 base `fetch: true`
