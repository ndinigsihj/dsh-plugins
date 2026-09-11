# dsh-plugins 回归测试自动化方案 v2（施工图）

> 状态：**计划 v2，待批准**。本版把所有已定决策（D1–D8 + Q1–Q27）落成可施工形态：
> 逐阶段改动文件清单、断言清单、验收命令、勘误附录。**批准后才动第一行代码**（Q21a）。
> 本版自身只改本文件，无代码改动、无 commit。
> 日期：2026-09-11。范围：`/Users/vito/data/dev/dsh-plugins`（**dev / tui-dev 侧**）。
> stable 侧（`presets/minimal-plus`、`dsh-plugins-stable` worktree、其钉住的 `0.1.1-rc.2`
> 运行时、`~/.dsh/.agent-presets/minimal-plus`）**全程不修改**（D3），边界见 §5.3。
> 依据：dsh 0.1.5-rc.1 升级（票据 01–13）的回归面——
> `docs/dsh-v0.1.5-rc.1-upgrade-closeout.md` §6.3、`docs/tickets/dsh-v0.1.5-rc.1-upgrade/evidence/13-stage7-fixes.md` §4。
> 约定：**已验证** = 本仓库代码/实跑可复现（本版所有事实均已逐条核对到文件:行）；
> **推断** = 未实测的预期。v1 中被证伪的前提全部进 §9 勘误表。

---

## 0. 决策记录

### 0.1 v1 时期（用户 2026-09-11）

| # | 决策 |
| --- | --- |
| D1 | 先不动代码，计划确定后再执行（→ 由 Q21a 具体化为「先出 v2 施工图，批准后施工」） |
| D2 | T2 场景脚本**手写**，不用真实日志回放（回放保留为后备） |
| D3 | **只动 tui-dev / dev 侧；stable 侧任何文件不修改** |
| D4 | 「体感」拆成可量化层与 advisory 层；模型判图（T4c）只做 triage，不入闸门 |
| D5 | P0 路径去绝对化**做全量**（dev 侧），不是「只让新脚本用相对路径」 |
| D6 | 部署位一致性检查允许显式豁免 `--allow-stale-deployment`（默认拒绝；release 路径永不带） |
| D7 | `TuiApp` 终端 seam 用**构造项注入** `TuiAppOptions.terminal`，不做工厂 |
| D8 | **T4b（PTY 冒烟）不接 release 路径**，只做按需运行 |

### 0.2 本轮（用户 2026-09-11，Q1–Q27）

| # | 决策 |
| --- | --- |
| Q1 | 本轮范围 = **P0 → P3.5 全链**（含 T2 / T4a / CI / T4b），P4 可选项一并纳入 |
| Q2 | 隔离策略 = **独立 `DSH_HOME`**：temp 副本 + 运行期重写指向本 checkout；真实 `~/.dsh` 零写入 |
| Q3 | 宿主基线钉 **0.1.5-rc.1**、会话格式版本 3；版本不符时 T3 **拒绝跑**（exit 2）并提示重采基线 |
| Q4/Q11 | 清理 M4/轨迹残留会话（50 + 7）、`/tmp/dsh-ticket04…13-*`（22 项）；删前打印清单；不碰其它 `dsh-*` /tmp 项与其余会话目录 |
| Q5 | seeded fixture 采用**原样字节快照**入库（含探针顺带读的父会话基线） |
| Q6 | 完成并通过验收后展示 diff，**经确认再 commit（不 push）**；每阶段各自确认（Q8a） |
| Q7 | 报告落 `experiments/regression-gate/results-<date>.json` 并入库 |
| Q8 | 每阶段完成即停下汇报，逐段确认后进下一段；commit 分批、每批单独确认 |
| Q9 | P4 纳入本轮（排最后，可随时砍） |
| Q10 | T4b 做**独立脚本**，`regression-gate.sh` 完全不引用它 |
| Q12 | 报告 JSON = 结构化 + **逐条断言**（schema 见 §5.2） |
| Q13 | stub 遏制三规则：只进 `--patch` overlay；闸门加反劫持断言；独立 provider 名不 shadow 真实路由 |
| Q14 | v1 事实漂移在本版一并校正（§9） |
| Q15 | 组合形态 = **自持「闸门组合」为默认** + `--composition real` **运行期渲染**真实 tui-dev profile（零写入 `~/.dsh`、无需提权）；`release.sh` 显式传 `real` |
| Q16 | 新增 `--skip-deployment-check`，报告区分 `absent` / `stale`；`--allow-stale-deployment` 仍专用于「改了 preset 没同步」 |
| Q17 | CI = 全 **hosted `macos-latest`**、零 secrets；若实测起不来再退 self-hosted |
| Q18 | 资产落点见 §4.4（`gates/**`、`lib/testing/**`、`lib/app.test.ts`、`scripts/**`、`experiments/regression-gate/**`） |
| Q19 | **T4a 进 `npm test`；T2 只进闸门 tier 2**（`npm test` 保持秒级） |
| Q20 | T4b 用**真实 tui-dev profile**；保留 repo 本地 flock 串行锁 |
| Q21 | 先出计划 v2 施工图，批准后才动代码 |
| Q22 | 重绘上界 = 数 PTY 原始流中的 `\x1b[2J`（扣除进入 alt-screen 那次）；T4a 侧用假终端捕获帧同类断言。**不**给生产代码加 `fullRedraws` 转发 |
| Q23 | T4b 验收 = 你本机手跑一次；P3 后加 `workflow_dispatch` 常驻入口；不提权 |
| Q24 | T2 驱动形态 = **进程内 driver**（`loadProfile` + `boot(patches)` 范式，同 `smoke-boot.mjs`），一场景一文件 |
| Q25 | stub overlay 内**关掉 `session-title-llm`**，并断言首个 `request/header.config` == `stub/stub-model` |
| Q26 | 12-2 的「红」用**临时回退修复**举证，证据入库，命令写进场景脚本头注释 |
| Q27 | 场景 4（06-1 fork 落盘）按「够不到就落 T4a」的规则实施 → 实测两层都够不到，落 **T4b**；由此产生的覆盖缺口见 **Q28（开放）** |

---

## 1. 问题：回归全靠手工闸门，没有单一入口

本轮 8 类真实回归，没有一类是现有 `npm test`（97 用例）能拦住的：

| 本轮真实回归/风险 | 发现方式 | 现有自动化 |
| --- | --- | --- |
| profile 重复 loader id（05-1） | 手工 `--dump-config` 逐 id 计数 | 无 |
| `session.events` 被移除（票据 04） | 冷启动崩溃 | 无 |
| seeded 子会话预览失效（06-4） | 真实 fixture 探针 | 有探针，未入统一入口 |
| 首轮 bash schema/registry 时序（12-2） | 真实模型会话日志观察 | 无 |
| 部署位 sha 与仓库漂移（05-5） | 手工 `shasum` 对比 | 无 |
| V3 会话不可逆迁移 | 文档约定 + 事后盘点 | 无 |
| 子代理模型选择 16/16（票据 11） | 真实模型探针 | 有探针，按需手跑 |
| M4 行为基线（票据 07/08/10） | N=9 批次 | 有 runner，按需手跑 |

现状资产：`npm test`（8 个测试文件，97 用例）、`npx tsc --noEmit`、
`presets/minimal-plus-next/smoke-boot.mjs`、`scripts/degrade-smoke.sh`、
`experiments/session-preview-seeded/run.sh`、`experiments/subagent-model-selection/{run.sh,run-route-probe.sh}`、
`experiments/m4/m4-runner.mjs`。问题不在缺工具，而在**散、无统一退出码、无版本闸门、部分硬编码本机路径**。

---

## 2. 目标与非目标

**目标**：一条命令跑完确定性闸门，退出码可判、报告可归档；把本轮踩过的坑固化为断言（零 LLM 组合层 +
stub 模型行为层 + 进程内 app 层）；宿主/preset/部署位变化后能明确知道「哪些基线失效」；
stable 与 dev 的回归边界写清，不留「看起来有测试其实没跑」的假绿。

**非目标**：不做整屏像素 golden；不把口径锚定率（56%/67%）当硬指标；不把依赖额度/网络的真实路由探针放进 CI；
**不修改 stable 侧任何文件**（D3）。

### 2.1 运行态定义

**用途**：在 tui-dev 部署态下做**交付前**回归；闸门默认跑「闸门组合」，`real` 模式跑真实组合（Q15）。

| 维度 | `gate`（默认） | `real`（交付前） |
| --- | --- | --- |
| 宿主 | 全局 `@deepseek-ai/dsh@<manifest.hostVersion>`（当前 0.1.5-rc.1，公共 registry 可装） | 同左 |
| 组合 | `gates/composition/gate.patch.yml`：dsh-base + 本仓库 `lib/startup.ts`、`lib/index.ts`、`plugins/rename-session.ts`、`plugins/rewind-dsh.ts` + preset `minimal-plus-next` | 真实 `~/.dsh/profiles/tui-dev/cordis.patch.yml` **运行期渲染**到 temp home |
| preset | 仓库 `presets/minimal-plus-next/`（`roots` 指向本 checkout） | 部署位 `~/.dsh/.agent-presets/minimal-plus-next/`（经渲染副本） |
| settings | 合成最小模板（无密钥、无个人 provider） | 真实 settings 的副本 |
| session | temp root | temp root |
| 依赖面 | **零外部仓库** | 需 `dsh-relay` + `dsh-endless` 两个相邻 checkout |

**已核实**：真实 tui-dev profile 有 **10 条绝对路径**，其中 **6 条指向另外两个仓库**
（`dsh-relay/src/client.ts` 1 条；`dsh-endless/src/{storage-plugin,capture,distill,inject,tools}.ts` 5 条），
本仓库 4 条（`lib/startup.ts`、`lib/index.ts`、`plugins/rename-session.ts`、`plugins/rewind-dsh.ts`）。
→ 这是 (a) 闸门组合必须自持、(b) `real` 模式必须运行期渲染的**唯一原因**。

**real 渲染规则**（Q15）：
1. 读源 profile，按 env `DSH_PLUGINS_ROOT` / `DSH_RELAY_ROOT` / `DSH_ENDLESS_ROOT`
   （默认：本 checkout 与相邻 `../dsh-relay`、`../dsh-endless`）替换三类仓库根；
2. 物化到 `$TMP/dsh-gate-home/profiles/tui-dev/`，连同 `settings.yaml` 副本、`sessions` root；
3. 报告同时记录**源 profile sha** 与**渲染后 sha**；
4. 源 profile 只读，`~/.dsh` **零写入**（Q2）。

**部署位一致性**（D6 + Q16）：`gate`/`real` 都做「仓库 ↔ `~/.dsh/.agent-presets/minimal-plus-next` 8 文件 sha」
只读比对；部署位不存在 → `absent`；不一致 → `stale`；两者都默认拒绝，分别用
`--skip-deployment-check` / `--allow-stale-deployment` 豁免并写入报告。

### 2.2 隔离与串行

- **零写入真实 `~/.dsh`**（Q2）：temp `DSH_HOME` 承载 profiles/settings/sessions/presets 副本。
  宿主启动会规范化回写 profile 的 `cordis.yml`（finding 01-2/09-4）——回写落在副本上，是接受的幂等写。
- **repo 本地 flock**（Q20ii）：`$REPO/.git/dsh-regression-gate.lock`，防两个终端并发抢共享 farm
  （`~/.dsh/profiles/node_modules` 随最近一次 boot 整代自愈，finding 03-2/05-7）。
- **farm 代断言**：闸门断言「farm 解析到的 `@deepseek-ai/dsh` 版本 == `manifest.hostVersion`」，不符即 exit 2。

---

## 3. 分层设计

| 层 | 内容 | 耗时 | 确定性 | 触发 |
| --- | --- | --- | --- | --- |
| **T0 静态** | `tsc --noEmit`；`npm test`；测试清单一致性（package.json 列出的文件都存在且可跑） | 秒级 | 高 | 每次改动 |
| **T1 零 LLM 组合闸门** | ① `smoke-boot` 锚定对/沙箱 bash/工具数 ② `degrade-smoke.sh` ③ seeded 预览探针 ④ `--dump-config` exit 0 + 逐 id 递归计数=1 ⑤ 部署位 sha ⑥ 宿主/会话格式版本 ⑦ 反劫持断言（组合中无 stub id） | 秒~1 分钟 | 高 | 每次改动 / 发布前 |
| **T2 stub 模型行为层** | 进程内 driver + 手写脚本，跑真实 agent loop（§3.1） | 秒~分钟 | 高 | 每次改动 |
| **T3 真实模型基线** | M4 N=9 行为锚定 9/9；子代理模型选择 16/16；允许路由 4/4 | 分钟级 | 中（额度/sampling） | 发布前 / 换宿主后 |
| **T4a 进程内 app 层** | 假 Terminal 驱动 `TuiApp`（进 `npm test`） | 秒级 | 高 | 每次改动 |
| **T4b PTY E2E** | 真 PTY + `@xterm/headless` 屏幕缓冲（独立脚本，按需） | 分钟级 | 中 | 换宿主 / 大改 TUI |
| **T4c 视觉 triage** | 模型判图，**advisory、永不 gate** | — | 低 | 人工触发 |

设计原则：**能确定就不烧额度**。T2 补的是「fake events 单测覆盖不到真实 agent loop 时序」与
「真实模型验证是概率性的」之间的空档。

### 3.1 T2：stub LLM 行为层（本版按实装接口重写）

**契约（已验证）**
- `LlmAdapter` 抽象类：`node_modules/@deepseek-ai/dsh-llm/lib/types/index.d.ts:126-183`，
  **只有 `stream(options)` 是抽象**；`providerInfo`/`listModels`/`resolveModel`/`prepareCall` 均有默认实现
  （`dsh-llm/lib/index.js:1618-1687`）。
- `GenerateOptions`（`dsh-llm/lib/types/types.d.ts:403-444`）：`provider`、`model`、`messages`、`tools?`、
  `temperature?`、`maxTokens?`、`stop?`、`signal?`、`sessionId?`、`purpose?`（`'compaction' | 'session-title'`）、
  `system?`。**注意字段名是 `system` 与 `signal`**（v1 写的 `systemPrompt`/`abortSignal` 是错的，见 §9）。
- `StreamChunk`（`types.d.ts:351-389`）：`block-start`、`text-delta`、`reasoning-delta`、
  `tool-call-delta{index,id,name?,argumentsDelta}`、`block-end`、`usage`、`finish{reason,replayState?}`。
  生产 adapter 的收尾顺序是「每个已开块一个 `block-end` → `usage` → `finish`」
  （`dsh-llm-deepseek/lib/index.js:1225-1247`），stub 照抄该形状。
- 装配器**容忍 delta-only**（无 `block-start/end` 也能拼）且缺 `id` 时合成 `call-${index}`
  （`dsh-llm/lib/types/assembler.js:54-63,100-105`）。
- 注册：`registerAdapter(providers: string[], adapter)`（`types/index.d.ts:240-248`；实装 `dsh-llm/lib/index.js:1780-1799`），
  返回可调用 disposer（另带 `.replace()`）；重名抛 `DUPLICATE_ADAPTER` 且**先全量校验再提交**
  （`lib/index.js:1805-1841`）→ stub 不可能半途污染真实路由。

**路由（已验证，决定怎么把请求导向 stub）**
优先级：per-agent `AgentOptions{provider,model}`（`dsh-agent/lib/types/runtime-types.d.ts:20-30`）
→ `agent/request` waterfall（`dsh-agent/lib/index.js:148-159`）
→ `agent-default-model` 组合行（`dsh-base/cordis.patch.yml:73-79`）
→ **settings 用户层覆盖组合行**（`dsh-settings/lib/index.js:327-343,508-510`）。
→ 只 patch 组合行不可靠（副本里若带 settings 就可能被覆盖）；**采用 driver 显式
`agentOptions` + `installModelSelection`**（repo 既有范式 `presets/minimal-plus-next/trajectory-driver.mjs:74-91`）。

**循环与断言面（已验证）**
- 每步 `prepareRequest` → `agent/request` waterfall → `llm.prepareCall`（`dsh-agent-loop/lib/index.js:1126-1163`）；
  是否执行工具由**装配后的 message 内容**决定（`:1116-1118`），不看 finish reason。
- 工具调用/结果落盘：`tool/call`（`:687-695`）、`tool/result`（`:697-703`）；
  下一轮请求的消息从会话日志派生（`deriveMessages`，`:1204-1211`），其中 **`tool/result` 角色是 `user`**
  （`dsh-session/lib/index.js:921-926,950-955`）。
- 断言只读会话事件：`request/header{config,tools}`、`tool/call{arguments}`、`tool/result{isError}`、`turn/end`。
  另可用 `ctx.on("session/event", …)`（repo 先例 `experiments/subagent-model-selection/probe.mjs:71-88`）。

**场景脚本形态（Q24）**：`gates/stub/scenarios/<id>.mjs`，每文件导出
`{ id, finding, turns, assert(events, ctx) }`；共用 runner `gates/stub/run.mjs`（进程内 `loadProfile`+`boot`）。
首批场景（对应 §5.4 断言）：
1. `bash-first-call`（12-2）：turn1 `bash{command}`（无 `description`）→ 断言 `tool/result.isError === false`
   且 `tool/call.arguments` 不含 `description`；turn2 补 `description`。
2. `bash-promotion-visible`（12-2 同源）：promotion 后沙箱 bash 可见；compaction 后回退 persistent。
3. `v3-resume-route`（票据 11）：V3 会话 resume 后首个 `request/header` 含 `list_subagent_models`。
4. `rewind-fork-persist`（06-1）：**落 T4b**（见 Q27/Q28）。
5. `delegation-policy`（票据 11）：省略路由继承父路由 / 集合外路由被拒（stub 下确定性复现）。

**确定性护栏（Q25）**：overlay 内 `{id:'session-title-llm', disabled:true}`（首条人类消息后会**并发**打同一路由：
`dsh-session-title/lib/index.js:380-394`；调用点 `dsh-session-title-llm/lib/index.js:196-232`；失败被吞 `:437-442`），
并断言首个 `request/header.config` == `stub/stub-model`（防「忘改路由→打到真实 provider→缺凭据」）。

**反劫持（Q13）**：stub 只出现在 `gates/stub/*.patch.yml`；provider 名 `stub`，不占用任何真实名；
T1 对部署态/闸门组合 dump 断言输出中不含 stub id 或 stub 模块路径。

**12-2 红绿举证（Q26）**：开发期临时回退修复跑一次，stdout + 报告落
`experiments/regression-gate/evidence/12-2-red.json`，命令写进场景脚本头注释，随后恢复。

### 3.2 T4a：进程内 app 层（进 `npm test`）

**seam（已验证）**
- `Terminal` 接口是 pi-tui 的：**15 个成员**（12 方法 + 3 getter），`node_modules/@earendil-works/pi-tui/dist/terminal.d.ts:14-36`；
  `drainInput(maxMs?, idleMs?): Promise<void>` 必须实现——`stopAndExit` 会调 `app.ts:2297`。
- 硬编码点：`lib/app.ts:1869` `private readonly terminal = new ProcessTerminal();`，`:1870` 被
  `ClipboardTerminal` 包住（`terminal.ts:26-32`，只有 `write` 被分流），`:1925` 交给 `new TuiAltScreen(...)`。
- `TuiAppOptions` 现无 `terminal` 项（`app.ts:114-148`）；`TuiApp` 全进程只构造一次（`lib/index.ts:1440`）。
- **剪贴板坑**：断言复制行为必须让 `isRemoteSession()` 为真（`clipboard.ts:13-15`，设 `SSH_CONNECTION=x`），
  否则要么真写系统剪贴板、要么断言恒绿。此注必须进测试注释。
- 终端恢复序列（已验证）：`pi-tui/dist/tui-alt-screen.js:135` 进入（`\x1b[?1049h`），
  `:153`/`:165` 退出（`\x1b[?1049l` + `\x1b[?25h`），且退出写在 `terminal.stop()` **之后**（`tui.js:476-485`）。

**改动**：`lib/testing/fake-terminal.ts`（实现 15 成员，捕获 `write()` 帧、经 `start(onInput)` 注入按键、固定
columns/rows）+ `lib/app.test.ts`（冷启动首帧/banner、状态行、Ctrl+C 与双 Esc、picker 流、审批/问答卡、
退出路径、终端恢复契约、复制走远程分支）。`TuiAppOptions.terminal?: Terminal`（D7：`= options.terminal ?? new ProcessTerminal()`）。

**不覆盖（属 lib/index.ts 闭包，须 T4b）**：`/model`、`/effort`、`/sessions`、`/rm`、`/resume`、`/exit`
（`lib/index.ts:1237-1438`）、`/rewind`（`plugins/rewind-dsh.ts:485`）。

### 3.3 T4b：PTY E2E（独立脚本，按需；D8 + Q10 + Q20 + Q23）

**依赖（已验证）**：`node-pty@1.2.0-beta.15`、`@xterm/headless@6.0.0` 都在全局宿主内嵌依赖树；
**裸模块名从 repo cwd import 失败，需绝对路径/`createRequire`**；node-pty 的 darwin-arm64 预编译存在且 `require` 成功；
`@xterm/headless` 必须 `allowProposedApi: true` 才能读 `buffer.active`；alt-screen 切换在 buffer 中可观察
（`alternate` ↔ `normal`）。**PTY 创建在本会话沙箱内被拒（`posix_openpt: EPERM`），未验证**——首次运行由你手跑（Q23）。

**硬前提（已验证）**：`lib/index.ts:827-832` 有 TTY 硬门（stdin/stdout 非 TTY 直接 `appExit(1)`），
**管道 stdio 无退路**；`ProcessTerminal.start()` 会 `setRawMode(true)`（`pi-tui/dist/terminal.js:82-83`）。

**形态**：`scripts/tui-pty-smoke.mjs` + 薄壳 `scripts/tui-pty-smoke.sh`（Q10：`regression-gate.sh` 不引用它）。
PTY 尺寸固定 120×30、`TERM=xterm-256color`；输出喂 `@xterm/headless`；用真实 tui-dev profile（Q20i，经 Q15 渲染）。

**可断言**：boot 至 banner；`/sessions`；`/rm` + 确认后 store 变化；`/model` 后下一条 `request/header.config` 换路由；
`/rewind` 后文件恢复 + **fork 子会话落盘且可 list（06-1，见 Q28）**；`/exit` 退出码 0 且输出含 `1049l` + `25h`；
屏幕缓冲归一化后结构断言（关键文案在位、无 ESC 残留、无超列宽）。
**时间量化（Q22）**：`agent/assistant-stream` 帧时间戳统计（首帧延迟、chunk 间隔 p50/p95）
+ 数原始流中 `\x1b[2J` 次数作全屏重绘上界（扣除 alt-screen 进入那次）。
**反脆弱**：轮询+超时（禁固定 sleep）；断言取稳定子串与**副作用**（会话日志/文件系统）；不做整屏 golden。

### 3.4 T4c：视觉 triage（advisory，永不 gate）

保留 v1 结论：几何/文本类断言优于判图；颜色类只有「真实像素」需截图且只能 advisory；时间类单张截图承载不了。
判图用于：闸门红后的分诊、发布前探索性体检、**从快照生成断言建议**（人审后进 T4a/T4b）。
前提：判定路由须**实测记录**能读图（模型 + 日期 + 结论）；优先喂屏幕缓冲文本而非 PNG；结论只写报告，不产生退出码。
本地 `~/.dsh/settings.yaml` 中多条路由声明 `input: [text, image]` 属**配置声明**，不等于上游能力（不得据声明推断）。

---

## 4. 前置改造（P0）

### 4.1 路径去绝对化（全量，仅 dev 侧；D3 + D5）

实测口径（2026-09-11 逐文件 `grep -c`）：dev 侧 **17 个文件 / 38 处**硬编码
`/Users/vito/data/dev/dsh-plugins`（**已复核与 v1 表格一致**）。另有 11 处命中在
`.dsh/ask-matt-flow/backups/*.yml`（历史 dump，已被 `.gitignore` 的 `.dsh/` 覆盖，**不处理**）。

| # | 文件 | 处数 | 迁移机制 |
| --- | --- | --- | --- |
| 1 | `presets/minimal-plus-next/test-helpers.mjs` | 1 | `import.meta.url` 推 ROOT + `DSH_HOST_DEPS_DIR` |
| 2 | `presets/minimal-plus-next/phase-swap-bash.test.mjs` | 4 | 同上（并入共享桩后自然消解，见 §8） |
| 3 | `presets/minimal-plus-next/smoke-boot.mjs` | 3 | 同上 |
| 4 | `presets/minimal-plus-next/smoke-driver.mjs` | 2 | 同上 |
| 5 | `presets/minimal-plus-next/trajectory-driver.mjs` | 3 | 同上 |
| 6 | `presets/minimal-plus-next/trajectory.patch.yml` | 2 | `roots[].path` 用 `!!js process.env.<VAR> ?? '<默认>'`；`insert.name` 用 `./trajectory-driver.mjs` |
| 7 | `experiments/m4/m4-runner.mjs` | 4 | `import.meta.url` |
| 8 | `experiments/m4/m4.patch.yml` | 1 | `insert.name: ./m4-runner.mjs` |
| 9 | `experiments/model-hot-switch-live-spike.mjs` | 4 | `import.meta.url` |
| 10 | `experiments/session-preview-seeded/probe.mjs` | 1 | `import.meta.url` |
| 11 | `experiments/session-preview-seeded/probe.patch.yml` | 1 | `insert.name: ./probe.mjs` |
| 12 | `experiments/subagent-model-selection/probe.mjs` | 3 | `import.meta.url` |
| 13 | `experiments/subagent-model-selection/probe.patch.yml` | 1 | `insert.name: ./probe.mjs` |
| 14 | `experiments/subagent-model-selection/route-probe.mjs` | 3 | `import.meta.url` |
| 15 | `experiments/subagent-model-selection/route-probe.patch.yml` | 1 | `insert.name: ./route-probe.mjs` |
| 16 | `plugins/rewind-dsh.ts` | 2 | 注释文本（示例路径改相对写法） |
| 17 | `scripts/release.sh` | 2 | **不动**：`DSH_STABLE_DIR` 部署默认值（非测试面）；要可移植另设 env |

**三种迁移机制（已核对源码）**：见 v1 §4.1 的三条（`import.meta.url` 推 ROOT + `DSH_HOST_DEPS_DIR`；
`insert.name` 用 `./` → `anchorInsertedPluginNames` 锚定 patch 所在目录，`dsh-app-boot/lib/index.js:1169-1178`；
`config` 值用 `!!js process.env.<VAR> ?? '<默认>'`，loader `internal/config` → `interpolate`，`lib/index.js:295-300,689`）。
**不改动清单**：`presets/minimal-plus/**`（stable，D3）、`experiments/m4/results-*.jsonl`（历史数据）、
`scripts/release.sh` 默认值、部署位 `~/.dsh/.agent-presets/minimal-plus-next/`（由 `sync-agent-presets.sh` 生成）。

**新增（Q15）**：`gates/composition/gate.patch.yml`（自持组合）与 `gates/composition/render-real.mjs`（运行期渲染）。

### 4.2 隔离与串行 → 见 §2.2（本版新增 flock 与 farm 代断言）。

### 4.3 版本闸门 `gates/manifest.json`

```json
{
  "gateVersion": 1,
  "hostVersion": "0.1.5-rc.1",
  "sessionFormatVersion": 3,
  "deployment": {
    "minimal-plus-next": {
      "path": "~/.dsh/.agent-presets/minimal-plus-next",
      "files": { "agent.cordis.yml": "<sha256>", "…": "…" }
    }
  },
  "baselines": {
    "m4-deduped-2026-09-10": { "sha256": "c2d4ef22…", "hostVersion": "0.1.5-rc.1", "runs": 9 }
  }
}
```

规则：T1 强制比对（不符即红）；T3 检测到宿主/格式版本变化时**拒绝跑**（exit 2）并提示重采基线。

### 4.4 测试资产与 fixture 清单

| 资产 | 用途 | 落点（Q18） | 当前状态 |
| --- | --- | --- | --- |
| seeded fixture 会话 | T1 seeded 预览探针（06-4） | `experiments/fixtures/session-preview-seeded/`（**原样字节快照**，Q5；含父会话基线） | 现在只存在于真实 store（`--private-tmp-dsh-ticket06-ws3--/session-6846f8fa-…`，48K zstd，cwd 已删） |
| V3 会话 fixture | T2 resume | `experiments/fixtures/`，用 stub 一次性生成 | 无 |
| settings 模板 | 隔离配置源 | `gates/fixtures/settings.min.yaml`（无密钥/个人 provider） | 现为「复制真实设置到 /tmp」 |
| profile overlay | 每探针隔离 patch | 现有 `experiments/*/*.patch.yml` + 新 `gates/stub/*.patch.yml` | 11/12 号探针已重定向 sessions |
| 假 Terminal / stub provider | T4a / T2 | `lib/testing/fake-terminal.ts`、`gates/stub/**` | 无 |
| 报告归档 | 证据留档 | `experiments/regression-gate/results-<date>.json` | 现默认落 `/tmp`，跨轮覆盖 |

**宿主写路径提示（已验证）**：`dsh` 启动会规范化回写 profile 的 `cordis.yml`（finding 01-2/09-4）→
隔离 home 下落副本；报告记录其 sha。

### 4.5 断言证据纪律

每条断言必须指向可核对的原始位置（会话日志事件 / 文件 sha / 进程退出码）；不引用模型自述、
不引用渲染文本作为机制证据（`docs/subagent-model-selection.md` 的 a7/route-probe 即此纪律）。T2 断言全部落在
会话事件：`request/header`、`tool/call`、`tool/result`、`subagent/model-selection-policy`、`agent-preset/selected`。

---

## 5. 落点

### 5.1 单一入口

```bash
scripts/regression-gate.sh --tier 0,1 --json experiments/regression-gate/results-2026-09-11.json
scripts/regression-gate.sh --tier 0,1 --allow-stale-deployment    # D6：豁免部署位 sha（stale）
scripts/regression-gate.sh --tier 0,1,2 --skip-deployment-check   # Q16：部署位缺席（absent，CI）
scripts/regression-gate.sh --tier 0,1 --composition real          # Q15：真实 tui-dev 组合（发版前）
```

- 返回码：全过 `0`；任一断言失败 `1`；环境前置不满足（宿主/格式版本不符、farm 代不符、组合渲染缺依赖）`2`。
- `--composition gate|real`（默认 `gate`）；`real` 缺 `dsh-relay`/`dsh-endless` → exit 2。
- **豁免语义**：`--allow-stale-deployment` 只豁免「仓库↔部署位 sha 一致」；`--skip-deployment-check` 只用于
  「部署位不存在」。两者都写 `exemptions: [{layer, reason: "stale"|"absent", detail}]` 并在 stdout 打印醒目警告——
  豁免绝不静默变绿灯。**闸门不自动同步部署位**（同步仍是显式 `scripts/sync-agent-presets.sh`）。
- `scripts/release.sh` 在 bump 前调用 `--tier 0,1,2 --composition real`，**永不传任何豁免参数**。

**交付前推荐序列**：① `scripts/sync-agent-presets.sh`（显式）→ ② `--tier 0,1,2 --composition real` 全绿 →
③ T3 按需 → ④ 人工签收。**T4b 不在此序列内**（D8）。

### 5.2 报告 schema（Q12）

```json
{
  "gateVersion": 1,
  "startedAt": "…", "finishedAt": "…",
  "gitHead": "…", "gitDirty": true,
  "hostVersion": "0.1.5-rc.1", "sessionFormatVersion": 3,
  "composition": "gate", "compositionSourceSha": "…", "compositionRenderedSha": "…",
  "deployment": { "status": "ok|stale|absent", "files": { "<name>": { "repo": "…", "deployed": "…" } } },
  "tiers": [
    { "id": "T0", "status": "pass|fail|skip", "startedAt": "…", "durationMs": 1234,
      "assertions": [ { "id": "tsc.noEmit", "status": "pass", "evidence": "exit 0", "detail": {} } ] }
  ],
  "exemptions": [ { "layer": "deployment-sha", "reason": "stale", "detail": "…" } ],
  "summary": { "passed": 0, "failed": 0, "skipped": 0 }
}
```

### 5.3 stable 侧的边界（D3）

- 现状：`npm test` 只列 `minimal-plus-next` 条目（已验证）；stable `minimal-plus` 无自动回归。
- 实测（2026-09-11，repo node_modules = rc.1）：stable 的 `tool-bootstrap/instruction-hint/skill-search/custom-bash`
  四个测试 32/32 仍绿；`phase-swap-bash.test.mjs` 5/11（6 红，语义绑定 rc.2）。
- 结论：闸门只面向 tui-dev / `minimal-plus-next` / dev 侧脚本；不为 stable 建跨代闸门、不把 stable 测试接进
  `npm test`；README 写明「stable 无自动回归，改 stable 文件须在其运行时手验」。

### 5.4 各层首批断言

| 断言 | 来源 | 层 |
| --- | --- | --- |
| 逐 loader id 递归计数 = 1 | 05-1/09 | T1 |
| R1 = `[bash, str_replace_editor]`；R2 含 `sandbox_permissions` + 工具数符合期望 | 设计基线 | T1 |
| 部署位 8 文件 sha = 仓库（或缺席/stale 走豁免并记账） | 05-5 + Q16 | T1 |
| 宿主版本 / `SESSION_FORMAT_VERSION` = manifest；farm 代 = 期望宿主代 | 07 + 03-2/05-7 | T1 |
| seeded 预览 8/8（含 `red-readSession-rejects-seeded` 红线） | 06-4 | T1 |
| 组合 dump 中不出现 stub id / stub 模块路径 | Q13 | T1 |
| 首个 `request/header.config` == `stub/stub-model` | Q25 | T2 |
| 首个 anchored bash 调用无 `INVALID_ARGS`（12-2 红→绿） | 12-2 | T2 |
| promotion 后沙箱 bash 可见；compaction 后回退 persistent | 12-2 同源 | T2 |
| V3 会话 resume 后首个 `request/header` 含 `list_subagent_models` | 11 | T2 |
| 委派策略：省略路由继承父路由；集合外路由被拒 | 11 | T2 |
| 启动帧含 alt-screen 进入；退出帧含 `\x1b[?1049l`+`\x1b[?25h`；Ctrl+C 双按退出 | `ARCHITECTURE.md` | T4a |
| 冷启动首帧 banner 含 route/preset；picker 流可驱动并返回选中值 | 票据 05/06 | T4a |
| 复制断言走 `SSH_CONNECTION` 远程分支（否则污染剪贴板/恒绿） | 本版新增 | T4a |
| `/model` 后 `request/header.config` 换路由；`/rm` 后 store 目录消失；`/exit` 退出码 0 | 05/06 | T4b |
| `/rewind` 后文件恢复 + fork 子会话落盘且可 list | 06-1 | **T4b**（Q27/Q28） |
| 屏幕缓冲归一化后：文案在位、无 ESC 残留、无超列宽 | §3.3 | T4b |
| 首帧延迟 / chunk 间隔 p95 / `\x1b[2J` 次数上界 | §3.3 + Q22 | T4b |
| 行为锚定 9/9 | 07/08/10 | T3 |

---

## 6. 已知问题（随 P1/P3 修，均限 dev 侧）

1. `.github/workflows/custom-bash-win-smoke.yml` 触发路径写 `presets/liangshen-bash/**`（该目录**已不存在**，
   已验证）→ workflow 永不触发。P3 改指 `presets/minimal-plus-next/**`，并把脚本内 preset 路径参数化。
2. `npm test` 未覆盖 `lib/session-preview-log.ts` 解析逻辑（只有真实 fixture 探针覆盖）。
3. `tsconfig.json` 只 include `lib/**` + `plugins/**`；preset `.mjs` 与 `gates/**` 不在类型检查面内。
4. M4 直接 `agents.create` 写真实 `~/.dsh/sessions`，无清理步骤（残留实测 **50** 个 `session-m4-*`，
   另有 **7** 个 `session-trajectory-*`；v1 记 41 见 §9）→ P1 改隔离 session root + 清理（Q11）。
5. 探针输出默认落 `/tmp/dsh-ticket1x/…`，跨轮覆盖、无归档约定 → P1 统一落 `experiments/regression-gate/`。
6. 测试脚手架未统一：`test-helpers.mjs` 被 6 个测试文件复用，`phase-swap-bash.test.mjs` 自带 `boot()` → P2.5 并入。
7. seeded 探针 boot 会写 profile 的 `cordis.yml`（宿主规范化，01-2）；隔离 home 下落在副本上（Q2 已解决）。

---

## 7. 分阶段任务（**批准后施工**；每阶段停下汇报，Q8a）

| 阶段 | 改动文件（预计） | 验收 |
| --- | --- | --- |
| **P0** | §4.1 的 16 个文件（`release.sh` 除外）；新增 `gates/manifest.json`、`gates/composition/gate.patch.yml`、`gates/composition/render-real.mjs`、`gates/fixtures/settings.min.yaml`、`experiments/fixtures/session-preview-seeded/*`；本文件的勘误（§9 已在本版完成） | 任意 checkout 上 `--tier 0,1` 可跑；dev 侧 grep 无残留绝对路径（`release.sh` 除外）；stable 零改动（`git diff` 证明） |
| **P1** | `scripts/regression-gate.sh`、报告 JSON（§5.2 + exemptions）、`release.sh` 接线、M4/trajectory runner 隔离写、seeded 探针改读入库 fixture、清理 50+7 残留会话 + 22 个 `/tmp` 项（Q11） | 一条命令全绿 exit 0；人为破坏断言 exit 1 / 环境不符 exit 2；带豁免时报告出现 `exemptions` + stdout 警告；release 路径不带豁免 |
| **P2** | `gates/stub/{adapter.mjs,run.mjs,scenarios/*.mjs,stub.patch.yml}`；`experiments/regression-gate/evidence/12-2-red.json`（Q26） | 12-2 红→绿可复现且零额度；首请求路由断言生效；组合 dump 无 stub（Q13） |
| **P2.5** | `lib/app.ts`（`TuiAppOptions.terminal`，D7）、`lib/testing/fake-terminal.ts`、`lib/app.test.ts`、`package.json`（test 清单）、`phase-swap-bash.test.mjs` + `test-helpers.mjs`（桩统一） | 新测试进 `npm test`；人为删 `tui.stop()` 时终端恢复断言变红；复制断言只在远程分支 |
| **P3** | `.github/workflows/regression-gate.yml`（hosted macOS，T0/T1/T2/T4a）；修 §6-1 stale workflow；README 闸门用法；清理残留探针会话 | push 后 CI 绿；workflow 路径可触发；CI 跑 `--skip-deployment-check`（absent 记账） |
| **P3.5** | `scripts/tui-pty-smoke.mjs`、`scripts/tui-pty-smoke.sh`（独立，Q10） | 你手跑 exit 0（Q23）；删断言/改坏路由时 exit 非 0；`release.sh` diff 中不出现该脚本（grep 证明） |
| **P4**（可选） | T3 归档规范化（报告含宿主版本/preset sha/日期）；`docs/` 下 T4c 流程文档 | 换宿主后 `--tier 3` 拒绝跑并提示重采；T4c 记录含判定模型 + 日期 + 读图实测结论 |

依赖顺序：P0 → P1 →（P2 可与 P3 并行）→ P2.5 → P3.5 → P4。T4a 依赖 P0 的依赖树 env；
T4b 依赖 P2 的 stub provider 与 P0 的隔离/串行约定。

---

## 8. 风险与开放问题

- **Q28（开放，需裁决）— 06-1 的覆盖缺口**：`forkPersistedChild` 定义在 `lib/index.ts:3256-3305`、服务发布在
  `3366-3372`，都在 `run()`（`:821`）内且受 TTY 硬门（`:827-832`）约束；`TuiApp` 也在 `run()` 里构造（`:1440`）。
  因此该路径**既够不到 headless driver、也够不到 T4a**，只能由 T4b（真 PTY + 真 profile）覆盖，而 T4b 按 D8
  **不在 release 闸门内**。三个选项：(a) 接受该缺口，只留 T4b 按需覆盖（当前计划写法）；
  (b) 给 `lib/index.ts` 增加终端/驱动注入 seam，使其可在进程内 T4a 覆盖（生产改动，违反「非必要不动」）；
  (c) 测试侧伪造 `process.stdin/stdout` 的 TTY 语义 + 真 `ProcessTerminal`（零生产改动，但脆弱）。
  → 默认按 (a) 施工；若你要 (b)/(c) 请指定。
- **stub adapter 的保真度**（推断）：覆盖时序与 schema 类回归，覆盖不了 provider 侧真实行为（429/传输错误分类）→ T3 不可省。
- **真实模型批次波动**：M4 口径锚定率对措辞敏感已实证 → T3 只取行为锚定并设容忍度。
- **宿主代切换频率**：每次升级都要重跑 T1 + 重采 T3，是成本主要来源。
- **hosted CI 可行性**（Q17）：宿主可从公共 registry 安装（已验证 HTTP 200、`~/.npmrc` 无 token），但
  「干净 runner 上能否起 headless 组合」尚未实测 → P3 的验收事实，不行就退 self-hosted/ubuntu。
- **隔离副本与真实部署态的差异**（Q2/Q15）：闸门验的是渲染副本；靠「源 sha + 渲染 sha + 部署位 sha」三层记录兜底，
  但逐字节等价性只在 `real` 模式下成立。
- **spy 式 boot 桩统一**：`presets/minimal-plus/test-helpers.mjs` 属 stable 副本，按 D3 不动，两份差异保留。
- **T4b 依赖不在 package.json**：node-pty/@xterm 是宿主内嵌依赖，路径随宿主版本变化 → 脚本须按
  「从宿主安装锚点推导」并给出清晰报错，不可硬编码 nvm 路径（P3.5 落）。
- **D3 的副作用**：去绝对化后两份 preset 的测试文件长期不一致（有意取舍，README 注明）。

---

## 9. 勘误表（v1 → v2，均为实测校正）

| # | v1 写法 | 实测 |
| --- | --- | --- |
| 1 | M4 残留 **41** 个 `session-m4-E*` | **50** 个 `session-m4-*`；另有 **7** 个 `session-trajectory-*` |
| 2 | stable 运行时在「`dsh-runtime/stable`」 | `~/.dsh` 下**不存在**任何 `dsh-runtime` 目录；唯一隔离运行时是 `dsh-plugins-stable/node_modules/@deepseek-ai/dsh` @ `0.1.1-rc.2` |
| 3 | §4.1 未提 `.dsh/ask-matt-flow/backups/*` | 另有 11 处命中（gitignored，不处理） |
| 4 | `GenerateOptions.systemPrompt` / `abortSignal` | 实为 **`system`** / **`signal`**（`dsh-llm/lib/types/types.d.ts:403-444`） |
| 5 | `Terminal` 接口 14 个方法 | **15** 个成员（12 方法 + 3 getter），含 `drainInput` |
| 6 | `pi-tui` 叙述为全局树内 | 是**本仓库依赖** `@earendil-works/pi-tui@0.84.1`（行号引用无误） |
| 7 | 读 `fullRedraws` 计数 | T4b 跨进程读不到；改数原始流 `\x1b[2J`（Q22）；仓库内无任何 `fullRedraws` 引用 |
| 8 | `/rewind` 在 `lib/index.ts` 命令注册块内 | 在 `plugins/rewind-dsh.ts:485`；`lib/index.ts` 的注册块是 `:1237-1438` |
| 9 | 「rewind/fork 子会话落盘」归 T2 | 归 **T4b**（见 Q28） |
| 10 | 真实 profile 只差去绝对化即可移植 | profile 有 **10** 条绝对路径，**6** 条指向 `dsh-relay`/`dsh-endless` 两个外部仓库 → 门槛提升为「闸门组合 + 运行期渲染」（Q15） |
| 11 | 重绘/alt-screen 序列行号 `dist/tui-alt-screen.js:9-10,135,153` | 引用正确（另有 `:165` 为默认分支，退出写在 `terminal.stop()` 之后） |
| 12 | 探针 PTY 依赖「已验证」 | 仅**可加载**已验证；**PTY 创建未验证**（会话沙箱 `EPERM`，提权被拒） |

---

## 10. 复验命令（现状基线，供 P0/P1 对照）

```bash
npx tsc --noEmit && npm test                      # 0 错 / 97 通过
node presets/minimal-plus-next/smoke-boot.mjs     # 零 LLM 组合冒烟
scripts/degrade-smoke.sh                          # fail-open 降级
experiments/session-preview-seeded/run.sh         # seeded 预览 8/8
experiments/subagent-model-selection/run.sh       # 模型选择 16/16（真实模型）
experiments/subagent-model-selection/run-route-probe.sh  # 允许路由 4/4（真实模型）
M4_GROUPS=E M4_RUNS=9 M4_OUT=/tmp/m4.jsonl node experiments/m4/m4-runner.mjs  # 行为基线（真实模型）
```
