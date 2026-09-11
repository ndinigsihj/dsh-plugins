# 票据 03 证据 — 组合分叉与 persona 字段迁移

日期：2026-09-10
执行：ask-matt-flow Stage 5 Implement，票据 03（本窗口）
环境：Node v22.22.1；全局宿主 `@deepseek-ai/dsh@0.1.5-rc.1`；stable 隔离运行时 rc.2 未触碰
用户裁定（本窗口开工前确认）：第三条「宿主级部署 persona 配置」按「部署位副本 + 核实宿主层」处置——
部署位副本随组合源改用 `prefix`；宿主层 persona 由 `dsh-base` 自带、我侧无覆盖，只核实并记录，不改 profile。

## 0. 验收清单对照

| 票据 03 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 开发侧组合以独立标识存在，可被 profile 引用 | 通过 | §2（仓库源）、§3（部署位）；rc.1 discovery 报 healthy（§5.1） |
| 组合内的 persona 正文改用前缀字段 | 通过 | §2.2；rc.1 `dsh-persona` schema 接受（§5.2） |
| 宿主级部署 persona 配置改用前缀与后缀两个字段 | 通过（核实性） | §4：宿主层 persona 属 base 行（rc.2 `persona:''` → rc.1 `personaPrefix:''`），本部署四个 profile 补丁均无 `system-prompt` 覆盖 |
| 稳定侧组合文件未被修改 | 通过 | §6：`presets/minimal-plus/` git 无改动；部署位 8 文件 sha256 与开工前一致 |
| 稳定 profile 仍指向原组合标识 | 通过 | §6：`~/.dsh/profiles/tui/cordis.patch.yml` sha256 不变，行内仍为 `'minimal-plus'` |
| 开发侧 profile 的默认组合标识已切换 | 通过 | §4：`tui-dev` 与（停用中的）`tui-central` 均切到 `'minimal-plus-next'` |

## 1. 仓库改动

| 文件 | 改动 |
| --- | --- |
| `presets/minimal-plus-next/`（新增 18 文件） | 从 `presets/minimal-plus/` 整树复制；运行时 8 文件之外的测试/驱动一并随目录携带，保持 preset 自包含约定 |
| `scripts/sync-agent-presets.sh` | 支持 `[preset ...]` 参数；无参行为不变（仍只同步 `minimal-plus`）；新增 preset 目录存在性校验；输出带上依赖目标 |

新目录内相对 minimal-plus 的差异（`diff -ru` 全文核对，除下列外逐字一致）：

1. `agent.cordis.yml`：persona 行 `text:` → `prefix:`；文件头与 persona 注释说明分叉依据（ADR-0002）与「唯一字段差异」。
2. `preset.yml`：显示名改 `Minimal+提权+注入（next）`，描述标注开发侧 rc.1 变体，`order: 6 → 7`（picker 里排在 stable 之后）。
3. `smoke-boot.mjs`：自引用路径/默认 preset/驱动名/会话根改为 `minimal-plus-next`；`dsh-app-boot` 导入从共享 farm 改为 repo dev 依赖树（原因见 §7.2）；`INSTALL_ANCHOR` 仍指向全局 rc.1 安装位。
4. `smoke-driver.mjs`、`trajectory-driver.mjs`、`trajectory.patch.yml`、`test-helpers.mjs`、5 个 `*.test.mjs`：仅注释/路径/默认 preset id 跟随改名。

未动：`presets/minimal-plus/`（stable 源）整树、`lib/`、`plugins/`、`experiments/`、`package.json`（新目录的 5 个测试是 stable 副本的同内容拷贝，暂不重复加进 `npm test`；票据 04 修好会话接口后再决定是否纳入）。

`scripts/sync-agent-presets.sh` 行为验证（临时目标，不碰真实部署位）：

```
$ DSH_AGENT_PRESETS_DIR=/tmp/sync-test scripts/sync-agent-presets.sh minimal-plus-next
synced minimal-plus-next -> /tmp/sync-test/minimal-plus-next (deps: /Users/vito/.nvm/.../dsh/node_modules/@deepseek-ai)
$ DSH_AGENT_PRESETS_DIR=/tmp/sync-test scripts/sync-agent-presets.sh          # 无参 = 原行为
synced minimal-plus -> /tmp/sync-test/minimal-plus (deps: …rc.1 树)
$ DSH_AGENT_PRESETS_DIR=/tmp/sync-test scripts/sync-agent-presets.sh nope
error: no such preset directory: presets/nope   (exit 1)
```

## 2. 部署位（`~/.dsh/.agent-presets/minimal-plus-next/`）

命令：`scripts/sync-agent-presets.sh minimal-plus-next`（一次 `danger-full-access`，写入在工作区外）。

- 8 个运行时文件与仓库源 `presets/minimal-plus-next/` **逐字节一致**（sha256 两两比对，8/8 same）。
- `node_modules/@deepseek-ai` → `/Users/vito/.nvm/.../dsh/node_modules/@deepseek-ai`（全局 rc.1 依赖树）。
  从部署位解析：`@deepseek-ai/dsh-persona` → 全局 rc.1 路径，`package.json` version `0.1.5-rc.1`。
- 对照：`~/.dsh/.agent-presets/minimal-plus/node_modules/@deepseek-ai` 仍指向
  `/Users/vito/data/dev/dsh-runtime/stable/node_modules/@deepseek-ai`（rc.2），未动。

## 3. 宿主层 persona 核实（第三条）

| 侧 | 宿主层 persona 配置来源 | rc.2（stable） | rc.1（dev） |
| --- | --- | --- | --- |
| base 行 `system-prompt` | `@deepseek-ai/dsh-base/cordis.patch.yml` | `persona: ''` | `personaPrefix: ''` |

- 四个 profile 补丁（`tui`、`tui-dev`、`tui-central.parked-*`、`headless`）grep 均无 `system-prompt`/`persona` 覆盖行。
- 组合的 `persona` 行用 `complete: true`，对挂载该 preset 的 agent 遮蔽部署 persona；即宿主层键名变化由 base 包自带迁移，本部署无需改 profile（用户本窗口确认的处置）。
- 术语边界：组合行键是 `prefix`/`suffix`（`@deepseek-ai/dsh-persona`，scope-only）；宿主层（部署）persona 是 `personaPrefix`/`personaSuffix`（`@deepseek-ai/dsh-system-prompt`）。

## 4. profile 切换

| profile | 改动 | 结果 |
| --- | --- | --- |
| `~/.dsh/profiles/tui-dev/cordis.patch.yml` | `tui-runner.config.preset` 默认 `'minimal-plus'` → `'minimal-plus-next'`（注释同步） | 生效 |
| `~/.dsh/profiles/tui-central.parked-0.1.5-rc.1/cordis.patch.yml` | 同上（停用副本先备好，解停用即用新组合） | 生效 |
| `~/.dsh/profiles/tui/cordis.patch.yml`（stable） | 未改 | sha256 不变，仍 `'minimal-plus'` |
| `~/.dsh/settings.yaml` | 未改 | `agent-presets.default: minimal-plus` 保持；shared 设置不动（见 §7.5） |

两个开发 profile 的行内容：

```
preset: !!js process.env.CC_TUI_PRESET ?? 'minimal-plus-next'
```

## 5. 验证

### 5.1 rc.1 preset discovery（host 自己的健康检查）

用全局 rc.1 的 `dsh-agent-presets`，harnessBase 指向已按 rc.1 自愈的隔离 home（§7.2），扫描两个 root：

```
minimal-plus      trust=system  broken=(healthy)  name=Minimal+提权+注入
minimal-plus-next trust=system  broken=(healthy)  name=Minimal+提权+注入（next）
（仅扫部署位 user root：minimal-plus、minimal-plus-next 均 healthy，路径指向各自 agent.cordis.yml）
```

### 5.2 persona 行 schema（rc.1）

用 loader 自带 YAML 方言解析组合（discovery 命中的仓库源文件；部署位副本与它逐字节一致，见 §2），取出 persona 行：

```
keys: prefix, complete, includeRuntimeContext
rc.1 dsh-persona Config ACCEPTED; prefix length: 281 complete: true
对照：stable minimal-plus 的 text 行在 rc.1 schema 下被拒 — $.prefix missing required value
```

### 5.3 无 LLM smoke（挂载路径真实验证）

`SMOKE_PRESET=minimal-plus-next node presets/minimal-plus-next/smoke-boot.mjs`
（`DSH_HOME=/tmp/dsh-ticket03-home`，farm 已由 rc.1 anchor 自愈，避免共享 farm 当前指 rc.2，见 §7.2）。

- **preset 挂载成功**：无 `PresetMountError`；persona 行通过 rc.1 校验；流程推进到 `system-prompt/assemble`。
- **随后在 assembly 阶段失败**（既有接口问题，非本票引入）：
  `TypeError: session.events is not iterable` at `compaction-epoch.mjs:36`
  ← `phase-swap-bash.mjs` / `tool-bootstrap.mjs` 的 `promotion.status(agent)`。
  同一代码在未改动的 `presets/minimal-plus/` 下同样失败（§7.1）。

### 5.4 单元用例

`node --test presets/minimal-plus-next/{custom-bash,instruction-hint,phase-swap-bash,skill-search,tool-bootstrap}.test.mjs`
→ 43 tests / 37 pass / 6 fail；6 个失败全部是 phase-swap 的会话事件用例，且与未改动的
`presets/minimal-plus/phase-swap-bash.test.mjs` 在 rc.1 下逐条相同（同样 6 fail）。
全仓 `npm test`：97 tests / 91 pass / 6 fail（同一组）；`npx tsc --noEmit`：5 个错误全部在
`lib/transcript.ts`（rc.1 `assistant/chunk` 事件类型已移除）→ 均属票据 04 迁移面，本票未新增红。

### 5.5 stable 侧未动核对

开工前/后两次采集，10 项 sha256 全部一致 + 链接目标一致：

| 对象 | sha256（前后一致） |
| --- | --- |
| `~/.dsh/.agent-presets/minimal-plus/agent.cordis.yml` | `d8c4606a8acfb1ff4115f52b51a1ab6219383ba11cb11aa932ba51230a328811` |
| `…/minimal-plus/preset.yml` | `b3f588fd3040eb49263152c1234626269f4ba1bffa0c9f6d2e0836d0ae22a371` |
| `…/minimal-plus/compaction-epoch.mjs` | `a235a9904fc7435a5e61830d0624628d06121049a7549813a8f13017ddca0770` |
| `…/minimal-plus/custom-bash.mjs` | `3b26436ee419ce57594a9f2fcaad688b6b404780859a82ba143ddcf40abd427d` |
| `…/minimal-plus/instruction-hint.mjs` | `4a2a26cb74ee8307d17df72ea4cebbebf806a4f5c95b29b5e442b6c41fad0667` |
| `…/minimal-plus/phase-swap-bash.mjs` | `7842e866ef4529ebd1623a1703a5e95d07f376e69942d7cd9fe0a8a8d6f3d7ed` |
| `…/minimal-plus/skill-search.mjs` | `61312f8b054035e52afc6df9d52f5d38b1847dd8ba2a9eb99d2381c794debfaf` |
| `…/minimal-plus/tool-bootstrap.mjs` | `e3e05e677289d84f5b24e291061e92dc309e75768a5aad355b5ade28f2d2a6ed` |
| `~/.dsh/profiles/tui/cordis.patch.yml` | `4d3645374682b9689e8c107e7cff6bfb9d5b8b567d4e0e202c685d799c9f0515` |
| `~/.dsh/settings.yaml` | `b87e4d70d47ad22b74d2093864d71d6b01d76a1f6f8a87e3713667a84af9637a` |

链接：`minimal-plus/node_modules/@deepseek-ai` → `…/dsh-runtime/stable/node_modules/@deepseek-ai`（未变）。
另用票据 01 备份树逐字节复核：`presets/minimal-plus/` 8 文件与备份全同；
`tui` profile 补丁与 `settings.yaml` 不在本票改动面。两个开发 profile 的补丁与票据 01 备份 diff
只含上述两行（注释 + preset 行），确认改动是外科式的。

## 6. 结论

开发侧组合以 `minimal-plus-next` 独立存在（仓库源 + 部署位 + 两个开发 profile 引用），persona 已改用 rc.1 的
`prefix` 键；stable 的组合源、部署位、profile 与设置逐字节未动。开发侧组合在 rc.1 宿主下可被发现、可挂载；
完整端到端可用仍待票据 04（会话事件迁移）与票据 05（冷启动）。

## 7. 本票发现（转后续票据）

1. **票据 04 面扩大：preset 自研插件也读 `session.events`（实机复现）。**
   `compaction-epoch.mjs:36` 直接 `for (const event of session.events)`；`phase-swap-bash.mjs`、
   `tool-bootstrap.mjs` 经 `promotion.status(agent)` 走到它。后果：rc.1 下 assembly 即抛
   `session.events is not iterable`，`phase-swap-bash.test.mjs` 6 个用例红。
   票据 04 的改动清单只写了「TUI 与回退插件」，**需显式把 preset 自研插件纳入**（否则票据 05 冷启动无法通过）。
2. **共享 farm 的代际翻转会让冒烟/测试串代。** `~/.dsh/profiles/node_modules` 由最近一次 boot 的宿主
   自愈（`healProfilesModuleFallback`，按当前 installAnchor 整代重写，只补不删多余项）。stable 侧启动后
   farm 指 rc.2；此时 dev 冒烟若仍从 farm 取 `dsh-app-boot`/`dsh-agent-presets`，会得到「rc.1 宿主 + rc.2
   组件」的混合体。本窗口处置：新 preset 的 smoke-boot 固定从 repo dev 树导入；验证时用独立
   `DSH_HOME=/tmp/dsh-ticket03-home`（先按 rc.1 anchor 自愈一份临时 farm），不打扰真实 farm。
   票据 05 的冷启动必须在真实 farm 上跑，届时 farm 会被 rc.1 自愈整代重写（stable 下次启动再翻回）。
3. **rc.1 `loadProfile` 会规范化 profile manifest（实机复现 finding 01-2）。** 冒烟期间
   `~/.dsh/profiles/headless/package.json` 被回写（补 `patchReload: "startup"` 与空 `dependencies`）。
   属宿主自带行为、幂等；记录了时间与内容，未见其它 headless 文件被改写。
4. **profile 补丁里的 `agent-presets.roots` 指向 rc.1 已不存在的路径。** rc.1 把 shipped preset 移入
   `@deepseek-ai/dsh-agent-presets/presets/`，而补丁仍指 `../node_modules/@deepseek-ai/dsh/config/agent-presets/`。
   rc.1 discovery 对不存在的 root 静默跳过（不报错），shipped/user root 仍自动提供；票据 09 的配置闸门
   顺带清理/更新这行。
5. **残留风险：`settings.yaml` 的 `agent-presets.default: minimal-plus` 是 stable ↔ dev 共享设置。**
   该值指向 rc.2 字段的组合，在 dev 宿主上被任何「未显式指定 preset」的解析取到就会挂载失败。
   本票不改（改了对 stable 有风险）；当前 TUI runner 总是显式传 preset，故未触发。票据 05/09 需决定
   dev 侧如何隔离（如 profile 层 `agent-presets.default` 覆盖或 dev 专用 home）。

## 8. 未做

- 未 commit、未 push、未打 tag；stable 侧未动。
- 未做组合去重（票据 09）、未做会话事件迁移（票据 04）、未冷启动 TUI（票据 05）。
