# dsh-plugins

自研 TUI 前端与 agent preset 的组合层：把宿主能力组装成可交互终端，并规定每个 session 的模型可见工具面。

## Language

### 组合层

**Host plane（宿主层）**:
由 base 组合提供的注册层，对所有 agent 全局可见。
_Avoid_: global scope、base layer

**Agent plane（agent 层）**:
由 preset 为某个 agent 注册的层；同名项遮蔽宿主层。
_Avoid_: preset scope

**Preset**:
一次 session 的模型可见组合，涵盖工具、prompt 段与 persona，以可发布的目录为单位。
_Avoid_: agent profile、bundle、模板

**Shadowing（遮蔽）**:
agent 层以同名 id 覆盖宿主层的行为。preset 只应在确需不同时才遮蔽。
_Avoid_: override、replace、覆盖（当指非同名时）

### Profile 与部署

**Profile**:
dsh 的启动配置，决定宿主 patch 与默认 preset。
_Avoid_: environment、mode、环境

**Stable tree（稳定树）**:
钉在旧宿主版本、供 `tui` 使用的部署位。
_Avoid_: prod、release、生产

**Dev tree（开发树）**:
跟随全局宿主、供 `tui-dev` 与 `tui-central` 使用的工作树。
_Avoid_: local、source、本地

**Deployment copy（部署位副本）**:
preset 从仓库同步到用户目录后的运行副本。
_Avoid_: installed preset、已安装

### Agent 与委派

**Agent**:
一次 session 的模型驱动主体；root agent 由 TUI 创建，子 agent 由委派创建。
_Avoid_: bot、worker

**Delegation（委派）**:
root agent 创建子代理并交付任务、取回结果的行为。
_Avoid_: handoff、spawn（指整体行为时）

**Subagent（子代理）**:
被委派创建的 agent，拥有独立上下文与独立 session 记录。
_Avoid_: child process、task、子任务

**One-shot run（一次性运行）**:
子代理跑完即结束、之后不可再续的形态。
_Avoid_: temporary subagent

**Continuable child（可持续子代理）**:
拥有持久 session id、可继续投递消息、可冷恢复的子代理。
_Avoid_: persistent subagent、background agent

**Route（路由）**:
一次模型调用的 provider 与 model 组合。
_Avoid_: model（同时指 provider 时）

**Subagent model selection（子代理模型选择）**:
创建子代理时为其指定 route 的官方机制，选择范围限于允许路由集合。
_Avoid_: purpose、subagent role、model override

**Allowed route（允许路由）**:
暴露给某个 session 供子代理选择的路由集合，由部署基线与用户设置共同决定。
_Avoid_: whitelist、catalog、白名单

### TUI 行为

**Anchored first turn（首轮锚定）**:
首轮只对模型暴露 bash 与 str_replace_editor，避免以寒暄开场。
_Avoid_: bootstrap mode

**Promotion（放行）**:
首个 tool call 之后放行完整工具目录并恢复常规注入的时点。
_Avoid_: unlock、escalate、提权

**bash 换用（phase swap）**:
放行后把该 agent 的 bash 从持久 shell 换成受沙箱约束的 bash。
_Avoid_: shell switch、换相、phase change

**Escalation（提权）**:
对单次 bash 调用申请超出当前沙箱边界的执行权限；与放行是两个独立概念。
_Avoid_: promotion、approval（审批是另一条通道）

### 度量

**M4**:
同口径 headless 对比批次，用于检测首轮锚定率、二轮注入与沙箱 bash 是否回归。
_Avoid_: benchmark、eval
