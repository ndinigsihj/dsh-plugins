# 06 — 假模型行为层骨架 + 首条回归红绿（12-2）验证记录

- 执行时间：2026-09-11 23:15–23:45（本地）
- 授权：用户「继续票据 06」+ 裁定 A「本票一并修复 finding 12-2（方向 A）」；施工图
  `docs/regression-test-automation-plan.md` §3.1、§5.4、§7（P2 行）+ 决策 Q13/Q24/Q25/Q26。
- 未 commit、未 push；stable 侧 `presets/minimal-plus/**` 按 D3 未动；真实 `~/.dsh` 零写入
  （T2 全程隔离 home，报告见 §五）。

## 一、改动清单（4 增 6 改，全 dev 侧）

| 文件 | 改动 |
| --- | --- |
| `gates/stub/adapter.mjs` | 新增 88 行：`LlmAdapter` 子类（只实现 `stream()`）+ `stubState` + `textTurn`/`toolCallTurn` 分块构造；`apply()` 注册 provider `stub` |
| `gates/stub/stub.patch.yml` | 新增 41 行：overlay（headless-runner/startup 关闭、base tool-bash 关闭、`session-title-llm` 关闭、会话根 `STUB_SESSION_ROOT`、insert agent-presets + `./adapter.mjs`） |
| `gates/stub/run.mjs` | 新增 283 行：进程内 driver（loadProfile+boot+agents.create+followup+whenIdle → 只读会话事件断言），产出场景报告 JSON |
| `gates/stub/scenarios/bash-first-call.mjs` | 新增 167 行：首条场景（12-2），7 条断言 |
| `gates/run.mjs` | +T2 分层：`runT2()` 逐场景跑 runner 并聚合断言；`stub.overlay-only` 遏制扫描；删除「T2 尚未落地」的 skip 桩 |
| `presets/minimal-plus-next/phase-swap-bash.mjs` | **12-2 修复（方向 A）**：swap 延后到触发 promotion 的调用结算（`tool/result`）之后 |
| `presets/minimal-plus-next/phase-swap-bash.test.mjs` | 同步语义：新增「tool/call 不 swap、tool/result 才 swap」「冷启动首个事件是 tool/call 同样延后」；12/12 绿 |
| `presets/minimal-plus-next/test-helpers.mjs` | 新增 `fireToolResult()`（结算事件驱动） |
| `presets/minimal-plus-next/smoke-driver.mjs` | 冒烟补 `tool/result` 结算事件 + ROUND1.5 断言（未结算不得 swap） |
| `gates/manifest.json` | `phase-swap-bash.mjs` sha 更新为 `c00fe48e…`（仓库侧清单一致性） |

## 二、T2 机制（票面 1、2、3、4、7 条）

- **进程内 driver**：`gates/stub/run.mjs` 用 `loadProfile("dsh","headless")` + `boot(...)` 载入
  bundle 层与 overlay，`agents.create({agentOptions:{provider:"stub",model:"stub-model"}, setup:
  installModelSelection + agentPresets.mount("minimal-plus-next")})`，发一条用户消息后 `whenIdle()`；
  断言只读 `agent.session.snapshotEvents()`，零额度、无网络。
- **脚本化回放**：场景以「轮次 → 分块序列」表达（工具参数为原始 JSON 字符串）；适配器按
  block-start/delta/block-end → usage → finish 的生产收尾形状回放；辅助调用（`purpose` 非空）
  不消耗轮次并会被场景判红。
- **路由显式传入**：per-agent `agentOptions` + `installModelSelection`，不依赖组合行默认值。
- **确定性护栏**：overlay 关闭 `session-title-llm`；首条断言 `route.first-request` 要求首个
  `request/header.config == {provider:"stub", model:"stub-model"}`（实测通过）；`stub.no-aux-calls`
  断言 3/3 会话轮次且 0 条辅助调用。
- **遏制（Q13）**：`gates/stub/**` 之外零引用——T1 的 `composition.no-stub` 扫描组合导出；
  T2 的 `stub.overlay-only` 另扫 `gates/composition/**`、`presets/minimal-plus{,-next}/**` 配置面、
  临时 home profile 与部署位副本的 provider/id/模块路径/模型名四种形态，实测 0 命中。

## 三、12-2 红绿举证（票面 5、6 条；Q26）

命令（同时写在场景脚本头注释）：

```bash
# 绿
node gates/stub/run.mjs --scenario bash-first-call \
  --json experiments/regression-gate/evidence/12-2-green.json
# 临时回退修复（同一份 diff 反向应用）
git diff -- presets/minimal-plus-next/phase-swap-bash.mjs \
  > experiments/regression-gate/evidence/12-2-fix.patch
git apply -R experiments/regression-gate/evidence/12-2-fix.patch
node gates/stub/run.mjs --scenario bash-first-call \
  --json experiments/regression-gate/evidence/12-2-red.json
git apply experiments/regression-gate/evidence/12-2-fix.patch   # 恢复
```

| 证据 | 结果 | sha256 |
| --- | --- | --- |
| `evidence/12-2-red.json` + `12-2-red.stdout.txt` | exit 1：7 条断言中**仅** `bash.first-call-not-rejected` 红——`ToolArgsError/INVALID_ARGS content=Error: invalid arguments: missing required property "description"` | `5e8ae9b2…` |
| `evidence/12-2-green.json` + `12-2-green.stdout.txt` | exit 0：7/7 通过；promotion 后 `request/header` 的 bash 参数含 `sandbox_permissions`，二轮带 `description` 的调用被接受 | `018dbd75…` |
| `evidence/12-2-fix.patch` | 修复 diff（31 行）；红跑前反向应用、绿跑前正向恢复，恢复后文件 sha 回到 `c00fe48e…`（= manifest 记录值） | `171328b4…` |

红/绿只差这一条断言，说明场景锁定的就是该回归本身，而不是碰巧通过。

## 四、12-2 修复说明（方向 A）

`phase-swap-bash.mjs` 的 swap 触发点从「任意事件（含触发 promotion 的 `tool/call`）」改为
「promotion 成立且事件不是 `tool/call`」：

- `dsh-agent-loop` 是「先 `appendToolCall` 再 `tools.prepare/dispatch`」（`dsh-agent-loop/lib/index.js:586-588`），
  dispatch 用 live registry 解析工具定义；在 `tool/call` 落盘瞬间换 schema，会让同一 step 已按
  persistent schema 产出的参数被沙箱 schema 拒。
- 延后后：promotion 状态不变，首轮调用按 persistent schema 校验/执行；`tool/result`（或任何
  非 `tool/call` 事件）触发 swap，下一次请求起沙箱 schema 生效。
- 冷启动/resume 不受影响：`promotion.status()` 仍冷扫描日志，首个非 `tool/call` 事件立即 swap
  （单测 `冷启动恢复` 仍绿）；若 resume 后首个事件恰是 `tool/call`，同样延后到结算
  （单测新增该用例）。

单测/冒烟同步：`phase-swap-bash.test.mjs` 12/12、`smoke-driver.mjs` 的 R1 锚定/R2 沙箱目录/二轮注入
全绿（T1 `smoke.anchored-first-turn`、`smoke.promoted-catalog`、`degrade.fail-open`）。

## 五、闸门接入与验收（票面 8、9 条）

| 命令 | 结果 |
| --- | --- |
| `scripts/regression-gate.sh --tier 2` | exit 0；PRE + T2 共 **12 passed / 0 failed**（含 `stub.bash-first-call.*` 9 条） |
| `scripts/regression-gate.sh --tier 0,1,2 --allow-stale-deployment`（同步部署位前） | exit 0；**29 passed / 0 failed / 0 skipped**，1 条豁免：`deployment-sha: stale (phase-swap-bash.mjs)`；报告 `evidence/12-2-gate-tiers-012.json`（可作为「豁免必须记账」的正样本） |
| `scripts/sync-agent-presets.sh minimal-plus-next`（用户批准） | 部署位 8/8 与仓库 sha 一致（`phase-swap-bash.mjs`: `084316a3…` → `c00fe48e…`） |
| `scripts/regression-gate.sh --tier 0,1,2`（同步后，**无任何豁免**） | exit 0；**29 passed / 0 failed / 0 skipped**，`deployment.repo-vs-deployed — 8 files ok`；报告归档 `evidence/06-gate-tiers-012-no-exemption.json` |
| `scripts/regression-gate.sh --tier 2 --composition real` | exit 0；**13 passed / 0 failed**（T2 与 `--composition` 无关，release 路径不会再被 T2 卡住） |
| `npx tsc --noEmit` / `npm test` | 0 错 / **133/133** |
| `isolation.real-home-untouched` | 严格区签名前后一致；T2 会话落临时 home（`stub-sessions/`） |

豁免说明：本票改了 preset，按 D6 闸门**不自动同步**部署位，故 `仓库↔部署位 sha` 为 stale，
需显式 `scripts/sync-agent-presets.sh` 后免豁免跑；`仓库↔清单` 已随本次 manifest sha 更新一致。

## 六、环境注记与开环项

- **PTY 限制（环境，非机制）**：本机会话沙箱禁 `posix_openpt`，persistent bash（PTY seam）首次执行
  会以 `posix_openpt failed: Operation not permitted` 收尾。因此 12-2 断言的判据取
  **无 `ToolArgsError/INVALID_ARGS`**（无 tool/result 也算拒）；在不禁 PTY 的终端/CI 上，同一断言
  自然退化为 `tool/result.isError === false`。sandbox bash 走 `ctx.shell`（非 PTY），故二轮调用
  可在本机真实执行成功（`pwd` → cwd）。
- **部署位同步**：2026-09-12 经用户批准已执行 `scripts/sync-agent-presets.sh minimal-plus-next`，
  8/8 一致（sha 记录见 §五）；同步写真实用户目录，属显式动作，闸门自身仍不含同步调用。
- **下一票**：票据 07（其余场景：promotion 可见性/compaction 回退、V3 resume 路由、委派策略）
  可直接在 `gates/stub/scenarios/` 增量添加，runner 与 T2 分层会自动纳入。
