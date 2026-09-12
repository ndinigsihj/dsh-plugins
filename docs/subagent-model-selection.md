# 子代理模型选择（官方机制）：使用与维护

> 状态：已落地（票据 11 实施；票据 12 首测 3/4 + 2026-09-11 复测 4/4 完成）。
> 日期：2026-09-11（票据 13 文档收口）；2026-09-12 增补 opencode-go 退役与 3 条现行集合。
> 关联：ADR-0001（采用官方机制、弃自研 purpose 路由）、`docs/dsh-v0.1.5-rc.1-upgrade-spec.md`、
> `docs/tickets/dsh-v0.1.5-rc.1-upgrade/11-official-subagent-model-selection.md` 与
> `evidence/11-subagent-model-selection.md`、`12-allowed-route-verification.md` 与 `evidence/12-route-probe.json`。
> 术语以 `CONTEXT.md` 的「Subagent model selection」「Allowed route」「Route」为准。

## 1. 结论先行

- 本仓库在开发侧采用 dsh `0.1.5-rc.1` 自带的子代理模型选择机制，落点有两处：
  **preset 开关**（仓库文件 `presets/minimal-plus-next/agent.cordis.yml`，
  `delegation/tool-subagent` 的 `modelSelectionSettings: true`）与
  **宿主作用域设置服务**（`@deepseek-ai/dsh-tool-subagent/model-selection-settings`，
  部署在 `~/.dsh/profiles/*/cordis.patch.yml`）。
- 允许路由（allowed routes）由两层组成：部署基线（profile patch 行）给出初始集合，
  用户层（`~/.dsh/settings.yaml` 的 `subagent-model-selection:` 段）可覆盖；两者都表达为精确的
  `{provider, model}` 组合。
- 开启后 `subagent` 工具获得可选的 `provider` / `model` / `reasoning_effort` 字段，
  并额外注册路由发现工具 `list_subagent_models`；开启的会话 promotion 后可见 30 个工具
  （未开启的会话/测量基线仍为 29）。
- `subagent_fork` 不参与模型选择：一次性运行、路由与父会话相同（ADR-0001 的兼容选择）。
- 未记录策略的旧会话保持该能力关闭；事后编辑设置不会改写已经记录策略的会话。

## 2. 机制语义（dsh 0.1.5-rc.1 官方行为）

来源：`dsh-v0.1.5-rc.1` release notes（官方 GitHub）+ 包内类型声明 + 票据 11 的真实模型探针
（16/16，`evidence/11-probe.json`，探针运行 2026-09-10T15:46:31Z → 15:46:55Z）。

### 2.1 配置形状

设置服务 `@deepseek-ai/dsh-tool-subagent/model-selection-settings` 的 config：

```yaml
enabled: true
allowedModels:
  - provider: commandcode
    model: deepseek/deepseek-v4.1-flash
```

- `enabled: false`：机制关闭，会话工具面保持 29（测量基线口径）。
- `enabled: true` 且 `allowedModels` 为空：服务校验拒绝，不成立为合法配置。
- 路由必须写成精确的 provider + model；不存在通配或前缀匹配。

### 2.2 开启后的外部可观察行为

| 行为 | 观测 |
| --- | --- |
| `subagent` schema | 增加 `provider`、`model`、`reasoning_effort` 三个可选字段（a2） |
| 路由发现 | 注册只读工具 `list_subagent_models`；无参列允许的 provider，按 provider 列允许的 model（a3/a4） |
| 指定路由 | 子会话 `request/header` 的实际 provider/model 等于指定值（a5、真实模型自指定 a14） |
| 指定 effort | 子会话 `request/header` 的 reasoningEffort 等于指定档（a6） |
| 省略路由 | 子代理继承调用方路由（含 effort）（a7） |
| 策略落会话 | 子会话出现 `subagent/model-selection-policy` 事件，条目等于父会话记录（a8） |
| 事后改设置 | 已记录会话仍按原集合（拒绝新集合中的路由），新会话按新集合；旧策略事件不被改写（a9） |
| 无策略旧会话 | 保持关闭：29 工具、无发现工具、`subagent` 无模型字段（a10） |
| 集合外路由 | 创建前即拒绝，不产生子会话；错误形如 `child LLM route "…" is not allowed for this Session`（a11） |
| fork 来源 | `subagent_fork` 无模型字段；fork 子会话路由与父会话一致（a12/a13） |
| 工具名与上下文语义 | `subagent` / `subagent_fork` 名称不变，两种上下文来源描述不变（a13） |

“事后编辑设置不改写已记录策略”是官方承诺的语义（release notes），也是本仓库选它的原因之一：
同一次工作里的路由来源稳定、可追溯。

## 3. 当前部署状态（2026-09-12 复核，3 条现行集合）

| 位置 | 内容 | sha256 |
| --- | --- | --- |
| `~/.dsh/profiles/tui-dev/cordis.patch.yml` | `subagent-model-selection-settings` insert：`enabled: true` + 2 条允许路由（§4.1） | `96a0d5e0…` |
| `~/.dsh/profiles/headless/cordis.patch.yml` | 同 id 挂载：`enabled: false` + 同 2 条（保 M4/轨迹/冒烟 29 工具口径） | `6ef872ea…` |
| `presets/minimal-plus-next/agent.cordis.yml` | `delegation/tool-subagent` 的 `modelSelectionSettings: true` | `9087bf00…` |
| `~/.dsh/.agent-presets/minimal-plus-next/agent.cordis.yml` | 部署位副本，与仓库逐字节一致（8/8 生产文件 sha 一致） | `9087bf00…` |
| `~/.dsh/settings.yaml` | 用户层当前**无** `subagent-model-selection:` 段；`agent-default-model` 已切 `commandcode/deepseek/deepseek-v4.1-flash`（2026-09-12） | 复核时 sha `84299548…`（其后仅默认模型行更新） |

补充事实：

- `tui-central` 处于停用状态（`tui-central.parked-0.1.5-rc.1`），其 patch **未挂载**设置服务；
  解除停用前必须按 tui-dev 同法挂载，否则 preset 在组合期即抛错（finding 11-2/09-3）。
- 开启的会话比关闭的会话多一个 `list_subagent_models`（30 vs 29）。测量侧走 headless 基线
  （`enabled: false`），M4/轨迹/无 LLM 冒烟口径仍是 29（票据 11 §4/§6）。

## 4. 允许路由集合与验证状态

### 4.1 现行集合（2026-09-12 起，2 条）

用户 2026-09-12 裁定：opencode-go 月度额度（实测 `GoUsageLimitError`，重置约 7 天）期间不再使用
opencode-go，默认模型切 `commandcode/deepseek/deepseek-v4.1-flash`；随后又退役
`commandcode/deepseek/deepseek-v4-flash`（并入 v4.1-flash）与 `deepseek-official/deepseek-v4-flash`
（换成 `deepseek-flash`）。现行为下列 2 条：

| 路由 | 工具调用验证 | 说明 |
| --- | --- | --- |
| `commandcode/deepseek/deepseek-v4.1-flash` | 通过 | 2026-09-12 M4 单跑 25.9s、首工具 bash；同日 M4 N=9 基线与 T3 正式复跑见 `docs/tickets/regression-test-automation/evidence/11-real-model-archival-and-advisory.md` §9 |
| `deepseek-official/deepseek-flash` | 通过 | `dsh-llm-deepseek` 目录内 `DeepSeek-V41-Flash`；2026-09-12 T3 正式复跑路由探针 pass（探针显式委派也用它，含 `reasoning_effort: low`） |

口径沿用票据 12：**只有能力类失败才从集合移除**；opencode-go 属额度类停用（可恢复），
不构成能力淘汰结论。当前集合与 `docs/tickets/regression-test-automation/evidence/11-real-model-archival-and-advisory.md`
的 T3 正式跑一致（2/2 route probe）。

### 4.2 历史：初始 4 条（2026-09-10 选定，2026-09-12 全部退役/替换）

票据 12 于 2026-09-10T16:04Z 对当时 4 条逐条做真实 bash 工具调用探测：

| 路由 | 工具调用验证 | 说明 |
| --- | --- | --- |
| `opencode-go/deepseek-v4-flash` | 通过 | 同时是 M4/轨迹/冒烟默认测量路由（票据 07/08/10 实跑） |
| `opencode-go/deepseek-flash` | 通过 | 票据 12 探针单次成功（票据 11 探针里只验证过对话补全） |
| `deepseek-official/deepseek-v4-flash` | 通过 | 首次缺 `description` 被参数校验拒，模型自纠后成功（见 finding 12-2） |
| `commandcode/deepseek/deepseek-v4-flash` | 通过 | 首测（2026-09-10）遇 weekly quota 429；2026-09-11 14:21 复测首次尝试即完成工具调用（6.6s，marker 回显） |

用户裁定口径（票据 12）：**只有能力类失败才从集合移除**；额度/限流/传输类失败不构成能力结论。

- 原始数据：`docs/tickets/dsh-v0.1.5-rc.1-upgrade/evidence/12-route-probe.json`（首测 3/4，sha256 `183bd485…`）与 `12-route-probe-retest-2026-09-11.json`（复测 4/4，sha256 `ecf23663…`）。
- 逐条结论与根因：`evidence/12-allowed-route-verification.md` §3/§3.1/§4。
- 复测程序：同证据 §6（本文 §5.4 摘要）。

## 5. 维护方式

### 5.1 增加一条允许路由

1. **先验证能力，再入集合**：临时把候选路由加进探针 overlay（`experiments/subagent-model-selection/route-probe.patch.yml`）
   的 `allowedModels`（此刻 overlay 与部署基线故意不一致），跑一次探针，确认该路由能完成一次真实工具调用。
2. 通过后，把同一行加进 `~/.dsh/profiles/tui-dev/cordis.patch.yml` 与
   `~/.dsh/profiles/headless/cordis.patch.yml` 的 `subagent-model-selection-settings` 行
   （改前备份），保持两个 profile 的集合一致。
3. 同步 `route-probe.patch.yml` 的集合，重跑探针（应 N/N 通过）。
4. 过配置闸门：`dsh --profile tui-dev --dump-config` exit 0，且逐 loader id 递归计数均为 1
   （`--dump-config` 本身不检测重复 id，见 finding 05-2；该命令还会回写 profile 目录下的
   `cordis.yml`，属宿主规范化行为 finding 01-2）。
5. 更新本文 §4 表格与证据文件（追加一次运行记录）。

### 5.2 移除一条允许路由

- **能力类失败**（模型请求成功但无法完成工具调用）：从 tui-dev 与 headless 两个 profile 的基线行移除，
  同步 `route-probe.patch.yml`，重跑探针确认剩余集合全通过，再做一次 `--dump-config` 闸门。
- **额度/传输类失败**：不移除，记录失败类型与恢复时点，按 §5.4 复测。
- 移除只影响**之后创建**的会话：已记录策略的会话仍按记录集合工作（官方语义，a9）。
- 若集合变小，用同一探针补记「剩余集合仍满足日常使用需要」的结论。

### 5.3 关闭该能力

把 profile 基线行改为 `enabled: false`（保留 `allowedModels` 便于恢复）或删掉该行；
preset 的 `modelSelectionSettings: true` 仅在宿主挂载了服务时才有意义，两者需一起回退。
关闭后新会话回到 29 工具形状；已记录策略的会话按其记录继续。

### 5.4 commandcode 复测（已于 2026-09-11 执行，开环项关闭）

- 执行：`2026-09-11T06:21:41Z → 06:22:12Z` 跑 `experiments/subagent-model-selection/run-route-probe.sh`，
  **4/4 通过**（commandcode 首次尝试 6.6s 完成 `bash` 调用并回显 marker）→ 基线不动。
- 复测前复核：用户层 `~/.dsh/settings.yaml` 无 `subagent-model-selection:` 段（finding 11-3）。
- 结论：首测未通过属外部额度（非能力缺陷）得到实证；集合维持 4 条。
- 以下判据保留，供日后再遇额度期时复用（复测前先复核用户层
  `~/.dsh/settings.yaml` 的 `subagent-model-selection:` 段未被打开，finding 11-3）：
  - 4/4 通过 → 基线不动，关闭本开环项；
  - 仍为额度类失败 → 继续挂起，基线不动；
  - 出现非额度失败（模型请求成功但无法完成工具调用）→ 按 §5.2 从两个 profile 基线移除并重跑探针。

### 5.5 文件索引

| 文件 | 用途 |
| --- | --- |
| `presets/minimal-plus-next/agent.cordis.yml` | preset 开关（`modelSelectionSettings: true`） |
| `~/.dsh/profiles/tui-dev/cordis.patch.yml` | 生产部署基线：开启 + 允许路由 |
| `~/.dsh/profiles/headless/cordis.patch.yml` | 测量基线：关闭 + 同一集合 |
| `~/.dsh/settings.yaml` | 用户层覆盖（可选；当前不存在该段） |
| `experiments/subagent-model-selection/probe.mjs` / `probe.patch.yml` / `run.sh` | 票据 11 行为探针（16 项语义检查） |
| `experiments/subagent-model-selection/route-probe.mjs` / `route-probe.patch.yml` / `run-route-probe.sh` | 票据 12 路由工具调用探针（扩缩集合复用） |

## 6. 残留风险与未验证项

- **现行 2 条允许路由已取得工具调用实证**（2026-09-12，§4.1；初始 4 条中的 opencode-go 两条因月度额度停用、另两条按用户裁定退役/替换）；集合外的模型不得默认视为可用。
- **用户层对所有 profile 生效**：`~/.dsh/settings.yaml` 的该段会覆盖基线；
  若用户层开启，headless/M4 会话也会变成 30 工具形状，测量可比性受影响（finding 11-3）。
  扩缩集合或采集基线前先复核用户层。
- **tui-central 解停用前置项**：挂载设置服务 + 清理 `agent-presets.roots` 覆盖（finding 11-2/09-3）。
- **交互 TUI 验收是人工项**：模型在真实 TUI 会话里实际使用选择、UI 表现未自动化
  （spec「不做的测试」；票据 11 用配置闸门 + 探针替代）。
- **路由与密钥绑定**：同一模型名在不同密钥下可能出现工具调用失败（票据 12 的验证动机）；
  新增路由必须按 §5.1 先探测，不能靠目录推断。
- **上游在继续推进**：`0.1.5-rc.2`（仅反馈与文件卡片体验调整）已是 npm `next`；
  升级宿主会重置这套基线（含本地 `x-opencode-session` 补丁，finding 05-4），需按同一套闸门复核。
