# 06 — 其余兼容面迁移

**What to build:** 逐项在新宿主上验过并修好：工具结果 token 预算的配置与通知渲染；Node PTC 包名与工作流执行器服务名；启动等待（生命周期事件）语义；自研插件启停对称性（尤其 bash 换用插件的按 agent 影子注册）；模型适配器配置（移除旧协议字段、根地址口径）。每项以命名命令或冒烟留证。

**Blocked by:** 02 — 前置取证；04 — 宿主升级与两个工作 Profile 到位

**Status:** partial / blocked-on-07 — 2026-09-25：六项兼容面均已修/验；T0 全绿、T1 17/20、T2 全层待 07（闸门复绿不在本票 blocked-by 内，但需要 07 的 preset 载体；详见验收回填）。**改动未提交**，待用户确认后 commit；证据见 `evidence/06-remaining-compat-surfaces.md`。

**施工图:** `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Implementation Decisions：接口异步化迁移之外的全部兼容项）；升级计划 §6 P0/P1/P2 行

- [x] 配置导出逐 loader id 计数为 1（改名后的包名/服务名无重复）— 闸门 `composition.loader-id-unique` 99/99、duplicates=0；PTC 服务探针 `06-ptc-activation.txt`
- [x] 超长工具结果渲染冒烟通过（预算配置改名后通知仍匹配）— `06-spill-render.txt`：20000 字符结果经真实 `maxInlineTokens` spill 后渲染成 `⤓ full result` 徽标
- [x] 自研插件启停各一次：无残留注册、无影子泄漏 — `plugin-lifecycle.test.mjs` 4/4 + `phase-swap-bash.test.mjs` 15/15
- [ ] 闸门复绿（被票据 07 载体前置卡住）：T1 的 `smoke.*` ×2 与 `degrade.fail-open`、T2 全部场景都因 0.1.7 移除 `@deepseek-ai/dsh-agent-presets` 而缺 agent-presets 服务；07 落地后复跑
- [x] 模型适配器配置在真实模型上一次工具调用通过（T3 或等价证据）— `06-real-model-tool-call.txt`；T3 基线重采仍归 11
- [x] 逐项证据归档到本票

**范围外（本票不做）:** 真实模型基线重采（11）；远端接口改造（若 02 判定必须，另立票）。

---

## 验收回填（2026-09-25）

**方法**：0.1.7 隔离临时 home 上跑 `npm test` / `tsc` / 闸门 T0/T1，加四个命名探针（PTC 激活、启动等待、spill 渲染、真实模型工具调用）；真实 `~/.dsh` 只读。

**关键结果**

- `npx tsc --noEmit` exit 0（票据 04 移交的 `lib/index.ts:1463` 只读 ContentBlock 红项已修）。
- `npm test` **163/163**（新增 `plugin-lifecycle.test.mjs` 4 条 + spill 通知 2 条；原 phase-swap 10 红全绿）。
- 闸门 T0 **3/3 全绿**；T1 17 过 / 3 红：`smoke.anchored-first-turn`、`smoke.promoted-catalog`、`degrade.fail-open` 同因（隔离 home 无 agent-presets 服务，0.1.7 旧包已移除，属 07）；`composition.loader-id-unique`、`host.pin`（runtime resolution）、`seeded-preview.probe`（10/10）、`deployment.repo-matches-manifest` 等全绿。
- T2 stub boot 已适配 0.1.7 runtime resolution，隔离 home 里只剩旧 `gate-stub-agent-presets` 一行 import 失败（07）。
- 真实模型一次工具调用通过：`tool_call → tool_result(completed) → final`，exit 0。
- 真实 spill（`maxInlineTokens`）→ TUI 渲染徽标通过；settings/profile 无 `protocol` / 旧根地址覆盖。

**部分项口径**：启停对称全体断言已闭环；闸门全绿交给 07 载体落地后的复跑。部署位过渡窗口：改动过的 4 个文件为 stale、新增的 `plugin-teardown.mjs` 为 absent，故本窗口 T1 用 `--skip-deployment-check` 豁免（覆盖 absent，也覆盖 stale）；`deployment.repo-matches-manifest` 不可豁免且 9 文件全绿；收口票 12 部署后必须回到零豁免。

**双轴只读评审处置（2026-09-25）**

- Standards：`lib/app.test.ts` 曾到 300 行 → 两条 spill 单测拆到 `lib/spill-notice.test.ts`；`SavedImage.ref` 的 `Record<string, unknown>` 是双 cast 根因 → 收窄为 `ImageAttachmentRef`（`lib/app.ts` / `lib/index.ts`），调用点 cast 删除；三处注销代码的失败姿态不一致 → 抽 `plugin-teardown.mjs` 的 `disposeSafely()` 统一（新文件已入 manifest）；既有超长 `apply()` 属历史结构，不在本票重构范围，新 helper 均 <50 行。
- Spec：Status 由 `done` 改 `partial / blocked-on-07`，清单第三项不再夹带「闸门复绿」；seeded 探针去掉跨宿主双分支，改为 0.1.7 单一行为断言（`seeded-readSession-aligned`）；host-pin 的 resolution 断言补目录身份核对 + `home: tempHome` 保持 hermetic，并在注释里写明它证明/不证明什么（宿主代独立证据面仍是 PRE `host.cli`）。`styleSpillNotices` 导出用于单测属有意取舍：真宿主 spill 冒烟（`06-spill-render-probe.mjs`）为主证据，单测只钉通知拼写回归。
