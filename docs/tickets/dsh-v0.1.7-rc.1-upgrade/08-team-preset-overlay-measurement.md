# 08 — B1.5：Team Profile 的 Preset 叠加实测（硬前置）

**What to build:** 在隔离 home 的 Team Profile 上实测 Preset 与 Team 组合的叠加行为：先用哨兵行证明 Preset 真正生效，再读实际工具面——普通委派工具是否与 Team 创建工具并存、路由发现工具是否出现、成员工具与权限的真实形状。优先在真 PTY 冒烟上承载（参数化 Profile 与 Preset、stub provider），进程内假模型 harness 作对照。不可测时按回退结论（Team Profile 不让自研 Preset 下沉）落字"未测"。

**Blocked by:** 04 — 宿主升级与两个工作 Profile 到位；07 — Preset 载体迁移与同步工具 dry-run

**Status:** ready-for-agent

**施工图:** `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Implementation Decisions：Team）；升级计划 §5.3 票 B1.5

- [ ] 哨兵行在实测会话中可见，证明 Preset 生效（而非"被跳过"）
- [ ] 记录普通委派工具与 Team 创建工具的实际关系（并存/互斥）及路由发现工具是否出现
- [ ] Team Profile 的工具面快照留档，含成员权限只读结论
- [ ] 不可测时：回退结论与"未测"字样写入票面，并作为 09 的施工输入
- [ ] 真实用户目录零写入；临时前缀可复现

**范围外（本票不做）:** 建立真实 tui-team Profile（09）；Team 体验实现（功能计划）。
