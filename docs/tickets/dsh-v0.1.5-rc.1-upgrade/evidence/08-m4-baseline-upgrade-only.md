# 票据 08 证据 — 行为基线：仅升级（M4 E 组）

日期：2026-09-10
执行：ask-matt-flow Stage 5 Implement，票据 08（本窗口）
环境：Node v22.22.1；全局宿主 `@deepseek-ai/dsh@0.1.5-rc.1`（本窗口复验 `dsh --version`）；开发侧 preset `minimal-plus-next`（未去重，票据 09 前状态）；stable 隔离运行时 `0.1.1-rc.2` 未触碰
范围：确立「只升级宿主、组合尚未去重」的行为基线，作为票据 10 去重后对比的对照。本票只记录并归因升级带来的差异，不产出任何去重结论（去重属 09/10）。

## 0. 验收清单对照

| 票据 08 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 按历史样本量采集（每组 9 次） | 通过 | §1/§2：E 组 N=9（唯一可重跑组，C/A 的 preset 已删除），error 0/9 |
| 记录首轮锚定率 | 通过 | §3.2：口径锚定率 67%（6/3/0），行为锚定 9/9 |
| 记录第二轮注入是否发生 | 通过 | §3.3：check3 9/9 |
| 记录第二轮 bash 是否切换为受沙箱约束的形态 | 通过 | §3.4：check4 9/9 |
| 记录第二轮可见工具数量与请求头工具快照 | 通过 | §3.5：29 个；快照逐跑一致 |
| 原始数据存档 | 通过 | §2：路径 + sha256 + 注释头 + 会话留存 |
| 与历史批次的差异仅作趋势参考，并注明宿主版本已变 | 通过 | §4/§5 |

## 1. 基线输入：复用票据 07 实跑数据（复核结论）

**决定：复用** `experiments/m4/results-minimal-plus-next-upgrade-only-2026-09-10.jsonl`（票据 07 实跑，2026-09-10T12:12:20Z–12:14:38Z）并独立复算，**不重跑**。

重跑命令与票据 07 §4 相同（约 2 分 18 秒），重跑会新增 provider 采样噪声且不改变下列配置事实；票据 07 已声明「本批原始数据满足票据 08 采集要求，是否采用由票据 08 复核决定」。

| 复核项 | 结论 | 依据 |
| --- | --- | --- |
| 同一配置（仅升级、组合未去重） | 成立 | 部署位 `~/.dsh/.agent-presets/minimal-plus-next/` 8 个生产文件 sha256 与仓库 `presets/minimal-plus-next/` 逐一相同；preset 仓库文件 mtime ≤ 16:05，早于运行；`agent.cordis.yml` 头注「去重（ADR-0003）在票据 09 单独进行」，票据 09 仍未开始 |
| 采集在 TUI 可用确认之后 | 成立 | 票据 05 冷启动证据（本地 17:53）与票据 06 会话/回退回归（本地 19:59）均早于本批首条记录（本地 20:12:20） |
| 宿主版本 rc.1 | 成立 | 本窗口 `dsh --version` → `0.1.5-rc.1`；数据注释头亦标注 |
| 测量工具与口径冻结 | 成立 | `m4-runner.mjs`（20:10:40）、`m4.patch.yml`（20:11:11）早于首条记录；`summarize.mjs` 自 2026-09-03 未改；记录形状与历史逐字段一致（§2） |
| 路由与历史同源 | 成立 | 本批 9/9 `opencode-go/deepseek-v4-flash`，与 2026-08-21、2026-09-03 两个 E 批次相同；`M4_MODEL` 只覆盖运行入口，记录的 `model` 字段反映实际路由 |
| 注释头语义 | 有据 | 头行含 `dsh 0.1.5-rc.1 upgrade-only baseline; preset=minimal-plus-next` |

## 2. 原始数据存档

- 文件：`experiments/m4/results-minimal-plus-next-upgrade-only-2026-09-10.jsonl`
- sha256：`2fc453932386a9ed522ef32b4de05c7822ab00773f2c9e24689a90f9da8e8288`
- 结构：1 行注释头 + 9 条记录，17743 B；mtime 2026-09-10 20:14:38
- 运行窗口：12:12:20.752Z → 12:14:38.514Z（约 2m18s）；单跑 12.96–28.89s；error 0/9
- 记录形状：本票独立复算，9 条记录与 2026-08-21 E、2026-09-03 E 逐字段形状完全相同（含数组元素形状）
- 会话留存：`~/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E{1..9}-*`（与历史 M4 同约定，未清理）
- 探针清理：工作区无 `m4-probe-E*.txt` 残留
- 版本管理：该文件未跟踪（`??`），按用户规约不 commit/push

## 3. 逐项测量（本票独立复算，口径未改）

### 3.1 样本量

E 组 9 次全部 `error=null`；`summarize.mjs` 原样复算 n=9。

### 3.2 首轮锚定

行为事实（逐跑）：

- `firstToolCall.name`：9/9 `bash`，`turn` 9/9 = 1
- `firstMessage.classification`：9/9 `tool call`

| run | 首行 | 口径分类 |
| --- | --- | --- |
| E1 | （空） | tool call |
| E2 | （空） | tool call |
| E3 | 我先查看工作目录的内容。 | tool call |
| E4 | 我先查看一下工作目录内容。 | tool call |
| E5 | 我先查看工作目录内容。 | tool call |
| E6 | I'll start by checking the working directory, then create the file. | we need |
| E7 | I'll start by looking at the working directory contents. | we need |
| E8 | I'll start by looking at the working directory, then create the file and verify it. | we need |
| E9 | （空） | tool call |

口径锚定率（`summarize.mjs` 逐字未改）：

```
group  n  toolCall  weNeed  letMe  anchorRate  check3  check4  avgTools
E      9  6         3       0      67%         9       9       29
```

构成与解释：

- weNeed 3 跑（E6/E7/E8）是英文开场句与工具调用**同处一条 assistant/message**；分类器只看首行文本，故记为 we need。
- E3–E5 的中文前导 `我先…` 不匹配分类器的 `^我来|^我们` 规则，仍计入 tool call；本批没有 letMe。
- 历史对照：2026-09-03 E 为 100%（9 tool call / 0 / 0），2026-08-21 E 为 89%（8 / 0 / 1，1 跑 `我来` 归 let me）。
- 结论：67% 的数字差异来自模型开场措辞构成，**不是锚定回归**；「首轮只暴露锚定对、首个响应即带工具调用」在 9/9 成立。

### 3.3 第二轮注入

- `hasAgentInstructions`（check3）：9/9 true，注入确实发生
- `injectedEvents`：9/9 为 `["user","agent-instructions","skill-catalog","instruction-hint"]`，与 2026-09-03 E 同形
- `headerReason`：9/9 `change`（promotion 触发的请求头变更）

### 3.4 第二轮 bash 换用（沙箱形态）

- `bashHasSandbox`（check4）：9/9 true
- `assemblyBashParams` 与 `headerBashParams`：9/9 相同，均为
  `["command","description","timeoutMs","workdir","run_in_background","sandbox_permissions","justification"]`
  （含提权参数 `sandbox_permissions`，即已换成受沙箱约束的 bash）

### 3.5 第二轮可见工具数量与请求头工具快照

- `assemblyTools.length`：9/9 = 29；`headerTools.length`：9/9 = 29
- 逐跑 `assemblyTools` 与 `headerTools` 集合完全相同（排序后比较 9/9 true）
- 快照（29 个，排序；assembly 与 header 同）：

```
ask_user_question, bash, create_goal, edit, exit_plan_mode, get_goal, glob, grep,
interrupt_agent, job_kill, job_list, job_output, list_agents, ralph, read, read_image,
send_message, skill, skill_load, skill_search, str_replace_editor, subagent, subagent_fork,
todo_write, update_goal, web_fetch, web_search, workflow, write
```

- 与历史差异：仅多 `web_fetch`；其余 28 个工具名相同（2026-08-21 / 2026-09-03 E 均 28）。

## 4. 与历史批次对比（趋势参考；宿主版本已变）

| 批次 | 宿主 | 组 / preset（原始记录值） | n | toolCall | weNeed | letMe | anchorRate | check3 | check4 | avgTools |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-21 | rc.2 | E / `liangshen-bash` | 9 | 8 | 0 | 1 | 89% | 9 | 9 | 28 |
| 2026-09-03 | rc.2 | E / `liangshen-bash`（README-selfhost 注「当时名」，后更名 minimal-plus） | 9 | 9 | 0 | 0 | 100% | 9 | 9 | 28 |
| **2026-09-10** | **0.1.5-rc.1** | **E / `minimal-plus-next`** | **9** | **6** | **3** | **0** | **67%** | **9** | **9** | **29** |
| 2026-08-21 | rc.2 | C / `liangshen`（已删除，不可重跑，仅供参考） | 9 | 9 | 0 | 0 | 100% | 9 | 0（persistent，预期） | 28 |
| 2026-08-21 | rc.2 | A / `liangshen-plus`（已删除，不可重跑，仅供参考） | 9 | 7 | 2 | 0 | 78% | 9 | 9 | 26 |
| 2026-08-20 | rc.2 | C / `liangshen`（早期批，仅供参考） | 9 | 6 | 0 | 3 | 67% | 9 | 0（persistent，预期） | 28 |

注：

- 宿主已从 rc.2（08-21/09-03）变为 rc.1（09-10），跨批数字**只作趋势参考**，不作严格对照；C/A 组 preset 已删除，仅 E 组可复算。
- 08-21 E 原始记录 `toolSequence[].round` 为 2，09-03/09-10 为 1；属历史批次内部差异，M4 现行断言不取该字段，仅记录。

## 5. 差异归因

1. **可见工具 +1（`web_fetch`）— 宿主升级所致，有第一方配置依据：**
   - rc.1 宿主 base：`/Users/vito/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml` L450–454，tool-web `fetch: true`
   - rc.2 stable base：`/Users/vito/data/dev/dsh-runtime/stable/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml` L414–418，tool-web `fetch: false`
   - 本 preset 的 tool-web 行（`presets/minimal-plus-next/agent.cordis.yml` L274–278）`fetch: false` 与 rc.2 时期不变；rc.1 `dsh-tool-web` 仅在 `config.fetch=true` 时注册 `web_fetch`（`lib/index.js` L874–875）。
   - 本批 `web_fetch` 出现在 assembly 与请求头，说明宿主平面实例已开启；agent 平面同一行的 `fetch: false` 未能抑制它。该行正是票据 09 计划移除的「网页抓取开关」差异（本轮决定跟随宿主）；去重后可见集合应保持 29，由票据 09/10 验证。本票只记录，不处置。
2. **口径锚定率 67% vs 历史 89%/100%** — 开场措辞构成 + 未改分类器口径所致，无行为回归（§3.2）。
3. **其余项**（二轮注入 9/9、沙箱 bash 9/9、headerReason `change`、injectedEvents、首工具 `bash`、路由）与历史一致。
4. 未发现其他差异；没有证据表明存在去重之外的行为变化。

## 6. 边界与未做

- 未改任何代码、preset、配置或 stable 侧文件；产出仅本证据与票据/流程状态更新。
- 未重跑批次（决定与依据见 §1）；未做组合去重（09）、未接官方模型选择（11）、未做允许路由探测（12）。
- 未 commit、未 push、未打 tag。
- 回归（本窗口复验，无代码改动）：`npx tsc --noEmit` 0 错；`npm test` 97/97 / 0 fail。

## 7. 本票发现

- **08-1**：升级基线复用成立（§1）；基线输入 sha256 见 §2。
- **08-2（转 10）**：对比去重前后时应同时看「口径锚定率」与「行为锚定（首响应含工具调用）」；本批两者为 67% / 9-9，票据 10 无需把口径数字差异当回归。
- **08-3（转 09/10）**：rc.1 宿主 base `fetch:true` 使可见工具为 29；preset 的 `fetch:false` 行在 rc.1 下不再抑制宿主 `web_fetch`。票据 09 删除该行后，票据 10 需确认工具集合仍为 29（含 `web_fetch`）。
- **08-4（运行事实）**：9 个 M4 会话留存于 `~/.dsh/sessions/...session-m4-E*`；探针文件已清理。
