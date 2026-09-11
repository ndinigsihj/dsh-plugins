# 05 — 隔离改造与重跑验证记录（票面 1–3 条）

- 执行时间：2026-09-11 19:40–19:47（本地）
- 授权：用户在 `evidence/05-isolation-plan.md` 上选择「照方案实施（含 2 次真实模型重跑）」
- 未 commit、未 push；stable 侧（`presets/minimal-plus/**`）按 D3 未动。

## 一、改动（4 个文件，全 dev 侧）

| 文件 | 改动 |
| --- | --- |
| `experiments/m4/m4.patch.yml` | 新增 `session-persistence-jsonl.config.root = !!js M4_SESSION_ROOT ?? '/tmp/dsh-probe/m4-sessions'`；头注释更新 |
| `presets/minimal-plus-next/trajectory.patch.yml` | 同款，默认 `/tmp/dsh-probe/trajectory-sessions`（`TRAJECTORY_SESSION_ROOT` 可覆盖） |
| `experiments/m4/m4-runner.mjs` | 报告默认 `<repo>/experiments/regression-gate/results-m4-<日期>.jsonl`（`M4_OUT` 仍可覆盖）；`mkdirSync` + 启动打印报告路径；`import.meta.url` 锚定仓库根 |
| `presets/minimal-plus-next/trajectory-driver.mjs` | 报告默认 `<repo>/experiments/regression-gate/results-trajectory-<日期>.json`（`TRAJECTORY_OUT` 仍可覆盖）；stdout 由「打印记录 JSON」改为「打印报告路径」 |

两个 `.mjs` 均 `node --check` 通过。

## 二、零额度前置校验（dump-config）

为避免规范化回写真实 profile，dump 用隔离 home 副本（`cp -R ~/.dsh/profiles/headless /tmp/dsh-probe/precheck-home/profiles/`）：

```
cd <repo> && DSH_HOME=/tmp/dsh-probe/precheck-home dsh --profile headless \
  --patch experiments/m4/m4.patch.yml --dump-config          # exit 0
grep -A3 session-persistence-jsonl → root: !!js process.env.M4_SESSION_ROOT ?? '/tmp/dsh-probe/m4-sessions'

DSH_HOME=/tmp/dsh-probe/precheck-home dsh --profile headless \
  --patch presets/minimal-plus-next/trajectory.patch.yml --dump-config   # exit 0
grep -A3 session-persistence-jsonl → root: !!js process.env.TRAJECTORY_SESSION_ROOT ?? …
```

输出留档：`/tmp/dsh-probe/{m4-dump.yml,traj-dump.yml}`（stderr 均为空）。

## 三、重跑验证

前置计数（清理后基线）：探针前缀 **0**、真实会话目录条目 **221**、`~/.dsh/sessions` 项目目录 **20**。

| # | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 1 | `M4_GROUPS=E M4_RUNS=1 M4_MODEL=opencode-go/deepseek-v4-flash dsh --profile headless --patch experiments/m4/m4.patch.yml` | **0** | 报告 `experiments/regression-gate/results-m4-2026-09-11.jsonl`（该跑 1 条，`error: null`，`elapsedMs: 1443`，无模型回复；补跑后文件共 2 条）；隔离根 `session-m4-E1-fee916bf-…` |
| 2 | `dsh --profile headless --patch presets/minimal-plus-next/trajectory.patch.yml`（默认任务「列出当前目录」） | **1**（断言判定） | 报告 `experiments/regression-gate/results-trajectory-2026-09-11.json`：`toolsOk: true`、`injectOk: true`、`openOk: false`（首行 "I'll list the contents…"，未锚定开场）；隔离根 `session-trajectory-6aaac485-…`；路由 `commandcode/deepseek/deepseek-v4.1-flash` |
| 3 | 补跑：`M4_GROUPS=E M4_RUNS=1 M4_MODEL=commandcode/deepseek/deepseek-v4.1-flash dsh --profile headless --patch experiments/m4/m4.patch.yml` | **0** | 报告追加第 2 条：`elapsedMs: 15836`、`toolSequence=[{round:1,calls:[bash,bash,write,bash]}]`、`error: null`；隔离根 `session-m4-E1-b2f19d3a-…` |

重跑后计数：探针前缀 **0**、条目 **221**、项目目录 **20** —— 与前置一致，真实会话目录零新增。
会话本体均落隔离根：

```
/tmp/dsh-probe/m4-sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E1-fee916bf-944d-4bc2-aa3d-5256a69b0b25
/tmp/dsh-probe/m4-sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E1-b2f19d3a-3783-45a3-b6e7-b1260eb01e75   （补跑）
/tmp/dsh-probe/trajectory-sessions/--Users-vito-data-dev-dsh-plugins--/session-trajectory-6aaac485-8fd6-4cc4-8d6a-f5c71b3e6492
```

### 补跑（用户裁定：换路由重查）+ 两条如实记录

1. **M4 首跑未产出模型回复（已定性：路由侧问题）**：首跑路由 `opencode-go/deepseek-v4-flash` 的隔离会话事件止于
   `request/header`、`request/context`、`session/title-llm-request`，没有 `assistant/message`、`tool/call`、`turn/end`，
   也没有 error 事件；记录 `error: null`、`elapsedMs: 1443`。
   经用户同意换 `commandcode/deepseek/deepseek-v4.1-flash` **补跑 1 次，跑通**：
   `elapsedMs: 15836`、`error: null`、`toolSequence = [{round:1, calls:[bash,bash,write,bash]}]`、`r2.headerReason: "change"`；
   隔离根新增 `session-m4-E1-b2f19d3a-3783-45a3-b6e7-b1260eb01e75`，真实会话目录仍 0 / 221 / 20。
   结论：空记录与本次隔离改造无关，属 `opencode-go/deepseek-v4-flash` 该次未返回内容；
   「turn 未完成却记 error:null」仍建议在 M4/票据 11 侧复看。
2. **轨迹首次判定红**：`openOk: false` 属已记录的口径类波动（M4 finding 08-2 / 票据 10：
   口径锚定率 56%，不当作回归）；`toolsOk`/`injectOk` 均绿。

## 四、副作用、清理与未闭合

- 真实 `~/.dsh/profiles/headless/cordis.yml` 被 boot 规范化回写（19:46），属 plan §6-7 记录的既有行为，
  非本票引入；本票只保证「会话不写真实目录」。
- **真实 projection cache 新增 3 条**（`storage-json.root` 未覆盖的必然结果，方案已声明本次不做），
  经用户确认**已逐条删除，计数恢复验证前**（m4 27 + trajectory 1）：
  - `session-m4-E1-fee916bf-944d-4bc2-aa3d-5256a69b0b25.json`（2973 B）
  - `session-trajectory-6aaac485-8fd6-4cc4-8d6a-f5c71b3e6492.json`（4403 B）
  - `session-m4-E1-b2f19d3a-3783-45a3-b6e7-b1260eb01e75.json`（5169 B，补跑产生）
  既有的 9 条 ticket11/12 遗留不在本次范围，未动。
- M4 任务在仓库根产生的 `m4-probe-E1.txt`（13 B）已删除，工作区无新增未跟踪文件。
- stable 侧 `presets/minimal-plus/**` 未动（D3）；其轨迹探针若被运行仍会写真实会话目录，需手工覆盖 session root。

## 五、票面勾对

- 第 1 条（行为基线 runner 隔离写）：满足 —— patch 覆盖 `session-persistence-jsonl.root`，重跑实证。
- 第 2 条（轨迹 runner 隔离写 + 报告落仓库归档）：满足 —— 两处 patch + 两个 runner 默认报告路径。
- 第 3 条（重跑前后计数对比）：满足 —— 前/后均为 0 / 221 / 20，新增会话全部在隔离根。
