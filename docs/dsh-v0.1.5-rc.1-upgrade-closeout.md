> 2026-09-22 收敛说明：宿主已统一到 0.1.5-rc.1/rc.2，原 `minimal-plus-next` 已改名为
> `minimal-plus`（旧 `minimal-plus` 删除）。本文正文保留当时的 dev/stable 分叉记录，当前口径以 README 为准。

# dsh-plugins 升级至 0.1.5-rc.1 — 收口记录（as-built）

> 日期：2026-09-11（票据 13 文档收口）。状态：**文档已成文、未提交，等待用户审阅**。
> 范围：开发侧（`tui-dev`，以及停用的 `tui-central`）自研 TUI 升级到 `@deepseek-ai/dsh@0.1.5-rc.1`
> 并采用官方子代理模型选择。稳定侧（`tui` + 隔离运行时）全程未触碰。
> 关联：`docs/dsh-v0.1.5-rc.1-upgrade-spec.md`（范围与决策）、`docs/dsh-v0.1.5-upgrade-plan.md`（计划，已更新目标版本）、
> `docs/subagent-model-selection.md`（机制与维护）、`docs/adr/0001-0003`、`docs/tickets/dsh-v0.1.5-rc.1-upgrade/`（01–13 与 evidence/）。

本文的目标：把升级后的真实状态一次写清，下一个维护者不必重新调研。
“官方证实 / 本仓库实测 / 未验证”在文中分开标注。

## 1. 目标与版本事实（第一方来源）

### 1.1 本次采用（as-built，2026-09-11 复核）

| 项 | 值 |
| --- | --- |
| 开发侧运行时 | 全局 `@deepseek-ai/dsh@0.1.5-rc.1`（`dsh --version` → `0.1.5-rc.1`，2026-09-11 复核） |
| 稳定侧运行时 | `/Users/vito/data/dev/dsh-runtime/stable` 自带 `0.1.1-rc.2`，由 `bin/tui-stable` 启动，与全局宿主无关 |
| Node | `v22.22.1` |
| 升级动作 | `npm i -g @deepseek-ai/dsh@0.1.5-rc.1`（票据 02，2026-09-10） |
| 生效范围 | `tui-dev` 的开发组合 `minimal-plus-next`；`headless` 测量 profile 同步升级 |

### 1.2 npm / release 事实（2026-09-11 查询）

来源：npm Registry <https://registry.npmjs.org/@deepseek-ai%2fdsh>（查询日 2026-09-11）、
官方 release notes <https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1>。

| 项 | 结果 |
| --- | --- |
| `latest` dist-tag | `0.1.5-rc.1`（本次采用版本） |
| `next` dist-tag | `0.1.5-rc.2`（GitHub release 2026-09-10T15:09:34Z，未采用） |
| `alpha` dist-tag | `0.1.5-alpha.2`（GitHub release 2026-09-09T14:23:10Z） |
| `0.1.5-rc.1` 发布 | npm 时间 `2026-09-10T03:12:53.293Z`；GitHub release 2026-09-10T03:09:00Z |
| `0.1.5` 正式版 | 不存在（Registry 查询 404） |

要点：升级时 rc.1 是 `next`；随后上游又发布了 `rc.2`（仅反馈交互与文件卡片排版调整），
现在 rc.1 是 `latest`、rc.2 是 `next`。**本轮不追 rc.2**；任何宿主升级都会重置本文的验证与测量基线，
需按同一套闸门重跑（见 §7）。本仓库 `0.1.5-alpha.1` 时期的计划目标（`docs/dsh-v0.1.5-upgrade-plan.md` 初稿）
已由 rc.1 取代。

## 2. 本轮实际范围与交付状态

| 范围 | 状态 |
| --- | --- |
| dsh-plugins 开发侧 TUI（tui-dev） | 已完成并有证据：票据 01–12（08–12 经用户验收；04 的状态在票据 13 按证据回填）。逐票主题：01 回滚点、02 宿主升级、03 组合分叉与 persona、04 会话接口迁移、05 冷启动、06 恢复/回退、07 测量工具迁移、08 升级基线、09 组合去重、10 去重后基线、11 模型选择、12 允许路由验证 |
| 稳定侧（`tui`、隔离运行时、`minimal-plus`、stable 部署位） | 未触碰；票据 01/03/06/09 多次复核 sha 未变 |
| `tui-central` | 已停用（目录改名 `tui-central.parked-0.1.5-rc.1`，内含 `PARKED.md`）；恢复条件见 §8 |
| relay worker（launchd job） | 已停用（`disable` + `bootout`，plist 保留）；恢复条件见 §8 |
| dsh-relay / dsh-endless 代码适配 | **未做**（本轮 out of scope；`docs/dsh-v0.1.5-upgrade-plan.md` 中它们的部分仍是计划） |
| 提交 | 全部改动未 commit / 未 push；用户 2026-09-11 审阅通过并决定暂不提交（保持工作区现状） |

### 2.1 当前部署基线（2026-09-11 复核 sha256）

| 文件 | 内容 | sha256 |
| --- | --- | --- |
| `~/.dsh/profiles/tui-dev/cordis.patch.yml` | rc.1 profile 补丁 + 模型选择基线（enabled=true + 4 路由） | `d6b283d6…` |
| `~/.dsh/profiles/headless/cordis.patch.yml` | 同 id 挂载，`enabled: false` + 同 4 路由（保测量口径） | `338f36cd…` |
| `~/.dsh/settings.yaml` | 用户层，无 `subagent-model-selection:` 段 | `84299548…` |
| `presets/minimal-plus-next/agent.cordis.yml` | 开发侧组合，只声明与 rc.1 base 的差异 | `9087bf00…` |
| `~/.dsh/.agent-presets/minimal-plus-next/` | 部署位副本：8/8 生产文件 sha 与仓库一致 | 同上 |

## 3. 破坏性变更与迁移对照（官方变更 → 本仓库处置）

官方变更以 `dsh-v0.1.5-rc.1` release notes 为准（同时覆盖自 `0.1.2-rc.1` 以来的变更）；
“处置”列是本仓库实测后的现状，证据指向票据与 evidence 文件。

### 3.1 会话接口（最影响本仓库）

| 官方变更 | 本仓库处置 | 证据 |
| --- | --- | --- |
| **移除 `Session.events`**，改为 `seq` / `eventAt()` / `snapshotEvents()`，`SessionSeq` 与 `SessionLogOffset` 强类型区分 | TUI `lib/index.ts` 13 处、`plugins/rewind-dsh.ts`、preset 自研插件（compaction-epoch 等）全部改快照读取；回退边界用官方 `SessionSeq`（type-only import） | evidence/04 §1–§3 |
| assistant 流式 chunk 不再写进会话日志 | TUI 改订阅进程内 `agent/assistant-stream` 折叠气泡与 token-rate；终态仍由 durable `assistant/message` 收口 | evidence/04 §1；finding 04-4（relay 镜像未验证，out of scope） |
| `Session` projection cache 契约改为 `coldSnapshot(header, inheritedEventCount, events)`（调用方给全量日志） | 会话列表 hover 预览改为 `readSession` + 快照；去掉旧的“零日志读取”快路径 | evidence/04 §1；finding 04-1（预览至少一次完整读） |
| `userQuestions.registerProvider` 移除，改 scope-filtered `user-questions/request` waterfall | TUI 改 `ctx.on(...)` 订阅，请求/答案形状逐字段保持；监听器随 effect 释放 | evidence/04 §1 |
| `commands.execute` 第三参 `images` → `submittedAttachments` | TUI 目前传空数组，无影响；后续 slash 命令带图/文件需适配 | finding 04-3 |

### 3.2 生命周期、持久化与会话格式

| 官方变更 | 本仓库处置 | 证据 |
| --- | --- | --- |
| Session persistence 改为生命周期持有的 **`SessionHandle`**；新增 session 单写锁（同一 session 至多一个进程持有） | TUI 不直连 persistence；fork 子会话改由 `agents.create` 生命周期落盘（`tuiHandoff.forkPersistedChild`），再以 `listSessions().persisted` 复核 | evidence/06 §11；ticket 06 |
| `agentLoop.create()` 改为异步 | 4 处 `agents.create/resume` 均 `await` 完成再继续 | evidence/04 §4 |
| **Session 格式 V3**：旧日志迁移时生成新日志、保留原文件；升级后的会话**不支持降级读取**；自定义 reader 必须适配 V3 | 升级前备份（票据 01）；rc.2 读取升级后会话被拒绝已实测（两种文件名情形）；自定义读取处全部迁移 | evidence/01、06 §8 |
| 迁移后 V3 的 system prompt 纳入消息历史 | 本仓库未直接消费 system prompt 事件，无对应改动；行为面由既有回归覆盖 | release notes「其他变更」 |
| `readSession` 对 seeded 子会话的 snapshot 构造限制（`inheritedEventCount === events.length`） | 绕开：resume facts 与 hover 预览都改走不构造 Session 的读者（`listEvents` + 分块 `readEvent`，`lib/session-preview-log.ts`）；预览路径 2026-09-11 Stage 7 补齐 | finding 06-4；`evidence/13-stage7-fixes.md` |

### 3.3 组合、persona 与工具面

| 官方变更 | 本仓库处置 | 证据 |
| --- | --- | --- |
| 自定义 persona 配置拆成 **prefix / suffix**（旧 `text` 字段不再兼容） | 新建开发侧组合 `minimal-plus-next`（唯一字段差异 `text`→`prefix`），stable `minimal-plus` 不动；宿主级 persona 由 base 自带迁移，本侧无覆盖 | ADR-0002；evidence/03 |
| `dsh-base@0.1.5-rc.1` 自带 delegation / compaction / planning / 既有工具行 | preset 只保留两处差异（恒禁的 `tool-bash`、承载模型选择的 `tool-subagent`），删除 16 个逐字重复行与 2 个空组 | ADR-0003；evidence/09 |
| base 新增挂载 `storage` / `storage-json` / `storage-domain` / `session-projection-cache`；dev profile 重复 insert 导致 `duplicate loader entry id` 启动失败 | 删 3 行冗余 insert；`session-projection-cache` 改按 id 的 config 覆盖（保留 400/30000 节流）；stable profile 不动 | evidence/05-tui-cold-boot、05-profile-boot-conflict |
| base `tool-web: fetch: true`（公开 `web_fetch` 默认启用） | 可见工具 29（含 `web_fetch`）；preset 原 `fetch:false` 行删除（在 rc.1 本就不生效） | evidence/08 §5；finding 08-3 |
| `agent-presets.roots` 表达式指向已移除的旧 shipped preset 目录（含 `code` preset） | 删除 tui-dev 的 roots 覆盖，改由 shipped root + user root 提供 | finding 03-3；evidence/09 §3 |
| SDK / Headless / ACP 默认编辑工具改 `read`/`write`/`edit`；Web minimal 仅持久 shell、`str_replace_editor` 需显式启用 | 测量侧走自研 preset（首轮锚定 bash + `str_replace_editor`），工具面 29 与历史批同形；未跟随宿主默认 | evidence/07/08/10 |
| 移除 `ctx.agent`；调用方需显式传 Agent | 全范围 grep 无命中（缺席核实） | evidence/04 §6 |
| `Inbox` 改 type-only；`hasPending`/`claim` 移出公共接口，插件走 `agent.inbox` | 全范围 grep 无命中（缺席核实） | evidence/04 §6 |
| `subagent` 增加官方模型选择；fork 来源的委派语义由宿主提供 | 采用官方机制并开启（preset 开关 + 宿主设置服务）；`subagent_fork` 保持 one-shot、不参与模型选择 | `docs/subagent-model-selection.md`；ADR-0001；evidence/11 |
| `x-opencode-session` 本地补丁（安装目录内的 `dsh-llm-pi-ai` 修改）会被任何宿主升级/重装冲掉 | 票据 02/05 已重打回全局 rc.1 与 stable rc.2 两处；后续宿主升级列为检查项 | `docs/opencode-go-x-opencode-session-local-patch.md`；finding 05-4 |

## 4. 升级带来的、本仓库已采用的新能力

- **官方子代理模型选择**：允许集合内为子代理指定 provider/model/reasoning effort；策略记入会话、子会话继承、
  事后改设置不改写；旧会话保持关闭；fork 与父同路由。使用与维护见 `docs/subagent-model-selection.md`。
- **V3 会话格式**：升级后可读写新版日志（旧日志自动迁移、原文件保留），为后续动态 system prompt 等能力留出空间。
- **`web_fetch` 默认可见**：可见工具 29 与 2026-09-03 历史批的差异仅此一项（归因宿主 base）。
- 未采用（评估后不在本轮）：动态 system prompt / KV cache、Web Sidebar、Agent Teams、远端模型目录等。

## 5. 被取代/作废的旧方向

1. **自研 purpose 路由整套设计作废**（ADR-0001）：按角色名（explorer/reviewer/worker）固定模型的自研解析层、
   替换官方工具的 adapter、自建 fallback 事件、自建 session override 事件与 `/subagent-model` 覆盖命令，
   在 rc.1 官方机制发布后全部停止，不再实现；若日后确有角色化需求，用多个官方工具实例配静态
   `agentOptions`（纯配置）表达，而不是恢复自研 adapter。
2. **升级目标 `0.1.5-alpha.1` 作废**：`docs/dsh-v0.1.5-upgrade-plan.md` 初稿的目标版本已由
   `0.1.5-rc.1` 取代（本文 §1.2）；alpha.1 时期的 npm 状态快照
   `docs/dsh-v0.1.5-alpha.1-npm-status.md` 与 `docs/dsh-v0.1.2-rc.1-tui-impact.md` 的“等待 0.1.3 rc”
   结论均为历史资料，已加过时标注。
3. **“preset 自包含”方向作废**（ADR-0003）：不再把 base 已有的行抄回 preset 来换取自包含。
4. **stable 与 dev 共用一份 preset** 作废（ADR-0002）：stable 钉版宿主不能与 rc.1 字段共用组合。

## 6. 测量结论

### 6.1 M4 行为基线（同口径 headless 批次，E 组 N=9）

| 批次 | 结论 | 原始数据 |
| --- | --- | --- |
| 票据 07（工具迁移） | rc.1 上 E 组 9/9 ok；记录字段与 2026-08-21 / 2026-09-03 历史批逐字段同形；统计口径未改 | — |
| 票据 08（仅升级基线） | 复用 07 批次并独立复算：行为锚定 **9/9**（首响应含工具调用、首工具 bash）；口径锚定率 67%（3 跑 `I'll` 前导，首轮仍是 tool call）；check3 9/9、check4 9/9；可见工具 29（+`web_fetch`，归因 rc.1 base） | `experiments/m4/results-minimal-plus-next-upgrade-only-2026-09-10.jsonl`（sha256 `2fc45393…`） |
| 票据 10（去重后基线） | 与 08 逐项同形：14 项记录字段取值集合全同、结构字段零差异；行为锚定 9/9、check3/check4 9/9；口径锚定率 56% vs 67%，差 1 跑「我来」开场（预先裁定不作回归）；耗时 +1.4s 属抖动 | `experiments/m4/results-minimal-plus-next-deduped-2026-09-10.jsonl`（sha256 `c2d4ef22…`；批次头记录部署位 sha `3de7d32b…`） |

口径说明（转写 finding 10-2）：

- **行为锚定**（首响应含 tool call、首工具 bash）是稳定回归指标；**口径锚定率**对开场措辞高度敏感
  （67% 与 56% 的差别只来自各 1 跑的 `I'll` / 「我来」前导），数字本身不当作回归证据。
- 历史 rc.2 E 批口径为 89%/100%，rc.1 两批为 67%/56%；该系统性差异**未归因**。
  已排除首轮工具数（单 bash 变体仍 56%，finding 10-5）；若追查需更大样本或宿主工具面 A/B 实验。
- 去重前后工具集合逐名一致（29，含 `web_fetch`），去重未改变行为面。

### 6.2 子代理模型选择

| 检查 | 结论 |
| --- | --- |
| 票据 11 行为探针（真实模型 + 真实宿主） | **16/16 通过**；开启会话 promotion 后 30 工具（+`list_subagent_models`）；`subagent/model-selection-policy` 落会话并继承；旧会话能力关闭；fork 不参与 |
| 票据 12 允许路由真实工具调用探测 | 首测 3/4（commandcode 遇 weekly quota 429，按用户裁定保留基线）；**2026-09-11 14:21 复测 4/4 通过**——commandcode 首次尝试即完成 bash 调用并回显 marker（6.6s），开环项关闭 |

原始报告：`evidence/11-probe.json`（2026-09-11 重跑版 sha256 `d448a2d5…`；旧版 `eb986337…`）、
`evidence/12-route-probe.json`（首测 3/4，sha256 `183bd485…`）、
`evidence/12-route-probe-retest-2026-09-11.json`（复测 4/4，sha256 `ecf23663…`）。

### 6.3 回归与配置闸门

- `npm test` 97/97、`npx tsc --noEmit` 0 错（票据 04/11 后复核）。
- `dsh --profile tui-dev --dump-config` exit 0：99 个 loader id / 0 重复；headless 88 个 / 0 重复
  （逐 id 递归计数为 1 才算通过，`--dump-config` 本身不查重复）。
- 部署位 `minimal-plus-next` 冒烟 exit 0：ROUND1 锚定 `[bash, str_replace_editor]`、ROUND2 29 工具
  （headless 基线关闭模型选择的设计效果）。
- `tui-dev` 冷启动、`/model` 切换、流式响应、状态行、exit 0 已人工验收（票据 05）；
  会话恢复、`/rewind` 文件恢复、`/sessions`、`/rm`、旧宿主拒绝 V3 已验收（票据 06）。
- Stage 7（2026-09-11）：seeded 预览修复探针 8/8（真实 fixture 红→绿）；
  模型选择探针 a7 补 effort 断言后 16/16；`npm test` 97/97、`tsc` 0 错（`evidence/13-stage7-fixes.md`）。

## 7. 残留风险与开环项

### 7.1 开环项（有明确下一步）

1. **`tui-central` 解停用前置**：其 patch 未挂载模型选择设置服务（preset 已开启，缺失会导致组合期抛错），
   且仍带 `agent-presets.roots` 覆盖，需按 tui-dev 同法清理（finding 11-2/09-3）。
2. **dev 侧默认 preset 隐患**：`~/.dsh/settings.yaml` 的 `agent-presets.default: minimal-plus` 指向 rc.2 组合；
   TUI runner 总是显式传 preset 故未触发，但任何未显式指定 preset 的 dev 解析会挂载失败。
   隔离方案（profile 覆盖或 dev 专用 home）未定（finding 03-4/09-2）。
3. **宿主升级后必须重打 `x-opencode-session` 本地补丁**（全局 rc.1 与 stable 运行时两处），
   否则 opencode-go 路由 400 `MissingSessionID`（finding 05-4）。
4. **preset 改动后必须同步部署位并核 sha**：冷启动加载的是 `~/.dsh/.agent-presets/minimal-plus-next/`，
   仓库绿灯不等于部署位生效（finding 05-5）。当前 8/8 一致（2026-09-12 同步 12-2 修复后复核，
   `phase-swap-bash.mjs` = `c00fe48e…`；`--tier 0,1,2` 免豁免全绿）。

### 7.2 已记录、暂不处置的残留

- **首轮 anchored bash 首次调用必先参数校验失败**：promotion 前模型看到的是持久 bash schema（只要 `command`），
  而 phase-swap 已把该 agent 换成沙箱 bash（要 `command`+`description`），首次调用报
  `missing required property "description"`，能自纠的模型重发即成功。机制线索
  `presets/minimal-plus-next/phase-swap-bash.mjs`。**2026-09-11 已修（票据 06，方向 A）**：swap 延后到
  触发 promotion 的调用结算（`tool/result`）之后，首轮调用按产出参数时的 persistent schema 校验，
  下一次请求起沙箱 schema 生效；红→绿证据见 `experiments/regression-gate/evidence/12-2-red.json` /
  `12-2-green.json` 与 `docs/tickets/regression-test-automation/evidence/06-stub-model-tier-and-12-2.md`。
- **seeded 子会话 hover 预览**：已于 2026-09-11 Stage 7 修复（`lib/session-preview-log.ts` 回退 + 真实 fixture 红→绿探针，见 `evidence/13-stage7-fixes.md`），不再列为残留。
- **relay 未验证**：`agent/assistant-stream` 是否由 relay 镜像转发、V3/`SessionHandle` 迁移均未做，
  属后续独立轮次（finding 04-4；spec out of scope）。
- **共享 farm 代际翻转**：`~/.dsh/profiles/node_modules` 由最近一次 boot 的宿主整代自愈/重写，
  stable 与 dev 启动会互相翻转（finding 03-2/05-7），属预期，不要手工编辑。
- **测量残留会话**：`~/.dsh/sessions` 留有票据 07/08/10 的 `session-m4-E*` 与探针会话（finding 07-3/10-4），
  未清理，按需处置。
- **口径差异未归因**：见 §6.1（finding 10-2/10-5）。
- **上游继续推进**：`0.1.5-rc.2` 已是 `next`（本轮未采用）；任何宿主升级都会使 §2.1 基线与 §6 测量失效，
  需重跑同一套闸门（组合去重差异、29/30 工具面、M4 基线、模型选择探针、路由探测）。
- **回滚边界**：已迁移 V3 的会话不能被 rc.1 之前的宿主读取；备份是唯一退路（见 §8）。

## 8. 回滚与恢复条件

- **升级回滚**：`npm i -g @deepseek-ai/dsh@0.1.1-rc.2`（期望 `dsh --version` → `0.1.1-rc.2`），
  并用票据 01 的备份树覆盖配置：
  `/Users/vito/.dsh/upgrade-backups/dsh-0.1.5-rc.1-20260910-141953/`（19 文件，已校验可读）。
  回滚不会自动撤销三项停用处置，需手动作逆（见 evidence/02 §6）。
- **停用模式恢复**：
  - `tui-central`：`mv ~/.dsh/profiles/tui-central.parked-0.1.5-rc.1 ~/.dsh/profiles/tui-central`，
    且恢复前完成 §7.1 第 2 项；
  - relay worker：`launchctl enable gui/501/com.dsh-relay.worker && launchctl bootstrap gui/501 <plist>`，
    恢复条件是 dsh-relay 完成 rc.1 适配且 hub 可达（evidence/02 §5）。
- **稳定侧**：无需回滚动作（隔离运行时自带 rc.2，与全局宿主版本无关）。

## 9. 证据索引与提交状态

| 主题 | 文档 |
| --- | --- |
| 票据与验收 | `docs/tickets/dsh-v0.1.5-rc.1-upgrade/01-13-*.md` |
| 回滚点/宿主升级/组合分叉/会话迁移/冷启动/恢复回退 | `evidence/01-*`、`02-*`、`03-*`、`04-*`、`05-*`、`06-*` |
| 测量工具迁移与两份基线 | `evidence/07-*`、`08-*`、`09-*`、`10-*` + `experiments/m4/results-*.jsonl` |
| 子代理模型选择 | `evidence/11-subagent-model-selection.md` + `11-probe.json` |
| 允许路由验证 | `evidence/12-allowed-route-verification.md` + `12-route-probe.json`（首测 3/4）+ `12-route-probe-retest-2026-09-11.json`（复测 4/4） |
| Stage 6 review → Stage 7 修复（06-4 预览、a7 断言、契约文档） | `evidence/13-stage7-fixes.md` + `evidence/13-seeded-preview-probe.json` |
| 本收口 | 本文 + `docs/subagent-model-selection.md` + `docs/dsh-v0.1.5-upgrade-plan.md`（已更新） |

**提交状态**：本轮所有代码、配置、文档改动均未 commit / 未 push；票据 13 最后一项已勾选——
用户 2026-09-11 审阅通过并决定暂不提交（ask-matt-flow Stage 8 交接文档
`/tmp/dsh-plugins-handoff-2026-09-11.md` 已接受；流程状态见 `.dsh/ask-matt-flow/state.md`）。
