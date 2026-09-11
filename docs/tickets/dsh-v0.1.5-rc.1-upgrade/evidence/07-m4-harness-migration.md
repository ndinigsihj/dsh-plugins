# 票据 07 证据 — 批次测量工具迁移（M4 harness）

日期：2026-09-10
执行：ask-matt-flow Stage 5 Implement，票据 07（本窗口）
环境：Node v22.22.1；全局宿主 `@deepseek-ai/dsh@0.1.5-rc.1`；stable 隔离运行时 rc.2 未触碰；测量工具解析经 `node_modules/@deepseek-ai` → 全局 rc.1 依赖树（§3）

本票是接口迁移票：把行为基线的测量工具从 rc.2 的 `session.events` getter 迁到 rc.1 的按需快照，并让工具能在新宿主上跑完；不采信任何行为结论（行为对比属票据 08）。范围依据：票据 07 文件 + finding 04-2（残留读取清单）+ 通道决定「E 组 = 开发侧组合」。

## 0. 验收清单对照

| 票据 07 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 测量工具能在新宿主上完整跑完一组 | 通过 | §4：M4 E 组 N=9 全部 `ok`（exit 0，9/9 无 error）；§8：trajectory driver 1/1 通过、hot-switch spike PASS |
| 记录字段与历史批次一致 | 通过 | §5：新记录与 2026-08-21 E 组、2026-09-03 E 组逐字段形状比对**完全相同**（含数组元素形状） |
| 统计口径未变 | 通过 | §6：`summarize.mjs` 未改一字；同一输入输出同一列（n/toolCall/weNeed/letMe/anchorRate/check3/check4/avgTools） |
| 未借机重构测量逻辑 | 通过 | §7：diff 仅接口读取、组表映射、路由开关与注释；任务模板、四个统计函数、记录装配、统计器均未动 |
| 工具解析到的依赖树与实际运行宿主一致 | 通过 | §3：`dsh-agent`/`dsh-session`/`dsh-llm`/`dsh-app-boot` 与宿主导入**同一模块实例**（`===` true），宿主版本 0.1.5-rc.1 |

## 1. 接口迁移（rc.1 `snapshotEvents()`）

rc.1 移除 `Session.events` getter（保留 `eventAt(seq)` / `snapshotEvents(from,to)` / `ownEvents()`）。

| 文件 | 迁移前 | 迁移后 |
| --- | --- | --- |
| `experiments/m4/m4-runner.mjs`（5 处读取） | `round2` 三次读 `agent.session.events`；`runOne` 两次读 | `round2` 开头取一次 `snapshotEvents()` 局部快照，`firstToolCallIdx`/`after`/`headers` 复用；`runOne` 在 `whenIdle` 后取一次快照供 `firstAssistant` 与 `toolSequence` 共用 |
| `presets/minimal-plus-next/trajectory-driver.mjs:91`（finding 04-2 残留） | `analyze(agent.session.events)` | `analyze(agent.session.snapshotEvents())` |
| `experiments/model-hot-switch-live-spike.mjs:92`（finding 04-2 残留） | `agent.session.events.filter(...)` | `agent.session.snapshotEvents().filter(...)` |

两处局部快照都在 `await agent.whenIdle()` 之后、无并发写入时取，等价于旧的「读同一数组多次」；聚合函数本身（`firstAssistant` / `round2` 派生字段 / `toolSequence`）未动。

残留检查（全范围 grep `session.events`）：仅 `compaction-epoch.mjs` / `test-helpers.mjs` 的注释提到「已移除的 getter」，无生产读取。

## 2. 启动面改动与理由（非统计逻辑）

1. **E 组映射 `minimal-plus` → `minimal-plus-next`。** 历史 E 的语义是「开发侧自研组合」：`liangshen-bash`（2026-08-21）→ 更名 `minimal-plus`（2026-09-03）→ rc.1 分叉后开发侧为 `minimal-plus-next`（ADR-0002）。rc.1 宿主下旧 `minimal-plus` 是 stable rc.2 代码（部署位副本），挂载即挂；只有 `minimal-plus-next` 可跑。C/A 组 preset 已删除（finding 已记录），仅留键位。
2. **默认 `M4_GROUPS=E`**（原 `E,C`）。C 已不可重跑，默认值不应产出 9 条必错记录；显式传 `M4_GROUPS=E,C` 仍是原行为。
3. **新增 `M4_MODEL=provider/model` 路由覆盖。** 默认路由 `commandcode/deepseek/deepseek-v4-flash` 处于 429 weekly limit（finding 05-6，重置 2026-09-11T06:21:01.800Z），而历史批次模型是 `opencode-go/deepseek-v4-flash`。不覆盖的话本批 9/9 都会是额度错误，验收无法进行。覆盖只影响 `agentOptions`/`installModelSelection` 的路由来源；未改宿主 `settings.yaml`，记录字段 `model` 反映实际路由（本批 9/9 `opencode-go/deepseek-v4-flash`）。留空时行为与历史一致（读 `agentDefaultModel.currentSelection()`）。
4. **`m4.patch.yml`**：`agent-presets.config.default` 同步改为 `minimal-plus-next`（runner 始终显式传 preset，该默认值只影响缺省挂载）；`roots: []` + `includeUserRoot: true` 保持不变 → 仍从部署位副本 `~/.dsh/.agent-presets/minimal-plus-next` 挂载（与 TUI 冷启动同源，finding 05-5）。运行前 sha256 核对：部署位 8 个生产文件与仓库全部一致（trajectory-driver.mjs 属开发工具、按 sync 约定不部署）。

## 3. 依赖树一致性（验收 #5）

`node_modules/@deepseek-ai` 是指向运行宿主的符号链接（`scripts/link-global-dsh.sh` 维护）：

```
symlink: /Users/vito/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
host:    /Users/vito/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh (0.1.5-rc.1)
dsh-agent    same-instance= true
dsh-session  same-instance= true
dsh-llm      same-instance= true
dsh-app-boot same-instance= true
```

即三个测量工具硬编码的绝对导入路径与宿主启动的是同一代、同一模块缓存实例（不是版本号相同，是 `===`）。hot-switch spike 原先从 `~/.dsh/profiles/node_modules` 共享 farm 导入 `dsh-app-boot`（该 farm 会被最近一次 boot 的宿主整代重写，stable 启动后翻回 rc.2，finding 03-2/05-7），本票改为与其余导入同源的 repo dev 树，消除「脚本混用两代」的隐患。

## 4. M4 实跑（验收 #1）

命令（工作区 `dsh-plugins`，真实 LLM）：

```sh
M4_GROUPS=E M4_RUNS=9 M4_MODEL=opencode-go/deepseek-v4-flash \
M4_OUT=/Users/vito/data/dev/dsh-plugins/experiments/m4/results-minimal-plus-next-upgrade-only-2026-09-10.jsonl \
dsh --profile headless --patch experiments/m4/m4.patch.yml
```

- 输出：`m4 E1 done: ok` … `m4 E9 done: ok`（9/9），exit 0。
- 原始数据：`experiments/m4/results-minimal-plus-next-upgrade-only-2026-09-10.jsonl`（1 行注释头 + 9 条记录）。
- 时间：首条 `12:12:20.752Z` → 末条 `12:14:38.514Z`（约 2 分 18 秒墙钟，单跑 13–29 秒）。
- 会话留存：新增 9 个 `~/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E{1..9}-*`，与历史批次同一约定（目录内已有历史 m4 会话）。
- 任务副产物 `m4-probe-E{1..9}.txt` 已清理，工作区未留探针文件。
- 权限注记：rc.1 装载 profile 会回写 `~/.dsh/profiles/headless/cordis.yml`（finding 01-2），沙箱拒绝后按用户偏好以一次性 danger-full-access 重试成功；全程未手工编辑 `~/.dsh` 配置。

## 5. 记录字段一致性（验收 #2）

形状比对（类型/键/数组元素结构，不含取值）：

```
fresh shape: {elapsedMs:number,error:null,firstMessage:{classification:string,firstLine:string,text:string},
 firstToolCall:{args:string,name:string,turn:number},group:string,model:string,preset:string,
 r2:{assemblyBashParams:[string],assemblyTools:[string],bashHasSandbox:boolean,hasAgentInstructions:boolean,
 hasMarker:null,headerBashParams:[string],headerReason:string,headerTools:[string],injectedEvents:[string],marker:null},
 run:number,task:string,toolSequence:[{calls:[string],round:number}],ts:string}
== vs 2026-09-03 E: true
== vs 2026-08-21 E: true
all fresh records same shape: true
```

即 12 个顶层字段与全部嵌套形状与两个历史批次逐字段一致。唯一取值变化是 `preset`（`minimal-plus-next`，见 §2.1，属组合更名/分叉而非字段变化）。

## 6. 统计口径（验收 #3）

`experiments/m4/summarize.mjs` 未修改，复算本批：

```
== experiments/m4/results-minimal-plus-next-upgrade-only-2026-09-10.jsonl ==
group  n  toolCall  weNeed  letMe  anchorRate  check3  check4  avgTools
E      9  6         3       0      67%         9       9       29
```

对照全部历史批次（`summarize.mjs` 原样复算，趋势参考；宿主版本已变，C/A 组 preset 已删除不可重跑）：

| 批次 | 宿主 | 组 / preset | n | toolCall | weNeed | letMe | anchorRate | check3 | check4 | avgTools |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-21 | rc.2 | **E** / liangshen-bash | 9 | 8 | 0 | 1 | 89% | 9 | 9 | 28 |
| 2026-09-03 | rc.2 | **E** / minimal-plus（自研） | 9 | 9 | 0 | 0 | **100%** | 9 | 9 | 28 |
| **2026-09-10** | **0.1.5-rc.1** | **E** / minimal-plus-next | 9 | 6 | 3 | 0 | **67%** | 9 | 9 | **29** |
| 2026-08-21 | rc.2 | C / liangshen（已删除） | 9 | 9 | 0 | 0 | 100% | 9 | 0（persistent，预期） | 28 |
| 2026-08-21 | rc.2 | A / liangshen-plus（已删除） | 9 | 7 | 2 | 0 | 78% | 9 | 9 | 26 |
| 2026-08-20 | rc.2 | C / liangshen（早期批） | 9 | 6 | 0 | 3 | 67% | 9 | 0（persistent，预期） | 28 |

三口径行为事实（本票只记录、不归因，票据 08 处置）：

- **check3（二轮 agent-instructions 注入）9/9、check4（二轮沙箱 bash）9/9**，与历史一致；`headerReason` 9/9 `change`。
- **首轮工具锚定 9/9**：每条 `firstToolCall.name === "bash"`、`classification === "tool call"`，即首轮请求确实被收窄且模型首个响应带工具调用。
- **分类器把 3 跑记成未锚定**：E6/E7/E8 首行是 `I'll start by ...`（与工具调用同一条消息内）。历史同类现象存在（2026-08-21 A 组 2 跑 `I'll`，E 组 1 跑 `我来`），属模型开场措辞；按未改的口径 anchorRate 记 67%。
- **avgTools 29 vs 28**：fresh 比历史多 `web_fetch`（rc.1 宿主工具面差异），其余 28 个工具集相同。属宿主升级差异，留待票据 08 逐项归因。
- `injectedEvents` 为 `["user","agent-instructions","skill-catalog","instruction-hint"]`，与 2026-09-03 记录同形（skill-catalog 为 host 层预期项，README-selfhost 口径说明已记录）。

本批原始数据满足票据 08「按历史样本量采集（每组 9 次）」的采集要求，可作为「仅升级」基线复用；是否采用由票据 08 复核决定，本票不产出行为结论。

## 7. 未借机重构（验收 #4）

diff 范围（`git diff --stat`：3 files, +38/−14）：

| 文件 | 改动 | 性质 |
| --- | --- | --- |
| `experiments/m4/m4-runner.mjs` | 5 处读取 → 2 处局部快照；`batchSelection()` 路由开关（15 行）；E 映射/默认组；头注释 | 接口迁移 + 运行入口 |
| `experiments/m4/m4.patch.yml` | 用法注释、默认 preset | 启动面 |
| `experiments/model-hot-switch-live-spike.mjs` | 1 处读取 + boot 导入同源化 | finding 04-2 收尾 |

未动：`taskTemplate`（逐字）、`unique`、`firstAssistant`、`round2` 派生口径、`toolSequence`、记录字段装配与顺序、`summarize.mjs`、`analyze()`（trajectory）、历史结果文件与历史 README。

## 8. 旁证：trajectory driver 与 hot-switch spike（finding 04-2 收尾）

trajectory driver（repo preset root，真实 LLM；默认路由额度期，用 `/tmp` 临时 settings 覆盖层指向 opencode-go，未改用户 `~/.dsh/settings.yaml`，跑完即删）：

```json
{"task":"列出当前目录","provider":"opencode-go","model":"deepseek-v4-flash",
 "tools":["bash","str_replace_editor"],"injected":[],"firstLine":"",
 "toolsOk":true,"injectOk":true,"openOk":true,"pass":true}
```

hot-switch spike（无需 key 即可验路由记录）：

```
routes: A=commandcode/deepseek/deepseek-v4-flash  B=deepseek-official/deepseek-flash
[A] request/context = {"provider":"commandcode","model":"deepseek/deepseek-v4-flash",...}
[B] request/context = {"provider":"deepseek-official","model":"deepseek-flash",...}
PASS: real-tree hot-switch — request/context records new route on next turn
```

两个工具的 `snapshotEvents` 读取与同代依赖在其真实运行路径上均无异常。

## 9. 静态回归与边界

| 项目 | 结果 |
| --- | --- |
| `node --check`（3 个改动 .mjs） | 通过 |
| `npm test` | **97 / 97 / 0**（开工前后同值） |
| `npx tsc --noEmit` | 0 错 |
| 稳定侧 | `git status --short presets/minimal-plus` 为空；stable 运行时/部署位未动 |
| 提交 | 未 commit、未 push、未打 tag |

## 10. 本票发现（转 08/13）

- **07-1**：本批 `results-minimal-plus-next-upgrade-only-2026-09-10.jsonl` 可直接作为票据 08 的「仅升级」基线输入；但 anchorRate 67% 的构成（3 跑 `I'll` 前导 + 同消息工具调用）需要票据 08 按既有口径解释，不能只看数字。
- **07-2**：rc.1 宿主可见工具比 2026-09-03 多 `web_fetch`（29 vs 28），其余一致；属宿主面差异，票据 08/09 归因时按此项对账。
- **07-3**：M4 批次会话写入真实 `~/.dsh/sessions`（`session-m4-E*`），与历史批次一致，未做清理（保留可追溯性）；如需清理属独立操作。
- **07-4**：`M4_MODEL` 是运行入口开关，不进入记录口径；用旧命令（不传）时行为与历史一致。
- **07-5**：本票运行触发共享 farm 自愈为全局 rc.1 代（与 finding 03-2/05-7 预期一致，farm 现为 rc.1）；stable 下次启动会翻回。
- **07-6**：`str_replace_editor` 需先 view 的约束（finding 06-3）在本批表现为模型改用 `write`/`glob`/bash 完成任务；M4 现有指标只取首工具与 bash schema，无口径影响。

## 11. 未做

- 未做票据 08 的行为归因与「与历史差异」结论（本票只证明工具可跑、字段与口径一致）。
- 未做组合去重（09）、未接官方子代理模型选择（11）、未做允许路由探测（12）。
- 未改 `summarize.mjs`、未动历史结果文件、未动 stable 侧任何文件与部署位。
- 未 commit、未 push、未打 tag。
