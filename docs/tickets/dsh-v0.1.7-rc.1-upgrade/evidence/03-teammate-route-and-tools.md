# D 取证：teammate 的路由、preset 继承与工具面（0.1.7-rc.1）

> 日期：2026-09-23　上游：`@deepseek-ai/dsh@0.1.7-rc.1`
> 关联：`docs/dsh-v0.1.7-rc.1-upgrade-plan.md` §5.5「D 实跑补充」、§8 第 8/9 条
> 方法：临时前缀安装 + 临时 `DSH_HOME`；探针插件直调 `ctx.agentTeams.spawnTeammate()`（不需要模型），在 `agent/created` 中按 roster 角色分派观测

## 1. 结论

| 问题 | 结论 | 证据 |
| --- | --- | --- |
| teammate 的 LLM 路由从哪来 | **继承 Lead**，无 per-teammate 覆盖入口 | ① `spawn_teammate` schema 与 `SpawnTeammateRequest` 均无路由字段；② `roster.spawn` 调 `subagents.startContinuable({childId, provider, label, request:{prompt, parent}, signal})` **不传 `agentOptions`**；③ `dsh-subagent` 的 `resolveChildAgentOptions(parent, requested, childDepth)` 文档注释："the delegating parent **whose route the child inherits**" |
| teammate 是否继承 Lead 的 preset | **继承** | `childSessionMeta()` 取 `parent.ctx.get("agentPresets")?.composedPreset(parent.ctx)` 写入子会话 header `agentPreset`；`applyChildComposition()` 调 `composeFrom(childCtx, parent.ctx)` |
| teammate 的工具面 | 与 Lead **相同**（实测 28 = 28），但 `spawn_teammate` **可见不可用** | `[teammate-tools] n=28`，调用 `spawnTeammate` 被拒：`only the Team Lead can create teammates` |
| 成员上限计数 | `journal` 以 `state.members.length >= maxMembers` 判定（错误码 `TEAM_MEMBER_LIMIT`）；**Lead 是否计入未确认** | `dsh-experimental-agent-team/lib/index.js` |

## 2. 原始观测（`03-capture-teammate.jsonl`）

```
[created] role=lead name=lead
[created] role=teammate name=probe
[teammate-tools] n=28 subagent:❌ spawn_teammate:✅ wait_agent:✅ list_agents:✅ send_message:✅ team_task_list:✅ interrupt_agent:✅
[teammate-header] origin=subagent depth=1 agentPreset=undefined parent=session-89162a…
[spawned] member.model=deepseek-flash
```

- 本场景 Lead 自身没有 preset（headless 创建的会话不带 `agentPreset`），因此子会话 `agentPreset=undefined` 属预期；**这不构成"不继承"的证据**——继承逻辑在 `childSessionMeta()` 里，Lead 有 preset 时会随之下沉。
- 角色判定用 `ctx.agentTeams.tryMembership(agent)`；Lead 资格在 `agent/created` 时**尚未立即就绪**（首次调用会得到 `only the Team Lead can create teammates`，重试后成功）——探针或 UI 若在创建瞬间判定角色需带重试。

## 3. 对显示层的直接含义

1. **不能用"工具是否存在"判断权限**：teammate 的 `spawn_teammate` 在工具面里，但调用必被拒绝 → 权限必须读 roster 的 `role`（`lead` / `teammate`）。
2. **teammate 会话是普通子会话**：`origin: subagent`、`delegationDepth: 1`、`parentSession` 指向 Lead——专题 A 的子会话只读视图可直接复用。
3. **模型维度无决策空间**：teammate 路由继承 Lead，因此"让某个成员跑便宜模型"在当前实现下不可表达（与 §5.5 的结论一致）。

## 4. 证据文件

| 文件 | sha256 |
| --- | --- |
| `03-capture-teammate.jsonl` | `0e999a252fb358d7e5071a7f52917e528fc6e972e38eee9e9932db9e2aeee27b` |
