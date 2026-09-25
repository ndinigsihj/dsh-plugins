# 04 — 宿主升级与两个工作 Profile 到位

**What to build:** 按锁定版本升级宿主，tui-dev 与 headless 同步到位（宿主版本、Profile 插件树；部署位 Preset 保持旧副本不动），混合期用显式 CLI 覆盖在旧/新宿主间切换；闸门基准的宿主版本与会话格式版本随宿主更新（两条断言不可豁免）。两个 Profile 各自导出配置，逐 loader id 递归计数为 1 且 exit 0。

**Blocked by:** 02 — 前置取证；03 — 回滚资产与迁移安全网

**Status:** done（含 2 项部分）— 2026-09-25（宿主已切到 0.1.7-rc.1；manifest 两条字段级断言无豁免绿；两 Profile 配置导出绿（95/111、0 重复）。部分项：① 真实模块级 boot 的 tui-dev 依赖票据 07 的载体行；② T1 编排器/farm 断言在 0.1.7 上待票据 06 适配——故本地闸门与 CI 在 06 落地前不可运行。**改动未提交**，待用户确认后 commit；证据见 `evidence/04-host-upgrade-and-working-profiles.md`）

**施工图:** `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Implementation Decisions：目标与范围、闸门基准）；升级计划 §7 第 3–6 步

- [x] 两个工作 Profile 在目标版本上启动成功，版本输出留档（**部分**：计划 §7 第 7 步 dry-run 口径 PASS —— `--dump-config` exit 0 + `--version` → 0.1.7-rc.1；模块级 boot 的 tui-dev 仍差一条 `@deepseek-ai/dsh-agent-presets`，依赖票据 07，见证据 §6.2）
- [x] 混合期可通过显式 CLI 覆盖切换；旧宿主仍可用（`DSH_CLI=<票据03副本>` → 0.1.5-rc.2，wrapper 与直接入口两式）
- [x] 宿主钉版与会话格式版本断言更新后绿，且不借助任何豁免（**部分**：字段级 `host.pin.hostVersion` / `sessionFormatVersion` + `host.cli` 无豁免全绿；T1 合并断言还含 legacy farm 投影，需按 0.1.7 解析机制重写，且编排器在 0.1.7 上因 `healProfilesModuleFallback` 静态导入暂不可启动 → 票据 06，见证据 §4）
- [x] 两种 Profile 的配置导出 exit 0、逐 loader id 计数为 1（headless 95 / tui-dev 111，duplicates=0）
- [x] 非 Team Profile 的委派与模型选择口径各自保持，不合并（profile patch 未改：tui-dev `enabled: true` / headless `enabled: false`，同 2 条允许路由；§1.1 的 30/29 工具数是 0.1.5 时代测量值，0.1.7 上需按票据 06/12 重采，不在本票声称）
- [x] 真实用户目录零意外写入；部署位在本票内不动（零意外写入：预期规范化写入仅 tui-dev 3 条旧 fallback 投影清理并逐条归类；settings / 30 个 profile 文件 / 部署位 sha 全同）

**范围外（本票不做）:** 会话迁移（10）；Preset 载体（07）；Team Profile（09）。

---

## 验收回填（2026-09-25）

**方法**：用户裁决采用「替换 v24 全局」（选项 A）；安装前先做 `/tmp` staging 清洁安装预验（exit 0 / 278 包），
旧宿主退路由票据 03 本地副本 + `DSH_CLI` 承担。真实 home 写入按 before/after 指纹归类，部署位与 settings
逐字节未动。两 Profile 的 `--dump-config` 在真实 `~/.dsh` 上 exit 0，并用仓库闸门的 `dump-parse`/`unique-ids`
复核逐 loader id 计数；宿主钉版用闸门自身的 `hostInfo`/`checkHostPin` 纯函数实跑（无豁免路径）。

**关键事实**

- 默认入口 `~/.dsh/bin/dsh --version` → `0.1.7-rc.1`；`DSH_CLI=<票据03副本>` → `0.1.5-rc.2`；v22 旧安装点未触碰。
- `gates/manifest.json`：`hostVersion → 0.1.7-rc.1`、`sessionFormatVersion → 4`；CI 宿主安装去掉 0.1.5 线 overrides；
  README 宿主前提段更新为 0.1.7-rc.1（含 npm install-scripts 审批提示的实测结论）。
- 两 Profile loader id：headless 95 / tui-dev 111，duplicates=0；插件名解析探针：headless 0 不可解析，
  tui-dev 唯一不可解析项 = `@deepseek-ai/dsh-agent-presets`（票据 07 入口）。

**移交（证据 §6）**

- 票据 06：`lib/index.ts:1463` 只读 ContentBlock 类型错误；`phase-swap-bash.test.mjs` 10 个失败
  （旧宿主对照 157/157 全绿）；`gates/t1/composition.mjs` / `gates/stub/run.mjs` 对已移除
  `healProfilesModuleFallback` 的静态导入；`gates/host-pin.mjs` farm 投影断言按 0.1.7 解析机制重写。
- 票据 07：tui-dev profile 的 `agent-presets` 载体行。
- 范围外发现（用户报 `1mdsh` 失败后**已处置**）：`dsh-runtime/stable` 的 `@deepseek-ai/*` 依赖原是指向
  全局树的 240 条 symlink，随全局升级翻代后与自带 0.1.5-rc.2 CLI 组成混合代而崩溃；按用户裁决以方案③
  （按自身 lock 做 `npm ci`）重建为自包含树，复验 `--version` → 0.1.5-rc.2、drill-base `--dump-config`
  exit 0，且 0 条链接指向全局/备份（后续全局升级不再连带）。见证据 §6.3 与
  `evidence/04-stable-runtime-repair.txt`。
- 冷备新鲜度：票据 03 快照 11:32:35；首次真实启动 0.1.7 前需按计划 §7 第 1 步脚注重取快照
  （mumu 与本 TUI 仍在写会话）。

**边界与部分项**：第 1 项按计划 §7 第 7 步 dry-run 口径判定（组合/配置导出），模块级 boot 依赖票据 07 的载体行；
第 3 项为字段级断言（环境前置，无豁免参数），T1 合并断言与编排器的 0.1.7 适配归票据 06。
**票据 06 落地前，本地闸门与 CI 在 0.1.7 上不可运行（预期红）**；本票未提交、未触发 CI。
