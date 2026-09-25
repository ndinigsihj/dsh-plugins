# 票据 12 验收回填 —— 收口验证与部署

生成时间：2026-09-25（宿主 `@deepseek-ai/dsh@0.1.7-rc.1`，会话格式 4）
施工图：`docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（部署与回滚、闸门基准）；升级计划 §7 收口定义与第 11 步

## 0. 结论

- **部署位锚定切到 0.1.7 载体**（用户裁决 B）：`gates/manifest.json` 的 `deployment.minimal-plus`
  改记 `generated/minimal-plus-preset/` 的 10 个文件，目标位为
  `~/.dsh/profiles/{tui-dev,tui-team}/preset-bundles/minimal-plus-preset`；旧目录
  `~/.dsh/.agent-presets/minimal-plus` 保留为 **stable 0.1.5 通道**的载体（本轮不动、不删）。
- **真实写入经用户批准后执行**：`tui-dev` 摘掉 0.1.7 已移除的旧目录 preset 服务行（带备份）+ 装 preset
  bundle；`tui-team` 从 `tui-dev` 派生（Team bundle + 同一份 preset bundle）。
- **最终闸门零豁免**：`--tier 0,1,2 --composition real` **84/0/0**、`--composition gate` **80/0/0**；
  PTY 冒烟 `tui-dev` / `tui-team` 各 **16/16**；部署位断言 `10 files match` + `10 files ok`（两目标）。
- **收口验证抓到一个真实缺陷并已修复**（见 §4）：隔离渲染把 `@scope` 目录整链接回真实
  `node_modules`，装载 bundle 时穿过链接改写了真实部署位链接（悬空）。已加 scope 目录回归测试、
  修复、**修复真实链接**并复跑全部闸门；修复后连跑两轮 gate + 两次 PTY 冒烟，真实链接保持不变。
- **回滚入口仍有效**：票据 03 本地旧宿主副本（`DSH_CLI` 实测 `0.1.5-rc.2`）+ 冷备根保留；
  旧宿主对新宿主已写开的会话不可降级读（票据 10 已实测），丢失窗口与保留期不变。

## 1. 部署位锚定与仓库改动

用户裁决 B（清单跟载体走，不复活旧目录写路径）：

| 位置 | 改动 |
| --- | --- |
| `gates/manifest.json` | `deployment.minimal-plus` = `{repoPath: "generated/minimal-plus-preset", targets: ["~/.dsh/profiles/tui-dev/preset-bundles/minimal-plus-preset", "~/.dsh/profiles/tui-team/preset-bundles/minimal-plus-preset"], files: <10 个产物 sha>}` |
| `gates/manifest.mjs` | 新增 `repoPath`（仓库侧基准目录，缺省 `presets/<key>`）与 `targets`（多目标）；`resolveDeploymentTargets` / `resolveDeploymentRoot`（首个目标）；`checkDeployment` 逐目标判态、聚合取最严重（`deployed`/`state` 兼容旧shape），单文件报告新增 `targets[]` |
| `gates/t1/deployment.mjs` | 报告展开逐目标 `{path,state}`；三态与豁免映射不变 |
| `gates/composition/render-real.mjs` | 部署位是完整 bundle 时**逐字节装载**（`stageBundleArtifact`）——real 闸门验的就是部署位那一份（`preset=deployed`）；缺失/不完整回落仓库真源再生并记录缺件；`PRESET_BUNDLE_REQUIREMENTS` 声明 10 个产物文件 |
| `gates/run.mjs` | real 模式下部署位为 bundle 时不再把 `SMOKE_PRESET_ROOT` 指向 `preset-bundles/`（删覆盖，冒烟装入库产物，与部署位逐字节相等由 T1 sha 断言背书） |
| `scripts/deploy-preset-carrier.mjs` + `-cli.mjs` | 新增「预设载体真实落位」命令：默认 dry-run（计划 + `--json` 证据），`--write` 才写；tui-dev 摘旧行（备份 `cordis.patch.yml.bak-<ts>`）+ 装 bundle，tui-team 从 tui-dev 派生，已存在拒绝覆盖、失败清理新建目录 |
| `scripts/node-modules-mirror.mjs` | 新增（从 `agent-preset-bundle.mjs` 抽出并修 §4 缺陷）：隔离 node_modules 镜像，scope 目录建真目录 |
| `scripts/agent-preset-bundle.mjs` | 移除本地 `materializeNodeModules`，改用上者（文件回到 290 行，满足 <300） |
| `scripts/sync-agent-presets.mjs` | 旧目录提示改为「stable 通道载体，不删」 |
| `scripts/release.sh` | 预检由 staging dry-run 改为 `node scripts/deploy-preset-carrier-cli.mjs --dry-run`（部署位滞后即拦下，仍不写） |
| `README.md` / `docs/deployment.md` | 部署位、豁免语义、交付序列、tui-team 物化口径更新 |

单测：`gates/manifest.test.mjs`（repoPath/多目标/形状）、`gates/composition/render-real.test.mjs`
（部署位 bundle 装载/缺件回落）、`scripts/agent-preset-bundle.test.mjs`（含 §4 回归）、
`scripts/deploy-preset-carrier.test.mjs` 全部入 `npm test`。

## 2. 写入过程（dry-run → 批准 → 写入）

前置状态（`12-home-before.txt`）：`tui-dev/cordis.patch.yml` sha `d39a4f64…`、bundles
`[dsh-base, dsh-antigravity-auth]`、无 `preset-bundles/`；`~/.dsh/profiles/tui-team` 不存在；
旧目录 8 文件；`~/.dsh/profiles/tui-dev` 的 10 项历史备份文件不动。

dry-run 计划（`12-deploy-plan-pre.json` / `12-team-profile-pre.json`）：

```
tui-dev   bundle target=absent repo=ok selection=false legacyRow=strip+backup (exists)
tui-team  bundle target=absent repo=ok selection=false（从 tui-dev 派生）
team-profile（隔离派生）= dump exit 0 / ids 115 / duplicates 0
```

用户批准后在 2026-09-25T23:47:26+0800 执行：

```
node scripts/deploy-preset-carrier-cli.mjs --write --timestamp 20260925-234726
```

写入内容与复核：

- `tui-dev/cordis.patch.yml`：与备份逐行 diff **仅删 10 行**旧 `agent-presets` 块（第 52–61 行），其余不动；
  备份 `cordis.patch.yml.bak-20260925-234726`（sha `…`，见 `12-home-after.txt`）。
- `tui-dev/package.json`：bundles `[dsh-base, dsh-antigravity-auth, @dsh-plugins/minimal-plus-preset]`。
- `tui-dev/preset-bundles/minimal-plus-preset/`：10 文件，与 `generated/minimal-plus-preset/` 逐字节一致。
- `tui-team/`：patch 与迁移后的 tui-dev 逐字节相同；manifest `dsh-profile-tui-team`，bundles
  `[dsh-base, dsh-antigravity-auth, @deepseek-ai/dsh-experimental-agent-team-profile, @dsh-plugins/minimal-plus-preset]`
  （与 09 隔离派生的顺序一致）；`node_modules/` 独立复制；preset bundle 同份。
- 复核（`12-deploy-plan-post.json`）：两目标 `bundle=match`、`selection=true`、`problems=[]`。

## 3. 最终闸门、冒烟与版本

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `scripts/regression-gate.sh --tier 0,1,2 --composition real`（零豁免） | **84 passed / 0 failed / 0 skipped**，`exemptions=[]` | `12-gate-real.json` |
| `scripts/regression-gate.sh --tier 0,1,2 --composition gate`（零豁免） | **80 passed / 0 failed / 0 skipped**，`exemptions=[]` | `12-gate-all.json` |
| `scripts/tui-pty-smoke.sh --profile tui-dev --probe-tools` | **16/16** | `12-pty-tui-dev.json` |
| `scripts/tui-pty-smoke.sh --profile tui-team --probe-tools` | **16/16** | `12-pty-tui-team.json` |
| `node scripts/deploy-preset-carrier-cli.mjs --check` | exit 0，`needsWrite=false`（两目标 current） | `12-deploy-check.json` |
| 真实 profile `--dump-config` | tui-dev **112** / tui-team **115**，duplicates 0，stderr 空 | `12-dump-tui-{dev,team}.yml` |
| `node gates/team-profile.mjs`（隔离派生对照） | dump exit 0 / ids 115 / duplicates 0 | `12-team-profile-post.json` |
| `node scripts/agent-preset-bundle-cli.mjs --check` | 10/10 一致 | `12-bundle-check.txt` |

关键断言：`composition.real-render … preset=deployed`（验的是部署位那一份）、
`deployment.repo-matches-manifest — 10 files match`、`deployment.repo-vs-deployed — 10 files ok`、
`composition.team-profile — ids=115`、`isolation.real-home-untouched — 签名一致`（固定后多轮均绿）。
real 模式的主冒烟报告字段 `smoke.bundle` 显示
`… preset-bundles/minimal-plus-preset (deployed bundle …)`（装载部署位），gate 模式显示
`(generated from …/presets)`——两种形态各自可审计。

退出码零豁免链：`release.sh` 现跑 `--check`（部署位缺席/滞后即 exit 1，不写）；CI 的
`--skip-deployment-check` 只用于「部署位缺席」（CI 无真实 `~/.dsh`），语义与
`--allow-stale-deployment` 的「滞后豁免」不同，且 **本仓库调用链已无 `--allow-stale-deployment`**
（`grep` 仅命中机制定义与文档说明）。

## 4. 收口抓到并修复的缺陷：scope 链接回写真实部署位（票 12 回归）

**现象**：写入后首次真实 `--dump-config` 报

```
dsh: skipping profile bundle "@dsh-plugins/minimal-plus-preset": cannot resolve … from the dsh installation or ~/.dsh/profiles/tui-dev
```

真实 tui-dev 组合只有 110 条；隔离开关渲染却是 112 条（差正好是 preset 的两条声明行）。
第一次部署后 gate 的 `isolation.real-home-untouched` 也短暂判红（`profiles` 区签名变化、文件数相同）。

**根因**：`renderRealComposition` 把真实 profile 的 `node_modules` 以符号链接接进临时 profile 后，
`materializeNodeModules` 把**顶层每个条目**都链接回真实树——包括 scope 目录 `@dsh-plugins`。
随后 `wireBundleIntoProfile` 写 `node_modules/@dsh-plugins/minimal-plus-preset` 时穿过该目录链接，
`rmSync` + `symlinkSync` 落在**真实** `tui-dev/node_modules/@dsh-plugins/` 上，把真实链接改写成临时
bundle 路径（随后临时目录被删 → 悬空）。附：`@dsh-plugins` 目录正是票据 12 部署才产生的，所以票 07/08/09
的闸门运行没有触发。

**修复**：抽出 `scripts/node-modules-mirror.mjs`；镜像时 scope 目录（以及任何顶层目录）建成**真目录**，
只链接其子条目，杜绝穿过链接回写。回归测试：
`scripts/agent-preset-bundle.test.mjs`「源 node_modules 已含 @scope 目录时，不得穿过 scope 链接写回真实 profile」。

**部署位修复**：用 `wireBundleIntoProfile` 重新把真实 `tui-dev` 链接指回
`~/.dsh/profiles/tui-dev/preset-bundles/minimal-plus-preset`（目标可读、dump 112、stderr 空）。
证据：`12-defect-prefix-dump-tui-dev.err`（缺陷期 stderr）、`12-home-after.txt`（修复后指纹：
两个 profile 的链接各自指向自己的 `preset-bundles/`）。

**复验**：修复后重跑两轮零豁免闸门 + 两次 PTY 冒烟 + 两个真实 `--dump-config`，真实链接保持
不变（`readlink` 复核）；`isolation.real-home-untouched` 连续绿。

## 5. P0 命名命令与收口清单

| 收口项 | 命名命令 | 证据 |
| --- | --- | --- |
| 宿主钉版/版本输出 | `~/.dsh/bin/dsh --version`、直接 v24 入口 | `12-versions.txt`（0.1.7-rc.1；v22 保持 0.1.5-rc.1 属已裁决范围外） |
| 会话格式迁移 | 票据 10（B 口径）；`session.format-version` 闸门断言 | 计划 §7 第 10 步；本轮 gate 绿 |
| preset 载体 | `node scripts/deploy-preset-carrier-cli.mjs`（dry-run）/ `--write` | `12-deploy-plan-{pre,post}.json` |
| 部署位一致性 | `scripts/regression-gate.sh --tier 0,1,2 --composition real`（零豁免） | `12-gate-real.json` |
| 三种一致性链 | 真源 ↔ 产物 = T0 `npm test`（不可豁免）→ 产物 ↔ 清单 = `deployment.repo-matches-manifest`（不可豁免）→ 清单 ↔ 部署位 = `deployment.repo-vs-deployed` | `12-gate-real.json`、`12-bundle-check.txt` |
| 部署预检 | `node scripts/deploy-preset-carrier-cli.mjs --check`（缺席/滞后 exit 1） | `12-deploy-check.json` |
| 两种形态闸门 | 同上 + `--composition gate`；PTY 双形态 | `12-gate-{real,all}.json`、`12-pty-*.json` |
| expectations 审阅 | 票据 07/09 行级 diff + 理由入库 | 票 07/09 证据 |
| 回滚入口/冷备 | `DSH_CLI=<副本> ~/.dsh/bin/dsh --version`；冷备根 + meta 清单 | `12-versions.txt`（0.1.5-rc.2）、`12-rollback-assets.txt` |
| 豁免移出调用链 | `grep -rn -- "--allow-stale-deployment" scripts .github package.json` | 仅机制定义/文档；release 与 CI 调用链无 |

**冷备保留期**：至少到新宿主稳定走过一次正式版升级（票据 03/04 结论不变；本轮未删任何备份）。
**丢失窗口**：2026-09-25T17:04:49+0800 之后写入（票据 04/10 口径不变）。

## 6. 遗留与后续

- **票据 14（子代理首轮锚定根因）** 尚未实现；其改动会改 preset 真源 → 落地后需按同一流程重跑
  `deploy-preset-carrier-cli.mjs`（dry-run → 批准 → `--write`）并复跑本票闸门。本票部署的是当前真源
  （`includeSubagents: true` 形态），与票 14 的目标态不同。
- **stable 通道**仍用 0.1.5 自包含运行时 + 旧目录载体（`~/.dsh/.agent-presets/minimal-plus`），
  `scripts/preset-mount-smoke.mjs` 继续覆盖它；stable 迁 0.1.7 时按同一流程迁移。
- **旧目录不删**：删除需另行批准；本轮已按裁决保留。
- 票 07 评价过的 `agent-preset-bundle.mjs` 行数问题在本票顺带解除（291 行，mirror 抽到新模块）。

## 7. 双轴只读评审与处置（2026-09-25）

两个只读子代理分别按 Standards（`~/.dsh/AGENTS.md` + Fowler smell 基线）与 Spec（本票 + spec +
计划 §7 + 本证据）评审未提交变更。发现与处置：

**Standards**
1. `README.md` 载体段仍写「真实部署位写入在收口票 12（当前部署位仍是 0.1.5 目录形态）」→ 已改写为
   三层一致性链 + 同步/部署工具分工 + 旧目录只服务 stable。
2. 重复实现（DRY：`sha256Text` 第 4 份、`readJson` 重复、`manifest?.dsh?.profile?.bundles` 三处）→
   `sha256Text` 提到 `gates/gate-helpers.mjs` 共用、`readJson` 改用既有导出、`profileBundles()` 收口。
3. 「bundles 唯一写入点」被绕过（team 直接写 manifest）→ Team bundle 改走
   `mutateProfileBundles`（preset 仍由 `wire` 的同一点追加）；名字字段在初始 manifest 写入时设定。
4. 判断题（Data Clumps / 重复 inspect 块 / Feature Envy / Message Chains）→ 抽出 `common`
   输入与 `inspectTarget()`，planner 返回各自的 `problems` 由调用方合并；参数降到 2–3 个。
5. `preset-mount-smoke.mjs` 305 行（既有超限）→ 本票注释压到 3 行（现 303 行，未引入功能改动）。

**Spec**
1. 计划 §7 第 11 步点名 `sync-agent-presets.sh --dry-run`，实际多 profile 收口由新命令承担 →
   计划第 11 步完成段与 README/deployment 明确两者分工（单 profile 写入仍是 sync 工具；多 profile
   收口是 deploy-preset-carrier），并将 release 路径改为 `--check`。
2. 同步工具未承载 profile 侧多目标写入 → 同上，属命名迁移而非能力缺口；`sync --profile --write`
   仍是底层写入器。
3. real 模式主冒烟此前装载入库产物而非部署位 → 新增 `SMOKE_PRESET_BUNDLE`，`gates/run.mjs` 在
   `preset=deployed` 时把它指向部署位；`smoke.bundle` 报告字段留证（见 §3）。degrade 显式清掉该
   变量并固定仓库真源（此前会被继承而绕开被改坏的真源，已修）。
4. 「清单改指 generated 削弱不可豁免层」→ 记录三层链：真源↔产物由 T0 `npm test`（不可豁免）
   守住，产物↔清单与清单↔部署位在 T1 各自不可豁免/仅部署位可豁免；三层都在同一闸门命令内。
5. 新增 ~330 行 + 测试「重复 sync 工具 profile 模式」→ 该命令承担旧行摘除、双 profile、Team 派生，
   `sync --profile` 无这些职责；本轮后不再有一次性迁移代码，判定保留。
6. `release.sh` 原注释声称新 dry-run 会拦下滞后部署，但默认 dry-run exit 0 → 该断言正确：新增
   `--check` 模式（缺席/滞后 exit 1）并改 release 调用与注释；默认 dry-run 的 exit 0 只表示
   「计划可执行」，stdout 明确打印 `deployment is NOT current`。
