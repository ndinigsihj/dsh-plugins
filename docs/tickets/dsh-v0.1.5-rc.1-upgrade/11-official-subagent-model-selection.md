# 11 — 采用官方子代理模型选择

**What to build:** 在开发 profile 下，模型可以在允许路由集合内为子代理指定 provider、model 与 reasoning effort；该策略记入会话、由子会话继承、事后编辑设置不会改写它；没有记录策略的旧会话保持该能力关闭。允许路由由部署基线与用户设置共同决定。

**Blocked by:** 10 — 行为基线：去重后与差异解释

**Status:** done — 2026-09-10（验收 12/12；行为探针 16/16 真实模型实跑；tui-dev dump 99 id / 0 重复且服务行 1×；部署位 preset 与仓库 sha256 一致；未 commit）

**Evidence:** `evidence/11-subagent-model-selection.md`；原始数据 `evidence/11-probe.json`（sha256 `eb986337…`）

- [x] 模型选择所需的设置服务已在宿主作用域挂载 — `~/.dsh/profiles/tui-dev/cordis.patch.yml` insert `subagent-model-selection-settings`（enabled=true + 4 路由）；headless 同 id 挂载但 enabled=false 保测量口径；探针 a1
- [x] 开发侧组合的委派工具已开启模型选择 — `presets/minimal-plus-next/agent.cordis.yml` 的 `delegation/tool-subagent` 加 `modelSelectionSettings: true`；探针 a2 委派 schema 出现 provider/model/reasoning_effort
- [x] 路由发现工具可见，且能按 provider 列出模型 — 探针 a3（promotion 后 30 工具含 `list_subagent_models`）、a4（按 provider 只列允许模型）
- [x] 模型指定 provider 与 model 后，子代理实际使用该路由 — 探针 a5 子会话 header 实跑 opencode-go/deepseek-flash；a14 真实模型自行指定并生效
- [x] 模型指定 reasoning effort 后生效 — 探针 a6 子会话 header reasoningEffort=low（a14 同断言）
- [x] 省略路由时子代理继承调用方路由 — 探针 a7 子会话 header = 父会话路由（含 effort 继承）
- [x] 子会话继承已记录的路由策略 — 探针 a8 子会话策略事件 = 父会话 4 条
- [x] 事后编辑设置不改变已记录的策略 — 探针 a9：用户层改为 gjx 后已记录会话仍按原集合（拒 gjx），新会话按新集合
- [x] 没有记录策略的旧会话上该能力保持关闭 — 探针 a10：票据 10 的 M4 E1 会话 resume 后 29 工具、`subagent` 无模型字段
- [x] 允许集合之外的路由无法被选定 — 探针 a11（创建前拒绝且无子会话）、a4（发现侧拒绝）
- [x] fork 来源的子代理与父会话保持同一路由且不参与模型选择 — 探针 a12（fork 子会话同父路由）、a13（fork 工具无模型字段）
- [x] 委派工具的名称与两种上下文来源语义保持不变 — 探针 a13：`subagent`/`subagent_fork` 名称与两种描述措辞不变
