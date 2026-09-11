# 07 — 假模型行为层其余场景 验证记录

- 执行时间：2026-09-12 00:15–00:30（本地）
- 授权：用户「继续票据 07」；施工图 `docs/regression-test-automation-plan.md` §3.1、§5.4，
  用户决策 D2（手写脚本）、Q13（遏制三规则）、Q24（进程内 driver）、Q25（确定性护栏）。
- 已提交（2026-09-12，未 push）；stable 侧 `presets/minimal-plus/**` 未动；preset 与 `gates/manifest.json`
  未动（`phase-swap-bash.mjs` sha 保持 `c00fe48e…`）；真实 `~/.dsh` 零写入（见 §六）。未跑
  `--tier 2 --composition real`（T2 与 `--composition` 无关，票 06 已验证）。

## 一、改动清单（4 增 3 改，全 dev 侧 / 全在 `gates/stub/**`）

| 文件 | 改动 |
| --- | --- |
| `gates/stub/harness.mjs` | 新增：T2 driver harness——`session/event` 父子会话 feed、建/恢复 agent（per-agent 假模型路由 + preset 挂载）、`followup`/`compact`（`ctx.compaction.compactNow`，即 `/compact` 同一 seam）/`flush`/`dispose`/`childIds`（`subagent/catalog`） |
| `gates/stub/inspect.mjs` | 新增：场景共用的事件读取助手（`request/header` 路由与工具目录、`tool/call` 参数、`tool/result` 错误、路由标签） |
| `gates/stub/run.mjs` | 改：场景契约新增 `invariant` 与可选 `run(harness)`（默认流程不变）；报告新增 `sessions`/`facts`；`STUB_DUMP_EVENTS=1` 改按会话落事件 |
| `gates/stub/scenarios/bash-promotion-visible.mjs` | 新增：promotion 后沙箱可见 + compaction 后回退 persistent（6 断言） |
| `gates/stub/scenarios/v3-resume-route.mjs` | 新增：V3 会话 resume 后首个请求头含 `list_subagent_models`（6 断言） |
| `gates/stub/scenarios/delegation-inherit-route.mjs` | 新增：委派省略路由继承父路由（7 断言） |
| `gates/stub/scenarios/delegation-reject-route.mjs` | 新增：委派集合外路由被拒且不发出请求（6 断言） |
| `gates/stub/stub.patch.yml` | 改：T2 overlay 把宿主 `subagent-model-selection-settings` 覆写为 `enabled: true` + 允许集合 `[stub/stub-model]`（T1 冒烟共用的 `gates/composition/subagent-settings.patch.yml` 保持默认关闭） |

场景发现无需改动：`gates/run.mjs` 的 `runT2` 按目录枚举 `gates/stub/scenarios/*.mjs`（排序），
新增文件自动纳入 `--tier 2`（票 06 收尾注记的预期）。

## 二、场景 → 不变量 → 来源（票面第 5 条）

每个场景文件头部已写明「锁定的不变量 + 来源 + 命令」；失败证据直接引用被违反的不变量
（例如 `bash.compaction-fallback-persistent — request/header seq=31 bash params=command,description,…`）。

| 场景 | 不变量 | 来源 |
| --- | --- | --- |
| `bash-promotion-visible` | A：promotion 后下一次请求暴露沙箱 bash schema（`sandbox_permissions`）；B：`compaction/end` 后下一次请求回到 persistent schema（有 `command`、无 `sandbox_permissions`）；A/B 独立可失败 | `phase-swap-bash.mjs` 头注释与 `compaction/end` 分支；计划 §3.1 场景 2、§5.4；12-2 同源 |
| `v3-resume-route` | 已 promote 的 V3 会话恢复后，恢复路径从 durable `subagent/model-selection-policy` 重建工具面 → 首个 `request/header` 含 `list_subagent_models`，路由仍为 `stub/stub-model` | 计划 §3.1 场景 3、§5.4；票据 11；`dsh-tool-subagent` 的 `selectForSession` |
| `delegation-inherit-route` | 省略 `provider`/`model`/`reasoning_effort` 的 `subagent` 委派，子会话首个 `request/header.config` = 父会话委托请求的 config | 计划 §3.1 场景 5、§5.4；票据 11；`requestedAgentOptions` + `resolveChildAgentOptions` |
| `delegation-reject-route` | 集合外路由在创建子会话前被拒：`tool/result isError` 且任何会话都不发出该路由的 `request/header` | 计划 §3.1 场景 5、§5.4；票据 11；`assertAllowedModelSelection`（先于 start/preflight） |

与施工图命名的两处对齐说明：① 计划 §3.1 的 `delegation-policy` 按票面两条验收拆成
`delegation-inherit-route` 与 `delegation-reject-route` 两个文件（一文件一不变量，失败信息可定位）；
② 计划里 `rewind-fork-persist` 仍按 Q27/Q28 落 T4b，不在本票。

## 三、逐场景结果（绿色，命令可复跑）

| 场景 | 断言 | 关键证据 |
| --- | --- | --- |
| `bash-first-call`（票 06 回归） | 7/7 | 首轮无 `INVALID_ARGS`；promotion 后 `bash params=command,description,timeoutMs,workdir,run_in_background,sandbox_permissions,justification` |
| `bash-promotion-visible` | 6/6 | A：`request/header seq=18` 含 `sandbox_permissions`；B：`compaction/end seq=25` 后 `request/header seq=31 bash params=command`；`compaction calls=1` |
| `v3-resume-route` | 6/6 | `resumed request/header tools=…,list_subagent_models,…`（30 条，bootstrap=2）；`policy events=1 routes=stub/stub-model`；`persisted session format version=3` |
| `delegation-inherit-route` | 7/7 | `parent=stub/stub-model child=stub/stub-model`；`stub call session=<childId> route=stub/stub-model` |
| `delegation-reject-route` | 6/6 | `tool/result isError=true error=Error: child LLM route "stub/stub-model-forbidden" is not allowed for this Session`；`catalog childIds=[]`；`forbidden request/header=[] adapter calls=0` |

四个新场景均满足：零额度、零网络、全程隔离 home；路由由 driver 显式传入（per-agent
`agentOptions` + `installModelSelection`）；每个场景首条断言 `route.first-request` 防误打
真实 provider（Q25）；委派场景经真实 agent loop 落 durable `tool/call`/`tool/result`，
断言只读会话事件（子会话事件经根 ctx `session/event` feed 读取）。

## 四、反向断言抽验（票面第 7 条）

对 `bash-promotion-visible` 抽验「人为破坏 → 该层退出码非零」：把 `phase-swap-bash.mjs`
的 `compaction/end` 注销分支短路（保留 swap、跳过 disposer），diff 归档为
`evidence/07-mutation-skip-compaction-rollback.patch`（8 行）。

| 证据 | 结果 | sha256 |
| --- | --- | --- |
| `evidence/07-bash-promotion-visible-red.json` + `.stdout.txt` | 场景 exit 1：**仅** `bash.compaction-fallback-persistent` 红（`bash params=command,description,…,sandbox_permissions,justification`），**A 断言仍绿**——证明两条断言互相独立 | `eae43c1c…` / `b39a6fb6…` |
| `evidence/07-gate-tier2-mutated.json` | `scripts/regression-gate.sh --tier 2` 层 exit 1；**40 passed / 1 failed / 0 skipped** | `17223837…` |
| `evidence/07-bash-promotion-visible-green.json` + `.stdout.txt` | 恢复后场景 exit 0：6/6；`request/header seq=31 bash params=command` | `975c797b…` / `db770cf9…` |
| `evidence/07-mutation-skip-compaction-rollback.patch` | 抽验用变异 patch；`git apply` 注入、`git apply -R` 恢复，恢复后 `phase-swap-bash.mjs` sha 回到 `c00fe48e…`（= manifest 记录值） | `99bdf747…` |

红/绿两次运行只差这一条断言，说明该场景锁定的就是 compaction 回退本身，而不是碰巧通过；
同时验证「A 绿 B 红」分支（swap 从未发生 → A 红 B 绿）由 A/B 断言互不依赖保证。

## 五、闸门接入与验收

| 命令 | 结果 |
| --- | --- |
| `scripts/regression-gate.sh --tier 2` | exit 0；PRE 3 + T2 **38** = **41 passed / 0 failed / 0 skipped**；报告 `evidence/07-gate-tier2-green.json`（sha256 `606b5af8…`） |
| `scripts/regression-gate.sh --tier 0,1,2` | exit 0；**58 passed / 0 failed / 0 skipped**（T0 3 / T1 14 / T2 38），**0 豁免**；`deployment.repo-vs-deployed — 8 files ok`；`isolation.real-home-untouched — signature identical before/after`；报告 `evidence/07-gate-tiers-012.json`（sha256 `5c7bd390…`） |
| `npx tsc --noEmit` / `npm test` | 0 错 / **133/133** |

T2 场景清单（闸门报告 `stub.scenarios`）：`bash-first-call` 7/7、`bash-promotion-visible` 6/6、
`delegation-inherit-route` 7/7、`delegation-reject-route` 6/6、`v3-resume-route` 6/6；另有
`stub.overlay-only` 遏制扫描 1 条与每场景 `process-exit` 5 条。

## 六、环境注记与开环项

- **compaction 收缩判据（场景构造，非产品行为）**：宿主 `compactNow` 要求 framed summary
  小于被 shadow 的范围（`dsh-compaction-basic/lib/index.js:572`）。`bash-promotion-visible`
  的首条用户消息因此带一段长相位说明，把首轮节点做大，确定性满足该判据；不影响任何相位断言。
- **PTY 限制（环境，非机制）**：本机会话沙箱仍禁 `posix_openpt`，persistent bash 执行层以
  `posix_openpt failed: Operation not permitted` 收尾；本票断言不依赖其执行成功（同票 06 口径）。
- **未覆盖项**：`--tier 2 --composition real` 未重跑（T2 与 `--composition` 无关，票 06 已验证）；
  委派策略的真实模型路径仍由票据 12/13 的 T3 探测面覆盖。
