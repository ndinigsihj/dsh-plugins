# dsh-plugins 升级至 0.1.7-rc.1 — 收口记录（as-built）

> 日期：2026-09-26（票据 13 文档收口）。状态：**已提交 `aa48955`**；后续票据 14 实现（未提交）见 §2 与 §7.1。
> 范围：开发侧宿主 `0.1.5-rc.2` → `0.1.7-rc.1`（跨越整个 `0.1.6` 代际）＋ 会话格式 V4 迁移 ＋
> Preset 载体迁移（目录形态 → bundle 声明行）＋ 新增 Team Profile（`tui-team`）＋ 部署位真实写入。
> 稳定侧（`dsh-runtime/stable` + `tui` + 旧目录载体）与 v22 旧安装点保持钉版，不在本轮目标内。
> 关联：`docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（范围与决策）、`docs/dsh-v0.1.7-rc.1-upgrade-plan.md`（计划与逐票回填）、
> `docs/tickets/dsh-v0.1.7-rc.1-upgrade/01..14-*.md`（票据）与 `evidence/`（证据）、
> `README.md`（宿主升级节奏、闸门口径）、`docs/deployment.md`（发布/部署侧）。

本文的目标：把升级后的真实状态一次写清，下一个维护者不必重新调研。
「官方证实 / 本仓库实测 / 未验证」在文中分开标注。

## 1. 目标与版本事实（as-built）

### 1.1 本次采用（2026-09-25 复核）

| 项 | 值 | 证据 |
| --- | --- | --- |
| 开发侧默认入口 | `~/.dsh/bin/dsh` → nvm v24.21.0 全局 `@deepseek-ai/dsh@0.1.7-rc.1` | `evidence/12-versions.txt` |
| 开发侧直接入口 | v24 全局同版本 `0.1.7-rc.1`（wrapper 与直接入口一致） | 同上 |
| 会话格式 | **V4**（`gates/manifest.json` 的 `sessionFormatVersion: 4`） | `evidence/04-host-pin.txt` |
| 升级动作 | `npm i -g @deepseek-ai/dsh@0.1.7-rc.1`（精确锁定，不跟随 `next`） | 票据 04；计划 §7 第 3 步 |
| 生效范围 | `tui-dev` / `headless` 两个工作 Profile 同步升级；新增 `tui-team`（Team 组合） | 票据 04/09/12 |
| 部署位 | `~/.dsh/profiles/{tui-dev,tui-team}/preset-bundles/minimal-plus-preset`（各 10 文件，与 `generated/minimal-plus-preset/` 逐字节一致） | `evidence/12-deploy-plan-{pre,post}.json` |
| 旧目录载体 | `~/.dsh/.agent-presets/minimal-plus` 保留，只服务 stable 0.1.5 通道（0.1.7 不再读取） | `evidence/12-*`；C0 ④ |
| 回滚入口 | 票据 03 本地旧宿主副本 + `DSH_CLI` → `0.1.5-rc.2` | `evidence/12-versions.txt` |

### 1.2 版本链与范围外钉版

- npm dist-tags 在本轮开始时为 `latest → 0.1.5-rc.3`、`next → 0.1.7-rc.1`、`alpha → 0.1.7-alpha.2`；
  计划裁决**精确锁定 `0.1.7-rc.1`**，窗口内若正式版发布也只另开小步升级（未发生）。
- `0.1.5-rc.3` 是浮动依赖精确钉版的 republish（tarball 逐文件比对无代码差异，C0 ⑤）。
- **v22 全局安装点**保持 `0.1.5-rc.1`（计划钉版口径，未触碰）。
- **稳定树** `dsh-runtime/stable` 于 2026-09-25 按自身 lock 自包含重建：CLI `0.1.5-rc.2` +
  nested 子包 `0.1.5-rc.3`、595 包（`npm ci` 实测，见 `evidence/04-stable-runtime-repair.txt`），
  不再有指向全局树的链接（此前 240 条 scoped symlink 会随全局换代翻车，`1mdsh` 已复验可跑；
  重建后需重放 130 条扁平镜像 shim，脚本 `evidence/04-stable-flat-mirror.sh`）。
  稳定侧迁 0.1.7 时按同一流程单独走（见 §7.1）。

## 2. 本轮实际范围与交付状态

| 票据 | 主题 | 状态 | 证据 |
| --- | --- | --- | --- |
| 01 | 闸门编排器拆模块（迁移前置） | done（提交 `f0a2cd0`） | `evidence/01-gate-script-module-split.md` |
| 02 | 前置取证 C0（六项事实 + 附件/storages） | done（提交 `6a432b5`） | `evidence/02-preflight-*`、`02-preflight-repro.sh` |
| 03 | 回滚资产与安全网（冷备 + 还原演练） | done（提交 `07fed28`） | `evidence/03-*` |
| 04 | 宿主升级与两个工作 Profile | done（提交 `68604ba`、`fb5bc10`） | `evidence/04-*` |
| 05 | 会话读取异步化迁移 | **deferred**（用户裁决维持同步读取，不迁移） | C0 ①；票面 |
| 06 | 其余兼容面迁移（PTC/spill/启动等待/插件启停/适配器/闸门源码） | done（提交 `22da757`、`df76f88`） | `evidence/06-*` |
| 07 | Preset 载体迁移与同步工具 dry-run | done（提交 `f75a7ad`） | `evidence/07-*` |
| 08 | B1.5：Team Profile 的 Preset 叠加实测 | done（提交 `ea94d8f`） | `evidence/08-*` |
| 09 | `tui-team` 建立与 Profile 维度闸门基线 | done（提交 `b2b4938`） | `evidence/09-*` |
| 10 | 会话格式迁移执行与抽样验证（B 口径） | done（提交 `ac19a7a`） | `evidence/10-*` |
| 11 | 真实模型基线重采与探针口径收口 | done（提交 `ab03841`） | `evidence/11-*` |
| 12 | 收口验证与部署（真实写入 tui-dev/tui-team） | done（提交 `fdec617`） | `evidence/12-*` |
| 13 | 文档收口与升级节奏政策（本文） | done（提交 `aa48955`） | 本文 + `README.md` + `docs/deployment.md` |
| 14 | 子代理豁免锚定（`includeSubagents` 统一 `false`） | implemented（**未提交**；提交 `f8a6f72` 落裁决与票面，本次落实现；部署位刷新待批准） | `evidence/14-*`；见 §7.1 |

提交状态：票据 01–12 的改动均已提交到本地 `main`（未 push，领先 `origin/main` 19 个提交）；
票据 13 的文档改动已提交 `aa48955`；票据 14 实现（仓库真源 + 产物 + 测试 + 闸门）未提交，
部署位刷新待用户批准。

## 3. 裁决落地对照（计划 §1.1）

| 裁决 | 落地情况 | 证据 |
| --- | --- | --- |
| 目标版本精确锁定 `0.1.7-rc.1`，不跟随浮动 tag | ✅ v24 全局与默认入口均为 `0.1.7-rc.1` | `evidence/12-versions.txt` |
| `tui-dev` 与 `headless` 同步升级（不合并委派口径） | ✅ 两 Profile `--dump-config` exit 0、逐 loader id 计数为 1；`modelSelectionSettings` 仍分别 enabled/disabled | 票据 04/06 证据 |
| 接受 V4 不可逆、不保留"先不迁"分支 | ✅ 冷备 + 还原演练前移到首次启 0.1.7 之前；按需惰性迁移（B 口径）；旧宿主降级边界实测 | 票据 03/04/10 |
| Agent Team 本轮开启，C 方案（profile 划分） | ✅ `tui-team` 从 `tui-dev` 派生（Team bundle + preset），非 Team Profile 不挂 Team bundle | 票据 09/12 |
| 自研 preset 保留（含二轮 bash 换用） | ✅ `minimal-plus` 真源保留并迁到 bundle 声明行；淘汰改为事件触发复评 | 票据 07；计划 §3.6 |
| Preset 载体 = 0.1.7 bundle patch（真源留仓库） | ✅ `generated/minimal-plus-preset/` 入库；旧目录硬切无过渡分支 | 票据 07/12；C0 ④ |
| 子代理锚定 = 方案 A（三处 `includeSubagents: false`） | ✅ 三处统一 `false`（phase-swap 改读配置 + 豁免子代理首轮 `turn/start` 换相守卫）；主会话首轮锚定不变；`gate` 组合闸门 81/0/0（唯一豁免 = 部署位滞后），部署位刷新待批准 | 票据 14；`evidence/14-*` |
| manifest 两阶段口径 | ✅ preset sha 随仓库、`hostVersion`/`sessionFormatVersion` 随宿主切换；部署位滞后豁免只在过渡窗口 | `gates/manifest.json`；票据 04/12 |
| expectations 增 profile 维度；T3 在新宿主重采 | ✅ `gates/expectations.json` 增 `profiles` 段（tui-dev 35 / headless-team 34 / tui-team 40）；新基线 N=9 | 票据 09/11 |
| 升级节奏政策（Q14） | ✅ 写入 `README.md`「宿主升级节奏」并由 `docs/deployment.md` 与计划 §7 引用 | 本文 §9 |
| 部署时机：收口后统一部署 | ✅ 用户批准后 `--write` 真实写入；零豁免闸门全绿 | `evidence/12-*` |

## 4. 破坏性变更与迁移对照（官方变更 → 本仓库处置）

口径：官方变更以逐版 release notes 与 C0 实测为准；「处置」是实测后的现状，证据指向票据与 evidence 文件。

### 4.1 P0（不迁移就跑不起来或会丢数据）

| 官方变更 | 本仓库处置 | 证据 |
| --- | --- | --- |
| 会话日志 **V4**；无批量迁移工具、无 dry-run；写开发布 v4 后继且源文件保留；**不支持降级读** | 冷备（含 `attachments/`）＋ 旧宿主还原演练 → 首次启 0.1.7 → **按需惰性迁移**（B 口径）：8 个代表会话写开 8/8 绿，其余 1571 个留清单待 resume 时迁移；218 个不可读会话经旧宿主对照确认为既存盲区；坏文件「跳过并登记」 | 票据 03/04/10；`evidence/10-*` |
| 会话历史/生命周期/沙箱接口异步化；`snapshotEvents` 等弃用 | C0 核实 rc.1 三个同步方法**签名逐字未变**（仅 `@deprecated`）→ 存量调用保留、**不迁移**、禁止新增；票据 05 deferred | `evidence/02-preflight-signatures.txt` |
| Agent 预设改由插件组合包声明与安装；旧目录预设不再加载 | 真源留仓库，生成自包含 bundle（`generated/minimal-plus-preset/`，10 文件）＋ profile 选择；同步/部署工具默认 dry-run；三层一致性链（真源↔产物↔清单↔部署位） | 票据 07/12；`evidence/07-*`、`12-*` |
| 设置改存 Profile 插件配置；旧 `settings.yaml` 仅导入一次 | 升级前备份并记录 sha（票据 03/04）；导入行为由 C0 附带核实（3 条改名映射）；`--dump-config` 与设置读回一致 | `evidence/03-*`、`12-dump-tui-*.yml` |
| 官方 DeepSeek 适配器仅用 Messages API，移除 `protocol`/旧根地址 | profile/settings 审计：无 `protocol`、无旧根地址覆盖；真实路由一次 `tool_call → tool_result(completed) → final` 验证 | `evidence/06-adapter-and-spill-config-audit.txt`、`06-real-model-tool-call.txt` |
| 工具结果 token 预算；`spill-policy.maxInlineBytes → maxInlineTokens` | 0.1.7 通知拼写未变；`maxInlineTokens` 生效后超长结果收敛为定位符通知，TUI 渲染保持 `⤓ full result <locator>`；补单测 | `evidence/06-spill-render.txt`、`lib/spill-notice.test.ts` |
| 宿主钉版与会话格式断言随宿主换代 | `gates/manifest.json` 改 `hostVersion: 0.1.7-rc.1`、`sessionFormatVersion: 4`；两条断言零豁免绿 | `evidence/04-host-pin.txt`、`12-gate-real.json` |
| C0 前置取证（临时前缀、独立 cache、真实 `~/.dsh` 零写入） | 六项事实 + 附件/storages 判定全部关闭；结论写回计划 §6/§7/§8 | 票据 02；`evidence/02-preflight-conclusions.md` |

### 4.2 P1/P2（行为变化与默认值）

| 官方变更 | 本仓库处置 | 证据 |
| --- | --- | --- |
| PTC 独立进程、包名 `ptc-runtime`、执行器改 `workflow-ptc` | 隔离组合激活正常；仓库无旧包名/旧服务名引用 | `evidence/06-ptc-activation.txt` |
| `agent/session-start` → 异步串行 `agent/created` | 核对完成、无需改码：`agents.create()` 在启动发布后 resolve、不发起模型请求；失败走 TUI 诊断路径 | `evidence/06-startup-wait.txt` |
| 插件依赖运行时解析、支持运行时卸载 | `skill-search` / `custom-bash` / `phase-swap-bash` 注册随插件 fiber 注销；phase-swap per-agent shadow 无残留 | `evidence/06-remaining-compat-surfaces.md` §3.4 |
| Team 模式 `spawn_teammate`，`subagent`/`subagent_fork` 不再提供 | `tui-team` 单独 Profile；B1.5 实测（非"未测"）：Team 开启下 `subagent` + `list_subagent_models` 与 6 个 Team 工具**并存**；工具面按 profile 分账 | 票据 08/09 |
| 委派路由能力不对称（`subagent` 有允许路由选择、Team 无路由字段） | ADR-0001 边界收窄为"非 Team profile 的 `subagent` 委派"；T3 探针 a14 改名 `a14-whitelist-route-compliance`（为允许路由集合背书） | `docs/subagent-model-selection.md`；`evidence/11-*` |
| Ralph 默认关闭、移除 E2B 后端、默认模型列表变化 | preset 注释与工具面期望按 0.1.7 实况核对；无功能依赖 | 票据 06/07 |
| 插件安装/启动版本兼容性检查 | 自研插件包与 bundle 无兼容性拒绝（gate/real/PTY 全绿） | 票据 07/12 |
| `dsh-hmr` 仍需 `--expose-internals` | 已核实：`~/.dsh/bin/dsh` 与 stable 启动器保持带该标志；wrapper 未改 | 计划 §8.3；票据 04 |
| Remote 双向流/`readBytes`、Windows pwsh 双栈 | out of scope（relay 侧未适配；win32 走 `custom-bash.mjs`，双栈不在本轮） | spec `Out of Scope` |

## 5. 收口验证（命名命令与结果）

以下全部在票据 12 窗口（2026-09-25，部署真实写入之后）零豁免跑出：

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `scripts/regression-gate.sh --tier 0,1,2 --composition real` | **84 passed / 0 failed / 0 skipped**，`exemptions=[]` | `evidence/12-gate-real.json` |
| `scripts/regression-gate.sh --tier 0,1,2 --composition gate` | **80 passed / 0 failed / 0 skipped**，`exemptions=[]` | `evidence/12-gate-all.json` |
| `scripts/tui-pty-smoke.sh --profile tui-dev --probe-tools` | **16/16** | `evidence/12-pty-tui-dev.json` |
| `scripts/tui-pty-smoke.sh --profile tui-team --probe-tools` | **16/16** | `evidence/12-pty-tui-team.json` |
| `node scripts/deploy-preset-carrier-cli.mjs --check` | exit 0，两目标 current | `evidence/12-deploy-check.json` |
| 真实 profile `--dump-config` | tui-dev **112** / tui-team **115**，duplicates 0，stderr 空 | `evidence/12-dump-tui-{dev,team}.yml` |
| `node scripts/agent-preset-bundle-cli.mjs --check` | 10/10 一致 | `evidence/12-bundle-check.txt` |
| `~/.dsh/bin/dsh --version` / 直接 v24 入口 | 均 `0.1.7-rc.1` | `evidence/12-versions.txt` |
| `DSH_CLI=<票据 03 副本> ~/.dsh/bin/dsh --version` | `0.1.5-rc.2`（回滚入口有效） | `evidence/12-versions.txt`、`12-rollback-assets.txt` |
| `grep -rn -- "--allow-stale-deployment" scripts .github package.json` | 仅机制定义与文档说明；调用链已零豁免 | `evidence/12-gate-real.json`、`12-gate-all.json` |

保留的关键断言：`composition.real-render … preset=deployed`（real 闸门验的是部署位那一份）、
`deployment.repo-matches-manifest — 10 files match`、`deployment.repo-vs-deployed — 10 files ok`、
`composition.team-profile — ids=115`、`isolation.real-home-untouched — 签名一致`。
票据 13 窗口复跑静态层：`npx tsc --noEmit` exit 0，`npm test` **205/205**、exit 0
（`2026-09-26`，as-run 日志 `evidence/13-static-layer.txt`）。

## 6. 测量结论

### 6.1 M4 行为基线与 T3

| 检查 | 结论 | 原始数据 |
| --- | --- | --- |
| 新基线（0.1.7-rc.1） | `m4-commandcode-v41-2026-09-25`：N=9、sha `062cd4f7…`、模型 `commandcode/deepseek/deepseek-v4.1-flash`、preset `minimal-plus` | `experiments/m4/results-minimal-plus-next-commandcode-v41-2026-09-25.jsonl`；`evidence/11-*` |
| M4 行为 | 锚定 **9/9**、check3 9/9、check4 9/9、errors 0；advisory：anchorRate 89%、avgTools 28 | `evidence/11-t3-green.json` |
| 真实模型层 `--tier 3` | **18/18 pass / 0 failed / 0 skipped，exit 0**（M4 + 模型选择探针 16/16 + 允许路由 2/2） | `evidence/11-t3-green.json`；归档 `experiments/regression-gate/t3-2026-09-25T14-25-52-003Z/` |
| 旧基线 | 0.1.5-rc.1 时代的 3 条（upgrade-only / deduped / commandcode-v41）保留为历史，文件 sha `ok`；**不做跨宿主对比** | `gates/manifest.json.baselines` |

### 6.2 工具面快照（profile 维度）

唯一数据源 = `gates/expectations.json` 的 `profiles` 段（`basedOn` + 行级 `changes`，每条带理由；
禁止整文件再生成），单测与 08 实测归档逐项对账：

| Profile | 工具面 | 载体 | 备注 |
| --- | --- | --- | --- |
| `minimal-plus` baseline（headless 隔离） | 28（round2） | T2 | 期望基线 |
| `tui-dev`（非 Team） | **35** | PTY | 基线 +7（`list_subagent_models` + endless 6 工具） |
| `headless-team`（进程内对照） | **34** | T2 | 基线 +7 / −`subagent_fork` |
| `tui-team`（Team） | **40** | PTY | `tui-dev` −`subagent_fork` +6 Team 工具 |

## 7. 遗留与未验证项

### 7.1 开环项（有明确下一步）

1. **票据 14 实现已落地，部署位刷新待批准**。三处 `includeSubagents: false`
   （`agent.cordis.yml` 的 tool-bootstrap / phase-swap-bash / instruction-hint 三行）+
   `phase-swap-bash.mjs` 改读配置 + 豁免子代理首步结算前的 `turn/start` 换相守卫；
   契约测试/冒烟/`gate` 组合闸门 **81/0/0**（唯一豁免 = 部署位滞后）。
   仓库产物已重生成、`gates/manifest.json` 已同步；**部署位上的 preset 仍是
   `includeSubagents: true` 形态**（逐文件 3 个 stale：`cordis.patch.yml` /
   `phase-swap-bash.mjs` / `source-manifest.json`）。后续刷新流程：用户批准后
   `node scripts/sync-agent-presets.mjs --profile tui-dev|tui-team --write`，再复跑
   `--composition real` 闸门与 PTY 双形态。**注意**：票据 12 的
   `deploy-preset-carrier-cli.mjs` 是一次性迁移工具（tui-team 已存在即拒绝覆盖），
   不能用于增量刷新——见 `evidence/14-subagent-bootstrap-root-fix.md` §5。
2. **stable 通道迁移未做**：`dsh-runtime/stable` + `tui` 仍为 0.1.5（自包含树）＋旧目录载体
   `~/.dsh/.agent-presets/minimal-plus`；按节奏政策在下一个 stable 窗口单独走一次升级。
3. **会话迁移未全量**：1571 个会话仍为旧格式（resume/写开时惰性迁移）；218 个既存不可读会话
   （72 个 descriptor-v2 + 146 个 v0 结构问题）与 7 个非 canonical 变体文件按「跳过并登记」保留；
   清单在 `evidence/10-result/{10-still-old-format.tsv,10-skip-list.tsv}`。
4. **部署位与仓库的窗口口径**：`--allow-stale-deployment` 已移出调用链；后续任何 preset 真源改动
   （含票 14）都必须重新走部署 + 闸门，不能只改仓库。

### 7.2 未验证清单（计划 §8 余项，不得当作结论）

- **catalog 的 model `description` 是否可写**（计划 §8.7）：决定 `list_subagent_models` 目录文本能否
  自解释，属改善方向而非本轮阻塞。
- **Team 成员上限是否含 Lead**（计划 §8.9）：组合包覆盖值 `maxMembers: 8`，服务默认 16；
  `journal` 按 `state.members.length >= maxMembers` 判定，Lead 是否计入未逐字确认。
- 成员间 `send_message` 的可达边界（计划 §5.4）：policy/初始提示按成员名寻址，但 peer 直发以实跑为准；
  属功能计划第二切片。

### 7.3 已记录、暂不处置

- 旧目录 `~/.dsh/.agent-presets/minimal-plus` 不删（删除需另行批准；它是 stable 0.1.5 通道的载体）。
- relay / worker 代码适配、Windows pwsh 双栈：spec `Out of Scope`，未做。
- 显示层 Team 成员视图 / 任务板 / 使用规范：功能计划第二切片，本仓库尚无 Team 显示层代码。

## 8. 回滚与恢复条件

- **升级回滚**：`DSH_CLI=<票据 03 本地副本>/lib/bin.js ~/.dsh/bin/dsh` 可回到 `0.1.5-rc.2`
  （已实测）；必要时恢复第 1 步冷备。
- **冷备根**（均在保留期，未删除）：`~/.dsh/upgrade-backups/dsh-0.1.7-rc.1-pre-migration-20260925-113044/`
  与 `…-pre-first-start-20260925-170449/`（sessions / attachments / settings / profiles / .agent-presets
  逐文件指纹清单）；**丢失窗口 = 2026-09-25T17:04:49+0800 之后写入**（票据 04/10 口径）。
- **不可逆边界**：会话一旦写开迁移到 V4，旧宿主既读不开也写不开（实测：读报 `not found`、
  写报 `uses log format v4 … reads only v3`）；冷备只覆盖快照之前的历史。
- **保留期**：至少到新宿主稳定走过一次正式版升级（票据 03/04 口径不变）。

## 9. 升级节奏政策（已落地）

政策原文（2026-09-24 Q14 裁决）：**日常宿主跟 `latest` stable；`next`/rc 只在临时前缀做侦察、
不上日常入口；每出现一个新 stable，按第 0 步 C0 模板做一次只读取证，并在固定窗口内完成升级，
避免再次出现"跨过一个整代"的补课。**

落地位置（政策正文以 `README.md` 为准，其余入口只做指针）：

- `README.md`「宿主升级节奏」——面向维护者的政策正文与本次执行指针；
- `docs/deployment.md` §4——发布/部署侧入口，指向政策正文与本文；
- `docs/dsh-v0.1.7-rc.1-upgrade-plan.md` §7 末尾——裁决原文与 C0 取证模板（历史记录，只读引用）。

## 10. 证据索引

### 10.1 按收口项点名的四类证据

| 类别 | 内容 | 位置 |
| --- | --- | --- |
| **新基线** | `m4-commandcode-v41-2026-09-25`（N=9、sha `062cd4f7…`）＋ T3 签收报告 18/18；旧 3 条留史 | `gates/manifest.json.baselines`；`experiments/m4/results-minimal-plus-next-commandcode-v41-2026-09-25.jsonl`；`evidence/11-real-model-baseline-recapture.md`、`11-t3-green.json`；`experiments/regression-gate/t3-2026-09-25T14-25-52-003Z/` |
| **工具面快照** | `profiles` 段（tui-dev 35 / headless-team 34 / tui-team 40）；PTY 与进程内对照原始报告；真实 profile dump | `gates/expectations.json`、`gates/profile-expectations.test.mjs`；`evidence/08-pty-*.json`、`09-pty-*.json`、`09-control-team-overlay.json`；`evidence/12-dump-tui-{dev,team}.yml` |
| **迁移清单** | 盘点（canonical/variants/活写）、读开分类、8 样本写开、跳过（218 不可读 + 7 变体）、仍为旧格式清单、旧宿主降级实测、树 diff | `evidence/10-inventory/*`、`10-classify/*`、`10-samples/*`、`10-result/*`、`10-oldhost/*`、`10-variants/*`；`evidence/10-session-format-migration-execution.md`；计划 §7 第 10 步 |
| **部署校验** | 真实写入计划（pre/post）、零豁免闸门 real/gate、PTY 双形态、`--check`、版本与回滚资产、缺陷复验 | `evidence/12-closeout-verification-and-deployment.md`；`evidence/12-gate-real.json`、`12-gate-all.json`、`12-pty-tui-dev.json`、`12-pty-tui-team.json`、`12-deploy-plan-pre.json`、`12-deploy-plan-post.json`、`12-deploy-check.json`、`12-versions.txt`、`12-rollback-assets.txt`；`evidence/12-dump-tui-{dev,team}.yml` |

### 10.2 按票据索引

| 主题 | 证据 |
| --- | --- |
| 01 闸门拆模块 | `evidence/01-gate-script-module-split.md` |
| 02 前置取证 C0 | `evidence/02-preflight-*`（含结论、签名、CLI/迁移、读写开、目录预设哨兵、包树 diff、附件/storages、零写入核验与三个可复现探针） |
| 03 冷备与还原演练 | `evidence/03-rollback-assets-and-safety-net.md` + `03-cold-backup*.{sh,txt}`、`03-drill-*`、`03-descriptor-v2-*` |
| 04 宿主升级与两 Profile | `evidence/04-host-upgrade-and-working-profiles.md` + `04-version-switch.txt`、`04-host-pin.txt`、`04-dump-{tui-dev,headless}.yml`、`04-stable-*` |
| 05 会话读取异步化 | deferred，无实现证据（C0 ① 签名未变为依据；票面记录） |
| 06 其余兼容面 | `evidence/06-remaining-compat-surfaces.md` + `06-*.txt` / `06-*.mjs` |
| 07 Preset 载体 | `evidence/07-preset-carrier-and-sync-dry-run.md`；产物 `generated/minimal-plus-preset/`（`source-manifest.json` 记真源 sha） |
| 08 Team preset 叠加（B1.5） | `evidence/08-team-preset-overlay.md` + `08-pty-*.json` / `08-control-team-overlay.json` |
| 09 tui-team 与 profile 基线 | `evidence/09-team-profile-and-profile-dimension-baselines.md` + `09-*` |
| 10 会话迁移 | `evidence/10-session-format-migration-execution.md` + `evidence/10-*` 子目录 |
| 11 基线重采 | `evidence/11-real-model-baseline-recapture.md` + `evidence/11-{gate-012,t3-green}.json` |
| 12 收口部署 | `evidence/12-closeout-verification-and-deployment.md` + `evidence/12-*` |
| 13 本文 | 本文；`README.md`、`docs/deployment.md`、计划/spec/票面/`CONTEXT.md` 回填；`evidence/13-static-layer.txt`（静态层 as-run 日志） |
| 14 已实现（未提交） | 票面 14（裁决 `f8a6f72`）；实现证据 `evidence/14-*`（含部署位只读 dry-run 与待批准刷新路径） |
| 计划/spec | `docs/dsh-v0.1.7-rc.1-upgrade-plan.md`（§6 迁移清单、§7 程序、§8 未验证清单）、`docs/dsh-v0.1.7-rc.1-upgrade-spec.md` |
| 闸门报告 | `experiments/regression-gate/`（含 0.1.7 窗口的 `results-2026-09-25*.json`、`t3-2026-09-25T*` 归档） |

## 11. 提交状态

- 票据 01–12 与本轮计划/spec/ADR/preset 对齐改动：已提交到本地 `main`，共 19 个提交领先
  `origin/main`（`86da02f..fdec617`），**未 push**。
- 票据 13（本文 + README/deployment 节奏政策 + 计划/spec/票面/CONTEXT.md 回填 + `evidence/13-static-layer.txt`）：**未提交**，等待用户审阅确认。
- 票据 14（preset 真源三处 `includeSubagents: false` + phase-swap 读配置/换相守卫 + 契约测试/冒烟/闸门/产物 + `evidence/14-*`）：**未提交**；部署位刷新（`sync-agent-presets --profile … --write`）待用户批准后单独提交。
