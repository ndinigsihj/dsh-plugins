# 09 — tui-team Profile 建立与 Profile 维度闸门基线

**What to build:** 建立带 Team 组合的独立 Profile（tui-team）：组合无重复 id、可启动；按 Profile 维度重建工具面期望并附行级差异与理由（禁止整文件再生成）；非 Team Profile 的可见工具集合保持不变。工具面口径以 08 的实测结论为准（含回退情形）。

**Blocked by:** 01 — Prefactor：组合闸门脚本拆模块；08 — B1.5：Team Profile 的 Preset 叠加实测

**Status:** ready-for-agent

**施工图:** `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Implementation Decisions：Team、闸门基准）；升级计划 §5.4、§6 Team 行

- [ ] tui-team 配置导出 exit 0、逐 loader id 计数为 1
- [ ] 两种形态的期望快照可分别运行；每个新增/移除工具附行级差异与理由
- [ ] 非 Team Profile 的可见工具集合与升级前一致
- [ ] tui-team 工具面与 08 结论一致；回退情形下与回退口径一致
- [ ] 显示层权限判断不依赖"工具是否存在"（读角色/成员信息）
- [ ] 证据归档到本票

**范围外（本票不做）:** Team 成员视图、任务板、使用规范文档（功能计划）；部署位写入（12）。
