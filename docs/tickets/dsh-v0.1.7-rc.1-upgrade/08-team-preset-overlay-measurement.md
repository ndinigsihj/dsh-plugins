# 08 — B1.5：Team Profile 的 Preset 叠加实测（硬前置）

**What to build:** 在隔离 home 的 Team Profile 上实测 Preset 与 Team 组合的叠加行为：先用哨兵行证明 Preset 真正生效，再读实际工具面——普通委派工具是否与 Team 创建工具并存、路由发现工具是否出现、成员工具与权限的真实形状。优先在真 PTY 冒烟上承载（参数化 Profile 与 Preset、stub provider），进程内假模型 harness 作对照。不可测时按回退结论（Team Profile 不让自研 Preset 下沉）落字"未测"。

**Blocked by:** 04 — 宿主升级与两个工作 Profile 到位；07 — Preset 载体迁移与同步工具 dry-run

**Status:** done — 2026-09-25（测得，非「未测」：PTY Team 臂 15/15 + 进程内对照 8/8；真实用户目录零写入；改动未提交，待用户确认后 commit）

**施工图:** `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Implementation Decisions：Team）；升级计划 §5.3 票 B1.5

- [x] 哨兵行在实测会话中可见，证明 Preset 生效（而非"被跳过"）——PTY 臂 `skill_search`（preset 独有；tui-dev profile 自带 tool-ask-user，故不用票面建议的 ask_user_question）；进程内臂 `ask_user_question`
- [x] 记录普通委派工具与 Team 创建工具的实际关系（并存/互斥）及路由发现工具是否出现——**并存**：`subagent` + `list_subagent_models` + `spawn_teammate`/`wait_agent`/`team_task_*`；`subagent_fork` 被 Team 组合期禁用
- [x] Team Profile 的工具面快照留档，含成员权限只读结论——PTY Team 40 工具 / 默认 tui-dev 35 工具（+6/−1 行级差异）；成员：teammate 继承 preset、工具面同 Lead，但创建/中断调用以 `TEAM_LEAD_REQUIRED` 拒绝
- [x] 不可测时：回退结论与"未测"字样写入票面，并作为 09 的施工输入——**不适用（本票测得，未写「未测」）**；结论仍作为 09 输入
- [x] 真实用户目录零写入；临时前缀可复现——配置面 before/after sha 一致；命令与临时前缀见证据 §2/§5

**范围外（本票不做）:** 建立真实 tui-team Profile（09）；Team 体验实现（功能计划）。

---

## 验收回填（2026-09-25）

证据：`evidence/08-team-preset-overlay.md`（原始报告 `08-pty-team.json` / `08-pty-tui-dev.json` / `08-control-team-overlay.json` / 两个 `*-tool-surface.json` / `08-real-home-zero-write.txt`）。要点：

- **结论**：自研 preset 在 Team Profile 下真正生效且与 Team 创建工具**并存**；首轮锚定保持；主会话首轮仍 `[bash, str_replace_editor]`。→ `tui-team` 可携带自研 preset，09 无需按回退口径建。
- **工具面**：PTY Team（真实 preset 选择路径）40 = tui-dev 35 − `subagent_fork` + `spawn_teammate`/`wait_agent`/`team_task_create/get/list/update`；`list_agents`/`send_message`/`interrupt_agent` 同名换源（base 行禁用 → Team 作用域提供）。进程内对照 34 = Team 9 + preset 带回的 `subagent`/`list_subagent_models`/`ask_user_question`，无 `subagent_fork`。PTY 探针断言 `tool-probe.captured` **同时钉死**哨兵与并存（注册面 + 模型可见目录都要有 `subagent` + `list_subagent_models` + `spawn_teammate`），不是只看 Team 工具存在。
- **成员**：teammate `agentPreset=minimal-plus`（header+projection）、depth 1、工具面 = Lead；`spawn_teammate` 可见但 `spawnTeammate`/`interrupt` 以 `TEAM_LEAD_REQUIRED` 拒绝 → 显示层权限读 role，不读工具存在性。成员事实来自 spec 指定的进程内对照臂（PTY 臂不创建 teammate，避免打乱 stub 回放；证据表 3 已标注来源）。
- **接线**：`scripts/tui-pty-smoke.mjs` 参数化（`--profile`/`--source-profile`/`--preset`/`--extra-bundle`/`--probe-tools`）+ `gates/stub/tool-probe.{patch.yml,mjs}`；`gates/composition/render-real.mjs` 支持派生 profile 名与 extra bundles（单测拆到 `render-real-derived.test.mjs`，fixture 共享 `render-real.fixtures.mjs`）；T2 runner per-scenario `bundles` + `gates/stub/scenarios/team-preset-overlay.mjs`（测量机械在 `gates/stub/team-overlay-probe.mjs`）；Team 包名唯一来源 `gates/team-bundle.mjs`；bundle 清单写入收拢到 `scripts/agent-preset-bundle.mjs` 的 `mutateProfileBundles`。
- **附带修复**：`scripts/tui-pty-smoke.mjs` 的会话日志发现原写死 `session.v3.jsonl.zstd`，0.1.7 V4 下 PTY 冒烟必红；已改为 `session.v*.jsonl.zstd` 数字版本序发现（V3/V4 兼容）。
- **测量纪律**：工具面须在稳定态采样（Team 工具与 `subagent`/`list_subagent_models` 在 `agent/created` 后一个 microtask 才注册）；teammate 的 Agent 作用域工具随处置注销，须在线时抓取；根会话快照按 `delegationDepth=0 && parentSession=null` 选取（fork 子会话 depth 也为 0）。
- **未提交**：改动待用户确认后 commit；真实部署位未动（12）。

