# liangshen+ 组合 preset 设计方案（首轮锚定 + 二轮 AGENTS.md 注入 + 二轮 bash 提权）

> 目标：把三件事合并到一个 preset 里：
> 1. **首轮**：liangshen 的轨迹锚定（persistent bash + `str_replace_editor`，首轮零注入）；
> 2. **第二轮起**：AGENTS.md/CLAUDE.md 自动进上下文（`dsh-agent-instructions` 正常注入）；
> 3. **第二轮起**：bash 恢复沙箱 + `sandbox_permissions` 提权（`dsh-tool-bash`）。
>
> 本文档是设计定稿前的完整方案（项目流程偏好：**先落文档再 spike**）。所有结论均有包内源码证据，证据行标注了包内文件位置（稳定路径，`*` 为 pnpm 哈希目录）。

---

## 0. 结论先行

**结论：能满足，但 stock 机制做不到，需要新写一个「phase-swap-bash」插件 + 一个新 preset（不污染现有 `standard-bootstrap` / `liangshen`）。**

| 需求 | 现有机制 | 缺口 |
|---|---|---|
| ① 首轮锚定 | liangshen 的 `tool-bootstrap`（`bootstrapTools: [bash, str_replace_editor]` + 首轮剥注入） | 无 |
| ② 二轮 AGENTS.md 注入 | `dsh-agent-instructions` 挂载（standard-bootstrap 已挂，首轮被剥、promotion 后自动恢复） | 无 |
| ③ 二轮 bash 提权 | 需要 bash 从 persistent 实例**换成**沙箱 `dsh-tool-bash` | **有：同名工具一层内不能共存，且 `tool-bootstrap` 只会按名字裁剪目录、不能换工具实现** |

系统性死结的源码证据：

| 事实 | 证据 |
|---|---|
| `tool-bootstrap.mjs` 只做 keep-set 过滤，**不改工具定义** | `dsh-tui/presets/liangshen/tool-bootstrap.mjs` `keepTools()`：`{ ...assembled, tools: assembled.tools.filter((tool) => keep.has(tool.name)) }`（219-223 行） |
| 同名工具**同一层内注册重复即失败**（liangshen 因此把 `tool-bash` 全平台 `disabled: true`） | `@deepseek-ai/dsh-tools` `lib/index.js` `register()`：*"duplicates within one layer and the reserved `run_code` name fail"*（2758 行） |
| 注册是可逆的——`register()` 返回**exact disposer**，可注销后重注册同名工具 | `@deepseek-ai/dsh-tools` `lib/index.js` 2760、2770 行 |
| 沙箱 bash 的 schema 带 `sandbox_permissions` + `justification`（当沙箱 executor 挂载时） | `@deepseek-ai/dsh-tool-bash@0.1.0-rc.8_*/lib/index.js` 285-295 行；提权枚举来自 `@deepseek-ai/dsh-sandbox` `ESCALATION_TARGETS = ["workspace-write", "danger-full-access"]`（index.js 41 行） |

**→ 方案核心**：复用 liangshen 首轮（persistent bash + `str_replace_editor` + 首轮抑制注入），在 **promotion 事件**里注销 persistent bash、调用 `dsh-tool-bash` 的 `apply()` 重新注册同名 `bash`（沙箱 + 提权）。第二轮起目录即 complete，注入与提权同时恢复。

---

## 1. 背景：锚定机制与 0/9、5/5、11/11 的口径

复现实验（issues #6/#11，2026-08-15）把「首轮轨迹锚定」的决定条件固定在**首轮请求**上（`tool-bootstrap.mjs` 头注释原话：*"The API-visible **first-request** catalog decides whether the session anchors"*）：

| 条件 | 测量结果 | 口径 |
|---|---|---|
| 首轮工具 schema | Minimal 对（persistent bash + `str_replace_editor`）**5/5 锚定**（无 `let me` 首行）；**标准系全家（pwsh/read、pwsh only、sandboxed bash/read）11/11 落标准行为** | first request |
| 首轮输出预算 | maxTokens=1024 时 26/32 落 `We need`；256000 时 Minimal 对 0/5（即 5/5 锚） | first request |
| 首轮注入 | 带 skill-catalog 注入 0/9 锚定；不带则 ~81% | **first step** |

推论（本方案的判定依据）：

- **锚定是首轮属性**：promotion 触发点 = 首个 durable `tool/call`（第一轮内）。首行模式一旦定型，**第二轮才进来的 AGENTS.md/skill-catalog 注入不会把轨迹打回 0/9**——0/9 的测量口径是「首步带目录」，从未测过「二轮注入」。
- standard-bootstrap 拿不到锚定的真正原因是**首轮 schema 属标准系**（sandboxed bash + read，实测 11/11 标准行为），注入剥离救不了 schema 不匹配。本方案首轮直接采用 Minimal 对，绕开这一条。

---

## 2. 需求拆解与阶段表

| 阶段 | 可见工具 | AGENTS.md / skill-catalog | bash 本体 | 沙箱 / 提权 |
|---|---|---|---|---|
| **首轮**（未 promote） | 仅 `bash`(persistent) + `str_replace_editor` | 抑制（`suppressedContextSources`） | `dsh-tool-bash-persistent`（PTY，Minimal 描述） | 无（锚定所需） |
| **首个 tool/call 后（promoted）** | 完整目录 | `dsh-agent-instructions` 自动注入（AGENTS.md/CLAUDE.md）；skill-catalog 按 §3.4 决策 | **swap → `dsh-tool-bash`（沙箱 schema）** | `workspace-write` + 可一次性提权 `danger-full-access`（`sandbox_permissions` + `justification` + 审批） |

---

## 3. 设计

### 3.1 新 preset：`presets/liangshen-plus/agent.cordis.yml`

以 liangshen 的 `agent.cordis.yml` 为基底，做四处改动：

1. **`tool-bootstrap` 保持 liangshen 原样**（`bootstrapTools: [bash, str_replace_editor]`、`promoteOn: tool-call`、`includeSubagents: true`、`suppressedContextSources: [agent-instructions, skill-catalog]`），**必须仍是 FIRST 行**（waterfall 逆序应用、`prepend: true` 的最外层变换逻辑依赖注册顺序，照抄 liangshen 文件头注释）。
2. **第 84-88 行 `instruction-hint` 替换为 `dsh-agent-instructions`**（需求②）：

   ```yaml
   - id: agent-instructions
     name: '@deepseek-ai/dsh-agent-instructions'
     config:
       maxBytes: 65536
   ```

   注入源（`dsh-agent-instructions` 源码）为工作区 `AGENTS.md`/`CLAUDE.md`（candidates 见 lib 16 行）+ `~/.dsh/AGENTS.md` 用户全局（lib 140、554 行），含 `.local` overlay（lib 156 行注释）。首轮被 bootstrap 过滤器剥掉，promotion 后自动恢复——**用户自定义 AGENTS.md 从第二轮起照常送达**。
3. **`tool-bash`（`dsh-tool-bash`）保持 `disabled: true`**（与 liangshen 相同，避免与 persistent bash 撞名）；由 `phase-swap-bash.mjs` 在 promotion 时动态注册。
4. **persona 用 standard 版**（`dsh-persona` 默认，不带 liangshen 的 `complete: true` / `includeRuntimeContext: false`），保证二轮上下文完整（cwd、身份等都进 system prompt，符合「standard 完整面」语义）。

其余行（persistent-shell 组、custom-bash[win32]、str-replace-editor + `dsh-fs-local`、tool-fs、tool-fs-search、tool-jobs、skill-filesystem、skill-search、tool-goal、planning、compaction、delegation、tool-ask-user、tool-todo、tool-web）照抄 liangshen，不改。

### 3.2 新插件：`presets/liangshen-plus/phase-swap-bash.mjs`

**职责**：首个 durable tool/call 发生时，把 `bash` 的实现从 persistent 实例切换为沙箱 `dsh-tool-bash`。

```
export const name = 'phase-swap-bash'
export const inject = []          // 同 tool-bootstrap：事件时取服务，不静态 inject
export function apply(ctx, config) {
  const promotion = createEpochPromotion({ 'tool-call': ['tool/call'] }, { includeSubagents: true })
  ctx.on('session/event', (session, event) => promotion.observe(session, event))

  ctx.on('session/event', async (session, event) => {
    if (swapped.has(session.id) || !promotion.status(session.agent).promoted) return
    swapped.add(session.id)        // 幂等：每次 promotion 只 swap 一次
    // 1. 注销 persistent bash（dsh-tools register 的返回 disposer）
    disposePersistentBash(ctx, session.agent)
    // 2. 注册沙箱 bash：直接调用 dsh-tool-bash 的 apply，保证 schema/执行/审批与 standard 完全一致
    await import('@deepseek-ai/dsh-tool-bash').then(m => m.apply(ctx, {
      enableRunInBackground: config.enableRunInBackground ?? true,
      // 其余配置沿用 standard preset 的 tool-bash 行
    }))
  })
}
```

关键点（每个都是要 spike 验证的）：

- **注销方式**：persistent bash 由 `persistent-shell` 组内的 `dsh-tool-bash-persistent` 行注册，其 `register()` 返回的 disposer 需要**在注册时被捕获**。插件无法触及 preset 行内部的返回值——spike 需确认两种可行路径之一：
  - (a) 本插件的 apply 不依赖 preset 行，而是**自行注册 persistent bash**（把 `persistent-shell` 组的工具注册逻辑收进插件，preset 只留 terminals 服务）；disposer 直接持有；
  - (b) 通过 `ctx.tools` 的视图/层 API 按名移除后重注册（需确认 rc.8 是否暴露 remove-by-name 接口）。
  - 默认选 (a)：语义最干净，插件完全自持生命周期。
- **顺序**：先 dispose 后 register，避免同层同名冲突（2758 行）。
- **执行路径**：promotion 判定复用 `compaction-epoch.mjs` 的 `createEpochPromotion`（与 tool-bootstrap 同源），保证 session 维度幂等、compaction/epoch 行为一致。
- **失败降级**：swap 抛错 → warn once + 保持 persistent bash（目录全开但无提权），**绝不 brick 会话**（照抄 tool-bootstrap 的 degrade 哲学）。
- **subagents**：`includeSubagents` 的 swap 语义——子代理首轮同锚定，promotion 后是否也 swap？默认 yes（与 tool-bootstrap 同步），spike 验证 spawned 上下文里 dispose/register 是否并发安全。

### 3.3 状态机

```
[首轮] 目录={bash(persistent), str_replace_editor}, 注入=off
   │  首个 durable tool/call（promotion）
   ▼
[promoted] swap: dispose persistent bash → register dsh-tool-bash
   │
   ▼
[二轮起] 目录=complete, AGENTS.md 注入=on, bash=沙箱(提权=on)
```

### 3.4 设计决策点（落定前需用户拍板）

> **决策状态（2026-08-20 用户确认）**：D1 不回滚 ✓ · D2 放回 ✓ · D3 开启 ✓ · D4 第二优先级(w32 二期) ✓ · **D5 待 M2 spike 验证**。

| # | 决策 | 默认建议 | 理由 |
|---|---|---|---|
| D1 | compaction 后 fallback 到 bootstrap 对时，bash 是否**回滚**为 persistent？ | **不回滚**（保持沙箱 bash） | standard-bootstrap 语义如此；回滚需二次 swap，增加复杂度与风险 |
| D2 | 二轮起 skill-catalog 是否放回？ | **放回**（挂 `tool-skill`） | 用户只要求 AGENTS.md；但「二轮完整面」更贴 standard 语义；若 5/5 实验发现二轮目录扰动，再降级为 liangshen 的 `skill-search` |
| D3 | `enableRunInBackground` 是否开启 | 开启（standard 默认） | 与 standard-bootstrap 一致 |
| D4 | win32 是否首期支持 | **第二优先级** | custom-bash + windows-acl 沙箱的 swap 另有窗口，不影响 darwin 主线 |
| D5 | 首轮 persistent shell 起的后台任务在 swap 时的销毁语义 | 需 spike 确认 terminal 组 dispose 行为 | 见 §4.3 |

---

## 4. 边界与风险

1. **同名工具同层冲突（系统性死结）**——swap 顺序与层次必须 spike 验证；选 3.2(a) 的插件自持生命周期路线。
2. **PTY 状态丢失**：首轮 persistent shell 的 `cd`/export/后台任务随 dispose 销毁。沙箱 bash 每次 `bash -c` 全新进程，行为天然一致；首轮是锚定轮、活少，影响可接受——写入 preset 注释与 README。
3. **首轮后台任务销毁语义**：若首轮在 persistent shell 里起了 `sleep 10 &` 这类进程，swap 时 terminal 组的 dispose 会不会杀进程？spike 验证（D5）。
4. **二轮注入/目录扰动无实测**：0/9 只覆盖「首步带目录」。二轮放回 AGENTS.md + skill-catalog 的扰动只能靠 §5 实验 A/B 组实测。
5. **`dsh-agent-instructions` 注入体积**：`maxBytes: 65536` 上限照抄 standard-bootstrap；用户若在 `~/.dsh/AGENTS.md` 放了超大内容，二轮第一条 user 消息会很大——可接受，与 standard 行为一致。
6. **锚定敏感度**：persona 从 liangshen 的 `complete: true` 改为 standard 版，系统提示词更长/有 runtime context——**首轮 schema 才是锚定自变量，persona 文案差异是否扰动锚定没有数据**，必须进 §5 实验（组 A 即验证此点）。

---

## 5. 5/5 复测实验方案（新组合验证）

> 目的：回答两个问题——
> Q1（锚定）：三合一首轮是否仍锚定（首行直接干活、零 `let me`）？
> Q2（二轮完整性）：promotion 后 AGENTS.md 是否自动注入、bash schema 是否含 `sandbox_permissions`、目录是否 complete？

### 5.1 口径（照抄 issues #6/#11 复现实验）

- **指标**：首行模式分类（`let me` / `We need` 类 / 直接 tool call）；锚定 = 该组跑次中「零 `let me` 首行」的比例。
- **基线参照**：Minimal 对 5/5 锚定（81% 口径）；标准系 11/11 标准行为；带 skill-catalog 首步 0/9。
- **每跑环境**：全新 session（避免 promotion memo 与 tool seed 串扰）、`maxTokens` = adapter default（256000）、同一模型（与复现实验同款 V4 系，当前部署 `deepseek-v4-flash`）、同一任务 prompt 模板。

### 5.2 实验组

| 组 | 配置 | 验证点 | 预期 |
|---|---|---|---|
| **A** | liangshen+ 全量（本方案组合 preset） | 首轮锚定 + 二轮注入 + 二轮提权 | 首轮锚定率 ≈ 基线档（5/5 或 81% 量级）；二轮两项检查全过 |
| **B** | liangshen+ 且工作区放置**有实际内容的 AGENTS.md**（构造注入体） | 二轮注入是否扰动轨迹/质量（无历史数据，探索性） | 记录二轮起首行与工具序列变化；扰动若显著 → 评估是否接受 |
| **C** | liangshen 原样（对照组） | 复现 5/5 基线，校验 runner/环境有效性 | ≈5/5 |
| **D** | standard-bootstrap 原样（对照组） | 复现 11/11 标准行为基线 | ≈11/11 标准行为 |

每组默认 **N=9~11 跑**（对齐 0/9 与 11/11 的量级；若首轮锚定率已达 5/5 量级可提前判过，不必跑满）。

### 5.3 每跑记录清单

1. 首行原文（分类打标：`let me` / `We need` / tool call / 其他）
2. 首次 tool 调用：工具名 + 参数概要 + 发生轮次
3. 二轮请求的 system/user 上下文：是否含 `~/.dsh/AGENTS.md` 或工作区 AGENTS.md 摘要（按 source.kind=agent-instructions 观测）
4. 二轮起的 bash schema：是否含 `sandbox_permissions` / `justification`（按 assembly 快照观测）
5. （B 组）二轮起连续 5 轮的工具序列，与无注入对照对比

### 5.4 验收口径

- **通过**：A 组首轮锚定率达到 C 组基线量级（差 ≤ 1 跑），且二轮检查 3、4 全过。
- **失败**：A 组锚定率显著低于基线 → 证明 persona/runtime context 或组合本身破坏了锚定，方案降级（见 5.5）。
- **存疑**：锚定率达标但 B 组显示二轮注入严重扰动后续轨迹 → 按 D2 决策降级 skill-catalog 或推迟 AGENTS.md 恢复，记录数据后回写本文档。

### 5.5 降级路径（预先把失败写清楚）

| 场景 | 降级 |
|---|---|
| A 组不锚定 | 放弃三合一；回退 liangshen（最接近），另以独立 patch 单独加二轮 AGENTS.md 注入（可接受的半程解） |
| A 组锚定但二轮提权不可用 | 检查 swap 注册路径（3.2 路径 a/b），spike 层修复，不进 5/5 复测 |
| B 组扰动显著 | skill-catalog 换 skill-search（liangshen 方案）、AGENTS.md 延迟到第二轮稳定后注入，数据回写 |

---

## 6. 里程碑与任务拆解

| 步骤 | 内容 | 验证 |
|---|---|---|
| M1 | 本文档定稿（含用户拍板 §3.4 决策） | 审阅通过 |
| M2 | spike：`phase-swap-bash.mjs` 最小实现（路径 a）+ 单测（dispose/register 顺序、同名冲突、promotion 判定幂等、失败降级） | 单测绿 + 手工会话首轮/二轮目录观察 |
| M3 | 组合 preset 装配 + 手工会话冒烟（首轮目录=bash+str_replace_editor；二轮 AGENTS.md 注入 + bash 带提权参数） | 冒烟通过 |
| M4 | §5 实验 A/B/C/D 全部组别执行并记录 | 数据表 + 判定 |
| M5 | 结果回写本文档；决策 merge 进 standard-bootstrap 还是独立 preset；README/索引更新；收尾 commit | merge 定稿 |

---

## 7. 未决问题（open questions）

1. issues #6/#11 的复现实验 **runner 与任务 prompt 原文**在哪（tracker 上的 issue 记录；本仓库无存档）——§5 需复用同一任务模板才能对齐口径。
2. `ctx.tools` rc.8 是否暴露 **remove-by-name** 接口（3.2 路径 b 的可行性）。
3. `persistent-shell` 组 terminal dispose 对**运行中后台进程**的语义（D5）。
4. swap 后 `str_replace_editor`（本地裸 fs）**是否保留**在目录里——保留则二轮起同时有沙箱 fs 与本地编辑器（liangshen 现状即保留），需确认无歧义。
5. 首轮 persona 差异（standard 版 vs liangshen 的 `complete: true`）是否会扰动锚定——由 §5 组 A 直接回答，但结果未知。
6. 二轮起 `dsh-agent-instructions` 注入的**时间点**：promotion 事件发生在第一个 tool/call 的**结果返回后**还是调用瞬间——决定第二轮请求是否一定能带上注入（需确认事件序）。

---

## 8. 相关文件索引

- 设计：`presets/liangshen-plus/agent.cordis.yml`（待建）、`presets/liangshen-plus/phase-swap-bash.mjs`（待建）
- 复用：`presets/liangshen/tool-bootstrap.mjs`、`presets/liangshen/compaction-epoch.mjs`、`presets/liangshen/custom-bash.mjs`、`presets/liangshen/agent.cordis.yml`
- 包依赖：`@deepseek-ai/dsh-tool-bash`（沙箱 bash）、`@deepseek-ai/dsh-tool-bash-persistent`（持久 bash）、`@deepseek-ai/dsh-tools`（注册/disposer）、`@deepseek-ai/dsh-agent-instructions`（注入）、`@deepseek-ai/dsh-sandbox`（`ESCALATION_TARGETS`）
- 部署位：`~/.dsh/.agent-presets/liangshen-plus/` + `~/.dsh/profiles/endless-tui/cordis.patch.yml` 里 `preset` 指向或 CC_TUI_PRESET 切换