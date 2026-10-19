# 06 — 验收、证据与收口

**What to build:** 把 03–05 的结果固化成可复核的验收证据，回填文档，并把回滚口径写成一条命令。

**Blocked by:** 03 / 04 / 05

**Status:** done — 2026-10-19（验收全绿；证据 `evidence/03-06-host-migration.md` §06；两份报告在
`experiments/regression-gate/{preset-mount,results}-2026-10-19-stable-migration.json`）

验收清单（全绿）：

1. `dsh-runtime/stable`：`tui-stable --version` = 0.1.7-rc.1；`--dump-config` exit 0；
   镜像 top-level = 全树 scoped 包名数，dangling = 0。
2. 解析面矩阵：三棵 stable 树 + 旧载体 + farm + 启动器 → 同一位置、同一版本（01 票矩阵逐格复测）。
3. 补丁：stable 运行时 `dsh-llm-pi-ai` `node --check` + grep 5 命中 + 8 条 mock 用例；
   profile 无静态 header。
4. `tui` profile：`--dump-config` exit 0 / ids 无重复 / 段数与 `tui-dev` 对齐（差异有据）。
5. PTY 冒烟：真 PTY 起 stable profile + 部署位载体，断言 boot 渲染 / preset 挂载 / 无挂载报错
   （脚本 `scripts/preset-mount-smoke.mjs --launcher …/tui-stable`）。
6. dev 侧未受伤：`scripts/regression-gate.sh --tier 0,1,2 --composition real` 复跑绿
   （验证解析面重建后 dev 的 preset 解析不再落 0.1.5 副本）。
7. 回滚演练：按票面步骤切回旧树，`tui-stable --version` = 0.1.5-rc.2，再切回新树。

留档：证据入 `evidence/`（版本矩阵、镜像/farm 计数、补丁 diff 与用例输出、dump-config 摘要、冒烟 JSON）；
文档回填 `docs/deployment.md`（§4 第 5 步口径、§5 启动入口）、`docs/dsh-v0.1.7-rc.1-upgrade-closeout.md`
§7.1-2（改为已闭环 + 日期），两篇 local-patch 文档的运行时表。

- [x] 验收 1–7 逐项有原始输出/JSON（版本矩阵、补丁 sha、dump 摘要、冒烟与闸门 JSON）
- [x] 文档回填（deployment §4 第 5 步 / closeout §7.1-2 与 §7.1-5 / 两篇 local-patch 文档）
- [x] 回滚步骤一句话可执行（`node_modules` 反向改名 + 还原 profile `.bak-20261019-193150`）
- [x] 票面状态全部回填（03/04/05/06 done；03 票的「回滚演练」单列为未做）

**范围外（本票不做）:** 跨仓发版；清理 `~/.dsh/upgrade-backups/**`；删除旧载体。
