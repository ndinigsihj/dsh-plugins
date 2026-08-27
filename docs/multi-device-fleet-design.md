# 多设备 dsh 舰队：共享记忆与远程指挥设计

> 状态：设计讨论稿（2026-08-27），未排期。
>
> 目标场景：macOS（TUI）+ 家里 Linux / Windows / Mac mini（各跑一个 dsh）+ 手机 IM（Telegram/飞书），
> 通过 Tailscale 互联；macOS 作为指挥台，共享一份记忆/知识库，能向任意设备派活，并能从手机下达同样的指令。

## 1. 结论先行

| 问题 | 建议 |
|---|---|
| dsh 有没有现成 IM/多机编排 | ❌ 没有；需要基于现有 relay + endless 扩展 |
| 多机"大脑"怎么组织 | macOS controller 一个 agent 负责理解与派发；各节点是 worker，只执行不决策 |
| 共享记忆怎么实现 | **中央库汇聚**：选定一台 7×24 机器持有唯一 endless DB，所有 worker 事件经 relay 回灌，派活时把记忆 digest 随任务下发 |
| 手机 IM 是什么 | controller 的另一个前端，与 TUI 平级；共用同一 agent、同一记忆、同一 fleet 工具 |
| 第一业务线 | 每周国内半导体周报：hub cron 触发 → 派活 → 生成 → 推 IM → 记忆落库 |

## 2. 总体架构

```
                    macOS（controller / 指挥台）
   TUI ────────────▶┌──────────────────────────────────┐
   IM (TG/飞书) ───▶│  controller agent（dsh）           │
                    │  + fleet 插件（设备表/派发工具）    │
                    │  + endless（中央知识库/记忆枢纽）   │
                    │  + relay 多路客户端（事件回灌）     │
                    └───────────────┬──────────────────┘
                                    │ Tailscale（tailnet only）
      ┌──────────────┬──────────────┼──────────────┬──────────────┐
      ▼              ▼              ▼              ▼              ▼
 Linux dsh      Windows dsh     Mac mini dsh      （未来）      手机 IM 网关
 worker         worker          worker                           （并入 controller）
```

关键原则：

- **worker 没有主见**：不自己做决策，只接收任务、执行、回报。
- **controller 是唯一入口**：TUI 和 IM 都连 controller，不直接连 worker。
- **relay 是神经**：负责 controller ↔ worker 的双向链路与事件回灌。
- **endless 是记忆**：所有节点的经验汇聚到中央库，派活时反向注入。

## 3. 分层模型

| 层 | 承担者 | 职责 |
|---|---|---|
| 接入面 | TUI、Telegram、飞书 | 人的输入出口；都是 controller 的"前端" |
| 控制面 | macOS controller agent + fleet 插件 | 理解意图、设备注册表、派发任务、汇总结果 |
| 执行面 | Linux/Windows/Mac mini 的 dsh worker | 跑 bash/工具/生成；每台一个或多个持久 session |
| 记忆面 | endless 中央库 | 事件捕获、蒸馏、知识库、profile、注入 digest |

### 3.1 为什么手机 IM 不是"第四台设备"

手机不需要自己的 dsh。IM 网关把消息送进 controller 的 agent 会话，controller 用同一套
`fleet_dispatch` 工具指挥 worker。这样手机获得的能力与 TUI 完全同构，而记忆/权限/审批
都留在 controller 一个地方。

## 4. 共享记忆（核心设计）

### 4.1 可选方案

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| A. 中央库汇聚（推荐） | 一台 7×24 机器持有唯一 endless DB；所有 worker 事件经 relay 回灌，由 endless capture 落库 | 单一真源、零同步冲突；现有 relay 已支持事件回放 | worker 本地无共享记忆；派活时需把 digest 塞进任务 |
| B. 每机本地库 + 定期合并 | 各节点保留 endless DB，再同步 entities | 节点离线也能用本地记忆 | 合并/冲突/版本化复杂，易双重真相 |
| C. 远程记忆服务 | 中央库开 `recall/remember/state` 服务，所有节点远程查询 | 每个节点都能直接检索共享 KB | 要新写服务层，超出 relay 范畴 |

### 4.2 推荐：中央库汇聚

```
worker session 事件 ──relay──▶ controller 镜像会话 ──endless capture──▶ 中央 DB
                                                                            │
controller 派活时 ◀──蒸馏 digest（Working State + KB + Profile）───────────┘
```

- **记录**：worker 干完活，事件流经 relay 回到 controller 的镜像会话，endless 照常 capture/distill。
- **注入**：controller 派任务时，从中央库把相关记忆蒸馏成 digest，放进任务 payload；worker 不查库，直接"带着记忆干活"。
- **升级路径**：以后 worker 要独立检索共享 KB，再在 A 的地基上加 C（远程记忆服务）。

## 5. 指挥多设备：relay 升级为 fleet

现状 relay 是 **1:1**（一个 server ↔ 一个 client，单会话、无任务语义）。要指挥多台，需要扩展成 fleet 协议，而不是推倒重来。

### 5.1 能力差距

| 能力 | 现状 relay | fleet 版 |
|---|---|---|
| 连接 | 单 server 单 session | 多 worker 注册表 + 按设备路由 |
| 任务 | 只有 `user-input` 转发 | `dispatch(task, device)` / `status` / `cancel` / `result` |
| 事件 | 单向回放 | 任务级事件流 + 完成/失败回执 |
| 断线 | 降级本地 | 重连 + 未完成任务可查 |
| 内容 | 仅文本 | 附件/图片/结构化结果 |

### 5.2 controller 侧工具

在 controller 里注册一个模型工具（dsh 插件，走 `ctx.tools.register`）：

```
fleet_dispatch({
  device: "linux-box",
  project: "semiconductor-weekly",
  task: "生成国内半导体周报，数据截止本周五",
  memory: "<从中央库取的 digest>",
})
```

- 工具内部通过 Tailscale IP 连对应 worker 的 WS 端口下发任务；
- worker 跑完回传结果与事件流；
- controller 显示结果到 TUI / 推给 IM，并让 endless capture 落库。

### 5.3 worker 侧形态

每个节点跑 dsh + worker 插件，暴露控制端口（只绑 Tailscale 网卡）。worker 需要有：

- 任务接收与执行（可复用 `agents`/`sessions`/`tools`）；
- 结果/事件回传；
- 独立 token 或 Tailscale ACL 白名单；
- 权限预设（`danger-full-access` 前走 approval，或 controller 预授权）。

## 6. 每周周报用例

| 环节 | 放哪 |
|---|---|
| 定时触发 | hub 的 systemd/cron/timer（**不用 dsh-schedule**：会话级、进程不在不跑） |
| 生成 | 派给某个 worker 或 controller 自己：`web_search` + 本地资料 → Markdown |
| 推送 | Telegram/飞书频道；同时归档进中央 KB |
| 手动 | IM / TUI 里 `/weekly` 随时触发同一流程 |

## 7. 安全边界

| 项 | 建议 |
|---|---|
| 网络 | dsh/relay/worker 端口只绑 Tailscale 网卡，不开公网 |
| 鉴权 | relay 现有 token 保留；每个 worker 独立 token 或 Tailscale ACL 白名单 |
| 权限 | worker 端危险操作先走 approval；controller 派发任务本身也走审批流 |
| 敏感记忆 | endless 的 flag-not-redact 机制继续有效：记忆离开库进任务 payload 时按边界脱敏 |

## 8. 实施路径

1. **relay v1.1 多节点化**：设备注册 + `dispatch/status/result`，一切的地基。
2. **中央记忆汇聚**：定一台 7×24 机器做 hub（家里 Linux / mac mini 比笔记本靠谱），所有 worker 事件回灌 endless。
3. **fleet_dispatch 工具**：controller 能选设备派活；先做"发提示词到指定 worker 并拿回结果"。
4. **IM 网关**：Telegram/飞书 bot 接到 controller，成为与 TUI 平级的接入面。
5. **周报作为第一个真实用例**：cron 触发 → dispatch → 生成 → 推 IM → 记忆落库。

## 9. 与现有资产的关系

| 资产 | 在本设计中的角色 |
|---|---|
| `dsh-relay` | 从 1:1 升级为 fleet 控制链路；事件回灌机制直接复用 |
| `endless-dsh` | 中央记忆库；capture/distill/inject/tools 全部复用，只把部署变成"单库汇聚" |
| `dsh-plugins` TUI | controller 的本地前端 |
| IM bot（未来） | controller 的远程前端，复用同一 controller agent |
| `dsh-schedule` | 不适合作跨设备定时；周报定时走 hub cron/timer |

## 10. 未决问题 / 风险

| 问题 | 说明 |
|---|---|
| controller 与 hub 是否同一台 | macOS 笔记本移动性强；建议 hub 放 7×24 设备，macOS 作为薄指挥端 |
| worker 是否需要离线自主 | 当前设计 worker 不做决策；若要离线自主，需先做远程记忆服务（方案 C） |
| 多 worker 并发任务 | 同一设备同时多个任务时需任务队列/互斥策略 |
| relay 断线语义 | 需定义任务在断线期间的状态（排队/继续/失败）与重连后的回执 |
| IM 审批交互 | approval/ask 需翻译成 Telegram inline keyboard / 飞书卡片按钮 |
| Windows 差异 | 需验证 Windows 上 dsh worker 的 sandbox/pwsh 链路与 Tailscale 端口绑定 |