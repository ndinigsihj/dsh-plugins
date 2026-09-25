# 票据 03 证据 — 回滚资产与迁移安全网

> 执行日期：2026-09-25（本地 +0800）　目标：在首次启动 0.1.7-rc.1 之前建立可验证退路
> 冷备根：`/Users/vito/.dsh/upgrade-backups/dsh-0.1.7-rc.1-pre-migration-20260925-113044/`
> 快照窗口：**2026-09-25T11:32:35+0800 → 11:33:12+0800**（机器可读件 `03-snapshot-window.txt`）
> 本票不改仓库代码、不动部署位、不迁移会话；真实 `~/.dsh/sessions` 未被本票的备份/演练动作写入（本会话自身的活写除外，见 §4.4）。

## 1. 结论（对照票面验收）

| # | 验收项 | 结果 | 依据 |
| --- | --- | --- | --- |
| 1 | 旧版本包本地副本可用本地入口启动 | **PASS** | `host-package/dsh-0.1.5-rc.2/`（25381 文件 / 279M，与源 `diff -rq` 一致）；`--version` = `0.1.5-rc.2`；真实 profile `--dump-config` exit 0 |
| 2 | 冷备位于会话目录之外，含文件数与逐文件指纹 | **PASS** | 备份根在 `~/.dsh/upgrade-backups/`（sessions 目录之外）；5 份 manifest（sha256 见 §3.4） |
| 3 | 还原演练：scratch 用旧宿主打开代表会话（含带 Subagent 的） | **PASS** | 8 个代表会话全部打开成功（§4.2），含 v3 子代理链与带 118 个附件引用的子代理会话 |
| 4 | 附件与 storages 按 02 结论执行并记录取舍 | **PASS** | 附件整树入冷备（排除派生面）；storages 不入恢复面（§3.3） |
| 5 | 丢失窗口、快照时间点与保留期写入票面 | **PASS** | 见票面「验收回填」与本文 §6 |
| 6 | 备份期间无并发写者；演练不触碰真实会话目录 | **PASS** | 窗口内唯一在场进程是本 TUI（PID 23667）且**零写入**（before/after manifest 逐字节一致）；演练前后真实树 0 个快照期路径被非活会话改动/删除（活会话豁免集由 `lsof` 动态取得；6 个快照后新增路径属丢失窗口，非演练写入，§4.4） |

## 2. 旧版本包本地副本（回滚入口）

| 项 | 值 |
| --- | --- |
| 源 | `/Users/vito/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh`（`@deepseek-ai/dsh@0.1.5-rc.2`） |
| 副本 | `<备份根>/host-package/dsh-0.1.5-rc.2/`（含嵌套 `node_modules`，自包含） |
| 规模/一致性 | 25381 文件 / 279M；`diff -rq <源> <副本>` 输出为空（逐字节一致） |
| 版本核验 | `DSH_HOME=<scratch> node <副本>/lib/bin.js --version` → `0.1.5-rc.2`；`DSH_CLI=<副本>/lib/bin.js ~/.dsh/bin/dsh --version` → `0.1.5-rc.2` |
| 真实启动核验 | `DSH_HOME=<scratch-home> node --expose-internals <副本>/lib/bin.js --profile drill-base --dump-config` → exit 0 / 332 行（`03-host-package-boot-dump.yml`） |

本地入口（两种等价形式，回滚时用其一）：

```bash
# 1) 直接入口（不依赖 ~/.dsh/bin/dsh 现状）
DSH_HOME="$HOME/.dsh" node --expose-internals \
  "/Users/vito/.dsh/upgrade-backups/dsh-0.1.7-rc.1-pre-migration-20260925-113044/host-package/dsh-0.1.5-rc.2/lib/bin.js" --version
# 2) 走既有 wrapper + DSH_CLI 覆盖
DSH_CLI="/Users/vito/.dsh/upgrade-backups/dsh-0.1.7-rc.1-pre-migration-20260925-113044/host-package/dsh-0.1.5-rc.2/lib/bin.js" \
  ~/.dsh/bin/dsh --version
```

`drill-base` 最小 profile 结构（演练用，非部署位）：

```
<scratch-home>/profiles/drill-base/
├── package.json        # {"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base"]}}}
├── cordis.patch.yml    # []
├── cordis.yml          # 空 entry list
└── node_modules -> <副本>/node_modules
```

## 3. 静默窗口与冷备

### 3.1 写者处理（用户裁决：先停 mumu TUI，再冷备）

- 初始侦察（2026-09-25 00:04 前后）发现两个活宿主：PID 23667（本 TUI，`dsh-plugins`）与 PID 4988（`~/data/dev/mumu` TUI，20 秒窗口内持续写 2 个会话）。
- 用户裁决「先停 mumu TUI 再冷备」。冷备时（11:32）复检：`lsof -c node -a -d cwd` 只剩 PID 23667；mumu 宿主的最后一次写入为 11:24:35（归档实据 `03-mumu-last-write.tsv`：冷备副本保留 mtime，列出 11:00 后被写的 6 个文件，其中 mumu 侧最后一条即 11:24:35）。
- 本 TUI 在单条冷备命令内不产生会话事件写入；窗口内 before/after manifest **逐字节一致**（零写入），因此备份期间无任何写者落盘（`03-writers-during-backup.txt`、`03-open-session-locks-during-backup.txt`、`03-cold-backup-log.txt`）。
- 附带事实：窗口内有 20 个新会话是暂停期间（00:04→11:32）由 mumu 宿主产生的，已被本快照覆盖。

### 3.2 冷备范围与校验（一次通过，`03-cold-backup-log.txt`）

| 面 | 副本位置 | 文件数 | 字节 | 校验 |
| --- | --- | --- | --- | --- |
| `~/.dsh/sessions/**` | `<备份根>/sessions/` | 2171（含 1561 目录） | 678,425,195（647.0 MiB） | 源窗口内 before==after；副本==源；全部 1536 个日志 `zstd -t` 通过 |
| `~/.dsh/attachments/**`（排除 `request-images/`、`tmp/`） | `<备份根>/attachments/` | 3302（objects） | 1,305,205,875（1244.7 MiB） | 同上（按排除面过滤后比对） |
| `~/.dsh/settings.yaml` | `<备份根>/config/settings.yaml` | 1 | 4,220 | 源窗口内不变；副本==源 |
| `~/.dsh/.agent-presets/**` | `<备份根>/config/agent-presets/` | 10（+1 symlink） | 67,364 | 同上 |
| `~/.dsh/profiles/**`（排除 `node_modules`） | `<备份根>/config/profiles/` | 33 | 70,287 | 同上 |

sessions 内容构成：`v0=908`（`session.jsonl.zstd`）+ `v3=628`（`session.v3.jsonl.zstd`）+ `session.lock=628` + 遗留变体 7（6 个 `.bak*/.corrupt*` + `xxx.sh`）。

### 3.3 附件 / storages 取舍（按 02 结论执行）

- **附件属于恢复面**：整树 `attachments/v1/objects` 入冷备；`request-images/`（99 文件 / 26,113,746 字节，派生图）与 `tmp/`（0 文件）排除。演练验证：被打开会话引用的 118 个 attachmentId 全部在还原树中命中（§4.3）。
- **storages 不属于恢复面**：`~/.dsh/storages`（14M）是投影缓存，会话日志才是真源，未入冷备；旧宿主会自行重建（02 结论 ⑦）。
- `session.lock` 是 `flock(2)` 租约占位文件（0 字节，进程退出即释放），随冷备原样保留；演练证明带锁副本可读。

### 3.4 指纹清单（副本内，逐文件）

| 清单 | 行数语义 | sha256 |
| --- | --- | --- |
| `<备份根>/meta/sessions.dst.tsv` | 2171 文件 + 1561 目录，`sha256<TAB>size<TAB>relpath` | `8d46badf6e18b29df26eed688575e29eeb9d07d60a7c4c2fcca67af6050045bc` |
| `<备份根>/meta/attachments.dst.tsv` | 3302 文件 + 259 目录 | `caf59eebe2790c94310c8ab682155bcca4c0674a84e058e561fe58c14b5ba886` |
| `<备份根>/meta/settings.dst.tsv` | 1 文件 | `645be99425e6fedecab6aab3afe0757239549755b1b6487e27aa31f9bd7216b6` |
| `<备份根>/meta/agent-presets.dst.tsv` | 10 文件 + 1 symlink | `a39d60fe57aa63e9d2344a422e72da7a95969ac1c1c8498ceb01a4d00533a2b9` |
| `<备份根>/meta/profiles.dst.tsv` | 33 文件（排除 node_modules） | `65095366735988b54bf12613e059bd6c26b56d267d33afb63c04fcde7db5c17b` |

摘要另存 `03-manifest-summary.txt`；`03-excluded-surfaces.txt` 记录被排除面规模。

## 4. 还原演练（scratch，旧宿主 0.1.5-rc.2）

### 4.1 方法

把冷备 **sessions + attachments 整树**还原到 `/tmp/dsh-t03-drill-20260925-114258/home`（再与备份 manifest 比对，逐字节一致），在该 scratch home 上跑本地副本的读路径探针 `03-probe-read.mjs`（`ctx.sessionQuery.readSession`，dsh-base 组合），全程 `DSH_HOME` 指向 scratch。脚本 `03-drill.sh`，逐会话结果归档 `03-drill-open-results.json`。最终运行 2026-09-25 12:08:09→12:08:56，`fail=0`（`03-drill-log.txt`）；真实树"未被触碰"的豁免集由 `lsof +D` 动态取当时持有 `session.lock` 的活会话目录，不硬编码具体会话路径。

### 4.2 代表会话打开结果（全部成功）

| 会话 | 形态 | 事件数 | subagent 事件 | 附件引用 | 父会话 |
| --- | --- | --- | --- | --- | --- |
| `session-f9c1b3b6-…` | v3 根，带子代理 | 641 | 11 | 0 | – |
| `06bb5ecf-…` | v3 子代理（depth 1） | 63 | 3 | 0 | f9c1b3b6 |
| `c36a2dad-…` | v3 子代理（depth 3） | 27 | 2 | 0 | b424f25c |
| `session-32c61738-…` | v0 根（子代理父级，17542 行） | 3359 | 0（v0 只记 `agent/inbox/spliced`） | 0 | – |
| `session-296c9f42-…` | v0 最大日志（63055 行 / 18MB） | 13870 | 0 | 0 | session-73dfaa4b |
| `session-ba1aed88-…` | v3 | 1143 | 1 | 0 | – |
| `session-66e1fe6c-…` | v3（快照时刻的本会话前缀） | 257 | 1 | 0 | – |
| `6d4bc58f-…` | v3 子代理 + 附件 | 929 | 2 | 118 | session-15fb0ea9 |

要点：

- **v3 读开**：返回 `version=3`，`events = 文件行数 - 1`；源文件未改写、不产生后继。
- **v0 读开**：内存迁移为 `version=3` 视图并合并流式 chunk 事件（17542 行 → 3359 个逻辑事件；63055 → 13870），源文件不动、不发布后继（与 C0 ③ 对 0.1.7 的读开口径一致，旧宿主同样如此）。
- v0 子代理链路的父/子结构由子会话 header 的 `parentSession` 佐证：`b4cfcbf7`（父 `session-32c61738`）在冷备中存在且 header 指回父会话（该子日志本身属 §5.1 盲区）。

### 4.3 附件链接

被打开会话去重后共 **118 个 attachmentId 引用，0 缺失**；全部命中还原树的 `attachments/v1/objects/<2hex>/<hash>`。

### 4.4 只读性证明

- scratch 还原树在全部打开动作前后 manifest **逐字节一致**（读开不写 scratch）。
- 真实 `~/.dsh/sessions` 在演练前后对比（`03-drill-log.txt` 末段）：`changed=1 / removed=0 / added-after-snapshot=6`，豁免集 = 当时持有 `session.lock` 的 5 个活会话目录（含本会话）。唯一变化是活会话自身；6 个新增路径是两条评审子代理会话（快照之后由本 TUI 创建，属丢失窗口内容，非演练写入）；**0 个快照期路径被非活会话改动或删除**。真实 `attachments/` 与 `profiles/` 完全不变。

### 4.5 演练运行史（全部归档）

| 运行 | 时间 | 结果 | 说明 |
| --- | --- | --- | --- |
| run 1 | 11:35:47 | 失败 | 代表集曾含 `b4cfcbf7`（descriptor v2），旧宿主拒绝打开；据此把该既存缺口改为独立批量核查，不再混进代表会话 |
| run 2 | 11:42:58 → 11:44:40 | 首次 `fail=1` → 修正后 `fail=0` | 对 v0 根断言 `subagentEvents ≥ 1` 过紧：v0 不写 `subagent/catalog`，只写 `agent/inbox/spliced`；修正口径后通过 |
| run 3 | 12:06:17 | `fail=1` | 该轮把"快照后新增路径"误判为失败（当时两条评审子代理会话刚创建）；改为：只有快照期已存在路径被改动/删除才算失败，新增路径计为丢失窗口 |
| run 4（最终） | 12:08:09 → 12:08:56 | **`fail=0`** | `03-drill-log.txt`（含逐会话 PASS） |

非最终运行留档：`03-drill-run-1-113547-log.txt`、`03-drill-run-2-114440-log.txt`、`03-drill-run-3-120606-log.txt`。

## 5. 本票发现（供后续票）

### 5.1 旧宿主读不了的 72 个 v0 子代理会话（**既存**，非本票引入）

- 语料中 72 个会话含 `subagent/descriptor` 的 `data.version: 2`，全部是 `session.jsonl.zstd`（v0）子代理会话，创建于 2026-09-10 宿主升级（0.1.1-rc.2 → 0.1.5-rc.1）之前。
- 旧宿主 v0→v1 迁移代码要求 descriptor `version === 3`（`dsh-session-format-v0-to-v1/lib/index.js:1584-1587`；`dsh-session-persistence-jsonl/lib/worker.cjs` 同码），遇到 v2 抛 `unsupported descriptor version 2`。
- 批量实测：**72/72 打开失败，错误类唯一**（`03-descriptor-v2-open-attempt.summary.json`、`03-descriptor-v2-ids.txt`、`03-descriptor-v2-sessions.tsv`）。
- 冷备本身完整（72 个日志逐字节在备份内）；这是**回滚面的既存缺口**：即便不走迁移，旧宿主也读不了这批历史。票据 10 的「损坏/备份形态处理规则」需覆盖它们；是否可由 0.1.7 读回（其格式 catalog 不同）本票未测，留待迁移票取证。

### 5.2 其它

- 本机 `sessions` 语料在快照时点已从 02 取证时的 1491 个日志增长到 1536 个（暂停期间 mumu 宿主持续工作）；本快照包含 11:32:35 前的全部内容。
- 冷备 `profiles/**` 排除了 `node_modules`（100 个目录）；profile 本体（patch/package/cordis）齐全，回滚后按需 `npm i`/重建依赖即可。
- `.agent-presets` 旧目录形态虽在 0.1.7 不再加载（C0 ④），仍按计划入冷备，供回滚到 0.1.5-rc.2 使用。

## 6. 丢失窗口与保留期（票面口径）

- **快照时间点**：2026-09-25T11:32:35+0800（完成于 11:33:12+0800）。回滚只恢复到该时刻。
- **丢失窗口**：快照之后写入的一切——包括既有会话在快照后的新增事件（含本会话）与之后新建的会话。迁移后的新增事件同样计入丢失窗口（计划 §7 第 13 步的保守口径）。
- **保留期**：**至少到新宿主稳定走过一次正式版升级**。在此之前不得删除该备份根；到期处置需另行确认。

## 7. 复现方法

```bash
# 冷备（仅在再次批准的静默窗口内执行；重取快照请写入新的空根目录——脚本不做 --delete，
# 向既有根重跑会因残留文件在一致性检查处失败）
bash docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/03-cold-backup.sh <新的备份根>
# 还原演练（读备份 + 写 /tmp scratch；可指定 DRILL_ROOT 复用）
DRILL_ROOT=/tmp/dsh-t03-drill-<ts> \
  bash docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/03-drill.sh <备份根>
```

脚本依赖 `<备份根>/host-package/dsh-0.1.5-rc.2`、`<备份根>/meta/{manifest,probe-read,probe-read-many,descriptor-v2-ids}`（均为本次落盘的同源副本）。`03-drill.sh` 的活写者豁免集由 `lsof` 动态取得，不硬编码会话路径；scratch 与运行方式本身不写入真实树。

## 8. 证据文件索引

| 文件 | 内容 |
| --- | --- |
| `03-manifest-summary.txt` | 备份根、快照窗口、manifest sha256、各面计数 |
| `03-snapshot-window.txt` | 快照起止时间（机器可读） |
| `03-cold-backup.sh` / `03-cold-backup-log.txt` | 冷备脚本与逐项 PASS 日志（含 zstd 完整性） |
| `03-manifest.mjs` | 逐文件指纹/清单生成器 |
| `03-writers-during-backup.txt` / `03-open-session-locks-during-backup.txt` | 备份窗口写者快照 |
| `03-excluded-surfaces.txt` | 被排除面规模（request-images/tmp/node_modules/storages） |
| `03-host-package-boot-dump.yml` | 本地副本真实启动（`--dump-config`）输出 |
| `03-drill.sh` / `03-drill-log.txt` | 还原演练脚本与全部 PASS/RECORD 日志 |
| `03-probe-read.mjs` / `03-probe-read-many.mjs` | 单会话 / 批量读开探针 |
| `03-drill-open-results.json` | 8 个代表会话的读开结果（version/events/subagent/attachments） |
| `03-drill-run-*-log.txt` | 非最终运行的失败留档与修正过程（§4.5） |
| `03-mumu-last-write.tsv` | 冷备副本 mtime：11:00 后最后写入的文件（mumu 侧 11:24:35） |
| `03-descriptor-v2-ids.txt` / `03-descriptor-v2-sessions.tsv` | 72 个既存不可读 v0 子代理会话清单 |
| `03-descriptor-v2-open-attempt.summary.json` | 72/72 失败与错误类 |

## 9. 代码评审发现与处置（2026-09-25，双轴只读评审）

对本票改动（票据行 + `03-*` 证据/脚本）跑了 Standards / Spec 双轴只读评审；发现与处置如下。

| 轴 | 发现 | 处置 |
| --- | --- | --- |
| Standards | `03-drill.sh` 把本会话路径硬编码为唯一豁免（"never hard-code to pass"） | **已修**：豁免集改为 `lsof +D` 动态取当前持有 `session.lock` 的活会话目录（最终运行生效） |
| Standards | `03-drill-log.txt` 记到过 `fail=1` 运行且早期运行未归档，与"全绿"矛盾 | **已修**：§4.5 运行史 + 三个非最终运行日志全部归档；最终 `03-drill-log.txt` 含逐会话 PASS |
| Standards | `assert_open` 5 参数、cold-backup 面循环重复、`man()` 命名、`rsync` 无 `--delete` 非幂等 | `assert_open` 已改单 spec 参数；`03-cold-backup.sh` **保持 as-run 原文**以保证据保真（重复属一次性归档脚本的取舍），非幂等风险已在 §7 写明（重取快照用新根目录，向既有根重跑会在一致性检查处失败） |
| Spec | "静默所有写者"只部分达成：本 TUI 无法在会话内关闭，备份期间仍持 5 个 `session.lock` | 票面/证据按事实表述：判据是"窗口内**无写者落盘**"（before/after 逐字节一致），不是"无写者进程在场"；mumu 宿主已按裁决先行关闭 |
| Spec | "全绿"与日志矛盾、早期失败未披露 | **已修**：§4.5 披露全部运行与修正；最终运行 clean |
| Spec | mumu 11:24:35 最后写入无实据 | **已补**：`03-mumu-last-write.tsv`（来自冷备副本 mtime） |
| Spec | 工作区还混有票据 14 的未提交改动 | 非本票改动，未触碰；本票证据只覆盖 `03-*` 与 plan §7 第 2 步脚注 |

