# 修复计划：rc.1 上 /rewind 的 fork 子会话不落盘（finding 06-1）

日期：2026-09-10　状态：**已实施并端到端复验**（用户裁定并入票据 06，采用方案 A；实施与复验记录见
`docs/tickets/dsh-v0.1.5-rc.1-upgrade/evidence/06-session-resume-and-rewind.md` §11）
关联：票据 06（`docs/tickets/dsh-v0.1.5-rc.1-upgrade/06-session-resume-and-rewind.md`）、
证据 `…/evidence/06-session-resume-and-rewind.md` §5/§6、票据 04（rewind 接口迁移）。

## 1. 问题

`/rewind <seq>` 在 rc.1 上：文件能正确恢复到边界点，但 **fork 出的子会话从未落盘**。插件随后
`execve --resume <childId>` 重启，新进程读不到该会话（`session "…" not found — composing a fresh session`），
于是落成全新会话——**对话历史丢失，且全程无报错**。这是票据 06 的核心验收项失败（文件部分通过、对话部分失败）。

## 2. 根因（rc.1 第一方代码）

1. rc.1 的会话持久化由**生命周期持有**。`@deepseek-ai/dsh-session` 的 `SessionStore`（服务名 `sessions`）文档原文：
   “Persistence is intentionally not implemented here — the agent lifecycle attaches a session-log writer to each
   published session's write handle; a session published outside that lifecycle persists nothing.”
   `sessions.fork()` 只经 `SessionStore.create()` 产出 live 会话；写句柄是 `dsh-agent-loop` 在创建 agent 时
   `persistence.create(session.header, …)` 挂上的。rewind 直接 fork、不经过 agent 生命周期 → 无写句柄 → 不落盘。
2. 插件的“flush 失败即中止”守卫是 rc.1 下的**假阴性**：
   - `dsh-session-persistence-jsonl` 的 `install()` 注册全局 `session/flush` 监听；
     监听器内部对没有 writer 的会话 `return undefined`（no-op）。
   - `SessionStore.flush()` 返回 `callbacks.length > 0`（*是否有监听者参与*），并非“是否落盘”。
   - `plugins/rewind-dsh.ts` 只在 `flushed === false` 时中止 → rc.1 下永远通过 → 恢复文件 + relaunch 到不存在的会话。

## 3. 方案对比

### 方案 A（推荐）：把“fork 成可持久化子会话”收进 TUI 服务，rewind 只负责文件与重启

- 由 TUI（`lib/index.ts`）在现有 `tuiHandoff` 服务上新增方法，例如
  `forkPersistedRoot(boundary: SessionSeq): Promise<{ ok: true; childId: string } | { ok: false; error: string }>`：
  1. `services.sessions.fork(agent.session, boundary, childId)` 取 seed（与现状相同）；
  2. 用 **TUI 既有配方**（`switchModelLive()` 同源）`services.agents.create({ sessionId, seed, meta: { cwd, parentSession, agentPreset }, agentOptions, setup: makeSetup(composed, route) })` 创建**经宿主生命周期**的子会话；
  3. `await created.agent.whenIdle()` → `services.sessions.flush(created.agent.session)` → 用 `sessionQuery.readSession(childId)` 复核可读后返回 childId（不把新 agent 采纳为当前会话，进程马上 execve）。
- `plugins/rewind-dsh.ts` 删除 `sessions.fork` + `flush` 段，改为调用该服务；服务缺失或返回失败时，在**任何文件改动之前**返回显式错误（保持现有“先落盘、后改文件”的顺序）。
- 路由/preset 取值遵循 rewind 既有语义：沿用**会话自己记录**的 route 与 preset（不是默认值）。
- 优点：使用官方 agent 生命周期落盘；插件不接触 preset/route/持久化后端内部；与 TUI 既有的 fork 配方同一处实现。
- 估计改动量：`lib/index.ts` ~40–60 行（新服务方法 + 复用既有 helper）；`plugins/rewind-dsh.ts` ~15 行；单元测试按需同步；无新依赖。

### 方案 B（次选）：插件内自持持久化句柄

- 插件 `inject: [..., "sessionPersistence"]`，对 fork 子会话显式 `persistence.create(child.header, …)` + 写入 seed + flush + close。
- 缺点：直接依赖持久化后端 API 与 pending/writers 簿记，跨 rc 版本脆弱；与“不依赖旧持久化方法/不手搓生命周期”的迁移口径相悖。仅当 A 不可行时采用。

### 方案 C（不推荐）：接受现状

- rewind 只恢复文件、不 fork 对话。功能退化且静默，不可取；若暂不修，至少要让插件**显式报错**而不是假成功。

## 4. 验证计划（修复后）

1. **单元**：rewind 插件对“服务缺失/返回失败”在文件改动前中止（现有 fail-before-write 断言语义保留）；
   TUI 若有可测 seam 则补 fork 配方用例。
2. **端到端（真实 PTY）**：新建父会话做两轮编辑后 `/rewind` 到末轮边界，断言：
   - `~/.dsh/sessions/<cwd-key>/<childId>/session.v3.jsonl.zstd` **存在**；
   - relaunch 日志出现 `dsh-tui boot: resume=<childId> records→…`（而非 `no-record→default` + `not found — composing a fresh session`）；
   - 子会话 transcript 含回退边界前的历史（如第 4 轮编辑与其回复），`/sessions` 可见该子会话且标题正常；
   - `sample.txt` 仍为 `beta`（文件恢复不回归）；
   - 生成会话数回归：不再多出“fresh session”。
3. **回归**：`npx tsc --noEmit`、`npm test` 全绿；stable 侧文件/部署位/运行时不受影响。

## 5. 风险与回滚

- 风险：`agents.create` 在 execve 前短暂创建 live agent，若宿主在创建时写入额外事件（预期不会），会影响子会话历史；
  验证第 2 步的 transcript 断言可覆盖。
- 风险：子会话 route/preset 取错（默认值而非记录值）会导致恢复后模型/工具面变化；实现时显式断言 `request/header` 与源会话一致。
- 回滚：改动只在仓库工作树（本轮不提交），还原 `lib/index.ts` 与 `plugins/rewind-dsh.ts` 两个文件即可；stable 侧全程未触碰。

## 6. 裁定与实施结果

- 用户裁定（2026-09-10）：06-1 并入票据 06 本轮实施；采用方案 A；06-2 同轮处理。
- 实施：
  - `lib/index.ts`：新增 `tuiHandoff.forkPersistedChild(seed)`（`sessions.fork` 不再由插件裸调；TUI 用 `agents.create` 落盘，
    `flush` 后以 `listSessions().persisted` 复核，失败在任何文件改动之前返回）；`relaunchToResume(id, note?)` 把摘要写 stderr；
    `Agent.session` 补 `header`、`sessions.flush` 返回类型修正、导入 `SessionLogOffset`。
  - `plugins/rewind-dsh.ts`：删除裸 `sessions.fork`+`flush` 段与 `sessions` 注入，改调 `forkPersistedChild`；relaunch 传摘要。
  - 实施中新发现（finding 06-4）：rc.1 `sessionQuery.readSession` 的 snapshot 构造拒绝“越过继承前缀”的 seeded 日志
    （fork/rewind 子会话 append 启动事件后必然如此），导致 resume facts 读不到、子会话按默认路由恢复（实测命中 commandcode 429）。
    已把 `bootResumeFacts` 改走公开 API `listEvents` + `readEvent` 拼装，不构造 Session；`readSession` 仅回退。
- 复验（真实 PTY，ws3）：`/rewind 37` 后落到已落盘的 `session-6846f8fa…`（`FRESH-SESSION-FALLBACK False`）、
  文件恢复 `beta`、子会话历史止于边界、continue 成功且 `CHILD-LAST-ROUTE=opencode-go/deepseek-v4-flash`、
  boot 轨迹 `records→opencode-go/deepseek-v4-flash`；`tsc` 0 错、`npm test` 97/97。
- 残留：hover 预览（`coldSnapshot`/`readSession`）对 seeded 子会话仍可能失败（finding 06-4 残留，建议 09/13 复核）。
