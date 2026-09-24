# 04 — 宿主升级与两个工作 Profile 到位

**What to build:** 按锁定版本升级宿主，tui-dev 与 headless 同步到位（宿主版本、Profile 插件树；部署位 Preset 保持旧副本不动），混合期用显式 CLI 覆盖在旧/新宿主间切换；闸门基准的宿主版本与会话格式版本随宿主更新（两条断言不可豁免）。两个 Profile 各自导出配置，逐 loader id 递归计数为 1 且 exit 0。

**Blocked by:** 02 — 前置取证；03 — 回滚资产与迁移安全网

**Status:** ready-for-agent

**施工图:** `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Implementation Decisions：目标与范围、闸门基准）；升级计划 §7 第 3–6 步

- [ ] 两个工作 Profile 在目标版本上启动成功，版本输出留档
- [ ] 混合期可通过显式 CLI 覆盖切换；旧宿主仍可用
- [ ] 宿主钉版与会话格式版本断言更新后绿，且不借助任何豁免
- [ ] 两种 Profile 的配置导出 exit 0、逐 loader id 计数为 1
- [ ] 非 Team Profile 的委派与模型选择口径各自保持，不合并
- [ ] 真实用户目录零意外写入；部署位在本票内不动

**范围外（本票不做）:** 会话迁移（10）；Preset 载体（07）；Team Profile（09）。
