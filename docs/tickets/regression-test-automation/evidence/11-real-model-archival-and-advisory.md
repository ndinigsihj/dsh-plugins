# 票据 11 证据 — 真实模型层归档与 advisory（T3）

日期：2026-09-12 ｜ 施工图：`docs/regression-test-automation-plan.md` §3.4、§4.3、§5.4、§7 P4；
用户决策 D4（判图只做 triage）、Q3（版本不符拒绝跑）
状态：**实现与正式签收完成（2026-09-12）**。历程：实现与机制验证（§1/§4）→ 原基线口径曾被
opencode-go 月度 429 阻塞（§3）→ 用户裁定退役 opencode-go 并切换 2 条路由集，重采基线后
`--tier 3` 全绿（§9）。

## 1. 交付物

| 文件 | 作用 |
| --- | --- |
| `gates/t3/analysis.mjs` + `analysis.test.mjs` | 纯判定：T3 前置（宿主/会话格式/基线来源/settings）、M4 行为锚定容忍度、探针与路由报告归纳（22 例） |
| `gates/t3/run.mjs` | T3 runner：staging 部署位 preset + settings/credentials 副本 → `t3-headless` 隔离 profile → M4 批次 + 模型选择探针 + 允许路由探针 → 按 UTC 时间戳归档 |
| `gates/run.mjs` | T3 接线：`--tier 3` 按需层、版本/基线不符时该层拒绝运行（exit 2）、T3 自带真实 home 零写入断言；`GATE_SOURCES` 纳入 `gates/t3/run.mjs`；真实 home 指纹新增 `.credentials.yaml` 严格区 |
| `gates/manifest.json` + `gates/manifest.mjs` | 新增可选 `t3` 段（baseline 引用 + tolerance）与形状校验；初始 `t3.baseline` 指向 `m4-deduped-2026-09-10`，2026-09-12 改指 `m4-commandcode-v41-2026-09-12`（§9） |
| `experiments/subagent-model-selection/{probe.patch.yml,route-probe.patch.yml}` | settings/session 路径可用 env 覆盖（默认值仍是 `/tmp/dsh-ticket11|12`，`run.sh` 行为不变） |
| `experiments/subagent-model-selection/{probe.mjs,route-probe.mjs}` | 父/显式路由支持 env 覆盖（`PROBE_PARENT_*`/`PROBE_EXPLICIT_*`/`ROUTE_PROBE_PARENT_*`），默认值不变；报告记录实际路由 |
| `experiments/m4/m4-runner.mjs` | 记录新增 `sessionId` 与 `turnErrors`（turn 级模型错误显式落档，T3 不再靠猜「0 工具调用」原因） |
| `docs/visual-triage-and-manual-signoff.md` | T4c 流程：可量化/只能参谋分层、判图前提与禁止用途、人工签收清单、读图实测记录表 |
| `package.json`、`scripts/regression-gate.sh` | 测试清单 +1；T3 用法与 env 覆盖说明 |

## 2. 验收对照（票面 7 项）

| 票面项 | 结论 | 证据 |
| --- | --- | --- |
| 真实模型层接入闸门按需分层，运行既有批次与探针，报告内嵌宿主版本、组合 sha、采集日期、样本量 | 成立（机制验证跑 9/9 + 16/16 + 2/4，见 §4） | `t3.m4.*`、`t3.model-selection-probe.*`、`t3.route-probe.*`、`t3.report.provenance`；报告 `report.t3 = {hostVersion,capturedAt,runs,model,composition{presetSha256,profilePatchSha256,settingsSha256,credentialsSha256},archive}` |
| 宿主版本/会话格式/基线来源不符 → 该层拒绝运行（exit 2）并提示重采基线 | 成立 | §5 负控：基线 hostVersion 改错 → `t3.precondition.t3.baseline-host` + T3 skip + exit 2；全局 host/format 不符由既有 host pin 前置覆盖 |
| 行为锚定类断言保留容忍度，不把口径类措辞统计当硬指标 | 成立 | `t3.m4.behaviour-anchored`（阈值 = runs − tolerance）；`t3.m4.advisory-wording` 永远 pass，只记录 anchorRate/weNeed/letMe/avgTools |
| 真实模型产物归档到仓库实验目录约定下、文件名带日期、跨轮次不覆盖 | 成立 | 每次运行新建 `experiments/regression-gate/t3-<UTC 时间戳>/`（含 m4 jsonl + 两个探针 json）；重跑必得新目录 |
| 视觉/体感复核流程文档化（可量化 / 只能参谋 / 判图前提与禁止用途） | 成立 | `docs/visual-triage-and-manual-signoff.md` §1–§4 |
| 文档写明判图不产生退出码、整屏截图不进判定链、「配置声明支持图像」≠ 上游具备（须实测记录） | 成立 | 同上 §2–§4、§6（读图能力实测记录表，未实测前不得推断） |
| 文档给出人工签收清单（真实终端观感、配色、字形渲染、粘贴与剪贴板） | 成立 | 同上 §5 八项清单 |

另有闸门侧回归：`--tier 0,1,2` → 58 passed / 0 failed；`npx tsc --noEmit` 0；`npm test` 144/144。

## 3. 正式基线口径跑（红：外部额度，非代码回归）

命令（无任何 env 覆盖，走 manifest 基线模型）：

```bash
bash scripts/regression-gate.sh --tier 3 \
  --json experiments/regression-gate/results-2026-09-12-t3.json
```

报告 sha256 `8d11601dd697…`，summary `11 passed / 7 failed`；归档
`experiments/regression-gate/t3-2026-09-12T01-47-35-413Z/`（m4-E.jsonl `f01b0adc7839…`、
model-selection-probe.json `623a2d8ed1f8…`）。失败全部可归因到同一个外部原因：

- **M4 批次 9/9 记录全为 `QUOTA`**：`opencode-go` 返回
  `GoUsageLimitError: Monthly usage limit reached. Resets in 7 days`（模型/父路由
  `opencode-go/deepseek-v4-flash`，与 `deepseek-flash` 同 workspace）；行为锚定 0/9、
  check3/check4 0/9，`errors=0` 但 `providerErrors=9`（这正是 §1 给 M4 记录补 `turnErrors` 的用途）。
- **模型选择探针 11/16**：5 项红（a00/a2/a3/a13/a14）全部是父会话 promotion 未发生导致
  （promotion 需要一次真实模型响应），不是选择机制断言本身失败。
- **允许路由探针无报告**：父路由 warmup 拿不到模型响应，探针在
  `subagent lacks model params after promotion` 处退出（资产既有行为），T3 如实记录 exit 1 与
  stderr、并把缺失归档算作红。
- 隔离：`t3.isolation.real-home-untouched` pass（strict zones 前后一致，1 项 observed-only）；
  真实 `settings.yaml`/`.credentials.yaml`/部署位/sessions 零写入。

结论：这套红不能当基线结论，属外部额度；恢复后按 §8 重跑签收。替代路由单跑实测可用：
`deepseek-official/deepseek-v4-flash`（8.2s、首工具 bash）、
`commandcode/deepseek/deepseek-v4-flash`（20.3s、首工具 bash）。

## 4. 替代路由机制验证跑（用户 2026-09-12 选择 B）

命令（报告记录实际路由；manifest 与基线口径不变）：

```bash
GATE_T3_MODEL=deepseek-official/deepseek-v4-flash \
PROBE_PARENT_PROVIDER=deepseek-official PROBE_PARENT_MODEL=deepseek-v4-flash \
PROBE_EXPLICIT_PROVIDER=commandcode PROBE_EXPLICIT_MODEL=deepseek/deepseek-v4-flash \
ROUTE_PROBE_PARENT_PROVIDER=deepseek-official ROUTE_PROBE_PARENT_MODEL=deepseek-v4-flash \
bash scripts/regression-gate.sh --tier 3 \
  --json experiments/regression-gate/results-2026-09-12-t3-substitute.json
```

报告 sha256 `a0cfb416d5d1…`，summary `16 passed / 2 failed`（两条红见下）；归档
`experiments/regression-gate/t3-2026-09-12T02-03-30-622Z/`：

| 资产 | 结果 | 关键证据 |
| --- | --- | --- |
| M4（model=deepseek-official/deepseek-v4-flash） | 行为锚定 9/9（阈值 8）、check3 9/9、check4 9/9、avgTools=29；advisory anchorRate=22% 未判定 | `t3.m4.behaviour-anchored` / `t3.m4.agent-instructions` / `t3.m4.sandbox-bash`；m4-E.jsonl `e26d5fbd1686…` |
| 模型选择探针（parent=deepseek-official，explicit=commandcode） | **16/16 pass**、白名单齐全 | model-selection-probe.json `6639d9fbf483…`；报告记录 `parent`/`allowed`（4 条路由） |
| 允许路由探针（parent=deepseek-official） | 4 条路由全部建立子会话；**2/4 pass**：commandcode 9.6s、deepseek-official 6.2s 均以真实 bash 回显 marker；opencode-go 两条 `subagent-error`+`turnErrorCodes=["QUOTA"]` | route-probe.json `416f9af3a26f…` |
| 溯源与隔离 | `t3.report.provenance` pass；`t3.isolation.real-home-untouched` pass | 报告内嵌 host=0.1.5-rc.1、presetSha=9087bf00…、runs=9、capturedAt |

两条红是**有意保留的口径偏差**，不是机制缺陷：

1. `t3.model.baseline-match` — 本次 M4 用替代路由（`deepseek-official`），与 manifest 基线
   `opencode-go/deepseek-v4-flash` 不同；断言按设计判红，防止替代跑被误读为基线绿。
2. `t3.route-probe.all-routes` — 2 条 opencode-go 路由外部额度（QUOTA），无法在今日变绿。

路由探针的两条通过路径需要真 PTY：本会话默认沙箱下子会话 bash 返回
`posix_openpt: Operation not permitted`；本跑是在一次性提权 shell 内完成的（与票据 10 对 PTY
的处置一致）。默认沙箱下的同命令结果（route probe 两条 tool-error、PTY EPERM）已记录在案。

## 5. 隔离与负控

- **版本/基线负控（实测）**：临时把 `baselines["m4-deduped-2026-09-10"].hostVersion` 改为
  `0.1.5-rc.0` → `t3.precondition.t3.baseline-host — … re-capture the baseline on the pinned host`，
  `[T3] skip`，退出码 **2**；随后 manifest sha 复原一致。
- **真实 home 零写入**：两次 T3 跑的严格区（profiles / settings.yaml / .credentials.yaml /
  部署位 preset / sessions 计数）前后指纹一致；settings 与 credentials 副本只落临时 home（600），
  报告只记 sha；未用 `--keep-temp`，临时 home 退出即删（敏感副本不落盘）。
- **单测/门禁**：`gates/t3/analysis.test.mjs` 22 例；`npm test` 144/144；`npx tsc --noEmit` 0；
  `--tier 0,1,2` 58/0/0、`--tier 0,1` 既有断言未回归。

## 6. 过程中发现并修复

1. **T3 需要宿主作用域模型选择单例**：preset 的 `delegation/tool-subagent` 开了
   `modelSelectionSettings: true`，隔离 headless profile 缺该单例时 preset 挂载失败。修法：新增
   `t3-headless` profile（headless 骨架 + 单例 insert，默认 disabled），探针 patch 再按 id 覆盖为
   enabled；与 T1/T2 共用的 headless 组合互不污染。
2. **凭据来源**：provider 密钥在 `$DSH_HOME/.credentials.yaml`（dsh-credentials-local）；只复制
   `settings.yaml` 会在隔离 home 内报 `no credential for provider route`。修法：只读复制该文件
   （报告只记 sha），真实 home 指纹新增该严格区。
3. **跨资产 settings 污染（实测抓到）**：模型选择探针的 a9 会写 settings 文档；三个资产共用一份
   副本时，路由探针随后读到被改成单条 `gjx/gpt-5.6-sol` 的集合（实测只探 1 条路由）。修法：
   per-asset settings 副本（M4 默认路径 + 两个探针各一份），路由探针复跑后正确探测 4 条。
4. **M4 吞 turn 级错误**：模型 429 时 runner 记录仍是 `error:null`、0 工具调用，看起来像行为问题。
   修法：记录新增 `sessionId` 与 `turnErrors`，T3 归纳为 `providerErrors`（QUOTA/传输可分类）。
5. **路由探针父路由失败时不落报告**：T3 如实记录 exit/stderr 与缺失归档（不改资产行为）。
6. **M4 任务会在仓库 cwd 生成 `m4-probe-<group><run>.txt`**（历史任务模板口径，票据 10 也是人工清理）：
   T3 在批次读完后按「文件名 + 内容与任务模板一致」删除本次生成的文件。本窗口 §3/§4 两份报告生成时
   还没有这步清理（报告数值不受影响），跑完已手工清掉这 9 个残留。

## 7. T4c 文档

`docs/visual-triage-and-manual-signoff.md`：几何/文本与颜色属性（T4a/T4b 可断言）、像素与原生交互
（只能人工）、时间量化（T4b metrics）；判图只允许分诊/提断言建议，前提是实测记录读图能力；
明确「不产生退出码、整屏截图不进判定链、配置声明≠能力」；附真实终端八项人工签收清单与
读图实测记录表（首次使用前必须补一行）。

## 8. 开环与后续

- **（已关闭）正式签收动作**：原计划等 opencode-go 额度恢复；用户 2026-09-12 裁定切换路由集并
  重采基线，当日完成正式 `--tier 3` 全绿签收（见 §9）。
- T3 永不进 release/CI（按需层）；release 路径仍只有 `--tier 0,1,2 --composition real`（含 doc 说明）。
- 用户层 `~/.dsh/settings.yaml` 的 `subagent-model-selection:` 段会同时作用于 headless（finding 11-3）；
  T3 探针 patch 按 id 覆盖为现行 2 条部署路由（§9），用户层叠加若发生再做处置。
- 中间产物：本窗口删除了两条开发期归档（`t3-2026-09-12T01-50-51-297Z` 设置污染、
  `t3-2026-09-12T01-54-12-144Z` PTY 受限），保留 §3 正式红跑与 §4 机制验证跑两个归档；报告与
  归档随本票提交（2026-09-12，用户确认）。

## 9. 2026-09-12 路由切换与正式签收（opencode-go 退役）

用户 2026-09-12 追加裁定：opencode-go 月度额度期间不再使用；`commandcode/deepseek/deepseek-v4-flash`
并入 `commandcode/deepseek/deepseek-v4.1-flash`；`deepseek-official/deepseek-v4-flash` 换成
`deepseek-official/deepseek-flash`。现行允许集合 **2 条**：
`commandcode/deepseek/deepseek-v4.1-flash` + `deepseek-official/deepseek-flash`。

### 9.1 变更记录

- **M4 基线重采**（N=9，临时 home 带 `gates/fixtures/gate-home` 确定性 fixture，与 T3 同环境）：
  `experiments/m4/results-minimal-plus-next-commandcode-v41-2026-09-12.jsonl`，sha256 `ef9a270a40ba…`，
  capturedAt `2026-09-12T02:24:07Z`；9/9 首工具 bash、check3/check4 9/9、avgElapsed 24.4s。
  首次重采漏了 fixture（check3=0）已发现并作废重跑，不采用。
- **`gates/manifest.json`**：新增 baseline `m4-commandcode-v41-2026-09-12`（model=新路由），
  `t3.baseline` 改指它；旧两条 opencode-go 基线保留作历史。
- **探针与 patch**：`PARENT` 默认 = commandcode v4.1-flash、`EXPLICIT` 默认 =
  deepseek-official/deepseek-flash；`ALLOWED_X` 与两个 patch 的 `allowedModels` 同步为 2 条；
  a4 发现断言改为从 `ALLOWED_X` 派生（原硬编码旧 4 条，切集合后误红 15/16，已修）。
- **真实 profile**（工作区外，一次性提权编辑）：`~/.dsh/profiles/tui-dev/cordis.patch.yml`
  （enabled=true）sha256 `96a0d5e0…`、`~/.dsh/profiles/headless/cordis.patch.yml`（enabled=false）
  `6ef872ea…`，各 2 条；改前备份 `/tmp/t3-model-switch-backup/*.bak`（旧 sha `d6b283d6…`/`338f36cd…`）。
- **文档**：`docs/subagent-model-selection.md` §3/§4/§6 同步；`experiments/m4/{m4-runner.mjs,m4.patch.yml}`
  用法示例改新路由。

### 9.2 正式签收跑（全绿）

```bash
bash scripts/regression-gate.sh --tier 3 \
  --json experiments/regression-gate/results-2026-09-12-t3-final.json
```

- 报告 sha256 `a972f33de22b…`，summary **18 passed / 0 failed / 0 skipped**，exit 0。
- 归档 `experiments/regression-gate/t3-2026-09-12T02-35-57-132Z/`：m4-E.jsonl `eab1f99a475f…`、
  model-selection-probe.json `704cc6d28506…`、route-probe.json `5359f6370a91…`。
- 断言：baseline intact / model match；M4 行为锚定 9/9 + check3/check4 9/9（avgTools 29；
  advisory 措辞率 100% 只记录不判定）；模型选择探针 **16/16**；允许路由探针 **2/2**
  （commandcode v4.1 10.3s、deepseek-official/deepseek-flash 6.3s，marker 回显）；
  provenance 与真实 home 零写入（严格区 0 变化）全绿。
- 路由探针真 PTY 在一次性提权 shell 内执行（默认沙箱 `posix_openpt: EPERM`），与 §4 记录一致。

### 9.3 结果

票面 7 项全部关闭；原本阻塞的两条断言（`t3.model.baseline-match`、`t3.route-probe.all-routes`）
在本节转绿。中途暴露 a4 硬编码旧集合的开发期归档 `t3-2026-09-12T02-29-21-978Z` 已删除，
问题与修法记录在 9.1。
