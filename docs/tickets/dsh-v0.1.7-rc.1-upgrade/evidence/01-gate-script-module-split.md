# 01 — Prefactor：组合闸门脚本拆模块（验收证据）

**日期：** 2026-09-24
**基准：** HEAD `6a432b5`（拆分前 `gates/run.mjs` 990 行 / `runGate` 247 行）
**状态：** 实现与验收完成；**改动未提交**（按约定等用户确认后 commit）。
**施工图：** `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Testing Decisions：组合与闸门 seam）；结构欠账出处 `docs/tickets/regression-test-automation/evidence/13-stage7-fixes.md` §二（“`gates/run.mjs` 980 行 / `runGate` 247 行属已记录的结构欠账，处理时机定在它下一次功能改动时按 T0/T1/T2/T3 分层拆模块并单独立票”）。

## 一、拆分结果（职责 → 模块）

| 职责（票面用词） | 落点 | 行数 |
| --- | --- | ---: |
| 编排入口 / CLI 接线 | `gates/run.mjs` | 280 |
| 报告（骨架、分层记录、摘要） | `gates/report.mjs` | 81 |
| 断言收集 | `gates/gate-helpers.mjs`（既有；新增 `readJson` / `tailLines`） | 133 |
| 组合导出解析 | `gates/dump-parse.mjs`（既有） | 45 |
| 部署位校验（纯比对 / T1 断言） | `gates/manifest.mjs`（既有）+ `gates/t1/deployment.mjs` | 206 / 36 |
| 宿主钉版与会话格式断言（含宿主代解析、PRE 钉版检查） | `gates/host-pin.mjs` + `gates/preconditions.mjs` | 53 / 109 |
| 隔离快照（真实 home 指纹与隔离断言） | `gates/isolation.mjs` | 100 |
| 假模型驱动入口（T2 编排 + 既有 runner） | `gates/t2.mjs` + `gates/stub/run.mjs`（既有） | 111 / 286 |
| T0 静态层 | `gates/t0.mjs` | 50 |
| T1 编排 / 组合面 / preset 冒烟 | `gates/t1/run.mjs` / `gates/t1/composition.mjs` / `gates/t1/preset.mjs` | 81 / 195 / 111 |
| 路径常量 / 临时 home 预置 | `gates/paths.mjs` / `gates/gate-home.mjs` | 35 / 55 |

硬标准核对（TypeScript AST 逐文件、逐函数）：拆出的 12 个文件全部 ≤280 行；全部函数 ≤50 行（最长 `runGate` 46 行）；参数 ≤4；无 `any`。`gates/run.test.mjs` 的 `strictIsolationDiffs` 导入随函数移动到 `./isolation.mjs`（用例数与断言不变）。

## 二、验收核对

### 1. 类型与单测

| 命令 | 拆分前 | 拆分后 |
| --- | --- | --- |
| `npx tsc --noEmit` | exit 0 | exit 0 |
| `npm test` | 157/157 pass | 157/157 pass（用例数不减少） |

### 2. 同一输入下的报告对照（核心）

两次同参命令：

```
scripts/regression-gate.sh --tier 0,1,2 --allow-stale-deployment --json <report>.json
```

- 拆分前报告：`experiments/regression-gate/evidence/01-gate-split-before-t012.json`
- 拆分后报告：`experiments/regression-gate/evidence/01-gate-split-after-t012.json`
- 归一化比较输出：`experiments/regression-gate/evidence/01-gate-split-normalized-diff.txt`

归一化项仅为运行噪声（时间戳、临时 home 路径、UUID、`gitDirty`、`strict:false` 观测区的 `observedChanges` 计数、随 checkout 位置变化的 sha）。**剩余差异只有一条**：

```
tiers[2].assertions[13].evidence
  before: "no sync invocation in 8 gate sources"
  after:  "no sync invocation in 20 gate sources"
```

原因与裁定：拆分后闸门源码面从 8 个文件变为 20 个；`gate.no-deployment-sync` 的判据是「闸门自身不含部署位同步动作」，若不同步纳入新模块就会漏扫。因此把新模块加入扫描面——**判据未变、未放宽**，扫描范围是拆分前的超集；这是唯一有意为之的对外可见差异。报告顶层键序、字段名、断言 id/status、豁免记账与退出码逻辑均与拆分前一致。

### 3. 分层命令逐层实跑

| 层 | 命令 | 退出码 | 断言 |
| --- | --- | ---: | --- |
| T0 | `--tier 0` | 0 | 6/0/0 |
| T1 | `--tier 1 --allow-stale-deployment` | 0 | 17/0/0 |
| T2 | `--tier 2` | 1 | 20 pass / 4 fail |

T2 的 4 条失败为**拆分前既存的环境问题**，与本拆分无关：4 个 bash/PTY 场景（`bash-first-call`、`bash-first-step-batch`、`bash-promotion-visible`、`v3-resume-route`）以 `libc++abi: terminating due to uncaught exception of type Napi::Error`（`exit null` / shell 报 `Abort trap: 6`）崩溃。拆分前同一命令同样 4 条、同一 stderr；单独运行 `STUB_HOME=<tmp> node gates/stub/run.mjs --scenario bash-first-call` 同样 exit 134。前后报告 `tiers[T2]` 逐条一致（见归档的前/后 JSON）。

### 4. 两种豁免语义（各自红/绿路径实测，拆分前后同路径）

归档：`experiments/regression-gate/evidence/01-gate-split-exemptions.txt`（逐条列出前/后的 T1 状态、summary、`exemptions[]` 与 deployment 断言证据）。

| 场景 | 拆分前 | 拆分后 |
| --- | --- | --- |
| stale，未豁免 | exit 1；FAIL `stale: agent.cordis.yml:stale` | 同 |
| stale + `--allow-stale-deployment` | exit 0；PASS `exempted (stale) by --allow-stale-deployment: …`；`exemptions[]` 记账 | 同 |
| absent（HOME=空目录），未豁免 | exit 1；FAIL `absent: <8 文件>` | 同 |
| absent + `--skip-deployment-check` | exit 0；PASS `exempted (absent) by --skip-deployment-check: …`；`exemptions[]` 记账 | 同 |

### 5. 环境前置 exit 2 与 T3 拒绝路径

| 场景 | 拆分前 | 拆分后 |
| --- | --- | --- |
| 缺 `dsh` CLI（PATH 去掉 shim）→ `--tier 0` | exit 2；FAIL `host.cli — exit null spawnSync dsh ENOENT`；T0 SKIP（同文案） | 归一化逐字一致 |
| `--tier 3`（基线宿主 0.1.5-rc.1 与清单 0.1.5-rc.2 不符） | exit 2；T3 SKIP `refused: baseline …` | 归一化逐字一致 |

### 6. real 组合（`--composition real`）

`scripts/regression-gate.sh --tier 1 --composition real --allow-stale-deployment`（env 显式给 `DSH_RELAY_ROOT` / `DSH_ENDLESS_ROOT`）：拆分前后均 19/0/0、exit 0；`composition.source-profile-unchanged` 通过（真实 `tui-dev` profile 渲染前后 sha 一致）。除 GATE_SOURCES 计数与随 checkout 位置的渲染 sha 外逐条一致。

### 7. 隔离与用户目录

- 所有层的 `isolation.real-home-untouched` 均通过（严格区零变化；`storages` 是 `strict:false` 观测区）。
- 未写部署位、未运行 `scripts/sync-agent-presets.sh`、未动真实 `~/.dsh`；写操作只落 `GATE_TEMP` 与报告路径，T1 新增的扫描面不改这一点。

## 三、已知遗留 / 说明

1. T2 的 4 条原生崩溃是既存环境问题（拆分前后逐字一致、standalone 可复现），本票不修；正常环境复核命令：`scripts/regression-gate.sh --tier 2`。
2. `gates/t3/run.mjs`（511 行）与 `gates/stub/run.mjs` 内 `run()`（>50 行）是拆分前既存结构欠账，不在本票范围内；如需处理，另立小票。
3. 改动未提交；是否 commit / push 由用户裁定。
