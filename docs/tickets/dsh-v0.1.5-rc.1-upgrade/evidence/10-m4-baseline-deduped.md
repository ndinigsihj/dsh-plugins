# 票据 10 证据 — 行为基线：去重后与差异解释

日期：2026-09-10
执行：ask-matt-flow Stage 5 Implement，票据 10（本窗口）
环境：Node v22.22.1；全局宿主 `@deepseek-ai/dsh@0.1.5-rc.1`；预设 = 开发侧 `minimal-plus-next`（票据 09 去重后，部署位 `agent.cordis.yml` sha256 `3de7d32b…`，8/8 与仓库一致）；路由 = `opencode-go/deepseek-v4-flash`（与票据 07/08 两批同源，默认 commandcode 仍在 429 额度期）
对照基线：`experiments/m4/results-minimal-plus-next-upgrade-only-2026-09-10.jsonl`（sha256 `2fc45393…`，票据 08「仅升级」）
本批原始数据：`experiments/m4/results-minimal-plus-next-deduped-2026-09-10.jsonl`（sha256 `c2d4ef22…`）

## 0. 验收清单对照

| 票据 10 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 按历史样本量采集（每组 9 次） | 通过 | §1：E 组 N=9，error 0/9，exit 0（墙钟 2m32s） |
| 与「仅升级」基线逐项对比 | 通过 | §2：12 个顶层字段形状逐字同形；14 项记录字段取值集合全部相同 |
| 每一处差异都有归因说明 | 通过 | §3：口径锚定率 67%→56%（1 跑开场措辞）、耗时均值 +1.4s、工具序列样本；结构字段零差异 |
| 首轮锚定率、第二轮注入、bash 换用三项无回归 | 通过 | §4：行为锚定 9/9 = 9/9；check3 9/9 = 9/9；check4 9/9 = 9/9，bash 参数逐字段相同 |
| 原始数据与对比结论一并存档 | 通过 | 本文件 + 上述 jsonl（批次头注释记录部署位 sha256）+ 9 个会话留存 |

## 1. 采集口径与执行

命令（工作区 `dsh-plugins`，真实 LLM，与票据 07/08 逐字同口径）：

```sh
M4_GROUPS=E M4_RUNS=9 M4_MODEL=opencode-go/deepseek-v4-flash \
M4_OUT=/Users/vito/data/dev/dsh-plugins/experiments/m4/results-minimal-plus-next-deduped-2026-09-10.jsonl \
dsh --profile headless --patch experiments/m4/m4.patch.yml
```

- 输出：`m4 E1 done: ok` … `m4 E9 done: ok`（9/9），exit 0，`error` 全为 null。
- 时间：首条 `14:25:55.479Z` → 末条 `14:28:27.111Z`（墙钟约 2 分 32 秒；单跑 14.0–22.8 秒）。
- 组表：`E → minimal-plus-next`（票据 07 已改指开发侧组合）；preset 由部署位 user root 加载（`m4.patch.yml` 的 `roots: []` + `includeUserRoot: true`）。
- 采集前闸门：部署位 8 个运行时文件与仓库 sha256 8/8 一致（去重后的 `3de7d32b…`），批次头注释写入该 sha256，保证本批可追溯。
- 任务副产物 `m4-probe-E{1..9}.txt` 已按历史约定清理；9 个 `session-m4-E{1..9}-*` 会话留存 `~/.dsh/sessions/`（同 finding 07-3）。
- 权限注记：headless profile 加载会回写 `~/.dsh/profiles/headless/`（finding 01-2），按用户偏好以一次性 danger-full-access 执行；未手工编辑 `~/.dsh` 配置。

## 2. 与「仅升级」基线逐项对比

**记录形状**：9 条新记录与基线逐字段形状比对 `true`（与票据 07 的 12 字段/嵌套结构一致，未因去重改变任何字段）。

**取值集合**（每项比较两批各自的 distinct 值；`same` 表示两批集合相同）：

| 记录字段 | 基线（仅升级） | 去重后 | same |
| --- | --- | --- | --- |
| `group` / `preset` / `model` / `error` | E / minimal-plus-next / opencode-go/deepseek-v4-flash / null | 同 | 是 |
| `firstMessage.classification`（runner 口径：首响应含 tool-call 块） | `tool call` ×9 | `tool call` ×9 | 是 |
| `firstToolCall.name` | `bash` ×9 | `bash` ×9 | 是 |
| `r2.assemblyTools` / `r2.headerTools` | 29 个工具，逐名一致 | 同 | 是 |
| `r2.assemblyBashParams` / `r2.headerBashParams` | `command/description/timeoutMs/workdir/run_in_background/sandbox_permissions/justification` | 同 | 是 |
| `r2.bashHasSandbox` | true ×9 | true ×9 | 是 |
| `r2.hasAgentInstructions` | true ×9 | true ×9 | 是 |
| `r2.injectedEvents` | `["user","agent-instructions","skill-catalog","instruction-hint"]` | 同 | 是 |
| `r2.headerReason` | `change` ×9 | `change` ×9 | 是 |
| `r2.hasMarker` / `r2.marker` | null / null | 同 | 是 |
| assembly 与 header 快照一致性 | — | 9/9 一致 | — |

**汇总口径**（`summarize.mjs` 未改一字，两批同源复算）：

| 批次 | n | toolCall | weNeed | letMe | anchorRate | check3 | check4 | avgTools |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-10 仅升级（票据 08） | 9 | 6 | 3 | 0 | 67% | 9 | 9 | 29 |
| 2026-09-10 去重后（本票） | 9 | 5 | 3 | 1 | **56%** | 9 | 9 | 29 |

## 3. 每一处差异的归因

结构字段的差异为零（§2 所有记录字段集合相同），剩余差异只有三项：

1. **口径锚定率 67% → 56%（-11pt，-1 跑）**。分类器（`summarize.mjs`，未改）按首行文本分桶：去重后 E9 首行是「我来完成这个任务。首先查看工作目录内容。」命中 `^我来` → `let me`；基线 E9 首行为空 → `tool call`。其余 8 跑的分桶与基线同型（两批同为 3 跑英文 `I'll` 前导 + 若干中文「我先」/空行）。9 跑的 `firstMessage.classification`（是否含工具调用）与 `firstToolCall.name` 两批完全相同，即行为锚定 9/9 未变。归因：**开场措辞的采样波动，非组合差异**——票据 08-2 已预先裁定「口径锚定率与行为锚定一起看，不把口径数字差异当回归」；历史批次同类波动范围亦为 67%–100%（2026-08-20 C 组 3 跑 `let me`、2026-08-21 A 组 2 跑 `I'll`）。
2. **耗时均值 17.0s → 18.4s（+1.4s）**。单跑区间重叠（基线 12.9–28.9s，去重后 14.0–22.8s），属 provider 采样抖动，无阈值意义。
3. **工具序列样本变化**（如新出现 `bash+str_replace_editor+write+bash+bash`）。任务同模板、工具面同集合；序列差异是模型自身路径选择，两批都完成三步任务（9/9 无 error，探针文件内容逐条核对正确）。

票据 09-1 要求一并看的三项：`subagent_fork` one-shot 语义、plan-mode 正文、compaction/goals 宿主实例——M4 记录口径不含工具描述与服务实例字段，这三项已由票据 09 的无 LLM A/B 冒烟与配置闸门覆盖（工具集合与 bash 参数不变）；本批未出现与之相关的可观测回归。

## 4. 三项无回归判定

| 项目 | 基线 | 去重后 | 判定 |
| --- | --- | --- | --- |
| 首轮锚定 | 行为锚定 9/9（首响应含工具调用、首工具 bash）；口径 67% | 行为锚定 9/9；口径 56%（1 跑措辞，§3.1） | 行为口径无回归；口径数字按 08-2 裁定不作回归 |
| 第二轮注入 | check3 9/9；`injectedEvents` 含 `agent-instructions` 9/9 | check3 9/9；同集合 | **无回归**——也直接证明删除 preset 的 `agent-instructions` 行后宿主行照常注入 |
| bash 换用 | check4 9/9；assembly/header bash 含 `sandbox_permissions` | check4 9/9；参数逐字段相同 | **无回归**——`tool-bash` 恒禁行保留 + `tool-web` 删行未影响 promotion 与沙箱 bash 注册 |

## 5. 去重影响量化结论

在全部 9 条记录的 14 项字段集合上，去重前后**零差异**（工具集合 29、bash 参数、二轮注入、header 快照与 reason、锚定行为分类、模型/预设/路由），唯一变化是模型开场措辞带来的口径数字波动与耗时抖动。即：票据 09 的组合去重在本批 M4 口径下未改变任何可测量行为。

## 6. 本票发现（转 11/13）

- **10-1（转 11）**：本批为去重后基线；`tool-subagent` 行仍是与宿主逐字相同的占位差异行，启用 `modelSelectionSettings: true` 后应只影响委派工具 schema，工具集合仍应为 29——票据 11 的行为验收可用同口径 M4/轨迹对照。
- **10-2（转 13）**：口径锚定率对开场措辞高度敏感（本批 56% vs 历史 67%–100%），行为锚定（9/9）才是稳定回归指标；文档收口时应把这条写进测量口径说明。
- **10-3（运行事实）**：默认路由 commandcode 仍在额度期（finding 05-6），本批与 07/08 同样使用 `M4_MODEL` 覆盖；未改 `settings.yaml`。
- **10-4（运行事实）**：本批新增 9 个 `session-m4-E*` 会话（22:25–22:28 本地），未清理；探针文件已清理。

## 7. 未做

- 未接官方子代理模型选择（11）、未做允许路由探测（12）、未做文档收口（13）。
- 未改任何代码/组合/测试；`summarize.mjs`、`m4-runner.mjs`、`m4.patch.yml` 均未动；未 commit、未 push、未打 tag。

## 附：单 bash R1 诊断（2026-09-10 用户问询后实测，非本票交付，未改仓库）

**问询**：口径锚定率 67%→56% 是否与 rc.1 upstream `minimal` 由两工具改为单工具（只 bash）有关？能否把本 preset 的第一轮也调整为只给 bash？

**事实核对**：本 preset 第一轮（tool-bootstrap `bootstrapTools: [bash, str_replace_editor]`，票据 09 去重未动）两批对照均为两工具；rc.1 upstream minimal 的「两工具→单工具」是其自有 presets 的变化，不作用于本 fork（本 preset 仍自带 `str-replace-editor` 行且宿主 base 不提供）。

**隔离实测**：把 `bootstrapTools` 改为 `[bash]` 的临时变体（`/tmp/ticket10b-presets/minimal-plus-next`，仅 /tmp，不动仓库/部署位），同命令同路由跑 E 组 N=9（`/tmp/ticket10b-one-bash.jsonl`）：

| 条件（R1 工具面） | n | toolCall | weNeed | letMe | anchorRate | check3 | check4 | tools |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 两工具 `[bash, str_replace_editor]`（去重后，本票） | 9 | 5 | 3 | 1 | 56% | 9 | 9 | 29 |
| 单工具 `[bash]`（诊断变体） | 9 | 5 | 3 | 1 | 56% | 9 | 9 | 29 |

变体 9/9 ok，R1 目录实测 `["bash"]`（两工具对照 `["bash","str_replace_editor"]`），R2 结构（29 工具、assembly==header、注入）与对照全同。

**结论**：R1 工具数不是口径锚定率变化的杠杆（单 bash 无改善，两工具在 rc.2 历史 E 批为 89%/100% 同为一个锚定对）；行为锚定两批均 9/9。不据此改 preset；如需追查 rc.1 与 rc.2 的系统性差异，应另立实验（更大样本或宿主工具面 A/B）。
