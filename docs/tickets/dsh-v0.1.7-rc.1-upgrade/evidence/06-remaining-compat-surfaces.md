# 票据 06 证据 — 其余兼容面迁移

> 执行：2026-09-25（本地 +0800）；宿主 `0.1.7-rc.1`（tui-dev/headless 已到位，票据 04）。
> 本票改动**未提交**；部署位本票未动（计划 §7 第 11 步收口后统一部署）。
> 口径：闸门 T0/T1 在隔离临时 home 上跑；真实模型调用只在临时 home（settings/凭据只读复制、退出即删），真实 `~/.dsh` 未被本票命令写入。

## 1. 结论对照（票面 What to build 逐项）

| # | 兼容面 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | Node PTC 包名与工作流执行器服务名 | **修好并验过**：宿主 0.1.7 的 `ptc-runtime` / `workflow-ptc` 行在隔离组合里正常激活；仓库源码无旧包名/旧服务名引用（`workflowEngine` 仍是 0.1.7 服务名，`isolate` 行无需改） | `06-ptc-activation.txt`（ptcRuntime/workflowEngine 均 true；resolution 486 项）、`06-gate-t0-t1.txt` 的 `composition.loader-id-unique`（99 ids / duplicates=0） |
| 2 | 工具结果 token 预算改名后的通知渲染 | **修好并验过**：0.1.7 通知拼写未变；`maxInlineTokens` 生效后 20k 字符结果被收敛为 238 字符含定位符通知，TUI 渲染成 `⤓ full result <locator>` 徽标 | `06-spill-render.txt`、`06-adapter-and-spill-config-audit.txt`、`lib/spill-notice.test.ts` 两条单测 |
| 3 | 启动等待（`agent/created`）语义 | **核对完成，无需改码**：`agents.create()` 在启动发布（异步串行 `agent/created`）完成后 resolve，不发起模型请求；无输入时 `whenIdle()` 立即返回；setup 失败让 create reject（屏幕接管前诊断路径，TUI `run()` catch → stderr + `appExit(1)`） | `06-startup-wait.txt`、`lib/index.ts:1056-1067`（create → whenIdle → TuiApp）、`apply()` 的 catch |
| 4 | 自研插件启停对称性（含 bash 换用按 agent 影子） | **修好并验过**：`skill-search` / `custom-bash` / `phase-swap-bash` 的注册都随插件 fiber 注销（0.1.7 `tools.register()` 的 disposer 挂 ToolRuntime root ctx，不随插件释放）；phase-swap 的 per-agent shadow 卸载后无残留；0.1.7 上插件被要求 `ctx.inject(["jobs"])` 捕获沙箱定义 | `plugin-lifecycle.test.mjs` 4/4、`phase-swap-bash.test.mjs` 15/15、`06-t0-tests.txt` |
| 5 | 模型适配器配置（去 `protocol` / 旧根地址）+ 真实一次工具调用 | **验过**：settings/profile 无 `protocol`、无 `api.deepseek.com` 覆盖（`llm-deepseek: {}` 为空段）；真实路由一次工具调用 `tool_call → tool_result(completed) → final` | `06-adapter-and-spill-config-audit.txt`、`06-real-model-tool-call.txt` |
| 6 | 闸门源码 0.1.7 适配（04 移交） | **修好**：`healProfilesModuleFallback`（0.1.7 已移除）改走 `createRuntimeResolution` + `PluginPackages`；host-pin 的 farm 投影断言改为 runtime resolution 断言（目录身份 + hermetic temp home）；T0（tsc + npm test）全绿 | `06-gate-t0-t1.txt`、`06-stub-t2-resolution.txt` |

## 2. 闸门现状（`scripts/regression-gate.sh --tier 0,1 --skip-deployment-check`）

- **T0 3/3 全绿**：`tsc --noEmit` exit 0；`npm test` 163/163；测试文件清单一致。
- **T1 17 过 / 3 红**，三条红全部指向**票据 07（Preset 载体迁移）未落地**这一处方：
  - `smoke.anchored-first-turn` / `smoke.promoted-catalog`：隔离 home 里没有 agent-presets 服务（0.1.7 移除 `@deepseek-ai/dsh-agent-presets`，新载体是 `@deepseek-ai/dsh-agent-preset` 行），smoke-boot 的旧插入行 import 失败 → `smoke: missing agents/agentPresets/agentDefaultModel services`。
  - `degrade.fail-open`：同一原因（degrade-smoke 复用 smoke-boot）。
  - 其余 T1 全绿：`composition.dump-config`（exit 0, entries=99）、`composition.loader-id-unique`（duplicates=0）、`composition.no-stub`、`seeded-preview.probe`（10/10）、`deployment.repo-matches-manifest`（8 文件）、`host.pin`（resolution=0.1.7-rc.1）、`session.format-version`（4）、隔离/副本 sha/无同步动作。
- **T2（假模型行为层）**：启动链已适配 0.1.7（`gates/stub/run.mjs` 的 runtime resolution），隔离 home 里只剩旧 `gate-stub-agent-presets` 一行 import 失败 → `missing agents/agentPresets services`（`06-stub-t2-resolution.txt`）。**T2 全部场景待 07 落地后才能跑绿**。
- `deployment.repo-vs-deployed` 在过渡窗口内按 `--skip-deployment-check` 豁免：4 个改动文件 stale + 本票新增的 `plugin-teardown.mjs` absent（部署位未写入）；`deployment.repo-matches-manifest` 不可豁免且 9 文件全绿。收口票 12 部署后消除。
- **结论**：本票能做的兼容面已闭环；「闸门复绿」的最后 3 条 T1 断言与整个 T2 层属于票据 07 的载体前置，票面记「部分」而不是谎报全绿。

## 3. 逐面明细

### 3.1 Node PTC 包名与服务名

- 0.1.7 组合里行名已是 `ptc-runtime`（`@deepseek-ai/dsh-ptc-runtime-node`）与 `workflow-ptc`（`@deepseek-ai/dsh-workflow-ptc`）；服务名仍为 `ptcRuntime` / `workflowEngine`（`dsh-tool-workflow` 仍 inject `workflowEngine`），因此 `presets/minimal-plus/agent.cordis.yml` 的 `delegation.isolate.workflowEngine` **不需要改名**。
- 仓库源码无 `workflow-worker-thread` / `dsh-workflow-worker-thread` 引用（票据 09 去重后已删）；`experiments/m4/m4.patch.yml` 不含 PTC/workflow 包名。
- 真正的 0.1.7 断点是隔离组合不再有 `profiles/node_modules` farm，且 gate 静态导入已移除的 `healProfilesModuleFallback` —— 已在 `gates/t1/composition.mjs`、`gates/stub/run.mjs`、`presets/minimal-plus/smoke-boot.mjs` 改为 `createRuntimeResolution()` + `PluginPackages`（与 CLI 同构）。修后隔离 smoke 的「6 entries did not activate」告警消失，只余 07 的旧 agent-presets 行。

### 3.2 工具结果 token 预算与渲染

- 0.1.7 `spill-policy` 配置键为 `maxInlineTokens`（base dump 12500），本仓库与 profile 均不覆盖该键；`formatSpillNotice()` 的通知拼写 `' Full formatted result stored at: '` 与 0.1.5 相同，仅预算单位从 bytes 变 tokens（通知内仍报 bytes 省略量）。
- `lib/app.ts` 把 `ToolRow.styleSpillNotices` 提取为导出的纯函数 `styleSpillNotices(text, palette)`（行为不变），便于用宿主真拼写做契约测试。
- 冒烟（`06-spill-render-probe.mjs`）：真实 headless 组合 + `maxInlineTokens: 64`，经 `tools/post-execute` waterfall 让 20000 字符结果走真实 spill → model-facing 238 字符含通知；`styleSpillNotices()` 输出徽标、prose 原句消失。
- 附注：0.1.7 的 spill 只作用于「content 决策」的工具结果（`decision.value` 存在的结构化工具结果跳过，`read` 显式排除）；这不影响 TUI 渲染契约，本票按通知拼写与渲染断言。

### 3.3 启动等待与失败诊断

- `lib/index.ts:1056`：`await services.agents.create(...)` → `await agent.whenIdle()` → 之后才 `new TuiApp`。0.1.7 的 `create()` 内部 `initializeAgent(prepared, publish("startup"))`，即在异步串行的 `agent/created` 发布完成后才 resolve；无输入时 `whenIdle()` 立即完成（探针 5ms / 0ms）。
- 启动失败：`run()` 的 rejection 由 `apply()` 捕获 → `dsh-tui: <message>` 写 stderr + `ctx.appExit(1)`，发生在屏幕接管之前。探针验证 setup 抛错时 `create()` 立即 reject（消息原样透出）。
- 路由不存在不在 create 时校验（首个请求才失败），与 0.1.5 行为一致；TUI 在用户首条消息后才可能遇到，不属启动失败面。

### 3.4 自研插件启停对称

- 0.1.7 `ToolRuntime.register()` 用**服务实例自己的 root ctx** 挂注销句柄：`skill-search` / `custom-bash` 原先忽略返回值 → 运行时卸载会残留工具；`phase-swap-bash` 的 per-agent shadow 原先只有 compaction 注销 → 卸载会残留沙箱 bash。三处都补了 `ctx.effect` 清理。
- `phase-swap-bash` 另修 0.1.7 行为差：`dsh-tool-bash.apply()` 改为 `ctx.inject(["jobs"], cb)` 注册完整（带 `run_in_background` schema）定义，spy ctx 必须同步模拟该注入并暴露真实 `jobs`，否则换相后 schema 缺 `run_in_background`（10 条旧测试全红到 15/15）。
- `test-helpers.mjs` 同步 0.1.7 的 shell 面（`execute()` → `ShellProcess.result()`）并提供 jobs 注册表存根（两个工作 profile 都挂 `dsh-jobs-local` + `tool-jobs`）。
- `plugin-lifecycle.test.mjs` 对五个自研插件各挂载/卸载一次：无残留注册、无影子泄漏。

### 3.5 模型适配器配置与真实调用

- `~/.dsh/settings.yaml` 的 `llm-deepseek: {}`（空段，无 `protocol`/根地址覆盖）；各 profile patch 无 `protocol`（唯一命中是注释里的 `@modelcontextprotocol/...` 包名，假阳性）、无 `api.deepseek.com`。
- 真实调用（`06-real-model-tool-call.sh`，隔离 home）：默认真实路由下一轮 bash 工具调用完成，事件流 `tool_call → tool_result(status=completed) → final`，exit 0。
- 说明：升级计划该 P0 行针对官方 DeepSeek 适配器；本部署实际路由是 `llm-pi-ai`（`agent-default-model: commandcode/deepseek/deepseek-v4.1-flash`），官方适配器段为空即无旧字段可删。真实模型基线重采归票据 11。

### 3.6 seeded 预览探针的宿主代际差（T1 复绿的额外一处）

- 0.1.5 上 `sessionQuery.readSession(seeded)` 会抛（TUI 预览因此返回 null，`readPreviewLog` 是修复路径）；0.1.7 起可成功且与 `listEvents` 全量 seq 对齐。
- 探针原红线 `red-readSession-rejects-seeded` 把上一代宿主细节写成永久断言，在 0.1.7 上恒红。按目标宿主改为单一断言 `seeded-readSession-aligned`：`readSession(seeded)` 必须成功且事件数/seq 与 `listEvents` 完全一致（旧行为只留历史注释，不写跨宿主双分支）。预览仍优先走 `readPreviewLog`，闸门的 id 白名单同步更新（`gates/t1/preset.mjs`）。

## 4. 残留与归属

| 项 | 归属 |
| --- | --- |
| T1 的 `smoke.*` / `degrade.fail-open` 与 T2 全层：旧 `@deepseek-ai/dsh-agent-presets` 行 → 0.1.7 `dsh-agent-preset` 载体 | **票据 07**（本票已把 boot/runtime resolution 前置修好，07 落地后应直接复绿） |
| 部署位滞后（4 stale + 1 absent 新文件） | 票据 12（收口统一部署；过渡窗口用 `--skip-deployment-check`） |
| 真实模型 T3 基线重采 | 票据 11 |
| tui-dev 真实模块级 boot（缺 `agent-presets` 载体行） | 票据 07 |
| 子代理锚定 `includeSubagents`（票面 What to build 未列的 preset 语义） | 票据 14（本票未动） |

## 5. 本票改动文件

- `lib/index.ts`：0.1.7 `createUserMessage.content` 只读化后的 ContentBlock 拼装（T0 tsc 红项）。
- `lib/app.ts` / 新增 `lib/spill-notice.test.ts`：`styleSpillNotices` 导出 + 0.1.7 通知拼写单测。
- `presets/minimal-plus/{phase-swap-bash,skill-search,custom-bash}.mjs`：0.1.7 捕获/卸载对称修复。
- `presets/minimal-plus/test-helpers.mjs`、新增 `plugin-lifecycle.test.mjs` 与 `plugin-teardown.mjs`（三插件共用注销纪律）、`package.json`（测试清单）。
- `presets/minimal-plus/smoke-boot.mjs`：0.1.7 runtime resolution。
- `gates/{host-pin,run}.mjs`、`gates/t1/{composition,preset,run}.mjs`、`gates/stub/run.mjs`：0.1.7 闸门适配。
- `gates/manifest.json`：改动过的 preset 源文件 sha 同步。
- `experiments/session-preview-seeded/probe.mjs`：seeded readSession 一致性断言。
- 本目录 06-* 证据文件。

## 6. 复现命令

```bash
npm test                                  # 163/163（含 plugin-lifecycle / spill 单测）
npx tsc --noEmit                          # exit 0
node docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/06-ptc-activation-probe.mjs
node docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/06-startup-wait-probe.mjs
node docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/06-spill-render-probe.mjs
bash docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/06-real-model-tool-call.sh
bash scripts/regression-gate.sh --tier 0,1 --skip-deployment-check
```

## 7. 07 落地后复跑（2026-09-25，票 06 收口）

**背景**：本票唯一未闭环项「闸门复绿」压在票 07 的 preset 载体上（0.1.7 移除
`@deepseek-ai/dsh-agent-presets`，隔离 home 缺 agent-presets 服务）。07 提交 `f75a7ad`
后，在同一提交的工作树上复跑：

```bash
scripts/regression-gate.sh --tier 0,1,2 --composition gate --skip-deployment-check
# → [T0] tsc 0 + npm test 178/178；[T1] 18/18；[T2] 51/51；summary 69 passed / 0 failed
# 报告 experiments/regression-gate/results-2026-09-25.json

scripts/regression-gate.sh --tier 1 --composition real --skip-deployment-check \
  --json experiments/regression-gate/results-2026-09-25-real.json
# → [T1] 20/20（真实 tui-dev 渲染副本组合 112 条；源 profile 只读；真实 home 零写入）
```

**原红项逐条对账**

| 原红项 | 复跑结果 |
| --- | --- |
| `smoke.anchored-first-turn` | PASS（R1 `[bash, str_replace_editor]`） |
| `smoke.promoted-catalog` | PASS（28 工具，R2 沙箱 bash + 自研技能行） |
| `degrade.fail-open` | PASS（R1 全量 28 工具 + fail-open warn） |
| T2 全层（6 场景） | 51/51 PASS |
| `deployment.repo-vs-deployed` | 仍按窗口豁免 `--skip-deployment-check`（部署位为 0.1.5 目录形态，票 12 消除）；`deployment.repo-matches-manifest` 9 文件全绿未漂移 |

**复跑带出的 0.1.7 门禁口径修正**（不属本票六项功能面，随 07 提交，行级理由见
`07-preset-carrier-and-sync-dry-run.md` §5）：`ralph` 在 0.1.7 base 默认 disabled（期望面行级
移除）；T2 场景 tool/result 读取改 V4 first-class message（`data.message.toolCallId`/`isError`）；
`v3-resume-route` 格式前置断言改当前格式 4（0.1.7 新会话直接落 v4，v3 迁移执行归票 10）。

**结论**：本票六项兼容面 + 闸门复绿全部闭环，Status 改 `done`。部署位写入与零豁免复跑归票 12。

