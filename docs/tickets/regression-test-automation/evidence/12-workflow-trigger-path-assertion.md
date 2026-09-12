# 票据 12 证据 — 工作流触发路径的常驻断言

- 执行时间：2026-09-12（本地；网关报告时间戳 06:25:55Z / 06:26:08Z）
- 授权：用户「继续票据 12」；施工图 `docs/regression-test-automation-plan.md` §6-1、§5.4（T0 断言面）+ 票据 09 证据 §五「未做常驻断言」的转交。
- 收口：实现改动提交 `d29e961` 并 push（`7a6decc..d29e961`，2026-09-12）；托管 `regression-gate` CI 绿灯见 §五。stable 侧 `presets/minimal-plus/**` 未触碰，工作流文件内容未改（负控后 sha 复原）。

## 一、改动清单（2 增 3 改，全 dev 侧）

| 文件 | 改动 |
| --- | --- |
| `gates/workflow-triggers.mjs` | **新增**（141 行）：扫描 `.github/workflows/*.{yml,yaml}`，逐事件校验 `paths` / `paths-ignore`；导出 `workflowFiles` / `workflowTriggers` / `patternTarget` / `triggerPathFindings` / `formatFinding` / `checkWorkflowTriggers` |
| `gates/workflow-triggers.test.mjs` | **新增**（169 行，10 用例）：解析形态、路径判定、解析失败、临时仓负控、真仓全绿 |
| `gates/dump-parse.mjs` | 唯一改动：`loadYaml()` 加 `export`，供新断言复用同一 js-yaml 入口（并在注释注明复用方） |
| `package.json` | `scripts.test` 增 `gates/workflow-triggers.test.mjs`（13 → 14 个测试文件） |
| `README.md` | T0 行补「工作流触发路径存在性断言」；CI 段补一段断言行为说明 |

原始产物（`experiments/regression-gate/evidence/`）：

| 文件 | 内容 |
| --- | --- |
| `12-assert-red.txt` / `12-assert-green.txt` | 直跑 `node --test gates/workflow-triggers.test.mjs` 的突变红 / 恢复绿输出 |
| `12-t0-red.json` / `12-t0-red.stdout.txt` | `--tier 0` 突变红：报告 + stdout（`FAIL npm.test — exit 1 tests=154 pass=153 fail=1`） |
| `12-t0-green.json` / `12-t0-green.stdout.txt` | `--tier 0` 恢复绿：报告 + stdout（`PASS npm.test — exit 0 tests=154 pass=154 fail=0`） |

## 二、断言设计

- **解析入口**：复用 `gates/dump-parse.mjs` 的 `loadYaml()`（`js-yaml` 4.3.2 从 app-boot 安装位置解析；app-boot 传递依赖，仓库依赖面不含它）。**未新增任何依赖**，`npm ci` 与 CI 零密钥前提不变（本票未改工作流）。
- **`on` 归一化**（`workflowTriggers`）：认字符串（`on: push`）、字符串数组（`on: [push, pull_request]`）、事件映射，以及 YAML 1.1 解析器会产生的布尔键（裸 `on:` → JS 键 `"true"`）；无 `on` / `on:` 为空 → 不产生事件。
- **校验规则**（`triggerPathFindings` + `patternTarget`）：
  - 含通配符（`*` `?` `[` `]`）的模式：断言「第一个通配段之前的 base 目录」存在**且是目录**（如 `presets/*/agent.mjs` → `presets`；`**/*.ts` → 仓库根，恒存在）；
  - 无通配符的精确路径：断言存在（如 `package.json`）；
  - 取反前缀 `!` 先剥离再校验（GitHub paths 过滤器支持取反）；
  - 没有 `paths` / `paths-ignore` 的事件直接跳过（`workflow_dispatch`、只有 `branches`/`tags` 的事件不误判）；
  - 红形态：YAML 解析失败、根不是映射、`paths` 非列表、模式不是字符串、空模式。
- **报红格式**（`formatFinding`）：`<工作流文件> [<事件>] <paths|paths-ignore> "<模式>": <原因>`——文件 + 事件 + 模式三者可定位。
- **有意不做**（票面范围外）：`branches` / `tags` 模式合法性、cron 表达式、权限与 job 依赖图校验、GitHub 实际触发模拟（本地无法验证）。

## 三、负控红绿（票面第 4 条）

突变：`.github/workflows/regression-gate.yml` 的 `push.paths` 中仅一处 `"gates/**"` → `"gates-renamed/**"`（不存在的目录）；其余内容不变。

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| 红（直跑断言） | `node --test gates/workflow-triggers.test.mjs` | exit 1；`not ok 10`，失败消息含 `.github/workflows/regression-gate.yml [push] paths "gates-renamed/**": base directory gates-renamed does not exist` |
| 红（T0 面） | `scripts/regression-gate.sh --tier 0 --json …/12-t0-red.json` | exit 1；T0 `FAIL npm.test — exit 1 tests=154 pass=153 fail=1`；summary `5 passed, 1 failed, 0 skipped` |
| 恢复 | 反向编辑后 `shasum -a 256 .github/workflows/regression-gate.yml` | `a7cca6c1c9139cea93ed7be48923c284dd2a8fbb8d46ffa26bb7e49ede6314f1`（与突变前一致） |
| 绿（直跑断言） | `node --test gates/workflow-triggers.test.mjs` | exit 0，10/10 |
| 绿（T0 面） | `scripts/regression-gate.sh --tier 0 --json …/12-t0-green.json` | exit 0；T0 全 pass；`npm.test exit 0 tests=154 pass=154 fail=0`；summary `6 passed, 0 failed, 0 skipped` |

T0 报告里失败项即 `tiers[].assertions` 的 `npm.test`（红报告原样落盘，未手工修饰）。

## 四、验收对照（票面 5 条）

1. **全部工作流可解析、逐条路径存在** — 真仓断言 0 findings，两个工作流（`regression-gate.yml`、`custom-bash-win-smoke.yml`）均在扫描面内；解析失败 / 非映射根 / `paths` 非列表有合成用例。
2. **GitHub 特有形态** — 布尔 `on` 键、字符串/数组 `on`、无 paths 事件、只有 `branches`/`branches-ignore` 的事件、`!` 取反均有用例覆盖。
3. **不新增依赖** — 复用既有 `loadYaml()` 入口；无 devDependency 变更，故无需在依赖面记录裁决；工作流与 CI 配置未动，零密钥前提不变。
4. **负控红绿** — §三，红时消息含「文件 + 事件 + 模式」，T0 面 exit 1；恢复后 exit 0。
5. **进 `npm test`（T0）+ README** — `npm test` 由 13 文件 144 用例变为 14 文件 154 用例（全绿）；README T0 行与 CI 段同步。

## 五、真实 CI（push 后，2026-09-12）

commit `d29e961` push（`7a6decc..d29e961`）后，`regression-gate` 工作流按 `paths`（`gates/**`、`package.json` 命中）自动触发并在托管 runner 上通过：

| 工作流 | runner | 结果 | run |
| --- | --- | --- | --- |
| `regression-gate` | `macos-latest` | completed / **success**（T0 含新断言 + T1 + T2，`--skip-deployment-check` 缺席记账；created 06:40:43Z → 观测 06:41:04Z in_progress → 06:42:31Z success） | [34678752540](https://github.com/ndinigsihj/dsh-plugins/actions/runs/34678752540) |

`custom-bash-win-smoke` 未触发：本次改动路径不在其触发面（`presets/minimal-plus-next/custom-bash.*` / `scripts/custom-bash-win-smoke.mjs` / 其自身工作流）；它最近一次运行（T09 收口 `74adf0f`，run 34677128292）保持 success。

## 六、边界与说明

- 断言只证明「可解析 + 路径存在」，不模拟 GitHub 实际触发判定（票面已声明）；`branches`/`tags`/cron/权限/依赖图不在范围内。
- 存在性按工作树当前状态（`statSync` 跟随 symlink）；测试期间并发删除目标目录属 TOCTOU，不在断言职责内。
- 本票未改 `gates/run.mjs`（T0 通过 `npm test` 自然收编新断言）、未改工作流内容、未改 T1/T2/T3 语义。
- 全部改动提交并 push（`d29e961`），托管 CI 绿灯（§五）；本票无未落盘改动。
