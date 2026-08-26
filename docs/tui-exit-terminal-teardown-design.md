# TUI 退出终端态泄漏修复设计（kitty 栈残留 + 退出乱码 + 关闭无反馈）

> 2026-08-26 用户报告：Ctrl+C 退出 tui-dev 后 shell 卡一会，随后出现
> `9;5:3u9;5u…` 类碎片并被 zsh 当命令执行（`command not found: 5u9`）；
> 之后在同一 iTerm2 tab 里按↑会追加 `:3A` 尾巴。

## 1. 症状 → 机制对照

| # | 现象 | 机制 |
|---|------|------|
| 1 | zsh 收到 `5u9` / `5:3u` / `1:3u` 碎片并当命令执行 | kitty keyboard protocol（CSI u）按键编码泄漏进 pty 输入队列；进程死后被 zsh 读走 |
| 2 | 碎片带 `:N` 后缀 | pi-tui 启动时推 **flags=7**（0x1 disambiguate \| **0x2 event types** \| 0x4 alternate keys），press/release 各产一条序列（`pi-tui/dist/terminal.js:13`） |
| 3 | 退出后按↑追加 `:3A` | iTerm2 kitty 协议**栈深未归零**：push 次数 > pop 次数，协议残留到整个 tab 生命周期 |
| 4 | Ctrl+C 后卡数秒才退 | `app.ts IDLE_EXIT_GRACE_MS = 5_000`：agent running 时 cancel 后等 settle（最多 5s），期间零反馈 |

## 2. 根因

### A. /rewind execve 前未恢复终端（根因 3，最重）

tui-dev 同时挂 `tui-runner`(lib/index.ts) 与 `dsh-rewind`(plugins/rewind-dsh.ts)。
双击 Esc 的 rewind picker 走 `/rewind <seq>` → **插件版** `relaunchToResume`
(rewind-dsh.ts:616) 直接 `process.execve`：

- 不 pop kitty（`\x1b[<u`）、不退 raw mode → 本次启动推的 flags=7 原样留在栈上；
- 新进程 start() 又推一次 → 每次 /rewind 重启栈深 +1；
- 之后任意一次 Ctrl+C 退出只 pop 一层 → 永久残留。

lib/index.ts:2371 自己的 `relaunchToResume` 有 `app.stopTerminal()`（正确），
插件版是早期复制品，漏了这步——典型的双实现漂移。

### B. 退出路径从不 drain 输入（根因 1/2 的乱码部分）

`TuiApp.stopAndExit()` 只调 `this.tui.stop()`。pi-tui 专门提供的
`drainInput(maxMs, idleMs)`（terminal.js:289：**先发 `\x1b[<u` 关协议**，
再吸收 pty 排队字节直到 idle）无人调用。`ClipboardTerminal.drainInput`
透传已备好（lib/terminal.ts:22），但整条退出链没有消费点。关闭窗口内敲的键
以 CSI-u 形态留在队列，进程一死灌给 zsh。

### C. 关闭窗口无反馈（根因 4）

grace 设计本身正确（防 wedge 的 agent 把终端留在 raw mode），但等待期间
界面静止，体感即"卡死"。

## 3. 修复设计

改动共 3 个文件，全部在本仓库。

### A. handoff 服务委托（消除双实现）

| 点 | 内容 |
|----|------|
| 服务名 | `tuiHandoff`（cordis service，`ctx.provide` 发布 / `ctx.get` 消费，与 `tuiStartup` 同款模式） |
| 发布方 | lib/index.ts `run()` 内，`relaunchToResume` 定义之后：`ctx.provide("tuiHandoff", { relaunchToResume })` |
| 形状 | `{ relaunchToResume(id: string): Promise<void> }` —— 内部已是 flush + chdir(目标 cwd) + stopTerminal + argv 剥 --resume + execve 的完整正确实现 |
| 消费方 | plugins/rewind-dsh.ts handler 里 `getService<{ relaunchToResume(id: string): Promise<void> }>(ctx, "tuiHandoff")`，命中则委托并 return；未命中（旧 runner 共存）走现有盲 execve 兜底，兜底前补最小 teardown：`stdin.setRawMode(false)` + `stdout.write("\x1b[<u\x1b[>4;0m\x1b[?2004l")`（pop-on-empty 按 spec 是 no-op，不会误伤外层） |
| inject | 不变（`[agents, sessions, commands]`；服务是运行时 get，不需注入声明） |

### B. 退出前 drain 输入

lib/app.ts `stopAndExit()`，在 grace race 之后、`this.tui.stop()` 之前插入：

```ts
await this.clipboardTerminal.drainInput(300, 50);
```

- drainInput 自身先关 kitty 再吸收，`stop()` 的 disable 全幂等，顺序安全；
- `(300, 50)`：最多 300ms、静默 50ms 即返回——常态开销 ≤100ms，只有真有排队字节才吃满；
- 不加 try/catch：该方法唯一异步点是 setTimeout 循环，无拒绝路径。

### C. 关闭即时反馈

`stopAndExit()` 入口（置 `stopping` 标志后）调一次现有 notice 通道显示
`exiting…`，随后照旧等 settle。`IDLE_EXIT_GRACE_MS` 数值不动。

## 4. 备选与取舍

| 方案 | 结论 |
|------|------|
| 仅在插件里盲写 teardown（3 行版） | 否：两份 handoff 实现继续并存，下次漂移（如 index.ts 再加逻辑）还会漏；不符合「标准服务补缺口」策略 |
| 缩短 / 移除 5s grace | 否：grace 防 wedge 是有意设计；缺的是反馈不是时限 |
| 在 pi-tui 上游修 stop() 自动 drain | 否：node_modules 内 vendor 包，且本仓已有 ClipboardTerminal 透传层，属可自控行为 |

## 5. 验证清单（定稿后逐项过）

| 场景 | 期望 |
|------|------|
| /rewind \<seq\> 重启后立即按 ↑ | 无 `:3A` 尾巴（kitty 栈归零） |
| 连续两次 /rewind 后再退出 | 同上 |
| agent 运行中双击 Ctrl+C | 立刻出现 exiting 提示；settle 后退出；zsh 无 CSI-u 碎片 |
| idle 会话双击 Ctrl+C | 正常退出、resume hint 完整、无碎片 |
| /resume picker 重启（index.ts 路径） | 回归正常（与 /rewind 共用新服务） |
| execve 不可用环境 | 盲写兜底生效 + 手动 resume 提示（既有行为保留） |

## 6. 发布影响

| 通道 | 影响 |
|------|------|
| tui-dev | 改动落盘即生效（profile 直挂源文件） |
| tui (stable) | 随下一次 `scripts/release.sh` 快照前进，无需额外动作 |

## 7. 改动面

| 文件 | 动作 |
|------|------|
| lib/index.ts | +provide `tuiHandoff`（约 5 行） |
| lib/app.ts | stopAndExit 加 drainInput + exiting 提示（约 4 行） |
| plugins/rewind-dsh.ts | handler 委托服务 + 兜底 teardown（约 12 行） |
