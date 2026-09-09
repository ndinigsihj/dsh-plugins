# dsh v0.1.2-rc.1 对自研 TUI 的影响分析与升级清单

> 日期：2026-09-07
> 范围：仅分析与文档，不包含代码修改。本文更新并取代 `dsh-v0.1.2-alpha.1-tui-impact.md`
> 中已过时的版本状态结论；alpha.1 文档中关于 storage / agent-presets 的 profile 清理结论继续有效。
>
> ## 0. 最新决策（2026-09-07）
>
> **跳过 0.1.2 系列升级，等待 0.1.3 rc。**
>
> - 0.1.2-rc.1 是已放弃的版本线，0.1.2 不会出正式版。
> - 0.1.3-alpha.1 已发布（GitHub），但尚未上 npm，且带 SessionHandle、session 锁、
>   Session v2、已知性能回退等破坏性变更；三个仓库（dsh-plugins / dsh-relay /
>   dsh-endless）需要一轮跨仓库适配。
> - 本文保留为 0.1.2 兼容性分析参考；待 0.1.3 rc 可安装后，再更新为 0.1.3 升级方案。

## 1. 结论先行

| 问题 | 结论 |
| --- | --- |
| 用户提到的 `0.1.2-rc.1` 是最新吗？ | **不是**。GitHub 最新 release 已是 `dsh-v0.1.3-alpha.1`（2026-09-04 发布）。`0.1.2-rc.1` 是 0.1.2 唯一也是最后一个 rc，0.1.2 不会出正式版。 |
| npm 能直接装 `0.1.2-rc.1` 吗？ | 能。`@deepseek-ai/dsh` 的 `latest`/`next` 目前都是 `0.1.2-rc.1`。`0.1.3-alpha.1` 尚未发布到 npm。 |
| 自研 TUI 是否为 `0.1.2-rc.1` 必须改代码？ | **必须**。`Session.events` 数组属性被移除，改为 `snapshotEvents()` / `seq` / `eventAt()`；TUI 的 `lib/index.ts` 和 `plugins/rewind-dsh.ts` 有多处直接读取 `session.events`。 |
| 升级 host 时 profile 是否要动？ | 要。三个 profile（tui / tui-dev / tui-central）仍有重复 storage 栈 insert，以及指向旧 shipped preset 目录的 `agent-presets.roots`。 |
| 是否建议把 `0.1.2-rc.1` 作为升级目标？ | 不建议作为长期目标。它是已放弃的版本线；`0.1.3-alpha.1` 有更大的破坏性变更且未上 npm。若现在必须走 npm 可安装版本，可把它当作过渡，只做兼容改动，不投入新功能。 |

## 2. 版本状态（2026-09-07 核对）

| 渠道 | 状态 |
| --- | --- |
| GitHub Releases 最新 | `dsh-v0.1.3-alpha.1`，2026-09-04 发布 |
| GitHub Releases | `dsh-v0.1.2-rc.1`，2026-09-03 发布，0.1.2 系列最后一个候选 |
| npm `@deepseek-ai/dsh` | `latest` / `next` 均为 `0.1.2-rc.1`；无 `0.1.3-alpha.1` |
| npm `@deepseek-ai/dsh-app-boot` | `latest` 仍为 `0.1.0-rc.6`，`next` 为 `0.1.2-rc.1` |
| 本地当前安装 | 全局 `@deepseek-ai/dsh@0.1.1-rc.2`，`node_modules/@deepseek-ai` 链接到该全局树 |

### 2.1 为什么建议不要追 `0.1.2-rc.1`

`0.1.2-rc.1` 发布于 2026-09-03，29 小时后项目发布 `0.1.3-alpha.1`，并携带更大破坏性变更：

- Session persistence API 改为生命周期持有的 `SessionHandle`
- `agentLoop.create()` 改为异步
- 新增 session 锁：同一 session 至多被一个进程持有
- Session 格式升级到 v2，旧日志通过相邻 generation 迁移
- 已知性能回退：部分历史 session 加载可能变慢，官方称下个版本修复

因此如果现在按 `0.1.2-rc.1` 做完整 UI 功能，很快要在 `0.1.3` 上重新对齐。

## 3. 升级到 `0.1.2-rc.1` 的完整清单

### 3.1 安装

```bash
npm i -g @deepseek-ai/dsh@0.1.2-rc.1

# 开发树与 stable 部署树分别重链
cd /Users/vito/dev/dsh-plugins && scripts/link-global-dsh.sh
cd ~/dev/dsh-plugins-stable && scripts/link-global-dsh.sh

dsh --version   # 期望 0.1.2-rc.1
```

不要用 `npm i` 穿透 `node_modules/@deepseek-ai` 符号链接；只重跑 link 脚本。

### 3.2 TUI 代码：`Session.events` 移除

#### 影响

旧 API：

```ts
session.events   // readonly SessionEvent[]
```

新 API：

```ts
session.snapshotEvents(fromSeq?, toSeqExclusive?)   // 完整/区间快照
session.seq                                        // 日志长度
session.eventAt(seq)                               // 单事件
```

语义上 `snapshotEvents()` 与旧 `events` getter 等价：返回当前已接受事件的冻结快照，且缓存到下一次 append。

#### 建议的双兼容 helper

在升级 host 前旧 host 仍用 `.events`，升级后新 host 没有 `.events`。加一个 helper 可两边兼容：

```ts
function sessionEvents(session: {
  events?: readonly unknown[];
  snapshotEvents?(): readonly unknown[];
}): readonly unknown[] {
  return session.events ?? session.snapshotEvents?.() ?? [];
}
```

#### 需要改动的位置（以当前 main 工作树为准）

`lib/index.ts`：

- 1503：`agent.session.events` → `sessionEvents(agent.session)`
- 1568：`sessionIsBlank(agent.session.events ...)` → `sessionIsBlank(sessionEvents(agent.session))`
- 1610：同上
- 1860：`pp.current(agent.session.events ...)` → `pp.current(sessionEvents(agent.session))`
- 2092：`rewindCandidates(agent.session.events ?? [])` → `rewindCandidates(sessionEvents(agent.session))`
- 2162-2164：`lastCacheRate` 与倒序遍历 `agent.session.events`，先取一次 `const events = sessionEvents(agent.session)`
- 2211：`fork.call(services.sessions, agent.session).events` → 先拿到 fork 结果，再 `sessionEvents(forked)`
- 2222：`recordedPresetOf(agent.session.events ...)` → `recordedPresetOf(sessionEvents(agent.session))`
- 2250：`next.session.events` → `sessionEvents(next.session)`
- 2622：`sessionIsBlank(agent.session.events ...)` → `sessionIsBlank(sessionEvents(agent.session))`
- 3235：`rewindSource.events` getter 内 `agent.session.events` → `sessionEvents(agent.session)`
- 3476：`lastUsageReport(agent.session.events ...)` → `lastUsageReport(sessionEvents(agent.session))`

`plugins/rewind-dsh.ts`：

- `SessionLike` 增加可选 `snapshotEvents?()`，`events` 改为可选
- 515：`events = root === undefined ? [] : [...root.session.events]` → `[...sessionEvents(root.session)]`
- 506 / 510 读取的是 `rewindSource.events` wrapper 或 fallback 快照，不是真实 `Session.events`，可保留

不要误改以下 `.events`：

- `lib/index.ts` 868-870、1493、2097/2100：来自 `sessionQuery.readSession()` 的 `SessionLogSnapshot.events`，该结构在 `0.1.2-rc.1` 仍存在
- `plugins/rewind-dsh.ts` 506：`rewindSource.events` 是 TUI 暴露的 wrapper 属性

### 3.3 Profile patch 清理

涉及文件：

- `~/.dsh/profiles/tui/cordis.patch.yml`
- `~/.dsh/profiles/tui-dev/cordis.patch.yml`
- `~/.dsh/profiles/tui-central/cordis.patch.yml`

改动：

1. 删除重复的 `storage`、`storage-json`、`storage-domain` insert；`dsh-base` 已内置，`storage-json` root 等价于 `dshHomePath('storages')`。
2. `session-projection-cache`：
   - 若保留自研频率 `writeEveryEvents: 400 / writeIntervalMs: 30000`，改为配置 patch：

     ```yaml
     - id: session-projection-cache
       config:
         writeEveryEvents: 400
         writeIntervalMs: 30000
     ```

   - 若接受 base 默认 `200 / 5000`，直接删除该 insert。
3. `agent-presets`：保留 insert 与 `default`，删除 `roots` 中指向 `@deepseek-ai/dsh/config/agent-presets/` 的路径表达式；`includeShippedRoot` 默认 true 会自动带 shipped presets。

### 3.4 回归清单

当拿到可安装版本并在 `tui-dev` 上验证：

```bash
npx tsc --noEmit
npm test
```

启动 `dsh --profile tui-dev`，确认：

- 无 duplicate storage / service conflict 日志
- `/model` 热切换
- `/effort`
- `/rename`
- `/rewind`（含双击 Esc picker）
- 审批卡
- `/preset`（含 broken 标记）
- `/sessions` / `/resume`
- minimal-plus preset 的 round-2 bash 交换与 AGENTS.md 注入仍正常

通过后再同步 `tui` / `tui-central`。

## 4. 新功能候选（0.1.2-rc.1）

| 候选 | 对自研 TUI 的价值 | 建议 |
| --- | --- | --- |
| 每轮 token 用量 + 耗时 | 高。TUI 已有 `/cost`、`/tokens`，缺按 assistant 回答末尾的 per-turn 明细 | 值得做，成本中等 |
| 连接状态 / 断线自动重连 | 中。配合 dsh-relay / fleet，可在状态栏或设备标签显示连接状态 | 可做，优先级低于前者 |
| 子代理模型 / reasoning 选择 | 低。TUI 不手动起子代理 | 暂缓 |
| `send_message` 双向子代理 | 主要是底层/展示侧，TUI 无新增 UI 需求 | 不主动做 |
| Web-only：折叠、宽度拖拽、字号、i18n、Provider 登录、Inspector、Web Preview | 不适用 | 不做 |
| 升级即白拿 | 持久 Bash/PowerShell 修复、Node 24 启动修复、`web_fetch` 默认开启、preset broken 标记、`/goal` 从 Minimal 移除 | 验证即可 |

若最终目标改为 `0.1.3-alpha.1`，不要在 `0.1.2-rc.1` 上投入新功能，只做必要的兼容改造。

## 5. 待讨论 / 下一步

> 2026-09-07 已定：**跳过 0.1.2-rc.1，等待 0.1.3 rc**。以下问题在 0.1.3 rc 可安装后重新讨论。

1. 是否按第 3 节清单先落 0.1.2 兼容改造？——**当前不执行**，等 0.1.3 rc。
2. 0.1.3 跨三仓库适配点（dsh-plugins 流式、dsh-relay SessionHandle/协议、dsh-endless JsonValue）是否在 0.1.3 rc 到达时先落设计文档？
3. 每轮 token 用量新功能是否纳入 0.1.3 升级，还是等目标版本确定后再做？

本文档不包含代码修改；确认方向后再动代码与 profile。