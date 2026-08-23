# Rewind 文件恢复插件 — 详细方案（方案 2：工具日志逆向恢复）

> 目标：给 `@deepseek-harness-tui/dsh-tui`（0.8.4，`endless-tui` profile 使用的发布版）补上「rewind 时一并把文件回滚到该点」的能力——**不改 dsh-tui 本体**，以独立插件 + harness 标准服务实现，方案 2（从 session 日志做 write/edit 逆向恢复）。
>
> 本文档是设计定稿前的完整方案，先落文档再 spike/实现（项目流程偏好）。所有结论均有包内源码证据，证据行标注了包内文件位置。

---

## 1. 结论先行（先回答：`tui/rewind-prompt` 是不是 dsh 本身的能力）

**不是 dsh 核心（dsh-base）的能力，是 dsh-tui 插件包自己提供、由 host 中介的决策事件（DecisionEvents）接缝。**

证据链（来自 `@deepseek-harness-tui/dsh-tui@0.8.4` 发布包，`endless-tui` profile 的 node_modules 内）：

| 事实 | 证据 |
|---|---|
| rewind 功能本体（双 Esc 选消息 → fork 新会话 → 重放）实现在 **dsh-tui 包的 channel adapter**，不在 dsh 核心 | `lib/types/dsh-adapter/channel.js` 的 `promptRewind` / `rewindTo` |
| `tui/rewind-prompt` 是 dsh-tui 声明的一组 **TUI 决策事件**之一 | `lib/types/plugin-spec/tui-extension.js`：`TUI_DECISION_EVENT_NAMES = ['tui/input','tui/rewind-prompt','tui/rewind-done','tui/session-switch','tui/session-switched','tui/compact']`，API 版本 `tui.dsh/v1alpha1` |
| 它是 host 中介的 **DecisionEvents registry** 分发，**不是裸 `ctx.on`** | `lib/types/dsh-adapter/extension-events.js`：`dispatchTuiDecision(...)`；`decision-guard.js`：`internal/listener` 钩子把 `ctx.on('tui/rewind-prompt', ...)` 也拦下来走 registry |
| 拦截类决策事件需要 **权限 `session.rewind.intercept`**，且默认 deny、需 grant | `decision-guard.js`：`DECISION_EVENT_PERMISSIONS = { 'tui/rewind-prompt': 'session.rewind.intercept', ... }`；`grants.js`：`EXTENSION_GRANTS_FILE = 'extension-grants.json'`，default deny |
| 订阅者必须是**被验证的 Component**（有 `dsh-plugin.json` manifest），并静态声明 `tui.dsh/v1alpha1#DecisionEvents` 契约 + 对应权限 | `component-identity.js`（`componentIdentityOf` / `requiresDecisionEvents`）；`registerDecisionHandler` 的静态校验 |

**对「薄插件」模式的关键影响**（也是本次方案最需要先确认的点）：

> 现有 `approval-tui.ts`（走 `ctx.on('approval/request', ...)` 瀑布）和 `plugins/rename-session.ts`（走 `commands.register` 标准服务）能当「薄插件」直接 patch-insert，是因为那两个接缝是**裸 cordis 事件/服务**。
> 而 `tui/rewind-prompt` / `tui/rewind-done` 走的是 **DecisionEvents registry + Component 准入 + grant**——一个裸 `.ts` patch-insert 插件 `ctx.on('tui/rewind-prompt', ...)` 会被 `internal/listener` 守卫**拒绝并打 warning**（源码原话：*"use the mediated DecisionEvents activation surface; the listener was NOT registered"*）。

所以方案 2 不能照抄 `approval-tui.ts` 的挂法，必须在设计里补上 **Component manifest + grants** 这一层。这没有推翻插件模式（仍不改本体），但把「薄插件」升级为「标准 Component 插件」。

**→ 正因为如此，最终采取更轻的路线：独立 `/rewind` 命令插件，完全不碰 `tui/rewind-prompt`。见 §2（已实现，`plugins/rewind-dsh.ts`）。**

---

## 2. 独立 `/rewind` 命令插件（已实现，推荐路线）

### 2.1 思路：绕开 DecisionEvents，直接消费标准服务

`tui/rewind-*` 那套缝对薄插件不可用，但**底层能力全是标准进程内服务**，谁都能调：

| 能力 | 标准服务 | 用途 |
|---|---|---|
| 会话 fork | `ctx.sessions.fork(source, boundary, childId)` | 生成子会话 seed + header（继承 cwd / parentSession / seedLength） |
| 会话持久化 | `ctx.sessionPersistence.create + append` | 让 `--resume` 能在重启后加载子会话 |
| 当前会话/agent | `ctx.agents.roots()[0].session` | 取源日志与 cwd |
| 命令注册 | `ctx.commands.register` | `/rewind`，**覆盖内置 rewind**（注册表 handler 优先） |
| 文件恢复 | `node:fs`（cwd 下） | 方案 2 的逆向写回 |

所以插件的 `/rewind` 命令自己实现「fork + 文件恢复 + 切到新会话」，效果等价于内置 rewind，还多带文件回滚。

### 2.2 工作流

```
/rewind             → 列出历史 user 消息（seq + 摘要），提示 /rewind <seq>
/rewind <seq>       → 1) computeRewindBoundary：回退到该消息所在 turn 之前
                      2) sessions.fork(source, boundary, childId)
                      3) 文件恢复：源日志 seq>boundary 的 write/edit 反向回滚（方案 2 核心）
                      4) sessionPersistence.create+append 持久化子会话
                      5) execve 重启：DSH_TUI_RESUME_SESSION / DSH_CC_RESUME_SESSION = childId
                         → boot 时 TUI 读到 sessionId 自动 resume 子会话
```

### 2.3 为什么用 execve 重启而不是进程内切换

发布版 0.8.4 的内置 `resumeTo`/`rewindTo` 是**进程内**切 agent（`agents.resume` + TUI channel 内部重绑 `state.agentId`/`bindAgent()`/重放 transcript）。那个 `state` 是 TUI channel 闭包里的私有状态——**插件侧够不着**。插件若直接 `agents.resume`，TUI 不会跟着重绑，transcript 与 agent 会脱节。

跨进程 handoff 是 TUI/launcher 自己的契约（`update.js`、`plugin.js` 的 `resumeCommand`）：`DSH_TUI_RESUME_SESSION=<id> dsh --profile <profile>`。插件 execve 重启同一 dsh（`process.execPath + process.argv.slice(1)`，已含 `--profile`），TUI 全新 boot 并 resume 子会话。这与本地重建版 `/resume` 的 `relaunchToResume` 是同一模式。

### 2.4 与内置 rewind 的关系（「覆盖」如何成立）

- `dsh-commands` 注册表里 handler **优先于 TUI 本地命令名**（rename-session.ts 注释已确认：*"registry handlers win over local names"*）。
- 因此插件注册 `/rewind` 后，**输入 `/rewind` 走的是我们的 handler**，内置 rewind（双 Esc / `/rewind`）被我们的能力覆盖——用户选择回退时就带上文件恢复。
- 不修改 TUI 本体；双 Esc 快捷入口仍是内置行为（仅回对话），`/rewind` 是带文件恢复的完整路径。

### 2.5 实现状态

| 项 | 状态 |
|---|---|
| `plugins/rewind-dsh.ts`（插件主体） | ✅ 已实现 |
| 纯函数（boundary / diff 反向 / 恢复计划 / replaceOnce） | ✅ 已实现，可单测 |
| 单元测试 + 端到端临时目录测试 | ✅ `plugins/rewind-dsh.test.ts`，24 个用例全绿 |
| 类型检查（`tsc --noEmit`） | ✅ 通过（`tsconfig.json` 已把 `plugins/**/*.ts` 纳入 include） |
| 挂载进 endless-tui profile | ⏳ 待做（见 §6 挂载指引） |

---

## 3. 为什么需要方案 2（背景复述）

内置 rewind 只回滚**会话历史**：`channel.rewindTo` 做的是 `sessions.fork(source, boundary)` + `agents.create(新会话)` + 重放，**完全不碰文件系统**（`channel.js` 全实现里没有任何文件写回）。所以：

| 你想回撤的东西 | 内置支持？ |
|---|---|
| 对话历史（回到某条 user 消息重来） | ✅ fork 新会话，消息回输入框重发 |
| 文件修改（回到那个点时的文件状态） | ❌ 内置没有；也没有插件接这个缝 |

方案 2 = 从源会话日志里提取 write/edit 记录做**逆向恢复**（无 git 也能用）。

---

## 4. 恢复数据源核查（可行性核心：日志里到底有什么）

这是方案 2 成立与否的关键，已逐层核实到包内源码。**结论：`write`/`edit` 两个工具会把「改动前后的上下文 diff」写进 `tool/result.meta.diffs`，并随会话日志持久化** —— 这就是逆向恢复的数据基础。

### 4.1 会话事件模型（`@deepseek-ai/dsh-session`）

- `session/event` 逐条推 `tool/call` 与 `tool/result`（`lib/types/types.d.ts`）：
  - `tool/call`：`{ turn, step, callId, name, arguments }`（`arguments` 是模型产出的原始 JSON 字符串）
  - `tool/result`：`{ turn, step, message, error?, meta? }`，其中 `meta` **必须 JSON 可序列化**，随日志持久化，重放时原样复现
- `meta` 对核心是不透明负载（opaque），由产出它的工具私有拥有——正好给 write/edit 带 diff。

### 4.2 `dsh-tool-fs` 的 write/edit 到底持久化了什么（决定性证据）

`node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js`：

| 工具 | `presentationMeta`（写入 `tool/result.meta`） | 含义 |
|---|---|---|
| `write` | `{ diffs: before===null ? [] : computeHunkDiffs(file_path, before, after) }` | 新建文件 → `diffs=[]`；覆盖已有文件 → 存「改动处 ±3 行上下文」的 hunks |
| `edit` | `{ diffs: computeHunkDiffs(file_path, before, after) }` | 存实际命中的 hunk（单处 / replace_all 全部） |

`FileDiff`（`@deepseek-ai/dsh-tools/lib/types/presentation.d.ts`）：

```ts
interface FileDiff {
  path: string;
  oldText: string | null;   // 改动前文本；null = 纯新增/新建（无改动前内容）
  newText: string;          // 改动后文本
}
```

`computeHunkDiffs`（`index.js`）用 `diff` 包的 `structuredPatch(..., { context: 3 })` 从真实的 `before`/`after` 逐 hunk 切出 `oldText`/`newText`，**是从真前/后文本算出来的**（不是模型参数的盲目回放）。

### 4.3 各工具的可恢复性分级

| 工具 | 日志里有什么 | 可恢复性 |
|---|---|---|
| `write`（覆盖已有文件，before≠null） | `meta.diffs`（±3 行上下文 hunks） | ✅ 反向应用 hunks 可**精确**还原（hunks 源自真实 before/after） |
| `write`（新建，before=null） | `diffs=[]` | ✅ 还原 = 删除该文件（边界点不存在） |
| `write`（覆盖但 before=null，如二进制/超大被拒） | `diffs=[]`，无 before | ⚠️ 无法还原 → 警告 |
| `edit`（含 replace_all） | `meta.diffs`（实际命中的全部 hunks） | ✅ 反向应用可精确还原 |
| `str_replace_editor` | 无 `meta.diffs`；只有 `tool/call` 参数（`old_str`/`new_str`/`insert_line`/`file_text`/`command`） | 🟡 二级最佳努力：按参数反向（str_replace 反向、insert 反向、create 删文件）；多命中歧义，需校验 |
| `bash`（sed/rm/mv/echo>…） | 无 meta；只知执行过命令 | ❌ 不可从日志还原（用 git 兜底或跳过并警告） |
| 其他写文件方式（git、外部进程） | 无 | ❌ 超出范围 |

> ⚠️ **一个真实的保真边界**：`computeHunkDiffs` 把每 hunk 的行 `join("\n")`，会丢**行尾换行/无换行标记**（源码注释：*"patch-only no-newline markers are omitted"*）。极端情况下（改动恰在 EOF 且有无换行差异）反向结果可能与原文件相差一个尾部换行。设计上接受该边界，并在测试里覆盖。

### 4.4 数据获取通道（rewind 后还能读到源会话日志吗）

- `tui/rewind-done` 载荷给 `sourceSessionId` / `childSessionId` / `boundarySeq` / `cwd`（`extension-events.d.ts` 的 `TuiRewindDoneEvent`）。
- rewind 后旧 agent 被 `oldHandle.dispose()`，旧会话可能已不在 live store；可靠读取走持久化服务 `ctx.sessionPersistence.load(sourceSessionId)` → `{ meta, events }`（`@deepseek-ai/dsh-session-persistence`，`SessionInspection.events` 即完整事件日志）。

---

## 5. 恢复算法（核心）

### 5.1 语义

rewind 到 `boundarySeq`（fork 切割点，`channel.rewindTo` 会把它回退到所选 user 消息所在 turn 的 `turn/start` 之前）意味着：**文件系统应回到源会话里 seq ≤ boundary 事件结束后的状态**。等价于把源会话中 **seq > boundary** 的所有文件改动**逆序撤销**。

### 5.2 单文件恢复步骤

对每个被改动的文件 `F`：

1. 在源会话日志里收集 `F` 的写操作：`tool/call(name∈{write,edit,str_replace_editor})` + 对应 `tool/result`（按 `callId` 配对），且 `seq > boundarySeq`，按 seq 升序。
2. 读 `F` 当前内容（= 最后一次操作后的状态，因为 rewind 不改文件）。
3. **从最后一条往前**逐条反向应用：
   - `write`（before≠null）或 `edit`：把 `meta.diffs` 的每个 hunk 反向替换——在内容中把 `newText` 替换回 `oldText`（唯一命中校验）。
   - `write`（before=null，新建）：标记「最终应删除」；如果它之后还有对该文件的写操作，则先反向处理那些操作，最后删除。
   - `str_replace_editor`：`str_replace` → 把 `new_str` 换回 `old_str`；`insert` → 删除插入行；`create` → 标记删除。均需唯一命中校验。
4. 若任一步校验失败（找不到 / 多处命中），**放弃该文件**并报警告，绝不留下半恢复文件。
5. 全部成功后再按文件原子写回 / 删除。

### 5.3 为什么 write 的「±3 行上下文 hunks」仍能精确还原

`meta.diffs` 的 hunks 是 `computeHunkDiffs(before, after)` 的结果：hunk 的 `oldText`/`newText` 覆盖了**实际变化的行 + 3 行上下文**。只要当前内容 == `after`（逆序撤销保证每一层都回到上一层工具的 `after`），反向应用所有 hunks 就得到精确 `before`。**唯一的丢失场景**是 3.3 的 `write before=null`（新文件/无 before 基础）与 EOF 换行边界。

### 5.4 跨文件顺序与原子性

- 不同文件相互独立，可并行；同一文件必须严格逆序串行。
- 先对所有文件做「dry-run」计算出最终内容，全部校验通过后，再统一写回（单文件内先写临时文件再 rename，或直接用 `ctx.fs.writeText` 全量写）。

---

## 6. 插件设计（DecisionEvents 方案 — 备选/参考）

### 6.1 两种集成变体（参考，已被 §2 独立插件取代）

| 变体 | 触发时机 | 体验 | 需要的准入 |
|---|---|---|---|
| **A：模式注入（官方缝）** | `tui/rewind-prompt` 时返回一个 mode `{ id:'restore-files', label:'Also restore files to this point' }`，确认面板多一项选择；用户选中后，`tui/rewind-done` 执行恢复 | 每次 rewind 用户显式决定是否连文件一起回滚（最贴合文档描述 *"e.g. 'also restore files'"*） | Component + DecisionEvents 契约 + **`session.rewind.intercept` 权限 + grant** |
| **B：事后观察（轻量）** | 只 `tui/rewind-done`（observe 类，无 intercept 权限）；**每次** rewind 后自动恢复，摘要 toast | 无二次选择，回滚即文件一起回滚；可能误伤「只想回对话不想回文件」的场景 | Component + DecisionEvents 契约（**无需** intercept 权限/grant） |

> 设计建议：默认做 **A**（显式、可逆性可预期）；`session.rewind.intercept` grant 是本次方案唯一需要用户显式授予的新权限。若 grant 机制在 `endless-tui` profile 里调试成本过高，退到 **B**（自动恢复 + `tui/rewind-done` 摘要）作为首版，A 作为二期开关。

### 6.2 插件包结构（参考）

```
dsh-tui/plugins/rewind-file-restore/
├── dsh-plugin.json          # Component manifest（v0.15）
├── src/index.ts             # 插件入口：ctx.on('tui/rewind-prompt') + ctx.on('tui/rewind-done')
├── src/restore.ts           # 恢复算法（从源会话日志 → 文件变更计划 → 执行）
├── src/diff-reverse.ts      # hunk 反向应用 / str_replace 反向（纯函数，可单测）
└── src/restore.test.ts      # 单测
```

### 6.3 `dsh-plugin.json` 关键声明（参考）

```jsonc
{
  "name": "rewind-file-restore",
  "version": "0.1.0",
  "apiVersion": "community.dsh/v0.15",
  "requires": {
    "contracts": [
      { "apiVersion": "tui.dsh/v1alpha1", "kind": "DecisionEvents" }
    ]
  },
  "permissions": [
    { "name": "session.rewind.intercept", "scope": "tui/rewind-prompt" },
    { "name": "messages.observe.read",    "scope": "session:*" }
  ],
  "contributes": { "commands": [] }
}
```

（变体 B 只保留 `messages.observe.read`，去掉 `session.rewind.intercept`。）

### 6.4 事件处理器（参考）

**`tui/rewind-prompt`**（变体 A）：

```ts
ctx.on('tui/rewind-prompt', async (ev) => {
  // ev: { sessionId, cwd, text, seq }
  return { modes: [{ id: 'restore-files', label: 'Also restore files to this point' }] };
});
```

**`tui/rewind-done`**（A 与 B 共用；A 里按 `ev.mode === 'restore-files'` 判断，B 里无条件执行）：

```ts
ctx.on('tui/rewind-done', async (ev) => {
  // ev: { sessionId(=childId), cwd, text, mode, boundarySeq, sourceSessionId, childSessionId }
  if (mode === 'restore-files') {
    const summary = await restoreFiles(ev.sourceSessionId, ev.boundarySeq, ev.cwd);
    return summary; // 非空字符串会被 toast（如 "restored 3 files: a.ts, b.ts"）
  }
});
```

> 注意：处理器在 5 秒总预算内执行（`DECISION_TOTAL_TIMEOUT_MS=5000`，`extension-events.js`）。文件恢复若超过预算会「no-opinion」继续——所以**恢复动作应在 `tui/rewind-done` 里做，且内部可超时退出**（恢复失败不阻塞 rewind 本身，只给摘要/警告）。

### 6.5 依赖服务（参考）

| 服务 | ctx 键 | 用途 |
|---|---|---|
| 会话持久化 | `sessionPersistence` | `load(sourceSessionId)` 读源日志 |
| 文件系统 | `fs` | `readText` / `writeText`；删除用 `node:fs.unlink`（`ctx.fs` 无 unlink） |
| 命令（可选） | `commands` | 二期加 `/rewind-restore-status` 之类占位 |

---

## 7. 集成与挂载（endless-tui profile，独立 `/rewind` 插件）

独立插件是**薄插件**，与 approval-tui、rename-session 同一挂法，**无需 Component/manifest/grants**。

在 `~/.dsh/profiles/endless-tui/cordis.patch.yml` 的 `- insert:` 列表里加一行：

```yaml
- insert:
    - id: dsh-rewind
      name: '/Users/vito/data/dev/dsh-plugins/plugins/rewind-dsh.ts'
      inject: [agents, sessions, sessionPersistence, commands]
```

> 依赖：`agents` / `sessions` / `sessionPersistence` / `commands` 均来自 dsh-base（`endless-tui` 已含），无需额外配置。插件若缺任一服务，只在启动日志里 warn 并跳过注册，不影响 TUI。

验证：

```sh
cd ~/.dsh/profiles/endless-tui && npx dsh --profile endless-tui --dump-config   # 确认 dsh-rewind 已挂载
```

运行后 `/rewind` 应显示历史 user 消息列表；`/rewind <seq>` 执行回退 + 文件恢复 + 重启。

（注：原 §6 的 DecisionEvents 方案如未来想走「官方缝」，仍需要 Component + grants，但独立插件路线已覆盖同样需求，不再依赖它。）

---

## 8. 边界与限制（写进 README / 文档）

| 限制 | 处理 |
|---|---|
| `bash` 改文件不可恢复 | 检测到（通过 source 日志里 bash 输出难可靠判断）→ 至少文档明示；可选：rewind 前对比 `git status` 提示「有 bash 改动未纳入」 |
| `write` 覆盖二进制/超大（before=null） | 跳过并警告 |
| `str_replace_editor` 反向歧义（多命中） | 唯一命中校验失败 → 放弃该文件并警告 |
| EOF 换行边界（hunks join 丢换行标记） | 接受，测试覆盖；文档注明「极小概率差一个尾部换行」 |
| 会话日志缺 meta（旧版/其他后端） | `diffsFromMeta` 返回 undefined → 该文件放弃 |
| 恢复超时 | 命令 handler 内同步 await；大文件/大量文件耗时会让 TUI 在重放前暂停，恢复完成后才重启。无硬超时，但文件恢复本身快速（只写有改动的文件） |
| 非 UTF-8 / 二进制 | write before=null 场景即无法还原；编辑类不适用二进制 |

---

## 9. 风险与缓解（独立 `/rewind` 路线）

| 风险 | 等级 | 缓解 |
|---|---|---|
| execve 重启后 `sessionPersistence` 读不到子会话（create/append 未落盘） | 中 | 先持久化成功再 execve；失败则返回 error、不重启、留在当前会话 |
| 内置双 Esc rewind 仍存在（只回对话），用户可能误用 | 低 | 文档/提示：带文件回滚请用 `/rewind <seq>`；不改 TUI 本体（偏好：不修改本体） |
| write/EOF 边界导致非精确还原 | 低 | 算法校验 + 单测覆盖；fail-closed（不写半截文件） |
| 恢复文件被用户随后手动改过（rewind 后立刻改） | 低 | `/rewind` 命令本身是显式动作；文档提示「恢复会覆盖当前工作区文件」 |
| `bash` 改文件不可恢复 | 中 | 日志里 `bash` 类操作跳过并警告；二期可用 git 兜底（`/rewind-git`） |
| `replaceOnce` 全局唯一命中在罕见重复上下文下误判 | 低 | 失败即放弃该文件（不写坏），警告；二期可改按 hunk 位置反向 |

---

## 10. 实施状态与剩余计划（独立 `/rewind` 插件）

| # | 项 | 状态 |
|---|---|---|
| 0 | 文档定稿 | ✅ |
| 1 | 独立插件 `plugins/rewind-dsh.ts`（`/rewind` 命令 + fork + 持久化 + 文件恢复 + execve 重启） | ✅ 已实现 |
| 2 | 纯函数 + 单测 + 临时目录端到端测试 | ✅ `plugins/rewind-dsh.test.ts` 24 用例全绿 |
| 3 | 类型检查（tsconfig 纳入 `plugins/**/*.ts`） | ✅ |
| 4 | 挂载进 endless-tui profile（patch insert） | ⏳ 待用户执行/验证（见 §7） |
| 5 | 真实环境端到端验证（改文件 → `/rewind <seq>` → 文件回滚 + 重启） | ⏳ 待做（交互验证） |
| 6 | 收尾 commit | ⏳ |

> 待办以表格维护（偏好）。二期可选：`/rewind-restore-status`、git 兜底模式（方案 1）作为 `/rewind-git` 子命令。

---

## 11. 与方案 1（git 兜底）的对比与选择

| 维度 | 方案 2（本方案，日志逆向） | 方案 1（git 兜底） |
|---|---|---|
| 依赖 | 无（只要 dsh-tui 的日志有 meta.diffs） | 工作区是 git 仓库且有提交/暂存历史 |
| 覆盖 | write/edit（精确）+ str_replace（最佳努力） | 已提交/已暂存的全部改动（含 bash） |
| 未提交改动 | ✅ 日志里有就恢复 | ❌ git 没记录就救不回 |
| 实现量 | 中（独立插件，无 Component 准入） | 低（git checkout/reset） |
| 结构性前提 | rewind 是 fork 新会话，恢复基于源日志 | rewind 是 fork，git 边界靠时间/会话对齐 |

**建议**：方案 2（独立 `/rewind`）作为主体，符合「无 git 也能用」的诉求，且日志数据已验证存在；方案 1 可作为二期「`/rewind-git`」在同一插件里叠加，成本低、互补。

---

## 12. 验收标准（端到端，独立 `/rewind` 路线）

1. 在 `endless-tui` profile 里跑一轮：agent 用 `write`/`edit` 改 2 个文件 → 输入 `/rewind` 列出历史 → 选改动前那条 user 消息的 seq → `/rewind <seq>` → 进程重启进子会话，**文件内容回到边界点**（`diff` 与期望一致）。
2. 新建文件被删回不存在；`str_replace_editor` 改动的文件在唯一命中时恢复。
3. 不带参数 `/rewind` 只列历史、不碰文件。
4. 无 git 的工作区同样可用。
5. 恢复失败（如多命中）时该文件不被写坏，且日志给出警告（失败文件不阻塞 rewind 本身）。
