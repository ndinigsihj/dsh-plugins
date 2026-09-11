# 07 — 批次测量工具迁移

**What to build:** 行为基线的测量工具改用新的会话读取接口，使其能在新宿主上完整跑完，同时保持记录字段与统计口径与历史批次逐字一致，以便结果可比较。

**Blocked by:** 02 — 宿主升级与依赖方处置

**Status:** done — 2026-09-10（验收 5/5；E 组 N=9 在 rc.1 上 9/9 ok，记录字段与两个历史批次逐字段同形，口径未变）

**Evidence:** `evidence/07-m4-harness-migration.md`

- [x] 测量工具能在新宿主上完整跑完一组（M4 E 组 N=9 全 ok；trajectory driver 1/1、hot-switch spike PASS）
- [x] 记录字段与历史批次一致（与 2026-08-21 E、2026-09-03 E 逐字段形状比对完全相同）
- [x] 统计口径未变（`summarize.mjs` 未改；check3/check4 9/9，anchorRate 按原分类器记 67%，差异留票据 08 归因）
- [x] 未借机重构测量逻辑（diff 仅接口读取、组表映射、`M4_MODEL` 路由开关与注释）
- [x] 工具解析到的依赖树与实际运行宿主一致（四个 dsh 模块与宿主导入为同一模块实例，宿主 0.1.5-rc.1）
