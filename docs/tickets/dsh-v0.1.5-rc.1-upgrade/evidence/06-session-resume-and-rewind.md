# 票据 06 证据 — 会话恢复与回退插件回归

日期：2026-09-10
执行：ask-matt-flow Stage 5 Implement，票据 06（本窗口）
环境：Node v22.22.1；全局宿主 `@deepseek-ai/dsh@0.1.5-rc.1`；stable 隔离运行时 rc.2 只读探查、未触碰
结论：**验收 5/5 通过（finding 06-1 修复后复验）**。恢复、列表、删除、旧宿主拒绝读取均通过；回退命令的**文件恢复到边界点通过**、
fork 子会话在修复后**确实落盘并可恢复**（修复前落在全新会话、对话历史丢失、无显式报错）。finding 06-1/06-2 经用户裁定并入本票，
按方案 A 实施（见 §11）；实施中新发现 06-4（rc.1 `readSession` 读不了越过继承前缀的 seeded 日志），已在同轮以公开查询 API 绕开。
## 0. 验收清单对照

| 票据 06 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 恢复一个既有会话并继续对话 | 通过 | §2：ticket-05 旧会话 `session-1fa6fc2f` 恢复（route 由记录还原）+ 新增一轮完成；本窗口父会话 `session-c508e04b` 恢复后连做两轮编辑 |
| 会话列表可见且标题正常 | 通过 | §3：ws2 短列表带表头 `Sessions in dsh-ticket06-ws2 (4 of 916 total · 2 untitled hidden)`；repo 列表 45+ 条标题正常（fallback 与 LLM 标题均有） |
| 回退命令能把文件内容恢复到边界点 | 通过（文件部分） | §4：文件内容正确恢复到边界（gamma→beta）；对话 fork 属下一行 |
| fork/flush 路径执行无报错 | 通过（修复后复验，见 §11） | §11：子会话确实落盘、relaunch 恢复该子会话；旧 `flush` 假阳性守卫已移除 |
| 会话删除路径可用 | 通过 | §7：3 个会话 `/rm` 删除成功、目录移除、exit 0 |
| 确认旧宿主读取升级后的会话被拒绝，且该行为已记录 | 通过 | §8：rc.2 两种文件名情形实测：规范名 → `not found`；rc.2 名下 → `SessionFormatUnsupportedError`（upgrade the harness） |

## 1. 开工前复核 findings 05-5 / 05-6 / 05-7

**05-5 部署位 preset 一致性（已复现并确认当前一致）**：部署位 `~/.dsh/.agent-presets/minimal-plus-next/`
与仓库 `presets/minimal-plus-next/` 的 **8 个生产文件**（sync-agent-presets.sh 的部署清单）sha256 全部一致：

```
agent.cordis.yml         repo=05805070cb7127c4 deploy=05805070cb7127c4 SAME
preset.yml               repo=8a0965bd624a179d deploy=8a0965bd624a179d SAME
compaction-epoch.mjs     repo=a17cdce7b871b57b deploy=a17cdce7b871b57b SAME
phase-swap-bash.mjs      repo=084316a3cfa0ea77 deploy=084316a3cfa0ea77 SAME
tool-bootstrap.mjs       repo=e3e05e677289d84f deploy=e3e05e677289d84f SAME
instruction-hint.mjs     repo=4a2a26cb74ee8307 deploy=4a2a26cb74ee8307 SAME
skill-search.mjs         repo=61312f8b054035e5 deploy=61312f8b054035e5 SAME
custom-bash.mjs          repo=3b26436ee419ce57 deploy=3b26436ee419ce57 SAME
```

部署位依赖链接指向全局 rc.1：`node_modules/@deepseek-ai` → `…/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`（`dsh-base` 解析为 0.1.5-rc.1）。
stable 侧 `~/.dsh/.agent-presets/minimal-plus/` mtime 仍为 2026-09-09 17:02，未触碰。
测试/smoke/trajectory 文件只存在于仓库、不在部署清单内（sync 脚本按 8 文件白名单复制），不构成漂移。
**结论**：05-5 的修复仍有效；其“把 sha256 一致性加入票据 09/13 闸门与升级检查单”的建议仍待落票。

**05-6 commandcode 429 额度（外部，仍未恢复）**：本窗口 2026-09-10T09:58:54Z 取样，重置时点 2026-09-11T06:21:01.800Z，
剩余约 20 小时 22 分。本票所有实测均经 `/model` 切到 `opencode-go/deepseek-v4-flash` 完成（与票据 05 相同）。
默认路由 `commandcode/deepseek/deepseek-v4-flash` 未在额度窗口内复验。

**05-7 farm 整代翻转（确认属预期，本轮再次观测到翻转全过程）**：
- 本窗口开工时 farm 为 stable rc.2 代（全部链接 → `~/data/dev/dsh-runtime/stable`，mtime 17:54，即上一次 stable 启动留下的代）。
- 本窗口多次 `tui-dev` 冷启动/恢复后，farm 已按 rc.1 的 installAnchor 整代自愈为全局 rc.1：
  `dsh-base` / `dsh-app-boot` → `…/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/…`。
- `dsh-acp` / `dsh-acp-app`（mtime 14:45）是 rc.1 自愈留下的“只补不删”残留（stable 树无这两个包），无害。
- stable 下次启动会按其 anchor 翻回 rc.2 代——与 03-2 / 05-7 记录一致，属预期副作用。

## 2. 会话恢复与继续对话

### 2.1 ticket-05 既有会话（跨票据恢复）

对象：`session-1fa6fc2f-651b-4df2-8132-ad208529ac5c`（票据 05 验收会话，repo cwd，V3）。
命令：`dsh --profile tui-dev --resume session-1fa6fc2f-…`（真实 PTY，`cwd=/Users/vito/data/dev/dsh-plugins`）。
启动日志（stderr 第一方）：

```
dsh-tui boot: resume=session-1fa6fc2f-651b-4df2-8132-ad208529ac5c records→opencode-go/deepseek-v4-flash
```

恢复后 transcript 重放旧内容（`Compute 137 times 3`），发送 `RESUME-CHECK: reply with only the single word RESUMED.`
并等到**真实 `turn/end`**。durable 会话记录新增一轮：

```
22 turn/start
26 user/message '# 项目状态(as of 2026-09-10 19:30)…'      ← 注入快照
27 user/message 'RESUME-CHECK: reply with only the single word RESUMED…'
28 request/header opencode-go deepseek-v4-flash              ← 路由由记录还原，非默认 commandcode
31 turn/end {"kind":"completed"}
```

即：既有会话可恢复、route 记录生效、可继续对话。

### 2.2 本窗口父会话（rewind 前后）

`session-c508e04b-8626-4742-8e09-119181b59f02`（ws2）：首轮 PING 后，恢复并完成两轮文件编辑（见 §4），
rewind 落点见 06-1；随后 relaunch 进程以 `--resume session-d524e712-…` 启动（见 §4/§6）。

## 3. 会话列表与标题

**ws2（短列表，表头完整可见）**：

```
Sessions in dsh-ticket06-ws2 (4 of 916 total · 2 untitled hidden):
  1. PING: reply with only the [15m ago · live (current)]
  2. PING: reply with only the [21m ago · persisted]
/resume to pick, or /resume <session-id>.
```

**repo cwd（长列表，尾部可见）**：45 条带标题记录，如
`34. 在review这个提交3e50568 [18d ago · persisted]`、`37. dsh-tui开发 [19d ago · persisted]`、
`44. 现在deepseek harness已经更新了0.1 [19d ago · persisted]`——标题快照（含 LLM 标题与首条消息回退标题）正常，
无 `undefined`/空标题；未取标题的空白会话按设计隐藏（`2 untitled hidden`）。

## 4. 回退命令：文件恢复到边界点（通过）

驱动：`.dsh/tmp06/tui_pty.py`（持续排空 PTY，避免 expect `exec` 阻塞导致 TTY 写满）+ `run_p.py` / `run_q.py`；
每轮以 durable 日志中的**真实 `turn/end`** 为同步点（不再用屏幕/思考流文本猜测）。

1. ws2 初始 `sample.txt = alpha`。
2. 恢复父会话后两轮编辑（模型按要求 `view` → `str_replace`）：
   - 第 4 轮：`alpha` → `beta`（文件实测 `beta`）
   - 第 5 轮：`beta` → `gamma`（文件实测 `gamma`）
3. `/rewind` 候选列表（durable `command/done` 原文，非屏幕抓取）：

```
Past messages (pick a user message's seq):
[11] PING: reply with only the single word PONG. Do not use any t…
[23] EDIT-ONE: call str_replace_editor exactly once with command …
[40] EDIT-TWO: call str_replace_editor exactly once with command …
[62] EDIT-ONE: first call str_replace_editor with command view, p…
[82] EDIT-TWO: first call str_replace_editor with command view, p…
```

4. `/rewind 82`（第 5 轮，边界 = 第 5 轮 `turn/start` 之前）：
   - **文件内容实测恢复为 `beta`**（只回退第 5 轮，符合边界语义）。
   - 插件随后 `sessions.flush(child)` → 文件恢复 → `tuiHandoff.relaunchToResume(child.id)`；父会话日志以
     `98 command/run {"name":"rewind","args":" 82"}` 结尾，无 `command/done`（进程被 execve 替换，符合实现）。
   - **但 relaunch 进程找不到子会话**（见 06-1），落成全新会话，界面无任何错误提示。

## 5. finding 06-1（阻塞）：rc.1 上 rewind 的 fork 子会话不落盘，回退后对话历史丢失

### 5.1 现象

`/rewind 82` 之后，relaunch 进程（cmdline 实测 `dsh --profile tui-dev --resume session-d524e712-…`）输出：

```
dsh-tui boot: resume=session-d524e712-62ac-4fc2-8267-e61b25fbc1a0 no-record→default
dsh-tui: resume session-d524e712-62ac-4fc2-8267-e61b25fbc1a0 failed: session "…" not found — composing a fresh session
```

磁盘上不存在任何 `session-d524e712-…` 目录（全 sessions 根 `find -name "*d524e712*"` 为空）；
该进程改为新建 `session-04811494-…`（后作为临时会话由 §7 删除）。
净效果：**文件恢复到边界点，但对话没有 fork 出来**，用户看到的是一次“重启成空会话”，且没有任何报错。

### 5.2 根因链（rc.1 第一方代码阅读 + 实机行为互证）

1. rc.1 把会话持久化改为**生命周期持有**：
   `@deepseek-ai/dsh-session/lib/index.js`（`SessionStore`，`ctx.sessions`）注释原文：
   > Persistence is intentionally not implemented here — the agent lifecycle attaches a session-log writer
   > to each published session's write handle; **a session published outside that lifecycle persists nothing.**
   - `sessions.fork()` 经 `create()` 只把子会话放进内存 store（live），**不经过 `agents.create` 生命周期**；
     `dsh-agent-loop` 在创建 agent 时才调 `persistence.create(session.header, …)` 挂上写句柄。
2. 插件为“flush 失败即中止”加的守卫失效：
   - `dsh-session-persistence-jsonl/install()` 注册的是**全局** `session/flush` 监听：
     `const writer = this.writers.get(session.id); if (writer == null) return undefined;`
   - `SessionStore.flush()` 的返回值语义是 **`callbacks.length > 0`（是否有监听者参与）**，不是“是否真的落盘”。
   - 因此 rewind 插件的 `if (flushed === false) …（no persistent listener）` 在 rc.1 下**永远是假阴性**：
     监听者在、但该 fork 子会话没有 writer → 返回 `true` → 插件继续做文件恢复并 relaunch。
3. 结果：文件恢复成功（副作用），execve 目标是一个只存在于**旧进程内存**中的会话 id；新进程读不到、落成新会话。

### 5.3 影响与边界

- 影响面：`/rewind <seq>`（本地模式）的回退对话 fork 全部失效；文件恢复不受影响。
- 无报错即静默，用户不会知道对话历史没有接上——比显式报错更危险。
- relay 模式的 rewind 走 worker 端（`relayClient.rewind`），不在本窗口验证范围。
- 该路径在票据 04 只做了接口迁移（`snapshotEvents`/`SessionSeq`），当时明确“fork/flush 与文件恢复的端到端属票据 06”——本票正是它的集成验证点，结果失败。

## 6. fork/flush 判定（对应的检查项）

修复前：`/rewind` 命令本身返回成功（无 error），但按 §5 根因，这是 `flush` 假阳性下的“成功”——以实质（fork/flush 路径真的把子会话落盘）为**失败**。
**修复后（§11）**：子会话由 TUI 经 `agents.create` 落盘、`listSessions().persisted` 复核通过后才恢复文件并 relaunch，检查项按实质通过。

## 7. 会话删除路径（通过）

在 ws2 会话内对 3 个临时会话执行 `/rm <prefix>`（审批卡片 `a` 确认）：

```
dsh-tui: rm session session-04811494-9213-4da6-aa09-ac3b1dacf5f3
Deleted session-04811494-9213-4da6-aa09-ac3b1dacf5f3.
RM-71de6bc1-DELETED / RM-2dcc0c7d-DELETED / RM-04811494-DELETED
DIR-*-REMAINS []  （三处磁盘目录均移除）
EXIT 0
```

含未命名（untitled）会话也可删除；日志目录与投影缓存一并移除的语义与设计一致。

## 8. 旧宿主（rc.2）读取升级后的 V3 会话被拒绝（通过，行为已记录）

只读实验：用 stable rc.2（`0.1.1-rc.2`）自己的持久化后端读取复制的 V3 会话（临时 `DSH_HOME`，未触碰真实 session/stable 树）。
rc.2 常量：`SESSION_FORMAT_VERSION = 0`，其日志文件名为 `session.jsonl.zstd`；rc.1 为 v3、文件名 `session.v3.jsonl.zstd`。

| 情形 | rc.2 行为（逐字） |
| --- | --- |
| V3 落在 rc.1 规范文件名 `session.v3.jsonl.zstd` | `readRaw => undefined (no stored artifact found for this id)`；`load => Error: session "…" not found`。经 `sessionQuery.readSession`（其内部就是 `_corpus.load`，错误码 `SESSION_QUERY_SESSION_NOT_FOUND`）表现为“会话不存在” |
| 把同一份 V3 字节改名为 rc.2 期望的 `session.jsonl.zstd` | `readRaw` 先在结构校验处报 `corrupt session log: invalid header line`；`load => SessionFormatUnsupportedError: session "…" uses log format v3, but this harness reads only v0: the log was written by a newer harness — upgrade the harness to open it` |

结论：**旧宿主无法读取升级后的会话**；因 rc.1 用了带代际的文件名，实际磁盘布局下 rc.2 连“格式太新”的提示都给不出，
只报“会话不存在”。与 spec「V3 不提供降级读取、备份是唯一退路」一致，且说明回滚旧宿主后这些会话在旧宿主视角是**不可见**，
而不是“打不开但看得见”。实验脚本 `.dsh/tmp06/rc2-v3-read-probe.mjs`。

## 9. 回归

- `npx tsc --noEmit` → 0 错误
- `npm test` → 97 pass / 0 fail
- 验收实测阶段未改仓库代码；06-1 修复阶段仅改 `lib/index.ts` 与 `plugins/rewind-dsh.ts`（见 §11），修复后同口径回归仍全绿；
  未触碰 stable 组合/部署位（stable `minimal-plus` mtime 未变）、未触碰 relay/长期记忆/worker。

## 10. 边界、清理与新 findings

- 临时驱动与原始 PTY 日志：`.dsh/tmp06/`（gitignore 流程目录）与本票临时工作区 `/tmp/dsh-ticket06-ws{,2,3}`
  已在票据收尾时清理；验证读数已收入 §11。相关会话仍保留在 `~/.dsh/sessions/`（ws1/ws2/ws3 三个 cwd key 下），
  其中 ws3 的 `session-4c66af75`（父）、`session-6846f8fa`（修复后可恢复的子会话）与 `session-5ed34c7b`/`session-d8816d0b`
  （修复前/中间态对照）可直接用 `/resume` 复核。
- 早期对照（Run A，`session-65e713ad`）：因为用“回复暗号”猜轮次结束，第 2 条消息被 steer 进**同一个 turn**，
  且模型首次用相对路径编辑失败——这暴露了「必须用 durable `turn/end` 做同步点」与「str_replace_editor 需先 view」
  两个驱动/工具事实，主流程已据此改为 `wait_turns()`。
- **finding 06-1（已修复并复验，见 §11）**：见 §5；修复方案与验证结果见 `docs/rewind-rc1-fork-persistence-fix-plan.md`。
- **finding 06-2（本轮已修）**：`tuiHandoff.relaunchToResume` 在 execve 前不显示 rewind 摘要；现接受可选 `note`，在 `stopTerminal()` 之后写 stderr，摘要留在 shell 回滚区（§11 复验 `SUMMARY-VISIBLE True`）。
- **finding 06-3（驱动事实）**：`str_replace_editor` 对未在本次会话 `view` 过的文件拒绝编辑
  （`Error: edit requires reading "<path>" first`）；票据 07/08 的 M4 提示与断言设计需注意（非回归，属工具契约）。
- **finding 06-4（本轮发现，已绕开）**：rc.1 `sessionQuery.readSession` 的 snapshot 构造要求
  `inheritedEventCount === events.length`，而 seeded 子会话在 append 启动事件后不再满足 → fork/rewind 后**任何 readSession 调用都会抛**
  `seeded session constructor seed must equal its inherited prefix`。影响：resume facts（route/preset/effort）读不到 → 子会话按默认路由恢复
  （本轮实测落到 commandcode 并命中 429）；hover 预览走 readSession 的路径对 seeded 子会话同样会失败。
  处置：`bootResumeFacts` 改走公开查询 API `listEvents`（type/seq）+ `readEvent`（完整行）拼出所需事件，不构造 Session；
  `readSession` 仅作回退。**残留**：`coldSnapshot`/hover 预览仍走 readSession，seeded 子会话可能显示“preview unavailable”，建议票据 09/13 复核。

## 11. finding 06-1/06-2 修复实施与复验（用户裁定并入本票，2026-09-10）

用户裁定：并入票据 06 本轮实施；采用方案 A（TUI 提供持久化 fork 服务）；06-2 同轮处理。

### 11.1 改动（`lib/index.ts` + `plugins/rewind-dsh.ts`，未提交）

- `lib/index.ts` 新增 `tuiHandoff.forkPersistedChild(seed)`：由 TUI 经宿主 agent 生命周期创建子会话
  （`agents.create({sessionId, seed, inheritedEventCount, meta:{cwd,parentSession,isSeeded,agentPreset}, agentOptions: 会话当前路由, setup})`），
  `whenIdle` → `sessions.flush` → **`listSessions().persisted` 复核** → 返回 `{childId, cwd}`；任一步失败都在文件改动之前返回错误。
  - `Agent.session` 结构切片补 `header?: {cwd?}`；`sessions.flush` 返回类型改 `Promise<boolean | void>`；导入 `SessionLogOffset`。
  - `relaunchToResume(id, note?)`：`stopTerminal()` 之后把摘要写 stderr（06-2）。
  - `bootResumeFacts` 改走 `listEvents` + `readEvent`（见 06-4），`readSession` 仅回退。
- `plugins/rewind-dsh.ts` 删除裸 `sessions.fork` + `sessions.flush` 段（连同 `SessionsService` 类型、`sessions` 注入与守卫），
  改调 `tuiHandoff.forkPersistedChild(events.filter(seq<=boundary))`；relaunch 时把 `dsh-rewind: <summary>` 交给 `tuiHandoff`。
  服务缺失/返回失败 → 显式报错且不改文件。
- 回归：`npx tsc --noEmit` 0 错；`npm test` 97/97。

### 11.2 端到端复验（真实 PTY，ws3）

- 阶段 1：新建父会话 `session-4c66af75-ff66-4311-9451-445c8ee3b7f5`，两轮编辑 alpha→beta→gamma（文件实测同步）；`/rewind` 目标 = EDIT-TWO 的 seq 37。
- 阶段 2：`--resume` 父会话后 `/rewind 37`，关键读数：

```
CHILD session-6846f8fa-18eb-4ce8-8f85-4b6a36b37aff
SUMMARY-VISIBLE True
FRESH-SESSION-FALLBACK False          ← 不再出现 "composing a fresh session"
FILE-AFTER-REWIND beta                ← 文件恢复到边界点
CHILD-DIR-EXISTS True / CHILD-LOG-EXISTS True
CHILD-USER-MESSAGES [...,'EDIT-ONE: first call str...',...]   ← 历史止于边界，无 EDIT-TWO
CHILD-TURNS 1
CHILD-CONTINUE-OK
CHILD-LAST-TURN completed             ← 子会话继续对话成功（非错误收尾）
CHILD-LAST-ROUTE ('opencode-go','deepseek-v4-flash')  ← 路由随子会话恢复，未落到默认 commandcode
```

- 两次 boot 轨迹（stderr 第一方）均为 `records→opencode-go/deepseek-v4-flash`：普通会话（unseeded）与 fork 子会话（seeded）都能还原记录路由。
- 供对照：修复前的同一流程为 `session "..." not found — composing a fresh session`，文件恢复仍发生、对话分支丢失；
  本轮另留两个“修复前/中间态”子会话（`session-5ed34c7b`、`session-d8816d0b`）在 ws3 会话目录，可作前后对照。

### 11.3 残留

- 06-4 的 hover 预览路径（`coldSnapshot`/`readSession`）未改，seeded 子会话可能无预览。
- relay 模式的 rewind 仍走 worker 端，不在本轮范围。

