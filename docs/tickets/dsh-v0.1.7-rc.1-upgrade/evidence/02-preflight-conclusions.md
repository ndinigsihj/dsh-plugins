# 02 — 前置取证结论（C0，0.1.7-rc.1）

> 日期：2026-09-24　执行方式：临时前缀安装 + 独立 npm cache；真实 `~/.dsh` 零写入（配置面逐字节一致）
> 目标版本：`@deepseek-ai/dsh@0.1.7-rc.1`（npm 精确版本，非 `next` 浮动；当日无 0.1.7 正式版）
> 临时前缀：`/tmp/dsh-c0-20260924-152002`（可复现脚本见同目录 `02-preflight-repro.sh`）

## 1. 六项事实（另有附件/storages 一项）

| # | 事实 | 结论（第一手） | 证据 |
| --- | --- | --- | --- |
| ① | 异步替代接口签名 | rc.1 的 `eventAt` / `snapshotEvents` / `ownEvents` 与 0.1.5-rc.2 **类型签名逐字相同**，仅新增 `@deprecated`；上游政策"存量可暂不迁移、禁止新增同步调用"。异步替代面是 `ctx.sessionQuery`（`@deepseek-ai/dsh-session-query@0.1.7-rc.1`，由 dsh-base 默认挂载）：`readSession(id): Promise<SessionLogSnapshot>`、`listSessions(signal?): Promise<SessionRecord[]>`、`observeSession(id, opts?): Promise<SessionObservation>`、`readEvent(req, signal?): Promise<SessionEventWindow>` 等。**宿主升级没有签名破坏，迁移是可选结构性改造** | `02-preflight-signatures.txt` |
| ② | 批量迁移工具 | **不存在**。0.1.7-rc.1 全树只有 3 个包暴露 bin（cordis/dsh/libreoffice-kit），CLI 唯一子命令是 `plugin`，无 session/migrate 命令；迁移由 `dsh-session-format-catalog` 的 v0→…→v4 链在**会话打开时惰性执行**，是存储内部行为 | `02-preflight-cli-and-migration.txt` |
| ③ | 旧格式会话读写行为 | **读开**（`sessionQuery.readSession`）：内存迁移，旧文件逐字节不变、不产生新文件。**写开**（`sessionPersistence.open(id,'write')` / headless 采纳）：发布 `session.v4.jsonl.zstd` 后继 + `session.lock`，**源文件保留且逐字节不变**（非原地改写）；v3 迁移后 6 个事件逐项保留，v0 同样实测 | `02-preflight-session-rw.txt` |
| ④ | 旧目录 Preset | **不再加载**。`$DSH_HOME/.agent-presets/<id>/` 无任何代码引用（全树 grep 仅命中一条迁移说明）；运行时哨兵：目录预设既不在 `agentPresets.list()`，`resolve()` 报 `Unknown agent preset`。目标载体确认为 profile/bundle 内的 `@deepseek-ai/dsh-agent-preset` 声明行 | `02-preflight-preset-probe.txt` |
| ⑤ | 0.1.5-rc.3 变更面 | 解析树 552 个包名中只有 6 个版本集合不同；rc.3 把浮动依赖（cordis 4.0.4→4.0.2、plugin-include/loader/timer、schemastery）**精确钉版**。tarball 逐文件比对：`@deepseek-ai/dsh` 与 `dsh-base` 文件清单完全一致，仅 `package.json` 的 version 与 pin 变化。**无代码差异** | `02-preflight-pkgtree-diff.txt` |
| ⑥ | 旧版本包可重取性 | **是**：`npm pack @deepseek-ai/dsh@0.1.5-rc.2` 实测成功，shasum 与 registry 元数据一致；但今天新装 rc.2 会得到"rc.2 CLI + rc.3 子包"的混合树（`^0.1.5-rc.2` 接受 rc.3）。**回滚仍以本地副本为准**，registry 只作兜底 | `02-preflight-pkgtree-diff.txt` |
| ⑦ | 附件 / storages 恢复面 | **附件属于恢复面**：1491 个真实会话日志中 181 个内嵌 `attachmentId`（去重 2795 个），全部命中 `attachments/v1/objects`；冷备需含 `attachments/`（可排除派生的 `request-images/`）。**storages 不属于**：`session_projcache` 是投影缓存，会话日志才是真源 | `02-preflight-attachments-storages.txt` |

## 2. 附带核实：`settings.yaml` 一次性导入（计划 §6 设置行引用了 C0）

安装产物 `node_modules/@deepseek-ai/dsh-settings/README.md:35` 与 `lib/index.js:343-360`：

> Once the Loader has settled every entry after Settings starts, a `settings.yaml` left in the
> harness home by earlier releases is imported once: each section is written into the entry of the
> same id (`ui-developer-tools` → `ui-settings`, `ui-onboarding` → `ui-settings-general`,
> `shell` → the platform's shell executor entry), the file is renamed to `settings.yaml.imported`
> **before the first write**, and a section the running composition rejects is logged and stays
> only in the renamed file.

→ 导入只发生一次；部分失败不会重复导入（改名先于写）。回滚必须从第 1 步备份恢复
`settings.yaml`（旧宿主不读 `settings.yaml.imported`）。

## 3. 零写入核验

前后快照对比：配置面（`settings.yaml`、`profiles/**`、`.agent-presets/**`、`bin/**`）
sha256 清单**逐字节一致**；sessions 顶层结构 28→28。全树 diff 的 35 行增量全部归属
"取证开始前就在运行的在线 TUI 宿主"（3 个会话目录、对应投影缓存、24 个被在线会话引用的附件对象）。
取证本身没有向真实 `~/.dsh` 写任何东西。方法与归属见 `02-preflight-snapshot-diff.txt`。

## 4. 对后续票的直接含义

1. **P0 阻塞解除**：C0 变绿，P0 代码迁移与 §7 第 10 步不再被"先取证"拦；但两行的内容都要按本票事实改写。
2. **会话迁移路径变了**：没有批量工具、没有 dry-run；迁移按会话在**首次写开**时发生，
   旧文件保留。执行步 = 逐会话写开（或接受按需惰性迁移）+ 抽样验证；冷备范围补上 `attachments/`。
3. **接口异步化不是"必须先做"**：rc.1 对仓库现有同步读取调用零破坏（`lib/index.ts` 14 处调用
   + 2 处类型声明，全仓库 32 行提及，含 `plugins/`、`presets/`、`gates/`）；上游只禁止新增同步调用。
   可把它降级为后续功能票的可选迁移，不再作为宿主升级前置。
4. **Preset 载体是硬切换**：目录形态已死，声明行产物生成器（含 dry-run）成为迁移第一工作项。
5. **回滚口径收紧**：registry 上的 rc.2 已不能逐字节复现旧树，§7 第 2 步的本地副本是唯一精确回滚入口。

## 5. 复现方法与已知限制

- 复现：`02-preflight-repro.sh`（临时前缀 + 独立 cache；不写真实 home；调用同目录 3 个归档探针）。
  实测：全新安装路径 `/tmp/dsh-c0-repro-20260924-160956-Biiua0` 跑通全部步骤；修正断言时序后
  以 `C0_REUSE_ROOT=<该 root>` 复跑，9/9 PASS（`ALL CHECKS PASSED`）。
- 安装规模：512 个包、约 563MB；npm 报告 5 个包的 install scripts 被 allowScripts 拦截
  （`node-pty`、`koffi`、`dsh-subprocess-local` 等）。本票取证不依赖 PTY/原生沙箱路径，
  因此不影响上述事实；但复现脚本不覆盖 TUI PTY 冒烟。
- 真实 home 存在持续写者（在线 TUI 宿主），所以"零写入"用配置面一致 + 增量归属证明。

## 6. 证据文件索引

| 文件 | 内容 |
| --- | --- |
| `02-preflight-signatures.txt` | ① 同步/异步接口原文与路径 |
| `02-preflight-cli-and-migration.txt` | ② CLI/命令面与迁移机制自述 |
| `02-preflight-session-rw.txt` | ③ v0/v3 读写开实测记录 |
| `02-preflight-preset-probe.txt` | ④ 目录预设静态 + 运行时哨兵 |
| `02-preflight-pkgtree-diff.txt` | ⑤⑥ 包树 diff 与可重取性 |
| `02-preflight-attachments-storages.txt` | ⑦ 附件引用统计与 storages 判定 |
| `02-preflight-snapshot-diff.txt` | 零写入核验与差异归属 |
| `02-preflight-probe-read.mjs` | ③ 读开探针（sessionQuery） |
| `02-preflight-probe-write.mjs` | ③ 写开探针（sessionPersistence） |
| `02-preflight-probe-preset.mjs` | ④ 目录预设哨兵探针 |
| `02-preflight-repro.sh` | 临时前缀复现脚本（调用上述归档探针） |
