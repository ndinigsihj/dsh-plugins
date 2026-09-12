# Stage 7 修复记录 — 票据 12 审查 findings（2026-09-12）

- 授权：用户「按建议」——采纳 Stage 6 Review 后的 triage 建议：修 Spec c1/c2/c3 + Standards#3；其余只记录；Spec a1/a2 先核实后处置。
- 审查来源：全新上下文子代理、基点 `4ddcfc2...HEAD`（17 commits）；报告两轴见下方对照。
- 收口状态：修复完成并本地验证，**未 commit / 未 push**（待用户确认）。

## 一、选定修复与落实

### Spec c1 — T1/T2 隔离断言窗口（`gates/run.mjs`）

**问题**：`realHomeAfter` 在 T1 启动前构造 config 时采样（旧 L837），断言在 `runT1` 内消费（旧 L500），T1 自身子进程与 T2 的写入窗口不在覆盖内。

**修法**：
- T1 后快照移入本层末尾（⑨ 处 `scanRealHome(config.manifestObj)`），覆盖「闸门启动 → T1 结束」；
- 原 `t3IsolationAssertions` 泛化为 `isolationAssertions(id, before, after)`；
- T2 结束后追加 `t2.isolation.real-home-untouched`（窗口 = 运行开始 → T2 结束，累计式，保证 `--tier 0,1,2` 无 T3 时也覆盖 T1/T2）；
- T3 改用同一 helper（id 不变：`t3.isolation.real-home-untouched`）。

**负控（fake HOME，全部落在 `$TMPDIR` 下，未碰真实 `~/.dsh`）**：在 `runT1` 开头写入严格区文件 `~/.dsh/profiles/gate-isolation-nc`。

| 步骤 | 命令（均 `HOME=<mktemp -d>`） | 结果 |
| --- | --- | --- |
| 基线（无注入） | `--tier 1 --skip-deployment-check` | exit 0；`isolation.real-home-untouched` PASS |
| 复现旧窗口（临时按旧位置取前快照 + 注入写） | 同上 | **exit 0 / PASS（假阴性复现）**，且 fake home 内确实出现 `gate-isolation-nc` |
| 修复后（新窗口 + 同注入） | 同上 | **exit 1 / FAIL** `[{"zone":"profiles","change":"changed","before":0,"after":1}]` |
| 移除注入后复绿 | 同上 | exit 0；17/0/0 |
| 全量（真实 HOME、无豁免） | `--tier 0,1,2` | **59/0/0**，T1 与 T2 两条隔离断言均 PASS |

临时 NC 代码已完全移除（`grep tmpdir|legacyHomeAfter|gate-isolation-nc` 无命中）；`git diff gates/run.mjs` 只剩上述修复。

### Spec c2 — 串行锁措辞（计划 Q20）

`scripts/regression-gate.sh` 实现是「原子 `mkdir` + PID + 过期回收」（macOS 默认无 `flock` 命令）。按实现口径修正计划 3 处：§0 Q20 表、§2.2、§4.2，「flock」→「原子 mkdir 锁」并注明修正理由。未改脚本行为。

### Spec c3 — `scripts/release.sh` 陈旧注释

「T2 degrades to an explicit skip until tickets 06/07」→「T2 the scripted stub behaviour layer (tickets 06/07)」，与 T2 已落地且被同一命令调用的现状一致。

### Standards #3 — Q25 守卫 / 收尾断言抽公共（`gates/stub/inspect.mjs`）

新增 `routeGuard(events, label)` 与 `turnCompleted(events, label)`（返回 `{ok, evidence}`），5 个场景改用：
`bash-first-call`、`bash-promotion-visible`、`v3-resume-route`、`delegation-inherit-route`、`delegation-reject-route`。
`session.turn-completed` 4 处重复与 `route.first-request` 5 处重复消除；各场景原有 evidence 文案（含 `resumed …` 前缀）保留。

过程记录：首轮 T2 因 `v3-resume-route.mjs` 漏留 `routeLabel` 导入报 `routeLabel is not defined`（gate 如实捕获，exit 1）；补回导入后 T2 42/0/0。

## 二、核实后记录不修（两轴 finding 全量）

| finding | 处置 |
| --- | --- |
| Standards 1/2（`gates/run.mjs` 980 行、`tui-pty-smoke.mjs` 872、`t3/run.mjs` 511；多个 >50 行函数） | 只记录。沿用上轮 Stage 7「非必要不动」裁定；`gates/run.mjs` 超线自票据 03 起已记录在案。 |
| Standards 4/5/6（turn builder/`tailLines`/`isRecord` 重复；`gates/run.mjs` divergent change；workflow `paths` 双份） | 只记录。判断项/结构性；YAML 无法锚点复用（GitHub 不支持 anchors），重复属格式要求。 |
| Spec a1 审批/问答卡无断言 | 核实：计划 §3.2 写宽于票据 08 的验收清单（9 条不含审批/问答卡），实现与票据一致。已改正 `docs/visual-triage-and-manual-signoff.md`：几何/文本层删「审批卡」并加补充说明（该面需工具路由触发，属人工验收）。不新增断言（超出本票范围）。 |
| Spec a2「两个 profile 分别 dump」 | 核实：每次运行只导出一条组合（gate=headless+patch；real=渲染副本）；源 dev profile 仅只读 sha 断言（`composition.source-profile-unchanged`）。对源 profile 跑 `--dump-config` 会回写真实 profile（finding 01-2），与「真实 home 零写入」强约束冲突，故按「只读 + sha 等价面」接受，记录不修。 |
| Spec b1 路由退役 / T3 重采基线 | 用户 2026-09-12 已裁定的退役与重采，非 scope creep；只记录。 |
| Spec b2 T4b 的 route 用 stub | 确定性设计的已文档化取舍（T4b 验 TUI 机制，不进真实额度）；只记录。 |

**正式收口（2026-09-12，Stage 8 之后）**：以上只记录项不再留作开放尾巴——workflow `paths` 双份是 GitHub 格式要求
（不支持可复用锚点），无修法；`gates/run.mjs` 980 行 / `runGate` 247 行属已记录的结构欠账，处理时机定在它下一次
功能改动时按 T0/T1/T2/T3 分层拆模块并单独立票，而不是收口后做纯结构调整。票据侧：01–12 的 Status 行陈旧
「未提交 / 未 push」字样已统一回填为对应提交与 push 事实（`7f837ea`…`76f7c45`）。

## 三、验证汇总（最终树）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `npx tsc --noEmit` | exit 0 |
| 单测 | `npm test` | **154/154**，0 fail |
| T2 | `scripts/regression-gate.sh --tier 2` | **42/0/0**（报告 `13-stage7-t2.json`） |
| 全量 | `scripts/regression-gate.sh --tier 0,1,2`（无豁免） | **59/0/0**（报告 `13-stage7-t012.json`） |
| 隔离负控 | 见 §一 c1 | 旧窗口假阴性复现 → 新窗口红 → 移除注入复绿 |
| stable/工作流/preset | — | 未触碰（本轮只改 dev 侧 gates/docs/注释） |

## 四、产物

- 报告/输出：`experiments/regression-gate/evidence/13-stage7-t2.{json,stdout.txt}`、`13-stage7-t012.{json,stdout.txt}`、`13-nc-baseline.{json,stdout.txt}`、`13-nc-legacy-window.{json,stdout.txt}`、`13-nc-fixed-window.{json,stdout.txt}`、`13-nc-final.{json,stdout.txt}`
- 代码/文档改动：`gates/run.mjs`、`gates/stub/inspect.mjs`、`gates/stub/scenarios/{bash-first-call,bash-promotion-visible,v3-resume-route,delegation-inherit-route,delegation-reject-route}.mjs`、`scripts/release.sh`（注释）、`docs/regression-test-automation-plan.md`（Q20 措辞）、`docs/visual-triage-and-manual-signoff.md`
- 未 commit；是否提交与是否进 Stage 8 交接由用户裁定。
