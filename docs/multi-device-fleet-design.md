# 多设备 dsh 舰队：共享记忆与远程指挥设计

> 状态：设计稿 v2（2026-08-27 评审修订：hub 定岗、记忆双机制、approval 桥、水位持久化、前端操控语义、宪法与 skills 布放、memory-sink 外挂（方案 B2）、bootstrap+spawn workspace 切换），未排期。
> 本稿是整体设计（权威）；relay 改造细节见派生设计
> `~/data/dev/dsh-relay/docs/relay-v1.1-fleet-design.md`，两稿冲突以本稿为准。
>
> **⚠️ 2026-08-30 网络层被取代**：本稿的 relay/fleet 网络层部分（§4–§5、§8 第 2 项、
> `relay-server 单连接单会话`、memory-sink 外挂、fleet-client/`relay-v1.1-fleet-design.md`）
> 已被 `dsh-relay/docs/relay-v2-hub-router-design.md`（relay v2 hub router，wire v3）取代：
> 全网络单入站 hub（`:9877`）、worker/TUI/IM 全部出站注册、多会话多路复用、中央记忆单写
> （废除 memory-sink/local-sink 旁路）。本稿的**整体架构结论**（hub = controller、共享记忆单写、
> TUI/IM 同构前端、周报用例、安全边界）仍有效；**网络层冲突一律以 relay-v2 稿为准**。
>
> 目标场景：macOS（TUI 薄前端）+ 家里 Linux / Windows / Mac mini（各跑一个 dsh worker）+ 手机 IM（Telegram/飞书），
> 通过 Tailscale 互联；一台 7×24 hub 作为唯一大脑（controller），共享一份记忆/知识库，能向任意设备派活，
> 并能从 macOS TUI 与手机下达同样的指令。

## 1. 结论先行

| 问题 | 建议 |
|---|---|
| dsh 有没有现成 IM/多机编排 | ❌ 没有；需要基于现有 relay + endless 扩展 |
| 多机"大脑"怎么组织 | **hub 即 controller**：一台 7×24 机器跑唯一大脑（agent + fleet-client + 中央 endless + IM 网关 + cron）；macOS TUI 是它的 relay 薄前端；各节点是 worker，不决定"做什么"，只在任务内决定"怎么做" |
| 共享记忆怎么实现 | **全局单写 hub + 双机制**：hub 持有唯一 endless DB（mac 交互会话经 remote-client 的 memory-sink 外挂回灌，fleet 任务由 hub 侧 mirror 原生落库，mac 本地不挂 endless）；派活/开工时 digest 随会话注入（被动），执行中经 endless 工具桥 recall/remember 中央库（主动）；worker 进程不直连 DB |
| macOS TUI / 手机 IM 是什么 | controller 的两个接入面（前端）；macOS 走现有 relay 薄前端，IM 复用 P4 bot 设计（endless DESIGN §21）；决策、记忆、审批全在 hub |
| 第一业务线 | 每周国内半导体周报：hub cron 触发 → 派活 → 生成 → 推 IM → 记忆落库 |

## 2. 总体架构

```
 接入面（Tier 0 —— 交互全流式，记忆走 sink 外挂）
   macOS TUI ──remote-client（现有链路）──▶ hub relay-server（指挥台会话）
   macOS TUI ──remote-client（现有链路）──▶ 任意 worker（本机/远程交互 coding）
   macOS TUI ──memorySink（可选）─────────▶ hub memory-sink（记忆外挂）
   手机 IM（TG/飞书）── bot 适配器（复用 P4 §21 设计）────────────┤
   hub cron ── headless runner（定时/手动触发）──────────────────┤
                                                                 ▼
 大脑层（Tier 1 —— 7×24 hub：唯一 controller，一个 dsh 进程）
   controller agent(s)（每个前端/任务一个会话，互不阻塞）
   + relay-server（服务 macOS 指挥台，endlessLocal）
   + memory-sink（收交互会话事件流 → 中央库）
   + fleet-client（任务派发 + mirror 会话回灌）
   + endless 中央库（capture/distill/inject/tools 单写）
   + IM 网关 / cron 触发
                                   │ Tailscale（tailnet only）
       ┌──────────────┬────────────┼──────────────┬──────────────┐
       ▼              ▼            ▼              ▼              ▼
  Linux dsh      Windows dsh   Mac mini dsh    macOS 本机             （未来设备）
  bootstrap      bootstrap     bootstrap       bootstrap（固定端口 A）
  + spawn ×N     + spawn ×N    + spawn ×N      + spawn worker（按需）
```

关键原则：

- **hub 是唯一大脑**：7×24 机器跑 controller；macOS TUI、手机 IM、cron 都是它的前端，不各自决策。
- **worker 不决定"做什么"**：任务选题、编排、验收由 controller 决定；worker 只在任务范围内自行决定"怎么做"（查什么源、跑什么工具）。
- **记忆单写 hub（含 mac 本地 coding，方案 B2）**：交互会话的事件经 remote-client 的 memory-sink 外挂转发到 hub 中央 endless；fleet 任务的事件由 hub 侧的 mirror 原生落库；mac 本地不挂 endless，存量本地库搬迁退役（§5.6）。
- **relay 是神经**：mac→hub 走现有 remote-client（已实现）；hub→worker 走 fleet-client（派生设计）；事件回灌、工具桥、ask_user 桥复用现有机制。

## 3. 分层模型

| 层 | 承担者 | 职责 |
|---|---|---|
| 接入面 | macOS TUI（relay 薄前端）、Telegram、飞书、hub cron | 人的输入输出与定时触发；都是 hub 的"前端"，无决策、无记忆 |
| 控制面 | hub（7×24）上的 controller agent + fleet-client + relay-server | 唯一大脑：理解意图、设备注册表、派发任务、汇总结果、审批 |
| 执行面 | Linux/Windows/Mac mini/macOS 本机的 dsh worker（relay-server） | 跑 bash/工具/生成；每台一个或多个持久 session；不决定做什么 |
| 记忆面 | hub 上的 endless 中央库 | 事件捕获、蒸馏、知识库、profile、digest 注入 + 工具桥检索 |

### 3.1 为什么 macOS TUI 和手机 IM 都不是"第二个 controller"

两者只是 hub 的接入面，同构且不承载决策：

- **macOS TUI**：两种模式同一条 remote-client 代码。指挥台模式连 hub（不挂 endless），
  hub 会话全流式渲染；交互 coding 模式直连任意 worker（本机 mac-worker 或远程），
  与现有 relay 体验完全一致——token/tool/diff/审批弹窗全流式。记忆经 remote-client
  的 memorySink 外挂落 hub（方案 B2，见 §5.6）。
- **手机 IM**：复用 P4 bot 设计（endless DESIGN §21）——每个 chat 一个 agent 会话，
  消息进 hub、回复出 hub；能力与 TUI 完全同构。
- 记忆、权限、审批都在 hub 一个地方；TUI/IM 只是同一审批面板与同一 `fleet_dispatch`
  工具的两个渲染面。

## 4. 共享记忆（核心设计）

### 4.1 可选方案

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| A. 中央库汇聚（推荐） | hub 持有唯一 endless DB；所有 worker 事件经 relay 回灌 mirror 会话，由 endless capture 落库 | 单一真源、零同步冲突；回灌机制已实现 | worker 进程无本地库；离线不能查库 |
| B. 每机本地库 + 定期合并 | 各节点保留 endless DB，再同步 entities | 节点离线也能用本地记忆 | 合并/冲突/版本化复杂，易双重真相 |
| C. 远程记忆服务（暂不做） | 中央库开服务，worker 进程内直连查询 | 不依赖 controller 中转 | 工具桥已覆盖"主动检索"需求；仅当需要绕过 controller 直连才做 |

### 4.2 推荐：中央库汇聚（双机制）

```
worker session 事件 ──relay──▶ hub 镜像会话（mirror）──endless capture──▶ 中央 DB
                                                                            │
controller 派活时 ──① digest 随任务下发（被动注入）──────────────────────────┤
worker 执行中   ──② recall/remember 经工具桥查中央库（主动检索）───────────────┘
```

- **记录**：worker 的事件流经 relay 回到 hub 的 mirror 会话，endless 照常 capture/distill；
  **mirror 会话是 worker 工作的事实源**。
- **注入**：controller 派任务时，fleet_dispatch 工具内部从中央库蒸馏 digest（Working State +
  Profile + 相关 KB），放进任务 payload；worker 带着记忆干活。
- **主动检索**：worker 模型需要更多记忆时，直接调 `recall/remember/state_get` 等工具——
  endless 工具桥（现有 1:1 relay v1.1 已实现，fleet-client 复用）把调用转回 hub 本地库执行。
  进程层面 worker 仍不直连 DB，但模型视角下"随时可查中央库"。
- **升级路径**：方案 C 降级为可选（暂不做）——只有需要 worker 进程内直连库（无 controller
  中转）时才做；v1 由"digest 注入 + 工具桥"覆盖全部读写需求。

## 5. 指挥多设备：relay 升级为 fleet

现状 relay 是 1:1（一个 server ↔ 一个 client，单会话、无任务语义）。要指挥多台，需要扩展成
fleet 协议，而不是推倒重来；mac→hub 这一跳直接沿用现状，只有 hub→worker 需要新能力。

### 5.1 能力差距

| 能力 | 现状 relay | fleet 版 |
|---|---|---|
| 连接 | 单 server 单 session | 多 worker 注册表 + 按设备路由 |
| 任务 | 只有 `user-input` 转发 | `dispatch(task, device)` / `status` / `cancel` / `result` / `task-query` |
| 事件 | 单向回放 | 任务级事件流 + 完成/失败回执 |
| 断线 | 降级本地 | 重连 + 增量补回放（水位持久化）+ 未完成任务可查 |
| 审批 | 无（worker 进程 fail closed） | approval 桥（同一对消息）：交互会话回 mac TUI 面板，fleet 任务回 hub 面板再桥 TUI/IM |
| 内容 | 仅文本 | 附件/图片/结构化结果 |

### 5.2 controller 侧工具

在 hub controller 里注册一个模型工具（dsh 插件，走 `ctx.tools.register`）：

```
fleet_dispatch({
  device: "linux-box",                  // 必填：worker 设备
  task: "生成国内半导体周报，数据截止本周五",    // 必填
  project: "weekly/semiconductor",      // 可选：记忆归属；缺省用 worker cwd 探测的 projectKey
  session: "weekly-report",             // 可选：worker 会话 id；缺省 device.defaultSessionId
  fresh: false,                         // 可选：true = 新建一次性会话（one-shot 任务）
  memory: "auto",                       // auto = 工具内部组装 digest；显式文本 = 覆盖
})
```

- 工具内部通过 Tailscale IP 连对应 worker 的 WS 端口下发任务（协议见派生设计）；
- **memory 由工具内部组装**（项目 state_get + 相关 KB + Profile），不在模型上下文里绕一圈；
  组装点是"记忆离开中央库"的出口，执行离库脱敏（sensitive 实体默认不进任务 payload）；
- **project 绑定 mirror 会话**（endless bindSession），无 repo 的任务（如周报）也有稳定归属；
- worker 跑完回传结果与事件流；controller 显示结果到 TUI / 推给 IM，事件经 mirror 落库；
- 工具执行阻塞当前 turn：长任务注意单会话占用（周报跑 10 分钟 = 该前端会话忙 10 分钟；
  各前端各有会话、互不阻塞；同一 worker 的任务串行策略见派生设计）。

### 5.3 worker 侧形态

每个节点跑 dsh + relay-server（worker），暴露控制端口（只绑 Tailscale 网卡）。worker 需要有：

- 任务接收与执行（可复用 `agents`/`sessions`/`tools`）；
- 结果/事件回传；
- 独立 token 或 Tailscale ACL 白名单；
- 审批桥：危险操作的 approval/request 经 wire 到驱动它的那侧应答——交互 coding 会话
  回 mac TUI 审批面板（worker↔mac 一跳）；fleet 派活回 hub 审批面板（worker↔hub 一跳，
  hub 再桥到 TUI/IM）。同一对 approval-request/answer 消息，fail closed（无应答 =
  拒绝，不挂起 turn）；
- 无人值守任务（cron 触发）建议 worker 会话 approval policy 设 `never`：可预期地自动拒绝，
  任务所需权限通过 profile 沙箱配置预置，而不是运行时索要。

### 5.4 TUI/IM 如何操控设备：两种模式

| 模式 | 交互 | 体验 | 记忆 |
|---|---|---|---|
| 指挥台（连 hub） | 自然语言，或 `/fleet list`、`/fleet <device> <task>`、`/fleet cancel`、`/device`（会话级当前设备） | hub 会话全流式；fleet_dispatch 只有工具卡 + 结果（worker 内部细节不流式） | hub 原生落库 |
| 交互直连（连任意 worker） | remote-client 直连目标 worker（本机 coding / 远程 coding）；`/workers`、`/spawn <dir>` 动态起 workspace worker；`/new`、`/resume` 切会话 | 与现有 relay 完全一致：token/tool/diff/ask_user/approval 全流式 | memorySink 外挂落 hub |

- 指挥台模式不存在"切换 relay-server"问题：TUI 永远只连 hub，设备选择是 hub 内的语义
  路由（模型工具 + 命令 + `/device` 绑定），与 P4 slash 命令同哲学。
- 交互直连模式的"切换设备/workspace"：先连设备 bootstrap（固定端口 A，tailnet IP 或
  localhost），`/spawn <dir>` 请求它在目标目录起一个 workspace worker（临时端口 +
  一次性 token，bootstrap 就绪探测通过后回给 TUI），TUI 再重连该 worker 干活；
  `/workers` 查看、`/worker-stop` 回收。TUI 的一步式 `/open <device> <dir>` 命令
  封装此流程。
- IM 只有指挥台模式：bot 永远连 hub，每 chat 一个会话 + 同样的 `/fleet`、`/device`
  命令；IM 不驱动交互式 worker 会话（v1.1 边界）。
- workspace 切换 = bootstrap + spawn：relay 的 workspace 是 worker 进程 cwd，所以
  "在目录里起 worker"就是"选 workspace"；bootstrap 校验目录在 roots 白名单内后
  spawn 子进程（固定 profile 参数，不拼 shell），端口 0 临时分配 + 一次性 token。
  hello.workspace 被 spawn 方案替代（确需进程内切换再议），多会话并发仍留后续。

### 5.5 worker 的宪法与 skills 布放

| 资产 | worker 默认读什么 | 统一方式 | 结论 |
|---|---|---|---|
| 全局宪法（AGENTS.md/CLAUDE.md） | worker 机器自己的 `$DSH_HOME/AGENTS.md` | relay v1.1 宪法同步（已实现）：驱动侧（交互 = mac，fleet = hub）基线经 context-inject 注入 worker 会话（source 改写为 relay/constitution）；本机 worker 同机同一份，无需注入 | 权威宪法只维护驱动侧一份；远程 worker 放最小引导或干脆不放 |
| 项目级宪法 | worker checkout 里的 AGENTS.md/CLAUDE.md | 远端 agent-instructions 自己 reconcile checkout；与注入宪法并存 | 随 checkout 走，谁 checkout 谁就有；hub 注入兜底 |
| 全局 skills | worker 机器自己的 `$DSH_HOME/skills` | **无 skill 桥**：skill 是工具 + 指令资源，由 skill-filesystem 按各进程文件系统发现 | 每台 worker 各有一份；统一靠部署同步 |
| 项目级 skills | checkout 里的 `.dsh/skills`、`.agents/skills` | 随 checkout 走 | 谁 checkout 谁就有；周报类无 repo 任务只有 worker 全局 skills |

要点：

- 宪法是文本，可以过 wire；skill 是可执行工具 + 指令资源，注入文本不等于有了工具。
  relay 没有 skill 桥，worker 模型能用的 skill = 该机器上实际存在的那些。
- 全局 skills 统一方式：把 skills 目录以 git 仓库 checkout 或 rsync 分发到每台 worker
  （注意 Windows 路径差异），与 `scripts/sync-agent-presets.sh` 同步 presets 的部署思路
  一致；宪法则相反——不要往 worker 复制，靠注入避免多份漂移。

### 5.6 mac 本地 coding：交互链路不变 + memory-sink 外挂（方案 B2，定稿）

mac 上的项目（如 dsh-plugins）agent coding 与"连远程 worker 干活"是**同一段
remote-client 代码、同一种体验**——relay 链路保持现有 1:1 形态，记忆落 hub 只是
client 侧一个可选外挂：

```
mac TUI ──remote-client（现有链路，localhost/远程，全流式）──▶ worker relay-server
   └── memorySink（可选 WS）──▶ hub memory-sink ──▶ mirror 会话 ──▶ endless 中央库
```

- **交互链路零改动**：user-input/steer/cancel、ask_user 与 approval 弹窗、逐事件全流式
  渲染——与现有 relay-client + relay-server 完全一致；本机与远程 worker 无差别。
- **记忆外挂**：remote-client 把 worker 的每条事件转发给 hub memory-sink（hub 侧建
  mirror 会话 → endless 照常 capture）；worker 的 recall/remember 经 client 转 hub
  本地库执行；hub 把 digest 经 client 回注 worker。不开 sink = 行为等同现有 relay。
- **单写维持**：mac 不再挂本地 endless；存量 `~/.endless` 库停止写入后整库搬迁到 hub
  （URL-key 记忆无缝续用，path-key 记忆以全局 KB 形式可查，迁移细节待定）。
- **宪法与 skills**：本机 worker 与 mac 同一份文件，无需同步；远程 worker 沿用宪法
  注入与 skills 部署同步（§5.5）。
- **降级语义**：hub/sink 断线时交互照常（全流式），只是 recall/remember 报错、事件
  暂进 remote-client 的持久化转发缓冲；sink 重连后按序补发并重注 digest，错过的
  记忆照常落库。
- **与 fleet 派活的隔离**：hub 向 mac 派活走独立 worker（hub 调 bootstrap 动态 spawn
  或复用独立实例，另一个端口/会话），不走 coding 的 relay 连接，互不污染。

## 6. 每周周报用例

| 环节 | 放哪 |
|---|---|
| 定时触发 | hub 的 systemd/cron/timer（**不用 dsh-schedule**：会话级、进程不在不跑） |
| 生成 | `fleet_dispatch` 派给某个 worker（project 固定 `weekly/semiconductor`）：`web_search` + 本地资料 → Markdown |
| 推送 | Telegram/飞书频道；hub 收到 task-result 后 `remember` 归档进中央 KB |
| 手动 | IM / TUI 里 `/weekly` 随时触发同一流程（与 cron 同一条执行路径） |

## 7. 安全边界

| 项 | 建议 |
|---|---|
| 网络 | dsh/relay/worker 端口只绑 Tailscale 网卡，不开公网；Tailscale（WireGuard）已提供传输加密，TLS 后续只解决端内身份，v1 不强制 |
| 鉴权 | relay 现有 token 保留；每个 worker 独立 token 或 Tailscale ACL 白名单；设备身份（clientId 白名单）列后续 |
| 权限 | 危险操作经 approval 桥到驱动侧应答：交互会话回 mac TUI、fleet 任务回 hub 面板（再桥 TUI/IM），fail closed；controller 派发任务本身也走审批流；cron 无人值守任务用 approval policy `never` + 沙箱预设 |
| 敏感记忆 | 出网边界 = fleet_dispatch 的 digest 组装点：sensitive 实体默认不进 task payload，其余按离库脱敏执行；不再依赖"进上下文"的隐式边界 |
| 单点备份 | 中央库是全网记忆唯一真源：hub 上做 SQLite 定期备份 + 异机副本，备份失败要告警 |

## 8. 实施路径

1. **hub 定岗 + mac 双模式**：定一台 7×24 机器为 hub = controller；macOS 上跑 bootstrap worker（固定端口）+ 按需 spawn 的 workspace worker、remote-client 双模式（指挥台连 hub / 交互直连 worker）+ memorySink；mac 本地不挂 endless，存量库搬迁 hub（§5.6）。
2. **relay 多节点化（派生设计）**：交互链路零改动；协议 v2（task-run/result、增量补回放、approval 桥、task-query）+ fleet-client（水位持久化）+ memory-sink 插件，一切的地基。
3. **中央记忆汇聚 + fleet_dispatch 工具**：所有 worker 事件回灌 endless；工具实现 project 绑定、内部 digest 组装与出网脱敏；先做"发提示词到指定 worker 并拿回结果"。
4. **IM 网关**：Telegram/飞书 bot（复用 P4 §21 设计）接入 hub，成为与 TUI 平级的接入面。
5. **周报作为第一个真实用例**：cron 触发 → dispatch → 生成 → 推 IM → 记忆落库。

## 9. 与现有资产的关系

| 资产 | 在本设计中的角色 |
|---|---|
| `dsh-relay` | remote-client 两种模式（hub 指挥台 + 任意 worker 交互 coding，均全流式）+ memorySink 外挂 + fleet-client 任务派发；relay-server 交互语义零改动，只加 fleet 任务与审批桥 |
| `dsh-endless` | hub 中央记忆库（全局单写）；capture/distill/inject/tools 全部复用；mac 不再挂本地 endless，存量库整库搬迁 |
| `dsh-plugins` TUI | mac 两个形态的渲染面（hub 会话镜像 + 本机 coding 会话，均全流式）与 hub 本地前端（可选） |
| IM bot（P4 §21 已定稿） | controller 的远程前端，复用同一 hub agent 与 fleet 工具 |
| `dsh-schedule` | 不适合作跨设备定时；周报定时走 hub cron/timer |

## 10. 未决问题 / 风险

| 问题 | 说明 |
|---|---|
| ~~controller 与 hub 是否同一台~~ | ✅ 已定：hub = controller（7×24）；macOS 为 relay 薄前端 |
| worker 会话模型 | relay-server 保持单连接单会话（B2 零改动）；workspace worker 由 bootstrap 按需 spawn；单 server 多会话并发留后续 |
| ~~直连模式设备/workspace 切换~~ | ✅ 已定：bootstrap + spawn（§5.4）；TUI 的一步式 `/open <device> <dir>` 命令列入实施；hello.workspace 被替代，多会话并发仍留后续 |
| mac 存量记忆搬迁 | 本地 endless 停写后整库搬到 hub；URL-key 记忆无缝、path-key 记忆转为全局 KB 可查；搬迁脚本与验证待定 |
| worker 是否需要离线自主 | 工具桥依赖连线；若要求 worker 离线可查记忆，才做方案 C（暂不做） |
| relay 断线语义 | 已入协议：增量补回放 + task-query 对账；任务超时策略（默认不超时）仍待定 |
| IM 审批交互 | approval/ask 需翻译成 Telegram inline keyboard / 飞书卡片按钮 |
| Windows 差异 | 需验证 Windows 上 dsh worker 的 sandbox/pwsh 链路与 Tailscale 端口绑定 |
| 双重 capture 噪声 | controller dispatch 会话与 worker mirror 会话都会 capture；先观察 distill 重复实体率，必要时镜像侧标记跳过 |
| 中央库备份 | SQLite 备份频率与异机副本落点待定 |
