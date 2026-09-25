# dsh 0.1.7-rc.1 升级影响与迁移计划（im-dsh-tui）

> 状态：**计划（未执行）**。本文只出计划，不改代码、不动 profile、不迁移会话。
> 基线：宿主 `0.1.5-rc.2`（`~/.dsh/bin/dsh` → nvm v24.21.0 全局 `@deepseek-ai/dsh`）。
> 目标：`0.1.7-rc.1`（npm dist-tag `next`）。**已裁决：精确锁定该版本，不跟随浮动 tag**。
> 升级窗口：**tui-dev 与 headless 同步升级**（已裁决）。
> 日期：2026-09-23 起草；**2026-09-24 经 grill 访谈收口**（Q1–Q15 裁决见 §1.1 与 §7 末尾）。
> 取证：**B1（Agent Team 组合期）已于 2026-09-23 完成**，见 §5.0。
> 来源：`deepseek-ai/deepseek-harness` 逐版 release notes（GitHub API 实拉）+ 标签 `dsh-v0.1.7-rc.1` 下官方文档 + 本仓库只读核查。
> 行号：基于 2026-09-23 的工作区 checkout，迁移时需重新定位。

---

## 1. 结论先行

1. **版本事实先对齐**：npm dist-tags 为 `latest → 0.1.5-rc.3`、`next → 0.1.7-rc.1`、`alpha → 0.1.7-alpha.2`。直接 `npm i -g @deepseek-ai/dsh` 拿到的是 0.1.5-rc.3，**必须显式指定版本；已裁决锁定 `@0.1.7-rc.1`，不跟随 `next`**。本机两个全局安装点（v22.22.1 → 0.1.5-rc.1，v24.21.0 → 0.1.5-rc.2）都还不是目标版本。
2. **三个最高风险面**（都会让现有代码不可用，不是体验差异）：
   - **会话日志 V4**：写入格式升级，**没有面向用户的批量迁移工具**（C0 ②），迁移在会话写开时惰性发生（C0 ③），**不支持降级读**；
   - **会话历史 / Agent 生命周期 / Shell 沙箱接口异步化**：`snapshotEvents` 一类同步读取接口**已在 rc.1 弃用但签名未变**（C0 ①），本仓库 `lib/index.ts` 有 14 处调用 + 2 处类型声明（grep 口径）不因升级而破坏；异步替代面 `ctx.sessionQuery` 已随 dsh-base 挂载，**本轮维持同步、不迁移**（2026-09-24 裁决；票据 05 deferred）；
   - **预设与设置的载体变更**：Agent 预设改由插件组合包声明安装、设置改存当前 Profile 的插件配置（旧 `settings.yaml` 只导入一次）——两者正好是本仓库部署位与闸门的基础。
3. **两个能力缺口**：
   - **subagent 会话的显示与折叠**：上游 0.1.7 已把它做成"一等会话 + 可折叠过程组"；本 TUI 目前只有状态行下的一条气氛行（`lib/app.ts` `renderSubagentsLine`）。
   - **Agent Team**：本仓库对 `teammate` / `agent-team` / `agentTeam` / `TeamService` **零引用**，属全新引入；且 Team 模式下 `subagent` / `subagent_fork` 不再提供，与本仓库现有委派组合存在语义冲突。
4. **委派路由的统一结论（§5.5）**：`subagent` 路径是"**能选但无决策语义**"——白名单是唯一硬约束，模型拿到的只有 id / 名称 / 描述，分流规则只能靠 prompt 补；Team 路径**连路由字段都没有**。因此 ADR-0001 的适用边界应显式收窄为"**非 Team profile 的 `subagent` 委派**"。
5. **自研 preset 的假设没有实证（§3.6），但已裁决保留（2026-09-24）**：其立足点"minimal 首轮设定让 V4 Pro 更强"在仓库里没有测量支持（实验测的是锚定行为，n=9，判据是"不被扰动"），且 `v4-pro` 已不存在；真正不可替代的增量是 `phase-swap-bash` 二轮提权。preset 保留、**部署推迟到迁移收口**（§1.1、§7 第 11 步）；淘汰评估改为**事件触发复评**（§3.6），目标载体改为 0.1.7 的 bundle patch 形态（§3.5）。
6. **2026-09-24 grill 收口的结构**：计划拆为"升级计划 + 功能计划"（A1–A4 第一切片、Team 体验 B2–B4 第二切片，§4.3/§5.3）；`gates/manifest.json` 改**两阶段**口径（§1.1、§7）；V4 迁移接受不可逆、冷备与还原演练前移到**首次启动 0.1.7 之前**（Q15 确认，不再保留"先不迁"分支）；B1.5 升为 `tui-team` 建立前的硬前置。

### 1.1 已裁决（2026-09-23 / 24 / 25）

| 项 | 裁决 | 对计划的影响 |
| --- | --- | --- |
| 目标版本 | **精确锁定 `0.1.7-rc.1`**，不跟随 `next` 浮动 | 安装命令写死精确版本；`gates/manifest.json` 的 `hostVersion` 同步改为 `0.1.7-rc.1`；不引入跟随浮动 tag 的升级路径（目标漂移规则见 §7 第 0/3 步） |
| 升级窗口 | **tui-dev 与 headless 同步升级** | 两侧宿主机版本、profile 插件树、部署位 preset 一起到位；`subagent-model-selection-settings` 行分别保持 tui-dev `enabled: true` / headless `enabled: false`——同步的是**宿主版本**，不是合并两边口径。（工具数 30/29 是 0.1.5 时代口径；0.1.7 实测 tui-dev 35 / 隔离测量面开启 29、关闭 28，见票据 09/11） |
| 会话迁移 | **接受"迁移到 V4 后不可降级读"，且不再保留"先不迁"分支**（2026-09-24，Q15） | 迁移仍在本轮路径内；**C0 已回答"怎么迁"：无批量工具、无 dry-run；读开不落盘，只有写开才发布 v4 后继且源文件保留**。**冷备与还原演练前移到首次启动 0.1.7 之前**（§7 第 1 步），第 10 步只执行迁移并抽样验证 |
| Agent Team | **本轮开启；启用范围 = C 方案（profile 划分）**（2026-09-23 裁决） | Team 是 **profile 层能力**，不做 preset 变体（§5.2 纠正）。现 profile（tui-dev / headless）保持不带 Team，另建带 Team 的 profile（如 `tui-team`）。开启后该 profile 内 `subagent` / `subagent_fork` 被组合期禁用且无模型选择入口（§5.0 / §5.2）；使用场景与边界见 §5.4 |
| 自研 preset 去留 | **保留**（2026-09-24 裁决）：含 `phase-swap-bash` 二轮沙箱提权与 delegation 行 | §3.6 的证据缺口与淘汰框架转为**后续瘦身参考**，不作为本轮动作；淘汰评估改为**事件触发复评**（§3.6）；因 delegation 行随 preset 保留，Team profile 的 preset 组合行为必须实测（票 B1.5，升为硬前置） |
| preset 载体 | **真源留在仓库，目标载体改为 0.1.7 的 bundle patch 形态**（2026-09-24，Q11） | `presets/minimal-plus/` 仍是唯一真源；`@deepseek-ai/dsh-agent-preset` 行 + registry 是目标形态；`scripts/sync-agent-presets.sh` 改造为 profile 侧产物生成器并先补 `--dry-run`（§3.5、§7 第 11 步）。**该项是迁移第一工作项，B1.5 依赖它** |
| 子代理锚定 | **子代理豁免锚定（方案 A）**（2026-09-25 裁决） | `tool-bootstrap` / `phase-swap-bash` / `instruction-hint` 三处 `includeSubagents` 统一为 `false`：子代理（`delegationDepth > 0`）首轮即全量工具，主会话首轮锚定不变（flag 只分支子会话，见 `compaction-epoch.mjs`）；phase-swap 硬编码改为读配置并复核 swap 一致性（票据 14） |
| 计划边界 | **拆分**（2026-09-24，Q3/Q12）：升级计划 = 宿主升级 + 兼容迁移 + 部署收口；功能计划 = A1–A4 第一切片、Team 体验 B2–B4 第二切片 | Team 的兼容/部署面（B1.5、`tui-team` 建立、冒烟、per-profile expectations）留在本计划，"一起部署"不变；A/B 票面作为功能计划输入（§4.3、§5.3） |
| 前置取证 | **C0 已完成**（2026-09-24，Q5；临时前缀 + 独立 cache，真实 `~/.dsh` 只读、零写入） | 六项事实 + 附件/storages 判定已取证并归档（`evidence/02-preflight-*`）；P0 代码迁移与第 10 步解除阻塞，验收口径已按事实改写（§7 第 0 步、§8） |
| manifest 口径 | **两阶段**（2026-09-24，grill 修正） | `deployment.repo-matches-manifest` 不可豁免（`gates/run.mjs:463-472`）→ preset sha 随仓库更新为 `8cd01c68…`；`hostVersion`/`sessionFormatVersion` 在宿主切换那批改；`--allow-stale-deployment` 只豁免部署位滞后（`gates/run.mjs:474-483`、`README.md:195`），收口消除 |
| 收口定义 | **清单化 + 每阶段 stop/go**（2026-09-24，Q4） | 见 §7 收口清单；任一步失败停在原地、退回上一已验收状态，不带着失败往下走 |
| 闸门基线 | **expectations 增 profile/composition 维度；T3 在 0.1.7-rc.1 新采基线**（2026-09-24，Q8/Q13） | 禁止整文件再生成，增删工具附行级 diff + 理由；T3 旧基线留史不删，采不了显式记"新宿主未跑"，绝不跨宿主对比；"T3 口径改为为白名单背书"与新基线同批（§5.5、§6） |
| 升级节奏 | **立轻政策**（2026-09-24，Q14） | 日常宿主跟 `latest` stable；`next`/rc 只在临时前缀侦察；每个新 stable 按 C0 模板取证并在固定窗口内升级（§7 末尾） |
| 部署时机 | **推迟**（2026-09-24 裁决）：待 0.1.7-rc.1 迁移收口后与 Team profile **一起部署** | 在此之前**不动部署位**；仓库 ↔ 部署位 sha 的临时不一致按 `--allow-stale-deployment` 豁免（**只覆盖部署位滞后这一层**，见上"manifest 口径"行），收口时消除（§7 第 11 步） |

---

## 2. 版本链

| 版本 | 发布时间 (UTC) | release notes | 备注 |
| --- | --- | --- | --- |
| v0.1.5-rc.2 | — | — | **当前宿主基线** |
| v0.1.5-rc.3 | — | **无**（GitHub 无 release，仅 tag + npm `latest`） | 唯一无文档的一步 |
| v0.1.6-alpha.1 | 2026-09-15 | 有 | 能力扩展主版本 |
| v0.1.6-alpha.2 | 2026-09-17 | 有 | 插件管理页、文件改动卡片 |
| v0.1.7-alpha.1 | 2026-09-22 | 有 | 侧边栏会话管理、过程组折叠、V4 |
| v0.1.7-alpha.2 | 2026-09-22 | 有 | spill token 预算、滚动/预览修复 |
| v0.1.7-rc.1 | 2026-09-23 13:30 | 有 | 目标版本 |

rc.1 的 `Full Changelog` 基线是 `dsh-v0.1.5-rc.3`，因此"rc.2 → rc.1"整体包含上表 0.1.6-alpha.1 起的所有变更；rc.3 这一步无公开说明。

---

## 3. 新功能总览

### 3.1 会话与呈现（用户直接可感）

- 会话**置顶 / 归档 / 筛选 / 恢复**；归档运行中会话会先列出受影响的回合、子代理、任务与提醒，并要求"停止并归档"确认（0.1.7-alpha.1/rc.1）。
- **工作过程展示**四档：简洁 / 标准 / 详细 / 完全展开；连续思考与工具调用合并为**可折叠过程组**；工具生成时显示准备进度；代码块可复制、可换行，diff 与行号更清晰（0.1.7-alpha.1/alpha.2/rc.1）。
- 新增「工作过程展示」「性能与用量」「开发者工具」三项设置；开发者工具默认开启，关闭后仍显示第三方会话标签页（0.1.7-alpha.1）。
- 长会话的加载、滚动跟随、轮次跳转与历史分页显著改善；发送消息时的跳动减少（0.1.7-alpha.1/alpha.2）。
- 聊天内本地图片可查看/放大，图片链接悬停预览（0.1.7-rc.1）。

### 3.2 侧边栏工作面

- **子智能体会话可在侧边栏打开**（0.1.6-alpha.2），并在 0.1.7-rc.1 与终端、网页、提交计划并列。
- 侧边栏终端：多标签、可选 shell、刷新后保持连接（0.1.6-alpha.1/alpha.2）。
- Office 预览（Word/Excel/PPT，rc.1 起 Excel 支持工作表切换、公式查看）、PDF/图片统一缩放控件、系统应用打开文件（0.1.6-alpha.2 / 0.1.7-alpha.1/rc.1）。
- 文件改动卡片 + 逐文件对比审阅；默认左右分栏、同步滚动、悬停看单栏 diff（0.1.6-alpha.2 / 0.1.7-alpha.1）。
- **Agent Team 面板**：实时展示成员与任务，可从会话页头查看与切换成员（0.1.7-rc.1）。

### 3.3 插件、预设与设置

- 插件管理页：安装 / 配置 / 启停 / 卸载；可选官方源、npmmirror 镜像或自定义源（0.1.6-alpha.2 / 0.1.7-alpha.1/rc.1）。
- 插件组合包支持按序多个 patch、可声明"免重载"配置字段、导出配置 JSON Schema；新增 `--dump-config-schema`（0.1.7-alpha.1）。
- 插件可声明 locale 标题/描述与图标；安装与启动做**版本兼容性检查**，不兼容时说明原因并可按精确版本豁免（0.1.7-alpha.1/rc.1）。
- 插件依赖改为运行时解析，支持运行时卸载（0.1.6-alpha.2）。

### 3.4 模型、MCP 与外部能力

- 模型设置集中"添加模型提供商"入口，可查看模型 ID、保留草稿；Safari 下模型菜单可正常选择（0.1.7-alpha.1/rc.1）。
- MCP：资源发现/读取、URI 模板、协议协商与工具分页，升级官方 SDK v2（0.1.6-alpha.1 / 0.1.7-rc.1）。
- Headless：stdin 收任务、`--session-id` 续接、`--json` 逐行事件（0.1.6-alpha.1）。
- Remote：双向流 + 二进制传输；工作区文件读取统一 `readBytes`（0.1.7-alpha.1/rc.1）。
- 实验性：Browser Use（Playwright / Chrome DevTools / Stagehand）、Computer Use（Cua Driver）、Auto review 模式、语音转写（0.1.6-alpha.1 / 0.1.7-rc.1）。
- Office 任务默认使用随包 LibreOffice（0.1.7-rc.1）。

### 3.5 上游 Agent 预设的形态演进（0.1.5 → 0.1.7）

- **载体变化**：0.1.5-rc.2 的 preset 是**目录**（`@deepseek-ai/dsh-agent-presets/presets/<id>/{agent.cordis.yml,preset.yml}`）；0.1.7-rc.1 改为 **bundle 内的 patch 文件**（`@deepseek-ai/dsh-web-app/presets/{minimal,standard,ptc,cordis}.patch.yml`），每个文件插入一行 `@deepseek-ai/dsh-agent-preset`，内容在 `config.plugins` 列表里；注册表行是 `@deepseek-ai/dsh-agent-preset-registry`（`default: standard`）。
- **可覆盖性**：patch 头注释明确"Web 编辑器保存的编辑会**按 id 覆盖**该行的 `config.plugins`"——preset 内容成为可被 profile 层按 id 覆盖的数据。
- **`minimal` 的内容几乎没变**：仍是"persona（`You are a helpful software engineer assistant.` + `complete: true` + `includeRuntimeContext: false`）+ persistent-shell 组（bash / pwsh 按平台门控）"，**不含** delegation / fs / skills / compaction。细节差异只有两处：bash 描述里 "You don't have access to the internet via this tool." 换成 "Network access depends on the task environment. Prefer configured mirrors/proxies when they are available."（**本仓库已于 2026-09-24 对齐，含删去 darwin 无关的 apt/pip 镜像行**）；pwsh 双栈（`terminal-pwsh` 带 `shellDialect: pwsh`）**本轮不处理**——本仓库 win32 走 `custom-bash.mjs`，双栈改造不在范围内。
- **对照 `standard`**：含 `delegation` 组的才是 standard，且其 `tool-subagent` 行**自带 `modelSelectionSettings: true`**、`tool-subagent-fork` 为 `backgroundMode: continuable`；`tool-ralph` 与 `tool-plugin-manager` 均 `disabled: true`；工作流执行器已更名为 `workflow-ptc`。
- **对本仓库的含义**：`minimal-plus` 相对上游 `minimal` 的增量是 5 个自研插件 + delegation 行；若跟随上游 minimal，则**不再有 `subagent` 委派能力**（那属于 standard 的增量）。在 0.1.7 模型下，自研 preset 的合理形态是"作为 bundle patch 插入自己的 `@deepseek-ai/dsh-agent-preset` 行"，而不是维护目录副本。
- **已裁决（2026-09-24，Q11）**：采用上述形态。`presets/minimal-plus/` 保留为唯一真源；`scripts/sync-agent-presets.sh` 从"写 `~/.dsh/.agent-presets/`"改为生成 profile 侧 bundle 产物，并先补 `--dry-run`（当前无 dry-run，直接写并 `rm -rf vendor`）。**C0 ④ 已确认 0.1.7 不再加载旧目录形态，无过渡分支**。该改造是迁移第一工作项，B1.5 依赖它。

### 3.6 自研 preset 的证据缺口与淘汰判断（讨论稿，2026-09-24）

**原始假设**：`minimal` 的首轮设定（只暴露 bash + str_replace_editor 的锚定对、persona `complete: true` + `includeRuntimeContext: false`、无压缩）能让当时的 DeepSeek V4 Pro 发挥更强能力。本仓库的自研 preset（`minimal-plus`，前身 `liangshen`）建立在该假设之上。

**证据缺口——结论：仓库内没有支持该假设的实证**

| 检项 | 实情 |
| --- | --- |
| 相关实验测什么 | `docs/minimal-plus-preset-design.md` 的 C/E 组与 `experiments/m4/*` 测的是**首轮锚定率**（首轮是否直接发起工具调用）、注入事件清单、二轮工具数——行为指标，不是能力 |
| 样本与判据 | n=9/组，判据为"E 与 C 差 ≤1 跑为过"；文档自述"n=9 下组间 ±1 跑的差异不可解释为 preset 效果" |
| 有无能力对比 | 无"minimal 组合 vs 全量工具面"的能力 A/B；M4 的模型差异只是代际替换（`opencode-go/deepseek-v4-flash` → `commandcode/deepseek/deepseek-v4.1-flash`），用于基线可比性 |
| 假设中的模型 | 全仓库 grep `v4-pro` **0 命中**；现行路线为 `deepseek-v4.1-flash` / `deepseek-flash`，无 pro 版本 → 该假设已失去验证对象 |

→ 该设计是**假设驱动 + 行为基线可复现**，不是"能力更强"的测量结论。

**上游为什么保留 `minimal`**（上游 0.1.5 `presets/minimal/agent.cordis.yml` 头注释，逐字）：

> a **fixed-prompt, single-tool** coding-agent composition. The persona is the complete system prompt, so global identity, Web orientation, tool guidance, and later assembly listeners cannot add prompt text. Runtime context snapshots are suppressed for this preset, and the model receives only the persistent shell (`bash` on POSIX, `pwsh` on win32). **Context compaction is absent.**

推论（非原文）：定位是**受控基线档**——把系统提示、工具面、运行时上下文、压缩都压到最小，用于对照与变量隔离；佐证是 0.1.7 里它**不是默认**（注册表 `default: standard`，`minimal` 的 `order: 3`）。同一份内容，本仓库当"效果基底"用，上游当"极简可对照档"用——用途假设不同。

**淘汰判断框架**

本仓库相对上游 `minimal` 的增量，以及退役各自会丢什么：

| 增量 | 性质 | 退役影响 |
| --- | --- | --- |
| `tool-bootstrap`（首轮锚定对 + promotion） | **复刻上游行为**（其语义就是 minimal 的"单工具 + 完整 persona"） | 走 upstream minimal 时几乎无损失 |
| `instruction-hint`、`skill-search` | 注入时机与工具面取舍 | 二轮提示与技能发现方式改变 |
| `custom-bash` | win32 专用 | 仅影响 Windows 路径（本轮不涉及） |
| `phase-swap-bash`（二轮沙箱 bash 提权） | **唯一不可替代的新增行为** | 二轮起 bash 失去 `sandbox_permissions` 提权，退化为常驻 PTY |
| delegation 行（`tool-subagent` + `modelSelectionSettings`） | 能力行 | Team profile 下本就被组合期禁用（§5.0）；非 Team profile 会失去 `subagent` |

建议裁决顺序：**先定"二轮提权要不要留"**，再决定 preset 是瘦身为"minimal + 提权"（保留 `phase-swap-bash` 与 delegation，其余交还上游），还是整套退役、在 Team profile 上直接跑上游 `minimal` / `standard`。后一条会把委派能力集中在 Team profile 一处（与 §1.1 的 C 方案叠加，注意 §5.4 的互斥结论）。

**裁决结果（2026-09-24）：自研 preset 保留**——`phase-swap-bash`（二轮沙箱提权）继续留着。上面的证据缺口表与淘汰框架转为**后续瘦身时的参考**，不作为本轮动作；相应地，Team profile 里 preset 与 Team bundle 的叠加行为必须实测（票 B1.5 因此重新启用，并在同日 grill 中升为硬前置）。

**复评触发（2026-09-24 裁决：不做定时复评，只认事件）**——命中任一条即重启淘汰/瘦身框架：① 上游 minimal/standard 出现能替代 `phase-swap-bash` 二轮提权的路径；② B1.5 证明 delegation 行在 Team profile 下是死行（组合期禁用且 preset 挂不回来）；③ 非 Team profile 的实测/T3 证据显示 `subagent` 的模型选择从未被使用（实践中始终"不选、继承父路由"）。

**已完成的对齐（2026-09-24）**：`presets/minimal-plus/agent.cordis.yml` 的 bash 工具描述已对齐上游 0.1.7 `minimal` 并逐行校验一致。**新 sha `8cd01c685032eda95f68ded9b0796f72d0578e9d22a2274fe50aad8435dcc47b`**，而 `gates/manifest.json` 仍记 `318c4884…` → 需在裁决后一并执行部署位同步（`scripts/sync-agent-presets.sh`，写真实部署位需批准）与 manifest 更新。

**子代理锚定修正（2026-09-25）**：`includeSubagents` 三处统一为 `false`（方案 A，票据 14）——子代理不再走首轮锚定、首轮即全量工具；主会话首轮锚定与上述对齐口径保持不变（flag 只分支 `delegationDepth > 0`，见 `compaction-epoch.mjs`）。

---

## 4. 专题 A：subagent 会话的显示与折叠

### 4.1 上游 0.1.7 的形状（事实，来自 rc.1 标签下 `docs/subsystems/subagent.zh.md`）

**数据面**（决定显示层能拿到什么）：

- `subagentCatalog` 投影暴露 `SubagentCatalogEntry[]`：按父会话事件排序，含子级 id、创建时间、模式（`one-shot` / `continuable` / `unknown`）与依模式确定的标签；**fork 继承的目录事实不在其中**，历史子会话 descriptor 不可用时为 `mode: 'unknown'`（保留身份可发现，但不授予继续执行能力）。
- `ctx.subagents.listChildren(parentSessionId)` 读父会话的直接子目录（**不加载、不恢复子 Agent**）；`listDescendants(rootSessionId)` 按 stable pre-order 列出完整后代树，含 `parentId` 与 `depth`。
- descriptor 用 last-wins 折叠：子代理自己的 `subagent/descriptor` 覆盖 fork seed 中祖先的 descriptor。
- 生命周期观测：`subagent/start` / `subagent/end` 成对，作用域按委派父级过滤；可继续子代理每次冷恢复是**一个带新 `runId` 的新纪元**。
- 驻留状态由继续执行管理器派生：`running`（有活跃 driver/maintenance）、`waiting`（无活跃工作但 inbox 非空或仍有未 dispose 的子级）、`settled`（可 settle 并释放 handle）；**模型侧 `list_agents` 只报 `running` / `inactive`，且不承诺 `send_message` 会成功**。
- 子代理 settle 时，管理器向直接 parent 投递一条来源为 `subagent-settled`（`form: 'notice'`）的收尾通知，携带最终 assistant 的非空文本块；无剩余文本时是 `It left no closing message.`。它与 `agent-message` 是不同的 source kind，transcript 不应把运行时记账当作子代理自己说的话。

**呈现面**（上游 Web/桌面做到什么）：

- 子会话作为**一等会话**在侧边栏打开，与主会话并列（0.1.6-alpha.2 起）；
- 连续思考与工具调用合并为**可折叠过程组**，四档展示（简洁/标准/详细/完全展开），运行中也可完全展开（0.1.7-alpha.1/rc.1）；
- 子代理与 Team **统一空闲/就绪状态显示**（0.1.7-alpha.1）；
- Team 成员切换入口在会话页头（0.1.7-rc.1）。

### 4.2 本仓库现状（已读到的实现）

| 位置 | 现状 | 与上游差距 |
| --- | --- | --- |
| `lib/app.ts:2179-2271` | `setSubagents()` + `renderSubagentsLine()`：折叠时一行摘要（`◉ subagents ×N · <最新 label>`），`Ctrl+O`（`detailsExpanded`）展开为每子代理一行，上限 `SUBAGENTS_EXPAND_CAP`，超出显示 `… N earlier` | 只有"运行中"这一种信息；每个子代理仅 `label/id` + `(bg)`，无状态细分、无进度/耗时、无会话入口 |
| `lib/index.ts:3681-3701` | `refreshSubagents()`：`services.subagents.listChildren(agent.id)` → `filter(c => c.activity === 'running')` → `{id, mode, label}`；事件触发（`tool/call`、`tool/result`、`turn/start`、`turn/end`、`goal/*`），带 generation 防陈旧回填 | 只消费 `activity` 字段；未用 `phase`/`error`，未区分 `waiting`/`settled` |
| `lib/index.ts:3787-3800` | 订阅 `agent/assistant-stream`，但仅当 `payload.agent.id === agent.id`（root）才驱动 transcript；注释明确"subagent streams arrive too" | **子代理的实时文本被显式丢弃**，所以无法看到子代理在写什么 |
| 全仓库 | `teammate` / `agent-team` / `agentTeam` / `TeamService` 零命中 | Team 能力未接入 |
| `presets/minimal-plus/agent.cordis.yml:163-193` | `delegation` 组：`tool-subagent`（`provider: spawn`、`backgroundMode: continuable`、`modelSelectionSettings: true`），codex / claude-code 行 disabled | 与 0.1.7 的 Team 工具面（`spawn_teammate`）尚无交集 |

### 4.3 迁移与对齐计划（分票）

> **2026-09-24 裁决（Q3/Q12）**：A1–A4 **整体移入功能计划（第一切片）**，不属于本升级计划的收口范围；下列票面保留为功能计划的输入，本计划只保留升级兼容性必须的改动。
> 每票的"验收"是闸门口径建议，具体命令沿用 `gates/` 既有分层（T0/T1/T2/T3）。

- **票 A1｜目录与状态对齐**
  用 `SubagentCatalogEntry` 的完整字段替换当前的 `mode` 猜测：区分 `one-shot` / `continuable` / `unknown`，展示 `phase`（`provisioning` / `active` / `failed`）与 `error`，把 `waiting` 与 `running` 分别表达（上游语义：`waiting` = inbox 非空但无活跃工作）。
  *验收*：无 LLM 冒烟里构造 running / waiting / failed / unknown 四种目录条目，气氛行与展开态逐条断言；不得把 `unknown` 渲染成可继续。

- **票 A2｜子会话只读视图**
  新增 `/agents`（或等价入口）列出直接子代理并打开其 transcript；实现上复用 `app.model` 但**不得**污染 root transcript（`lib/index.ts:3787` 的 root 过滤是当前唯一保护，改造时必须保留等价的 agent 归属判定）。
  *验收*：root 与子会话切换后，root transcript 无重复、无串流；`/rewind`（`plugins/rewind-dsh.ts`）仍只作用于 root；`gates/composition/render-real.test.mjs` 保持绿。

- **票 A3｜过程组折叠**
  对齐上游四档语义（简洁/标准/详细/完全展开），把现有 `Ctrl+O` 的"展开/折叠"扩展为可循环档位；需检查与 `detailsExpanded` 既有语义（subagents/jobs/tool card 共用）的兼容，避免一处改档影响全部。
  *验收*：折叠状态机单测覆盖四档循环与 resize；`lib/app.test.ts` 现有断言要么保持、要么显式更新（不得静默改口径）。

- **票 A4｜settle 通知呈现**
  识别 `subagent-settled`（`form: 'notice'`）来源的通知，渲染为"子代理已结束"的独立行，而不是当作子代理说的正文；无正文时显示 `It left no closing message.` 的等价文案。
  *验收*：构造有/无收尾文本两种 settle，断言二者可区分。

---

## 5. 专题 B：Agent Team 引入与使用

### 5.0 B1 取证结果（2026-09-23，已完成）

**方法**：临时前缀安装 `@deepseek-ai/dsh@0.1.7-rc.1`（`/tmp/dsh-b1-20260923-224232`，独立 npm cache；未触碰真实 `~/.dsh`、未改任何 profile 或部署位），symlink 复用依赖后在两个最小 profile（`b1` = 仅 `dsh-base`；`b1team` = `dsh-base` + `dsh-experimental-agent-team-profile`）上跑 `--dump-config` 对照。

| 项 | 取证结果 | 证据 |
| --- | --- | --- |
| 是否随安装默认启用 | **否**。`dsh-app-boot` 把该组合包列入 `OPTIONAL_BUNDLES`（另一项是语音输入包），源码注释：*selected by no shipped template, and offered switched off by the plugin manager*；`PROFILE_TEMPLATES` 只有 `acp` / `web` / `headless` / `sdk` / `sdk-minimal`，均不含 Team | 安装产物 `dsh-app-boot/lib/index.js` |
| 启用方式 | 插件页开关，或 `dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-agent-team-profile` | bundle README.zh.md；CLI `--help` |
| 组合增量 | team profile 比 base 多 3 个 loader：`agent-team`、`tool-agent-team`、`ui-agent-team`；两棵树 id 无重复（base 92 / team 95，递归计数均为 1），两份 dump 均 exit 0 | `--dump-config` 对照 |
| 被禁用的行 | `tool-subagent-control`、`tool-subagent-list-agents`、`tool-subagent`、`tool-subagent-fork` **四行全部 `disabled: true`**（组合期禁用，不是运行期拒绝）。Workflow 仍可用 base 的 `spawn` provider 创建一次性子代理 | 同上 + bundle `cordis.patch.yml` |
| Team 配置 | `maxMembers: 8`、`maxTasks: 256`、`maxPendingMessagesPerMember: 64`、`maxMessageBytes: 65536`、`disposalTimeoutMs: 5000`；`tool-agent-team` 为 `freshProvider: spawn` / `forkProvider: fork` | dump 的 `agent-team` 块 |
| 队友上限口径 | **服务默认 16**（`DEFAULT_MAX_MEMBERS = 16`），但**官方组合包 patch 显式覆盖为 8**。release notes 的"8 → 16"说的是服务默认值；走该 bundle 开箱即得 8，要 16 需在用户层覆盖配置 | `agent-team/src/index.ts` vs `agent-team-profile/cordis.patch.yml` |
| Team 工具面 | `spawn_teammate`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`、`team_task_create`、`team_task_list`、`team_task_get`、`team_task_update` 共 9 个，注册在确切 Agent 作用域（随 `agent/created` 安装、`agent/disposed` 卸载），另加 `team:policy` 系统提示段 | `tool-agent-team/src/index.ts` |
| 模型路由 | `spawn_teammate` 参数仅 `name` / `description` / `prompt` / `context(fresh\|fork)`，**没有 provider / model / reasoning_effort**；路由由 profile 的 `freshProvider` / `forkProvider` 决定 | 同上 |
| 上游自陈的限制 | 所有 teammate **共享同一 checkout**，无 worktree 隔离、无文件系统锁；Team 面板只读且无 mailbox timeline；**"预设内的子代理控件"——预设作用域仍可挂载 continuable Subagent 控件，顶层组合包不会替换这些注册** | bundle / UI README.zh.md |

**工具面冒烟（2026-09-23，headless 真实组合，见 `evidence/02-tool-surface-smoke.md`）**：同一份合成 agent preset（含 `tool-subagent` 行）分别挂在「无 Team」与「有 Team」两个 profile 上，用探针插件读 `ctx.tools.schemas(agent)`：

| 工具 | 对照 | Team 开启 |
| --- | --- | --- |
| 可见工具总数 | 24 | 28 |
| `subagent` / `subagent_fork` | ✅ / ✅ | **❌ / ❌** |
| `spawn_teammate` / `wait_agent` / `team_task_*` | ❌ | ✅ |
| `list_agents` / `send_message` / `interrupt_agent` | ✅（base 全局 control） | ✅（Team 作用域替代版） |

→ **当前 profile 组合下，Team 开启后 `subagent` 不并存**；`dsh-tool-subagent` 源码无 Team 守卫，这是 bundle patch 四条 `disabled: true` 的组合层结果。

**仍未定论（2026-09-24 更新：因自研 preset 保留，重新成为 Team profile 的必测项，见 §5.3 票 B1.5）**：preset 层能否把 `subagent` 重新挂回来。本轮 harness 测不到，原因是预设绑定走 Session 的 `agentPreset` 投影，而 headless 创建的会话不带 preset；强行绑定被拒（`ctx.agentPresets.select()` → `This session has already started`）。哨兵行（`@deepseek-ai/dsh-tool-ask-user`）在两臂都未出现，证明合成 preset 自始未生效。预设选择是 **app 侧职责**，因此这条只能在真实的 preset 选择路径上收口。**该票只用于实测"实际行为"，不作为"设计并存"的依据**——上游该 bundle 的设计就是替换普通 subagent 委派。

**模型选择机制的存活情况（静态）**：`@deepseek-ai/dsh-tool-subagent@0.1.7-rc.1` 仍保留 `./model-selection-settings` 导出、`modelSelectionSettings` 配置、`list_subagent_models` 与 `subagent/model-selection-policy` 事件——机制未移除；但在 Team 组合下 `subagent` 工具不存在，机制**无处附着**。

### 5.1 上游形状（事实，来自 rc.1 标签下 `docs/subsystems/agent-team.zh.md`）

实验性隐式 Root Team：`TeamId` 就是 Root `SessionId`；teammate 的 Session id 是持久身份，`name` 是不可变的模型/UI 标签。

`ctx.agentTeams`（`TeamService`）公开方法：

| 方法 | 语义 |
| --- | --- |
| `membership(agent)` | 解析一个确切在线 Agent 的 Team 角色（root / Team 身份 / 角色 / 模型可见名） |
| `listMembers(agent)` | 列出该成员可见的 roster（Lead + teammates，按创建顺序） |
| `spawnTeammate(caller, request)` | 由 Lead 创建**具名、可继续**的直接子代理；request 含 name / description / prompt / context 模式 / provider / 取消 |
| `sendMessage(caller, request)` | 先持久入队，再尝试立即投递；**每条消息都尝试 Steer 投递**，调用方不能选择调度模式 |
| `createTask` / `getTask` / `listTasks` / `updateTask` | 共享任务 DAG；`revision` 是 compare-and-set，`blockedBy` 必须无环，`writeScopes` 是**提示性**路径前缀而非锁 |
| `waitForChange(caller, timeoutMs, signal)` | 等待下一次 Team 域或成员状态变化（10s–1h） |
| `interrupt(caller, targetName)` | 中断一个在线 teammate 的当前轮次，**不清空其 pending inbox** |
| `tryMembership(agent)` | 不抛错的成员解析，供作用域工具安装与观察者使用 |

持久形状：`TeamMemberSnapshot`（从 `provisioning` 到 `active` / `failed` 终态，`running`/`inactive` 另行派生）、`TeamMessageSnapshot`（sender / target / content；target 侧以 `TeamMessageSource` 去重）、`TeamTaskSnapshot`（每次变更 `revision` +1）。

Web 投影：Lead Session 通过 `SessionProjectionMap.agentTeam` 发布 `TeamProjection { members, tasks, failure? }`；成员活动来自 Session 状态，模型标签来自各成员的 `modelSelection` 投影。`failure` 报告第一条被拒绝的持久记录，此时 members/tasks 停在上一个有效状态。

权限模型（使用时的硬约束）：投递权限来自**确切在线 sender**——parent→child 要求目标 `SessionHeader.parentSession` 指向 sender；child→parent 要求 sender 的驻留 Activation 指向目标；**sibling、跨多于一条边的祖先、自我寻址、陈旧 Agent 对象、一次性 child 一律拒绝**。

release notes 侧的相关条目：
- 0.1.6-alpha.1：实验 Team 模式统一 `spawn_teammate`，**关闭 `subagent` 与 `subagent_fork`**，队友创建上限 8 → 16；
- 0.1.7-alpha.1：Team 工具**统一以成员名称作为操作目标**；Team 任务看板改**只读**（任务由 Agent 通过工具创建/更新）；
- 0.1.7-alpha.2：成员初始任务增加"查找队友 / 联系 Lead"指引，明确按成员名发消息；
- 0.1.7-rc.1：Team 面板实时展示成员与任务，可从会话页头查看与切换成员；原子代理创建工具不再提供。

### 5.2 与本仓库的结合点

- 本 TUI 是"terminal front door"，Team 的显示面（roster / 任务板 / 成员切换）天然落在 `lib/app.ts` 的 ambient rows 与 overlay（对齐现有 `ApprovalCard` / 提问面板的实现方式）。注意上游的 Team UI（`dsh-experimental-client-ui-agent-team`）是 **Web 客户端 slot**，TUI 侧需自建；可用的读路径是进程内服务 `ctx.agentTeams`（`listMembers` / `listTasks`）与 root Session 的 `agentTeam` 投影。
- **纠正（2026-09-23）：不要把 Team 做成 preset（agent 作用域）变体。** Team 是 **profile 层能力**——官方启用路径全部是 profile 级（插件页开关 / `dsh plugin --profile <name> add …`）；其 patch 位于 bundle 层且语义为**替换**（注释原文："Apply after dsh-base so these replacements keep direct delegation and coordination on the Team tools"）；它还插入单例服务 `ctx.agentTeams`、客户端 UI slot 与 `ctx.root.sessionProjections.register(…)` 这类 root 级注册。而 `dsh-agent-preset` 的作用域契约是"**Agent 的子插件列表**"，这些都不是 per-agent 关注点。上一版计划里的"preset 变体"是把层混为一谈，已作废。
- **与 ADR-0001（采用官方子代理模型选择、弃自研路由）的关系**：实测（§5.0）Team 开启后 `subagent` / `subagent_fork` 在 profile 层被**组合期禁用**，二者**不并存**；并且 `SpawnTeammateRequest`（`{name, description, prompt, context, provider, signal}`）与 `spawn_teammate` 的工具 schema 都**没有 LLM 模型字段**（`provider` 是 subagent 传输层名，如 `spawn` / `fork`）。因此在 Team 会话里，模型选择不是"被禁用"，而是**无处表达**；teammate 的 LLM 路由只能继承或由 provider 默认决定（继承谁待实跑确认）。路由层面的完整对照与统一结论见 **§5.5**。

### 5.3 引入步骤（分票，先验证后接线）

> Team 已裁决**本轮开启**，启用范围为 **C 方案：profile 划分**（见 §1.1）——不在 preset 层做变体（理由见 §5.2）。B1 取证已完成；**B1.5 升为 `tui-team` 建立前的硬前置**（2026-09-24 因 preset 保留而重新启用 + 同日 grill Q7 修正，覆盖本段旧注"低优先级探索、不作为方案依赖"）。**留在本计划**：B1.5、`tui-team` 建立、冒烟、per-profile expectations（"一起部署"因此成立）；**移入功能计划第二切片**：B2–B4 的体验与使用面。

- **票 B1｜组合期确认（不写业务代码）— ✅ 已完成（2026-09-23）**
  结论见 §5.0：默认不启用；显式加入 bundle 后 4 行 subagent 组合期禁用、3 行 Team 组件插入、id 无重复、`--dump-config` exit 0。
  *证据留存*：**已归档** → `docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/{01-b1-conclusions.md,01-dump-base.yml,01-dump-team.yml}`。

- **票 B1.5｜Team profile 的 preset 叠加实测（硬前置：`tui-team` 建立之前必须绿，2026-09-24）**
  背景：自研 preset **保留**，其 `delegation/tool-subagent` 行会随之下沉到 Team profile（teammate 还会继承 Lead 的 preset，见 §5.5）。上游 bundle README 称"预设作用域挂载的 continuable Subagent 控件不会被顶层组合包替换"，这与 §5.0 实测的 **profile 层禁用**可能同时成立——必须实测 Team profile 的实际工具面，不能推断。
  判据：① 先在 preset 里放哨兵行（如 `@deepseek-ai/dsh-tool-ask-user` → `ask_user_question`）证明 preset 真正生效；② 再看 `subagent` 是否与 `spawn_teammate` 并存，以及 `list_subagent_models` 是否出现。
  承载：优先扩 `scripts/tui-pty-smoke.mjs`（真 PTY + stub provider，`PROFILE`/`PRESET` 可配，断言输出里出现 preset 名）到 `tui-team` profile；`gates/stub/harness.mjs` 也能在 `agents.create({setup})` 里挂 preset，可作为进程内对照。两者当前都不挂 Team bundle，接线属本票新增。headless 合成路径走不通：`ctx.agentPresets.select()` 对已开始的会话返回 `This session has already started`。
  *前置*：§6「预设迁移」票（目录预设 → `dsh-agent-preset` 的 `plugins:` 声明），即 §3.5 的载体改造。
  *不可测回退（2026-09-24 裁决）*：若 `tui-team` 建立前无法取得可信实测，则 `tui-team` **不让自研 preset 下沉**（teammates 只用 Team 原生工具），票面写"未测"而不写"推断为并存"。
  *注意*：本票只回答"**实际行为是什么**"；即使结果是并存，也不等于应采用——两个语义重叠的委派工具需要单独裁决。

- **票 B2｜显示层最小集**（2026-09-24：移入功能计划第二切片）
  成员行（name / role / phase）+ 只读任务板（subject / status / ownerName / ready / `writeScopeWarnings`）+ 成员会话切换（复用票 A2 的只读视图）。
  *验收*：无 LLM 冒烟用假投影渲染 members/tasks，含 `failure` 分支；成员切换不污染 root transcript。

- **票 B3｜使用规范文档**（2026-09-24：移入功能计划第二切片）
  写清：按**成员名**寻址（不再是 id）；Lead 与 teammate 的初始任务写法；`writeScopes` 只是提示不是锁，冲突要靠协调；mailbox 的 queued-minus-delivered 语义（target 未记录前消息一直保留）。
  *验收*：文档与 `docs/subsystems/agent-team.zh.md` 逐条对得上，不引入自造语义。

- **票 B4｜风险与不变量**（2026-09-24：移入功能计划第二切片）
  16 队友上限、默认委派深度、`interrupt` 保留 inbox、跨 Team 不越权、`failure` 状态下 UI 不得显示为健康。另需评估：Team 成员会显著放大会话数量，与现有 `sessions` 目录/闸门隔离面（`gates/run.mjs` 的严格区）是否冲突。

### 5.4 使用场景与边界（讨论稿，2026-09-23）

判据来自上游工具自带的 `team:policy` 提示词（`tool-agent-team/src/index.ts` 的 `POLICY` 常量）、Agent Teams 子系统文档，以及 bundle README 的限制条款。

**适配的场景**

1. **并行只读勘察**：多个 teammate 分头搜代码、查资料、读大范围文件，只回报结论。写冲突为零，是 Team 最稳的用法。
2. **分区并行实施**：按**不相交的写范围**拆任务，用共享任务 DAG 表达依赖，Lead 负责最终 diff 审阅与跑测试。上游 policy 明确要求"把写工作拆成不相交范围、在任务上记录预期写范围、用依赖排序"。
3. **独立验证 / 交叉审查**：一个 teammate 实施、另一个复核，或多人分视角审阅。
4. **长任务并行等待**：多处长构建 / 长测试并行，Lead 用 `wait_agent` 等待。注意 `wait_agent` **只观察调用之后的变更、绝不唤醒成员**，且在没有其他成员 `running` / `provisioning` 时立即返回 `noProgress`。
5. **多方案并行探索**：同一问题几个 teammate 各走一条路，Lead 汇总取舍。

**不适合的场景（均有明确依据）**

- **写密集且互相依赖**：所有 teammate **共享同一 checkout**，无 worktree 隔离、无文件系统锁；`writeScopes` 是**提示性**前缀而非锁。policy 还特别说明 bash / 格式化器 / 代码生成器**不受文件版本守卫保护**，必须显式协调。
- **需要按用途 / 成本路由模型**：Team 工具面没有模型字段（§5.2），会失去 ADR-0001 的基线。
- **需要逐字观察每个成员过程**：上游面板只读、**无 mailbox timeline**，且不能 spawn / rename / delete / interrupt；TUI 要看得自建（票 B2）。
- **短小任务**：`spawn_teammate` 的固定开销 + 成员上限不划算；policy 也要求"只在用户明确要求使用 Agent Teams 时创建 teammate"。
- **跨 Team 协作**：任务板与 roster 按 Team（root Session）隔离。

**规模与限制（实测值）**

- `maxMembers: 8`（组合包覆盖值；服务默认 16）、`maxTasks: 256`、`maxPendingMessagesPerMember: 64`、`maxMessageBytes: 65536`、`disposalTimeoutMs: 5000`。
- 工具面 9 个：`spawn_teammate`（仅 Lead）、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`（仅 Lead）、`team_task_create/get/list/update`（`revision` CAS）。
- 成员状态：`provisioning` → `active` / `failed`；运行态另派生 `running` / `inactive`；**`inactive` 不代表任务完成**。
- **待实测**：成员间 `send_message` 的可达边界。policy 与 teammate 初始提示都指示"按成员名给其他 teammate 发消息"，但 `docs/subsystems/subagent.zh.md` 描述的"仅直接父子边"限制属于 `SubagentRuntime.sendMessage`；Team mailbox 是其上的独立实现，peer 是否直发以实跑为准。

**对本仓库的含义（与 C 方案的联动）**

- 选 C 后 TUI 需同时服务两种形态：非 Team profile（`subagent` + `modelSelectionSettings`）与 Team profile（`spawn_teammate` 等）。显示层按工具面存在性分支，`gates/expectations.json` 的工具面快照也需按 profile 区分（2026-09-24 裁决：增 profile/composition 维度——现存结构是 per-preset、只有 `minimal-plus`；禁止整文件再生成，增删工具附行级 diff + 理由，见 §6）。
- TUI 的 Team 读路径：进程内 `ctx.agentTeams.listMembers/listTasks`，或 root Session 的 `agentTeam` 投影（上游 Web 面板即读投影）；这是票 B2 的实现接口。

### 5.5 委派路由的统一结论（讨论稿，2026-09-23）

把「`subagent` 的 LLM 路由选择」与「Team 的 teammate 无模型字段」放在一起看，结论一致：**dsh 提供"能选"，不提供"知道该选谁"；在 Team 形态下连"能选"都不存在。**

**两条委派路径的路由能力对照**

| 维度 | `subagent`（非 Team profile） | `spawn_teammate`（Team profile） |
| --- | --- | --- |
| 工具 schema 的路由字段 | 有：`provider` / `model` / `reasoning_effort`（`modelSelectionSettings: true` 时） | **无**（仅 `name` / `description` / `prompt` / `context`） |
| 服务层请求 | 三字段可选并合并进 agentOptions | `SpawnTeammateRequest` = `{name, description, prompt, context, provider, signal}`，其中 `provider` 是**传输层**（spawn/fork）而非 LLM provider |
| 硬约束 | `allowedModels` 白名单，集合外创建前拒绝 | 无路由概念；由 profile 的 `freshProvider` / `forkProvider` 与 provider 默认决定 |
| 模型可得的决策信息 | `list_subagent_models` 三级返回（provider → model → effort），**已按白名单过滤**；仅 id / name / description | 无 |
| 默认行为 | 省略三字段 = 继承父会话路由（或工具实例默认）；省略 effort = 所选模型的默认 effort | 继承或 provider 决定（继承谁待实跑确认） |
| 附带约束 | 换模型会破坏 fork 前缀的 provider 侧复用（工具描述明写） | 无 |

**由此确立的三条事实**

1. **`modelSelectionSettings` 是"白名单 + 可选覆盖"，不是路由策略引擎**：机制层不携带成本、时延、能力分级；"选得对"只能靠 prompt 语义与 catalog 文本。`reasoning_effort` 是三个字段里**唯一带真实语义**的（effort 的 name / description / 默认标记）。
2. **信息获取成本不低**：拿全决策信息要 3 次工具往返（provider → model → effort）；而本仓库 preset 把 `list_subagent_models` 压在 promotion 之后才可见（首轮只有 `bash` + `str_replace_editor`）。实践中大概率退化为"不选、继承父路由"。
3. **C 方案下两条路径互斥**：Team profile 里路由**无处表达**，非 Team profile 里才有白名单内的有限选择。ADR-0001 的适用边界应显式限定为"**非 Team profile 的 `subagent` 委派**"，并写进该 ADR 与 `docs/subagent-model-selection.md`。

**D 实跑补充（2026-09-23，探针直调 `ctx.agentTeams.spawnTeammate()`）**

- **teammate 路由 = 继承 Lead，且无 per-teammate 覆盖入口。** 三层证据：① `spawn_teammate` 的 schema 与 `SpawnTeammateRequest` 都无路由字段；② Team 的 `roster.spawn` 调 `subagents.startContinuable({ childId, provider, label, request: { prompt, parent }, signal })`，**不传 `agentOptions`**；③ `dsh-subagent` 的 `resolveChildAgentOptions(parent, requested, childDepth)` 文档注释明写 *"the delegating parent **whose route the child inherits**"*。实测成员视图 `model` 字段与 Lead 部署默认一致（`deepseek-flash`）。
- **teammate 继承 Lead 的 preset**（此前推测作废）：`childSessionMeta()` 取 `parent.ctx.get("agentPresets")?.composedPreset(parent.ctx)` 写入子会话 header 的 `agentPreset`，`applyChildComposition()` 再调 `composeFrom(childCtx, parent.ctx)` 让子代理加入父组合。实测（Lead 无 preset 的 headless 场景）子会话 header `agentPreset=undefined`、**工具面与 Lead 完全相同（28 = 28）**；Lead 有 preset 时该 preset 会随之下沉到 teammate。
- **工具"可见不可用"**：teammate 的工具面里**有** `spawn_teammate`，但实际调用被拒（`only the Team Lead can create teammates`）。→ TUI 显示层**不能**用"工具是否存在"判断权限，必须读 roster 的 `role`。
- 另一处观测：Team 成员上限在 `journal` 内按 `state.members.length >= maxMembers` 判定（错误码 `TEAM_MEMBER_LIMIT`）；**Lead 是否计入该计数未逐字确认**。

**可不动机制就改善的三个方向（待评估）**

1. 把分流策略写进 preset 的 persona / `instruction-hint`（本仓库已有注入点）。
2. 让 catalog 的 name / description 自解释——值来自 adapter 的模型元数据（自定义 provider 的 `models` 对象支持回填名称、上下文窗口、最大输出 token；**description 是否可写待核实**，见 §8）。
3. 把模型选择定位成"人工经 `allowedModels` 调参"，而非模型自主决策；相应地把 T3 探针的结论口径改为**为白名单背书**，而不是为"模型会自己选"背书。（2026-09-24 裁决：该口径调整与 §6 的 T3 新基线同批落地，避免探针、基线、文档三处口径不一致。）**已完成（票据 11，2026-09-25）**：探针 a14 改名 `a14-whitelist-route-compliance`，`docs/subagent-model-selection.md` §1/§2 与 ADR-0001 适用边界同口径。

---

## 6. 全量迁移清单

P0 = 不迁移就跑不起来或会丢数据；P1 = 行为变化需适配；P2 = 默认值/依赖类，按需处理。

| 级别 | 上游变更（落地版本） | 本仓库落点 | 动作 | 验收 |
| --- | --- | --- | --- | --- |
| P0 | Session 日志 V4；**无批量迁移工具**（C0 ②）；写开发布 v4 后继、源文件保留（C0 ③）；部分缺 turn-end 的 V3 兼容；**不支持降级读**（0.1.7-alpha.1/rc.1） | `~/.dsh/sessions/**`、`gates/*` 的会话隔离面、`gates/manifest.json:sessionFormatVersion` | **冷备 + 还原演练前移到首次启动 0.1.7 之前**（§7 第 1 步；冷备范围按 C0 ⑦ 含 `attachments/`）；迁移按会话在首次写开时惰性发生，无 dry-run、无批量命令；旧文件保留，但**新宿主写开后不得再用旧宿主读同一批日志**；6 个 bak/corrupt 变体先定处理规则（跳过/隔离/报错） | C0 结论（`evidence/02-preflight-*`）+ 静默后冷备清单 + 抽样会话在新宿主可打开 + 仍为旧格式的会话清单 |
| P0 | 会话历史/生命周期/沙箱接口异步化（0.1.7-rc.1）；`snapshotEvents`/`eventAt`/`ownEvents` 弃用（0.1.6-alpha.1） | `lib/index.ts`（14 处调用 + 2 处类型声明）、`plugins/rewind-dsh.ts`、`presets/minimal-plus/{compaction-epoch,trajectory-driver}.mjs`、`experiments/m4/m4-runner.mjs`、`gates/stub/run.mjs`、`presets/minimal-plus/test-helpers.mjs` | **C0 ① 已核实：rc.1 三个同步方法签名与 0.1.5-rc.2 逐字相同**（仅新增 `@deprecated`），存量调用可保留、禁止新增；异步替代面 = `ctx.sessionQuery`（dsh-base 默认挂载，签名见证据）。**不再作为宿主升级阻塞**；**2026-09-24 用户裁决：本轮维持同步读取、不迁移**（票据 05 相应置为 deferred），未来需要时再单独评估 | `npm test` 全绿 + T1/T2 闸门（两个 profile 形态）；无新增同步读取调用 |
| P0 | Agent 预设改由插件组合包声明与安装；旧目录预设需迁移（0.1.7-alpha.1/rc.1） | `presets/minimal-plus/`、`scripts/sync-agent-presets.sh`、`~/.dsh/.agent-presets/**`、`gates/manifest.json` | **目标载体 = `@deepseek-ai/dsh-agent-preset` bundle patch（profile 侧产物）**；真源留仓库（§3.5）；`sync-agent-presets.sh` 改造为生成器并先补 `--dry-run`；**C0 ④ 已确认旧目录形态不再被加载，无过渡分支**（硬切换）。**迁移第一工作项** | 生成器 dry-run 输出与仓库真源一致；`tui-team`/tui-dev 挂载冒烟（`presets/minimal-plus/smoke-boot.mjs` + 部署位冒烟）通过 |
| P1 | 自研 preset **保留**（已裁决 2026-09-24）；bash 描述已对齐上游（新 sha `8cd01c68…`），部署推迟（§1.1） | `presets/minimal-plus/*`、`scripts/sync-agent-presets.sh`、`gates/manifest.json`、`docs/minimal-plus-preset-design.md` | 保留 `phase-swap-bash` 与 delegation 行；瘦身框架留作后续参考（§3.6，事件触发复评）；**manifest 两阶段**（§1.1）：preset sha 随仓库改为 `8cd01c68…`、`hostVersion`/`sessionFormatVersion` 随宿主改；部署位写入等收口 | 窗口内 T1 用 `--allow-stale-deployment`（只豁免部署位滞后）；收口后：部署位 sha 一致 + preset 冒烟 + `npm test` 全绿、豁免标志移出调用链 |
| P1 | 子代理误判缺工具：minimal-plus `includeSubagents: true` 让子会话首轮也只暴露锚定对（本仓库实证，非上游 release note） | `presets/minimal-plus/{tool-bootstrap,phase-swap-bash,instruction-hint}.mjs`、`presets/minimal-plus/agent.cordis.yml`、`gates/expectations.json` | **方案 A（2026-09-25 裁决）**：三处 `includeSubagents` 统一 `false`，子代理首轮即 promoted/全量工具；主会话首轮锚定不变；phase-swap 硬编码改配置并复核 swap/提权一致性（票据 14） | 子代理首轮全量 + 主会话首轮仍 `[bash, str_replace_editor]`；契约测试/冒烟/闸门全绿；expectations 行级 diff + 理由登记 |
| P0 | 设置改存当前 Profile 的插件配置；旧 `settings.yaml` **仅导入一次**（0.1.7-alpha.1/rc.1） | `~/.dsh/settings.yaml`（`agent-presets.default`、`subagent-model-selection:`）、`~/.dsh/profiles/*/cordis.patch.yml` | 升级前备份并记录 sha；**C0 附带核实**：导入只发生一次——写前先把 `settings.yaml` 改名为 `settings.yaml.imported`，各 section 按自身名字写入同 id entry（例外是 3 条改名映射：`ui-developer-tools`→`ui-settings`、`ui-onboarding`→`ui-settings-general`、`shell`→平台 shell executor），被组合拒绝的 section 只留在改名后的文件里；回滚需从第 1 步备份恢复 `settings.yaml` | `--dump-config` + 设置读回一致 |
| P0 | 官方 DeepSeek 适配器仅用 Messages API，移除 Chat Completions 与 `protocol`；旧根地址改为 `https://api.deepseek.com/anthropic`（0.1.6-alpha.1 → rc.1） | profile 中的 llm-deepseek 配置行 | 删除 `protocol`，清理旧根地址覆盖 | 真实模型一次工具调用（T3） |
| P0 | 工具结果文本+图片统一 token 预算；`spill-policy` 的 `maxInlineBytes` → `maxInlineTokens`（0.1.7-alpha.2/rc.1） | `lib/app.ts:356,483`（spill 通知渲染正则） | 配置改名；核对通知文案是否仍匹配 | 超长工具结果渲染冒烟 |
| P1 | Node PTC 独立进程执行、`process.env` 为空、有输出/堆限制；PTC 包名统一 `ptc-runtime`;工作流执行器改名 `workflow-ptc`（0.1.6-alpha.1） | `presets/minimal-plus/agent.cordis.yml`（组名/插件名）、`experiments/m4/m4.patch.yml` | 更新引用的包名与服务名 | `--dump-config` id 计数为 1 |
| P1 | `agent/session-start` → 异步串行 `agent/created`（0.1.6-alpha.1） | `lib/index.ts` 启动等待路径（ARCHITECTURE.md §4 已写明"等 `agent/created` 就绪"） | 核对首个模型请求的等待语义 | 启动失败诊断用例 |
| P1 | 插件依赖运行时解析 + 支持运行时卸载（0.1.6-alpha.2） | `presets/minimal-plus/*.mjs` 自研插件 | 检查 load/unload 对称性（尤其 `phase-swap-bash` 的 per-agent shadow） | 启停插件各一次 + 闸门 |
| P1 | Team 模式 `spawn_teammate`，`subagent`/`subagent_fork` 不再提供（0.1.6-alpha.1/0.1.7-rc.1） | 新建 Team profile（`@deepseek-ai/dsh-experimental-agent-team-profile` 作为 bundle 行）、`presets/minimal-plus/agent.cordis.yml:163-193`、`gates/expectations.json` 工具清单 | **本计划保留** B1.5（硬前置）+ `tui-team` 建立 + 冒烟 + per-profile expectations；B2–B4 移入功能计划第二切片（§5.3）；已裁决开启，采用 C 方案；闸门工具面按 profile 维度重建 | B1.5 绿（或票面记"未测"并按回退方案执行）+ 双 profile 工具面快照 + 行级 diff 审阅 |
| P1 | Remote 双向流+二进制；工作区文件读取统一 `readBytes`（0.1.7-alpha.1/rc.1） | 若有 remote/relay 侧插件 | 按新接口迁移 | relay 冒烟 |
| P2 | Ralph 默认关闭；移除内置 E2B 后端；默认模型列表移除 V4 Flash / V4 Flash Vision Exp（0.1.6-alpha.1/alpha.2） | `presets/minimal-plus/agent.cordis.yml:156` 注释、`gates/expectations.json` | 显式启用需要的项；核对工具面 | 工具清单闸门 |
| P1 | 委派路由能力在两条路径上不对称（本仓库实证，非上游 release note） | `docs/subagent-model-selection.md`、ADR-0001、`experiments/subagent-model-selection/*`、`gates/t3/*` | 按 §5.5：把 ADR-0001 适用边界显式收窄为"非 Team profile 的 `subagent` 委派"；评估三个改善方向（prompt 策略 / catalog 文本 / 口径改为白名单背书） | 文档与探针口径一致；T3 结论不再隐含"模型会自主选路由" |
| P2 | `@deepseek-ai/cordis-plugin-hmr` → `@deepseek-ai/dsh-hmr`（CLI 运行时依赖变化） | `~/.dsh/bin/dsh` wrapper（为前者补 `--expose-internals`） | **已核实仍需该标志**（§8 第 3 条）→ wrapper 保持不动 | 启动冒烟 |
| P2 | 插件安装/启动做版本兼容性检查，可按精确版本豁免（0.1.7-rc.1） | 自研插件包与 bundle | 标注兼容版本范围 | 安装/启动路径无兼容性拒绝 |
| P0 | **C0 取证票 — ✅ 已完成（2026-09-24）** | 临时前缀 `/tmp/dsh-c0-20260924-152002`（独立 npm cache；真实 `~/.dsh` 只读、零写入，核验见证据） | 六项事实全部取证 + 附件/storages 判定，证据归档 `docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/02-preflight-*`；复现脚本 `02-preflight-repro.sh`（调用归档探针） | ① 同步签名未变、异步面 = `ctx.sessionQuery`；② 无批量迁移工具；③ 读开不落盘 / 写开发布 v4 后继且源文件保留（v0/v3 均实测）；④ 目录预设不再加载；⑤ rc.3 = 依赖钉版 republish；⑥ rc.2 可重取但是混合树。§8 第 1/2/10/11/12/14 条已替换为事实，P0 迁移与 §7 第 10 步解除阻塞 |
| P0 | 宿主钉版与会话格式版本断言（`gates/run.mjs:488-503`，两条均不可豁免） | `gates/manifest.json` | 宿主切换那批同步改 `hostVersion` → `0.1.7-rc.1`、`sessionFormatVersion` → 运行时值；preset sha 随仓库批次改为 `8cd01c68…`（待批准落地） | T1 `host.pin` / `session.format-version` 在 0.1.7 宿主上绿 |
| P1 | T3 基线带 `hostVersion` 戳（`gates/manifest.json.baselines` + `gates/t3/analysis.mjs` provenance） | `gates/manifest.json`、`experiments/m4/*`、`gates/t3/*` | **在 0.1.7-rc.1 上新采一条基线**（同 preset/模型/参数）；旧条目留史不删；窗口内采不了就显式记"新宿主未跑 T3"；"T3 口径改为为白名单背书"与新基线同批（§5.5） | **已完成（票据 11，2026-09-25）**：新基线 `m4-commandcode-v41-2026-09-25`（sha `062cd4f7…`，N=9，host `0.1.7-rc.1`）入库并成为 `t3.baseline`，旧 3 条保留；T3 载体切 0.1.7 bundle + 独立 profile，a14 改名 `a14-whitelist-route-compliance`，`--tier 3` 18/18 绿（`evidence/11-t3-green.json`） |
| P2 | 升级节奏无政策（本轮是"版本链拉长后补课"） | `README.md` 或本计划末尾 | 立轻政策：日常宿主跟 `latest` stable；`next`/rc 只在临时前缀侦察；每个新 stable 按 C0 模板取证并在固定窗口内升级（§7 末尾） | 政策写入文档；下一次 stable 出现时按政策执行 |

---

## 7. 升级与回滚程序

**第 0 步：前置取证票 C0 — ✅ 已完成（2026-09-24）**

0. 临时前缀 `/tmp/dsh-c0-20260924-152002` 安装 `@deepseek-ai/dsh@0.1.7-rc.1`（独立 npm cache；未碰真实 `~/.dsh`，配置面前后逐字节一致，零写入核验见 `evidence/02-preflight-snapshot-diff.txt`）。实测结论（原文证据均归档到 `docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/`，复现脚本 `02-preflight-repro.sh`）：
   - ① **异步替代接口**：`eventAt`/`snapshotEvents`/`ownEvents` 与 0.1.5-rc.2 类型签名**逐字相同**，rc.1 仅加 `@deprecated`；异步替代面是 `ctx.sessionQuery.readSession()/listSessions()/observeSession()/readEvent()`（dsh-base 默认挂载 `session-query-sqlite`）。宿主升级无签名破坏，迁移非前置。
   - ② **批量迁移工具**：不存在（全树仅 3 个 bin，CLI 唯一子命令 `plugin`），无 dry-run；迁移由格式 catalog 在会话打开时惰性执行。
   - ③ **旧格式读写行为**：读开 = 内存迁移、不落盘；写开 = 发布 `session.v4.jsonl.zstd` 后继 + `session.lock`，**源文件保留且逐字节不变**（v0/v3 均已实测）。
   - ④ **目录预设**：`~/.dsh/.agent-presets/**` 不再被加载（全树零代码引用 + 运行时哨兵 `Unknown agent preset`）；载体必须是 profile/bundle 内的声明行。
   - ⑤ **rc.3 变更面**：解析树 552 个包名仅 6 个版本集合不同；rc.3 把浮动依赖精确钉版，tarball 逐文件比对无代码差异（republish）。
   - ⑥ **旧包可重取性**：`npm pack @0.1.5-rc.2` 成功且 shasum 与 registry 一致；但新装 rc.2 会解析出 "rc.2 CLI + rc.3 子包" 的混合树 → **本地副本仍是唯一精确回滚入口**。
   - ⑦ **附件/storages**：附件属于恢复面（181/1491 个会话引用 2795 个对象，全部在 `attachments/v1/objects`），冷备需含 `attachments/`；`storages/` 是投影缓存，不属于恢复面。
   **C0 已绿，第 10 步与 P0 代码迁移解除阻塞。** 目标漂移规则不变：锁定 rc.1 直到收口；期间若 0.1.7 正式版发布，收口后单开一次小步升级，不中途换靶（安全修复需重新裁决）。

**升级前（冻结，第 1 步必须在首次启动 0.1.7 之前完成）**

1. **静默 + 冷备 + 演练**（顺序不可换）：关闭所有 dsh 写者（TUI/headless）→ 冷备 `~/.dsh/sessions/**` 到 `sessions` 之外，附文件数与 sha 清单 → **还原演练**：把备份还原到 scratch 路径、用旧宿主（0.1.5-rc.2）打开 ≥2 个代表会话（含一个带子代理的）；读不出来就不进后续步骤。同时备份并记录 sha：`~/.dsh/settings.yaml`、`~/.dsh/.agent-presets/**`、`~/.dsh/profiles/*/cordis.patch.yml`。**附件按 C0 ⑦ 结论纳入冷备**：备份 `~/.dsh/attachments/**`（181 个会话引用 2795 个对象；可排除派生的 `request-images/` 与空 `tmp/`）；`~/.dsh/storages/**` 是投影缓存，不进恢复面（含也会被旧宿主重建）。丢失窗口 = 本步快照之后新建的会话，快照时间点记入案；冷备保留期至少到迁移后的宿主稳定走过一次正式版升级。
2. 记录当前两支全局安装的版本与路径（v22.22.1 → 0.1.5-rc.1 / v24.21.0 → 0.1.5-rc.2），以及 `~/.dsh/bin/dsh` 指向哪一支；**把 v24 的 `0.1.5-rc.2` 包目录另存一份本地副本**（回滚不依赖 registry 上该版本仍在）。

   **已完成（票据 03，2026-09-25）**：冷备根 `~/.dsh/upgrade-backups/dsh-0.1.7-rc.1-pre-migration-20260925-113044/`（快照 2026-09-25 11:32:35+0800，静默窗口内零写者落盘；含 sessions/attachments/settings/profiles/.agent-presets 与逐文件指纹清单）；旧宿主包副本 + 本地入口启动核验；scratch 还原演练 8/8 代表会话打开成功（含 v3 子代理链与带 118 个附件引用的会话）。**既存缺口**：72 个 2026-09-10 前的 v0 子代理会话（`subagent/descriptor version 2`）旧宿主一律读不开，冷备已完整保留，处理规则留第 10 步。证据 `docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/03-*`。实际启动 0.1.7 之前若距该快照较久，按同一脚本（`03-cold-backup.sh`）在静默窗口重取一次快照（写入新的空根目录；脚本不做 `--delete`），丢失窗口随之更新。

   **已完成（票据 04，2026-09-25 17:04）**：重取到 `~/.dsh/upgrade-backups/dsh-0.1.7-rc.1-pre-first-start-20260925-170449/`（17:04:49→17:05:30，fail=0，sessions 2213 文件 / 662M），重跑还原演练 fail=0（8/8 代表会话、118/118 附件命中、descriptor-v2 72/72 仍为既存缺口）；丢失窗口更新为该时刻之后；11:30 根保留为回滚基准。证据 `docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/04-cold-backup-retake.md`。

**升级（分阶段，每阶段可停）**

3. 先装到**非当前 PATH 优先级**的位置或用 `DSH_CLI` 覆盖，避免直接替换正在使用的 0.1.5-rc.2。目标版本**精确锁定**：`npm i -g @deepseek-ai/dsh@0.1.7-rc.1`（不跟随 `next` 浮动）；混合期统一走 `~/.dsh/bin/dsh` 的 `DSH_CLI` 覆盖。

   **已完成（票据 04，2026-09-25，用户裁决）**：采用「替换 v24 全局」而非侧前缀——默认入口即 `0.1.7-rc.1`，旧宿主以票据 03 本地副本 + `DSH_CLI` 显式回切；安装前先做 staging 预验（exit 0 / 278 包）。连带影响（稳定侧 symlink 翻转）见第 6 步脚注。
4. **tui-dev 与 headless 同步升级**（已裁决）：两个 profile 的宿主机版本、profile 插件树与部署位 preset 一起到位；`subagent-model-selection-settings` 行分别保持 tui-dev `enabled: true` / headless `enabled: false`，同步升级**不合并**两边口径。（30/29 为 0.1.5 时代口径；0.1.7 实测见票据 09/11：tui-dev 35、隔离测量面 29/28）
5. **Team 按 C 方案单独建 profile**（已裁决）：新增一个带 `@deepseek-ai/dsh-experimental-agent-team-profile` 的 profile（如 `tui-team`），tui-dev 与 headless **不挂** Team bundle，从而保留 `subagent` + `modelSelectionSettings` 基线（理由与代价见 §5.2 / §5.4）。**建立 `tui-team` 之前必须先过 B1.5（硬前置）**；不可测时按票面回退方案执行并在票面记"未测"。

   **已完成（票据 09，2026-09-25，隔离）**：`tui-team` 的派生规则与检查落在 `gates/team-bundle.mjs`（唯一名字/派生来源）与 `gates/team-profile.mjs`（可复跑命令）：从真实 `tui-dev` 派生（源只读 + 追加 Team bundle）、装入 0.1.7 preset 载体，隔离 home 的 `--dump-config` exit 0 / ids=115 / duplicates=0；per-profile 期望（`gates/expectations.json` 的 `profiles` 段）与 PTY 双形态检查同批到位。**真实 `~/.dsh/profiles/tui-team` 的物化与 preset 落位仍随第 11 步（票据 12）**。证据 `docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/09-team-profile-and-profile-dimension-baselines.md`。
6. **manifest 宿主要求同批更新**：`gates/manifest.json` 的 `hostVersion` → `0.1.7-rc.1`、`sessionFormatVersion` → 运行时值（两条断言不可豁免，`gates/run.mjs:488-503`）。preset sha 按 §1.1 的 manifest 口径随仓库批次改为 `8cd01c68…`（待批准落地）。

   **已完成（票据 04，2026-09-25）**：v24 全局已切到 `0.1.7-rc.1`（旧宿主副本 + `DSH_CLI` 可回退）；tui-dev/headless 的 `--dump-config` exit 0、逐 loader id 计数为 1（95 / 111）；manifest 两条字段已更新（`sessionFormatVersion` 运行时值 = 4）；CI 宿主安装与 README 宿主前提段同步。真实模块级 boot 的 tui-dev 仍差 07 的载体行；T0 红项（tsc 1 处 + bash 换用 10 例）与闸门编排器的 app-boot 适配归票据 06。**连带发现**：`dsh-runtime/stable` 的 `@deepseek-ai/*` 依赖原是指向全局树的 240 条 symlink，已随本次切换翻到 0.1.7（其自带 CLI 仍 0.1.5-rc.2 → 启动失败），已于 2026-09-25 按用户裁决的方案③处置（在 stable 目录按自身 lock 做 `npm ci` 自包含重建；/tmp 预演 + 真目录复验绿，0 条链接指向全局/备份，后续全局升级不再连带）；证据 `docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/04-host-upgrade-and-working-profiles.md`。在票据 06 的闸门源码适配落地前，`scripts/regression-gate.sh` 与 CI 在 0.1.7 上不可运行（预期红）。
7. `--dump-config` 干跑：exit 0，逐 loader id 递归计数均为 1（注意 `--dump-config` 会回写 profile 目录下的 `cordis.yml`，属宿主规范化行为）；**两个形态各跑一次**（不带 Team 的 tui-dev / headless、带 Team 的 `tui-team`）。

   **已完成（票据 09，隔离）**：派生副本上 tui-dev entries=112、tui-team ids=115，均 exit 0 / duplicates=0；tui-team 工具面基线（40 = tui-dev +6/−1）与回退口径见 `gates/expectations.json` 的 `profiles` 段与 09 证据。
8. 只读冒烟：`presets/minimal-plus/smoke-boot.mjs`（仓库根预设）+ 部署位冒烟各一次；Team profile 另跑一次工具面快照。
9. 逐票迁移 + 闸门：`npm test` → T0/T1/T2（`--composition real`）→ T3（真实模型，需 `~/.dsh/settings.yaml`；**新基线须在 0.1.7-rc.1 上采**，旧基线留史，采不了显式记"新宿主未跑 T3"）。expectations 变更必须附行级 diff + 理由，禁止整文件再生成。
10. **会话迁移（只执行，不决策）**：C0 ②③ 已定——没有批量工具、没有 dry-run；迁移按会话在**首次写开**时惰性发生（发布 `session.v4.jsonl.zstd` 后继，`session.jsonl.zstd` / `session.v3.jsonl.zstd` 等源文件保留且逐字节不变）。执行步 = 逐会话写开（resume/继续）或接受按需惰性迁移，之后抽样打开验证，并留"仍为旧格式的会话清单"。这一步不与前面步骤混批。

    **已完成（票据 10，2026-09-25，用户裁决 B 口径）**：接受按需惰性迁移——全量读开分类 1579 个 id（可读 1361 / 不可读 218，旧宿主 218/218 同样读不开属既存盲区），8 个代表会话（含子代理链与 118 附件会话）写开迁移 8/8 绿（v4 后继发布、源 sha 不变、事件数保持），其余 1571 个留「仍为旧格式清单」待新宿主 resume 时迁移；坏文件按「跳过并登记」处理（7 变体 + 218 不可读，未阻断）。**回滚边界已实测**：旧宿主读 v4 共存目录报 `not found`、写开报 `uses log format v4 … reads only v3`（回答 §8 第 15 条）；冷备 11:30 / 17:04 两根保留，丢失窗口 = 17:04:49 之后写入。app 级 runner 恢复带 preset 会话归票据 12。证据 `docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/10-session-format-migration-execution.md` 及 `evidence/10-*`。

**收口定义（2026-09-24，Q4）**——以下全绿才算收口：

- 两处安装点均为 `0.1.7-rc.1`，版本输出留档；
- §6 全部 P0 行各自有命名命令 + 证据归档到 `docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/`；
- `npm test` + T0/T1/T2 在非 Team 与 Team 两种 profile 上全绿；
- expectations 差异经人工审阅（行级 diff + 理由）；
- 会话迁移按第 10 步完成并抽样打开；冷备仍在保留期；
- 部署位 sha 与 manifest 一致，调用链里不再出现 `--allow-stale-deployment`；
- 每阶段 stop 规则：任一步失败停在原地、退回上一已验收状态，不带着失败往下走。

**部署（统一在收口后执行，2026-09-24 裁决）**

11. preset 载体改造产物（bash 描述对齐，新 sha `8cd01c68…`）与 Team profile **一起落部署位**：先跑 `scripts/sync-agent-presets.sh --dry-run`（**该 flag 需先补**，见 §6 载体行）核对生成结果，再执行真实写入（profile 侧 bundle 产物，需批准）+ 更新 `gates/manifest.json` 的 sha + 建立 `tui-team` profile。
    在此之前不动部署位；仓库 ↔ 部署位 sha 的临时不一致按 `--allow-stale-deployment` 豁免处理（**只覆盖部署位滞后这一层**），收口时消除。

**回滚**

12. 恢复 v24 本地副本（第 2 步留存）或用 `DSH_CLI` 指回 0.1.5-rc.2（必要时 `npm i -g @deepseek-ai/dsh@0.1.5-rc.2`）+ 恢复第 1 步备份：可回到旧宿主、旧 profile、旧预设。**C0 ⑥ 已核实**：registry 仍在供 rc.2（可重取），但今天新装会解析出"rc.2 CLI + rc.3 子包"的混合树，已非旧安装的原样副本——**精确回滚只认第 2 步的本地副本**。
13. **不可逆边界（已接受，无"先不迁"分支）**：会话日志一旦迁移到 V4，旧版本不支持降级读。回滚到 0.1.5-rc.2 时，第 1 步快照之前的历史会话可由冷备恢复，**快照之后新增/已迁移的会话会丢失**——这是 Q15 裁决明确承认的代价。**C0 ③ 补充**：写开只发布 v4 后继、旧代文件保留，但上游明确不提供降级支持；旧宿主对"同一目录里同时存在旧代与 v4 后继"的选取行为**未取证**（§8 第 15 条），因此按"不可降级"保守处理：迁移后的新增事件仍计入丢失窗口。

**升级节奏政策（2026-09-24，Q14）**

- 日常宿主跟 `latest` stable；`next`/rc 只在临时前缀做侦察、不上日常入口；
- 每出现一个新 stable：按第 0 步 C0 模板做一次只读取证，并在固定窗口内完成升级；避免再次出现"跨过一个整代"的补课。

**裁决状态（2026-09-23 / 24）**

| 项 | 状态 |
| --- | --- |
| 目标版本锁定 `0.1.7-rc.1`（不跟随 `next`） | **已裁决** |
| 升级窗口：tui-dev 与 headless 同步 | **已裁决** |
| 接受"迁移到 V4 后不可降级读" | **已裁决**（2026-09-24 Q15 确认：不再保留"先不迁"分支） |
| Agent Team 本轮是否开启 | **已裁决：开启，采用 C 方案（profile 划分）**——Team 不进 preset；场景与边界见 §5.4 |
| 自研 preset（含二轮提权）去留 | **已裁决：保留**（2026-09-24）；淘汰改为事件触发复评（§3.6） |
| 部署时机 | **已裁决：推迟到收口后统一部署**（第 11 步） |
| 计划边界拆分 | **已裁决**（2026-09-24，Q3/Q12） |
| preset 目标载体 = 0.1.7 bundle patch | **已裁决**（2026-09-24，Q11） |
| C0 前置取证 | **已完成**（2026-09-24；六项事实 + 附件/storages 判定，证据 `evidence/02-preflight-*`） |
| manifest 两阶段 | **已裁决**（2026-09-24，grill 修正） |
| expectations 增 profile 维度 / T3 新基线 | **已裁决**（2026-09-24，Q8/Q13） |
| B1.5 硬前置 + 不可测回退 | **已裁决**（2026-09-24，Q7） |
| 升级节奏政策 | **已裁决**（2026-09-24，Q14） |

---

## 8. 未验证清单（不得当作结论使用）

1. ~~**`snapshotEvents` 的异步替代接口确切名称与签名**~~ → **已核实（2026-09-24，C0 ①）**：rc.1 安装产物中 `eventAt`/`snapshotEvents`/`ownEvents` 的类型签名与 0.1.5-rc.2 逐字相同，仅新增 `@deprecated`（存量可暂不迁移、禁止新增）。异步替代面 = `ctx.sessionQuery`（`@deepseek-ai/dsh-session-query`，dsh-base 默认挂载）：`readSession(id): Promise<SessionLogSnapshot>` 等。宿主升级不因该接口阻塞。原文见 `evidence/02-preflight-signatures.txt`。
2. ~~**0.1.5-rc.3 的变更内容**~~ → **已核实（2026-09-24，C0 ⑤）**：rc.3 是把浮动依赖精确钉版的 republish；解析树 552 个包名仅 6 个版本集合不同（cordis / plugin-include / plugin-loader / plugin-timer / schemastery / 自身版本），`@deepseek-ai/dsh` 与 `dsh-base` 的 tarball 逐文件比对无代码差异。见 `evidence/02-preflight-pkgtree-diff.txt`。
3. ~~**`dsh-hmr` 是否仍需 `--expose-internals`**~~ → **已核实（2026-09-23）：需要**。`dsh-hmr@0.1.7-rc.1` 构造函数内 `if (!this.ctx.loader.internal) throw new Error("--expose-internals is required for HMR service")`；包名从 `cordis-plugin-hmr` 换成 `dsh-hmr` 不改变该要求，`~/.dsh/bin/dsh` 的 wrapper 无需改动。
4. ~~**Team 的实验性 bundle 是否随 CLI 自动挂载**~~ → **已核实（2026-09-23）：不自动挂载**（`OPTIONAL_BUNDLES`，且不在任何 `PROFILE_TEMPLATES` 中）；显式加入 bundle 后 4 行 subagent 为**组合期 `disabled: true`**。preset 逃生门的存在性由票 B1.5 回答（2026-09-24 升为 `tui-team` 建立前的硬前置）。
5. **`subagent_fork` 在非 Team 会话中是否仍存在**：**已在 profile 层确认存在**（base dump 中 `tool-subagent-fork` enabled），且非 Team profile 的工具面实测含 `subagent` + `subagent_fork`（`evidence/02-*`）；Team profile 中两者均被组合期禁用。`gates/expectations.json` 的工具面快照需按 profile 区分后重新采集。
6. **本机 CLI 实际仍是 0.1.5-rc.2**（`~/.dsh/bin/dsh` → nvm v24.21.0 全局），尚无任何 0.1.7 安装痕迹；本文所有"本仓库落点"均基于 0.1.5-rc.2 宿主。
7. **catalog 的 model `description` 是否可写**：`list_subagent_models` 返回 `{provider}/{model.id} — {model.name}: {model.description}`，值来自 `llm.listModels()`（adapter 元数据）。自定义 provider 的 `models` 对象已知支持回填名称 / 上下文窗口 / 最大输出 token，**description 是否可写未核实**——这决定 §5.5 改善方向 2 是否可行。
8. ~~**Team 里的 teammate 继承哪条 LLM 路由**~~ → **已核实（2026-09-23）：继承 Lead，且无覆盖入口**（源码三层证据 + 实跑，见 §5.5「D 实跑补充」）。附带核实：teammate **继承 Lead 的 preset**（`childSessionMeta` 复制 `composedPreset`），工具面与 Lead 相同但 `spawn_teammate` 可见不可用。
9. **Team 成员上限是否含 Lead**：`journal` 以 `state.members.length >= maxMembers` 判定，Lead 是否计入未逐字确认（组合包覆盖值 `maxMembers: 8`，服务默认 16）。
10. ~~**0.1.7 对 V3 会话的读/写行为**~~ → **已核实（C0 ③）**：读开 = 内存迁移、不落盘；写开 = 发布 `session.v4.jsonl.zstd` 后继 + `session.lock`，源文件逐字节不变（非原地改写）。见 `evidence/02-preflight-session-rw.txt`。
11. ~~**0.1.7 是否有面向用户的批量迁移工具**~~ → **已核实（C0 ②）：没有**。0.1.7-rc.1 全树仅 3 个包暴露 bin，CLI 唯一子命令是 `plugin`；迁移仍由内部 format catalog 在会话打开时惰性执行，无 dry-run。
12. ~~**0.1.7 是否仍加载 `~/.dsh/.agent-presets/**` 目录预设**~~ → **已核实（C0 ④）：不再加载**。全树零代码引用；运行时哨兵 `resolve("c0-sentinel")` 报 `Unknown agent preset`。载体改造无过渡分支，必须切到声明行。
13. ~~**6 个 bak/corrupt 会话变体的迁移行为**~~ → **已核实（票据 10）**：变体不在 canonical 文件名集合内，store 选取/迁移只认 `session[.vN].jsonl.zstd`，共存不报错也不影响其余迁移；按用户裁决「跳过并登记」（原地保留、不改名、不隔离）处理。
14. ~~**附件与 storages 是否属于会话恢复面**~~ → **已核实（C0 ⑦）**：附件**属于**（181/1491 个会话引用 2795 个 id，全部命中 `attachments/v1/objects`）；`storages` 是投影缓存，会话日志才是真源，不属于恢复面。冷备范围见 §7 第 1 步。
15. ~~**旧宿主（0.1.5-rc.2）对"旧代 + v4 后继"共存目录的选取行为**~~ → **已实测（票据 10，2026-09-25）**：旧宿主读搬迁后的会话报 `session ... not found`；直接写开报 `session ... uses log format v4, but this harness reads only v3`。即共存时旧宿主既不会回落到 v3 源、也不能继续写；保守口径（迁移后不得再用旧宿主继续同一批会话）成立，无需回滚票再补测。

---

## 9. 事实来源

- Release notes（GitHub API 实拉，逐 tag）：
  `dsh-v0.1.6-alpha.1`、`dsh-v0.1.6-alpha.2`、`dsh-v0.1.7-alpha.1`、`dsh-v0.1.7-alpha.2`、`dsh-v0.1.7-rc.1`；
  `dsh-v0.1.5-rc.3` 无 release（404）。
- 官方文档（标签 `dsh-v0.1.7-rc.1`）：
  `docs/subsystems/subagent.zh.md`、`docs/subsystems/agent-team.zh.md`、`docs/session-format-status.zh.md`、`docs/agent-lifecycle.zh.md`、`docs/architecture.zh.md`；
  源码 `packages/core/session/src/types.ts`。
- npm registry：`@deepseek-ai/dsh` 的 dist-tags 与 `0.1.7-rc.1` / `0.1.5-rc.3` 元数据。
- 本仓库（只读核查）：`lib/index.ts`、`lib/app.ts`、`presets/minimal-plus/agent.cordis.yml`、`docs/subagent-model-selection.md`、`ARCHITECTURE.md`、`gates/expectations.json`、`scripts/sync-agent-presets.sh`。
- 闸门口径（2026-09-24 只读侦察）：`gates/manifest.mjs:156-175`（三态比对：`repoMatches` / `state`）、`gates/run.mjs:463-483`（`repo-matches-manifest` 不可豁免、`repo-vs-deployed` 可豁免）、`gates/run.mjs:488-503`（`host.pin` / `session.format-version`）、`README.md:195`（豁免范围）。
- 本机侦察（2026-09-24，只读）：全局安装 v22.22.1 → 0.1.5-rc.1、v24.21.0 → 0.1.5-rc.2；`~/.dsh/bin/dsh` 钉 v24 全局 `lib/bin.js`、支持 `DSH_CLI`、带 `--expose-internals`；`~/.dsh/sessions` 1486 个会话目录 / 约 630M（1491 个 jsonl：583 个显式 v3、908 个无版本后缀；6 个 bak/corrupt，C0 证据口径）；部署位 `minimal-plus/agent.cordis.yml` sha256 `318c4884…`。
- 2026-09-24 grill 访谈：§1.1 与 §7 的 Q1–Q15 裁决、以及 manifest 两阶段修正的来源。
- 2026-09-24 前置取证（C0，临时前缀 `/tmp/dsh-c0-20260924-152002`，独立 npm cache，真实 `~/.dsh` 只读、零写入）：`docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/02-preflight-*`（结论、接口原文、CLI/迁移面、读写开实测、目录预设哨兵、包树 diff、附件/storages 统计、零写入核验、三个归档探针与复现脚本）。
