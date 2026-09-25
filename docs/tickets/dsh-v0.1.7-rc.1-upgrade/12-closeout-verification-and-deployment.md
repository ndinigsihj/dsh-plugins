# 12 — 收口验证与部署

**What to build:** 收口清单全绿后，把 Preset 产物与 Team Profile 一起落到部署位：先 dry-run 核对，再真实写入；部署位与清单指纹一致；临时豁免从调用链移除；两种 Profile 形态的最终闸门留档；回滚入口（本地副本 + 冷备）仍可用。

**Blocked by:** 06 — 其余兼容面迁移；07 — Preset 载体迁移与同步工具 dry-run；09 — tui-team Profile 建立与 Profile 维度闸门基线；10 — 会话格式迁移执行与抽样验证；11 — 真实模型基线重采与探针口径收口。（05 会话读取异步化已按 C0 ① 降级为可选、`deferred`，不阻塞本票。）

**Status:** done — 2026-09-25（部署位锚定切 0.1.7 bundle + 真实写入 tui-dev/tui-team；零豁免闸门 real 84/0/0、gate 80/0/0，PTY 双形态 16/16；修复收口期发现的 scope 链接回写缺陷并复验。**改动未提交**，待用户确认后 commit；证据见 `evidence/12-closeout-verification-and-deployment.md`）

**施工图:** `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Implementation Decisions：部署与回滚、闸门基准）；升级计划 §7 收口定义与第 11 步

- [x] 收口清单逐条满足：P0 项有命名命令与归档证据；两种形态闸门全绿；期望差异已审阅；迁移完成；部署位与清单一致
- [x] 部署位写入前有 dry-run 核对记录；真实写入经用户批准
- [x] 调用链中不再出现部署位豁免标志
- [x] 最终闸门报告与版本输出留档
- [x] 回滚入口与冷备保留期仍有效
- [x] 证据归档到本票

**范围外（本票不做）:** 功能计划能力；下一轮升级。

---

## 验收回填（2026-09-25）

证据：`evidence/12-closeout-verification-and-deployment.md`（原始件 `12-gate-{real,all}.json`、
`12-pty-{tui-dev,tui-team}.json`、`12-deploy-plan-{pre,post}.json`、`12-dump-tui-{dev,team}.yml`、
`12-home-{before,after}.txt`、`12-versions.txt`、`12-rollback-assets.txt` 等）。要点：

- **锚定（裁决 B）**：`gates/manifest.json` 的 `deployment.minimal-plus` 改指
  `generated/minimal-plus-preset/`（`repoPath`）+ 两个 profile 目标（`targets`）；
  `gates/manifest.mjs` 支持 `repoPath`/多目标，`render-real` 部署位完整时逐字节装载
  （`preset=deployed`）；旧目录保留为 stable 0.1.5 通道载体，不删。
- **真实写入**：dry-run（`12-deploy-plan-pre.json`）→ 用户批准 → `--write --timestamp 20260925-234726`；
  tui-dev 仅删 10 行旧 `agent-presets` 块（备份 `cordis.patch.yml.bak-20260925-234726`）+ 装 bundle；
  tui-team 从 tui-dev 派生（Team bundle + 同份 preset）。写入后计划复核两目标 `bundle=match`、
  `selection=true`。
- **零豁免闸门**：real 84/0/0（含 `deployment.repo-vs-deployed — 10 files ok`、`composition.team-profile`、
  `isolation.real-home-untouched`）、gate 80/0/0；PTY tui-dev/tui-team 各 16/16；真实 `--dump-config`
  tui-dev 112 / tui-team 115、duplicates 0、stderr 空；`12-versions.txt` 两入口均 0.1.7-rc.1。
- **收口期缺陷（已修）**：隔离渲染把 `@scope` 目录整链接回真实 `node_modules`，装载 bundle 时
  穿过链接改写真实部署位链接（首次真实 dump 110 条 + 跳过 preset 警告；isolation 短暂判红）。
  修复 = 新增 `scripts/node-modules-mirror.mjs`（scope 建真目录）+ 回归测试；随后修复真实链接
  并重跑全部闸门/冒烟，链接保持不变。详见证据 §4。
- **回滚**：`DSH_CLI=<票据 03 副本>` 实测 0.1.5-rc.2；冷备根与 meta 清单在（见
  `12-rollback-assets.txt`）；保留期与丢失窗口口径不变（票据 03/04/10）。
- **双轴只读评审**：Standards/Spec 两个只读子代理的发现已全部处置（README 口径、DRY/单一写入点、
  real 冒烟装载部署位、release 预检改 `--check`、degrade 环境隔离等），处置表见证据 §7。
- **遗留**：票据 14 会改 preset 真源，落地后需按同一流程再落一次部署位并复跑本票闸门。

---
