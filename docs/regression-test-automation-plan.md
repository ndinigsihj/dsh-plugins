# dsh-plugins 回归测试自动化方案（计划）

> 状态：**计划，未实施**（已 commit，未 push；本轮无任何代码改动）。用户 2026-09-11 裁定
> 「先不动代码，计划确定再说」——本文只出方案，全部阶段待批准后才执行。
> 决策记录见 §0（D1–D8）。
> 日期：2026-09-11。范围：`/Users/vito/data/dev/dsh-plugins`（**仅 dev / tui-dev 侧**）。
> stable 侧（`presets/minimal-plus`、`~/.dsh/.agent-presets/minimal-plus`、`dsh-plugins-stable`
> worktree、`dsh-runtime/stable` 的 0.1.1-rc.2 运行时）**本轮与后续阶段都不修改**，边界见 §5.3。
> 依据：本轮 dsh 0.1.5-rc.1 升级（票据 01–13）的实际回归面——
> `docs/dsh-v0.1.5-rc.1-upgrade-closeout.md` §6.3、`docs/tickets/dsh-v0.1.5-rc.1-upgrade/evidence/13-stage7-fixes.md` §4。
> 约定：文中「已验证」= 本仓库代码/实跑可复现；「推断」= 未实测的预期。

## 0. 决策记录（用户 2026-09-11）

| # | 决策 | 影响章节 |
| --- | --- | --- |
| D1 | **先不动代码，计划确定后再执行** | §7 全部阶段标记为「待批准」 |
| D2 | **T2 脚本来源用手写**（不用真实日志回放） | §3.7 |
| D3 | **测试只允许 tui-dev；stable 的不能动** | §2 非目标、§4.1、§5.3、§6-1 |
| D4 | T4 的「体感」能否用模型截图判定 → 结论：**拆成可量化与 advisory 两层**，模型判图仅作 triage，不入闸门 | §3.8 |
| D5 | P0 路径迁移**做全量**（dev 侧），不是「只让新脚本用相对路径」——闸门的目标态是 tui-dev 部署态交付前回归，必须整条链路可移植 | §2.1、§4.1 |
| D6 | 部署态一致性检查**允许显式豁免** `--allow-stale-deployment`（默认拒绝；用于「正在改 preset、尚未同步部署位」的日常迭代），但豁免必须写进报告，且 release 路径永不带该参数 | §5.1 |
| D7 | `TuiApp` 的终端 seam 用**构造项注入**（`options.terminal`），不做工厂 | §3.6 |
| D8 | **T4b（PTY 冒烟）不接进 release 路径**，只做按需运行（脚本化、可重复，但不作为发版前置门禁） | §3.6、§5.1.1、§7 P3.5 |

## 1. 问题：回归全靠手工闸门，没有单一入口

本轮的 8 类真实回归，没有一类是现有 `npm test`（97 用例）能拦住的；全部靠手工命令与现场观察：

| 本轮真实回归/风险 | 发现方式 | 现有自动化 |
| --- | --- | --- |
| profile 重复 loader id（finding 05-1） | 手工 `--dump-config` 逐 id 计数 | 无 |
| `session.events` 被移除（票据 04） | 冷启动崩溃 | 无（preset 单测直接调插件，不跑真实组合） |
| seeded 子会话预览失效（finding 06-4） | 真实 fixture 探针 | 有探针，未入统一入口 |
| 首轮 bash schema/registry 时序（finding 12-2） | 真实模型会话日志观察 | 无（且单测因 fake events 无法覆盖） |
| 部署位 sha 与仓库漂移（finding 05-5） | 手工 `shasum` 对比 | 无 |
| V3 会话不可逆迁移 | 文档约定 + 事后盘点 | 无 |
| 子代理模型选择 16/16（票据 11） | 真实模型探针 | 有探针，按需手跑 |
| M4 行为基线（票据 07/08/10） | N=9 批次 | 有 runner，按需手跑 |

现状的可执行资产：
`npm test`（8 个测试文件）、`npx tsc --noEmit`、`presets/minimal-plus-next/smoke-boot.mjs`（零 LLM 组合冒烟）、
`scripts/degrade-smoke.sh`（fail-open 降级）、`experiments/session-preview-seeded/run.sh`（seeded 预览探针）、
`experiments/subagent-model-selection/{run.sh,run-route-probe.sh}`（模型选择/路由探针）、
`experiments/m4/m4-runner.mjs`（行为基线）。问题不在缺少工具，而在**它们是散的、无统一退出码、无版本闸门、部分硬编码本机路径**。

## 2. 目标与非目标

**目标**

1. 一条命令跑完「确定性闸门」，退出码可判、报告可归档。
2. 把本轮踩过的坑逐项固化为断言，含**零 LLM 的组合层**与**stub 模型的行为层**。
3. 宿主升级 / preset 改动 / 部署位同步后，能明确知道「哪些基线失效、需要重采」。
4. stable 与 dev 的回归边界写清楚，不留「看起来有测试其实没跑」的假绿。

**非目标**

- 不做整屏像素 golden（视觉验证的边界见 §3.8：可量化的量化，其余 advisory 或人工）。
- 不把口径锚定率（56%/67%）当硬指标——它对开场措辞过敏（finding 10-2），只保留行为锚定。
- 不把依赖额度/网络的真实路由探针放进 CI。
- **不修改 stable 侧任何文件**（D3）：`presets/minimal-plus/**`、stable worktree、0.1.1-rc.2 运行时、
  `~/.dsh/.agent-presets/minimal-plus` 都不在改动面内；stable 的既有绿灯口径保持原样，只做文档说明（§5.3）。

### 2.1 运行态定义（用途决定形态，D5）

**用途**：在 **tui-dev 部署态**下做**交付前**的自动化回归。因此闸门的「被测对象」不是仓库里的源文件，
而是 TUI 实际加载的那套东西：

| 维度 | 交付前闸门的取值 | 说明 |
| --- | --- | --- |
| 宿主 | 全局 `@deepseek-ai/dsh@<manifest.hostVersion>`（当前 0.1.5-rc.1） | rc.1 语义（`snapshotEvents`、persona 字段、30 工具面） |
| profile | `tui-dev`（`~/.dsh/profiles/tui-dev/cordis.patch.yml` + 规范化回写的 `cordis.yml`） | 真实部署 profile，不是临时自造 |
| preset | **部署位** `~/.dsh/.agent-presets/minimal-plus-next/`（8 文件） | TUI 冷启动的真实加载源（finding 05-5） |
| 会话/settings | 隔离副本（temp DSH_HOME 或 overlay 重定向） | 不得污染用户真实 store |

由此推出两条硬约束：

1. **仓库 ↔ 部署位一致性是前置断言**，不是可选项：仓库绿灯 ≠ 部署位生效（finding 05-5）。
   豁免只走 `--allow-stale-deployment`（D6，§5.1），且写进报告。
2. **链路必须可移植**（D5）：闸门从 `scripts/regression-gate.sh` → 零 LLM 冒烟 → 探针 → preset 单测
   是一条真实调用链，链上任何一环写死 `/Users/vito/data/dev/dsh-plugins/...`，CI / 别的 checkout /
   stable worktree 就跑不了，「交付前回归」就无法在发布流程里自动触发。这是选择全量迁移的唯一原因。

零 LLM 探针无法起真实 TUI 时，用 `--profile headless --patch <overlay>` + **部署位 preset**
（`SMOKE_PRESET_ROOT=~/.dsh/.agent-presets`，该开关已存在，已验证）作为等价运行态；
T4b 的 PTY 冒烟才起真实 `--profile tui-dev`。

## 3. 分层设计

| 层 | 内容 | 耗时 | 确定性 | 触发 |
| --- | --- | --- | --- | --- |
| **T0 静态** | `tsc --noEmit`；`npm test`（97）；测试清单一致性校验（package.json 列出的文件都存在且可跑） | 秒级 | 高 | 每次改动 |
| **T1 零 LLM 组合闸门** | ① `smoke-boot`（R1 锚定对 / R2 沙箱 bash + 工具数）② `degrade-smoke.sh` ③ seeded 预览探针 ④ `--dump-config` exit 0 + 逐 id 递归计数=1 ⑤ 仓库↔部署位 preset sha 一致 ⑥ 宿主版本 + 会话格式版本断言 ⑦ `x-opencode-session` 补丁在位 | 秒级~1 分钟 | 高 | 每次改动 / 发布前 |
| **T2 stub 模型行为层** | 用 `ctx.llm.registerAdapter()`（`node_modules/@deepseek-ai/dsh-llm/lib/index.js:1780`，已验证存在）注册固定回放 adapter，跑真实 agent loop：首个 anchored bash 调用不再 `INVALID_ARGS`、promotion 后目录含 `sandbox_permissions`、rewind/fork 子会话落盘、V3 会话 resume、compaction 回退/再 promote | 秒级~分钟级 | 高 | 每次改动 |
| **T3 真实模型基线** | M4 N=9 行为锚定 9/9；子代理模型选择探针 16/16；允许路由探针 N/N | 分钟级 | 中（sampling/额度） | 发布前 / 换宿主后 |
| **T4 人工清单** | TUI 冷启动、`/model`、`/effort`、`/rewind`、`/sessions`、`/rm`、`/resume` hover 预览、exit 0 | 分钟级 | 人工；自动子集 T4a 进 CI / T4b 按需（D8） | 发布前 |

设计原则：**能确定就不烧额度**。T2 是当前最大缺口——本轮 finding 12-2 已经证明：
（a）fake events 单测覆盖不到真实 agent loop 的 append/prepare 时序；
（b）真实模型验证是概率性的（route-probe 5 个会话中只有 2 个撞上 `INVALID_ARGS`）。
stub adapter 正好补中间这段，且零额度、可进 CI。

### 3.6 T4 的自动化子集（T4a / T4b）

T4 可拆成「可自动」与「须人工」两部分，自动化依赖 T2 的 stub provider 与 P0 的隔离约定。

**T4a 进程内 app 层（确定性，进 CI）**——已核实可行的 seam：

- `TuiApp` 依赖注入面完整：`TuiAppOptions.agent` 是抽象 `AgentSurface`（`lib/app.ts:114-140`），
  `pickSession`/`pickRewindPoint`/`askQuestion`/`askPlanReview`/`askApproval`/`start`/`stopAndExit`
  均为公开方法，可直接驱动。
- 唯一硬编码：`private readonly terminal = new ProcessTerminal()`（`lib/app.ts:1869`）。**注入形状按 D7 取构造项注入**：
  `TuiAppOptions.terminal?: Terminal`，实现为 `= options.terminal ?? new ProcessTerminal()`。
  理由（已核实）：`new TuiApp` 全进程只发生一次（`lib/index.ts:1440`），`/attach`、`/detach` 走
  `app.setAgent()`（1728/2326）不重建终端，`stopTerminal()`（3337/3342）之后进程走 rewind 的 execve
  换新进程——「同进程重建终端」的需求当前不存在，工厂（`terminalFactory`）的惰性/可重建/可读 app 状态
  三个能力都用不上，属可逆决定；将来真需要再升级。
- **注入点在裸 terminal**：`ClipboardTerminal` 会包住注入的假终端（1870），而它会把 OSC 52 写改走
  原生剪贴板（`lib/clipboard.ts` 的 `copyTextLocally` → `pbcopy`/`clip`/`wl-copy`）。所以断言复制行为时，
  测试必须让 `isRemoteSession()` 为真（设 `SSH_CONNECTION=x`），否则要么真去写系统剪贴板、
  要么断言永远看不到 OSC 52。此坑必须写进测试注释，否则将来那条断言要么污染剪贴板、要么恒绿。
- 假 Terminal（14 个方法）可捕获 `write()` 帧、经 `start(onInput)` 注入按键、固定 `columns/rows`，
  从而断言：首帧/banner、状态行、Ctrl+C 与双 Esc 语义、picker 流、审批/问答卡、退出路径，以及
  **终端恢复契约**：pi-tui 启动写 `\x1b[?1049h`、停止写 `\x1b[?1049l` + `\x1b[?25h`
  （`dist/tui-alt-screen.js:9-10,135,153`），正好覆盖 `ARCHITECTURE.md` 的 ANSI/restore 约定。
- 边界：`/model`、`/effort`、`/sessions`、`/rm`、`/resume`、`/rewind`、`/exit` 的 handler 是
  `lib/index.ts` 里注册进 `services.commands` 的闭包（`lib/index.ts:1116-1400`），不含在 TuiApp 内，
  需 T4b 或 boot 级挂载才能覆盖。

**T4b PTY E2E（真实组合，按需运行；D8：不接 release）**：

- **不新增依赖**：宿主依赖树自带 `node-pty@1.2.0-beta.15`（`dsh-terminal-bash` 的依赖）与
  `@xterm/headless@6.0.0`（同一 `node_modules` 目录下，已验证），两者都按 §4.1 的 host-deps env
  推导路径加载即可。原先设想的 expect/script 方案降级为备选（仅在 node-pty 不可用时使用）。
- **快照器**：PTY 尺寸固定（如 120×30）、`TERM=xterm-256color`、固定 `LANG`；PTY 输出喂进
  `@xterm/headless` 的 `Terminal`，得到**屏幕缓冲**（行×列字符 + 每 cell 的 fg/bg/属性）——
  这是「截图」的可复现、无 GUI、无 TCC 权限的替代物，CI 可跑。
- 确定性来源 = T2 的 stub provider（`ctx.llm.registerAdapter()`，`dsh-llm/lib/types/index.d.ts:126-182`，
  仅 `stream()` 为必选），叠加隔离 profile overlay，跑真实 `dsh --profile tui-dev`。
- 可断言：boot 至 banner；`/sessions` 列表；`/rm <prefix>` + 确认后 store 变化；`/model` 选择后
  下一条 `request/header` 的 config 换路由（同 M4/探针手法）；`/rewind` 后文件恢复；`/exit` 退出码 0
  且输出含 alt-screen 退出序列（`\x1b[?1049l`）+ 光标恢复（`\x1b[?25h`）。
- 屏幕层断言只做**归一化后的结构断言**（去时间/路径/token 数/进度条）：关键文案存在、状态行字段、
  无 ESC 残留、无重叠（同一 cell 被两行竞争不可能从 buffer 观察到，改为断言行数与内容不超列宽）。
- **时间维度量化**（替代「看流式手感」）：对 `agent/assistant-stream` 帧时间戳统计
  （首帧延迟、chunk 间隔 p50/p95、t/s），加上 pi-tui 的 `fullRedraws` 计数器
  （`dist/tui.js:140`、`dist/tui.d.ts:214`）做重绘次数上界——这些是数值，可设阈值并留档。
- 反脆弱要求：等待用轮询+超时（禁固定 sleep）；断言取稳定子串与**副作用**（会话日志、文件系统）；
  不做整屏 golden 帧——alt-screen 重绘使整屏快照维护成本远高于信号价值。

**保留人工（明确不自动化）**：真实终端渲染的像素外观（字体/DPI/emoji 字形/图片协议）、
原生剪贴板（OSC 52）实际写入、iTerm/Terminal.app/tmux/SSH 的终端差异、kitty 键盘协议慢链路行为、
真实模型的流式手感（T4b 只量化帧间隔，不判「顺滑」）。

### 3.7 T2 stub provider 详细设计

**契约**：`LlmAdapter` 抽象类（`node_modules/@deepseek-ai/dsh-llm/lib/types/index.d.ts:126-182`）只有
`stream(options)` 是必选；`providerInfo`/`listModels`/`resolveModel`/`prepareCall` 有可用默认实现。
注册入口 `ctx.llm.registerAdapter(providers, adapter)` 返回 disposer（`dsh-llm/lib/index.js:1780`），
因此 stub 可以作为一条 preset/patch 行挂进真实组合，不污染其它 route。

**形态**：脚本化回放 adapter。一份脚本 = 若干 turn，每个 turn 是 `StreamChunk` 序列
（文本 / reasoning / `tool-call`），工具调用参数以 JSON 字符串给出——正好能复刻 12-2 的关键输入：
「模型按首轮目录里的 persistent bash schema 发 `{command}`」。

**断言来源**：只读会话日志事件（见 §4.5），不读 stdout 文本，不比对模型措辞。

**场景脚本来源（用户决策 D2：手写）**：

- **采用**：手写脚本，覆盖断言驱动的场景（首轮 bash 调用、promotion 后二次调用、compaction 边界、子代理委派）。
  脚本入库（如 `gates/stub-scripts/*.mjs`），每个脚本头部注明它锁定的不变量与对应 finding。
- **不采用**（保留为后备）：真实日志回放。理由：需要脱敏、需要消除对真实时间/重试的依赖，
  且手写脚本已能覆盖当前 5 条断言；仅当出现「手写覆盖不到」的具体回归时再评估。

**12-2 的确定性红绿如何构造**（P2 验收基准）：

- 脚本：turn1 发 `bash{command}`（**不带** `description`）；turn2 发 `bash{command, description}`。
- 断言：turn1 的 `tool/result.isError === false` 且 `tool/call.arguments` 不含 `description`；
  当前实现（swap 在 `tool/call` 落盘瞬间注册）会让 turn1 报
  `missing required property "description"` → **红**；修复后 → **绿**。
- 该测试的边界要说清（§8 已列）：它锁定的是「请求期 schema 与执行期 registry 一致」这一不变量，
  不是「模型会不会自纠」。

**不覆盖（留给 T3/T4b）**：provider 侧错误分类（429/传输）、真实 sampling、真实首 token 延迟。

### 3.8 T4 视觉/体感能否交给「模型截图判定」？（D4 结论）

问题：前面把「视觉质量、流式手感」列为人工，能否让模型自己截图判定替代？

**结论：不能替代，但可用作 triage。** 先把「体感」拆成三类，每类有各自正确的机器化手段：

| 类别 | 内容 | 正确做法 | 是否需要模型判图 |
| --- | --- | --- | --- |
| 几何/文本 | 重叠、截断、错位、乱码、ESC 泄漏 | PTY + `@xterm/headless` 屏幕缓冲，程序化断言（§3.6 T4b） | 否——断言比判图更稳 |
| 颜色/图形 | truecolor、emoji 宽度、kitty/iterm2 图片协议、OSC 52 | buffer 的 cell 属性可断言颜色；**真实像素渲染**（字体/DPI/字形/图片协议）才需截图 | 仅「真实像素」一项需要，且只能 advisory |
| 时间 | 流式顺滑、首 token 延迟、滚动跟手 | 帧时间戳统计 + `fullRedraws`（§3.6），阈值化 | 否——单张截图原理上承载不了时序 |

模型判图的具体限制（为什么不能做闸门）：

1. **判定不稳定**：同一张图两次判定可能不同 → 只能 advisory，不能做 pass/fail。
2. **没有参照系**：没有 golden 屏时，模型只能凭先验说「看起来像个 TUI」，无法回答「是否符合本仓库预期」；
   而 golden 屏要吃掉 alt-screen 重绘的维护成本（本计划明确不做）。
3. **不可复现**：同一屏幕缓冲在 iTerm / Terminal.app / tmux / SSH 下渲染不同，「像素正确」这个命题本身依赖终端，
   判图结论难以复现，也无法归因到代码。
4. **不可信输入**：整屏截图包含用户消息、模型输出、工具输出、文件内容——把它交给判定模型等于把非受信内容
   引入判定链（提示注入面），与 §4.5 的证据纪律冲突。
5. **权限与成本**：`screencapture` 需屏幕录制权限（TCC）与 GUI 会话，CI 不可用；每次判定还要花额度。

**可以用的地方（T4c，advisory，永不 gate）**：

- 闸门红或人工察觉异常后的**分诊**：抓 1–3 张快照，让带 image 能力的路由按 checklist 描述
  「重叠/乱码/截断/配色/对齐」异常，产出候选 finding，由人确认。
- **发布前探索性体检**：5–10 张快照的粗筛，不产生通过/失败结论。
- **生成断言**：让模型从快照提出「应该断言的文本/结构」，人审后进入 T4a/T4b 的代码——这是它最合适的角色。

**前提与证据纪律**（若要用 T4c）：

- 判定路由必须实测能读图并**记录实测结论**（模型 + 日期 + 能否读图）。本地 `~/.dsh/settings.yaml` 已为
  多条路由声明 `input: [text, image]`（已验证的**本地配置声明**，如 `commandcode/deepseek/deepseek-v4.1-flash`、
  `opencode-go/*` 等）；但**上游模型的真实视觉能力属未验证**，不得据声明推断（区分「配置声明」与「上游能力」）。
- 优先喂**屏幕缓冲文本**（可复现、无权限、无 GUI）而非 PNG；只有判断颜色/图片协议时才用像素截图。
- 判定结论只写入报告，不产生退出码。

**最终人工签收（不可省）**：真实终端上的观感、配色、字体/emoji 渲染、粘贴与剪贴板体验。

## 4. 前置改造（P0，先做，否则闸门跑不起来）

### 4.1 路径去绝对化（**全量，仅 dev 侧**；D3 + D5）

实测口径（2026-09-11，`grep -c` 逐文件计数）：dev 侧 **17 个文件 / 38 处**硬编码
`/Users/vito/data/dev/dsh-plugins`，导致 CI、别的 checkout、stable worktree 一律跑不了。
按 D5 做**全量迁移**（不做「只让新脚本用相对路径」——那样闸门调用的老文件仍写死本机路径，
「交付前回归可在任意 checkout 跑」这个目标拿不到）。

| # | 文件 | 处数 | 迁移机制 |
| --- | --- | --- | --- |
| 1 | `presets/minimal-plus-next/test-helpers.mjs` | 1 | `import.meta.url` 推 ROOT + `DSH_HOST_DEPS_DIR` |
| 2 | `presets/minimal-plus-next/phase-swap-bash.test.mjs` | 4 | 同上（并入共享桩后自然消解，见 §8） |
| 3 | `presets/minimal-plus-next/smoke-boot.mjs` | 3 | 同上 |
| 4 | `presets/minimal-plus-next/smoke-driver.mjs` | 2 | 同上 |
| 5 | `presets/minimal-plus-next/trajectory-driver.mjs` | 3 | 同上 |
| 6 | `presets/minimal-plus-next/trajectory.patch.yml` | 2 | `roots[].path` 用 `!!js process.env.<VAR>`；`insert.name` 用 `./trajectory-driver.mjs` |
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
| 17 | `scripts/release.sh` | 2 | **不动**：第 5/15 行是 `DSH_STABLE_DIR` 的部署默认值（非测试面）；若要可移植另设 env |

**三种迁移机制（均已核对源码，不需要新配置体系）**：

1. **`.mjs` / `.ts`**：`ROOT = fileURLToPath(new URL('..', import.meta.url))`；宿主依赖树沿用已有
   `DSH_HOST_DEPS_DIR`（`scripts/{release,link-global-dsh,sync-agent-presets}.sh` 已用此先例），默认回落到全局树。
   派生物（`@xterm/headless` / `node-pty`）从同一 host-deps 目录推相对路径，**不新增依赖声明**。
2. **`.patch.yml` 的 `insert.name`**：写成 `./<file>.mjs`。已核实加载器会把插入项里
   `./`/`../`/绝对路径的 name 统一转成 **相对 patch 文件所在目录** 的 file URL
   （`anchorInsertedPluginNames`，`dsh-app-boot/lib/index.js:1169-1178`，由 `parsePatchList` 在 1203 行调用）。
   *不要*试图给 `name` 用 `!!js`——`Entry._init` 直接拿 `options.name` 去 import，不做插值
   （`cordis-plugin-loader/lib/index.js:522`）。
3. **`.patch.yml` 的 `config` 值**（settings path、session root、preset roots 等）：
   `!!js process.env.<VAR> ?? '<默认>'`。已核实 `!!js` 只对 **config** 与 **disabled** 求值
   （loader 的 `internal/config` → `interpolate`，`lib/index.js:295-300,689`；`disabledOf` 378 行），
   且仓库已有先例（`~/.dsh/profiles/tui-dev/cordis.patch.yml:45`、`docs/mcp-inventory-design.md:42`）。

**不改动清单（明确记录，避免误伤）**：

- `presets/minimal-plus/**`：stable 副本（14 处），按 D3 冻结。
- `experiments/m4/results-*.jsonl`：4 份历史数据，内嵌绝对路径属记录内容（不是运行输入），保持原样。
- `scripts/release.sh` 的 `DSH_STABLE_DIR` 默认值（上表 #17）。
- 部署位 `~/.dsh/.agent-presets/minimal-plus-next/`：由 `sync-agent-presets.sh` 生成，仓库改动后需人工
  触发同步（D6 的豁免正是为这段窗口准备的）。

### 4.2 隔离与串行

- **写路径隔离**：T1/T2/T3 一律把 settings 副本、session root、profile 指向 temp
  （`smoke-boot.mjs` 改 `/tmp` session root 已是正确范式；M4 目前写真实 `~/.dsh/sessions`，
  见 finding 07-3/10-4，应改隔离模式并清理残留）。
- **共享 farm 串行**：`~/.dsh/profiles/node_modules` 随最近一次 boot 整代自愈翻转（finding 03-2/05-7），
  stable 与 dev 不能并发跑闸门 → 闸门脚本用 flock 串行，且断言「当前 farm 代 = 期望宿主代」。
- **fixture 自持**：seeded 预览探针依赖用户 store 的真实 fixture（`session-6846f8fa-…`），
  其 cwd `/private/tmp/dsh-ticket06-ws3` 已被删除（已验证）→ 应把 fixture 会话快照进 `experiments/` 下的
  fixture 目录，探针从 temp store 读，避免「fixture 消失 = 闸门失效」。

### 4.3 版本闸门

新增 `gates/manifest.json`（或等价单一来源）：

```json
{
  "hostVersion": "0.1.5-rc.1",
  "sessionFormatVersion": 3,
  "deployment": { "minimal-plus-next": { "agent.cordis.yml": "9087bf00…", "...": "…" } },
  "baselines": { "m4-deduped": { "sha256": "c2d4ef22…", "hostVersion": "0.1.5-rc.1" } }
}
```

规则：T1 强制比对（不符即红）；T3 检测到宿主/格式版本变化时**拒绝跑**并提示重采基线
（closeout §7.2「任何宿主升级都会使基线与测量失效」的机器化）。

### 4.4 测试资产与 fixture 清单

`docs/` 只记录结论，闸门需要的是可复现输入。以下资产需在 P0/P1 一并定型（现状见「当前状态」列）：

| 资产 | 用途 | 要求 | 当前状态 |
| --- | --- | --- | --- |
| seeded fixture 会话 | T1 seeded 预览探针（06-4） | 快照进 `experiments/fixtures/`，探针从 temp store 读；其 cwd 目录需脚本自建 | 依赖用户 store 的 `session-6846f8fa-…`（真实会话，cwd 已删），探针 patch 故意不重定向 sessions |
| V3 会话 fixture | T2 resume / V3 读取 | 用 stub provider 一次性生成后入库；**不**从用户 store 取（写入即不可逆迁移） | 无 |
| settings 模板 | 所有 tier 的隔离配置源 | 入库最小模板（无密钥、无个人 provider），假 provider 由 patch 注册 | 现为「复制真实 `~/.dsh/settings.yaml` 到 /tmp」（探针 run.sh），含个人配置 |
| profile overlay | 每个探针的隔离 patch | 现状已具雏形（`experiments/*/*.patch.yml`），需补一条约定：**必须**声明 session/settings root 覆盖，或显式注释为只读用途 | 11/12 号探针重定向 sessions；seeded 探针显式不重定向（只读 fixture） |
| 报告归档 | 证据留档 | 统一落 `experiments/*/results-<date>.json(l)`，报告内嵌宿主版本 + preset sha + git HEAD | 现默认落 `/tmp/dsh-ticket1x/…`，跨轮次覆盖（§6-5） |
| 假 Terminal / stub provider 脚本 | T4a / T2 | 见 §3.6/§3.7；脚本入库不放 /tmp | 无 |

**宿主写路径提示**（已验证）：`dsh` 启动会规范化回写 profile 的 `cordis.yml`
（finding 01-2/09-4）。因此任何 boot 级闸门即使「只读业务数据」也会写 `~/.dsh/profiles/<p>/cordis.yml`。
自动化要么接受该幂等写（并在报告里记录其 sha），要么用独立 `DSH_HOME` 完全隔离。
P0 需就此二选一并写进约束，避免闸门在 CI 上因权限失败（本机已实测 `EPERM`：seeded 探针在
workspace 沙箱下无法写该文件）。

### 4.5 断言证据纪律

沿用本轮探针的做法：**每条断言必须指向可核对的原始位置**（会话日志事件 / 文件 sha / 进程退出码），
不引用模型的自我报告、不引用渲染文本作为机制证据（`docs/subagent-model-selection.md` 的 a7/route-probe
即是此纪律；`~/.dsh/AGENTS.md` 亦记录「不要用模型自述验证工具面」的先例）。
T2 的断言全部落在会话日志事件上：`request/header`（routes/tools）、`tool/call` + `tool/result`
（参数与 isError）、`subagent/model-selection-policy`、`agent-preset/selected` 等。

## 5. 落点

### 5.1 单一入口

```
scripts/regression-gate.sh --tier 0,1 --json /tmp/regression-report.json
scripts/regression-gate.sh --tier 0,1 --allow-stale-deployment   # D6：豁免部署位 sha 检查
```

- 返回码：全过 0；任一断言失败 1；环境前置不满足（如宿主版本不符）2。
- 报告内容：tier 结果、宿主版本、会话格式版本、preset/部署位 sha、耗时、git HEAD；
  **若带豁免，必须写入 `exemptions: [{layer: "deployment-sha", reason: "..."}]` 并在 stdout 打印醒目警告**
  ——豁免绝不能变成静默绿灯。
- `scripts/release.sh` 在 bump 前调用 `--tier 0,1`，**且永不传 `--allow-stale-deployment`**（发布必须部署位一致）。

**`--allow-stale-deployment` 的精确语义（D6）**：

| 项 | 规定 |
| --- | --- |
| 作用范围 | **只**豁免「仓库 ↔ 部署位 preset sha 一致」这一层；`--dump-config`、组合冒烟、探针、宿主版本等 T1 其余断言照常执行 |
| 默认状态 | 拒绝（不加参数即视为要求一致） |
| 正当用途 | 正在改 preset、尚未跑 `sync-agent-presets.sh` 的日常迭代；只想验证 T1 其余项的中间态 |
| 禁止用途 | release 路径；用它掩盖「忘了同步部署位」并当作绿灯 |
| 副作用 | 被豁免时，冒烟与探针仍以**部署位**（旧副本）为被测对象 → 报告需标注「本次验证的是部署位旧副本，不代表仓库当前内容」 |
| 不做的事 | 闸门**不自动同步**部署位（测试去写 `~/.dsh` 是高风险的错误设计）；同步仍是显式的 `scripts/sync-agent-presets.sh` |

闸门按 §2.1 的**部署态**运行（被测对象 = 部署位 preset + tui-dev profile），现有散装命令保留，
闸门脚本只做编排与断言，不重写探针。

**交付前推荐序列**（对齐 §2.1 用途）：

1. `scripts/sync-agent-presets.sh` 同步部署位（显式动作，闸门不做）；
2. `scripts/regression-gate.sh --tier 0,1`（不带豁免）→ 全绿；
3. `--tier 2`（手写 stub 脚本，确定性）→ 全绿；
4. T3（真实模型）按需，最后人工签收。

**T4b（PTY 冒烟）不在此序列内**（D8）：它只提供可随时手跑的入口，换宿主 / 大改 TUI 时建议跑一次，
但不作为发版门禁——理由是它要起真实进程、耗时且有 PTY 环境依赖，卡在 release 上收益不抵成本。

日常迭代可只跑 `--tier 0`，或 `--tier 0,1 --allow-stale-deployment` 验证 T1 其余项。

### 5.2 各层首批断言（对齐本轮 findings）

| 断言 | 来源 finding | 层 |
| --- | --- | --- |
| 逐 loader id 递归计数 = 1（tui-dev、headless） | 05-1/09 | T1 |
| R1 = `[bash, str_replace_editor]`；R2 含 `sandbox_permissions` + 工具数符合期望 | 设计基线 | T1 |
| 部署位 8 文件 sha = 仓库 | 05-5 | T1 |
| 宿主版本 / `SESSION_FORMAT_VERSION` = manifest | 07/升级边界 | T1 |
| seeded 预览 8/8（含 `red-readSession-rejects-seeded` 红线仍在） | 06-4 | T1 |
| 首个 anchored bash 调用无 `INVALID_ARGS`（12-2 红→绿） | 12-2 | T2 |
| promotion 后沙箱 bash 可见；compaction 后回退 persistent | 12-2 同源 | T2 |
| rewind/fork 子会话落盘且可 list | 06-1 | T2 |
| V3 会话 resume 后首个 request/header 含 `list_subagent_models`（enabled 组合） | 11 | T2 |
| 行为锚定 9/9 | 07/08/10 | T3 |
| 启动帧含 alt-screen 进入、退出帧含 `\x1b[?1049l`+`\x1b[?25h`；Ctrl+C 双按退出语义 | `ARCHITECTURE.md` ANSI/restore | T4a |
| 冷启动首帧 banner 含 route/preset；picker 流可驱动并返回选中值 | 票据 05/06 | T4a |
| `/model` 后下一条 `request/header.config` 换路由；`/rm` 后 store 目录消失；`/exit` 退出码 0 | 05/06 + §3.6 | T4b |
| 屏幕缓冲归一化后：banner/状态行文案在位、无 ESC 残留、无超列宽内容 | §3.6 快照器 | T4b |
| 首帧延迟 / chunk 间隔 p95 / `fullRedraws` 上界 | §3.6 时间量化 | T4b |

### 5.3 stable 侧的边界（D3：只测 tui-dev，stable 不动）

- 现状：`npm test` 只列 `minimal-plus-next` 条目（`package.json`，已验证）；stable `minimal-plus` 无自动回归。
- 实测（2026-09-11，repo node_modules = rc.1）：stable 的 `tool-bootstrap/instruction-hint/skill-search/custom-bash`
  四个测试 32/32 仍绿；`phase-swap-bash.test.mjs` 5/11（6 红，其语义绑定 rc.2 行为）。
- 结论：本计划的闸门**只面向 tui-dev / `minimal-plus-next` / dev 侧脚本**；stable 的文件不修改、
  不为 stable 建跨代闸门、不把 stable 测试接进 `npm test`（其单测依赖 rc.2 语义，接了必红）。
  stable 的验收仍按原流程人工进行；只在 README/文档写明「stable 无自动回归，改 stable 文件须在其运行时手验」。

## 6. 已知问题（应随 P1/P3 一并修，均限 dev 侧）

1. `.github/workflows/custom-bash-win-smoke.yml` 的触发路径仍写 `presets/liangshen-bash/**`，
   该目录已不存在（已验证）→ workflow **永不触发**。按 D3 改指 `presets/minimal-plus-next/**`
   （stable 的 `presets/minimal-plus/` 不接 CI），同时把脚本内的 preset 路径参数化。
2. `npm test` 未覆盖 `lib/session-preview-log.ts` 的解析逻辑（只有真实 fixture 探针覆盖）。
3. `tsconfig.json` 只 include `lib/**` + `plugins/**`，preset 的 `.mjs` 不在类型检查面内。
4. M4 直接 `agents.create`（`experiments/m4/m4-runner.mjs:152`）写真实 `~/.dsh/sessions`，
   实测残留 **41** 个 `session-m4-E*`（07-3/10-4），无清理步骤；探针侧（11/12 号）已用
   `/tmp/…/sessions` 隔离，可作改造范式。
5. 探针输出默认落 `/tmp/dsh-ticket1x/…`，跨轮次覆盖、无归档约定。
6. 测试脚手架未统一：`test-helpers.mjs` 已是共享 boot 桩并被 6 个测试文件复用（含两个 preset 的
   tool-bootstrap / instruction-hint / skill-search），但 `minimal-plus-next/phase-swap-bash.test.mjs`
   自带一份 `boot()`（306 行内），`custom-bash.test.mjs` 为纯函数测试（无需运行时，属正常差异）。
   统一后能顺带消除 §8 提到的复制维护成本。
7. seeded 探针的 boot 会写 `~/.dsh/profiles/headless/cordis.yml`（宿主规范化，finding 01-2）；
   在受限沙箱下实测 `EPERM` → 闸门脚本需要 §4.4 的二选一策略（接受幂等写或独立 `DSH_HOME`）。

## 7. 分阶段任务

| 阶段 | 内容（**全部待 D1 批准后才动代码**） | 验收 |
| --- | --- | --- |
| **P0**（~0.5 天） | §4.1 **全量**去绝对化（17 文件 / 38 处，D5；stable 副本与 `release.sh` 默认值除外）；§4.3 manifest；§4.4 资产/隔离矩阵；farm 代断言 | 在**非本机路径的 checkout**（如 stable worktree 或 `git clone` 到另一目录）上 `--tier 0,1` 可跑；dev 侧 `grep` 无残留绝对路径；stable 文件零改动（`git diff` 证明） |
| **P1**（~1 天） | `scripts/regression-gate.sh`（T0+T1，按 §2.1 部署态运行）+ 报告 JSON（含 exemptions 字段）+ release.sh 接线；`--allow-stale-deployment`（D6）；清理 M4 写真实 sessions；seeded fixture 自持 | 一条命令全绿 exit 0；任一断言人为破坏时 exit 1/2；带豁免时报告出现 `exemptions` 且 stdout 有警告；release 路径不传豁免 |
| **P2**（~1-2 天） | stub LLM adapter 测试层（T2）+ 手写脚本（D2），首批 5 条断言（§5.2 下半） | 12-2 红→绿可复现且零额度；CI 可跑 |
| **P2.5**（~0.5 天） | T4a：`TuiAppOptions.terminal` 构造项注入（D7）+ 假 Terminal/app 层测试（冷启动首帧、退出与终端恢复序列、Ctrl+C/双 Esc、picker 流）；复制断言须走 `SSH_CONNECTION` 远程分支；phase-swap 的 boot 桩并入 `test-helpers.mjs` | 新增测试进 `npm test`；终端恢复断言在人为删 `tui.stop()` 时变红 |
| **P3**（~0.5 天） | CI 接线（T0/T1，self-hosted macOS）、修 stale workflow（改指 next）、README 更新闸门用法、清理残留探针会话 | push 后 CI 绿；workflow 路径可触发 |
| **P3.5**（~0.5 天） | T4b：node-pty + `@xterm/headless` 屏幕缓冲快照器 + PTY 冒烟（boot→`/sessions`→`/rm`→`/model`→`/exit`）+ 时间维度量化；**不进每次改动闸门，也不接 release（D8）**——只做可随时手跑的按需入口 | 脚本 exit 0；删断言/改坏路由时 exit 非 0；快照无 ESC 残留断言可复现；`release.sh` 的 diff 中不出现该脚本（grep 证明） |
| P4（可选） | T3 归档规范化（报告含宿主版本/preset sha/日期，落 `experiments/*/results-*`）；T4c 视觉复核流程文档化（advisory，§3.8） | 换宿主后 `--tier 3` 拒绝跑并提示重采；T4c 记录里含判定模型 + 日期 + 读图实测结论 |

依赖顺序：P0 → P1 →（P2 可与 P3 并行）→ P2.5 → P3.5。T4a 依赖 P0 的依赖树 env；
T4b 依赖 P2 的 stub provider 与 P0 的隔离/串行约定。P2 的手写脚本是 P3.5 的输入之一。

## 8. 风险与开放问题

- **stub adapter 的保真度**（推断）：回放 adapter 能覆盖时序与 schema 类回归，但覆盖不了 provider 侧真实行为
  （如 429/传输错误分类）；T3 仍不可省。
- **真实模型批次波动**：M4 口径锚定率对措辞敏感已实证；T3 断言只取行为锚定并设容忍度（如 8/9）。
- **宿主代切换频率**：`0.1.5-rc.2` 已是 `next`（closeout §7.2），每次升级都要重跑 T1 + 重采 T3，
  这是成本主要来源而非 CI 本身。
- **是否引入 GitHub-hosted CI**：T2 起需要真实 dsh 宿主与密钥无关的 stub adapter，可在 hosted runner 跑；
  T1 的 `--dump-config` 需要本机 profile 布局，建议 self-hosted 或容器化 profile 后再上 hosted。
- **spy 式 boot 桩统一（原开放问题，已核实）**：`presets/*/test-helpers.mjs` 已是共享桩并被 6 个测试文件复用；
  仅 `minimal-plus-next/phase-swap-bash.test.mjs` 自带一份。建议 P2.5 顺手把后者并入共享桩
  （保留 `sessionListeners`/`assembleListeners` 的直驱手法，它是当前唯一能确定性覆盖 promotion 时序的手段），
  并把该手法记为「preset 契约测试的标准 seam」，与 §3.7 的 stub provider 分层互补：前者覆盖插件内部逻辑，
  后者覆盖真实 agent loop。**注意**：`presets/minimal-plus/test-helpers.mjs` 属 stable 副本，按 D3 不动，
  两份 helper 的差异保留（若将来要统一，需先解 D3）。
- **P2 的先决条件（用户决策点）**：stub provider 会把「假模型」注入真实组合，需确认它只挂在
  `--patch` overlay（绝不进 `~/.dsh` 部署位与 preset 行），否则真实会话会被假 adapter 劫持。
  闸门脚本应对此加断言（组合 dump 中不得出现 stub provider id）。
- **模型判图（T4c）的定位风险**（§3.8）：一旦被当作「通过标准」，会引入不可复现的判定与提示注入面；
  文档与脚本注释都要写明它是 advisory、不产生退出码。
- **D3 的副作用**：dev 侧去绝对化后，两份 preset 的测试文件会长期不一致（next 可用相对路径，
  stable 仍是绝对路径）。这是有意的取舍——stable 冻结优先于一致性，需在 README 注明。
- **部署态即被测对象（D5 的必然结果）**：闸门验证的是**部署位**内容，因此「仓库改了但没同步」
  会被闸门抓住（这是设计目标），但也意味着**不能只看仓库绿灯就认为交付就绪**；发布序列（§5.1）
  必须包含显式同步步骤。若将来出现「仓库与部署位需要长期并存两个版本」的需求（例如灰度），
  本闸门需要扩展成按目标目录切换，而不是继续叠加豁免。
- **T4b 不接 release 的代价（D8 取舍）**：发版门禁只覆盖确定性层（T0/T1/T2 + 人工签收），
  真实 PTY 组合的自动化覆盖**不会**在发版时强制发生；补偿手段是「换宿主 / 大改 TUI 时手跑一次」
  的纪律 + 人工签收清单。若将来出现「release 漏掉 TUI 组合回归」的实际事故，再评估把它接成
  可选前置（而非默认强制）。

## 9. 复验命令（现状，供 P0/P1 对照）

```bash
npx tsc --noEmit && npm test                      # 0 错 / 97 通过
node presets/minimal-plus-next/smoke-boot.mjs     # 零 LLM 组合冒烟
scripts/degrade-smoke.sh                          # fail-open 降级
experiments/session-preview-seeded/run.sh         # seeded 预览 8/8
experiments/subagent-model-selection/run.sh       # 模型选择 16/16（真实模型）
experiments/subagent-model-selection/run-route-probe.sh  # 允许路由 N/N（真实模型）
M4_GROUPS=E M4_RUNS=9 M4_OUT=/tmp/m4.jsonl node experiments/m4/m4-runner.mjs  # 行为基线（真实模型）
```
