# 10 — 行为基线：去重后与差异解释

**What to build:** 用同一口径再次采集，量化去重带来的影响，并对每一处差异给出归因，证明去重没有引入行为回归。

**Blocked by:** 09 — 组合去重

**Status:** done — 2026-09-10（验收 5/5；E 组 N=9 在去重后组合上 9/9 ok，记录字段与 08 基线逐项同形，结构字段零差异；口径锚定率 56% vs 67% 由 1 跑开场措辞构成，行为锚定 9/9 持平）

**Evidence:** `evidence/10-m4-baseline-deduped.md`；原始数据 `experiments/m4/results-minimal-plus-next-deduped-2026-09-10.jsonl`（sha256 `c2d4ef22…`）

- [x] 按历史样本量采集（每组 9 次）— E 组 N=9，error 0/9，exit 0（墙钟 2m32s；路由与 07/08 同源 `opencode-go/deepseek-v4-flash`）
- [x] 与"仅升级"基线逐项对比 — 12 字段形状同形；14 项记录字段取值集合全同（`assemblyTools`/`headerTools` 29 逐名同、bash 参数、二轮注入、`headerReason`、锚定分类、模型/预设等）
- [x] 每一处差异都有归因说明 — 口径锚定率 67%→56%（E9「我来…」前导，1 跑，非组合差异）；耗时 +1.4s（provider 抖动）；工具序列属模型路径选择；结构字段零差异
- [x] 首轮锚定率、第二轮注入、bash 换用三项无回归 — 行为锚定 9/9 = 9/9；check3 9/9 = 9/9（宿主 `agent-instructions` 行照常注入）；check4 9/9 = 9/9（bash 七参数逐字段同）
- [x] 原始数据与对比结论一并存档 — evidence 文件 + jsonl（批次头注释记录部署位 sha256 `3de7d32b…`）+ 9 个 M4 会话留存；探针文件已清理
