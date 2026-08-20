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

**→ 方案核心（M2 实证修订）**：复用 liangshen 首轮（persistent bash + `str_replace_editor` + 首轮抑制注入），在 **promotion 事件**里对该 agent 的 ctx 调用 `dsh-tool-bash` 的 `apply()`——注册进该 agent 自己的 scope layer，**shadow 掉**共享的 persistent bash（沙箱 + 提权），无需 dispose 任何共享实例。第二轮起该 agent 目录即 complete，注入与提权同时恢复。

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

**职责**：首个 durable tool/call 发生时，把该 agent 可见的 `bash` 从 persistent 实例切换为沙箱 `dsh-tool-bash`。

**M2 spike 实证结论（2026-08-20，rc.8 运行时）**：原设计稿的 dispose+register 路径（下方"关键点"）
**不成立也不需要**——实测定案为 **per-agent shadow**：

1. `dsh-tool-bash-persistent.apply()` 与 `dsh-tool-bash.apply()` **都不返回 register() 的 disposer**
   （两者都只调 `ctx.tools.register(...)` 不返回），路径 (a) 的"插件自持 disposer"无法直接从
   包 API 获得；`ctx.tools` rc.8 **也没有 remove-by-name 接口**（NamedEntries 只有 insert 的
   undo，无按名删除）。
2. 实证（rc.8 真实包）：`agent.ctx.tools.register()` 会注册进**该 agent 自己的 scope layer**，
   `view(scopeOf(agent.ctx))` 对该 agent 显示 shadow 后的工具，**其他 agent 仍看到全局层**的
   persistent bash。所以 swap 只需对该 agent 的 ctx 调 `dsh-tool-bash.apply()`，**无需 dispose
   任何共享实例**，天然 per-session/per-subagent 隔离（S3 成立），同层同名冲突根本不会发生
   （不同层，S2 成立）。
3. 实现细节（踩坑记录）：
   - 插件 `inject = []` 纪律下**不能用属性访问** `ctx.agents`（cordis 抛 `cannot get property
     "agents" without inject`）——用 `ctx.get('agents')` 显式解析（同 dsh-tui `rosterOf`）。
   - `dsh-tool-bash.apply(agent.ctx, ...)` 内部属性访问 `ctx.shell` 同样会被 inject 检查拦截——
     需 `await agent.ctx.inject(['tools','shell','systemPrompt','shellEnv'], (injectedCtx) =>
     sandboxBash.apply(injectedCtx, config))` 建立注入子 ctx。
   - 整个 swap 逻辑包进 try/catch：任何一步抛错 → warn once + 保持 persistent bash，绝不 brick。

```
export const name = 'phase-swap-bash'
export const inject = []          // 同 tool-bootstrap：事件时取服务，不静态 inject
export function apply(ctx, config) {
  const promotion = createEpochPromotion(['tool/call'], { includeSubagents: true })
  ctx.on('session/event', (session, event) => promotion.observe(session, event))

  ctx.on('session/event', async (session, event) => {
    if (event.type !== 'tool/call') return
    if (swapped.has(session.id)) return
    try {
      const agent = ctx.get('agents')?.get(session.id)   // 显式 get，非属性访问
      if (agent === undefined) return
      if (!promotion.status(agent).promoted) return
      swapped.add(session.id)                            // 幂等：每次 promotion 只 swap 一次
      // per-agent shadow：对 agent.ctx 注册沙箱 bash → 该 agent 的 layer 覆盖全局 persistent
      await agent.ctx.inject(['tools', 'shell', 'systemPrompt', 'shellEnv'], (injectedCtx) => {
        sandboxBash.apply(injectedCtx, { enableRunInBackground: config.enableRunInBackground ?? true })
      })
    } catch (error) {
      warnOnce(`${name}: swap failed, keeping persistent bash: ${String((error && error.message) || error)}`)
    }
  })
}
```

关键点（原设计稿的 spike 验证项 → 实证结果）：

- ~~注销方式 (a)/(b)~~：**都不需要**——per-agent shadow 不 dispose 共享 persistent bash；
  disposer 无处可拿（apply 不返回）、remove-by-name 不存在（rc.8 无此接口），恰好都不是问题。
- ~~顺序（先 dispose 后 register）~~：**不需要**——不同层同名不冲突（S2 实证）。
- **执行路径**：promotion 判定复用 `compaction-epoch.mjs` 的 `createEpochPromotion`
  （与 tool-bootstrap 同源），session 维度幂等、compaction/epoch 行为一致（单测覆盖幂等）。
- **失败降级**：swap 抛错 → warn once + 保持 persistent bash（目录全开但无提权），绝不 brick
  会话（单测覆盖：缺 sandboxPolicy 时 swap 抛错被吞 + persistent 保留）。
- **subagents**：`includeSubagents: true` 下子代理首轮同锚定（全局 persistent bash 仍在），
  各自 promotion 后独立 swap（per-agent layer 隔离，单测覆盖父子独立 swap）。

### 3.3 状态机

```
[首轮] 目录={bash(persistent), str_replace_editor}, 注入=off
   │  首个 durable tool/call（promotion）
   ▼
[promoted] swap: 对该 agent 的 ctx 注册沙箱 bash（per-agent shadow，全局 persistent 不动）
   │
   ▼
[二轮起] 该 agent 目录=complete, AGENTS.md 注入=on, bash=沙箱(提权=on)
```

### 3.4 设计决策点（落定前需用户拍板）

> **决策状态（2026-08-20 用户确认）**：D1 不回滚 ✓ · D2 放回 ✓ · D3 开启 ✓ · D4 第二优先级(w32 二期) ✓ · **D5 M2 spike 已答（2026-08-20）：shadow 方案不销毁后台任务**。

| # | 决策 | 默认建议 | 理由 |
|---|---|---|---|
| D1 | compaction 后 fallback 到 bootstrap 对时，bash 是否**回滚**为 persistent？ | **不回滚**（保持沙箱 bash） | standard-bootstrap 语义如此；回滚需二次 swap，增加复杂度与风险 |
| D2 | 二轮起 skill-catalog 是否放回？ | **放回**（挂 `tool-skill`） | 用户只要求 AGENTS.md；但「二轮完整面」更贴 standard 语义；若 5/5 实验发现二轮目录扰动，再降级为 liangshen 的 `skill-search` |
| D3 | `enableRunInBackground` 是否开启 | 开启（standard 默认） | 与 standard-bootstrap 一致 |
| D4 | win32 是否首期支持 | **第二优先级** | custom-bash + windows-acl 沙箱的 swap 另有窗口，不影响 darwin 主线 |
| D5 | 首轮 persistent shell 起的后台任务在 swap 时的销毁语义 | **不销毁**（shadow 不 dispose PTY） | M2 spike 实证：per-agent shadow 不动共享 persistent bash/PTY，首轮 `sleep 10 &` 等后台任务继续运行；PTY 随 preset 卸载才回收（见 §4.3） |

---

## 4. 边界与风险

1. **同名工具同层冲突（系统性死结）**——M2 实证：per-agent shadow 在不同 layer 注册同名 `bash`，**冲突不发生**（S2 通过）；无需 dispose/remove-by-name（rc.8 两者都不可用）。
2. **PTY 状态丢失**：shadow 方案 **不 dispose** persistent shell，首轮的 `cd`/export/后台任务**不随 swap 丢失**；沙箱 bash 每次 `bash -c` 全新进程，二轮起无状态行为与 standard 一致。
3. **首轮后台任务销毁语义（D5）**：swap 不动共享 persistent bash/PTY → 首轮起的 `sleep 10 &` 等后台任务**继续运行**（M2 结论）。资源回收路径（源码证据，dsh-tool-bash-persistent lib）：插件级 `ctx.effect` cleanup 在 **preset 卸载**时 kill 所有 live shells（174-182 行）；per-agent 的 `owner.ctx.effect` 只清缓存 map 不杀 PTY（201-207 行）——即 **session 结束 PTY 可能残留到 preset 卸载**（进程内一次性），属可接受资源语义，写入 preset 注释。
4. **二轮注入/目录扰动无实测**：0/9 只覆盖「首步带目录」。二轮放回 AGENTS.md + skill-catalog 的扰动只能靠 §5 实验 A/B 组实测。
5. **`dsh-agent-instructions` 注入体积**：`maxBytes: 65536` 上限照抄 standard-bootstrap；用户若在 `~/.dsh/AGENTS.md` 放了超大内容，二轮第一条 user 消息会很大——可接受，与 standard 行为一致。
6. **锚定敏感度**：persona 从 liangshen 的 `complete: true` 改为 standard 版，系统提示词更长/有 runtime context——**首轮 schema 才是锚定自变量，persona 文案差异是否扰动锚定没有数据**，必须进 §5 实验（组 A 即验证此点）。
7. **inject=[] 纪律的 cordis 服务访问**：事件时取服务必须用 `ctx.get()`（属性访问抛 "without inject"，M2 踩坑实证）；对 agent.ctx 调第三方 apply 需 `ctx.inject([...])` 建立注入子 ctx（§3.2）。

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
| ~~M2~~ | ~~spike：`phase-swap-bash.mjs` 最小实现（路径 a）+ 单测（dispose/register 顺序、同名冲突、promotion 判定幂等、失败降级）~~ | **✅ 完成（2026-08-20）**：per-agent shadow 定案；7 单测 + 24 存量全绿；无 LLM 组合冒烟通过（下节记录） |
| M3 | 组合 preset 装配 + 手工会话冒烟（首轮目录=bash+str_replace_editor；二轮 AGENTS.md 注入 + bash 带提权参数） | 冒烟通过（M2 已用 headless 组合 + assemble/pre-step 瀑布完成等价验证；真实 TUI 手工会话待用户跑） |
| M4 | §5 实验 A/B/C/D 全部组别执行并记录 | 数据表 + 判定 |
| M5 | 结果回写本文档；决策 merge 进 standard-bootstrap 还是独立 preset；README/索引更新；收尾 commit | merge 定稿 |

### 6.1 M2 spike 记录（2026-08-20）

**单测**（`node --test presets/liangshen-plus/phase-swap-bash.test.mjs`，7 项全绿，用部署包 rc.8 真实包）：

| 用例 | 验证点 |
|---|---|
| 首轮 agent 看到 persistent bash（仅 command 参数） | 锚定对 schema |
| tool/call 后 swap：agent view 含 sandbox_permissions/justification/run_in_background | S2 顺序正确性 |
| swap 幂等：二次 tool/call 不重复注册 | promotion 判定幂等 |
| per-agent 隔离：agent A swap 后 agent B 仍 persistent | S3 隔离 |
| includeSubagents：父子独立 swap | S3 子代理 |
| 失败降级：缺 sandboxPolicy → warn + 不 rethrow + persistent 保留 | S6 降级 |
| 配置校验：未知 key/非布尔值 apply 时抛错 | 配置纪律 |

**组合冒烟**（`node presets/liangshen-plus/smoke-boot.mjs`，headless profile 完整 bundle 组合 +
agent-presets 挂载 liangshen-plus，无 LLM 只走 assemble/pre-step 瀑布）：

```
ROUND1 catalog:   {"tools":["bash","str_replace_editor"],"bashParams":["command"]}          ← 首轮锚定对 ✓
ROUND1 pre-step:  []                                                                        ← 首轮零注入 ✓
ROUND2 catalog:   27 工具全量目录                                                           ← promotion 后 complete ✓
ROUND2 bashParams:["command","description","timeoutMs","workdir","run_in_background",
                   "sandbox_permissions","justification"]                                   ← 二轮 bash 沙箱提权 ✓
ROUND2 pre-step:  ["agent-instructions"]                                                    ← 二轮 AGENTS.md 注入恢复 ✓
WARNINGS:         []                                                                        ← swap 无失败 ✓
```

**踩坑记录（写回 §3.2/§4）**：`inject=[]` 纪律下 `ctx.agents` 属性访问抛 "without inject"
→ 用 `ctx.get('agents')`；对 agent.ctx 调 `dsh-tool-bash.apply()` 内部属性访问同样被拦 →
`agent.ctx.inject([...])` 建立注入子 ctx。

**部署位（S7 定案）**：插件 + preset + 冒烟脚本版本化在 repo `presets/liangshen-plus/`；
`~/.dsh/.agent-presets/liangshen-plus/` 只放 agent.cordis.yml + preset.yml（agent.cordis.yml
用绝对路径引用 repo 插件 + 部署包复用物）。取舍：复用物（tool-bootstrap/compaction-epoch）
**走部署包绝对路径**（随 @deepseek-harness-tui/dsh-tui 升级流动，无第二份拷贝，一致性风险=零
拷贝漂移）；代价是 repo 文件与 endless-tui profile 路径耦合——与 profile 现有绝对路径引用
（standard-bootstrap 引用部署包 tool-bootstrap）一致，可接受。

---

## 7. 未决问题（open questions）

1. issues #6/#11 的复现实验 **runner 与任务 prompt 原文**在哪（tracker 上的 issue 记录；本仓库无存档）——§5 需复用同一任务模板才能对齐口径。
2. ~~`ctx.tools` rc.8 是否暴露 **remove-by-name** 接口~~ —— **M2 已答**：NamedEntries 无按名删除，只有 insert 的 undo；且 per-agent shadow 方案不需要 remove（§3.2）。
3. ~~`persistent-shell` 组 terminal dispose 对**运行中后台进程**的语义（D5）~~ —— **M2 已答**：shadow 不 dispose PTY，后台任务不因 swap 被销毁；PTY 随 preset 卸载回收（§4 风险 3）。
4. swap 后 `str_replace_editor`（本地裸 fs）**是否保留**在目录里——保留则二轮起同时有沙箱 fs 与本地编辑器（liangshen 现状即保留），需确认无歧义。
5. 首轮 persona 差异（standard 版 vs liangshen 的 `complete: true`）是否会扰动锚定——由 §5 组 A 直接回答，但结果未知。
6. ~~二轮起 `dsh-agent-instructions` 注入的**时间点**~~ —— **M2 已答（组合冒烟）**：promotion 在 tool/call 的 `session/event`（调用瞬间）即生效，二轮 assembly/pre-step 一定带上注入（ROUND2 pre-step sources: `["agent-instructions"]`）。
7. 真实 TUI 手工会话（`CC_TUI_PRESET=liangshen-plus dsh --profile endless-tui`）的二轮 schema/注入肉眼验证——M2 用 headless 组合等价验证，TUI 面留待 M3 手工会话。

---

## 8. 相关文件索引

- 设计：`presets/liangshen-plus/agent.cordis.yml`（repo 版本化 + 部署 `~/.dsh/.agent-presets/liangshen-plus/`）、`presets/liangshen-plus/phase-swap-bash.mjs`（repo 版本化）
- 冒烟：`presets/liangshen-plus/smoke-driver.mjs`（无 LLM 两轮目录驱动）、`presets/liangshen-plus/smoke-boot.mjs`（headless 组合 + patches 启动）、`presets/liangshen-plus/phase-swap-bash.test.mjs`（7 单测）
- 复用（部署包绝对路径，S7 定案）：`@deepseek-harness-tui/dsh-tui/presets/liangshen/tool-bootstrap.mjs`、`.../compaction-epoch.mjs`、`.../custom-bash.mjs`
- 包依赖：`@deepseek-ai/dsh-tool-bash`（沙箱 bash，rc.8）、`@deepseek-ai/dsh-tool-bash-persistent`（持久 bash，rc.7）、`@deepseek-ai/dsh-tools`（scope layer 注册）、`@deepseek-ai/dsh-agent-instructions`（注入）、`@deepseek-ai/dsh-sandbox`（`ESCALATION_TARGETS`）
- 部署位：`~/.dsh/.agent-presets/liangshen-plus/`（agent.cordis.yml 绝对路径引用 repo）+ `CC_TUI_PRESET=liangshen-plus dsh --profile endless-tui` 切换