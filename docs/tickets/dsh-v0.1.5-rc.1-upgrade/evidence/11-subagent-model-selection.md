# 票据 11 证据 — 采用官方子代理模型选择

日期：2026-09-10
执行：ask-matt-flow Stage 5 Implement，票据 11（本窗口）
环境：Node v22.22.1；全局宿主 `@deepseek-ai/dsh@0.1.5-rc.1`；stable 隔离运行时 rc.2 未触碰
口径依据：票据 11 文件 + spec「子代理模型选择」节 + ADR-0001（官方机制，弃自研 purpose 路由）+ ADR-0003（preset 只声明差异）
机器可核对数据：`evidence/11-probe.json`（16/16；2026-09-11 因 a7 断言补强重跑，sha256 `d448a2d5…`；旧报告 sha256 `eb986337…`）

本票只启用官方机制并挂载部署基线：preset 开关（仓库）+ 宿主设置服务与允许路由（`~/.dsh` profile patch）+ 行为探针。未改插件代码、未改测量口径、未碰 stable 侧、未 commit。

## 0. 验收清单对照

| 票据 11 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 模型选择所需的设置服务已在宿主作用域挂载 | 通过 | §2：tui-dev dump 1× `subagent-model-selection-settings`（enabled=true）；探针 a1 读到服务与基线 |
| 开发侧组合的委派工具已开启模型选择 | 通过 | §1：preset `delegation/tool-subagent` 加 `modelSelectionSettings: true`；探针 a2 委派 schema 出现 provider/model/reasoning_effort |
| 路由发现工具可见，且能按 provider 列出模型 | 通过 | 探针 a3（promotion 后 30 工具含 `list_subagent_models`）、a4（无参列 provider；按 provider 只列允许模型） |
| 模型指定 provider 与 model 后，子代理实际使用该路由 | 通过 | 探针 a5（子会话 header 实跑 opencode-go/deepseek-flash）；a14 真实模型自己按 schema 指定并生效 |
| 模型指定 reasoning effort 后生效 | 通过 | 探针 a6（子会话 header reasoningEffort=low）；a14 同上含 effort |
| 省略路由时子代理继承调用方路由 | 通过 | 探针 a7：子会话 header = 父会话路由 opencode-go/deepseek-v4-flash；2026-09-11 断言补上 reasoningEffort 比较后重跑仍通过（父子同 `max`） |
| 子会话继承已记录的路由策略 | 通过 | 探针 a8（子会话 `subagent/model-selection-policy` = 父会话 4 条） |
| 事后编辑设置不改变已记录的策略 | 通过 | 探针 a9（编辑用户层为 gjx 后：已记录会话仍拒 gjx、仍允许 opencode-go；新会话用 gjx；旧策略事件未改写） |
| 没有记录策略的旧会话上该能力保持关闭 | 通过 | 探针 a10（票据 10 的 M4 E1 会话副本 resume：29 工具、无发现工具、`subagent` 仅 description/prompt/run_in_background） |
| 允许集合之外的路由无法被选定 | 通过 | 探针 a11（创建前拒 `volcengine/…`，无子会话产生）；a4 发现侧同样被拒 |
| fork 来源的子代理与父会话保持同一路由且不参与模型选择 | 通过 | 探针 a12（fork 子会话 header = 父路由）；a13（fork 工具无 provider/model/reasoning_effort 字段） |
| 委派工具的名称与两种上下文来源语义保持不变 | 通过 | 探针 a13（`subagent` / `subagent_fork` 名称不变；描述分别保持「it does not see this conversation」与「inherits this conversation」） |

## 1. 改动清单（仓库）

| 文件 | 改动 | sha256 |
| --- | --- | --- |
| `presets/minimal-plus-next/agent.cordis.yml` | `delegation/tool-subagent` 加 `modelSelectionSettings: true`；头注释与分组注释记录票据 11 语义与两条部署基线 | `9087bf00…` |
| `experiments/subagent-model-selection/probe.mjs` | 新增：行为探针（16 项检查）；2026-09-11 补 a7 的 reasoningEffort 断言 | `9ab95631…`（补强前 `6a51fdf2…`） |
| `experiments/subagent-model-selection/probe.patch.yml` | 新增：headless overlay（enabled=true + 4 路由；设置/会话指向 /tmp） | `62b78375…` |
| `experiments/subagent-model-selection/run.sh` | 新增：临时设置副本 + 旧会话副本 + 跑探针 | `7d35a1e8…` |
| `docs/tickets/dsh-v0.1.5-rc.1-upgrade/evidence/11-probe.json` | 探针原始报告（16/16；2026-09-11 重跑版） | `d448a2d5…`（旧版 `eb986337…`） |

未改：`presets/minimal-plus`（stable）、任何 `.mjs` 生产插件、`lib/`、`plugins/`、测量脚本、测试；stable 侧 profile/运行时/组合未触碰。

## 2. 部署基线（仓库外，`~/.dsh/profiles/`）

| profile | 行 | 基线 | sha256（改后 / 改前备份） |
| --- | --- | --- | --- |
| `tui-dev` | `insert: subagent-model-selection-settings` | `enabled: true` + 4 条允许路由 | `d6b283d6…` / `1e8cf332…`（`/tmp/dsh-ticket11-backup/`） |
| `headless` | `insert: subagent-model-selection-settings` | `enabled: false` + 同 4 条（测量口径保持票据 10 形状） | `338f36cd…` / `ef189a8c…`（`/tmp/dsh-ticket11-backup/`） |

允许路由（用户 2026-09-10 选定，待票据 12 逐条真实工具调用探测后裁剪）：

```
opencode-go/deepseek-v4-flash     （票据 07/08/10 M4 实测）
commandcode/deepseek/deepseek-v4-flash （TUI 默认路由；探测时仍处额度期 finding 05-6）
deepseek-official/deepseek-v4-flash
opencode-go/deepseek-flash
```

两层来源：patch 行配置 = 部署基线；`~/.dsh/settings.yaml` 的 `subagent-model-selection:` 段 = 用户层（覆盖基线，a9 演示）。`enabled=true` 但 allowedModels 为空会被服务校验拒绝。

部署位同步：`scripts/sync-agent-presets.sh minimal-plus-next` → `~/.dsh/.agent-presets/minimal-plus-next/agent.cordis.yml`（sha256 与仓库逐字节一致 `9087bf00…`）。

## 3. 配置门禁（`--dump-config` + 逐 id 计数，补 finding 05-2）

| 命令 | 结果 |
| --- | --- |
| `dsh --profile tui-dev --dump-config` | exit 0；99 个 loader id / 0 重复；服务行 1×（enabled=true + 4 路由） |
| `dsh --profile headless --dump-config` | exit 0；88 个 loader id / 0 重复；服务行 1×（enabled=false + 4 路由） |
| `dsh --profile headless --patch …/probe.patch.yml --dump-config` | exit 0；0 重复；服务行被 overlay 覆盖为 enabled=true（替换语义，非合并） |

## 4. 无 LLM 回归与单元回归

- 部署位副本冒烟（`SMOKE_PRESET_ROOT=~/.dsh/.agent-presets node presets/minimal-plus-next/smoke-boot.mjs`，exit 0）：ROUND1 锚定对 `[bash, str_replace_editor]`；ROUND2 目录 29 工具、不含 `list_subagent_models` —— 与票据 09/10 形状一致（headless 基线 enabled=false 的设计效果）。
- `npm test`：97/97；`npx tsc --noEmit`：0 错。
- 未重跑 M4 N=9：本票不改测量口径，headless 基线关闭使 M4/轨迹/冒烟会话形状保持票据 10 基线；真实模型行为由探针覆盖。

## 5. 行为探针（真实模型 + 真实宿主）

设计：`experiments/subagent-model-selection/` 在 headless profile 上按 id 覆盖部署基线为 enabled=true + 同一 4 路由，preset 用部署位副本（`includeUserRoot`，与 tui-dev 实际加载源一致）。三段隔离：

- `settings.path → /tmp/dsh-ticket11/settings.yaml`（真实 `settings.yaml` 的副本；设置编辑测试只写副本）；
- `session-persistence-jsonl.root → /tmp/dsh-ticket11/sessions`（探针会话 + 旧会话副本；真实 `~/.dsh/sessions` 未写入）；
- 旧会话 = 票据 10 去重后批次的 `session-m4-E1-4478e2ed…`（无策略事件、完整 turn；副本 sha256 `723e56d1…`）。

父路由 `opencode-go/deepseek-v4-flash`；检查前先由真实模型发一次 bash 工具调用完成 promotion（首轮锚定只放行 bash/str_replace_editor，a00）。

| check | 关键观测 |
| --- | --- |
| a1 | `subagentModelSelection.current()` = enabled + 4 路由 |
| a2/a3/a13 | promotion 后 30 工具（+`list_subagent_models`）；`subagent` 参数 = description/prompt/provider/model/reasoning_effort/run_in_background；`subagent_fork` 无模型字段 |
| a4 | 无参只列 3 个允许 provider；opencode-go 只列 deepseek-v4-flash / deepseek-flash；volcengine 被拒 |
| a5/a6 | 子会话 `421b19ba…` 实际路由 opencode-go/deepseek-flash、effort low，结果 "OK" |
| a7 | 子会话 `f2d636a2…` 路由 = 父路由（provider/model/effort 全同） |
| a8 | 子会话策略事件 = 父会话 4 条 |
| a11 | `volcengine/…` 返回 `child LLM route "…" is not allowed for this Session`，无 catalog 子会话 |
| a12 | fork 子会话 `8eb7048c…` 路由 = 父路由 |
| a14 | 模型自己发 `subagent{provider:"opencode-go",model:"deepseek-flash",reasoning_effort:"low",run_in_background:false}`，子会话 `e0acaffa…` 实际用该路由 |
| a9 | 编辑用户层为 `gjx/gpt-5.6-sol`：已记录会话仍拒 gjx、仍可列 opencode-go；新会话策略 = gjx 且反向拒绝 opencode-go；旧策略事件未改写 |
| a10 | 旧会话 resume 后 29 工具、无发现工具、`subagent` 无模型字段 |

原始报告见 `evidence/11-probe.json`（含每条 detail 与中间值）。探针运行 2026-09-10T15:46:31Z → 15:46:55Z；2026-09-11T03:36:15Z → 03:36:47Z 在 a7 补上 reasoningEffort 断言后重跑，16/16 不变（Stage 6 Spec #2）。

## 6. 与票据 10 预测的差异

finding 10-1 预测「启用 `modelSelectionSettings` 后工具集合仍应为 29」不成立：官方机制在**开启的会话**里额外注册路由发现工具 `list_subagent_models`，promotion 后目录为 30（探针 a00/a3 实测）。这是预期变化，不是回归；测量侧因 headless 基线 `enabled=false` 不受影响（§4 冒烟仍 29）。票据 12 的探测口径与 13 的文档需按此记录。

## 7. 残留风险与转交

- **2026-09-11 Stage 6/7 补强（已处置）**：Stage 6 Spec 轴指出 a7 断言只比较 provider/model（票据 11 L16 写明「含 effort 继承」）。已给 `probe.mjs` 的 a7 加上 `reasoningEffort` 相等断言并重跑：父子同为 `max`，16/16；探针与报告 sha 见 §1。旧报告 sha `eb986337…` 保留在本文记录中备查。
- **票 12**：4 条路由中只有 `opencode-go/deepseek-v4-flash` 有 M4 工具调用实测；`opencode-go/deepseek-flash` 在本探针跑通的是对话补全（子代理直接回 "OK"，未发工具调用），仍需按票 12 做真实工具调用探测；`commandcode/…` 额度重置于 2026-09-11T06:21:01.800Z（finding 05-6），`deepseek-official/…` 密钥可用性未验证。
- **tui-central（parked）**：其 profile patch 未加服务行；解除停用前必须按 tui-dev 同法挂载，否则 preset 组合直接抛错（spec 范围只含 tui-dev，未动停放副本）。
- **交互 TUI 验收（人工）**：`1mdsh-dev` 会话内模型是否实际使用选择、UI 表现属人工验收项（spec「不做的测试」）；本票用 dump 证明宿主挂载、用探针证明机制。
- **用户层可影响测量**：`~/.dsh/settings.yaml` 的 `subagent-model-selection:` 段对同一 DSH_HOME 下所有 profile 生效；若用户层开启，M4/轨迹会话也会变成 30 工具形状（本票探针正是用该叠加方式）。扩缩集合时注意区分基线行与用户层。
- **未提交**：本轮改动未 commit/push，等待审阅。
