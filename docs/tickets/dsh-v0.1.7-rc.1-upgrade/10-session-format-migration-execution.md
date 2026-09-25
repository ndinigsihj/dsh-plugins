# 10 — 会话格式迁移执行与抽样验证

**What to build:** 按 02 结论执行会话格式迁移。02 已核实：**没有面向用户的批量迁移工具（无 dry-run）**；**读开只在内存迁移、不落盘**；迁移按会话在**首次写开**时惰性发生——发布 `session.v4.jsonl.zstd` 后继（源 `session.jsonl.zstd` / `session.v3.jsonl.zstd` 保留且逐字节不变）。因此本票执行 = 逐会话写开（`sessionPersistence.open(id,'write')` / resume / 继续会话）或接受按需惰性迁移，之后抽样验证；损坏与备份形态文件按既定规则处理。记录迁移范围、失败与跳过清单、冷备保留期与丢失窗口。

**Blocked by:** 03 — 回滚资产与迁移安全网；04 — 宿主升级与两个工作 Profile 到位。（05 会话读取异步化已按 C0 ① 降级为可选、不阻塞本票；02 已完成。）

**Status:** done — 2026-09-25（用户裁决采用 **B 口径：接受按需惰性迁移** + 坏文件「跳过并登记」；全量读开分类 1579 会话、8 个代表样本写开迁移 8/8 绿、失败/跳过与仍为旧格式清单归档；**改动未提交，待用户确认后 commit**）

**施工图:** `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Implementation Decisions：会话格式迁移）；升级计划 §7 第 10 步

- [x] 迁移按 02 结论执行，范围与结果（成功/跳过/失败）有清单；机制为逐会话写开（无批量工具）— 口径 = B（按需惰性迁移）：8 个代表样本已写开迁移（8/8），其余 1571 个留「仍为旧格式清单」待新宿主 resume 时惰性迁移；清单 `evidence/10-result/10-{still-old-format,migrated-samples,skip-list}.tsv`、`10-summary.json`
- [x] 抽样会话在新宿主可打开并继续，含一个带 Subagent 的 — 8 个代表样本（v3 子代理链两级 + descriptor-v2 子代理根 + 118 附件子代理等）读开 + 写开全绿，源 sha 不变、事件数保持；子代理目录事实与 unknown-mode 处置抽查通过；app 级 preset runner 限制另记（§8）
- [x] 损坏/备份形态文件按规则处理，未阻塞迁移 — 7 个 bak/corrupt/散落文件原地跳过登记；218 个 canonical 不可读（72 descriptor-v2 + 146 其它 v0）跳过登记，且旧宿主 218/218 同样读不开（既存盲区），未阻塞样本迁移与分类
- [x] 冷备保留期与丢失窗口记录在案 — 保留期至少到新宿主稳定走过一次正式版升级；丢失窗口 = 2026-09-25T17:04:49+0800 之后写入；源代逐字节保留，迁移本身不扩大数据丢失面
- [x] 回滚边界写明：迁移后不得再用旧宿主继续同一批会话（旧宿主不支持降级读；写开后的新增事件计入丢失窗口）— **已实测**：旧宿主读 v4 共存目录报 `not found`、写开报 `uses log format v4 … reads only v3`；未迁移的 1353 可读旧格式会话旧宿主仍可用
- [x] 证据归档到本票 — `evidence/10-session-format-migration-execution.md` 及 `evidence/10-{inventory,classify,samples,result,oldhost,variants,mechanism}/` 原始产物与脚本

**范围外（本票不做）:** 回滚执行（仅准备）；会话归档整理。

---

## 验收回填（2026-09-25）

**口径**：用户裁决采用 B（接受按需惰性迁移）：不批量写开全部旧会话，只对代表样本逐会话写开验证，其余保留旧格式并留清单；坏文件规则 = 跳过并登记。探针以 0.1.7-rc.1 宿主 boot 隔离 home（sessions → 真实根符号链接），真实 profile/settings/attachments 零写入；旧宿主 = 票据 03 本地副本 0.1.5-rc.2。

**结果**：2265 文件 / 1583 canonical = 1579 id；读开可读 1361、不可读 218（旧宿主同样 218/218 失败）；8 样本写开 8/8、源 sha unchanged、事件数保持、v4 后继发布；仍为旧格式 1571（1353 可读 + 218 不可读）；跳过含 7 活写与 7 变体/散落文件。真实树事后仅新增 8 个 v4 后继与 2 个 v0 样本 lock，无删除、无源改写（活 TUI 自身写入除外）。

**移交**：app 级 runner 恢复带 preset 会话（`the one-shot runner does not compose`）属组合/部署面，归票据 12；按需迁移无需也不存在批量命令。证据细节见 `evidence/10-session-format-migration-execution.md`。

