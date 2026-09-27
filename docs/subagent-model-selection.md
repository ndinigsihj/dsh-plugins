# 子代理模型选择（官方机制）：使用与维护

> 状态：0.1.7-rc.1 迁移后复核（票据 11，2026-09-25；真实模型层 `--tier 3` 18/18 绿）。
> 日期：2026-09-11 初版；2026-09-12 opencode-go 退役与 2 条现行集合；2026-09-25 宿主换代重采基线 + 探针口径收口。
> 关联：ADR-0001（采用官方机制、弃自研 purpose 路由；适用边界 = 非 Team profile 的 `subagent` 委派）、
> `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（闸门基准 / 真实模型 seam）、
> `docs/tickets/dsh-v0.1.7-rc.1-upgrade/11-real-model-baseline-recapture.md` 与
> `evidence/11-real-model-baseline-recapture.md`、`evidence/11-t3-green.json`。
> 术语以 `CONTEXT.md` 的「Subagent model selection」「Allowed route」「Route」为准。

## 1. 结论先行

- 本仓库在开发侧采用 dsh 自带的子代理模型选择机制，落点有两处：
  **preset 开关**（仓库文件 `presets/minimal-plus/agent.cordis.yml`，
  `delegation/tool-subagent` 的 `modelSelectionSettings: true`）与
  **宿主作用域设置服务**（`@deepseek-ai/dsh-tool-subagent/model-selection-settings`，
  在 profile 的 `cordis.patch.yml` 以条目 `subagent-model-selection-settings` 挂载）。
- 允许路由（allowed routes）是**精确的 `{provider, model}` 白名单**：基线写在 profile 条目 config，
  用户层（0.1.7 起为同一 profile 条目的 user 段，旧 `settings.yaml` 的 `subagent-model-selection:`
  段只在其一次性导入窗口生效）可覆盖。
- **口径（2026-09-24 裁决，2026-09-25 与新基线同批落地）：机制是「白名单 + 可选覆盖」，不是路由策略引擎**
  ——不携带成本、时延、能力分级，模型侧决策信息只有 `list_subagent_models` 返回的 id / 名称 / 描述。
  真实模型探针因此**为白名单背书**（证明集合内路由能被真实模型按 schema 透传并生效、集合外被硬拒），
  **不主张**模型会自主选择路由；ADR-0001 的适用边界同时收窄为「非 Team profile 的 `subagent` 委派」。
- 开启后 `subagent` 工具获得可选的 `provider` / `model` / `reasoning_effort` 字段，
  并额外注册路由发现工具 `list_subagent_models`。同一 profile 下开启比关闭**多 1 个工具**：
  0.1.7 隔离测量面（headless + preset）为 **29（开启）/ 28（关闭）**；生产 `tui-dev`
  profile 因另挂 endless 工具为 **35**（票据 09 的 profile 维度基线）。
- `subagent_fork` 不参与模型选择：一次性运行、路由与父会话相同（ADR-0001 的兼容选择）。
- 未记录策略的旧会话保持该能力关闭；事后编辑设置不会改写已经记录策略的会话。
- Team profile 里 `subagent` 被组合期禁用、`spawn_teammate` 没有路由字段——模型选择**无处表达**
  （见升级计划 §5.5；不在本文维护流程内）。

## 2. 机制语义（dsh 0.1.7-rc.1 官方行为）

来源：宿主 0.1.7-rc.1 包内行为 + 票据 11 的真实模型探针（16/16，2026-09-25；
`evidence/11-t3-green.json` 的 T3 层，原始报告随归档 `experiments/regression-gate/t3-2026-09-25T14-25-52-003Z/`）。

### 2.1 配置形状

设置服务条目 `subagent-model-selection-settings` 的 config（profile patch 的基线示例）：

```yaml
- insert:
    - id: subagent-model-selection-settings
      name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
      config:
        enabled: true
        allowedModels:
          - provider: commandcode
            model: deepseek/deepseek-v4.1-flash
          - provider: deepseek-official
            model: deepseek-flash
```

- `enabled: false`：机制关闭，会话工具面保持测量口径（隔离面 28）。
- `enabled: true` 且 `allowedModels` 为空：服务校验拒绝，不成立为合法配置。
- 路由必须写成精确的 provider + model；不存在通配或前缀匹配。
- 0.1.7 起设置按 **profile 条目**存放与编辑（`settings.update(条目 id, patch)`）；
  命令行 `--patch` overlay 覆盖过的条目会被设置编辑器拒写，因此
  **部署基线放 profile 层，不放 overlay**（T3 探针的 a9 依赖这一点）。

### 2.2 开启后的外部可观察行为

| 行为 | 观测 |
| --- | --- |
| `subagent` schema | 增加 `provider`、`model`、`reasoning_effort` 三个可选字段（a2） |
| 路由发现 | 注册只读工具 `list_subagent_models`；无参列允许的 provider，按 provider 列允许的 model（a3/a4） |
| 指定路由 | 子会话 `request/header` 的实际 provider/model 等于指定值（a5） |
| 指定 effort | 子会话 `request/header` 的 reasoningEffort 等于指定档（a6） |
| 省略路由 | 子代理继承调用方路由（含 effort）（a7） |
| 策略落会话 | 子会话出现 `subagent/model-selection-policy` 事件，条目等于父会话记录（a8/a0） |
| 事后改设置 | 已记录会话仍按原集合（拒绝新集合中的路由），新会话按新集合；旧策略事件不被改写（a9） |
| 无策略旧会话 | 保持关闭：无发现工具、`subagent` 无模型字段（a10） |
| 集合外路由 | 创建前即拒绝，不产生子会话；错误形如 `child LLM route "…" is not allowed for this Session`（a11） |
| fork 来源 | `subagent_fork` 无模型字段；fork 子会话路由与父会话一致（a12/a13） |
| 工具名与上下文语义 | `subagent` / `subagent_fork` 名称不变，两种上下文来源描述不变（a13） |
| 白名单透传（真实模型） | 指令逐字段给定白名单路由时，真实模型发出的 `subagent` 调用使子会话按该 provider/model/effort 发起：`a14-whitelist-route-compliance`。**这是为白名单背书，不是「模型自主选路」的证据** |

“事后编辑设置不改写已记录策略”是官方承诺的语义（release notes），也是本仓库选它的原因之一：
同一次工作里的路由来源稳定、可追溯。

## 3. 当前部署状态（2026-09-25 复核，0.1.7-rc.1）

| 位置 | 内容 | sha256 |
| --- | --- | --- |
| `~/.dsh/profiles/tui-dev/cordis.patch.yml` | `subagent-model-selection-settings` 条目：`enabled: true` + 2 条允许路由（§4.1） | `d39a4f64…` |
| `~/.dsh/profiles/headless/cordis.patch.yml` | 同 id 条目：`enabled: false` + 同 2 条（保 M4/轨迹/冒烟测量口径） | `6ef872ea…` |
| `presets/minimal-plus/agent.cordis.yml` | `delegation/tool-subagent` 的 `modelSelectionSettings: true`（已随上游 minimal 对齐描述） | `8cd01c68…` |
| `gates/manifest.json` 的 `deployment` | 仍记录旧目录形态 `~/.dsh/.agent-presets/minimal-plus`；0.1.7 **不再读取**该目录，与仓库不一致 → 部署位 bundle 落位归票据 12 | — |
| `~/.dsh/settings.yaml` | 无 `subagent-model-selection:` 段；`agent-default-model` = `commandcode/deepseek/deepseek-v4.1-flash`（2026-09-12 起） | — |

补充事实：

- 0.1.7 宿主不再读取 `$DSH_HOME/.agent-presets/<id>/` 目录形态；preset 由 profile 选择的
  生成 bundle 提供。T3 真实模型层与两个独立探针脚本都在隔离 home 里现场生成 bundle
  （`gates/t3/run.mjs`、`scripts/profile-home.mjs`），不依赖部署位是否落位。
- 开启的会话比关闭的会话多一个 `list_subagent_models`：隔离测量面 **29 vs 28**（2026-09-25 T3 实测，
  `report.t3.m4.advisory.avgTools = 28`；探针 `facts.assembledTools` = 29）。
- `tui-central` 处于停用状态（`tui-central.parked-0.1.5-rc.1`），其 patch **未挂载**设置服务；
  解除停用前必须按 tui-dev 同法挂载，否则 preset 在组合期即抛错。

## 4. 允许路由集合与验证状态

### 4.1 现行集合（2026-09-12 起，2 条；2026-09-25 在新宿主上重采并复验）

T3 / 探针侧的单一来源：`experiments/subagent-model-selection/allowed-routes.mjs`；
**生产真相仍是两个真实 profile 的条目**，改集合时须与模块逐字段同步（`probe.mjs` 的 a1/a9
期望也从模块取，漂移会在 T3 判红）。

| 路由 | 工具调用验证（2026-09-25，宿主 0.1.7-rc.1） | 说明 |
| --- | --- | --- |
| `commandcode/deepseek/deepseek-v4.1-flash` | 通过 | T3 路由探针单次 pass 8.0s；M4 N=9 基线（`m4-commandcode-v41-2026-09-25`）与其同源，9/9 首工具 bash |
| `deepseek-official/deepseek-flash` | 通过 | T3 路由探针 pass 5.9s（`reasoning_effort: low` 显式委派，marker 回显） |

口径沿用票据 12：**只有能力类失败才从集合移除**；额度/传输类失败只记录，不构成能力淘汰结论。
当前集合与 `evidence/11-t3-green.json` 的正式 T3 跑一致（route probe 2/2、模型选择探针 16/16）。

真实模型基线（T3 的 M4 批次）引用关系：

| 项 | 值 |
| --- | --- |
| 基线 id | `m4-commandcode-v41-2026-09-25`（`gates/manifest.json` 的 `t3.baseline`） |
| 宿主 / 模型 / Preset / 样本量 | `0.1.7-rc.1` / `commandcode/deepseek/deepseek-v4.1-flash` / `minimal-plus` / N=9 |
| 批次文件 | `experiments/m4/results-minimal-plus-next-commandcode-v41-2026-09-25.jsonl`，sha256 `062cd4f7…`，capturedAt `2026-09-25T13:46:23Z` |
| 容忍度 / 封顶 | `t3.tolerance = 1`（锚定、check3、check4 一致） |
| 历史基线 | 旧 3 条（两条 opencode-go、一条 commandcode v4.1）保留为历史，hostVersion 仍 `0.1.5-rc.1`，不再被 `t3.baseline` 引用 |

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

## 5. 维护方式

### 5.1 增加一条允许路由

1. **先验证能力，再入集合**：把候选路由加进 `experiments/subagent-model-selection/allowed-routes.mjs`
   的 `SETTINGS_BASELINE.allowedModels`（此刻与两个真实 profile 故意不一致），跑一次真实模型层
   （`scripts/regression-gate.sh --tier 3`，或独立 `run-route-probe.sh`），确认该路由能完成一次真实工具调用。
2. 通过后，把同一行加进 `~/.dsh/profiles/tui-dev/cordis.patch.yml` 与
   `~/.dsh/profiles/headless/cordis.patch.yml` 的 `subagent-model-selection-settings` 条目
   （改前备份），保持两个 profile 的集合一致。
3. 复核 `allowed-routes.mjs` 与两个 profile 逐字段一致（T3 的 a1 会以此判红）。
4. 过配置闸门：`dsh --profile tui-dev --dump-config` exit 0，且逐 loader id 递归计数均为 1
   （`--dump-config` 本身不检测重复 id；该命令还会回写 profile 目录下的
   `cordis.yml`，属宿主规范化行为）。
5. 重跑 `scripts/regression-gate.sh --tier 3`（探针应 16/16 + 路由 N/N），更新本文 §4 表格与证据文件。

### 5.2 移除一条允许路由

- **能力类失败**（模型请求成功但无法完成工具调用）：从 `allowed-routes.mjs` 与两个 profile 条目同步移除，
  重跑 T3 确认剩余集合全通过，再做一次 `--dump-config` 闸门。
- **额度/传输类失败**：不移除，记录失败类型与恢复时点，按 §5.4 复测。
- 移除只影响**之后创建**的会话：已记录策略的会话仍按记录集合工作（官方语义，a9）。
- 若集合变小，用同一探针补记「剩余集合仍满足日常使用需要」的结论。

### 5.3 关闭该能力

把 profile 条目改为 `enabled: false`（保留 `allowedModels` 便于恢复）或删掉该条目；
preset 的 `modelSelectionSettings: true` 仅在宿主挂载了服务时才有意义，两者需一起回退。
关闭后新会话回到测量形状（隔离面 28）；已记录策略的会话按其记录继续。

### 5.4 真实模型层复测（0.1.7 起）

```sh
# 全层：M4 批次（N=9）+ 模型选择探针 16 项 + 允许路由探针（需真实 ~/.dsh/settings.yaml；
# bash 工具与探针需要 PTY，请在常规终端跑，不要在无 PTY 的沙箱里跑）
scripts/regression-gate.sh --tier 3

# 单跑允许路由探针（0.1.7 隔离 home：现场生成 preset bundle + profile 层部署基线）
experiments/subagent-model-selection/run-route-probe.sh
```

- 宿主/会话格式/基线来源与清单不符时 T3 拒绝运行（exit 2）并提示重采基线；重采流程见
  `evidence/11-real-model-baseline-recapture.md`。
- 复测前复核用户层没有被意外打开（0.1.7 下该能力按 profile 条目存放；用 `--dump-config` 或
  `settings.describe()` 看 `subagent-model-selection-settings` 条目的 user 段）。
- 判据：全通过 → 基线不动；额度类失败 → 挂起并记录；非额度失败（模型请求成功但无法完成工具调用）→
  按 §5.2 从集合移除并重跑探针。

### 5.5 文件索引

| 文件 | 用途 |
| --- | --- |
| `presets/minimal-plus/agent.cordis.yml` | preset 开关（`modelSelectionSettings: true`） |
| `experiments/subagent-model-selection/allowed-routes.mjs` | T3 / 探针侧的允许路由集合单一来源（`--print-config` 供脚本预置 profile；生产真相仍是两个 profile 条目，需同步） |
| `~/.dsh/profiles/tui-dev/cordis.patch.yml` | 生产部署基线：开启 + 允许路由 |
| `~/.dsh/profiles/headless/cordis.patch.yml` | 测量基线：关闭 + 同一集合 |
| `~/.dsh/settings.yaml` | 旧用户层文档（0.1.7：宿主启动时只要文件在场就消费并改名 `.imported`、只导入当前 profile；当前无 `subagent-model-selection:` 段） |
| `experiments/subagent-model-selection/probe.mjs` / `probe.patch.yml` / `run.sh` | 行为探针（16 项语义检查）；patch 不再携带集合，profile 层由 `allowed-routes.mjs` 预置 |
| `experiments/subagent-model-selection/route-probe.mjs` / `route-probe.patch.yml` / `run-route-probe.sh` | 路由工具调用探针（扩缩集合复用） |
| `gates/t3/run.mjs`、`gates/manifest.json` | 真实模型层接线与基线引用（`t3.baseline` / `t3.tolerance`） |

## 6. 残留风险与未验证项

- **现行 2 条允许路由已取得工具调用实证**（2026-09-25，宿主 0.1.7-rc.1；§4.1）；集合外的模型不得默认视为可用。
- **用户层覆盖语义换代**：0.1.7 起 `settings.yaml` 只在导入窗口生效，之后的编辑写当前 profile 的条目；
  扩缩集合或采集基线前先复核 profile 基线，不要假设旧 `settings.yaml` 的段仍会覆盖。
- **真实部署位未落位**：preset bundle 与 `tui-team` 的真实落位、旧目录退场归票据 12；
  在此之前 T3/探针都从仓库真源现场生成载体，部署位一致性由闸门的 deployment 面单独记账。
- **交互 TUI 验收是人工项**：模型在真实 TUI 会话里实际使用选择、UI 表现未自动化；
  真实模型层用配置闸门 + 探针替代。
- **路由与密钥绑定**：同一模型名在不同密钥下可能出现工具调用失败；新增路由必须按 §5.1 先探测，不能靠目录推断。
- **PTY 依赖**：预设的 persistent-shell bash 与探针需要 PTY；无 PTY 沙箱会让 bash 返回
  `posix_openpt: Operation not permitted`，真实模型层会整体红，不代表路由能力结论。
- **上游在继续推进**：宿主换代（含会话格式）会重置这套基线；按同一套闸门重采，旧基线留史不删。
