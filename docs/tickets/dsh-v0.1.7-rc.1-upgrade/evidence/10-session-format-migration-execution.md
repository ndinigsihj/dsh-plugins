# 票据 10 证据 — 会话格式迁移执行与抽样验证

> 日期：2026-09-25　宿主：`@deepseek-ai/dsh@0.1.7-rc.1`（v24 全局；旧宿主 = 票据 03 本地副本 0.1.5-rc.2）
> 执行口径（用户裁决）：**B — 接受按需惰性迁移**；只对代表样本逐会话写开验证，其余保留旧格式并留清单。
> 坏文件规则（用户裁决）：**跳过并登记**——不改名、不隔离、不删除，不阻断其余操作。

## 1. 结论摘要

- 02 结论在本轮真实树上再次成立：**无批量工具、无 dry-run**；迁移只发生在逐会话**写开**时，发布 `session.v4.jsonl.zstd` 后继，源 `session.jsonl.zstd` / `session.v3.jsonl.zstd` **逐字节不变**。读开只在内存迁移、零落盘（本次全量读开分类后真实树文件集在非活会话面逐项未变）。
- **范围**：`~/.dsh/sessions` 共 2265 文件 / **1583 个 canonical 日志 = 1579 个会话 id**（908 v0 + 675 v3；4 个 id 同目录同时留 v0/v3 两代，宿主选取 v3）。另有 675 个 `session.lock` 与 **7 个非 canonical 文件**（6 个 bak/corrupt 变体 + 1 个散落 `xxx.sh`）。
- **结果（B 口径）**：**8 个代表会话已完成写开迁移（8/8 ok，v4 后继发布、源 sha 不变、事件数保持）**；其余 **1571 个会话仍为旧格式**（可选迁移面：1353 可读 + 218 既存不可读），清单见 §5。
- **失败/跳过**：218 个 canonical 日志在新宿主不可读（72 个 descriptor-v2 + 146 个其它 v0 结构问题），**同一 218 个在旧宿主也 100% 读不开（218/218）**→ 属既存盲区而非迁移回归；7 个活写会话在盘点时被跳过；7 个变体文件按规则跳过。
- **回滚边界已实测坐实**（回答计划 §8 第 15 条）：迁移后旧宿主读这些会话报 `session ... not found`，直接写开报 `uses log format v4, but this harness reads only v3`——**即使源文件仍在，也不得再用旧宿主继续同一批会话**。证据：`10-samples/10-oldhost-after.json`（真实样本）、`10-oldhost/10-oldhost-{read,write}-coexist.json`（scratch 共存目录）。
- **变体共存不阻塞**：scratch 中把 3 个带 bak/corrupt 变体的真实目录整目录复制后迁移——可读 canonical（`ae655a75`）成功发布 v4 且变体文件 sha 未变；不可读 canonical 干净失败；变体从未被选取或改写。证据：`10-variants/10-variant-{read,write}.json`、`10-variant-summary.txt`。

## 2. 方法与安全边界

- 探针 `10-probe-open.mjs`：以 `@deepseek-ai/dsh-app-boot`（**从宿主 anchor 解析**，`createRequire(anchor)`）boot 一个临时 home 里的 `dsh-base` 组合 profile；`T10_HOME/home/sessions` 是指向真实 `~/.dsh/sessions` 的**符号链接**，因此持久化后端操作的是真实产物，而真实 profile / settings / attachments / storages **零写入**。
- 隔离 home 由 `10-make-probe-home.sh` 生成（`/tmp/dsh-t10-run/home`）；profile 只含 `@deepseek-ai/dsh-base`，与 C0 fact ③ 的探针同构。
- 读开分类 = `ctx.sessionQuery.readSession(id)`；写开 = `ctx.sessionPersistence.open(id,'write')` + `close()`（即 headless 采纳/resume、TUI 继续会话所用的同一条持久化接缝）。
- 活动写者由内核 `flock(2)` 排除（跨进程 scratch 实测：第二个写开报 `is already owned by an active write handle`，5 ms 失败、不落盘；`10-mechanism/10-flock-{contention.json,holder.txt}`），盘点另用 `lsof` 快照登记。
- 真实树事后比对：迁移只新增 8 个 `session.v4.jsonl.zstd` 与 2 个 v0 样本的 `session.lock`（6 个 v3 样本 lock mtime 更新）；无删除；唯一变更的 canonical 源文件是两个**活 TUI** 自己的会话（本会话 `session-ad44082b` 与 mumu `session-00f68804`）。见 `10-result/10-tree-diff-after-samples.txt`。

## 3. 迁移范围（Phase A 盘点 + Phase B 读开分类）

| 面 | 数量 | 说明 |
| --- | --- | --- |
| canonical 日志 | 1583 | 908 `session.jsonl.zstd`(v0) + 675 `session.v3.jsonl.zstd`(v3) |
| 会话 id | 1579 | 4 个目录同时存在 v0+v3 两代 |
| 读开可读 | 1361 | 读开均为内存迁移为 version 4 |
| 读开不可读 | 218 | 72 descriptor-v2 + 146 其它 v0 结构拒绝（全部 v0） |
| 旧宿主对照 | 218/218 同样失败 | 既存盲区，见 `10-classify/10-oldhost-unreadable-compare.json` |
| 盘点时活写 | 7 个会话 | 2 个旧宿主 TUI 持有（本 TUI、mumu TUI） |

证据：`10-inventory/{manifest,canonical,variants}.tsv`、`10-inventory/live-writers.txt`、`10-classify/10-read-classification.json`。
读开阶段真实树零写入：非活会话的路径/大小/mtime 与盘点 manifest 逐项一致（活 TUI 自身写入除外）。

## 4. 样本迁移与验证（8 个代表会话）

样本沿用票据 03 还原演练的 8 个代表会话（含 v0 根与最大日志、v3 子代理链两级、带 118 个附件引用的子代理会话）：

| 会话 id | 源格式 | 迁移前事件 | 写开 | 源 sha | 读回版本/事件 | v4 大小 |
| --- | --- | --- | --- | --- | --- | --- |
| `session-f9c1b3b6…`（子代理根） | v3 | 641 | ok | unchanged | v4 / 641 | 511205 |
| `06bb5ecf…`（depth-1 子代理） | v3 | 63 | ok | unchanged | v4 / 63 | 56392 |
| `c36a2dad…`（depth-3 子代理） | v3 | 27 | ok | unchanged | v4 / 27 | 41909 |
| `session-32c61738…`（v0 根，含 descriptor-v2 子代理） | v0 | 3365 | ok | unchanged | v4 / 3365 | 2306742 |
| `session-296c9f42…`（v0 最大日志） | v0 | 13870 | ok | unchanged | v4 / 13870 | 7229088 |
| `session-ba1aed88…` | v3 | 1143 | ok | unchanged | v4 / 1143 | 1034106 |
| `session-66e1fe6c…` | v3 | 712 | ok | unchanged | v4 / 712 | 725113 |
| `6d4bc58f…`（118 附件引用的子代理） | v3 | 929 | ok | unchanged | v4 / 929 | 776351 |

结构与迁移语义抽查（可由 `10-verify-structure.sh` + 归档输出 `10-samples/10-structural-checks.txt` 逐项复现）：

- 子代理目录事实：`session-f9c1b3b6` 的 v4 后继含 10 条 `subagent/catalog` 记录（`continuable` + label、`one-shot`），子 id 与创建时间齐全。
- descriptor-v2 子代理：`session-32c61738` 的 v4 对 72 盲区中的子 `b4cfcbf7…` 落成 version-1 `unknown` 成员（不臆造 mode/label），父迁移不被坏子日志阻塞——与 v3→v4 README 的规则一致。
- 附件面：`6d4bc58f` 的 v4 保留 **118/118** 个附件 id（与源相同）。
- 旧宿主边界（实测）：迁移后旧宿主读 8/8 报 `session ... not found`（`10-samples/10-oldhost-after.json`）；scratch 里对共存目录写开报 `uses log format v4 … reads only v3`（`10-oldhost/10-oldhost-write-coexist.json`）。

证据：`10-samples/{10-sample-ids.txt,10-sample-sources.tsv,10-sample-write.json,10-sample-after.tsv,10-sample-verify.json,10-sample-summary.json,10-oldhost-after.json}`。

## 5. 失败与跳过清单（完整清单在 `10-result/10-skip-list.tsv`）

| 类别 | 数量 | 处置 |
| --- | --- | --- |
| 写开迁移成功 | 8 | 样本，已发布 v4 后继 |
| 仍为旧格式（按需迁移面） | 1571 | 1353 可读（684 v0 + 669 v3 选取）+ 218 不可读；清单 `10-result/10-still-old-format.tsv` |
| canonical 不可读—descriptor-v2 | 72 | 跳过登记；0.1.7 的 v0→v1 仍拒绝 v2，旧宿主同样拒绝（票据 03 既存缺口） |
| canonical 不可读—其它 v0 | 146 | 跳过登记；错误族：`assistant/message … does not cite its complete v1 chunk attempt`、`format v2 surface …`、`cannot safely transform unclassified message source`、v0→v1 拒绝等；旧宿主 100% 同样失败 |
| 盘点时活写 | 7 | 跳过；由 `flock` 自然排除，未写入 |
| 变体/散落文件 | 7 | 6 个 `session.jsonl.zstd.{bak,bak2,bak3,bak-…,corrupt-…,bak-polluted-splice}` + `--Users-vito-data-dev-dsh-tui--/xxx.sh`；**原地保留、未参与迁移、未改名** |
| 既有备份目录 | 3 | `upgrade-backups/` 下 11:30 / 17:04 根与更早根保留，未触碰 |

变体共存的正向验证（scratch，`10-variants/`）：整目录复制 3 个含变体的真实会话目录后迁移——`ae655a75`（canonical 可读 + 2 变体）读开 v4/2810 events、写开成功发布 v4，2 个变体 sha 未变；`407e40ff` / `53504eac`（canonical 本身不可读）干净失败，3 个变体同样未变。即「变体存在不阻塞 canonical 迁移，坏 canonical 也不改写/不阻塞其它会话」。

## 6. 冷备保留期与丢失窗口

- **保留期**：至少到迁移后的宿主稳定走过一次正式版升级；在此之前不删任何 `~/.dsh/upgrade-backups/**`。
  - 回滚基准：`dsh-0.1.7-rc.1-pre-migration-20260925-113044/`（快照 2026-09-25T11:32:35+0800）
  - 最新自包含面：`dsh-0.1.7-rc.1-pre-first-start-20260925-170449/`（快照 2026-09-25T17:04:49→17:05:30，含 host 包副本）
- **丢失窗口**：**2026-09-25T17:04:49+0800 之后写入的一切**（既有会话新增事件与本会话等新会话），回滚到旧宿主时只恢复到快照时刻。
- 本次迁移**不扩大数据丢失面**：源代文件逐字节保留；v4 后继是新增文件。但它扩大**旧宿主不可续用面**（见 §7）。

## 7. 回滚边界（实测，非推断）

1. 迁移后**不得再用旧宿主（0.1.5-rc.2）继续同一批会话**：旧宿主读报 `not found`，写开报 `uses log format v4, but this harness reads only v3`；源 v0/v3 虽在，旧宿主不会选取。
2. 未迁移的 1353 个可读旧格式会话仍可由旧宿主正常使用（本轮 B 口径保留了这块）。
3. 回滚到 0.1.5-rc.2 时：用冷备恢复快照前历史；快照后的新增/已迁移会话不可由旧宿主继续——这是 Q15 已接受的代价。
4. 旧宿主与 v4 共存目录的选取行为（计划 §8 第 15 条）**已补实测**：结果为保守口径（不可选取），无需再假设。

## 8. 未覆盖 / 移交

- **app 级（runner）恢复带 preset 的会话**：0.1.7 的 stock headless one-shot runner 明确拒绝 `agent preset …, which the one-shot runner does not compose`（minimal-plus 载体已在票据 07 生成并可装入隔离 home；历史 `liangshen-bash` 等旧 preset 已不存在）。这是组合/部署面问题，归票据 12 的宿主日常入口与部署位落地，不是格式迁移失败；本票对"继续"的验证落在写开接缝（C0 ③ 与上游 README 明确的同一接缝）。3 次尝试（副本、隔离 home、exit 1、无 v4 后继、源 sha 不变）留档：`10-samples/10-app-resume-attempt.txt`。
- 按需迁移的实际触发者：用户/工具在未来用 **0.1.7+ 宿主** resume 某个旧格式会话时，该会话自动发布 v4 后继；不需要也不存在批量命令。

## 9. 复现命令与证据索引

宿主 anchor 由 `10-lib.sh` 从 `npm prefix -g` 推导（`T10_ANCHOR` 可覆盖；机器本机默认 `/Users/vito/.nvm/.../v24.21.0/...`）。

```sh
EV=docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence
bash   "$EV/10-make-probe-home.sh" /tmp/dsh-t10-run "$HOME/.dsh/sessions"
bash   "$EV/10-session-inventory.sh" "$EV/10-inventory" "$HOME/.dsh/sessions"
CANONICAL_TSV="$EV/10-inventory/canonical.tsv" \
  bash "$EV/10-run-read-classify.sh" "$EV/10-classify" /tmp/dsh-t10-run 150
bash   "$EV/10-run-sample-migration.sh" "$EV/10-samples" /tmp/dsh-t10-run \
  "$EV/10-samples/10-sample-ids.txt" "$EV/10-inventory/canonical.tsv"
SESSIONS_DIR="$HOME/.dsh/sessions" node "$EV/10-build-lists.mjs" \
  "$EV/10-inventory" "$EV/10-classify/10-read-classification.json" \
  "$EV/10-samples/10-sample-ids.txt" "$EV/10-result"
SESSIONS_DIR="$HOME/.dsh/sessions" bash "$EV/10-verify-structure.sh" \
  "$EV/10-samples/10-structural-checks.txt"
```

> 评审后对脚本做过不改语义的整理（anchor 由 `10-lib.sh` 统一推导、probe 调用抽成 `t10_probe`、前后态 TSV 幂等截断），并在 scratch 上整体复跑验证通过；归档产物由同逻辑版本生成。

| 文件 | 内容 |
| --- | --- |
| `10-probe-open.mjs` | 读开/写开探针（app-boot 从 anchor 解析；临时 home sessions → 真实根） |
| `10-lib.sh` | anchor 推导与 `t10_probe` 运行壳 |
| `10-make-probe-home.sh` | 隔离 probe home 生成 |
| `10-session-inventory.sh` | 只读盘点：manifest / canonical / variants / live-writers |
| `10-run-read-classify.sh` | 全量读开分类（分块；可并行执行 chunks） |
| `10-run-sample-migration.sh` | 样本写开迁移 + 源 sha + 读回验证 |
| `10-build-lists.mjs` | 生成 still-old / selected-v4 / skip 清单与 summary |
| `10-verify-structure.sh` | 迁移后 v4 结构只读校验（事件/子代理目录/附件引用） |
| `10-inventory/`、`10-classify/`、`10-samples/`、`10-result/` | 各阶段原始产物 |
| `10-oldhost/` | 旧宿主共存目录读/写开实测 |
| `10-variants/` | 变体共存（canonical + bak/corrupt）迁移实测 |
| `10-mechanism/` | 跨进程 flock 互斥实测 |

## 10. 评审回填（2026-09-25，两轴只读评审）

- **Standards 轴**：硬项 = 生成代映射跨 3 处重复、脚本内 TSV 解析重复、anchor 默认硬编码、临时目录未清理；判定项 = `migratedSamples` 命名、单字母变量、generation 原语。
- **Spec 轴**：3 项证据缺口 = 旧宿主"写开"实测只有 scratch 未归档、app 级继续无成功证据且引用未归档 /tmp 文件、v4 结构抽查（118 附件 / 子代理目录 / unknown-mode）不可由归档复现；另指出「变体共存不阻塞迁移」未真正行使。
- **已修**：抽 `10-lib.sh`（anchor 推导 + `t10_probe`）并去掉重复 case/环境前缀；前后态 TSV 幂等截断；`10-build-lists.mjs` 更名 `selectedV4`、目录自建；归档 `10-oldhost/`、`10-variants/`（变体共存的读写正/负例）、`10-mechanism/`（flock）、`10-samples/10-{structural-checks.txt,app-resume-attempt.txt}` 并新增 `10-verify-structure.sh`；清理 `/tmp/dsh-t10-*` 临时目录。整理后的脚本已在 scratch 端到端复跑，迁移数据未受影响。
- **未改**：app 级 runner 恢复带 preset 会话仍不可达（stock runner 限制，归票据 12）；B 口径下 1571 个会话留待按需迁移是用户裁决本身。
