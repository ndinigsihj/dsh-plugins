# 13 — 文档收口与升级节奏政策

**What to build:** 写升级收口文档（as-built：实际版本、迁移范围、裁决落地情况、遗留项与未验证项），回填计划、spec 与术语表状态，并把升级节奏政策写入维护文档（日常跟稳定版、预发布只侦察、每个新稳定版按同一取证模板在固定窗口内升级）。

**Blocked by:** 12 — 收口验证与部署

**Status:** done — 2026-09-26（收口文档 + 计划/spec/流程状态回填 + 节奏政策落地 + 证据索引；**改动未提交**，待用户确认后 commit；产物 `docs/dsh-v0.1.7-rc.1-upgrade-closeout.md`）

**施工图:** `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Implementation Decisions：节奏政策；Further Notes）；升级计划 §7 节奏政策

- [x] 收口文档覆盖实际版本、迁移范围与遗留未验证项
- [x] 计划/spec 状态与流程状态文件回填
- [x] 节奏政策写入维护文档并被等价入口引用
- [x] 证据索引完整：新基线、工具面快照、迁移清单、部署校验
- [x] 不新增未批准的改动

**范围外（本票不做）:** 下一轮升级的实施；功能计划文档。

---

## 验收回填（2026-09-26）

- **收口文档**：新增 `docs/dsh-v0.1.7-rc.1-upgrade-closeout.md`（as-built：实际版本、14 票交付状态、
  裁决落地对照、P0/P1 迁移对照、收口验证命令与结果、测量结论、遗留与未验证项、回滚条件、证据索引、提交状态）。
- **状态回填**：升级计划头部状态改为「已执行并收口」；spec 头部加批准/收口状态；
  本票勾选并回填；`.dsh/ask-matt-flow/state.md` 更新本轮阶段、边界与产物（流程状态文件）。
- **术语表回填**：`CONTEXT.md` 补 `Preset carrier（预设载体）` 与 `Team profile（Team Profile）` 两条
  本轮定稿术语，并加收口状态注记。
- **节奏政策落地**：`README.md` 新增「宿主升级节奏」政策正文（政策唯一正文）；
  `docs/deployment.md` §4 增加发布/部署侧指针；计划 §7 节奏政策段标注落地位置（历史裁决原文）。
- **证据索引**：closeout §10 按收口项点名四类（新基线 / 工具面快照 / 迁移清单 / 部署校验）并按票据索引
  01–14 与闸门报告目录；本票静态层 as-run 日志归档 `evidence/13-static-layer.txt`。
- **未新增功能改动**：本票只改文档（closeout、README、deployment、计划、spec、CONTEXT.md、票面）与
  流程状态文件，并新增一份证据日志；未碰 preset、闸门、部署位与脚本。
- **验证**：`npx tsc --noEmit` exit 0、`npm test` 205/205 exit 0（2026-09-26，as-run 日志见
  `evidence/13-static-layer.txt`）。
