# liangshen-bash preset 自研实施/验收文档

> 状态：已定稿，实施中（Phase 0/1/2/3 完成；Phase 2.5 纯函数完成、真实 Windows 冒烟阻塞；Phase 4 部署+本地 commit 完成，push 待用户批准）。
> 目标：把 `liangshen-bash` preset 对 `@deepseek-harness-tui/dsh-tui` 的 vendored 依赖去掉，改为自研实现（方案 B）。
> 前置：已评估风险（tool-bootstrap 行为锚定不可单测、harness 契约漂移、降级守卫易丢失、维护责任转移）。本文档把风险转成可执行的契约测试 + 轨迹实测验收，未通过验收不允许关闭。

---

## 1. 范围界定

### 1.1 目标文件

| 文件 | 现状 | 处理 |
| --- | --- | --- |
| `presets/liangshen-bash/vendor/.../compaction-epoch.mjs` | 自研代码（非第三方），只是放在 vendor 目录 | **移出 vendor** → `presets/liangshen-bash/compaction-epoch.mjs`，零行为变化 |
| `.../tool-bootstrap.mjs`（300 行） | 第三方 | **自研替换**（唯一高复杂度项） |
| `.../instruction-hint.mjs`（181 行） | 第三方 | 自研替换 |
| `.../skill-search.mjs`（142 行） | 第三方 | 自研替换 |
| `.../custom-bash.mjs`（301 行） | 第三方；darwin 上 `disabled`，win32 是设计第二优先级 | **保留并自研替换**（win32 支持已确认；Phase 2.5，需 Windows 冒烟） |

### 1.2 非目标

- 不改 `phase-swap-bash.mjs` 的现有逻辑（它已是自研，只调整对 `compaction-epoch` 的导入路径）。
- 不改 `agent.cordis.yml` 的语义（行顺序、config、`tool:`/`tools:` 过滤规则）。
- 不引入 npm 依赖（那是方案 A，本方案是 B）。
- darwin 与 win32 双平台均维护（已确认）。

---

## 2. 行为契约清单（自研必须复刻的契约）

以下契约来自当前 vendor 文件 + harness 实际实现，是自研的**不可变规格**。任何不符即视为失败。

### 2.1 harness 事件/瀑布形状（已验证的当前版本）

| 契约 | 形状来源 | 说明 |
| --- | --- | --- |
| `system-prompt/assemble` | `(assembly, context, next) => Promise<assembled>` | `assembled.tools: [{name}]`、`assembled.sections: [{name}]`；`next()` 返回完整组装 |
| `agent/pre-step` | `async ({agent, signal}, next) => decision` | `decision.kind === 'reject'` 直接放行；`decision.messages: [{id, role, content, source:{kind,form}}]` |
| `agent/request` | `async (payload, next) => resolved` | `payload.agent`；`resolved.maxTokens` 可裁剪 |
| `agent.inject` | `agent.inject({id, role, content, source})` | 非唤醒下轮注入；`source.kind: 'skill-invocation'` 不被 bootstrap 剥掉 |
| `ctx.skills.list/get` | `(scope, {cwd, signal})` / `(name, {scope, cwd, signal})` | skill 元数据含 `name/description/whenToUse`；加载内容在 `content/instructions/body` |
| `ctx.fs` | `fs.resolve(path, {cwd, signal})` + `fs.stat(target, signal)` | 探测文件存在；探测失败 = 不存在 |
| 事件序列/压缩 | `compaction/end` 重置 promotion；resume/reload 需冷扫描日志重建相位 | 统一走 `compaction-epoch` |

### 2.2 tool-bootstrap 必须保留的语义

1. **首轮工具目录**：未 promoted 时 `assembled.tools` 只保留 `['bash','str_replace_editor']`（即 `bootstrapTools` 默认值）；promoted 后放行全量。
2. **compaction 后**：回到 controlled phase（`boundary >= 0` 时按 `compactionTools` 追加工作集；默认空 = 保持双工具）。
3. **promote 事件**：默认 `promoteOn` 沿用 preset 配置的 `tool-call`（`['tool/call']`）；`assistant-message` / `either` 保留为配置选项。
4. **上下文剥除**：默认 `suppressedContextSources = ['skill-catalog','agent-instructions']`，未 promoted 时从 `decision.messages` 过滤 `message.source.kind` 命中项；promoted 或显式空数组 → 不过滤。
5. **fail-open 铁律**：
   - 缺 `bootstrapTools` 中的工具 → warn once + 暴露全量目录（绝不让会话 brick）；
   - `assemble`/`pre-step` 过滤器自身抛错 → 返回未过滤的原始结果 + warn；
   - `reject` 决策原样放行。
6. **子代理**：`includeSubagents: true` 时子代理走同样的 bootstrap/promotion 周期；`false` 时子代理直接 promoted。
7. **maxTokens 可选**：`bootstrapMaxTokens` 缺省 = 不裁剪（沿用 adapter 默认）；设置时未 promoted 注入、promoted 且 `resolved.maxTokens === bootstrapMaxTokens` 时剥离。**本期建议先不移植该可选配置**（preset 未启用），但保留配置校验入口。

### 2.3 instruction-hint 必须保留的语义

1. 仅 promoted 会话注入一次（per session，`hinted` 集合去重；resume 后冷扫描 promoted 也不会重复注入历史消息——原因是注入发生在运行时 pre-step，不写日志）。
2. 探测 `session.header.cwd` 向上找 project root（`.git/.hg/.svn` 任一存在），列出 `AGENTS.md/CLAUDE.md/AGENTS.local.md/CLAUDE.local.md`；再探测 `$DSH_HOME/AGENTS.md`（无 `DSH_HOME` 时用 `USERPROFILE\.dsh`）。
3. 注入消息：
   - `source.kind: 'instruction-hint'`（**不在** bootstrap 的 suppressed 集合，promoted 后也不会被剥）；
   - 原文措辞必须保留："Do NOT assume their content..." 那段。
4. 失败降级：任何探测/注入异常 → warn once + 原样返回 decision，绝不影响请求。

### 2.4 skill-search 必须保留的语义

1. 注册 `skill_search` + `skill_load` 两个工具（名称、描述、参数 schema、输出 schema 与现有逐字一致）。
2. `skill_search`：token 化查询（`/^[a-z0-9_-]+/` 分段），对 `name + description + whenToUse` 做 substring 全 token 匹配；空查询返回全部；上限 20 条 + 剩余计数。
3. `skill_load`：`ctx.skills.get` 精确名；未命中/无内容给明确文本；命中后 `agent.inject({..., source:{kind:'skill-invocation', name, form:'instructions'}})`。
4. 失败降级：`skill_search` 不可用时返回错误文本而非 throw；`skill_load` 失败返回错误文本。

### 2.5 custom-bash（保留 win32，必须复刻）

- 保持 `disabled: !!js process.platform !== 'win32'`。
- Git Bash 解析顺序（显式配置/环境变量 → git 安装树 → 常规根 → Scoop 根 → PATH 裸 `bash`）必须逐字复刻。
- WSL launcher 拒绝（`C:\Windows\System32\bash.exe` / Sysnative 恒拒绝）、Scoop `.shim` 跟随、显式路径 fail-loud。
- 语义：fresh process（无持久状态）、non-zero exit 转报告不 throw、输出有界、description 注明无 OS 沙箱。
- Windows 冒烟协议：在真实 Windows（或 CI Windows runner）上验证 `resolveWindowsBash` 至少命中一个候选、执行 `echo` 成功、WSL 路径被拒、缺 bash 时 warn + 跳过注册（fail-open）。

---

## 3. 实施方案（分阶段）

### Phase 0：抽出自研文件（0.5 人日）

- `git mv` compaction-epoch 到 `presets/liangshen-bash/compaction-epoch.mjs`。
- 更新 `phase-swap-bash.mjs` 与后续自研文件的相对导入。
- 删除 `presets/liangshen-bash/vendor/` 目录（整个第三方树）。
- 验证：`npm test` 仍 65 pass；`dsh --profile tui-dev` 冷启动一个会话不报 preset mount 失败。

### Phase 1：契约测试先行（2 人日）

在实现前先写 **真实 dsh 运行时契约测试**（仿 `phase-swap-bash.test.mjs` 的 boot 方式）：

| 测试文件 | 覆盖 |
| --- | --- |
| `presets/liangshen-bash/tool-bootstrap.test.mjs` | fresh / promoted / compaction / resume 四态的 assembled.tools 与 sections；pre-step messages 过滤与 reject 放行；缺工具 fail-open；过滤器抛错 fail-open |
| `presets/liangshen-bash/instruction-hint.test.mjs` | promoted 注入一次、未 promoted 不注入、探测文件存在/不存在、注入消息形状与 source.kind、异常降级 |
| `presets/liangshen-bash/skill-search.test.mjs` | 两个工具注册形状、查询匹配/空查询/上限、load 未命中/命中注入形状、失败降级 |
| `presets/liangshen-bash/custom-bash.test.mjs` | 纯函数测试：`windowsBashCandidates` 排序、`isWindowsSubsystemLauncher`、`resolveShimTarget`、`bashCandidatesFromGit`（不依赖真实 Windows 即可跑） |
| `presets/liangshen-bash/smoke-boot.mjs` 扩展 | 组装上述四插件 + phase-swap 的完整 preset 冒烟 |

验收：这些测试**先写、先红**（vendor 行为为基准可先抄断言），自研实现后**全绿**。

### Phase 2：实现三个自研插件（2–3 人日）

- `presets/liangshen-bash/tool-bootstrap.mjs`
- `presets/liangshen-bash/instruction-hint.mjs`
- `presets/liangshen-bash/skill-search.mjs`
- 每个文件 < 300 行，导出 `name / apply / inject`（`inject` 保持原文件的声明：tool-bootstrap/instruction-hint 为空、skill-search 为 `['agents','tools','skills']`）。
- `agent.cordis.yml` 五个本地行名从 `./vendor/...` 改为 `./tool-bootstrap.mjs` 等新路径。
- 更新 `scripts/sync-agent-presets.sh` 复制新文件、不再复制 vendor。
- 更新 `docs/deployment.md` 与 `docs/liangshen-bash-preset-design.md` 的文件清单。

### Phase 2.5：自研 custom-bash（2 人日，win32）

- `presets/liangshen-bash/custom-bash.mjs`：复刻 §2.5 全部契约。
- 纯函数单测（候选路径、WSL 拒绝、shim、git 树推导）在 mac/CI 跑。
- 真实 Windows 冒烟（见 §2.5）**必须通过**才能收尾；无 Windows 环境则保持该 phase 阻塞，不得以「应该没问题」关闭。

### Phase 3：轨迹实测（1 人日）

首轮锚定行为无法单测，必须实机验证：

1. 用 `dsh --profile tui-dev` 建 **5 个新会话**，各自只发一个简单任务（如 "列出当前目录"）。
2. 检查每个会话的第一个 `request/header`：
   - `tools` 数组 == `['bash','str_replace_editor']`（或 harness 序列化后的等价集合）；
   - **不含** skill/instruction 注入消息；
   - 首条 assistant 文本**不是** "Let me..." / "I'll..." 式的未锚定开场（沿用 M4 check4 口径）。
3. 判定：5/5 锚定为通过；3/5 以下为失败；4/5 需人工复核。

### Phase 4：部署与收尾（0.5–1 人日）

- `scripts/sync-agent-presets.sh` 干跑到临时 DEST，验证：目录无 vendor、5 个本地文件齐全、`node_modules/@deepseek-ai` 链接存在、从部署位 import 全部插件成功。
- 对真实 `~/.dsh/.agent-presets` 执行 sync。
- `dsh --profile tui` 实测：新会话首轮锚定 + promotion 后全量 + compaction 后回到双工具 + resume 后冷扫描 promoted 立即 swap（与 phase-swap 测试一致）。
- 删除本仓库残留 vendor 引用（grep 全仓）。
- commit（push 需用户批准）。

---

## 4. 验收标准（Done 定义）

| # | 标准 | 验证方式 |
| --- | --- | --- |
| 1 | 仓库 `vendor/` 与 `presets/.../vendor/` 全部移除，grep 无 `@deepseek-harness-tui/dsh-tui` 路径引用 | `rg "@deepseek-harness-tui"` 零命中（docs 历史说明除外） |
| 2 | `npm test` 全部通过（≥65，含新增三个契约测试文件） | `npm test` |
| 3 | `npx tsc --noEmit` 通过 | tsc |
| 4 | 契约测试覆盖表 2 全部语义点 | 测试断言在 PR 里可追溯 |
| 5 | 轨迹实测 5/5 锚定（4/5 需人工复核并说明） | `request/header` 日志 + 首条文本 |
| 6 | 部署位 sync 后插件全部可导入、`dsh --profile tui` 正常挂载 | 部署冒烟 |
| 7 | 降级路径实测：故意制造 tool-bootstrap 缺工具/抛错，会话仍能继续 | 临时配置注入测试 |
| 8 | 文档同步（设计文档 §3 部署位、deployment.md、README） | grep 无过期路径 |
| 9 |（win32）custom-bash 纯函数测试全绿 + Windows 冒烟通过（解析/执行/WSL 拒绝/缺 bash fail-open） | Windows runner 日志 |

---

## 5. 回滚方案

- 自研文件与 `phase-swap-bash` 同目录共存，git 历史可回退到 `d8371ae`（vendor 版最后一次正常状态）。
- 若轨迹实测未过：**禁止合并**，保留 vendor 树分支，回滚 `agent.cordis.yml` 行名即可单文件回退。
- `~/.dsh/.agent-presets` 部署位：sync 前备份 `agent.cordis.yml` + `vendor/`（`cp -R` 一份 `.bak-vendored`），回滚时 restore 并重跑 link。

---

## 6. 风险与缓解（实现期执行）

| 风险 | 缓解 |
| --- | --- |
| harness 契约漂移（rc 升级） | 契约测试在真实 dsh 运行时上跑，升级 dsh 前先跑测试；文档记录 `pin 版本` |
| 首轮锚定回归 | Phase 3 轨迹实测为硬性闸门，不达标不开下一 phase |
| 降级守卫丢失 | 测试专门覆盖 fail-open/reject/异常三条路径（表 4 #7） |
| custom-bash 遗留 | 已确认保留 win32：纯函数在 darwin/CI 跑，真实 Windows 冒烟必须通过；无 Windows 环境则该 phase 显式阻塞 |
| 维护责任 | 接受自研即接受长期维护；建议保留一份 vendor 原文件在 `docs/reference/` 作为语义参考（不入运行路径） |

---

## 7. 排期汇总

| Phase | 内容 | 估时 |
| --- | --- | --- |
| 0 | 抽出 compaction-epoch、删 vendor | 0.5 人日 |
| 1 | 契约测试先行 | 2 人日 |
| 2 | 实现三个自研插件 + 配置接线 | 2–3 人日 |
| 2.5 | 自研 custom-bash（win32） | 2 人日 |
| 3 | 轨迹实测（5 会话锚定） | 1 人日 |
| 4 | 部署同步 + 收尾 | 0.5–1 人日 |
| **合计** | | **8–9.5 人日**（含 win32） |

---

## 8. 待用户确认

1. ~~custom-bash 是否保留 win32~~ —— 已确认：**保留 win32 支持**（Phase 2.5，排期 +2 人日）。
2. ~~文档状态标记~~ —— 已定稿，进入实施。

---

## 9. 实施记录（2026-09-03）

| 项 | 记录 |
| --- | --- |
| Phase 0 | `compaction-epoch.mjs` 已 `git mv` 到 `presets/liangshen-bash/`；`phase-swap-bash.mjs` 导入改 `./compaction-epoch.mjs`；`presets/liangshen-bash/vendor/` 已删除 |
| 参考副本 | 原 vendor 树复制到 `docs/reference/liangshen-bash-vendor/`（§6 风险缓解，仅语义参考、不入运行路径、不参与 sync） |
| Phase 1 | 四个契约测试文件先红后绿：tool-bootstrap 10、instruction-hint 6、skill-search 8、custom-bash 8（合计 32 新断言） |
| Phase 2 | 三个自研插件已落地并按相对路径接线；`sync-agent-presets.sh` 改复制本地 mjs、不再复制 vendor；`package.json` test 纳入四个新测试 |
| 发现并修复 | 真实 harness 下 `phase-swap-bash` 的 spy ctx 基于 `agent.ctx` 未声明 `shell/systemPrompt/shellEnv`，swap 抛 `cannot get property "shell" without inject`；改为 `agent.ctx.inject(['tools','shell','systemPrompt','shellEnv'])` 且 spy ctx 基于 `injectedCtx` 派生（单测环境不拦截属性访问，因此只有 repo-local smoke 能暴露） |
| smoke | `smoke-boot.mjs` 增加 `roots:[repo presets]` 直挂本地自研文件；ROUND2 断言扩展：sandbox bash 生效、skill_search/skill_load 在目录、pre-step 含 instruction-hint + host 恢复的 skill-catalog；实测通过、无 warn |
| Phase 2.5 | `custom-bash.mjs` 自研落地，8 个纯函数测试全绿（darwin/CI 可跑）；真实 Windows 冒烟待 Windows 环境，显式阻塞 |
| 验收 #7 降级实测 | `scripts/degrade-smoke.sh`：临时把 `bootstrapTools` 注入不存在的工具后跑真实 headless 挂载冒烟 → R1 暴露全量目录 + warn once，R2 仍正常（sandbox bash/注入全过），会话不 brick |
| Phase 3 | 已跑：`dsh --profile headless --patch presets/liangshen-bash/trajectory.patch.yml`（真实 LLM `opencode-go/deepseek-v4-flash`）5 个新会话全部通过 `tools==['bash','str_replace_editor']`、零注入、无未锚定开场；证据 `experiments/liangshen-bash-trajectory-2026-09-03/`（5/5）；tui-dev 字面交互执行待用户确认 |
| Phase 4 | 部署 sync 已执行：备份 `liangshen-bash.bak-vendored` 后同步到 `~/.dsh/.agent-presets`，无 vendor、本地 mjs 齐全、可导入；部署位冒烟通过（`SMOKE_PRESET_ROOT=~/.dsh/.agent-presets node presets/liangshen-bash/smoke-boot.mjs`，R1/R2 全过、无 warn）；本地 commit `f905418`/`37f0217`/`4704c85` 完成；push 待用户批准 |