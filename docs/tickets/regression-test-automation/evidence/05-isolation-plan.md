# 05 — 隔离改造小方案（待确认；**确认前不动代码**）

- 拟稿时间：2026-09-11 19:4x
- 对应票面：票据 05 前三条（runner 改隔离写、报告改仓库归档、重跑计数对比证明）
- 依赖决策：Q2（隔离策略）、Q4/Q11（清理范围）、D3（stable 侧不修改）、Q7/Q18（报告落点约定）

## 现状（已核对代码）

| runner | 入口 | 会话落点 | 报告落点 |
| --- | --- | --- | --- |
| 行为基线（M4） | `dsh --profile headless --patch experiments/m4/m4.patch.yml` | 无覆盖，用 profile 默认 `session-persistence-jsonl.root = dshHomePath('sessions')` → 真实 `~/.dsh/sessions` | `experiments/m4/m4-runner.mjs:200` 默认 `M4_OUT=/tmp/m4-new.jsonl`，`appendFileSync` 跨轮累积 |
| 轨迹 | `dsh --profile headless --patch presets/minimal-plus-next/trajectory.patch.yml` | 同上，无覆盖 → 真实 `~/.dsh/sessions` | `trajectory-driver.mjs:99` 仅在 `TRAJECTORY_OUT` 存在时写文件，否则只打印 |

既有隔离范式（票 11/12 探针、票 02 seeded 探针）：在 patch 层覆盖 `session-persistence-jsonl` 的 `root`，
用 `!!js process.env.<VAR> ?? '<默认>'` 兜底，调用方显式 export。本方案沿用该范式。

## 拟改动（4 个文件，全部 dev 侧）

1. `experiments/m4/m4.patch.yml` —— 新增一节，头注释补 env 说明：

   ```yaml
   - id: session-persistence-jsonl
     config:
       root: !!js process.env.M4_SESSION_ROOT ?? '/tmp/dsh-probe/m4-sessions'
   ```

2. `presets/minimal-plus-next/trajectory.patch.yml` —— 同款：

   ```yaml
   - id: session-persistence-jsonl
     config:
       root: !!js process.env.TRAJECTORY_SESSION_ROOT ?? '/tmp/dsh-probe/trajectory-sessions'
   ```

3. `experiments/m4/m4-runner.mjs` —— 默认报告落仓库归档（`M4_OUT` 仍可覆盖）：
   默认 `${repoRoot}/experiments/regression-gate/results-m4-<YYYY-MM-DD>.jsonl`；
   仓库根用 `import.meta.url` 上溯两级锚定（P0 去硬编码同款），写前 `mkdirSync(dirname, { recursive: true })`。

4. `presets/minimal-plus-next/trajectory-driver.mjs` —— 同款：
   默认 `${repoRoot}/experiments/regression-gate/results-trajectory-<YYYY-MM-DD>.json`（`TRAJECTORY_OUT` 仍可覆盖）。

命名与 Q7 的闸门报告 `experiments/regression-gate/results-<date>.json`（票 03 负责）以中缀区分，不冲突。
`experiments/regression-gate/` 目录由本票首次写入时创建（Q18 已列入资产落点）。

## 明确不改（范围纪律）

- `presets/minimal-plus/**`（stable）：D3「stable 侧任何文件不修改」，含 stable 的 trajectory patch/driver。
  代价：stable 轨迹探针仍会写真实会话目录；要跑它只能调用时手工覆盖 session root 或整包隔离 DSH_HOME，
  属 D3 的既知边界，写进记录即可。
- `settings.path` 与整包 `DSH_HOME` 隔离：Q2 的闸门级隔离由票 03 实现，本票不抢该面。
- `storage-json.root`（`~/.dsh/storages`，即 projection cache 泄漏面）：票 11/12 实测仍写真实目录，
  `evidence/01-portable-paths.md` 已记为隔离面问题。**本方案默认不覆盖**；
  若要一并堵住，追加一节 `- id: storage-json config.root: !!js ...`（+1 文件、多一层副作用：
  探针内其它 storage 域也会改写向临时目录），需你点名。
- 两条报告同一天重跑：M4 为 append（保留两轮）、trajectory 为覆盖（保留末次），保持既有语义，不加去重逻辑。

## 验证（票面第 3 条）

1. 前置计数：`~/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--` 条目 221、探针前缀 0（今日清理后基线）。
2. 零额度前置：`dsh --profile headless --patch <patch> --dump-config`，核对解析出的
   `session-persistence-jsonl.root` 指向隔离目录（防「改了没生效」）。
3. 跑 M4：`M4_GROUPS=E M4_RUNS=1 dsh --profile headless --patch experiments/m4/m4.patch.yml`
4. 跑轨迹：`TRAJECTORY_TASK="列出当前目录" dsh --profile headless --patch presets/minimal-plus-next/trajectory.patch.yml`
5. 断言并记账：
   - 真实会话目录仍 221、探针前缀仍 0；
   - `/tmp/dsh-probe/m4-sessions`、`/tmp/dsh-probe/trajectory-sessions` 出现对应会话（证明写进隔离根）；
   - `experiments/regression-gate/` 出现两份带日期报告。
6. 证据落 `evidence/05-isolation-record.md`，与票面三条逐条勾对。

## 额度与风险

- 第 3、4 步各需 **1 次真实模型调用**（M4 路由可用 `M4_MODEL=provider/model` 指定；轨迹用默认路由）。
  额度不可用时退化为第 2 步的配置证据，并明确标注「未实测重跑」，票面第 3 条不勾。
- 隔离根默认落 `/tmp/dsh-probe/*`，随轮次累积（但不再是用户目录）；若要零累积，可加
  `mktemp -d` + 退出清理的 wrapper 脚本——默认不做（最小改动），需你点名。
- 报告默认路径假设 runner 从**仓库副本**加载（现有调用方式即如此）；若从部署位副本加载，
  `../../` 会指到部署目录，届时用 env 覆盖即可（注释里写明）。
