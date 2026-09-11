# im-dsh-tui — 终端前端架构设计

> 目标:`dsh --profile tui` — 把 pi-tui 渲染器作为 Cordis 插件挂进 dsh 进程内部,直接消费 in-process 服务,成为交互式终端编码 agent。
>
> 依据:被删的 `@deepseek-ai/dsh-tui`(2026-08-04 移除)归档设计笔记 + 现仓库实测。

## 状态(2026-08-23)

MVP 与二期主体均已实现:boot 全屏、prompt 提交、流式渲染、reasoning、注入 context 置灰、错误卡片、状态行(ctx gauge)、审批弹窗(ApprovalCard)、提问面板(含多选)、工具卡片(diff/terminal/search/read/web)、`/help` `/clear` `/exit` `/sessions` `/resume`(+picker) `/model` `/export` `/preset` `/new` `/rewind`、命令+文件自动补全、Shift+点选扩展、todos/subagents 气氛行。其中多数已活体验证,但 M1 白送档命令、S1 补全等仍标"待活体复测";`/model` 会话中切换已改为 `installModelSelection` 热切换并通过 TUI 手工验收（2026-08-29，见 `docs/model-hot-switch-design.md` §5.2）——**以 `docs/tui-feature-gap.md` 各行的验收栏为准**。

**现状与分档的唯一真源是 `docs/tui-feature-gap.md`**(基线、spike、验收记录);本文只描述分层架构与服务契约。剩余按需项见该文档 M3 档。

## 1. 定位与分层

原版核心决策(归档笔记原话):**TUI 是"terminal front door, not a complete application"**——一个 Cordis 插件,只拥有"终端输入与呈现";agent 生命周期、session 持久化、工具执行、模型提问工具都留在进程内的其他组合条目里。

> **例外（票据 06，用户裁定）**：`/rewind` 的 fork 子会话落盘由 TUI 经 `agents.create`
> 走宿主生命周期完成（`tuiHandoff.forkPersistedChild`）——rc.1 的持久化写句柄只在
> agent 生命周期内挂载，TUI 不能裸调 `sessions.fork` 后自行 flush。这是该分层原则的
> 唯一例外，不扩展到其他 agent/session 操作。

```
dsh CLI (launcher)                 # apps/cli: 解析 --profile tui,进程生命周期,resume execve
└─ ~/.dsh/profiles/tui/             # profile 目录: package.json (bundles) + cordis.patch.yml
   └─ bundle 层组合                   # 插件树 = 同一进程
      ├─ @deepseek-ai/dsh-base       # 核心: agent/session/llm/sandbox/approval/tools/projection...
      ├─ im-dsh-tui/startup   # (我们) 解析命令行 → provide tuiStartup
      └─ im-dsh-tui        # (我们) inject tuiStartup,拥有终端,消费 in-process 服务
```

## 2. 发布形态:bundle + profile

**Bundle 包**(我们的交付物,类比 headless):
- `package.json` 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`
- `cordis.patch.yml`(patch 层,覆盖 base):
  ```yaml
  - id: system-prompt
    config:
      persona: >-
        You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.
  - id: hmr
    disabled: true
  - insert:
      - id: tui-startup
        name: 'im-dsh-tui/startup'
      - id: tui-runner
        name: 'im-dsh-tui'
        inject: [tuiStartup]
  ```

**Profile**(用户侧 `~/.dsh/profiles/tui/`):
- `package.json`:`{ "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "im-dsh-tui"] } } }`
- `cordis.patch.yml`:用户覆写层
- 开发期:patch 可直接 `insert` 指向本地绝对路径 TS/JS 文件,无需发布

**startup → runner 两段式**(headless 模式,照抄):
- `lib/startup.js`:`inject: ['cmdlineArgs']`,`apply(ctx)` 里 `parseCmdline(ctx, program)`,`program.action(() => ctx.provide('tuiStartup', {...}))`
- `lib/index.js`:主插件,`inject: ['tuiStartup']`,持有终端主循环

## 3. 消费的 in-process 服务(全部已实测 API)

| 服务 | 消费方式 | 用途 |
|---|---|---|
| `Agent`(`ctx.agents` / 根部 agent) | `agent.send()` idle / `agent.steer()` running / `agent.cancel()` / `agent.whenIdle()` | 提交 prompt、steering、取消 |
| `session/event` | `ctx.on('session/event', (session, event) => ...)` post-commit 流 | transcript 重建 |
| `ctx.userQuestions` | rc.1: `ctx.on('user-questions/request', (request) => ...)` waterfall（服务对象本身只作挂载探测） | 模型 `ask_user_question` 工具的面板 |
| `ctx.approval` | `ctx.on('approval/request', (req, next) => Promise<ApprovalOutcome>)` waterfall | 权限审批弹窗 |
| `ctx.commands` | `commands.register({ name, description, handler })` | `/help` `/clear` `/exit` 等 |
| `ctx.tokenMeter` | `measure(session)` | footer context 占用 |
| `ToolCallView/ToolResultView` | host 投递时已算好,随 `session/event` 的 `view` 到达 | tool card 渲染 |
| `ctx.terminals`(可选二期) | `terminals.spawn/startSend/read` | PTY 视图 |

## 4. 终端所有权契约

- pi-tui 拥有:差分绘制、raw input、cursor state、alt screen、restore
- 进入前:stdin/stdout 必须都是 TTY,非 TTY **fail loud 且发生在 Loader boot 前**;等根 agent 就绪(`agent/created`)再进全屏;`agent-loop/config-start-failed` 在屏幕接管前报出
- ANSI 卫生:外部文本的 C0/C1(除换行)渲染为可见 hex 转义;只有 TUI 和 pi-tui 生成 ANSI 序列
- 调色板:标准 16 色 ANSI foreground + SGR 属性,正文/背景用终端默认值,选中用反显;`color: false` 关样式
- restore 时机:启动失败、退出、resume handoff、disposal

## 5. MVP 组件范围

**必须(前门成立的最小骨架):**
1. Prompt 编辑器 + 提交(`agent.send`)
2. transcript 渲染(assistant markdown / tool card / context card,折叠 Ctrl+O)
3. steering(`agent.steer`) + Esc/Ctrl+C 取消
4. user-questions 提问面板(FIFO overlay)
5. approval 审批弹窗
6. 16 色 palette + ANSI 卫生 + 终端 restore
7. `/help` `/clear` `/exit` 命令

**二期再上(已基本落地):** 文件+命令自动补全、`/resume` 跨 workspace picker + execve、`/model` 选择器均已实现;`/skill:`、step 计时、steering 队列徽标仍未做,归入 `docs/tui-feature-gap.md` 的按需档。

## 6. 验证方式

- 本地起 profile:`DSH_HOME=... npx dsh --profile tui`,交互手动测
- `--dump-config` 验证组合树
- 语义快照(二期):`HeadlessTerminal` 实现 pi-tui `Terminal` 接口 + `@xterm/headless` 钉住流式/浮层/折叠/resize/退出
