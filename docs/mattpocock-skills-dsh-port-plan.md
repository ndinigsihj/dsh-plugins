# Matt Pocock skills 移植 dsh 计划

> 日期：2026-09-05　状态：**方案已定（2026-09-07 定版：自维护适配层 + 自有 ask-matt-flow），尚未动代码**
> 触发：用户问 https://github.com/mattpocock/skills 的 skill（例如 grill-me）能否移植到 dsh。
> 本文件是沟通基线；确认范围与适配策略后再进入执行。
>
> 更新：2026-09-05 增加 Relay/集群部署矩阵（§8）与“mac 本机走 relay worker”的生效面结论；
> 并完成子代理审批桥调查（§10）。
> 更新：2026-09-07 定版采用「自维护适配层 + 自有 ask-matt-flow」（本次对话中的方案 B），
> 不依赖社区插件 `dsh-mattpocock-skills`；详细设计见 §12，旧执行计划/决策点以 §12 为准。
>
> 位置说明：本计划从杂项目录 `others/tasks/` 移入 dsh-plugins/docs/。skill 本体安装
> 到用户级 `~/.dsh/skills/`（不属于本仓库提交物）；本仓库记录 dsh-plugins/TUI/relay
> 工作流侧的决策与实施。

---

## 1. 背景与目标

用户日常使用 dsh（0.1.1-rc.2，minimal-plus preset），看到 Matt Pocock 的
[skills](https://github.com/mattpocock/skills) 仓库后，想知道这类 skill 能否移植到 dsh，
并以 `grill-me` 为例。

初步结论（已核实）：**可以移植**。dsh 的 skill 格式与上游同构，且 rc.2 已具备
「用户斜杠触发」与「skill 之间互调」所需机制。移植主要不是写代码，而是
**决定范围、安装位置、适配哪些上游工具约定**。

目标：形成一份可供继续沟通的计划——明确候选范围、安装位置、适配规则、验收方法，
以及哪些上游 skill 依赖 dsh 目前没有的 repo 级约定。

---

## 2. 上游仓库现状（2026-09-05 抓取 main 快照）

| 项 | 说明 |
|---|---|
| 仓库布局 | `skills/{engineering,productivity,misc,in-progress,deprecated}/<name>/SKILL.md`，另有 `docs/<bucket>/<name>.md` 人类文档页 |
| Skill 格式 | `<name>/SKILL.md` + YAML frontmatter：`name`、`description`、可选 `disable-model-invocation` |
| 双调用面 | 用户显式调用（`disable-model-invocation: true`，如 `/grill-me`）与模型自动调用（省略该字段，如 `grilling`） |
| 跨 skill 依赖 | 正文写 `Call the Skill tool with "grilling"` 这类指令；`grill-with-docs` 还同时依赖 `domain-modeling` |
| 外部元数据 | 每个 skill 目录下有 `agents/openai.yaml`（Codex UI 元数据），dsh 不读取 |
| repo 级约定 | 工程流依赖 `setup-matt-pocock-skills` 初始化 `CONTEXT.md`、`docs/adr/`、issue tracker、triage labels 等 |

关键点：`grill-me` 本身是 7 行薄壳（frontmatter + “Call grilling”），真正的
面试逻辑在 **`grilling`**（28 行、model-invoked）。两者必须成对移植。

---

## 3. dsh 侧事实（已核实）

| 项 | 说明 |
|---|---|
| Skill 根目录 | `<project>/.dsh/skills`、`<project>/.agents/skills`、自定义 `customSkillDirs`、`~/.dsh/skills`、`~/.agents/skills`（按 rank 合并） |
| 文件格式 | 一层目录 bundle `<name>/SKILL.md` 或平铺 `<name>.md`；frontmatter 支持 `name`、`description`、`whenToUse`、`disable-model-invocation`、`user-invocable`；名字必须 kebab-case |
| 用户斜杠触发 | `dsh-tool-skill` 会把用户消息中独立的 `/name` token 解析为 user-invocable skill 并注入全文；`disable-model-invocation: true` 的 skill 不会进入模型目录 |
| 模型侧加载 | standard/code 系用 `skill` 工具；minimal-plus 另有自定义 `skill_search` + `skill_load`（按需注入） |
| 子代理 | dsh 有 `subagent` / `subagent_fork` / workflow，可承接 `grilling` 里“派子代理查事实”的指令 |
| 当前环境 | 0.1.1-rc.2；minimal-plus preset；`~/.dsh/skills/` 目前仅 `show-me`（作为模型自动调用样例存在） |

因此 grill-me/grilling 这类**无 repo 状态、纯对话流程**的 skill，是 dsh 最接近“原样可用”的一类。

---

## 4. 适配规则草案

| 上游写法 | dsh 适配 |
|---|---|
| `Call the Skill tool with "grilling"` | 改为“用当前会话的 skill 加载工具加载 `grilling`”（dsh 中标准为 `skill`，minimal-plus 为 `skill_load`；可用通用措辞覆盖两者） |
| `/grill-me`、`/grill-with-docs` 等用户入口名 | 保留 kebab-case 名；dsh 斜杠触发由 frontmatter + `disable-model-invocation` 决定，正文无需写触发词 |
| `/code-review`、`/tdd`、`/implement` 等内部斜杠引用 | 若移植整套工程流，需改写为 dsh 能落地的动作（模型加载子 skill / 提示用户操作）；若只移植 productivity 子集，多数不涉及 |
| `Task tool` / 背景子代理 | dsh `subagent` / `subagent_fork` / workflow |
| `agents/openai.yaml`、docs 页、`.claude-plugin` | 不移植（dsh 不消费） |
| repo 级 `CONTEXT.md`/ADR/issue tracker | 纯 productivity skill 不需要；工程 skill 需要决定是否引入同等约定 |

原则：**frontmatter 语义原样保留，正文做最小工具措辞适配**，不重写上游方法论。

---

## 5. 候选范围（待用户定夺）

| 选项 | 内容 | 依赖 | 适配量 |
|---|---|---|---|
| **A. 最小试点**（推荐先做） | `grill-me`（user）+ `grilling`（model） | 无 repo 约定，纯对话 | 很小；仅 `grill-me` 正文“加载 grilling”措辞 |
| B. Productivity 全组 | A + `handoff`、`teach`、`to-questionnaire`、`wait-what`、`writing-for-agents` | 部分会写文件（teach/handoff/to-questionnaire），无 repo 初始化需求 | 中 |
| C. 工程流子集 | `tdd`、`code-review`、`diagnosing-bugs`、`domain-modeling`、`codebase-design`、`implement` 等 | 依赖 `CONTEXT.md`/ADR/tracker 或 `setup-matt-pocock-skills` 语义 | 大，需先定 repo 约定 |
| D. 全量 promoted | A+B+C + `wayfinder`/`triage`/`wizard` 等 | 同 C，且涉及 issue tracker、CLI（gh/glab） | 最大，接近“把上游整套方法论搬进 dsh” |

推荐：先 A 验证体验与机制，再按需扩展到 B/C。理由：A 与 dsh 无冲突、无 repo 假设、
可快速得到可感知价值；C/D 必须先把“dsh 版 repo 约定”讨论清楚，否则会引入上游整套
per-repo 初始化流程。

---

## 6. 安装位置（待用户定夺）

| 位置 | 生效范围 | 适合场景 |
|---|---|---|
| `~/.dsh/skills/`（用户全局） | 所有 dsh 会话 | 推荐；grill-me 定位就是“任何工作目录都能用” |
| `<project>/.dsh/skills/` | 仅该项目 | 若只希望某些仓库启用，或按仓库微调 |
| `~/.agents/skills/` | dsh 与其它 Agent Skills 兼容工具共享 | 若想让 Codex 等也读到 |
| preset/插件打包 | 随 preset 分发 | 若以后做成自研 preset 一部分（暂不需要） |

若选 `~/.dsh/skills/`，与现有 `show-me` 并列即可，无需改 preset 配置。

---

## 7. 执行计划（确认后生效）

| 阶段 | 操作 | 验收 |
|---|---|---|
| 0 | 冻结本文件的范围/位置/适配规则 | 用户确认本文件决策点 |
| 1 | 从上游固定快照（本次 main 抓取）取 `grilling/SKILL.md`、`grill-me/SKILL.md` | 文件存在、frontmatter 完整 |
| 2 | 按 §4 最小适配写入目标目录（如 `~/.dsh/skills/grilling/SKILL.md`、`~/.dsh/skills/grill-me/SKILL.md`） | `grill-me` 保持 `disable-model-invocation: true`；`grilling` 保持 model-invocable |
| 3 | 新开会话验证：输入 `/grill-me` 能注入；模型能继续加载 `grilling` 并按轮次提问；模型目录中看不到 `grill-me`、能看到 `grilling` | 一次完整 mini-grill 对话跑通 |
| 4 | 若扩到 B/C/D，再按新增范围单独立项 | 每批独立验收 |
| 5 | 记录结论到本文件（含所选范围/位置/后续更新策略） | 状态可追溯 |

> 注：本文件已移入 dsh-plugins 仓库 docs/；执行时按该仓库规则（需要时再提交）。
>
> ⚠️ 本节为 2026-09-05 的最小试点旧执行计划，**已被 §12.7 定版执行计划取代**；执行以 §12 为准。

---

## 8. Relay/集群部署矩阵（用户实际形态：mac 本机也走 relay worker）

用户考虑：真正用得上 grill-me 的是需求分析，只会在主力开发机（macOS）；
但本机 dsh 也走 relay 通道（为统一中央记忆库），因此实际执行面是 **mac-dev worker**。

### 8.1 拓扑结论

| 角色 | 是否执行模型 turn | grill-me 装在哪 | 能否跑 grill-me |
|---|---|---|---|
| hub（signer :9877） | 只路由 + 中央 endless；内部 controller agent 用于 fleet/IM | 不需要 | 正常不使用（除非以后做 IM 访谈） |
| mac-dev worker（本机主力） | **是**（用户 TUI attach 到它） | **用户级 `~/.dsh/skills/`** | ✅ owner 交互会话可跑 |
| 其它远程 worker（mac-mini / Linux） | 是 | 如不在上面做需求分析则不需要 | 按需 |
| task/fleet 专用会话（`/bg` 派发） | 是，但无 owner 真人应答 | 即使装了也不适用 | ❌ grill-me 是 HITL，任务无人值守不可跑 |
| workspace 子 worker（launcher spawn） | 是，cwd=workspace | user 级 `~/.dsh/skills/` 会被扫到 | ✅ 但仅在 owner attach 交互会话 |

关键：**本机 TUI 与 mac-dev worker 是两个 dsh 进程**。TUI 的 tui-runner preset
不会传到 worker；模型 turn、preset、skill 都在 worker 侧。所以即使“本机打开 TUI”，
grill-me 生效面仍是 **mac-dev worker 的 `~/.dsh/skills/`**。

### 8.2 worker 会话 cwd = workspace 根（修正表述）

worker 每次 `agents.create` 时 `meta.cwd = config.workspace`（mac-dev 为
`/Users/vito/data/dev`），**不是没有 cwd，而是固定在 workspace 根，不随 TUI
当前子目录变化**。skill 发现按 cwd 找项目根：
- 项目级 `<project>/.dsh/skills` 只在 workspace 根恰好是项目根（或 TUI 通过
  workspace launcher 把 cwd 设成具体仓库）时被发现；
- **用户级 `~/.dsh/skills/` 跨所有 workspace/子目录可靠生效**，是本场景推荐落点。

### 8.3 relay 下使用限制

- `/grill-me` 斜杠解析发生在 worker 侧 agent，TUI 只转发文本；多轮问答可行。
- **只允许 owner 交互会话**：`/bg`/fleet 任务无 owner，审批/提问桥 fail closed。
- worker 侧审批桥可用（owner TUI 弹窗），但 **子代理审批语义见 §10**。

---

## 9. 开放决策点（待继续沟通）

> ⚠️ 本节为历史决策点，其中更新机制/工程流前提等已由 §12 定版消化；
> **当前全部决策见 §12.6（2026-09-07 已全部定版）**，以 §12 为准。

1. **范围**：先只做 A（grill-me + grilling），还是直接含 B/C/D 的某个组合？
2. **位置**：`~/.dsh/skills/` 全局，还是项目级 / `~/.agents/skills/`？
3. **适配粒度**：接受“正文仅最小措辞适配”，还是要顺带把上游方法论本地化（例如把
   `grilling` 的“推荐答案”格式对齐 dsh 现有问答偏好）？
4. **入口形式**：是否同时保留两条路——用户 `/grill-me` 显式入口 + 模型遇到
   “想压力测试方案”时自动使用 `grilling`？（上游默认即如此，dsh 也支持）
5. **更新机制**：一次性拷贝快照，还是以后考虑脚本/链接跟随上游更新？
6. **工程流前提**：如果之后要 C/D，是否接受 dsh 版 `CONTEXT.md`/ADR/issue-tracker
   约定（可自定义成你现有工作方式），还是只移植不依赖 repo 约定的部分？
7. **子代理措辞**：dsh 版 `grilling` 是否写入 §10.4 边界规则——“事实查询可用子代理，
   但仅限沙箱允许内操作；需要提权/越界时子代理停止并回报，由主 agent 在 owner
   会话里向用户请求审批”（推荐：按此改写，而非完全禁用子代理）？

---

## 10. 子代理审批桥调查（2026-09-05，代码确认 + 当前会话环境核对）

### 10.1 问题

grill-me 的 grilling 核心提到“必要时 dispatch 一个 sub-agent 去查环境事实”。
在 relay 模式下需确认：worker 派生的子代理工具审批能否桥回 owner TUI？

### 10.2 结论（已代码确认）

**不能也不会走到审批桥——dsh 对 in-process 子代理（spawn/fork）的审批策略固定为
`never`，需要审批的越权/提权操作直接 rejected。**

证据（rc.2 安装代码）：
- `dsh-subagent/lib/types/child-agent.js`：
  `captureDelegatedPolicyOverrides(parent)` 返回 `approvalPolicy: parent.ctx.get("approval") === undefined ? undefined : "never"`；
  `appendDelegatedPolicyOverrides` 往 child session 落
  `approval/policy: { policy: "never", source: "delegation" }`。
- `dsh-user-approval` `ApprovalService.effectivePolicy(session)` 读到 `never` 时
  `decide()` 直接返回 `"rejected"`，不会进入 `approval/request` waterfall，因此
  worker 的 `approval-request` 帧根本不会产生。
- 子代理 system prompt 自带：`"operations that require approval are rejected automatically"`。
- `applyChildComposition()` 会让子代理 join 父 preset（工具齐全），但权限/审批策略
  由 delegation 固定。

### 10.3 对 relay 与 grill-me 的含义

| 场景 | 结果 |
|---|---|
| 主 agent（owner 交互会话） | 审批桥可用：worker `approval/request` → hub → TUI 弹窗 |
| 子代理需要提权/越界（触发审批） | 直接 `rejected`，不弹窗；子代理把限制写回父代理 |
| 子代理只做沙箱允许内操作（普通读/查/写 workspace 内） | 可正常执行，不需要审批桥 |
| grill-me 文本原样（派子代理查事实） | 若事实查询只需普通读取则可；若涉及越界/提权则失败 |

### 10.4 建议（结论：不是禁子代理，而是划清“可查证 / 需提权”边界）

**不需要禁止子代理**。子代理能正常跑沙箱允许内的查证（读项目文件、搜索、
查 docs 等），这些是 grill-me 绝大多数事实查询。需要避免的只是“在子代理里执行
需要审批的越权/提权动作”。

适配后的规则（写进 dsh 版 grilling）：
1. 事实查询优先用主会话自身工具直接查；需要并行/独立上下文时可用子代理，但
   子代理只做**沙箱允许内**的只读/常规查证。
2. 子代理一旦发现需要提权/越界（workspace 外敏感区、危险命令、审批动作），
   **停止并回报主 agent**，不要重试、不要假装失败原因。
3. 由主 agent 决定是否在 owner 会话里向用户请求审批（relay 下审批桥可用，
   已实测 allowed-once）。

一句话：**“子代理查事实可以，但需要提权的事留在主 agent 问用户。”**

### 10.5 术语澄清：workspace 子 worker ≠ dsh subagent（2026-09-05）

用户指出 `/workspace xxx_dir` 会 spawn 一个子 worker。该对象是 **另一个独立 dsh
worker 进程**（`dsh --profile worker`，带独立 deviceId 出站注册 hub），不是 §10.2
的 in-process `subagent`（同进程内 origin:'subagent' 的子 agent）。二者不能混用：

| 概念 | 运行形态 | 审批策略 |
|---|---|---|
| dsh `subagent`（spawn/fork） | 同进程子 agent，`childSessionMeta.origin='subagent'` | delegation 固定 `approval/policy: never` |
| workspace 子 worker | 独立进程，`launcherProfile: worker` + cwd=workspace | 走完整 dsh-base，approval 服务存在且默认 `ask`；**是否可用取决于 hub 的 stream owner 路由** |

因此 §10.2 的“子代理审批 never”**不能直接套到 workspace 子 worker 上**。子 worker
审批桥是否可用，取决于它被 attach 的会话是否带有 owner：
- `/workspace` 在 TUI 侧会 `spawnWorkspace(launcher, dir)` 成功后
  `relayClient.switchDevice(childDeviceId)` 并 `startNewSession()` → 新 agent
  adopt → `sendAttach(role:"owner")`。正常路径应带 owner。
- task/fleet 专用流无 owner → approval 天然 fail closed（unavailable）。
- 断线/换设备等边缘下 owner 丢失也会 fail closed。

**实测结果（2026-09-05，当前会话即 workspace 子 worker 顶层 agent）**：
delegationDepth=0、approval policy=ask、sandbox=workspace-write。向 `~/.dsh/`
写文件被沙箱拒绝后，用 `sandbox_permissions: danger-full-access` 重试：
会话日志记录 `approval/asked` → `approval/decided {outcome: "allowed-once"}`，
写入成功；删除同一文件同样触发一次 `allowed-once`，随后清理成功。
**结论：workspace 子 worker 的审批桥可用，owner TUI 能实际批准**；审批经
worker→hub→owner 完整链路，不是“天然被拒”。

注意区分：若该子 worker 会话**没有 owner**（task/fleet 专用流、断线、纯 observer），
hub 才会 fail closed 回 `unavailable`；本测试证明的是 owner attach 的交互会话路径。

---

## 11. 风险与注意

- `grill-me` 不带 `grilling` 会变成空壳：两者必须成对。
- `grilling` 正文提到“派子代理查环境事实”；dsh 的 in-process 子代理审批策略为
  `never`（见 §10），若保留派子代理措辞，只适用于沙箱允许内的只读/常规操作。
- 上游仓库更新活跃；快照移植不会自动跟随更新，需定更新策略（§9.5）。
- `dsh-tool-skill` 的斜杠解析只认独立 `/name` token；若用户用自然语言“帮我 grill 一下”
  不会触发 `/grill-me`，但模型仍可能因 `grilling` 的 description 自动调用（这正是上游
  user-invoked/model-invoked 的分工）。
- 未来 dsh 0.1.2 升级主要影响 preset/API，不直接影响 SKILL.md 数据文件；无需因此阻塞本计划。
- relay 下改 worker 侧 skill 后，若 worker 是常驻进程，需要确认是否重启才能让新会话
  发现变更（破坏性操作需先经用户确认）。

---

## 12. 定版：方案 B — 自维护适配层 + 自有 ask-matt-flow（2026-09-07）

> 命名说明：本文 §5 的 A/B/C/D 是“候选**范围**”；本次对话中的“方案 B”指
> “**不依赖社区插件，自维护上游 vendor + transforms + sync 脚本 + 自有 ask-matt-flow**”，
> 二者不是一回事，本节一律使用“方案 B（自维护）”或“本方案”指后者。

### 12.1 决策摘要

- **底层 skill 来源**：完全自维护。从上游 `mattpocock/skills` 固定快照（vendor）+ 自研
  transforms/适配规则 + sync 脚本生成 dsh 可用产物；**不依赖** npm 社区包
  `dsh-mattpocock-skills`（仅作实现参考，不引入依赖）。
- **产物落点**：默认用户级 `~/.dsh/skills/`（§8 已确认 relay 形态下 mac-dev worker 生效面）。
- **自有编排**：新增薄编排 skill `ask-matt-flow`（user-invocable），把上游各阶段 skill 串成
  可选的固定流水线；不替代上游 `ask-matt` 路由器。
- **升级策略**：sync 脚本 + 集中适配规则 + 校验 + 人工审阅报告，**不自动提交**。

### 12.2 仓库结构（dsh-plugins 下新增）

```text
docs/mattpocock-skills-dsh-port-plan.md     # 本文档
vendor/upstream/                            # 上游原样快照（只读镜像，pin tag/commit）
   skills/engineering/...
   skills/productivity/...
scripts/mattpocock/
   sync.mjs                                 # 拉取 → 适配 → 校验 → 报告
   adapt-rules.yaml                         # 集中适配规则（机械 + 语义映射）
   lint-skills.mjs                          # 格式与引用完整性校验
generated/skills/                           # 适配产物（提交进仓库，§12.6）
PROVENANCE.md                               # 上游 pin、日期、每次同步 per-skill 变更日志
manifest.json                               # 机器可读：ref、文件清单、规则版本
```

> `generated/skills/` 可直接拷入 `~/.dsh/skills/`；若采用“安装时生成”，本目录不落库。

### 12.3 适配规则（transforms）内容

| 类别 | 规则 | 机械/人工 |
|---|---|---|
| ① 文件级删除 | 删 `agents/openai.yaml`（Codex 元数据）、`argument-hint` frontmatter、`.claude-plugin/`、人类 docs 页 | 纯机械 |
| ② 工具措辞 | `Call the Skill tool with "X"` → `call the skill tool with name "X"`；`use /tdd`（模型侧）→ skill 工具调用；sub-agent/background agent → `subagent` 工具；`/clear` → “新开会话”；“Claude → Codex”示例 → “Claude Code → dsh” | 大部分纯机械 |
| ③ 语义映射 | 上游改名别名（如 `to-prd ≡ to-spec`、`to-issues ≡ to-tickets`）；repo 约定路径映射（`CONTEXT.md`/`docs/adr/`/tracker — 沿用上游 or dsh 自定义，待 §12.6.4）；`name`/`description`/`disable-model-invocation` 一律原样保留 | 需人维护，正则不可全包 |
| ④ 人工确认标记 | 新增/删除/合并 skill、方法论大改、未知 frontmatter 字段 — sync 只标记不自动改 | 人工 |

适配原则（沿用 §4）：**frontmatter 语义原样保留，正文做最小工具措辞适配，不重写上游方法论**。

### 12.4 sync 脚本流水线

1. **拉取**：从上游取指定 ref（默认 tag，如 `v1.2.3`；策略见 §12.6.3），范围取
   `skills/engineering/` + `skills/productivity/`（promoted 集）。
2. **快照**：原样写入 `vendor/upstream/`，不改一个字节（溯源/许可/diff 用）。
3. **diff**：与上次同步状态对比，列出新增/改名/删除/内容变化。
4. **适配**：读原样文件 → 逐条应用 §12.3 规则 → 输出到 `generated/skills/`。
5. **校验**：`lint-skills.mjs` — frontmatter 可解析且字段在白名单、`name` kebab-case、
   正文引用的每个 skill 名在产物中存在、user/model 调用面正确。
6. **溯源**：更新 `PROVENANCE.md` / `manifest.json`（新 ref、日期、per-skill 变更）。
7. **报告**：生成 `sync-report.md`，分“机械替换（可自动确认）”与“需人工确认”两类。
8. **人工收口**：审阅报告后才安装/提交；**不自动提交**（遵守用户规则）。

### 12.5 ask-matt-flow skill 设计

```markdown
---
name: ask-matt-flow
description: Run the idea→ship pipeline as a fixed sequence (setup → clarify → shape →
  spec → tickets → implement → review → debug/repair → handoff), loading each stage
  skill and enforcing human gates.
disable-model-invocation: true
---
```

要点：

- **薄调度**：只编排，不重写方法论。每个阶段用当前会话的 skill 加载工具加载对应
  上游 skill（标准 `skill`；minimal-plus `skill_load`/`skill_search`，正文用通用措辞覆盖两者）。
- **阶段/闸门**（人工确认点必须停下来等用户）：
  1. setup：`setup-matt-pocock-skills` — 先确认 tracker/labels/文档位置；
  2. clarify：`grill-with-docs`（无 repo 用 `grill-me`）+ `domain-modeling` — 理解对齐后进下一步；
  3. shape：`prototype`（大方向 `wayfinder`）— 方案形状由用户判断；
  4. spec：`to-spec`（若上游改名则按别名表映射，如 `to-prd`）— spec 经用户认可；
  5. tickets：`to-tickets`（别名 `to-issues`）— 粒度/依赖用户确认；
  6. implement：`implement` + `tdd` — 一个 ticket 一个窗口，垂直切片；
  7. review：`code-review` — 默认 `subagent` 新上下文审（§12.6 已定）；
  8. debug/repair：`diagnosing-bugs` → 无 seam 时 `codebase-design`/`improve-codebase-architecture`；
  9. handoff：`handoff` — 会话边界写临时交接文档。
- **别名表**：`ask-matt-flow` 内置上游改名映射（如 `to-prd ≡ to-spec`、`to-issues ≡ to-tickets`），
  上游升级改名时只改这张表。
- **逃生通道**：遇到 bug/外部 issue → 跳 `triage`/`diagnosing-bugs`；大方向不明 → 跳
  `wayfinder`；不确定用什么 → 回 `ask-matt`。固定流水线是可选模式，不压死自适应路由。
- **状态跟踪（已定：落盘）**：写 `.dsh/ask-matt-flow/state.md` 记录当前阶段、已完成产物、
  下一步与 checkpoint，跨会话/compact 可续跑（§12.6 已定）。

### 12.6 已定 vs 仍开放

**已定**：
- 自维护，不依赖社区插件 `dsh-mattpocock-skills`；
- 生成机制 = vendor 快照 + 集中 transforms + sync 脚本 + lint；
- **名称定版**：插件/包名统一 **scoped（git 用户名 `ndinigsihj`）**，如
  `@ndinigsihj/dsh-mattpocock-skills`、`@ndinigsihj/ask-matt-flow`；本地/仓库内仍可叫
  `dsh-mattpocock-skills`（一目了然）；流程 skill 的 slash 命令为 `/ask-matt-flow`，
  不替代 `ask-matt`；
- **范围**：全量 promoted 25 个；
- **vendor/产物**：提交进仓库（含上游原样快照与适配产物）；
- **上游 pin 策略**：跟 tag（首版 `v1.2.3`，后续以最新稳定 tag 为准）；
- **repo 约定**：沿用上游路径——`CONTEXT.md`、`docs/adr/`、`.scratch/`、issue tracker/triage
  labels 均按上游默认位置与命名（正文零路径适配，transforms 面最小，与上游教程一致）；
- 默认安装落点 `~/.dsh/skills/`（§8 生效面结论）；可选 `--project`/`--user-agents` 暂不承诺，需要时再加；
- **ask-matt-flow 独立于 `im-dsh-tui`，不合并为一个插件**：二者职责（TUI 前端 vs 工作流 skill）、
  发布节奏和生效进程都不同；源码可在同一仓库（dsh-plugins）内作独立组件维护，将来发 npm
  时独立发包（自维护版 `dsh-mattpocock-skills`；流程 skill 名 `ask-matt-flow`）；安装目标是 worker 侧
  `~/.dsh/skills/`，不随 TUI profile 分发（§8.1 拓扑原因）；
- **TUI 斜杠转发（已实现）**：im-dsh-tui 需把未知 `/name` 中命中 user-invocable skill 的输入
  当作普通用户消息转发给 agent（`lib/index.ts` 的 `tryForwardUserSkill`），否则 `dsh-tool-skill`
  无法注入技能全文；typecheck 通过、测试 97/97 通过；
- **ask-matt-flow 状态跟踪**：**落盘** `.dsh/ask-matt-flow/state.md`（跨会话/compact 可续跑；
  理由：正常项目一个 session（约 300–500k 上下文）容不下完整流程，超过后 token 消耗过高、
  中低端模型注意力涣散，需要 checkpoint）；
- **code-review 落地**：默认 **`subagent` 新上下文**审（dsh 现场更顺；想严格时可手动新会话）；
- **adapt-rules 实现形态**：**声明式 YAML 规则 + 少量 JS 函数**（可读、可审、报告可显示规则命中）。

> ⚠️ npm 名占用：`dsh-mattpocock-skills` 在 npm 已被社区包占用（v0.1.1，repo
> `MynameisKcy/dsh-mattpocock-skills`）。**已定：发包统一用 scoped 名（git 用户名）**，
> 如 `@ndinigsihj/dsh-mattpocock-skills`，可避开撞名；本地/仓库内叫 `dsh-mattpocock-skills`
> 不受影响。见 §12.9 风险。

**仍开放**：无（2026-09-07 全部定版）。

### 12.7 执行计划（取代 §7 旧计划）

| 阶段 | 操作 | 验收 |
|---|---|---|
| 0 | 本文件定稿；用户确认 §12.6 决策点 | 无遗留未决影响执行的项 |
| 1 | 建 `vendor/upstream/`，pin 上游 tag（默认 `v1.2.3`），拉取 promoted 集原样快照 | 快照完整、`manifest.json` 记录 ref |
| 2 | 写 `adapt-rules.yaml` 初版（覆盖 §12.3 已知全部差异） | 规则清单可逐条对应 PROVENANCE 已知差异 |
| 3 | 写 `lint-skills.mjs`（frontmatter + 引用完整性） | 对社区包既有产物跑通过（仅作对照，不引入） |
| 4 | 写 `sync.mjs`，输出 `generated/skills/` + `sync-report.md` | 首次生成报告，机械项全部自动应用 |
| 5 | 人工审阅报告；安装到 `~/.dsh/skills/`（如有工作区外写入，临时提权） | `/ask-matt` 可被扫描到 |
| 6 | 写 `ask-matt-flow/SKILL.md`（含阶段表、闸门、别名表、逃生通道、状态文件语义） | `/ask-matt-flow` 可被扫描到 |
| 7 | 新会话验收：`/ask-matt` 路由、`/ask-matt-flow` 全流程、状态文件可跨会话续跑、`grill-me`/`grilling` 配对可见性 | 一次完整 mini 流程跑通 |
| 8 | 升级演练：`sync.mjs --upstream <假想新 tag>` → 报告 → 更新别名/溯源（不自动提交） | 升级路径可重复、可审 |

> 每阶段产物先给用户审，**不自动提交**。

### 12.8 与社区插件的关系

- 不依赖、不 fork、不 copy 其产物；仅参考其 `PROVENANCE.md` 的适配规则清单与
  `src/index.js` 的 provider 实现思路（作为自研 sync/安装机制的设计参考）。
- 若未来放弃自维护，可随时退回社区插件；但默认决策为自维护。

### 12.9 方案 B 风险

- **首版工作量前置**：transforms 要覆盖现存全部已知差异，才能让升级变得省力。
- **上游变动成本转移**：改名的维护成本从“升级时手工改”转移到“ask-matt-flow 别名表 + transforms”，
  但这是可重复、可审的。
- **vendor 提交已定（提交进仓库）**：仓库将包含上游原样快照与适配产物（第三方副本），
  与历史“去掉 vendor 依赖”目标有张力；已确认接受此取舍，提交时按仓库规则执行。
- **relay 生效面不变**：无论安装方式，最终生效面仍是 worker 侧 `~/.dsh/skills/`（§8）。
- **npm 名占用（已缓解）**：发包时统一用 scoped 名 `@ndinigsihj/...`，避开社区包占用；
  发布前在 npm 侧确认该 scope 可用。
