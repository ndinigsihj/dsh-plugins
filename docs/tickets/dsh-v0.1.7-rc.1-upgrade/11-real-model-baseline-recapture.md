# 11 — 真实模型基线重采与探针口径收口

**What to build:** 在目标版本上按同 Preset、同模型、同参数重采真实模型基线，旧基线保留为历史；真实模型层按新基线运行并通过；探针结论口径改为"为白名单背书"（不再隐含模型会自主选择路由），与基线、维护文档同批更新。窗口内采不了时显式记录"新宿主未跑"，不跨宿主对比。

**Blocked by:** 04 — 宿主升级与两个工作 Profile 到位。（05 会话读取异步化已按 C0 ① 降级为可选、`deferred`，不阻塞本票。）

**Status:** done — 2026-09-25（宿主 `0.1.7-rc.1` 新采基线 `m4-commandcode-v41-2026-09-25`；T3 载体切 0.1.7 bundle、探针口径改白名单背书；`--tier 3` 18/18 exit 0；**改动未提交，待用户确认后 commit**）

**施工图:** `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Implementation Decisions：闸门基准；Testing Decisions：真实模型 seam）；升级计划 §5.5、§6 T3 行

- [x] 新基线入库并带宿主角印；旧基线保留为历史 — `gates/manifest.json` 新增 `m4-commandcode-v41-2026-09-25`（host `0.1.7-rc.1`、model `commandcode/deepseek/deepseek-v4.1-flash`、preset `minimal-plus`、N=9、sha `062cd4f7…`）；旧 3 条（`0.1.5-rc.1`）文件与记录都在，不再被 `t3.baseline` 引用
- [x] 真实模型层按新基线运行通过，或显式记录"新宿主未跑" — `scripts/regression-gate.sh --tier 3`：PRE 3/3 + T3 15/15 = **18/0/0，exit 0**（M4 9/9 锚定 + check3/check4 9/9；模型选择探针 16/16；允许路由探针 2/2）；报告 `evidence/11-t3-green.json`
- [x] 探针口径与维护文档同批更新，无"模型自主选路由"的隐含结论 — a14 改名 `a14-whitelist-route-compliance`；`docs/subagent-model-selection.md` §1/§2 与 ADR-0001 边界写明「白名单 + 可选覆盖，探针为白名单背书」；升级计划 §5.5 方向 3 与 §6 T3 行回填
- [x] 基线与探针的引用关系（基线 id、容忍度）一致 — `t3.baseline = m4-commandcode-v41-2026-09-25` / `t3.tolerance = 1`；`t3.baseline.file-intact`（state=ok）与 `t3.model.baseline-match` 双绿；维护文档 §4.1 引用同一 id/容忍度
- [x] 证据归档到本票 — `evidence/11-real-model-baseline-recapture.md` + `evidence/11-t3-green.json` + 归档 `experiments/regression-gate/t3-2026-09-25T14-25-52-003Z/`（三份产物 sha 见证据 §7）

**范围外（本票不做）:** 功能性路由策略变化；扩展允许路由集合。

---

## 验收回填（2026-09-25）

**施工口径**：同 Preset 身份（`minimal-plus` 仓库真源，内容 sha `8cd01c68…`，与 0.1.5 时代非逐字节相同）、同模型（`commandcode/deepseek/deepseek-v4.1-flash`）、同参数（M4 E 组 N=9、E 组任务模板、gate fixture、tolerance 1）在 `0.1.7-rc.1` 上重采。T3 层按票 07 的移交切成 0.1.7 载体：preset 由隔离 profile 选择的生成 bundle 提供，不再读 `.agent-presets` 目录。

**关键结果**：采集跑 17/18（唯一红 = 占位基线 sha），入库后签收跑 18/18；路由探针 2 条均 marker 回显（8.0s / 5.9s）；真实 home 严格区零写入。窗口内**不需要**"新宿主未跑"降级。

**窗口内新发现并处置的 0.1.7 差异**：设置 ns 变为 profile 条目 id（`subagent-model-selection-settings`）且 overlay 覆盖过的条目拒写 → 部署基线移到 profile 层并单源于 `allowed-routes.mjs`；tool/result 消息形状扁平化 → 探针解析兼容；插件段从默认 `settings.yaml` 导入并改名 → 每个探针进程前重新物化；bash/探针需要 PTY → 真实模型层在常规终端跑并写入维护文档。详见证据 §5。

**移交**：部署位 bundle 落位、旧目录退场、`tui-team` 真实物化与最终闸门归票据 12；稳定树不在本轮范围。

**双轴只读评审**（`ac19a7a → 工作树`，Standards / Spec 各一轮）：发现与处置见证据 §9；处置后复跑 `npm test` 195/195、T0–T2 80/0/0、T3 **18/0/0**，报告与归档已更新为终稿。

**证据细节**：`evidence/11-real-model-baseline-recapture.md`（验收对照、复现命令、差异处置、引用关系与文件 sha）。
