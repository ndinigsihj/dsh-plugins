# 票据 09 证据 — 组合去重

日期：2026-09-10
执行：ask-matt-flow Stage 5 Implement，票据 09（本窗口）
环境：Node v22.22.1；全局宿主 `@deepseek-ai/dsh@0.1.5-rc.1`；stable 隔离运行时 rc.2 未触碰
口径依据：票据 09 文件 + spec「组合去重」节 + ADR-0003（preset 只声明与 base 的差异；空组删除）+ finding 05-2/05-5/03-3
机器可核对数据：`evidence/09-dedupe-ab.json`

本票只改组合声明，不改任何插件代码、不改测量/统计口径、不碰 stable 侧。仓库文件为 `presets/minimal-plus-next/agent.cordis.yml`（278 → 184 行，sha256 `3de7d32b…`）。

## 0. 验收清单对照

| 票据 09 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 删除与宿主逐字重复的挂载行 | 通过 | §1：17 个逐字重复行中删 16 行，`tool-subagent` 按 ADR-0003 保留为差异行 |
| 因删除而空掉的组合分组已移除 | 通过 | §1：`planning`（唯一行 plan-mode 跟随宿主）、`compaction`（3 行全重复）整组移除 |
| 仍需保留的分组只保留表达停用意图的行 | 通过 | §1：`delegation` 组保留 codex / claude-code 两个 `disabled: true` 行（+ tool-subagent 差异行，见下条） |
| 保留「始终禁用的 bash」差异行 | 通过 | §1：`tool-bash` 保持 `disabled: true`（宿主为 win32-only） |
| 保留「承载模型选择开关的委派工具」差异行 | 通过 | §1：`delegation/tool-subagent` 保留，注释标注票据 11 将加 `modelSelectionSettings: true` |
| 原属差异、本轮决定跟随宿主的两行已删除 | 通过 | §1：`planning/plan-mode`（section 正文）、`tool-web`（fetch 开关）；另 `tool-subagent-fork` 按本轮决定跟随宿主 one-shot，一并删除 |
| 配置导出无冲突或重复挂载错误 | 通过 | §3：`dsh --profile tui-dev --dump-config` exit 0；98 行 / 98 唯一 id / 0 重复（补上 finding 05-2 的逐 id 计数闸门） |
| 可见工具集合与去重前一致；若有差异，每处都有解释 | 通过 | §4 A/B 无 LLM 冒烟逐字一致；§5 与票据 08 基线 29 工具逐名相同，行为差异逐项解释 |

## 1. 去重口径与逐行清点

宿主基准：`@deepseek-ai/dsh-base@0.1.5-rc.1/cordis.patch.yml`（host plane 的组装来源，spec 的服务基座；profile 里其他 insert 行不属 preset 面）。比对按 `id + name + disabled + config` 结构化逐字，`!!js` 表达式按原文比较。

保留 11 个顶层行（含 2 个分组）+ 分组内 6 行，删除 19 行（16 个逐字重复 + 3 个本轮跟随宿主的差异）+ 2 个空组：

| 处置 | 行 | 理由 |
| --- | --- | --- |
| 删（重复） | `agent-instructions` | 与 base 同 id/同 config（maxBytes 65536）；二轮注入由宿主行提供，A/B 冒烟已证 |
| 删（重复） | `tool-pwsh` | 与 base 同 disabled 表达式（win32-only） |
| 删（重复） | `tool-fs`、`tool-fs-search` | 与 base 同 id；`sampleOverCapGlobResults:false` 同值 |
| 删（重复） | `tool-jobs` | 与 base 同 id 同 name；jobs 注册表本在宿主层 |
| 删（重复） | `skill-filesystem` | 与 base 同 id 同 name（技能注册表按 scope 分层，宿主层注册对 agent 可见） |
| 删（重复） | `tool-goal` | 与 base 同 id 同 name（goal 服务/驱动在宿主层，工具注册进宿主 tools 注册表） |
| 删（重复） | `tool-todo` | 与 base 同 id 同 config（`allowParallelInProgress:true`） |
| 删（重复） | `compaction/{compaction-basic,command-compact,tool-result-pruner}` | 3 行与 base 同 id 同 config |
| 删（重复） | `delegation/{tool-subagent-control,tool-subagent-list-agents,workflow-worker-thread,tool-workflow,tool-ralph}` | 5 行与 base 同 id 同 config |
| 删（跟随宿主） | `tool-web` | 原差异 `fetch:false`；本轮决定跟随宿主 `fetch:true`（spec）。去重前宿主 `web_fetch` 本就可见（finding 08-3），集合不变 |
| 删（跟随宿主） | `planning/plan-mode` | 原差异只在 section 正文一处措辞；本轮决定跟随宿主，行删除后 `planning` 组空 → 整组移除 |
| 删（跟随宿主） | `delegation/tool-subagent-fork` | 原差异 `backgroundMode: continuable`；本轮决定与 base 对齐 `one-shot` 且不参与模型选择（spec「fork 来源的委派与宿主默认对齐」） |
| 删（空组） | `planning`、`compaction` 两个 `cordis:group` | 组内行全部删除（ADR-0003：空掉的组一并删除） |
| 留（差异） | `tool-bash` | `disabled: true`（宿主为 `win32-only`）；persistent-shell 注册同名 bash，沙箱 bash 由 phase-swap-bash 动态注册 |
| 留（差异） | `delegation/tool-subagent` | 当前与 base 逐字相同，但按 ADR-0003 指定承载票据 11 的官方模型选择开关，保留以避免 09/11 间反复增删 |
| 留（停用意图） | `delegation/tool-subagent-codex`、`…claude-code` | 宿主无对应行；`disabled: true` 表达本部署不安装这两个 provider |
| 留（无宿主行） | `tool-bootstrap`、`phase-swap-bash`、`persona`、`instruction-hint`、`persistent-shell` 组（pty/terminal-bash/persistent-bash）、`custom-bash`、`str-replace-editor`、`skill-search`、`tool-ask-user` | preset 自有插件 / 宿主 base 不提供的行（`str_replace_editor`、问卷工具 base 均不含） |

`delegation` 组的 `isolate: workflowEngine: true` 保留原样：组内已无 workflow 行（该服务实例改由宿主提供），isolate 目前为空 realm，对组外与 agent 无影响；不在本票扩大改动面。

## 2. 实施

- 仓库：`presets/minimal-plus-next/agent.cordis.yml`，278 → 184 行；头部注释改为「只声明与 rc.1 dsh-base 的差异」，逐行标注删除/保留理由。
- 部署位：`scripts/sync-agent-presets.sh minimal-plus-next`（§6）。
- 未改：`presets/minimal-plus`（stable 侧）、任何 `.mjs`、`preset.yml`、测试、`experiments/`。
- 唯一仓库外改动：`~/.dsh/profiles/tui-dev/cordis.patch.yml` 删除 `agent-presets.roots` 覆盖（finding 03-3，见 §3）。

## 3. 配置闸门（finding 05-2 + 03-3）

**preset 自身**：解析后 17 个 loader id（11 顶层 + persistent-shell 组 3 + delegation 组 3），17 唯一 / 0 重复。

**profile 组合**（`dsh --profile tui-dev --dump-config`，exit 0）：

```
rows=98 uniqueIds=98 duplicates=0
PASS: every loader entry id count == 1
```

补上了 finding 05-2 的缺口：`--dump-config` 对重复 id 仍 exit 0，只能证明装配形状；逐 id 递归计数才是无冲突闸门。闸门脚本同时用于 preset 文件与 profile dump（本窗口一次性工具，未入仓）。

**finding 03-3（roots 覆盖）**：原表达式解析到 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh/config/agent-presets/`。实测该路径 gate 时经共享 farm 命中 **stable rc.2** 的旧布局（`code/cordis/minimal/standard`）；farm 指全局 rc.1 时该路径缺失被静默跳过——即同一份 dev profile 的 roster 随 farm 代际漂移，且会引入 rc.1 已移除的旧 id `code`（display name「PTC 模式」）。rc.1 shipped root 自动提供 `minimal/standard/ptc/cordis` 并胜出重复 id，user root 提供 `minimal-plus` / `minimal-plus-next`，故按 finding 的「清理」方向删除整个 `roots` 覆盖。

删除后的 roster 实测（shipped + 部署位 user root，全部 healthy）：

```
standard, ptc, minimal, cordis, minimal-plus, minimal-plus-next
```

`~/.dsh/profiles/tui-dev/cordis.patch.yml` 现 sha256 `1e8cf332…`；`tui`（stable）profile 未动（sha256 仍 `4d364537…`，见 §7）。finding 03-4（`settings.yaml` 的 `agent-presets.default: minimal-plus` 仍优先于 profile 的 `standard`）**未在 09 处置**：TUI runner 始终显式传 preset，改它会影响 stable 侧共享设置；留票据 13。

## 4. 行为 seam A/B（无 LLM 冒烟）

`presets/minimal-plus-next/smoke-boot.mjs`（独立 `DSH_HOME=/tmp/dsh-ticket09-home`，工作区 `/tmp/dsh-ticket09-ws`，repo preset，真实 rc.1 组合与 `system-prompt/assemble`）：

| 观测 | 去重前 | 去重后 |
| --- | --- | --- |
| R1 目录 | `bash`、`str_replace_editor`（persistent bash，无 sandbox_permissions） | 同 |
| R1 注入 | `[]` | 同 |
| R2 目录 | 29 工具（含 `web_fetch`） | 同（逐字） |
| R2 bash 参数 | `command/description/timeoutMs/workdir/run_in_background/sandbox_permissions/justification` | 同 |
| R2 注入 | `agent-instructions`、`skill-catalog`、`instruction-hint` | 同 |
| warn | `[]` | 同 |
| exit | 0 | 0 |

两份输出的 catalog / 注入 / warn 行 `diff` 为空。部署位副本（`SMOKE_PRESET_ROOT=~/.dsh/.agent-presets`）复跑同样 exit 0、29 工具一致——冷启动加载源（部署位）与仓库源行为相同。

## 5. 与「仅升级」基线的对账与差异解释

票据 08 基线 `experiments/m4/results-minimal-plus-next-upgrade-only-2026-09-10.jsonl`（sha256 `2fc45393…`，E 组 9 跑）的 `r2.assemblyTools` 与去重后冒烟的 R2 目录：**29 = 29，集合逐名相同，均在含 `web_fetch`**（9 条基线的 assemblyTools 彼此一致，作为单一集合比对）。

去重后仍存在、需解释的差异（均非工具集合变化）：

1. `subagent_fork` 默认执行语义：`continuable` → `one-shot`（跟随宿主）。schema 参数仍含 `run_in_background`，但默认语义从「后台返回 durable id」变为「等待结果」；spawn 的 `subagent` 保持 continuable。两者此时都还没有 provider/model 字段（属票据 11）。
2. `plan-mode` 提示正文跟随宿主（一处措辞：「to keep the tool catalog unchanged」→「only to keep the request shape stable」）；`exit_plan_mode` 工具与 plan 状态由宿主实例提供，不再隔离在本 preset 的 entry-local realm。
3. `goals` / `compaction` 行为实例改由宿主提供（行/组删除）；模型可见工具不变（`command-compact` 是人类命令，`tool-result-pruner` 不进目录）。
4. 技能发现由宿主层 `skill-filesystem` 注册提供（原 preset 层注册与宿主逐字相同，按 registry 的 nearest-layer 遮蔽语义等价）。
5. `web_fetch`：去重前由宿主 `tool-web`（fetch:true）提供、preset 的 `fetch:false` 只遮蔽了 `web_search` 注册；删除后 `web_search` 同样回落到宿主的同 config 注册，集合与 schema 不变。

## 6. 部署位同步与 sha256（finding 05-5）

`scripts/sync-agent-presets.sh minimal-plus-next` 后，部署位 `~/.dsh/.agent-presets/minimal-plus-next/` 8 个运行时文件与仓库 **8/8 sha256 一致**（去重前仅 `agent.cordis.yml` 漂移 `05805070…`；现 `3de7d32b…`）；`node_modules/@deepseek-ai` 仍指向全局 rc.1 依赖树。stable 的 `minimal-plus` 部署位与链接（stable rc.2）未动。

## 7. 稳定侧未动

| 对象 | 结果 |
| --- | --- |
| `git status --short presets/minimal-plus` | 空 |
| `~/.dsh/.agent-presets/minimal-plus/node_modules/@deepseek-ai` | → `dsh-runtime/stable/…`（未变） |
| `~/.dsh/profiles/tui/cordis.patch.yml` | sha256 `4d364537…`（与票据 03 记录一致） |
| stable 运行时 | 未动 |

## 8. 回归

| 项目 | 结果 |
| --- | --- |
| `presets/minimal-plus-next` 5 个测试文件 | 43 / 43 / 0 |
| `npm test` | 97 / 97 / 0 |
| `npx tsc --noEmit` | 0 错 |

## 9. 本票发现（转 10/13）

- **09-1（转 10）**：去重后 29 工具与「仅升级」基线逐名一致；但 `subagent_fork` 默认语义（one-shot）与 plan-mode 正文已变，票据 10 的对比应同时看「工具集合」与这三项行为口径，不能只看数字。
- **09-2（转 13）**：finding 03-4（dev 侧 `settings.yaml` 的 `agent-presets.default: minimal-plus` 指向 rc.2 组合）仍未处置；TUI runner 显式传 preset 故未触发，隔离方案（profile 层覆盖或 dev 专用 home）留 13。
- **09-3（转 13）**：`tui-central.parked-0.1.5-rc.1/cordis.patch.yml` 仍有同样的 `agent-presets.roots` 覆盖；停用副本未动，解停用前需按本票同法清理。
- **09-4（运行事实）**：`dsh --profile tui-dev --dump-config` 会在 `~/.dsh/profiles/tui-dev/` 回写 `cordis.yml`（rc.1 宿主自带的 profile 规范化，finding 01-2），工作区外操作按用户偏好以一次性 danger-full-access 执行；仓库无越界改动。
- **09-5（行为 seam 观察）**：`planning`/`compaction` 改由宿主实例后，二者仍是进程级共享实例（原 preset isolate 只隔离本 preset 的 standing mount）；本部署单 preset 场景无差异，多 preset 并存时再评估。

## 10. 未做

- 未接官方子代理模型选择（11）、未做允许路由探测（12）、未做去重后 N=9 批次（10）。
- 未改 `tool-subagent` 行本身（保留差异位，`modelSelectionSettings` 属 11）。
- 未改 stable 侧任何文件、部署位副本或 profile；未 commit、未 push、未打 tag。
