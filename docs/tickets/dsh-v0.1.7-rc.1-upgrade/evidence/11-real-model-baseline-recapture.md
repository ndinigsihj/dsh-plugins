# 11 — 真实模型基线重采与探针口径收口（证据）

> 日期：2026-09-25（本地 +0800，UTC 13:45–14:26）；宿主：`@deepseek-ai/dsh@0.1.7-rc.1`（会话格式 4）
> 关联：`docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（闸门基准 / Testing Decisions：真实模型 seam）、升级计划 §5.5、§6 P1 T3 行
> 前置：04（宿主升级与两个工作 Profile，已完成）；07 移交给本票的 `.agent-presets` staging 已切 0.1.7 载体
> 范围外：部署位写入与 `tui-team` 物化（票据 12）；功能性路由策略变化；扩展允许路由集合

## 1. 结论（对照票面验收）

| # | 验收项 | 结果 | 依据 |
| --- | --- | --- | --- |
| 1 | 新基线入库并带宿主角印；旧基线保留为历史 | ✅ 新基线 `m4-commandcode-v41-2026-09-25`：host `0.1.7-rc.1`、模型/路由集合/Preset 身份不变（内容 sha 换代见 §8）、N=9、sha `062cd4f7…`；旧 3 条（0.1.5-rc.1）保留且文件 sha 仍 `ok` | `gates/manifest.json`、`experiments/m4/results-minimal-plus-next-commandcode-v41-2026-09-25.jsonl` |
| 2 | 真实模型层按新基线运行通过 | ✅ `--tier 3` **18/18 pass / 0 failed / 0 skipped，exit 0**（M4 9/9 锚定 + check3/check4 9/9；模型选择探针 16/16；路由探针 2/2） | `evidence/11-t3-green.json`；归档 `experiments/regression-gate/t3-2026-09-25T14-25-52-003Z/` |
| 3 | 探针口径与维护文档同批更新，无"模型自主选路由"的隐含结论 | ✅ a14 改名 `a14-whitelist-route-compliance`（检查仍逐字段给定路由，结论=白名单透传/可执行）；`docs/subagent-model-selection.md` §1/§2 写明"为白名单背书"，ADR-0001 边界同口径 | `experiments/subagent-model-selection/probe.mjs`、`docs/subagent-model-selection.md`、`docs/adr/0001-…md` |
| 4 | 基线与探针的引用关系（基线 id、容忍度）一致 | ✅ `t3.baseline = m4-commandcode-v41-2026-09-25`、`t3.tolerance = 1`；T3 断言 `t3.baseline.file-intact` / `t3.model.baseline-match` 双绿；维护文档 §4.1 引用同一 id/容忍度 | `gates/manifest.json`、`11-t3-green.json`、`docs/subagent-model-selection.md` |
| 5 | 证据归档到本票 | ✅ 本文件 + `11-t3-green.json` + 原始归档目录（三份产物逐文件 sha 见 §7） | — |

## 2. 复现（两步：采集 → 正式签收）

```sh
# ① 采集跑：先把 manifest 的 t3.baseline 指向“待入库”的新条目（sha 占位），
#    T3 会拒绝 t3.baseline.file-intact 但照常跑 M4/探针；本次 17/18（唯一红=占位基线）
scripts/regression-gate.sh --tier 3 --json /tmp/t3-capture-2026-09-25.json

# ② 入库：复制归档批次 → 计算 sha/capturedAt → 更新 gates/manifest.json
cp experiments/regression-gate/t3-2026-09-25T13-45-57-311Z/m4-E.jsonl \
   experiments/m4/results-minimal-plus-next-commandcode-v41-2026-09-25.jsonl

# ③ 正式签收跑（新基线完整入库）
scripts/regression-gate.sh --tier 3 \
  --json docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/11-t3-green.json
```

**PTY 前置**：preset 的 persistent-shell bash 与两个探针需要伪终端。无 PTY 的沙箱里 bash 返回
`posix_openpt: Operation not permitted`，M4 锚定仍会“绿”（只看首工具名），但路由探针判红——
本票的采集与签收都在常规终端（一次性提权 shell）执行；该限制已写进维护文档 §6。

## 3. 签收跑结果（2026-09-25T14:25:52Z 开始；双轴评审处置后的最终代码）

- **PRE**：`host.cli` / `host.pin.hostVersion` / `host.pin.sessionFormatVersion` 3/3。
- **T3**：15/15，合计 **18 passed / 0 failed / 0 skipped**。
  - M4（N=9）：锚定 9/9（阈值 8 = 9−tolerance 1）、check3 9/9、check4 9/9、errors 0；
    advisory 措辞只记录：anchorRate 89%、weNeed 1、avgTools 28。
  - 模型选择探针：**16/16**；promotion 后 assembledTools 29、baseline config = 2 条允许路由。
  - 允许路由探针：**2/2**，`commandcode/deepseek/deepseek-v4.1-flash` 10.4s、
    `deepseek-official/deepseek-flash` 5.1s（marker 回显）。
  - provenance：host `0.1.7-rc.1`、sessionFormat 4、preset sha `8cd01c68…`、
    runs 9、capturedAt 与归档一致。
  - isolation：`t3.isolation.real-home-untouched` 严格区签名一致（观测区 1 项，非 strict）。
- **T0–T2 回归**（同窗口，`--composition gate --skip-deployment-check`，部署位豁免为过渡窗口声明）：
  `tsc --noEmit` exit 0、`npm test` **195/195**、测试清单 21 files；T1 15/15、T2 59/59，
  summary **80 passed / 0 failed / 0 skipped，exit 0**（报告 `evidence/11-gate-012.json`）。

## 4. 0.1.7 载体迁移（07 移交本票的部分）

| 资产 | 改动 |
| --- | --- |
| `gates/t3/run.mjs` | 删除 `.agent-presets` 目录 staging；preset 从仓库真源现场生成 bundle（`prepareHeadlessPresetProfile`）接入三个独立隔离 profile（`t3-headless` / `-probe` / `-route`）；探针前重新物化默认 `settings.yaml`（适配器导入会改名该文档）；报告新增 `probeProfiles` / `presetBundlePatchSha256` |
| `experiments/m4/m4.patch.yml`、`experiments/subagent-model-selection/{probe,route-probe}.patch.yml`、`presets/minimal-plus/trajectory.patch.yml` | 删除旧 `@deepseek-ai/dsh-agent-presets` 插入行（0.1.7 已移除该服务与目录形态）；preset 由 profile 的 bundle 选择提供 |
| `experiments/subagent-model-selection/allowed-routes.mjs`（新增） | T3 / 探针侧的允许路由集合单一来源（`--print-config` 供脚本预置 profile；生产真相仍是两个真实 profile 条目） |
| `scripts/profile-home.mjs` | 新增 `prepareHeadlessPresetProfile`（骨架 + fixture + bundle + 可选单例 config）；单例 config 必须放 profile 层（`--patch` overlay 覆盖的条目会被设置编辑器拒写）；CLI 新增 `--settings-config` |
| `run.sh` / `run-route-probe.sh` | 独立跑改为自建隔离 home（0.1.7 载体 + profile 层部署基线），不再依赖旧目录 preset |
| `gates/t3/run.mjs` 的 `PROBE_CHECK_IDS` | a14 id 随探针改名同步 |

## 5. 新宿主带来的行为差异与处置（本次修的点）

1. **设置面换代**：允许路由按 profile 条目存放，`settings.update(条目 id, …)` 的 ns 从旧
   `subagent-model-selection` 变为 `subagent-model-selection-settings`；被 `--patch` overlay 覆盖的条目
   会被编辑器拒绝写入。→ 探针 a9 改用条目 id；部署基线从 overlay 移到 profile 层（`allowed-routes.mjs`）。
2. **tool/result 消息形状扁平化**：0.1.7 的 tool 消息是 `message.toolCallId` + 扁平 `content`，
   不再裹在 `tool-result` 块里。→ 路由探针 `toolResultsOf` 兼容两种形状（旧形状保留兼容分支）。
3. **适配器来源**：插件段从默认 `$DSH_HOME/settings.yaml` 导入并在首次写入时改名；M4 跑完后该文档
   已不在，新 profile 看不到 provider（实测 `NO_ADAPTER`）。→ 每个探针进程前重新物化默认 settings 副本。
4. **PTY 依赖**：无 PTY 时 child bash 返回 `posix_openpt: Operation not permitted`；M4 锚定不受影响，
   路由探针判 tool-error。→ 真实模型层在常规终端跑并写入维护文档；不改变断言口径。
5. **口径改名**：`a14-model-driven-selection` → `a14-whitelist-route-compliance`；探针头注释与
   `docs/subagent-model-selection.md` 写明"指令逐字段给定路由，只证明白名单可透传/可执行"。

## 6. 基线与部署位引用

| 项 | 值 |
| --- | --- |
| `t3.baseline` / 容忍度 | `m4-commandcode-v41-2026-09-25` / `1` |
| 批次路径 / sha / capturedAt | `experiments/m4/results-minimal-plus-next-commandcode-v41-2026-09-25.jsonl` / `062cd4f7…` / `2026-09-25T13:46:23Z` |
| 历史基线（保留） | `m4-upgrade-only-2026-09-10`、`m4-deduped-2026-09-10`、`m4-commandcode-v41-2026-09-12`（host 均 `0.1.5-rc.1`） |
| 部署位 | 仍是旧目录形态且与清单不一致（`deploymentStatus: absent`）——0.1.7 不读取；bundle/Team 落位归票据 12 |
| preset 载体（本次） | 仓库真源 `presets/minimal-plus`（`presetSource: repo`），agent.cordis.yml sha `8cd01c68…` |

## 7. 证据文件

| 文件 | 内容 | sha256 |
| --- | --- | --- |
| `evidence/11-t3-green.json` | 正式签收跑报告（评审处置后终稿）：PRE 3/3 + T3 15/15，summary 18/0/0，exit 0 | `4a5480884184…` |
| `evidence/11-gate-012.json` | 同窗口 T0–T2 回归：80/0/0，npm test 195/195（部署位豁免为过渡窗口声明） | `cae39ae5d8e3…` |
| `experiments/regression-gate/t3-2026-09-25T14-25-52-003Z/m4-E.jsonl` | 签收跑 M4 批次原始产物 | `2755fd77a374…` |
| `experiments/regression-gate/t3-2026-09-25T14-25-52-003Z/model-selection-probe.json` | 16/16 行为探针报告（含 assembledTools / policy / 设置编辑检查） | `0bc3baaf75c1…` |
| `experiments/regression-gate/t3-2026-09-25T14-25-52-003Z/route-probe.json` | 2/2 逐路由报告（header 路由 / bash 调用 / marker 回显 / 耗时） | `535d4340f0dd…` |
| `experiments/m4/results-minimal-plus-next-commandcode-v41-2026-09-25.jsonl` | 入库基线批次（与采集归档同源，sha 即清单引用） | `062cd4f70c33…` |
| `experiments/regression-gate/t3-2026-09-25T13-45-57-311Z/` | 采集跑归档（同一 M4 批次 + 采集轮探针报告，供对照） | — |
| `experiments/subagent-model-selection/allowed-routes.mjs` | T3 / 探针侧的允许路由集合单一来源 | `c5e74d54a26c…` |

## 8. 边界与移交

- 真实 `~/.dsh` 在 T3 全程只读：`t3.isolation.real-home-untouched`（严格区）通过；settings/credentials
  只以 600 副本进临时 home，报告只记 sha。
- 路由集合、模型、任务模板、样本量（N=9）、容忍度（1）与 2026-09-12 基线同口径，仅宿主换代并重采。
  **Preset 身份同为 `minimal-plus`，内容并非逐字节相同**：新基线用仓库真源 `agent.cordis.yml`
  sha `8cd01c68…`（2026-09-24 `b99a575` 已把 bash 描述对齐上游 minimal），旧基线时代为 `b6828199…`。
  该差异属升级批次的既有变更；重采口径 =「同 Preset 身份 + 升级批次当前内容」，跨宿主数字对比本就不做。
- 部署位 bundle 落位、旧目录退场、`tui-team` 真实物化、最终闸门与豁免移除归票据 12；
  稳定树与另一支旧安装点不在本轮范围。

## 9. 双轴只读评审处置（2026-09-25）

对 `ac19a7a → 工作树` 跑了 Standards / Spec 两个只读子代理评审（未修改、创建、删除、暂存或提交任何文件）；发现与处置：

| 轴 | 发现 | 处置 |
| --- | --- | --- |
| Standards | 新导出 `MODEL_SELECTION_SINGLETON_PATCH` 无消费者 | **已删** |
| Standards | settings/credentials 副本的 `copyFileSync + chmod(0600)` 重复 3 处 | **已抽** `materializeSecret` |
| Standards | `gates/t3/run.mjs` 513 行、`runT3` 长函数（**继承自 HEAD：511 行，本票仅 +2 行**） | **接受（不重构）**：拆分属独立重构，避免在真实模型票里扩大改动面并再次作废签收；记为遗留项 |
| Standards | `settingsSingleton` 三态 + `undefined→true` 重映射 | **已修**：拆成 `settingsSingleton` + `settingsConfig`；CLI 缺值报明确错误 |
| Standards | `prepareT3Profile` 返回未被消费的 `dir` / `patchPath` | **已删**冗余字段 |
| Standards | profile-home 新测试自证 YAML、CLI 缺值路径无测 | **已修**：新增 CLI 端到端 + 缺值报错测试；配置行的 YAML 解析由 dsh `--dump-config` 与 T3/T1 端到端覆盖 |
| Standards | `run.sh` / `run-route-probe.sh` 重复内联 `import` | **已修**：`allowed-routes.mjs --print-config` |
| Spec | 证据 §8“Preset 未变”与预设 sha 换代（`8cd01c68…` vs `b6828199…`）矛盾 | **已修**：改为“同 Preset 身份、内容非逐字节相同（b99a575 属升级批次既有变更）” |
| Spec | 路由探针 parent 路由“被切换”疑似越界 | **非本票引入**：HEAD 已是 `commandcode/deepseek/deepseek-v4.1-flash`（旧头注释滞后），本票只改准注释 |
| Spec | `allowed-routes.mjs` 自称“部署基线单一来源”过度 | **已修**：明确“T3 / 探针侧单一来源；生产真相仍是两个真实 profile 条目” |
| Spec | CLI 默认不挂单例 → 裸调用得到 minimal-plus 无法组合的 profile | **已修**：CLI 默认 `settingsSingleton: true`（函数 API 默认仍 false） |
| Spec | 计划/维护文档工具数 30/29→35/28/29 与 Team/PTY 段落 | **接受**：30/29 是 0.1.5 口径（票据 04 已标注 0.1.7 需重采），维护文档是本次口径收口的指定落点；仅为消除误导 |

处置后复跑（终稿证据）：`npm test` **195/195**、`tsc` 0、T0–T2 **80/0/0**、T3 **18/0/0**；
归档 `experiments/regression-gate/t3-2026-09-25T14-25-52-003Z/`，报告与 sha 见 §7。
