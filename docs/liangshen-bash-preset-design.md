# liangshen-bash preset 设计方案（liangshen 全量基底 + 二轮提权 + 二轮 AGENTS.md 注入）

> 目标（用户意图，2026-08-21 修正定稿）：**liangshen 的效果 + bash 提权 + 二轮 AGENTS.md 注入**。
> 即完整还原 liangshen 基底（含 Minimal persona、`includeRuntimeContext: false`、
> instruction-hint、skill-search 等全部行），只新增两个机制：phase-swap-bash（二轮沙箱 bash 提权）
> 与显式 `dsh-agent-instructions`（二轮 AGENTS.md 注入）。不换 persona、不删 liangshen 的任何行。
>
> 背景：`liangshen-plus` 在组合时把 persona 换成了 standard 版（其设计文档 §3.1 改动 4），
> 偏离了用户"liangshen 效果 + 提权"的原意；用户确认新增独立 preset 还原该意图并做对比测试。

---

## 0. 结论先行

**结论：新增独立 preset `liangshen-bash`，以 liangshen 的 `agent.cordis.yml` 为基底做 6 处改动
（4 处本地路径改包绝对路径 + 2 处新增行），persona 与其余全部行逐字不动。**

| 维度 | liangshen | liangshen-plus | **liangshen-bash（本方案）** |
|---|---|---|---|
| 首轮 | Minimal 锚定对，零注入 | 同左 | 同左（逐字节同 liangshen） |
| persona | Minimal（`complete:true` + `includeRuntimeContext:false`） | **standard 版** | **Minimal（同 liangshen）** |
| instruction-hint | 有 | 无 | **有（同 liangshen）** |
| skill-search | 有 | 无 | **有（同 liangshen）** |
| 二轮 AGENTS.md 注入 | 依赖 host 层（实测 9/9 生效） | 显式挂 `dsh-agent-instructions` | **显式挂（同 plus）** |
| 二轮 bash | persistent PTY，无提权 | 沙箱 + `sandbox_permissions` 提权 | **沙箱 + 提权（同 plus）** |

## 1. 与 liangshen 的差异（仅 6 处）

| # | 行 | 改动 | 理由 |
|---|---|---|---|
| 1 | tool-bootstrap | `./tool-bootstrap.mjs` → 部署包绝对路径 | S7 部署位决策：复用物走部署包，版本随 @deepseek-harness-tui/dsh-tui 流动，零拷贝漂移 |
| 2 | instruction-hint | `./instruction-hint.mjs` → 部署包绝对路径 | 同上 |
| 3 | custom-bash | `./custom-bash.mjs` → 部署包绝对路径 | 同上 |
| 4 | skill-search | `./skill-search.mjs` → 部署包绝对路径 | 同上 |
| 5 | **新增** phase-swap-bash | 挂在 tool-bootstrap 之后（同 plus 位置），引用 repo 版本化插件 | 提权本体 |
| 6 | **新增** agent-instructions | `@deepseek-ai/dsh-agent-instructions`，`maxBytes: 65536`（同 plus/standard） | 二轮 AGENTS.md 注入显式化 |

第 1-4 处是纯路径替换，语义零变化；第 5-6 处是唯一新增行为。首轮上下文与 liangshen 逐字节相同，
锚定面不受影响。

## 2. 关键机制证据（决定本设计的事实）

| 事实 | 证据 |
|---|---|
| phase-swap-bash 只依赖 promotion 事件（tool/call），与 persona 无关 | `phase-swap-bash.mjs`：`session/event` 监听 + `createEpochPromotion(['tool/call'])` |
| Minimal persona 的 `includeRuntimeContext:false` 会剥掉所有轮次的 runtime context 快照（cwd、DSH 文件策略、审批策略） | `@deepseek-ai/dsh-persona` lib L41：`ctx.systemPrompt.suppressRuntimeContext()`；快照模板见 `dsh-system-prompt` lib L87 |
| host 层已注册 `dsh-agent-instructions`——liangshen 在部署栈里二轮已注入 AGENTS.md（C 组实测 9/9） | `@deepseek-ai/dsh-base/cordis.patch.yml` L233；M4 C 组 `injectedEvents=['user','agent-instructions','instruction-hint']` |
| 因此第 6 处在部署栈近乎 no-op，但让 preset 自包含、意图显式，且与 plus 对齐 | 同上 |
| 保留 instruction-hint + 显式 agent-instructions → 二轮起 hint 与 digest 并存（hint 冗余但无害） | C 组实测双源并存无冲突 |

**张力点（已知取舍，记录而非解决）**：Minimal persona 剥掉 runtime context 快照后，模型知道 bash
schema 里有 `sandbox_permissions` 参数，但看不到"当前文件策略 / 审批策略"事实——提权能力在、策略
可见性不在。这是 liangshen 语义的固有属性（用户明确要求保留），对比实验将观察其实际影响。

## 3. 部署位

- repo 版本化：`presets/liangshen-bash/agent.cordis.yml` + `preset.yml`（本仓库）。
- 复用物（tool-bootstrap/instruction-hint/skill-search/custom-bash/compaction-epoch）走部署包绝对路径
  `/Users/vito/.dsh/profiles/endless-tui/node_modules/@deepseek-harness-tui/dsh-tui/presets/liangshen/`
  （> 注意：`endless-tui` 已弃用；该路径是历史部署点，若移除 profile 需改指 `tui`/`tui-dev` 的
  node_modules 或 vendored，本期未动）。
- phase-swap-bash 插件引用 repo 现有文件 `presets/liangshen-plus/phase-swap-bash.mjs`（单一来源，
  不拷贝；若日后需解耦再迁 `presets/shared/`，届时同步改 plus 与新 preset 的引用）。
- 部署位：`~/.dsh/.agent-presets/liangshen-bash/`（agent.cordis.yml + preset.yml，
  与 liangshen-plus 同构，无 .dsh-tui-managed.json）。

## 4. 命名（待用户拍板）

| 候选 | 含义 | 备注 |
|---|---|---|
| **liangshen-bash**（默认提案） | liangshen + bash 提权 | 与用户口头表述"liangshen+bash 提权"一致；二轮注入未入名（与 plus 一样靠描述承载） |
| liangshen-full | 强调 liangshen 全量保留 | 不点名提权/注入 |
| liangshen-native | 强调原生 liangshen 语义 | 同上 |

preset.yml 描述（默认提案）：
`liangshen 全量基底（Minimal persona + instruction-hint + skill-search）+ 二轮沙箱 bash 提权 + 二轮 AGENTS.md 注入。`

## 5. 验证计划

### 5.1 无 LLM 冒烟（实现后立即执行）

复用 `presets/liangshen-plus/smoke-boot.mjs` 模式（headless 组合 + agent-presets 挂载新 preset），
验证点照抄 liangshen-plus 冒烟清单，另加两处：

| 检查 | 预期 |
|---|---|
| ROUND1 catalog | `{bash, str_replace_editor}`，bash 仅 `command` 参数 |
| ROUND1 pre-step | `[]`（零注入） |
| ROUND2 catalog | 全量 + **含 skill_search/skill_load**（liangshen 独有行保留） |
| ROUND2 bashParams | 含 `sandbox_permissions`/`justification`（swap 生效） |
| ROUND2 pre-step | 含 `agent-instructions`（且 instruction-hint 源存在） |
| WARNINGS | 无 swap 失败 |

### 5.2 M4 对比实验（组 E）

复用 m4-runner/m4-driver，新增组 **E = liangshen-bash**，与 C（liangshen）、A（liangshen-plus）同模板
同模型对比，N=9/组：

| 验证点 | 预期 | 判定 |
|---|---|---|
| 首轮锚定率 | E ≈ C（首轮配置逐字节相同，理论同分布） | E 与 C 差 ≤1 跑为过 |
| 二轮 AGENTS.md 注入 | E 9/9 | 全过 |
| 二轮 bash schema | E 9/9 含 sandbox_permissions | 全过 |
| 二轮目录 | E 含 skill_search/skill_load，A 无 | 观察性 |
| runtime context 缺失影响 | E 与 C 同基线；观察是否出现因看不到文件策略而错误的工具调用 | 探索性 |

**可选加分项（不混入主批次，另跑 N=3~5）**：任务模板加一步"工作区外写文件"，仅在新 preset 上跑，
观察模型是否使用 `sandbox_permissions` + `justification` 尝试提权（headless 无审批 answerer 会
fail closed，只测"是否尝试"，不测"是否成功"）。与主批次分开，保持历史口径可比性。

### 5.3 验收与降级

| 场景 | 降级 |
|---|---|
| E 锚定显著差于 C（差 >1 跑） | 说明新增两行扰动了首轮（与机制分析矛盾）→ 排查行序/注入纪律，回写文档 |
| swap 失败（warn 出现） | 查 phase-swap-bash 在双 preset 挂载下的兼容性（插件单例？） |
| 提权尝试率为 0 且模型因策略不可见反复失败 | 回到 B 折中方案：persona 保留 Minimal 文案但 `includeRuntimeContext` 改回 true，数据说话 |

### 5.4 实验结果（M4，2026-08-21）

环境与 M4 历史批次一致（headless 组合 + agent-presets，N=9/组，模型 opencode-go/deepseek-v4-flash，
同一任务模板；runner 用 `M4_GROUPS=E,C,A`）。原始数据：`experiments/m4/results-liangshen-bash-E-C-A-*.jsonl`。

| 组 | n | tool call | we need | let me | 锚定率 | 二轮注入（check3） | 二轮沙箱 bash（check4） | 二轮工具数 |
|---|---|---|---|---|---|---|---|---|
| **E** liangshen-bash | 9 | 8 | 0 | 1 | 89% | 9/9 | **9/9** | 28（含 skill_search/skill_load） |
| **C** liangshen（基线） | 9 | 9 | 0 | 0 | 100% | 9/9 | 0/9（persistent，预期） | 28 |
| **A** liangshen-plus（基线） | 9 | 7 | 2 | 0 | 100% | 9/9 | 9/9 | 26（无 skill_search/skill_load） |

**判定（按 §5.3）**：

- **E 组：通过。** 锚定率 89%（1 个 `我来` 前导）与 C 组 100% 差 1 跑（≤1 跑阈值）；check3/check4 全过。
  新增两行未扰动首轮锚定；提权与注入均按设计生效。E 的 `injectedEvents` 为
  `[user, agent-instructions, instruction-hint]`——双注入源并存（C 组同构，佐证 §2 的 host 层事实）。
- **双 preset 挂载兼容性（§6#2）已答**：本批在同一进程内依次挂载 E/C/A，A 与 E 各载入一个
  phase-swap-bash 实例（同一插件文件），无冲突、无 swap 失败，各 session 的 shadow 隔离正常
  （E/A 沙箱 bash 9/9、C 0/9）。
- **批次方差再确认**：本批 C=100%、A=100%，均高于历史批（C 67%、A 78%），而 E=89% 反而是本批最低——
  再次说明 n=9 下组间 ±1 跑的差异不可解释为 preset 效果；E 与 C 首轮同分布假设未被推翻。
- runtime context 缺失的影响：本模板为工作区内任务，未观察到 E 组因看不到文件策略而失败的工具调用；
  提权尝试行为未测（§5.2 加分项留待需要时单跑）。

## 6. 未决问题

1. ~~命名~~ —— 已拍板：`liangshen-bash`（2026-08-21）。
2. ~~双 preset 同时挂载时 phase-swap-bash 插件的实例化语义~~ —— M4 E/C/A 同进程批次已答：
   各 preset 载入独立插件实例、按 scope 隔离，无冲突（§5.4 判定）。
3. ~~M4 driver 组表新增 E~~ —— 已完成：`GROUP_PRESET` 加 E → liangshen-bash，A/C 回归本批
   完成且 runner 有效（C 基线 100% 锚定、check4 0/9 与预期一致）。

## 7. 相关文件

- 设计：本文档
- preset：`presets/liangshen-bash/agent.cordis.yml`、`presets/liangshen-bash/preset.yml`（待实现）
- 复用：`presets/liangshen-plus/phase-swap-bash.mjs`（repo）、部署包 `presets/liangshen/*`（4 个 mjs）
- 冒烟/实验：`presets/liangshen-plus/smoke-*`、`presets/liangshen-plus/m4-*`（复用，driver 加 E 组）
- 参照：`docs/liangshen-plus-preset-design.md`（plus 的四改动出处）
