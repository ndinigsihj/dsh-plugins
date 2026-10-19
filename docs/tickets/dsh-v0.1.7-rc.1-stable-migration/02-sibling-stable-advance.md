# 02 — 兄弟仓库稳版前进（dsh-endless / dsh-relay 的 stable 快照）

**What to build:** 在两棵兄弟 stable 树被 0.1.7 宿主挂载之前，先把它们各自的 0.1.7 适配带上 stable：

- **dsh-endless**：dev 树有未发布修复 `1381e89`（`agent/session-start` → `agent/created`；消息源改
  `plugin:endless/inject` / `plugin:endless/distill`；依赖代际与 `host-pin.json` 升 0.1.7-rc.1）。
  按该仓流程发版（其 `npm test` / `check:host --require-host` 绿）→ 前进 `dsh-endless-stable` 到新 tag，
  并把 `host-pin.json` 的 `cli`/`packages` 更新为 `0.1.7-rc.1`。
- **dsh-relay**：确认 v0.1.9 代码在 0.1.7 宿主下可用（dev 同源已在 `tui-dev` 跑）；决定是否发一版带上
  `bdc5deb`（`dsh-session-projection` 钉 rc.2）→ 前进 `dsh-relay-stable`。

**Blocked by:** 无（依赖两仓各自窗口），但 03 起宿主切换前必须完成

**Status:** done — 2026-10-19（两仓均发版并前进 stable 快照；证据 `evidence/02-sibling-releases.md`）

- [x] dsh-endless：typecheck + 272/272 + `check:host --require-host` 全 PASS，发版 v0.1.11（`a2b1d60`）
- [x] dsh-endless-stable 前进到 v0.1.11；`host-pin.json` = 0.1.7-rc.1；部署树 clean
- [x] dsh-relay-stable 在 0.1.7 下的可用性：依赖声明对齐（`8db2465`，8 个依赖升到树内解析代际）
- [x] dsh-relay 发版 v0.1.10（`00975fa`）+ stable 前进到 v0.1.10；lock 漂移按部署树口径还原

**范围外（本票不做）:** 另两仓的功能改动；本仓代码。
