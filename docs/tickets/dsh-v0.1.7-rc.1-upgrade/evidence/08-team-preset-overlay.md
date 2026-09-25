# 08 — B1.5 实测：Team Profile 的 Preset 叠加（0.1.7-rc.1）

> 日期：2026-09-25　宿主：`@deepseek-ai/dsh@0.1.7-rc.1`（installAnchor = 全局 v24 安装）
> 关联：`docs/dsh-v0.1.7-rc.1-upgrade-plan.md` §5.3 票 B1.5、`docs/dsh-v0.1.7-rc.1-upgrade-spec.md`「Implementation Decisions：Team」
> 载体：A 真 PTY（`scripts/tui-pty-smoke.mjs`，参数化 Profile/Preset + stub provider + 工具探针）；
> B 进程内假模型对照（`gates/stub/run.mjs --scenario team-preset-overlay`）
> 范围外：真实模型调用、部署位写入（12）、Team 功能面（功能计划）、peer 消息可达性。

## 1. 结论

**测得（非「未测」）。自研 `minimal-plus` preset 在 Team Profile 下真正生效；普通委派工具与 Team 创建工具并存；回退方案（Team Profile 不让自研 Preset 下沉）不需要执行。**

| 问题 | 实测结果 | 证据 |
| --- | --- | --- |
| preset 是否真正生效（哨兵） | ✅ Lead 与 teammate 的工具面都出现 preset 独有行。PTY 臂哨兵 `skill_search`（preset 的 `skill-search.mjs` 独有；tui-dev profile 自带 `tool-ask-user`，`ask_user_question` 在 PTY 组合里不能当哨兵）；进程内臂哨兵 `ask_user_question`（headless base 不带，仅 preset `tool-ask-user` 行注册） | 表 1/2/3 |
| 首轮锚定是否保持 | ✅ R1 模型可见目录仍为 `[bash, str_replace_editor]`；promotion 后才放行完整目录 | `preset.anchored-first-turn` |
| `subagent` 与 `spawn_teammate` | **并存**：两者同时进入模型可见目录（request/header 的 tools 与注册面一致） | 表 1/2 |
| 路由发现工具 `list_subagent_models` | ✅ 出现（Lead 与 teammate 都有；来自 preset 的 `delegation/tool-subagent` `modelSelectionSettings: true`） | 表 1/2 |
| `subagent_fork` | ❌ Team 组合下不出现（Team bundle 的组合期 `disabled: true` 生效；preset 只带回 `subagent`） | 表 1 diff |
| teammate 是否继承 Lead preset | ✅ `agentPreset=minimal-plus`（header + projection 双证），工具面与 Lead 一致 | `overlay.teammate-inherits-preset` |
| 成员工具与权限的真实形状 | teammate 工具面 **可见** `spawn_teammate`，但 `spawnTeammate` / `interrupt` 均以 `TEAM_LEAD_REQUIRED` 拒绝 → 权限必须读 roster role，不能用「工具是否存在」判断 | `permission.member-cannot-*` |
| 真实用户目录写入 | 零（配置面 before/after sha 全同） | `08-real-home-zero-write.txt` |

**对 09 的输入**：`tui-team` 可以携带自研 preset 与 Team 组合包同 profile 共存；工具面基线按表 1 的 **+6 / −1** 行级差异建立；显示层权限判定读 `ctx.agentTeams` 的 role，不读工具存在性。本票只回答「实际行为是什么」，不为「并存」背书设计（并存的两个委派工具是否该同时暴露由 09/后续裁决）。

## 2. 方法（可复现）

### 2.1 载体 A：真 PTY（preset 选择走 TUI 真实路径）

`scripts/tui-pty-smoke.mjs` 本票新增参数化与工具探针：

```sh
# Team 组合：真实 tui-dev 只读源 → 派生 tui-team（追加 Team bundle），preset 由 TUI 真实选择/挂载
node scripts/tui-pty-smoke.mjs \
  --profile tui-team \
  --extra-bundle @deepseek-ai/dsh-experimental-agent-team-profile \
  --probe-tools --keep-temp --report /tmp/t08-pty-team.json

# 对照组：原 tui-dev 组合（不改 profile）
node scripts/tui-pty-smoke.mjs --probe-tools --keep-temp --report /tmp/t08-pty-dev.json
```

- 隔离：`DSH_HOME`/`HOME` 都指向 `$TMPDIR/dsh-pty-smoke-*/home`；真实 `~/.dsh` 只读渲染，`settings.yaml` 只复制进临时 home。
- 组合：真实 `~/.dsh/profiles/tui-dev` 渲染副本 + `--extra-bundle` 追加 `dsh.profile.bundles`；`pty-smoke.patch.yml` 把 `tui-runner.preset` 钉到 `minimal-plus`（新支持 `PTY_SMOKE_PRESET`），路由钉到 stub，零真实 provider 请求。
- 探针：`gates/stub/tool-probe.patch.yml` + `tool-probe.mjs` 把每个 Agent 的**注册面**（`ctx.tools.schemas(agent)`）与 header（origin/depth/preset/role）写到 `tool-surface.json`；冒烟另从根会话日志最后一个 `request/header` 取**模型可见目录**（promotion 后的真实请求面）。
- preset 来源：部署位副本缺 `plugin-teardown.mjs`（部署同步在票据 12），按既定回退取**仓库真源**；staged bundle 的 `source-manifest.json` 与 `gates/manifest.json` 一致（`agent.cordis.yml` = `8cd01c685032eda95f68ded9b0796f72d0578e9d22a2274fe50aad8435dcc47b`）。
- 断言：15/15（含新增 `tool-probe.captured`）；默认组合仍 15/15（原有 14 条 + 探针）。Team 模式下 `tool-probe.captured` **同时钉死**哨兵（`skill_search`）与并存关系（注册面和模型可见目录都要有 `subagent` + `list_subagent_models` + `spawn_teammate`），不是只看 Team 工具存在。

### 2.2 载体 B：进程内假模型对照（`gates/stub/scenarios/team-preset-overlay.mjs`）

```sh
node gates/stub/run.mjs --scenario team-preset-overlay --json /tmp/t08-control.json
```

- 场景声明 `bundles: [TEAM_BUNDLE]`；T2 runner 据此在隔离 headless profile 里追加该 bundle（新增 per-scenario bundles 接线）。Team 包名唯一来源 = `gates/team-bundle.mjs`。
- preset 经 `agents.create({ setup })` 挂载（与 TUI runner 同一 `agentPresets.mount` seam），header 记录 `agentPreset`；`assert` 只读事实与拒绝码。
- 测量机械（抓取时点、teammate 保活、promotion 续写）在 `gates/stub/team-overlay-probe.mjs`，场景文件只留契约与断言。
- 直接 `ctx.agentTeams.spawnTeammate(lead, …)` 造 teammate，并做成员权限探测：teammate 调 `spawnTeammate` / `interrupt`。
- 断言：8/8。

### 2.3 哨兵选择说明

- 进程内 headless 组合没有 `tool-ask-user` 行 → `ask_user_question` 是干净的 preset 哨兵（票面建议的哨兵成立）。
- PTY 组合的真实 `tui-dev` profile 自带 `tool-ask-user` → `ask_user_question` 不能区分 preset 是否生效；改用 preset 的 `skill-search` 行（`skill_search`/`skill_load`）作哨兵。两个载体的哨兵都出现在 Lead 与 teammate 的工具面。

## 3. 工具面快照

### 表 1：PTY Team vs tui-dev（模型可见目录 = 最后一个 `request/header.tools`，按名排序）

| | tui-dev（对照，35） | tui-team（Team+preset，40） |
| --- | --- | --- |
| 共有（34 项） | `ask_user_question`, `bash`, `create_goal`, `edit`, `exit_plan_mode`, `get_goal`, `glob`, `grep`, `interrupt_agent`, `job_kill`, `job_list`, `job_output`, `list_agents`, `list_subagent_models`, `project_bind`, `project_unbind`, `read`, `read_image`, `recall`, `remember`, `send_message`, `skill`, `skill_load`, `skill_search`, `state_get`, `state_update`, `str_replace_editor`, `subagent`, `todo_write`, `update_goal`, `web_fetch`, `web_search`, `workflow`, `write` | 同左 |
| Team 新增（+6） | — | `spawn_teammate`, `wait_agent`, `team_task_create`, `team_task_get`, `team_task_list`, `team_task_update` |
| Team 移除（−1） | `subagent_fork` | — |
| 同名换源（3） | `list_agents`/`send_message`/`interrupt_agent` 来自 base 的 control 行 | 同三行由 Team 作用域的 `tool-agent-team` 提供（base 行被组合期禁用，工具名不变） |

R1（banner 后、promotion 前）两个组合都只有 `bash` + `str_replace_editor`。注册面（`ctx.tools.schemas`）与模型可见目录在稳定态一致（Team 40 / tui-dev 35）。

### 表 2：进程内对照（headless + Team bundle + preset，注册面 34）

```
ask_user_question bash create_goal edit exit_plan_mode get_goal glob grep
interrupt_agent job_kill job_list job_output list_agents list_subagent_models
read read_image send_message skill skill_load skill_search spawn_teammate
str_replace_editor subagent team_task_create team_task_get team_task_list
team_task_update todo_write update_goal wait_agent web_fetch web_search workflow write
```

与表 1 Team 组合的 40 之差 = 本对照没有 tui-dev profile 的 6 个 endless 工具（`project_bind`/`project_unbind`/`recall`/`remember`/`state_get`/`state_update`）——`subagent`/`list_subagent_models`/`ask_user_question` 均在，`subagent_fork` 同样不在。

### 表 3：成员（teammate）事实 —— **来源：进程内对照臂（T2）**

> PTY 臂按设计不创建 teammate（stub 回放按全局轮次消费，spawn 会打乱 boot1/boot2 的既有断言）；
> 成员事实由 spec 指定的进程内假模型对照臂产出。PTY 的原始探针文件只含根会话与 /rewind 的
> fork 子会话（`origin=root`、`delegationDepth=0`），不含 teammate 快照。

| 项 | 值 |
| --- | --- |
| header | `origin=subagent`, `delegationDepth=1`, `parentSession=<Lead>`, `agentPreset=minimal-plus` |
| role（`tryMembership`，在线时） | `teammate` |
| 工具面 | 34（= Lead 工具面，含 `ask_user_question`、`subagent`、`list_subagent_models`；含可见但不可用的 `spawn_teammate`） |
| `spawnTeammate(teammate, …)` | 拒绝：`TEAM_LEAD_REQUIRED` — “only the Team Lead can create teammates” |
| `interrupt(teammate, 'lead')` | 拒绝：`TEAM_LEAD_REQUIRED` — “only the Team Lead can interrupt teammates” |

### 表 4：静态对照（承 02/B1 取证）

- 02（无 preset，Team 开启）：`subagent`❌ / `spawn_teammate`✅，28 工具。
- 本票（Team + minimal-plus preset 真正挂载）：`subagent`✅ **与** `spawn_teammate`✅，40 工具 → 证实上游 bundle README 的「顶层组合包不会替换预设作用域的注册」。
- 03 的 teammate 路由/权限结论在 preset 下沉后仍成立（本票复核）。

## 4. 测量纪律与附带发现

1. **采样时点**：Team 工具与 `subagent`/`list_subagent_models` 在 `agent/created` 之后一个 microtask 才出现在注册面（PTY Team：created 29 → immediate 40；tui-dev：34 → 35，deferred 的是 `list_subagent_models`）。工具面必须在**稳定态**采样；只抓 `agent/created` 会漏 Team 工具。09 的 profile 维度快照也应按此口径。探针按 `sessionId:label` 分别留档，根会话取「`delegationDepth=0` 且 `parentSession=null`」的最大面——`/rewind` 的 fork 子会话也是 depth 0，但有 `parentSession`，不能当根。
2. **teammate 的 Agent 作用域工具随 Agent 处置注销**：teammate 的短回合结束后 Agent 被处置，Team 工具随之注销（preset 的 standing mount 工具仍在），此时异步轮询会偶发测到「只有 preset、没有 Team 工具」的 23 工具面。对照臂改为在 `agent/created` 同步抓取，并给 teammate 初始回合加 `delay` 保持在线做权限探测；连续 8 次运行（5 独立 home + 3 共享 home）全绿。
3. **附带修复（PTY 冒烟前置）**：`scripts/tui-pty-smoke.mjs` 的 `listSessionLogs` 原本写死 `session.v3.jsonl.zstd`，0.1.7 V4 写成 `session.v4.jsonl.zstd`，导致 PTY 冒烟在 V4 上必然找不到会话（`boot1: no persisted session log found`）。已改为按 `session.v*.jsonl.zstd` 就地发现（数字版本序，v3/v4 兼容）。
4. 未发现上游竞态或缺陷；1 与 2 均为测量时点问题，已在工具/场景里固化。

## 5. 证据文件

| 文件 | 内容 | sha256 |
| --- | --- | --- |
| `evidence/08-pty-team.json` | PTY Team 臂完整报告（15/15；`tool-probe.captured` 钉死哨兵+并存；`toolProbe.snapshots` + `modelVisibleTools`） | `6d6922b06ba11dd4f107a13c23248aa5981142ad56a8e510c42667c32ca0391d` |
| `evidence/08-pty-team-tool-surface.json` | PTY Team 臂原始探针输出（根会话 + /rewind fork 子会话的 created/immediate/1000/status 快照） | `a35b257e6cc389f832d99582a35d82e47e71cee799c2dfe470addd88423cd43e` |
| `evidence/08-pty-tui-dev.json` | 默认 tui-dev 对照报告（15/15；35 工具，含 `subagent`/`subagent_fork`） | `5a8a4286d3db26dafadbfca68a757dcfbf6913360528451c6456673b79ca3b5c` |
| `evidence/08-pty-tui-dev-tool-surface.json` | 默认组合原始探针输出 | `1d086eab7aef0e86ee3a9a37a2231f6866241915a56a075443226efe6c5abaec` |
| `evidence/08-control-team-overlay.json` | 进程内对照报告（8/8；lead/teammate 事实与拒绝码） | `3558f474baa7947be1b1b76f1e0c3090f349c5450d4865cf477e405d9aecb810` |
| `evidence/08-real-home-before.sha256` / `evidence/08-real-home-after.sha256` | 真实 `~/.dsh` 配置面 before/after 快照（32 行 sha256，两份逐字节相同） | 均 `6f0d7ea3943e1840b21be10bbb1889597230933deb7a584571f250964c1e0405` |
| `evidence/08-real-home-zero-write.txt` | 零写入核对说明与命令 | — |

原始临时前缀在归档原始探针输出后已删除（含 settings 明文副本，不留在磁盘）；报告 JSON 内嵌完整快照，重跑命令见 §2.1/§2.2 可复现（默认不带 `--keep-temp` 时冒烟自行清理临时 home）。对照臂的临时 home 由 runner 退出即删。零写入窗口覆盖本票全部实测命令（before 在首轮实测前、after 在最后一轮实测后）。

## 6. 未测 / 边界

- 全程 stub provider，无真实模型调用；「模型会不会正确使用并存的两个工具」不在本票结论内。
- teammate 的 peer 消息可达性、Team 任务板写路径、真实模型下的路由继承未在本票测（03 已有部分静态/进程内结论）。
- 部署位仍为旧目录形态（票据 12）；本票 PTY 实测按回退取仓库真源，不影响叠加结论。
