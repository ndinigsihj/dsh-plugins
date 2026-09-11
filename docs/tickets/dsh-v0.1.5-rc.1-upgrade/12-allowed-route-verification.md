# 12 — 允许路由真实验证

**What to build:** 确认允许路由集合中的每一条路由都能真实完成一次工具调用，并把不具备该能力的路由从集合中移除。已知某些密钥下同名模型会在工具调用时报错，因此这一步不能靠目录推断。

**Blocked by:** 11 — 采用官方子代理模型选择

**Status:** done — 用户 2026-09-11 验收（探测窗口 2026-09-10T16:04Z）：4 条全部真实探测，3 条通过；`commandcode/deepseek/deepseek-v4-flash` 因 weekly quota 429（重置 `2026-09-11T06:21:01.800Z`）未通过且非能力缺陷，用户裁定保留基线；**复测已执行（2026-09-11 14:21）4/4 通过，开环项关闭**（见文末与证据 §3.1）；未改基线、未 commit

**Evidence:** `evidence/12-allowed-route-verification.md`；原始数据 `evidence/12-route-probe.json`（sha256 `183bd485…`）

- [x] 对允许集合中的每条路由执行一次真实工具调用探测 — 2026-09-10T16:04Z 探针实跑 4/4（`experiments/subagent-model-selection/run-route-probe.sh`）；3 条完成 bash 工具调用并回显 marker，commandcode 未能进入模型请求
- [x] 每条路由的结果逐条记录 — 证据 §3 表 + `12-route-probe.json`（逐轮 childId/header/工具调用/结果/耗时）
- [x] 未通过的路由已从允许集合移除 — 按用户 2026-09-11 裁定口径：能力类未通过者移除（本次无此类）；commandcode 属额度类未通过（非能力缺陷），保留在基线，复测后再判定是否裁剪
- [x] 移除后集合仍满足日常使用需要 — 集合未变（4 条）；已实证 3 条覆盖 opencode-go（两模型）与 deepseek-official，日常委派可用；commandcode 复测后复核该结论
- [x] 探测方法与结论记录在案，便于下次扩缩集合时复用 — 证据 §2（运行方式与断言）、§4（额度类≠能力失败判据）、§6（复测程序与裁剪步骤）

**开环项（转票据 13，已关闭）：** `2026-09-11T06:21:01.800Z`（本地 14:21）后复跑同一探针；若 commandcode 通过则 4/4 不变，若出现非额度失败则按证据 §6 从 `~/.dsh/profiles/{tui-dev,headless}/cordis.patch.yml` 移除该路由并重跑探针 + `--dump-config` 闸门。**结果（2026-09-11 14:21）：4/4 通过**——commandcode 首次尝试 6.6s 完成 bash 调用并回显 marker，基线未改；证据 `evidence/12-route-probe-retest-2026-09-11.json`（sha256 `ecf23663…`）与 `evidence/12-allowed-route-verification.md` §3.1。
