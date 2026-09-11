# 票据 12 证据 — 允许路由真实验证（含 2026-09-11 复测）

日期：2026-09-11 00:04–00:05 CST（2026-09-10T16:04:46Z → 16:05:36Z）
执行：ask-matt-flow Stage 5 Implement，票据 12（本窗口）
环境：Node v22.22.1；全局宿主 `@deepseek-ai/dsh@0.1.5-rc.1`；preset = 部署位 `minimal-plus-next`（`includeUserRoot`）；探针进程 = `headless` profile + overlay
口径依据：票据 12 文件 + spec「子代理模型选择」节 + 票据 11 §6（promotion 后 30 工具形状）+ 票据 11 §7 转交（4 条路由中仅 1 条有工具调用实测）
机器可核对数据：`evidence/12-route-probe.json`（首测 3/4，sha256 `183bd485…`）；`evidence/12-route-probe-retest-2026-09-11.json`（复测 4/4，sha256 `ecf23663…`）
状态：用户 2026-09-10 晚（本地）裁定保留 commandcode 基线、待额度重置后复测；2026-09-11 14:21（06:21:41Z → 06:22:12Z）复测 **4/4 通过**，commandcode 补上真实工具调用实证，开环项关闭；部署基线与 settings 未改、未 commit

## 0. 验收清单对照

| 票据 12 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 对允许集合中的每条路由执行一次真实工具调用探测 | 完成（4/4 探测；3 条通过，1 条因外部额度未能进入模型请求） | §3 |
| 每条路由的结果逐条记录 | 完成 | §3 表 + `12-route-probe.json`（每轮 childId/header/工具调用/结果/耗时） |
| 未通过的路由已从允许集合移除 | 复测后 4/4 通过，无需移除；首测配额期保留 commandcode 的用户裁定见 §4/§6 | §3.1；基线 sha 未变（§1） |
| 移除后集合仍满足日常使用需要 | 集合未变（4 条）；复测后 4 条全部有真实工具调用实证 | §3.1 |
| 探测方法与结论记录在案，便于下次扩缩集合时复用 | 完成 | §2（运行方式）、§4（额度类≠能力失败判据）、§6（复测程序与裁剪步骤） |

## 1. 改动清单（仓库）

| 文件 | 改动 | sha256 |
| --- | --- | --- |
| `experiments/subagent-model-selection/route-probe.mjs` | 新增：逐条路由真实 bash 工具调用探针（从设置服务读允许集合） | `91559029…` |
| `experiments/subagent-model-selection/route-probe.patch.yml` | 新增：headless overlay（enabled=true + 当前 4 路由；settings/会话指向 /tmp） | `9df8e456…` |
| `experiments/subagent-model-selection/run-route-probe.sh` | 新增：临时设置副本 + 跑探针 | `4948cceb…` |
| `docs/tickets/dsh-v0.1.5-rc.1-upgrade/evidence/12-route-probe.json` | 探针原始报告（第二轮机读数据） | `183bd485…` |

未改：`~/.dsh/profiles/tui-dev/cordis.patch.yml`（sha `d6b283d6…`，与票据 11 相同）、`~/.dsh/profiles/headless/cordis.patch.yml`（sha `338f36cd…`，相同）、`~/.dsh/settings.yaml`（sha `84299548…`，相同）、preset/生产插件、`lib/`、`plugins/`、测量脚本；stable 侧未触碰；未 commit。

## 2. 探测方法（可复用）

运行：`experiments/subagent-model-selection/run-route-probe.sh`
（把真实 `settings.yaml` 复制到 `/tmp/dsh-ticket12/settings.yaml` 后跑
`dsh --profile headless --patch experiments/subagent-model-selection/route-probe.patch.yml`）

- **集合来源**：探针不硬编码路由，直接读宿主设置服务 `subagentSettings.current()`；overlay 的
  `subagent-model-selection-settings` 行即部署基线当前值（探测时 = tui-dev 的 4 条）。
- **隔离**：设置文档与会话写 `/tmp/dsh-ticket12`（settings 副本 sha `84299548…`），不写
  `~/.dsh/settings.yaml` 与 `~/.dsh/sessions`；`agent-presets` 走部署位副本（tui-dev 的实际加载源）。
- **父会话**：`opencode-go/deepseek-v4-flash`（票据 07/08/10 M4 同源）；先由真实模型发一次
  bash 调用完成 promotion，实测 30 工具（含 `list_subagent_models`），与票据 11 §6 记录一致。
- **逐条探测**：对每条路由做一次前台委派 `subagent{provider, model, run_in_background:false}`，
  子会话提示要求真实调用 bash 执行 `echo ticket12-<route-slug>`（command + description）；
  断言链 = 子会话 header 路由等于指定路由 → 存在 bash `tool/call` → 对应 `tool/result`
  非错误且文本含 marker。首轮未发工具调用时以更严格提示重试一次（最多 2 轮，逐轮记录）。
- **退出码**：全部路由通过 0，任一失败 1；报告写 `$PROBE_OUT`（默认 `/tmp/dsh-ticket12/route-probe.json`）。
- **扩缩集合**：同步改部署基线与 `route-probe.patch.yml` 后原样重跑即可；探针会探测新集合全部路由。
- 本票共跑两轮（首轮 2026-09-10T15:58Z 用不含 description 的提示，结论同为 3/4；canonical
  报告取第二轮 16:04Z，子会话提示已含 description）。

## 3. 首测结果（2026-09-10T16:04:46Z → 16:05:36Z）

| 路由 | 结论 | header 实到路由 | 真实工具调用 | 耗时 |
| --- | --- | --- | --- | --- |
| `opencode-go/deepseek-v4-flash` | 通过 | 同路由（effort max） | `bash{command,description}` → 成功回显 marker | 9.5s |
| `opencode-go/deepseek-flash` | 通过 | 同路由（effort max） | 同上，单次成功 | 5.6s |
| `deepseek-official/deepseek-v4-flash` | 通过 | 同路由（effort high） | 首次缺 `description` 被参数校验拒，自纠后成功回显 marker | 3.8s |
| `commandcode/deepseek/deepseek-v4-flash` | **未通过**（外部额度） | 同路由（effort max） | 无 — 6 次模型请求全部失败，未发工具调用 | 22.7s |

逐条 childId 与原始事件字段见 `12-route-probe.json`。`commandcode` 子会话 `0200f301…` 的
`turn/end` 终态为 `TRANSPORT: Connection error.`；其 `assistant/attempt` 与 `llm/retry` 事件
显示前 5 次均为 `RATE_LIMIT`（429 weekly limit），第 6 次才退化为传输错误。

### 3.1 复测结果（canonical 更新：2026-09-11T06:21:41Z → 06:22:12Z，4/4）

| 路由 | 结论 | 首次尝试 | header 实到路由 | 真实工具调用 | 耗时 |
| --- | --- | --- | --- | --- | --- |
| `opencode-go/deepseek-v4-flash` | 通过 | 1 次成功 | 同路由（effort max） | `bash` → marker 回显 | 4.2s |
| `commandcode/deepseek/deepseek-v4-flash` | **通过** | 1 次成功 | 同路由（effort max） | `bash` → marker 回显 | 6.6s |
| `deepseek-official/deepseek-v4-flash` | 通过 | 1 次成功 | 同路由（effort high） | `bash` → marker 回显 | 5.2s |
| `opencode-go/deepseek-flash` | 通过 | 1 次成功 | 同路由（effort max） | `bash` → marker 回显 | 7.9s |

- 报告：`evidence/12-route-probe-retest-2026-09-11.json`（sha256 `ecf23663…`）；逐条 childId 见报告。
- commandcode 子会话 `a8a9b48a-0702-4fa2-b1f8-8bcedc02662b`：`turn/end` 无错误，
  `bash{command,description}` 成功回显 `ticket12-commandcode-deepseek-deepseek-v4-flash`。
- 部署基线（tui-dev `d6b283d6…`、headless `338f36cd…`）、`settings.yaml`（`84299548…`）、
  preset（`9087bf00…`）与首测时逐字节相同——4/4 判定下按程序不改任何集合。
- 运行前置复核：`~/.dsh/settings.yaml` 无 `subagent-model-selection:` 段（finding 11-3）。

## 4. commandcode 未通过根因：外部额度（非能力缺陷）

- 子会话日志（`/tmp/dsh-ticket12/sessions/…0200f301…`）：路由创建与
  `request/header`（provider/model）均正确；模型请求 6 次全失败，前 5 次为
  `429: {"code":"RATE_LIMITED", "Your limit resets at 2026-09-11T06:21:01.800Z"}`，
  第 6 次 `Connection error.`（TRANSPORT）；`retryPolicy` = normal/5 次。
- 直接 HTTP 复核（同窗口，不经 dsh）：`GET https://api.commandcode.ai/provider/v1/models`
  → 200（key 有效、端点可达）；`POST /chat/completions` → 429 `RATE_LIMITED`，重置时点与
  子会话日志逐字一致。
- 结论：本窗口无法验证该路由的工具调用能力，但现有证据不支持「能力缺陷」；属 finding 05-6
  的额度期延续。判据：额度类失败（`RATE_LIMIT`/429/连接错误）≠ 能力失败；恢复后复测。
- **收口（2026-09-11）**：额度重置后复测，该路由首次尝试即完成 `bash` 工具调用并回显 marker
  （6.6s，§3.1），确认首测未通过属外部额度而非能力缺陷；基线无需裁剪，开环项关闭。

## 5. 运行观察：首轮 anchored bash 的参数校验时序（转 13 / 另立票）

本票两轮运行与父会话 warmup 都复现同一现象，值得记录：

1. promotion 前 `request/header` 的 bash schema 只声明 `command`（persistent bash）；
2. 模型按该 schema 首次调用 `bash{command}` → 结果
   `Error: invalid arguments: missing required property "description"`；
3. promotion 后目录里的 bash 为沙箱 bash，schema 要求 `command` + `description`；
4. 模型补 `description` 重发即成功；随后 30 工具放行。

机制线索：`presets/minimal-plus-next/phase-swap-bash.mjs` 的 `session/event` 监听在 promotion
（由同一条 durable `tool/call` 触发）时把该 agent 作用域的 bash 换成沙箱 bash，因此换用可先于
该次调用执行生效，而模型看到的仍是换用前的 anchored schema。影响：**首次 anchored bash 调用
必然先过一次参数校验失败**，能自纠的模型可恢复（本票 3 条通过路由里 1 条自纠，父 warmup 亦自纠），
不能自纠的模型可能被误判为「不会工具调用」。本票不改代码，建议票据 13 或另立票处置
（方向：anchored 阶段直接暴露沙箱 bash 的 schema，或把 swap 延后到当前调用结算之后）。

## 6. 用户裁定、挂起与复测程序

**复测已执行（2026-09-11 14:21，本地）**：跑同一 `run-route-probe.sh`，4/4 通过（§3.1），
commandcode 通过 → 基线不动，开环项关闭。以下程序保留，供后续扩缩集合时复用。

用户 2026-09-10（本地）在两条路线中选择：**保留 commandcode 在基线中，票 12 挂起**，等其
额度窗口重置后复测再裁剪（不现在移除）。

复测程序（下一个窗口）：

1. 时间窗口：`2026-09-11T06:21:01.800Z`（本地 14:21）之后；
2. `experiments/subagent-model-selection/run-route-probe.sh`，报告 `/tmp/dsh-ticket12/route-probe.json`；
3. 判据：
   - 4/4 通过 → 票 12 收尾，基线不动；
   - commandcode 仍为额度类失败 → 继续挂起（不改基线）；
   - commandcode 出现非额度失败（模型请求成功但无法完成工具调用）→ 按票 12 AC 从
     `~/.dsh/profiles/tui-dev/cordis.patch.yml` 与 `headless/cordis.patch.yml` 的
     `subagent-model-selection-settings` 行移除该路由（改前备份），同步
     `route-probe.patch.yml` 后重跑探针并做 `--dump-config` 闸门（逐 loader id 计数）。
4. 若届时集合变小，用同一探针确认剩余路由仍全通过，并在证据里更新「集合仍满足日常使用」结论。

## 7. 残留风险与转交

- **未提交**：本票新增文件与证据均未 commit/push，等待审阅。
- **用户层可影响复测**：`~/.dsh/settings.yaml` 的 `subagent-model-selection:` 段（当前不存在）
  对所有 profile 生效；复测前复核该段未被打开（finding 11-3）。
- **tui-central（parked）**：解除停用前仍需按 tui-dev 同法挂载设置服务并清理 roots 覆盖
  （finding 11-2/09-3）；本轮未动。
- **运行事实**：探针运行触发 rc.1 profile 规范化回写 `~/.dsh/profiles/headless/cordis.yml`
  （finding 01-2，非基线改动）；探针会话只落 `/tmp/dsh-ticket12`。
