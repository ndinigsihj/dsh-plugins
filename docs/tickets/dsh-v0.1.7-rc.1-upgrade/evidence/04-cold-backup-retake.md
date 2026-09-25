# 票据 04 证据 — 首次启动 0.1.7 之前的冷备重取（2026-09-25）

> 触发：计划 §7 第 1 步脚注（距票据 03 的 11:32:35 快照已 5.5 小时，期间 mumu 与本 TUI 均有新写入）
> 新备份根：`/Users/vito/.dsh/upgrade-backups/dsh-0.1.7-rc.1-pre-first-start-20260925-170449/`
> 快照窗口：**2026-09-25T17:04:49+0800 → 17:05:30+0800**；脚本判定 `fail=0`
> 本步不改仓库、不动部署位、不迁移会话；真实 `~/.dsh/sessions` 未被快照动作写入（活写者见 §1）

## 1. 静默确认（判据：窗口内零落盘，而非无进程）

- 45 秒静默探测（17:03:52 → 17:04:37）：`~/.dsh/sessions` 内 **0** 个文件被写（mumu 最后写于 16:56:34，
  用户 TUI 16:59:17，本会话 17:03:51 均在探测前）。
- 窗口内写者快照（`meta/writers-during-backup.txt`）：仅 PID 20964，cwd = 本仓库（即本 TUI，无法自我静默）。
- `sessions` 源 before/after 指纹逐字节一致 → 窗口内无写者落盘。

## 2. 快照内容（同 `03-cold-backup.sh` 口径）

| 面 | 结果 |
| --- | --- |
| sessions | **2213 文件 / 662M**（11:30 快照为 2171 / 650M；+42 文件，覆盖暂停期间 mumu 与新 TUI 的写入） |
| attachments（排除 `request-images/`、`tmp/`） | 1.3G；`request-images` 106 文件 / 28,769,366 B 排除；`tmp` 0 文件 |
| settings.yaml / `.agent-presets` / `profiles`（排除 node_modules） | 全部 `before == after == dst`（逐字节） |
| zstd 完整性 | 1557 个会话日志全部 `zstd -t` 通过（2,706,529,860 B 解压总量，0 错误） |
| 脚本检查 | 10/10 PASS，`fail=0`；日志 `<新根>/meta/cold-backup.log` |

新根总大小 2.2G（sessions 662M + attachments 1.3G + host-package 279M + config/meta）。

## 3. 还原演练（`03-drill.sh`，scratch）

- 演练根：`/tmp/dsh-t03-drill-retake-20260925-170619`；host 包副本从 11:30 根 `rsync` 而来并 `diff -rq` 校验一致，
  新根因此自包含（回滚 + 演练都不再依赖旧根）。
- **8 个代表会话全部打开成功**（v3 子代理链、v0 根与最大日志、附件会话）：事件数均达标；
  `session-66e1fe6c` 快照时事件数已由 257 增至 712（最新会话前缀的自然增长）。
- 118 个附件引用 **0 缺失**；`descriptor-v2` 既存盲区 **72/72** 仍为 `unsupported descriptor version 2`
  （与票据 03 §5.1 记录一致，属旧宿主既存缺口，处理规则留第 10 步）。
- scratch 读开前后逐字节一致；真实 `attachments/`、`profiles/` 未变；真实 `sessions` 仅活会话目录变化：
  `changed=1 removed=0 added-after-snapshot=0`（唯一变化 = 本 TUI 会话，非演练写入）。
- 演练 `fail=0`；逐项日志 `<新根>/meta/drill.log`。

## 4. 丢失窗口与保留期（更新）

- **新快照时间点**：2026-09-25T17:04:49+0800（完成 17:05:30）。
- **丢失窗口**：该时刻之后写入的一切（含本会话后续事件与新会话）。
- **保留期**：原口径不变——至少到新宿主稳定走过一次正式版升级；11:30 根与 17:04 根**均保留**。
  11:30 根仍是回滚基准入口；17:04 根是最新会话面且自包含（含 host 包副本）。
