# 09 — 组合去重

**What to build:** 开发侧组合不再重复宿主已经提供的挂载行，只保留确有差异的行；去重后模型可见的工具集合保持与去重前一致，使这一结构改动不改变行为。

**Blocked by:** 08 — 行为基线：仅升级

**Status:** done — 2026-09-10（验收 8/8；17 个逐字重复行删 16 留 1，3 个差异行按本轮决定跟随宿主，2 个空组移除；A/B 无 LLM 冒烟逐字一致，与票据 08 基线 29 工具逐名相同；tui-dev 配置导出 98 id / 0 重复；部署位 8/8 同步）

**Evidence:** `evidence/09-composition-dedupe.md`（机器可核对数据 `evidence/09-dedupe-ab.json`）

- [x] 删除与宿主逐字重复的挂载行（16 行；`tool-subagent` 按 ADR-0003 保留为差异行）
- [x] 因删除而空掉的组合分组已移除（`planning`、`compaction`）
- [x] 仍需保留的分组只保留表达停用意图的行（`delegation` 保留 codex / claude-code 两个 disabled 行）
- [x] 保留"始终禁用的 bash"这一差异行（`tool-bash: disabled: true`）
- [x] 保留"承载模型选择开关的委派工具"这一差异行（`delegation/tool-subagent`，票据 11 加 `modelSelectionSettings`）
- [x] 原属差异、本轮决定跟随宿主的两行已删除（`tool-web`、`planning/plan-mode`；另 `tool-subagent-fork` 按本轮决定跟随宿主 one-shot）
- [x] 配置导出无冲突或重复挂载错误（`dsh --profile tui-dev --dump-config` exit 0；98 行 / 98 唯一 id，补 finding 05-2 闸门）
- [x] 可见工具集合与去重前一致；若有差异，每处都有解释（29 = 29，含 `web_fetch`；差异解释见证据 §5）
