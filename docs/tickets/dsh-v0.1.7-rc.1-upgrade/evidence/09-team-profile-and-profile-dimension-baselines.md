# 09 — tui-team Profile 建立与 Profile 维度闸门基线

> 日期：2026-09-25（本地 +0800）；宿主：`@deepseek-ai/dsh@0.1.7-rc.1`（installAnchor = 全局 v24 安装）
> 关联：`docs/dsh-v0.1.7-rc.1-upgrade-spec.md`「Implementation Decisions：Team / 闸门基准」；升级计划 §5.4、§6 Team 行
> 前置：08（B1.5 实测，已绿）；01（闸门拆模块，已绿）
> 载体：A 真 PTY（`scripts/tui-pty-smoke.mjs` 参数化 Profile + stub provider + 工具探针）；
> B 进程内假模型（`gates/stub/run.mjs --scenario team-preset-overlay`）；C 组合闸门 real 模式（T1）
> 范围外：Team 成员视图 / 任务板 / 使用规范（功能计划）；真实 `~/.dsh/profiles/tui-team` 物化与 preset 落位（12）

## 1. 结论（对照票面验收）

| # | 验收项 | 结果 | 依据 |
| --- | --- | --- | --- |
| 1 | tui-team 配置导出 exit 0、逐 loader id 计数为 1 | ✅ 隔离派生：`--dump-config` exit 0 / ids=115 / duplicates=0；组合含 base + antigravity-auth + Team bundle + preset bundle | `09-team-profile-dump.json`、`09-gate-real.json` 的 `composition.team-profile` |
| 2 | 两种形态的期望快照可分别运行；每个新增/移除工具有行级差异与理由 | ✅ 期望唯一来源 `gates/expectations.json` 的 `profiles` 段（`basedOn` + `changes`，每条带 direction/reason，禁止整文件再生成）；三形态可分别运行：T2（headless-team 34：Lead 注册面 + promotion 后可见目录，teammate 在线瞬时注册面）、PTY tui-dev（35）、PTY tui-team（40） | `gates/profile-expectations.{mjs,test.mjs}`；`09-pty-*.json`；`09-gate-all.json` |
| 3 | 非 Team Profile 的可见工具集合与升级前一致 | ✅ tui-dev 35 与 08 实测逐项一致（注册面 35 = 模型可见 35）；期望以 `presets.minimal-plus.round2` 基线 +7 行表达 | `09-pty-tui-dev.json` 的 `tool-probe.profile-surface`；单测与 `08-pty-tui-dev.json` 对账 |
| 4 | tui-team 工具面与 08 结论一致；回退情形下与回退口径一致 | ✅ 40 = tui-dev − `subagent_fork` + 6 Team 工具；`subagent` + `list_subagent_models` + `spawn_teammate` 并存。回退口径按 08 结论**未激活**：以 `profiles.tui-team.fallback` 声明 + 纯函数单测固定；PTY 检查器对哨兵缺席一律判红，不自动降级成「未测」（防 preset 回归被伪装） | `09-pty-team.json`；`09-control-team-overlay.json`；`expectations.json` 的 `profiles.tui-team.fallback` |
| 5 | 显示层权限判断不依赖「工具是否存在」（读角色/成员信息） | ✅ 本票无显示层 Team 权限代码（成员视图归功能计划 B2，不在本票范围）；把不变量钉在服务 seam：T2 `permission.member-cannot-*` 按 `ctx.agentTeams.tryMembership(...).role` 拒绝——teammate 工具面含 `spawn_teammate` 仍不可用，工具存在性因此不得作为判权依据 | `09-control-team-overlay.json`；08 实测 §3 表 3 |
| 6 | 证据归档到本票 | ✅ 本文件 + 6 份 JSON（§8） | — |

## 2. 方法（可复现）

### 2.1 tui-team 派生与配置导出（隔离，真实源只读）

```sh
node gates/team-profile.mjs --json docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/09-team-profile-dump.json
```

- 从真实 `~/.dsh/profiles/tui-dev` 渲染派生 `tui-team`（`gates/composition/render-real.mjs`，只读源 + `extraBundles: [TEAM_BUNDLE]`），装入 0.1.7 preset 载体（`@dsh-plugins/minimal-plus-preset`）；
- 在隔离 home 跑 `dsh --profile tui-team --dump-config`；`gate.no-deployment-sync` 扫描面已纳入新增闸门源码；
- 与 tui-dev 同管线对照：tui-dev `dump-config` entries=112，tui-team ids=115（+3 loader = Team bundle 的 3 行）。

### 2.2 两个 Profile 形态的期望快照（PTY，真 preset 选择路径）

```sh
node scripts/tui-pty-smoke.mjs --probe-tools --report docs/.../evidence/09-pty-tui-dev.json
node scripts/tui-pty-smoke.mjs --profile tui-team --probe-tools --report docs/.../evidence/09-pty-team.json
# tui-team 的 Team bundle 由 profile 名自动追加（gates/team-bundle.mjs bundlesForProfile），无需 --extra-bundle
```

- `--probe-tools` 时按 `gates/expectations.json` 的 `profiles.<profile>` 核对**注册面**（`ctx.tools.schemas`）
  与**模型可见目录**（最后一个 `request/header.tools`），差异逐行（`- missing` / `+ unexpected`）进证据；
- 两个形态各 16/16 全绿（原 15 条 + 新增 `tool-probe.profile-surface`）。

### 2.3 进程内对照（CI 可跑的 Team 形态）

```sh
node gates/stub/run.mjs --scenario team-preset-overlay --json docs/.../evidence/09-control-team-overlay.json
# 或 scripts/regression-gate.sh --tier 0,1,2 --composition gate --skip-deployment-check（T2 层）
```

- 场景在 08 的 8 条事实断言上新增 `overlay.lead-tool-surface` / `overlay.teammate-tool-surface`：
  Lead 的注册面与 promotion 后模型可见目录都逐项等于 `profiles.headless-team`（34）；
  teammate 按在线瞬时注册面核对（08 测量纪律 2，模型可见目录在其处置后不可复采）。

### 2.4 闸门分层复跑

```sh
scripts/regression-gate.sh --tier 1 --composition real --skip-deployment-check --json docs/.../evidence/09-gate-real.json
# PRE 5/5 + T1 17/17（新增 composition.team-render、composition.team-profile）
scripts/regression-gate.sh --tier 0,1,2 --composition gate --skip-deployment-check --json docs/.../evidence/09-gate-all.json
# PRE 3/3 + T0 3/3（tsc 0 + npm test 189/189）+ T1 15/15 + T2 59/59
```

## 3. Profile 维度工具面（行级差异与理由）

基线 = `presets.minimal-plus.round2`（headless + preset，28）。三个 profile 全部以「基线 + changes 行」
表达；`gates/profile-expectations.test.mjs` 把求值结果与 08 的三份实测归档逐项对账，漂移即红。

| profile | 表达式 | 结果 | 载体 |
| --- | --- | --- | --- |
| `tui-dev` | 基线 + 7 行 | **35** | PTY（非 Team 基线；Team 引入不得改变） |
| `headless-team` | 基线 + 7 行 / −1 行 | **34** | T2 进程内（CI） |
| `tui-team` | `basedOn: tui-dev` + 6 行 / −1 行 | **40** | PTY（真实 preset 选择路径） |

**tui-dev（+7，无移除）**：`list_subagent_models`（tui-dev 的 `subagent-model-selection-settings`
`enabled=true`；headless 基线为 `enabled=false`）；`project_bind` / `project_unbind` / `recall` /
`remember` / `state_get` / `state_update`（tui-dev profile 的 endless-tools 行；headless 冒烟组合不挂 endless）。

**headless-team（+7 / −1）**：−`subagent_fork`（Team bundle 组合期禁用）；+`list_subagent_models`
（preset 的 `tool-subagent` 行未被顶层组合包替换且设置单例 enabled）；+`spawn_teammate` / `wait_agent` /
`team_task_{create,get,list,update}`（Team bundle 的 `tool-agent-team` 注册）。

**tui-team（+6 / −1）**：−`subagent_fork`（Team 组合期禁用，preset 无 fork 行不回归）；
+`spawn_teammate` / `wait_agent` / `team_task_{create,get,list,update}`。与 08 的「+6/−1」逐行一致；
`subagent` + `list_subagent_models` 来自 preset 并保留（并存关系见 08）。

## 4. 隔离派生与配置导出（不写真实 home）

| 项 | 值 |
| --- | --- |
| 源 profile | `~/.dsh/profiles/tui-dev/cordis.patch.yml`，sha `d39a4f6458a9…`；渲染前后逐字不变（`composition.source-profile-unchanged`） |
| 派生 bundles | `[@deepseek-ai/dsh-base, dsh-antigravity-auth, @deepseek-ai/dsh-experimental-agent-team-profile, @dsh-plugins/minimal-plus-preset]` |
| preset 来源 | 部署位不完整 → 回落仓库真源（`presetSource: repo`，与 07 窗口一致；12 落位后转 deployed） |
| `--dump-config` | exit 0；ids=115；duplicates=0；stderr 空 |
| 对照 | tui-dev entries=112（同一渲染管线） |
| 真实 `~/.dsh/profiles/tui-team` | **未创建**（归 12；本票只维护派生与检查） |

## 5. 回退口径（spec：不可测时不让 preset 下沉）

- **未激活**：08 已在真实 preset 选择路径上测得（PTY Team 40），回退方案无需执行；交付形态的 tui-team
  携带 `minimal-plus`，measured 期望（40）生效。
- **口径落字**：`profiles.tui-team.fallback` 声明 `preset: null` / `status: "unmeasured"`，只核对 Team
  组合面：`requiredPresent` = 6 个 Team 工具；`requiredAbsent` = `subagent` / `list_subagent_models` /
  `subagent_fork` / `skill_search`（preset 独有行）。判定语义（`fallbackProblems`）由单测固定，并作为
  PTY 哨兵缺席时的判词输入。
- **哨兵缺席一律判红**：PTY 检查器不把「preset 未挂载」自动降级成「未测」——那会把 preset 挂载回归
  伪装成回退口径；判词里给出回退口径的核对结果（成立 / 被破坏）。回退载体的端到端跑不在本票执行
  （回退未激活），属明确边界。

## 6. 显示层权限（不读工具存在性）

- 本票没有可改的显示层 Team 权限代码：Team 成员视图与任务板是功能计划（B2）范围，`lib/**` 当前对
  `teammate` / `agentTeams` 零命中，不存在按 Team 工具存在性判权的分支。
- 不变量钉在服务 seam（08 实测 + T2 断言）：teammate 工具面**可见** `spawn_teammate`，但
  `spawnTeammate` / `interrupt` 按 roster role（`ctx.agentTeams.tryMembership(...).role`）以
  `TEAM_LEAD_REQUIRED` 拒绝。后续显示层（B2）必须读 role，不能读工具存在性。
- 本票一度新增了未消费的 `lib/team-roles.ts` 读路径 helper；双轴评审都判为 speculative generality
  （无生产调用点），已删除（见 §9）：不把「无消费者」的抽象留进仓库。

## 7. 零写入与边界

- 本票全部命令的写面只有临时 home（`gates/team-profile.mjs`、PTY 冒烟、闸门 T1/T2 均自建并清理）；
  闸门 real 模式的 `isolation.real-home-untouched`（严格区签名一致）与 PTY 的临时 home 语义继续成立；
- 未测/边界：teammate 间 peer 消息可达性、任务板真实写路径、真实模型下的 Team 行为（承 08 §6）；
  真实 `~/.dsh/profiles/tui-team` 与 preset 落位归 12；真实模型基线随 11。

## 8. 证据文件

| 文件 | 内容 | sha256 |
| --- | --- | --- |
| `09-team-profile-dump.json` | `gates/team-profile.mjs` 报告：派生 + dump-config（exit 0 / ids 115 / duplicates 0 / bundles 4） | `a0746ea4f538cf253f515d09dc2a613d6cb7d8589399dc70d1f360f7029d70f6` |
| `09-gate-real.json` | T1 real 22/22：新增 `composition.team-render`（PRE）与 `composition.team-profile`（T1） | `924acc576c1d8e75294677beb1d46dbde67afd1ac46ae338ea9c97155df91baa` |
| `09-gate-all.json` | gate 模式 80/80：T0 3/3（tsc 0 + npm test 189/189）、T1 15/15、T2 59/59 | `54b35ca37881f6c13925e15b586c860476ef5d86f710e1e2e1042ed0456c3a51` |
| `09-pty-tui-dev.json` | PTY 非 Team 臂 16/16：`tool-probe.profile-surface` = 35/35（注册面与模型可见） | `126fdbe53bbe78261f1acfaf30501bf9a04a0bd404227d3df7408232640d89d6` |
| `09-pty-team.json` | PTY Team 臂 16/16：40/40，`subagent`/`list_subagent_models`/`spawn_teammate` 并存；Team bundle 自动追加 | `f82f93ae32e43134cb3261715c659d5fbc7941513d8b7e4bbb1e7ce371691245` |
| `09-control-team-overlay.json` | T2 进程内对照 10/10：Lead 注册面 + promotion 后可见目录、teammate 在线瞬时注册面 = `profiles.headless-team`（34）；成员拒绝码 | `6ce4b454e5a8e564d62563cbffd751956346aff7ca3e160bb3375009b1b9b214` |

原始临时 home 均按默认清理（PTY/闸门不带 `--keep-temp`）；报告内嵌所需快照，命令见 §2 可复现。

## 9. 双轴只读评审处置（2026-09-25）

对 `ea94d8f → 工作树` 跑了 Standards / Spec 两个只读子代理评审（未修改任何文件）；发现与处置：

| 轴 | 发现 | 处置 |
| --- | --- | --- |
| Standards | `gates/run.mjs` 因新增 renderTeamInto 到 326 行，违反「单文件 <300 行」 | **已修**：拆出 `gates/composition/render-team.mjs`，run.mjs 回到 286 行；新模块纳入闸门源码扫描面（`gate.no-deployment-sync` 扫 25 个源） |
| Standards | `lib/team-roles.ts` 无生产调用点（speculative generality） | **已删**：不变量改由服务 seam（T2 `permission.member-cannot-*`）与 08 实测承担，见 §6 |
| Standards | `gates/team-profile.mjs` 多余 re-export；`profile-expectations.mjs` 未消费导出/参数；`profileBundles` 吞异常 | **已修**：删 re-export 与未消费导出/参数；渲染副本清单不可读改为抛错，不冒充空 bundle |
| Standards | `gates/t1/team-profile.mjs` 重复计算 `checkTeamProfile` 的 ok 条件 | **已修**：只读 `team.ok`，dump 字段仅作证据 |
| Standards | 单测固定三个 profile 名，第四个 profile 会漏检 | **已修**：改遍历 `Object.keys(expectations.profiles)`（集合本身仍显式断言） |
| Standards（判断项） | headless-team 与 tui-team 的 6 条 Team 工具 changes 重复 | **接受**：两形态的 reason 各自独立审阅；共享节点会让「行级差异 + 理由」跨 profile 耦合 |
| Spec | 回退情形无归档执行；且「哨兵缺席判红」与实现里的自动 skip 矛盾 | **已修**：PTY 哨兵缺席一律判红（回退口径进判词，不冒充「未测」）；回退未激活（08 测得），端到端回退跑明确列为边界，声明 + 纯函数单测仍固定口径 |
| Spec | `headless-team` 描述称核对模型可见目录，但只 diff 注册面 | **已修**：Lead 追加 promotion 后可见目录核对（34 = 34），teammate 按在线瞬时注册面，描述同步改准 |
| Spec | 票面/证据写 `npm test` 190/190，评审时的报告实际为 191 | **已修**：处置删除未消费 helper 的 2 条测试后复跑为 189/189，票面、证据与 README counts 同步 |
