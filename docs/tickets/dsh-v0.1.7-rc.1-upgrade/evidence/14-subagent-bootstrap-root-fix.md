# 票据 14 证据 —— 子代理豁免锚定（`includeSubagents` 统一 `false`）

生成时间：2026-09-26（宿主 `@deepseek-ai/dsh@0.1.7-rc.1`，会话格式 4）
施工图：`docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Implementation Decisions：子代理锚定）；升级计划 §1.1、§6 P1 行
范围：preset 真源三处 `includeSubagents` 统一 `false` + 契约测试 / 冒烟 / 闸门 / 产物；**部署位真实写入不在本票**（见 §5）。

## 0. 结论

- **三处口径统一 `false`**：`agent.cordis.yml` 的 `tool-bootstrap` / `phase-swap-bash` /
  `instruction-hint` 三行显式 `includeSubagents: false`；`phase-swap-bash.mjs` 删除硬编码
  `includeSubagents: true`，改为读 config（新增允许键 + 布尔校验，缺省 false），与另两处一致。
- **可观察行为**（0.1.7 载体组合冒烟 + 真实运行时契约测试）：
  - 主会话 R1 仍是锚定对 `["bash","str_replace_editor"]`（persistent bash），R2 全量 28 工具 +
    沙箱 bash（`sandbox_permissions`/`justification`）+ 二轮注入；
  - 子代理（`delegationDepth > 0`）R1 即全量 28 工具，`tool:*` 指引段不过滤，pre-step 注入与
    主会话 R2 同面（`agent-instructions` / `skill-catalog` / `instruction-hint`）；
  - 子代理**首轮 bash 仍 persistent**：真实 loop 的 `turn/start` 排在首次请求装配之前，豁免锚定
    不得让它提前换相；首步 `step/end` 后才换沙箱。冷恢复且日志已有结算 step 的子代理在
    `turn/start` 换相；compaction 后回 persistent，下一次 step 结算再换相。
- **产物与闸门（部署位已刷新）**：`generated/minimal-plus-preset/` 重生成，`--check` 10/10 一致；
  `gates/manifest.json` 同步 4 个变更文件 sha；用户批准后按 `sync-agent-presets.mjs --profile
  {tui-dev,tui-team} --write` 刷新两个部署位（各 4 个文件从 STALE → match）。复验：
  `npm test` **214/214**、`tsc --noEmit` exit 0；
  `--tier 0,1,2 --composition gate` **81 passed / 0 failed / 0 skipped（零豁免）**；
  `--composition real` **85 passed / 0 failed / 0 skipped（零豁免，preset=deployed）**；
  PTY 冒烟 `tui-dev` / `tui-team` 各 **16/16**（均含 `tool-probe.profile-surface`）。
- **expectations 登记**：新增 `presets.minimal-plus.subagentRound1`（`basedOn:
  presets.minimal-plus.round2.tools` + `reason` + `bashParamsExcludes`），行级引用不复制工具名；
  `round1` / `round2` 未变（无工具面增删）。

## 1. 改动面

| 文件 | 改动 |
| --- | --- |
| `presets/minimal-plus/agent.cordis.yml` | `tool-bootstrap` / `phase-swap-bash` / `instruction-hint` 三行 `includeSubagents: false`（含 2026-09-26 注释说明） |
| `presets/minimal-plus/compaction-epoch.mjs` | 导出共享判定 `isAnchorExemptSubagent(session, includeSubagents)`；`status()` 改用它（豁免谓词单点，三处插件不再各写一份） |
| `presets/minimal-plus/phase-swap-bash.mjs` | `ALLOWED_KEYS` 增 `includeSubagents`；读 config 且缺省 false（不再硬编码）；模块级 `hasSettledStep`（按 compaction 边界判「日志已有结算 step」）；豁免子代理的 `turn/start` 时机守卫 |
| `presets/minimal-plus/smoke-driver.mjs` | 抽出 `createAgent(sessionId, meta)`；新增子代理（`meta.delegationDepth: 1`，先落 `turn/start` 再装配）R1 断言：全量目录、persistent bash、pre-step 三源；主会话 R1 收紧为锚定对相等；`SMOKE_EXPECT_FAIL_OPEN=1` 时按降级模式断言 |
| `scripts/degrade-smoke.sh` | 对 smoke-driver 置 `SMOKE_EXPECT_FAIL_OPEN=1`（降级路径 R1 期望 fail-open 全量，正常冒烟仍断言锚定对） |
| `presets/minimal-plus/phase-swap-bash.test.mjs` | 保留主会话/通用相位断言（285 行，回落 <300） |
| `presets/minimal-plus/phase-swap-bash-subagent.test.mjs` | **新增**：子代理相位契约（首步结算后独立 swap / `turn/start` 不提前换相 / 冷恢复换相 / `includeSubagents: true` 配置语义 / `tool:*` sections 不过滤 / compaction 后再换相） |
| `presets/minimal-plus/tool-bootstrap.test.mjs` | 子代理首轮全量 vs 主会话锚定、pre-step 不剥 suppressed 源、`includeSubagents: true` 仍锚定 |
| `presets/minimal-plus/instruction-hint.test.mjs` | 子代理首轮即注入且一次、主会话仍等 promotion |
| `package.json` | `npm test` 清单加入 `phase-swap-bash-subagent.test.mjs` |
| `gates/t1/preset.mjs` | 新断言 `smoke.subagent-exempt-first-turn`：解析 `ROUND1 subagent catalog` / `ROUND1 subagent pre-step sources`，与 expectations 的 `subagentRound1` 对账 |
| `gates/expectations.json` | 新增 `subagentRound1` 行级登记；`profiles.*` 与 `round1`/`round2` 不动 |
| `gates/profile-expectations.mjs` | 导出既有纯函数 `resolveToolsRef`（供 T1 解析 `subagentRound1.basedOn`；无行为变化） |
| `generated/minimal-plus-preset/` | 重生成：`compaction-epoch.mjs` sha `35b1b7342a17…`、`phase-swap-bash.mjs` `b0bf21084487…`、`source-manifest.json` `8267a29be348…`（`cordis.patch.yml` 因配置值变化为 `30b1b622bd14…`；其余 6 文件不变） |
| `gates/manifest.json` | `deployment.minimal-plus.files` 同步上述 4 个 sha |
| `README.md` / `CONTEXT.md` | 行为清单补子代理锚定豁免；术语表 `Anchored first turn` / `Promotion` 增子代理分支（AGENTS.md「改配置须同步 README/索引」） |
| `docs/dsh-v0.1.7-rc.1-upgrade-{closeout,plan,spec}.md`、票据 14、`.dsh/ask-matt-flow/state.md` | 状态回填（实现落地、部署位刷新待批准） |

## 2. 行为证据

冒烟（真源现场生成载体）：`SMOKE_PRESET_ROOT=presets node presets/minimal-plus/smoke-boot.mjs` →
exit 0，全文 `14-smoke-source.txt`，关键行：

```
ROUND1 catalog: {"tools":["bash","str_replace_editor"],"bashParams":["command"],…}
ROUND1 subagent catalog: {"tools":[28 个工具],"bashParams":["command"],…}
ROUND1 subagent pre-step sources: ["agent-instructions","skill-catalog","instruction-hint"]
ROUND2 catalog: {"tools":[同上 28 个],"bashParams":["command","description","timeoutMs","workdir","run_in_background","sandbox_permissions","justification"],…}
WARNINGS: []
```

回归红→绿（施工顺序）：先加冒烟断言 → 子代理 R1 仍为锚定对（红）；三处配置/读配置落地后 →
子代理 R1 全量但 `turn/start` 提前换沙箱（时机守卫缺失，红）；加守卫 → 全绿。

契约测试（`node --test presets/minimal-plus/{tool-bootstrap,phase-swap-bash,phase-swap-bash-subagent,instruction-hint}.test.mjs`）：

- 子代理首轮全量 vs 主会话同配置锚定（tool-bootstrap）；子代理 pre-step 不剥 suppressed 源；
- `includeSubagents: true` 时子代理仍跟随锚定周期（证明不是硬编码）；
- 子代理首轮 `turn/start` 不换相、首步 `step/end` 换相、冷恢复已有结算 step 时 `turn/start` 换相、
  compaction 后回 persistent 再换相；
- 子代理 `tool:*` sections 不过滤，主会话未 promote 仍过滤；
- 子代理首轮即注入 instruction-hint 且只一次，主会话仍等 promotion。

## 3. 闸门与测试

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `npm test` | **214 passed / 0 failed**（23 个测试文件） | 闸门 T0 `npm.test` / `testfile.list-consistency` |
| `npx tsc -p tsconfig.json` | exit 0 | 闸门 T0 `tsc.noEmit` |
| `scripts/regression-gate.sh --tier 0,1,2 --composition gate`（部署刷新后，零豁免） | **81 passed / 0 failed / 0 skipped**，exit 0；`deployment.repo-vs-deployed — 10 files ok` | `14-gate-gate-postdeploy.json` |
| `scripts/regression-gate.sh --tier 0,1,2 --composition real`（零豁免，preset=deployed） | **85 passed / 0 failed / 0 skipped**，exit 0 | `14-gate-real.json` |
| `scripts/tui-pty-smoke.sh --profile tui-dev --probe-tools` | **16/16**（部署位 bundle） | `14-pty-tui-dev.json` |
| `scripts/tui-pty-smoke.sh --profile tui-team --probe-tools` | **16/16**（部署位 bundle） | `14-pty-tui-team.json` |
| `node scripts/agent-preset-bundle-cli.mjs --check` | 10/10 一致，exit 0 | `14-bundle-check.txt` |
| `node scripts/deploy-preset-carrier-cli.mjs --check`（刷新后） | exit 0，`deployment is current`（两目标 `bundle target=match`） | `14-deploy-write.txt` |

闸门新增断言：`smoke.subagent-exempt-first-turn — exit 0 tools=28 missing=[] unexpected=[] bashStillAnchored=true preStepMissing=[]`；
`degrade.fail-open — exit 0 warning=true R1 tools=28`（降级路径未被收紧破坏）；主会话既有断言
`smoke.anchored-first-turn — R1=["bash","str_replace_editor"]`、`smoke.promoted-catalog — tools=28` 保持绿。

## 4. expectations 工具面登记

```json
"subagentRound1": {
  "basedOn": "presets.minimal-plus.round2.tools",
  "changes": [],
  "reason": "票据 14（方案 A）：delegationDepth > 0 的子代理豁免首轮锚定，首轮即全量目录（与主会话 round2 全量面逐行相同，不复制 28 条工具名）；bash 仍为 persistent（首步结算后才换沙箱），pre-step 注入与 round2 相同。",
  "bashParamsExcludes": ["sandbox_permissions"]
}
```

`basedOn` + reason 是行级登记：既表达「子代理 R1 = 主会话 R2 全量面」，又不整文件复制；
`round1`/`round2` 与 `profiles.*` 本轮零改动。

## 5. 部署位刷新（2026-09-26，用户批准后执行）

- 刷新前两个部署位仍是旧 `includeSubagents: true` 形态，逐文件差 4 个
  （`compaction-epoch.mjs` / `cordis.patch.yml` / `phase-swap-bash.mjs` / `source-manifest.json`）。
- 工具路径发现：票据 12 的 `deploy-preset-carrier-cli.mjs --write` 是一次性迁移工具
  （`applyPresetCarrier` 明确「tui-team 已存在即拒绝覆盖」），不能用于增量刷新；本次改用
  `node scripts/sync-agent-presets.mjs --profile tui-dev --write` 与 `--profile tui-team --write`
  （逐 profile 重建 `preset-bundles/minimal-plus-preset`，条目选择幂等、不动 cordis.patch.yml）。
  全过程输出见 `14-deploy-write.txt`。
- 刷新后复核：
  - 两 profile dry-run `target already matches (10 files)`，exit 0；
  - `deploy-preset-carrier-cli.mjs --check` exit 0（两目标 `bundle target=match`、`selection=true`）；
  - 部署位 `cordis.patch.yml` 三处 `includeSubagents: false`；`phase-swap-bash.mjs` sha
    `b0bf21084487…` 与仓库产物逐字节一致；
  - `--composition gate` 81/0/0 **零豁免**、`--composition real` 85/0/0 **零豁免**
    （real 装载的即部署位那一份）、PTY 双形态各 16/16（§3）。
- 旧目录 `~/.dsh/.agent-presets/minimal-plus` 未动（stable 0.1.5 通道载体，票据 12 口径）。
- 首轮 PTY 冒烟在默认沙箱下报 `posix_openpt: Operation not permitted`（环境限制，非回归），
  经一次性提权复跑后 16/16；归档的 `14-pty-*.json` 为复跑结果。

## 6. code-review 双轴处置（2026-09-26）

- **Standards（硬项）**：`phase-swap-bash.test.mjs` 因新增断言涨到 382 行 → 子代理相位用例拆到
  `phase-swap-bash-subagent.test.mjs`，主文件回落到 285 行（<300）；豁免谓词复制 → 收进
  `compaction-epoch.isAnchorExemptSubagent` 单点；`apply()` 内联守卫提升为模块级 `hasSettledStep`；
  README/CONTEXT 行为说明补齐。函数长度（`apply()` 等超 <50 行）与 gates/t1 断言块重复按
  「既有超限、不在本票重构」记录，未扩大改动面。
- **Spec**：三处统一、主会话锚定不变、首步换相语义、产物/manifest/闸门核对均逐条对上；
  「修复未上线」的评审意见已按用户批准关闭——部署位已刷新，gate/real 零豁免全绿、PTY 双形态
  16/16（§3、§5）。
- 评审前修正的额外口径：closeout 里「票据 13 文档未提交」更新为已提交 `aa48955`；
  H5 冷启动措辞改为「豁免子代理没有 tool/call 信号，不沿用 H5 promotion 口径」。

## 7. 命令与文件索引

- 冒烟：`14-smoke-source.txt`；产物核对：`14-bundle-check.txt`；部署前闸门（带豁免）：
  `14-gate-all.json`；部署刷新与复核：`14-deploy-write.txt`；刷新后零豁免闸门：
  `14-gate-gate-postdeploy.json`（gate）/ `14-gate-real.json`（real）；PTY：`14-pty-tui-dev.json` /
  `14-pty-tui-team.json`；部署前只读计划与 dry-run：`14-deploy-plan.{txt,json}`、
  `14-sync-dry-run.txt`。
- 复现：`SMOKE_PRESET_ROOT=presets node presets/minimal-plus/smoke-boot.mjs`；
  `node --test presets/minimal-plus/{tool-bootstrap,phase-swap-bash,phase-swap-bash-subagent,instruction-hint}.test.mjs`；
  `node scripts/agent-preset-bundle-cli.mjs --check`；
  `scripts/regression-gate.sh --tier 0,1,2 --composition gate|real`（零豁免）；
  `scripts/tui-pty-smoke.sh --profile tui-dev|tui-team --probe-tools`（需 PTY 权限）。
