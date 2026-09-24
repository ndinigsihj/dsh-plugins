# B2-pre 取证：Team 开启后 `subagent` / `spawn_teammate` 是否并存

> 日期：2026-09-23　上游：`@deepseek-ai/dsh@0.1.7-rc.1`
> 关联：`docs/dsh-v0.1.7-rc.1-upgrade-plan.md` §5.0；决策「Team 本轮开启」后的前置确认
> 环境：临时前缀安装 + 临时 `DSH_HOME`，真实 headless 组合冒烟；未触碰真实 `~/.dsh`

## 1. 方法

探针插件（临时目录，不入库）在 `agent/created`、`setImmediate`、`agent/status` 三个触发点调用
`ctx.tools.schemas(agent)`，把该 Agent 作用域**实际可见**的工具名写盘：

```js
export const name = 'b2-capture3'
export const inject = ['tools']
export function apply(ctx, config) {
  const snap = (agent, tag) => { /* ctx.tools.schemas(agent).map(s => s.name).sort() → jsonl */ }
  ctx.on('agent/created', ({ agent }) => { snap(agent, 'created'); setImmediate(() => snap(agent, 'immediate')) })
  ctx.on('turn/start', ({ agent }) => snap(agent, 'turn-start'))
  ctx.on('agent/status', ({ agent }) => snap(agent, 'status'))
}
```

两个 profile（bundles 只差 Team 组合包），两者都声明同一个合成 agent preset（含 `tool-subagent` 行）：

| profile | bundles | preset |
| --- | --- | --- |
| `b5ctl` | `dsh-base`, `dsh-headless` | `standard`：`preset-tool-subagent`（`@deepseek-ai/dsh-tool-subagent`，`modelSelectionSettings: true`） |
| `b5team` | `dsh-base`, `dsh-headless`, `dsh-experimental-agent-team-profile` | 同上 |

运行：`DEEPSEEK_API_KEY=dummy dsh --profile <p> "hi"`（凭据为假，模型调用必然失败，但 Agent 创建与工具装配已完成）。

## 2. 结果

| 工具 | `b5ctl`（对照） | `b5team`（Team 开启） |
| --- | --- | --- |
| 可见工具总数 | **24** | **28** |
| `subagent` | ✅ | **❌** |
| `subagent_fork` | ✅ | **❌** |
| `spawn_teammate` | ❌ | ✅ |
| `wait_agent` | ❌ | ✅ |
| `team_task_create` / `_get` / `_list` / `_update` | ❌ | ✅ |
| `list_agents` / `send_message` / `interrupt_agent` | ✅（base 的全局 control 行） | ✅（Team 作用域替代版，随 `tool-agent-team` 安装） |
| `list_subagent_models` | ❌ | ❌ |

`b5team` 的 28 = 19（base 去掉 4 行 subagent/control 后的可见集）+ 9（Team 工具）。

**结论：在当前 profile 组合下，Team 开启后 `subagent` / `subagent_fork` 从工具面消失，`subagent` 与 `spawn_teammate` 不并存。**
`dsh-tool-subagent` 源码里没有 Team 守卫（grep 仅 1 处无关 `membership` 字样），因此这是**组合层禁用**（bundle patch 的 4 条 `disabled: true`）的直接结果。

## 3. 未能测到的部分（重要）

**preset 层能否把 `subagent` 重新带回来，本轮没有测到**，原因是 harness 层面而非结论层面：

1. 合成 preset 从未真正挂载 —— 对照组里 `subagent` 来自 `dsh-base` 的 profile 行，而哨兵行（`@deepseek-ai/dsh-tool-ask-user`，base 工具面没有 `ask_user_question`）在两个 profile 中都**未出现**，证明 preset 未生效。
2. 预设绑定走 Session 的 `agentPreset` 投影（`dsh-agent-preset-registry` 从 header 初始化、由选择推进）；headless 创建的会话不带 `agentPreset`。
3. 强行绑定失败：`ctx.agentPresets.select(agent, 'standard')` 返回 **`This session has already started`** —— 选择必须在会话开始前发生。

→ 预设选择是 **app 侧（本仓库 TUI / Web 预设选择器）** 的职责。因此"preset 层能否让 `subagent` 与 `spawn_teammate` 并存"必须在迁移后的 TUI（或用 Web 预设选择器）里验证，不能在 headless 合成 harness 里定论。

## 4. 模型选择机制的存活情况（静态）

`@deepseek-ai/dsh-tool-subagent@0.1.7-rc.1` 仍提供：

- `exports["./model-selection-settings"]`（设置服务入口）
- `modelSelectionSettings` 配置字段（运行时引用 6 处）
- `list_subagent_models`（4 处）
- `subagent/model-selection-policy` 会话事件（3 处）

即机制本身未移除；但在 Team 组合下 `subagent` 工具不存在，机制**无处附着**。

## 5. 证据文件

| 文件 | sha256 |
| --- | --- |
| `02-capture-control.jsonl` | `6f30170f555e81164317e017cfc190fea8b233913fd116889a5faf5e9cb45508` |
| `02-capture-team.jsonl` | `be4febc4a9dd05f502f8f6c04391837e491ac6e34a925995186a974b1fe23b7f` |

（`*.jsonl` 为未裁剪的原始捕获，含 `created` / `immediate` / `status` 三个触发点；`created` 时点的 Team 工具尚未装配，属已知竞态，判读请看 `immediate` / `status` 两行。）
