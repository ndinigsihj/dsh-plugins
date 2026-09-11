# 06 — 会话恢复与回退插件回归

**What to build:** 升级后能恢复既有会话并继续对话；回退命令能把文件内容还原到指定边界；fork/flush、会话列表与删除路径均可用。同时确认升级后的会话记录不被旧宿主读取属于预期行为。

**Blocked by:** 05 — TUI 在新宿主上冷启动

**Status:** done — 2026-09-10（验收 5/5；finding 06-1/06-2 用户裁定并入本票，按方案 A 实施并端到端复验）

**Evidence:** `evidence/06-session-resume-and-rewind.md`（§11 修复实施与复验）；修复计划（已实施）`docs/rewind-rc1-fork-persistence-fix-plan.md`

- [x] 恢复一个既有会话并继续对话（ticket-05 会话 `session-1fa6fc2f` 跨票据恢复 + 本窗口父/子会话恢复后继续）
- [x] 会话列表可见且标题正常（ws2 短列表带表头；repo 45+ 条标题正常）
- [x] 回退命令能把文件内容恢复到边界点（gamma→beta，边界=第 5 轮之前）
- [x] fork/flush 路径执行无报错（修复后：子会话确实落盘、relaunch 恢复该子会话、路由随记录还原；旧 `flush === false` 假阳性守卫已移除）
- [x] 会话删除路径可用（3 个会话 `/rm` 成功、目录移除、exit 0）
- [x] 确认旧宿主读取升级后的会话被拒绝，且该行为已记录（rc.2 两种文件名情形，见证据 §8）
- [x] 修复 finding 06-1（方案 A：`tuiHandoff.forkPersistedChild` 经 `agents.create` 落盘后再改文件；06-2 同轮：relaunch 摘要留 stderr）
- [x] 回归：`npx tsc --noEmit` 0 错、`npm test` 97/97
