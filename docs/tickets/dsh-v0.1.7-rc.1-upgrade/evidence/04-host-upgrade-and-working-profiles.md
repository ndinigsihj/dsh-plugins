# 票据 04 证据 — 宿主升级与两个工作 Profile 到位

> 执行日期：2026-09-25（本地 +0800）；宿主工作树 `07fed28`
> 目标宿主：`0.1.7-rc.1`（精确锁定）；安装方式：**替换 v24 全局**（用户当日裁决，选项 A）
> 本票不动部署位、不迁移会话；真实 `~/.dsh/sessions` 未被本票命令写入（在场写者见 §5）

## 1. 结论（对照票面验收）

| # | 验收项 | 结果 | 依据 |
| --- | --- | --- | --- |
| 1 | 两个工作 Profile 在目标版本上启动成功，版本输出留档 | **PARTIAL（配置导出 PASS / 模块级 boot 待 07）** | `dsh --version` → 0.1.7-rc.1；`--dump-config` 两个真实 profile exit 0（headless 384 行 / tui-dev 448 行）。真实模块级 boot 的 tui-dev 还差一条 `@deepseek-ai/dsh-agent-presets`（0.1.7 已移除该包），属票据 07 载体迁移，见 §6.2 |
| 2 | 混合期可通过显式 CLI 覆盖切换；旧宿主仍可用 | **PASS** | 默认入口 = 0.1.7-rc.1；`DSH_CLI=<票据03副本>/lib/bin.js` → 0.1.5-rc.2（wrapper 与直接入口两式），`04-version-switch.txt` |
| 3 | 宿主钉版与会话格式版本断言更新后绿，且不借助任何豁免 | **PARTIAL（字段级 PASS / T1 编排器待 06）** | `gates/manifest.json` hostVersion→0.1.7-rc.1、sessionFormatVersion→4；`checkHostPin` 两字段均 ok、`dsh --version` exit 0，全程无豁免参数，`04-host-pin.txt`。T1 合并断言还含 legacy farm 投影，且编排器在 0.1.7 上暂不可启动（`healProfilesModuleFallback` 已移除）→ 票据 06，见 §4 |
| 4 | 两种 Profile 的配置导出 exit 0、逐 loader id 计数为 1 | **PASS** | headless ids=95 / tui-dev ids=111，duplicates=0，`04-loader-ids.txt` + 两份 dump |
| 5 | 非 Team Profile 的委派与模型选择口径各自保持，不合并 | **PASS（配置面）** | `cordis.patch.yml` 未改（30 个 profile 文件 sha 全同）；tui-dev `enabled: true` + 2 条允许路由，headless `enabled: false` + 同 2 条路由。§1.1 的 30/29 工具数是 0.1.5 时代测量值，0.1.7 上需按票据 06/12 重采，不在本票声称 |
| 6 | 真实用户目录零意外写入；部署位在本票内不动 | **PASS（预期写入已归类）** | 预期写入 = tui-dev 3 条旧 fallback 投影清理；settings / 跟踪形态 profile 文件 / 部署位 sha 均不变，`04-real-home-writes.txt` |

## 2. 环境与安装（as-built）

| 项 | before（12:25） | after |
| --- | --- | --- |
| v24.21.0 全局宿主 | `0.1.5-rc.2` | **`0.1.7-rc.1`** |
| v22.22.1 全局旧安装点 | `0.1.5-rc.1` | `0.1.5-rc.1`（未触碰） |
| `~/.dsh/bin/dsh` 默认 CLI | v24 全局 | v24 全局（同路径，wrapper 未改） |
| 仓库 `node_modules/@deepseek-ai` | 指向 v24 全局（240 包） | 指向 v24 全局（277 包，`link-global-dsh.sh` 幂等重跑） |
| 旧宿主副本 | 票据 03：`~/.dsh/upgrade-backups/…/host-package/dsh-0.1.5-rc.2/` | 原样保留，`DSH_CLI` 可启动 |

安装命令与复验：

```bash
npm install --prefix /tmp/dsh-t04-stage-<ts> @deepseek-ai/dsh@0.1.7-rc.1 --cache /tmp/dsh-t04-npm-cache   # staging 预验：exit 0 / 278 包
npm i -g @deepseek-ai/dsh@0.1.7-rc.1 --cache /tmp/dsh-t04-npm-cache --no-audit --no-fund                  # 正式安装：exit 0
bash scripts/link-global-dsh.sh    # node_modules/@deepseek-ai -> v24 全局（277 packages, dsh 0.1.7-rc.1）
```

npm 11.19 的 install-scripts 审批提示列出 5 个包（`dsh-subprocess-local` / `koffi` / `node-pty` /
`@google/genai` / `protobufjs`）未跑脚本；本机实测产物已齐备、无需放行：node-pty 的
`prebuilds/darwin-arm64/{pty.node,spawn-helper}` 均在且 spawn-helper 带 `-rwxr-xr-x`（与 0.1.5 旧树逐项同形），
koffi 由 `@koromix/koffi-darwin-arm64` 预编译提供，其余两个脚本为 no-op / 提示。该结论已写入 README 宿主前提段。

## 3. 混合期切换

见 `04-version-switch.txt`：默认入口 0.1.7-rc.1；`DSH_CLI=<票据03副本>` 0.1.5-rc.2（wrapper 与直接入口）。
staging 安装与全局安装都从 registry 解析同一版本，回滚入口不依赖 registry（票据 03 本地副本）。

## 4. 闸门基准与可运行性

- `gates/manifest.json`：`hostVersion 0.1.5-rc.2 → 0.1.7-rc.1`、`sessionFormatVersion 3 → 4`（preset sha `8cd01c68…` 此前已对齐，部署位仍为旧副本 → 过渡窗口用 `--allow-stale-deployment`，收口消除）。
- 字段级断言（`gates/preconditions.mjs` → `checkHostPin`）：`host.pin.hostVersion` ok、`host.pin.sessionFormatVersion` ok、`host.cli` exit 0（`04-host-pin.txt`）；这三条是环境前置，设计上不接受豁免。
- **T1 编排器在 0.1.7 上暂不可启动**：`gates/t1/composition.mjs:10` 与 `gates/stub/run.mjs:31` 静态导入 0.1.7 已移除的 `healProfilesModuleFallback`（`node gates/run.mjs` 在模块实例化即 SyntaxError）；`gates/host-pin.mjs:35-43` 的 legacy farm 投影断言（`profiles/node_modules/@deepseek-ai/dsh`）在 0.1.7 新建 home 里不再生成 → 需按 per-profile 解析机制重写。两者均属票据 06「其余兼容面迁移（闸门复绿）」。
- CI（`.github/workflows/regression-gate.yml`）删除 0.1.5 线专用 UI/sidebar overrides 工作区，改为按 manifest hostVersion 做纯 project 安装；README「宿主前提」段更新为 0.1.7-rc.1（安装 + `--expose-internals`）。
- **在票据 06 的闸门源码适配落地前，`scripts/regression-gate.sh` 与 CI 在 0.1.7 上不可运行（预期红）**；本票未提交、未触发 CI。

## 5. 真实 home 指纹（before/after）

| 面 | 结果 |
| --- | --- |
| `profiles/**` 跟踪形态文件（cordis.patch.yml / package.json / cordis.yml，30 个） | sha 全同 |
| `~/.dsh/settings.yaml` | sha 不变；未出现 `settings.yaml.imported`（`--dump-config` 不触发一次性导入） |
| `~/.dsh/.agent-presets/**`（部署位，10 个文件） | sha 全同，本票未动 |
| `profiles/**` symlink | 仅 3 条变化：tui-dev 旧 fallback 投影 react / loose-envify / xdg-basedir 被清理；farm 493 条未变 |
| `~/.dsh/sessions/**` | 本票命令零写入；窗口内 6 个被写文件属在场写者（mumu 5 + 本 TUI 1） |

原始明细见 `04-real-home-writes.txt`。

## 6. 本票发现与移交

1. **票据 06（其余兼容面）**：新宿主上 `npx tsc --noEmit` 报 1 处只读类型（`lib/index.ts:1463`
   `Property 'push' does not exist on type 'readonly ContentBlock[]'`）；`npm test` 157/147/10，10 个失败
   全在 `presets/minimal-plus/phase-swap-bash.test.mjs`。旧宿主对照 **tsc 0 错、npm test 157/157**，
   证明为宿主换代引入。清单见 `04-t0-new-host-red.txt`；叠加 §4 的两处闸门源码适配，即票据 06 的
   「自研插件启停/闸门复绿」工作面。
2. **票据 07（Preset 载体）**：真实 tui-dev profile 仍在 patch 里 insert 已移除的
   `@deepseek-ai/dsh-agent-presets`（id `agent-presets`）。组合导出不受影响，但真实 boot 的模块解析
   失败（110 个插件名中唯一不可解析项，`04-plugin-resolvability.txt`）；headless 94 个名全可解析。
   这正是票据 07 的目标载体改造入口。
3. **稳定侧连带影响（已处置，2026-09-25）**：`/Users/vito/data/dev/dsh-runtime/stable` 的 240 个
   `node_modules/@deepseek-ai/*` 依赖原是指向全局宿主依赖树的 symlink（本地 CLI + 依赖跟随全局，
   与文档「自带隔离运行时」口径不一致）；全局升级后它们解析到 0.1.7-rc.1，而该运行时自带 CLI 仍是
   0.1.5-rc.2 → 启动报 `does not provide an export named 'healProfilesModuleFallback'`。
   **用户裁决方案③：按 stable 自身 `package-lock.json` 做 `npm ci` 自包含重建**（先在 /tmp 同 lock 预演绿，
   再动真目录；重建前只读确认 0 本地补丁 / 0 后期人工改动）。终态：0 条链接指向全局或备份、`node_modules`
   290M、CLI 0.1.5-rc.2 + deps 0.1.5-rc.3（lock 口径），`--version` 与 drill-base `--dump-config`
   （exit 0 / 332 行）复验绿；stable 与全局彻底解耦，后续全局升级不再连带。**第二层修复**：npm 的 nested
   布局使部署位 preset 的 alias 无法解析 `@deepseek-ai/dsh-tool-bash`（`1mdsh` 挂载 minimal-plus 失败），
   已在 stable 顶层 scope 目录补 130 条内部扁平 symlink（top-level 244 / 0 dangling；脚本
   `04-stable-flat-mirror.sh`），preset 导入与 stable 启动复验 OK。明细见 `04-stable-runtime-repair.txt`。
4. **冷备新鲜度**：票据 03 快照为 11:32:35；mumu TUI 与本文 TUI 在窗口内仍在写会话（§5）。
   按计划 §7 第 1 步脚注：**首次真实启动 0.1.7（任一共用全局宿主的 TUI 重启）之前**，需在静默窗口按
   `03-cold-backup.sh` 重取一次快照（写入新的空根目录），否则丢失窗口从 11:32 继续扩大。

## 7. 证据文件索引

| 文件 | 内容 |
| --- | --- |
| `04-version-switch.txt` | 默认入口 / DSH_CLI 覆盖 / 直接入口的版本输出 |
| `04-host-pin.txt` | 字段级宿主钉版与会话格式断言实跑输出 |
| `04-loader-ids.txt` | 两种 Profile 的 loader id 递归计数 |
| `04-dump-headless.yml` / `04-dump-tui-dev.yml` | 两种 Profile 的 `--dump-config` 原始产物 |
| `04-plugin-resolvability.txt` | 组合导出里插件名的解析探针（镜像真实 loader 口径） |
| `04-t0-new-host-red.txt` | 新宿主 T0 红项清单与旧宿主对照 |
| `04-real-home-writes.txt` | 真实 home 写入归类与 before/after 口径 |
| `04-stable-runtime-repair.txt` | 稳定侧混合代故障与方案③（按 lock `npm ci`）自包含重建记录 |
| `04-stable-flat-mirror.sh` | 重建后为 preset 解析补回的扁平 scope 镜像（可复用） |

## 8. 评审发现与处置（2026-09-25，双轴只读评审）

对本票改动跑了 Standards / Spec 双轴只读评审；发现与处置如下。

| 轴 | 发现 | 处置 |
| --- | --- | --- |
| Standards | README 的 npm postinstall 表述断言过满（“只做…”与“脚本未跑”并列易误读） | **已修**：改为“预编译产物随包提供 + spawn-helper 已带 +x；postinstall 脚本本身也只是对候选路径做 +x 幂等修复”，与实测/脚本源码一致 |
| Standards | 票面 Status 读起来像 6/6 全绿，与自身清单第 1/3 项的部分口径不符 | **已修**：Status 改 `done（含 2 项部分）`，写明 06/07 依赖 |
| Standards | `04-host-pin.txt` 缺口径说明（无豁免列表、farm-pin 含义） | **已修**：重生成，加口径头与 farm-pin informational 说明 |
| Spec | 第 1 项“启动成功”被配置导出口径覆盖，模块级 boot 未达成 | **已修**：清单/证据改 PARTIAL，明确依赖票据 07，不声称 boot 绿 |
| Spec | 第 3 项含 farm 断言 + 编排器不可运行，“绿”超实据 | **已修**：改 PARTIAL（字段级 PASS / T1 待 06），写明闸门与 CI 在 06 前预期红 |
| Spec | 计划文本仍写“避免直接替换 0.1.5-rc.2”，与实际裁决 A 不一致 | **已修**：§7 第 3 步加“已完成（票据 04，用户裁决）”注 |
| Spec | 稳定侧 symlink 翻转未在计划文本同步 | **已修**：§7 第 6 步注 + 本证据 §6.3；修复方式留裁决 |
| Spec | 清单 5 缺 30/29 工具数证据 | **已修**：标注为 0.1.5 时代测量值，0.1.7 上归 06/12 重采 |
| Standards（判断项） | 0.1.5 ETARGET 叙述在 CI 注释/README/证据重复 | 未处置：CI 注释已删、只剩两处且读者面不同（README 运维、证据归档） |
