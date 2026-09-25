# 09 — tui-team Profile 建立与 Profile 维度闸门基线

**What to build:** 建立带 Team 组合的独立 Profile（tui-team）：组合无重复 id、可启动；按 Profile 维度重建工具面期望并附行级差异与理由（禁止整文件再生成）；非 Team Profile 的可见工具集合保持不变。工具面口径以 08 的实测结论为准（含回退情形）。

**Blocked by:** 01 — Prefactor：组合闸门脚本拆模块；08 — B1.5：Team Profile 的 Preset 叠加实测

**Status:** done — 2026-09-25（隔离派生 tui-team 配置导出绿：exit 0 / ids 115 / duplicates 0；三形态期望基线（tui-dev 35 / headless-team 34 / tui-team 40）带行级 diff + 理由；PTY 双形态 16/16、T1 real 22/22、gate 全层 80/80；**真实 `~/.dsh/profiles/tui-team` 物化与 preset 落位归 12**；改动未提交，待用户确认后 commit。证据 `evidence/09-team-profile-and-profile-dimension-baselines.md`）

**施工图:** `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Implementation Decisions：Team、闸门基准）；升级计划 §5.4、§6 Team 行

**08 输入（2026-09-25，已测得）:** preset 在 Team 下真正生效且与 Team 创建工具并存（`subagent` + `list_subagent_models` + `spawn_teammate`），`subagent_fork` 被组合期禁用；工具面基线 = PTY Team 40 / tui-dev 35（+6/−1）；成员权限读 role 不读工具存在性。证据 `evidence/08-team-preset-overlay.md`（报告 `evidence/08-pty-team.json`、`evidence/08-pty-tui-dev.json`、`evidence/08-control-team-overlay.json`）。

- [x] tui-team 配置导出 exit 0、逐 loader id 计数为 1
- [x] 两种形态的期望快照可分别运行；每个新增/移除工具附行级差异与理由
- [x] 非 Team Profile 的可见工具集合与升级前一致
- [x] tui-team 工具面与 08 结论一致；回退情形下与回退口径一致
- [x] 显示层权限判断不依赖"工具是否存在"（读角色/成员信息）
- [x] 证据归档到本票

**范围外（本票不做）:** Team 成员视图、任务板、使用规范文档（功能计划）；部署位写入（12）。

---

## 验收回填（2026-09-25）

证据：`evidence/09-team-profile-and-profile-dimension-baselines.md`（原始报告 `09-team-profile-dump.json` / `09-gate-real.json` / `09-gate-all.json` / `09-pty-tui-dev.json` / `09-pty-team.json` / `09-control-team-overlay.json`）。要点：

- **建立形态**：`tui-team` 从真实 `tui-dev` 派生（只读源 + `TEAM_BUNDLE`），在隔离 home 装入 0.1.7 preset 载体后 `--dump-config` exit 0、ids=115、duplicates=0（tui-dev 对照 112）；组合含 base + antigravity-auth + Team bundle + preset bundle。**真实 `~/.dsh/profiles/tui-team` 未创建**——物化与 preset 落位按 spec「部署与回滚」归 12，本票只维护派生规则与检查（`gates/team-bundle.mjs` 为唯一名字来源，`gates/team-profile.mjs` 为可复跑命令）。
- **Profile 维度期望**：唯一数据源 `gates/expectations.json` 的 `profiles` 段，三形态全部用 `basedOn` + `changes` 行级差异（每条带 direction/reason，禁止整文件再生成）：`tui-dev` = headless 基线 +7 = 35；`headless-team` = 基线 +7/−1 = 34；`tui-team` = `basedOn: tui-dev` +6/−1 = 40。`gates/profile-expectations.test.mjs` 把求值结果与 08 三份实测归档逐项对账，并钉住变更行方向/理由、diff 行级输出与回退判定。
- **非 Team 不变**：tui-dev 注册面 35 = 模型可见 35，与 `08-pty-tui-dev.json` 逐项一致；Team bundle 自动追加只在 `tui-team` 发生（`bundlesForProfile`），非 Team 形态的期望与实测均无 Team 工具。
- **回退口径**：`profiles.tui-team.fallback` 显式声明 `preset: null` / `unmeasured`，只核对 6 个 Team 工具在场与 preset 独有行（`subagent` / `list_subagent_models` / `subagent_fork` / `skill_search`）缺席；PTY 检查器对哨兵缺席**一律判红**（不自动降级成「未测」——那会把 preset 挂载回归伪装成回退口径），判词里给出回退口径的核对结果。回退结论未启用（08 测得），口径与判定由单测固定；回退载体的端到端跑不在本票执行。
- **显示层**：本票没有可改的显示层 Team 权限代码——成员视图/任务板归功能计划（B2），`lib/**` 对 `teammate` / `agentTeams` 零命中。权限来源钉在服务 seam：T2 `permission.member-cannot-*` 按 `ctx.agentTeams.tryMembership(...).role` 拒绝，而 teammate 工具面**含** `spawn_teammate` —— 工具存在性不得作为判权依据（08 实测复核）。本票一度新增的未消费 `lib/team-roles.ts` helper 被两轴判为 speculative generality，已删除（见证据 §6/§9）。
- **接线**：`gates/stub/scenarios/team-preset-overlay.mjs` 增 `overlay.lead-tool-surface`（注册面 + promotion 后可见目录）与 `overlay.teammate-tool-surface`（在线瞬时注册面），对账 `profiles.headless-team`；`scripts/tui-pty-smoke.mjs` 增 `tool-probe.profile-surface`（按 `--profile` 名对账注册面与模型可见目录，tui-team 自动追加 Team bundle）；`gates/run.mjs` real 模式派生 tui-team（渲染落在 `gates/composition/render-team.mjs`）并新增 `composition.team-render` / `composition.team-profile` 断言；`gates/t1/composition.mjs` 的闸门源码扫描面纳入 5 个新模块。
- **复跑**：PTY 两形态各 16/16；T1 real 22/22（新增 2 条）；`--tier 0,1,2 --composition gate` 80/80（T0 tsc 0 + `npm test` 189/189、T1 15/15、T2 59/59）。部署位窗口豁免仍按 06 口径保留至 12。
- **双轴只读评审**：Standards / Spec 两个只读子代理评审的 9 条发现已处置（run.mjs 超 300 行拆模块、删未消费 helper、回退哨兵判红、headless-team 补可见目录核对、导出面收窄、profile 枚举防漏、计数纠正；两条判断项接受），处置表见证据 §9。
