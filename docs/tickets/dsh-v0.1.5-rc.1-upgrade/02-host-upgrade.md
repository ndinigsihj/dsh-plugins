# 02 — 宿主升级与依赖方处置

**What to build:** 让开发侧运行在新的候选版宿主上，同时让同样依赖该全局宿主的其他运行模式不再以"半坏"状态反复启动。升级后需确认依赖树中不再混用旧版本的宿主包。

**Blocked by:** 01 — 回滚点与基线记录

**Status:** done — 2026-09-10

**Evidence:** `evidence/02-host-upgrade.md`；悬空链接清单 `evidence/02-dangling-farm-links.json`

- [x] 全局宿主版本为目标候选版（`npm i -g @deepseek-ai/dsh@0.1.5-rc.1`，`dsh --version` → `0.1.5-rc.1`）
- [x] 依赖树中无旧版本宿主包残留（全树递归扫描 552 个 `package.json`：宿主包 230 个全部为 rc.1，旧版本副本 0 个；共享 farm 中 112 条 rc.2 代悬空链接已清除）
- [x] 同样依赖该全局宿主的其他运行模式已被显式停用（`tui-central` profile 目录改名 + 目录内 `PARKED.md`；`worker` launchd job `bootout` + `disable`）
- [x] 每个被停用运行模式的停机原因与恢复条件已记录（`tui-central` 与 `worker` 的恢复条件/命令见证据 §5，另记录 `tui-dev` 迁移期预期不可用及其替代入口）
- [x] 回滚命令与回滚后的期望版本已记录（本票不执行回滚；`npm i -g @deepseek-ai/dsh@0.1.1-rc.2`，期望 `0.1.1-rc.2`，并列出三项需手动作逆的处置）
