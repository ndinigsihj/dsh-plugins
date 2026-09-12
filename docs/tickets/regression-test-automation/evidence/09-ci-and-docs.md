# 09 — CI 接线与文档验证记录

- 执行时间：2026-09-12（本地）
- 授权：用户「继续票据 09」；施工图 `docs/regression-test-automation-plan.md` §5.3、§6-1、§7 P3 + 决策 Q17（托管 runner、零密钥）、Q16（缺席记账）、D3（stable 边界）、D8（T4b 不接 release）。
- 未 commit、未 push（真实 CI 绿灯需 push 授权后补）；stable 侧 `presets/minimal-plus/**` 未动。

## 一、改动清单（3 改 1 增 1 补注，全 dev 侧）

| 文件 | 改动 |
| --- | --- |
| `.github/workflows/regression-gate.yml` | **新增**（75 行）：托管 `macos-latest`、零密钥；`npm ci` → 按 `gates/manifest.json` 安装 `@deepseek-ai/dsh@0.1.5-rc.1` → `scripts/link-global-dsh.sh` → `--tier 0,1,2 --skip-deployment-check`；报告上传 artifact；触发 `push(main)` + `pull_request` + `workflow_dispatch`，`paths` 全部指向现存目录；`permissions: contents: read` |
| `.github/workflows/custom-bash-win-smoke.yml` | 触发路径 `presets/liangshen-bash/**`（目录已不存在 → 永不触发）→ `presets/minimal-plus-next/**`；契约测试命令同步改指 next；job env `CUSTOM_BASH_PRESET_ROOT=presets/minimal-plus-next` |
| `scripts/custom-bash-win-smoke.mjs` | preset 路径参数化：`CUSTOM_BASH_PRESET_ROOT`（绝对路径或相对仓库根，空值视为未设）→ `pathToFileURL` 动态 import；默认 dev 侧 `presets/minimal-plus-next`；模块缺失时明确报错 exit 2；模块解析先于平台判定（非 win32 可验证路径可用） |
| `README.md` | 新增「Regression gate（回归闸门）」：入口与分层表（T0/T1/T2/T3/T4b）、两种豁免语义、报告位置、stable 侧不在闸门内及其手验要求、PTY 冒烟独立按需入口、**仓库绿灯 ≠ 部署位生效**与交付前同步序列、CI 口径 |
| `scripts/regression-gate.sh` | 帮助头补 2 行注释：仓库绿灯 ≠ 部署位生效、交付前显式 `sync-agent-presets.sh`、闸门不自动同步部署位 |

Windows smoke 的两个 preset 副本现状（已核对）：`presets/minimal-plus/custom-bash.mjs` 与
`presets/minimal-plus-next/custom-bash.mjs` **逐字相同**（`diff` 为空），两份 `.test.mjs` 只差注释里的运行路径；
按 D3 不改 stable 副本，工作流只跑 dev 侧。

## 二、CI 口径（票面第 1–3 条）

- **Q17 托管 runner、零密钥**：`runs-on: macos-latest`；工作流内无 `secrets.*` 引用（校验脚本按源码 grep 断言）；
  宿主是公共 registry 包，`npm ci` 与 `npm install -g` 均不需要 token。
- **宿主钉版**：版本号从 `gates/manifest.json` 读（不写死在工作流里），与 T1 的宿主钉版断言同源。
- **跑哪几层**：`--tier 0,1,2`。T0 的 `npm test` 已含进程内 app 层 T4a（`lib/app.test.ts`）；T3 真实模型层与
  T4b PTY 冒烟不进 CI（前者要真凭据/额度，后者要真 PTY，均为按需入口）。
- **Q16 缺席记账**：CI 固定传 `--skip-deployment-check`，它只豁免「部署位不存在」（`absent`）这一种状态；
  一旦 runner 上部署位存在但陈旧，闸门仍会判红（不会被该开关掩盖）。
- **触发面**：`push`（main）/ `pull_request` / `workflow_dispatch`；`paths` 覆盖 T0/T1/T2 的全部输入
  （`lib/**`、`plugins/**`、`presets/minimal-plus-next/**`、`gates/**`、`experiments/fixtures/**`、
  `experiments/session-preview-seeded/**`、三个脚本、`package.json`/`package-lock.json`/`tsconfig.json`、工作流自身）。

## 三、本地校验（票面第 5 条；真实 CI 绿灯待 push）

### 1. 工作流 YAML 语法 + 触发路径解析

GitHub 自己的触发器解析器本地不可用，故做近似校验：PyYAML 解析 → 取 `on.<event>.paths` → 逐条对真实树
检查（`dir/**` 看目录、含通配看通配前目录、精确路径看文件）→ `runs-on` 必须是托管 label → 源码无
`secrets.*` 与绝对本地路径。

结果：**PASS**，两个工作流共 30 条路径全部 `ok`（`push` 13 + `pull_request` 13 + win-smoke 4）。
证据：`experiments/regression-gate/evidence/09-workflow-validation.txt`。

### 2. Windows smoke 脚本参数化

本机是 darwin，无法跑真实 Windows 分支；脚本把「按参数解析 preset 模块」放在平台判定之前，因此可用退出码区分：

| 场景 | 结果 |
| --- | --- |
| 默认（未设 env）→ `presets/minimal-plus-next` | 模块解析成功 → `only runs on win32`（exit 2，符合预期） |
| `CUSTOM_BASH_PRESET_ROOT=$PWD/presets/minimal-plus-next`（绝对路径） | 同上 |
| `CUSTOM_BASH_PRESET_ROOT=presets/does-not-exist` | `no custom-bash.mjs under …`（明确报错，exit 2） |

`node --check scripts/custom-bash-win-smoke.mjs` 通过。真实 Windows 冒烟（Git Bash 实跑）仍需 CI Windows runner。

### 3. 模拟 CI 全跑（无部署位）

用空的临时 `HOME` 模拟托管 runner（`homedir()` 下没有 `~/.dsh/.agent-presets/…`）：

```bash
FAKE_HOME="$(mktemp -d)"
HOME="$FAKE_HOME" bash scripts/regression-gate.sh --tier 0,1,2 \
  --skip-deployment-check --json experiments/regression-gate/evidence/09-ci-sim-absent.json
```

结果：**exit 0，58 passed / 0 failed / 0 skipped**（PRE/T0/T1/T2 全 pass）；报告内

```json
"deployment": { "status": "absent", ... },
"exemptions": [ { "layer": "deployment-sha", "reason": "absent",
                  "detail": "agent.cordis.yml:absent, preset.yml:absent, … custom-bash.mjs:absent" } ]
```

且 stdout 打印了 `!!! EXEMPTIONS APPLIED (report stays green but this run is NOT a full verification)`——
即「缺席」是显式记账、不是静默绿灯。T0 的 `npm.test` 为 144/144（13 个测试文件，含 T4a）。
证据：`09-ci-sim-absent.json` + `09-ci-sim-absent.stdout.txt`。

顺带验证 CI 的安装步骤可用：在临时目录按仓库 `package.json`+`package-lock.json` 跑 `npm ci`（隔离 cache）
**exit 0**，8 个依赖齐全（`@earendil-works/pi-tui`、`commander`、`zod`、`typescript`、`@types/node` 等）。

### 4. 零密钥/公共 registry 前提核查

```bash
npm view @deepseek-ai/dsh@0.1.5-rc.1 version dist.tarball dist.integrity   # 隔离 cache，匿名
```

返回 `version = '0.1.5-rc.1'`、`dist.tarball = https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.1.5-rc.1.tgz`
（integrity `sha512-rmNmzQCg3oIc1z8xH7izRSOuy1TNzq+/NILyfM+7e8DKOyV+yBtg47WEsqR2SiIe1ATec3L/rUa1YhIcfQ2XEg==`）。
印证计划 §8 的前提；干净 runner 上能否起 headless 组合仍属真实 CI 的验收事实。

## 四、边界与未完成项

- **真实 CI 绿灯未取得**：需 push 授权（本票按约束不自动 push）。push 后需确认 `regression-gate` 与
  `custom-bash-win-smoke` 两个工作流实际触发且绿。
- **Windows runner 的真实冒烟未跑**：本机非 win32；若 GitHub Windows runner 无 Git Bash，脚本第 1 条会红
  （环境问题而非代码问题），届时按 Q17 的退路（self-hosted / ubuntu）评估。
- **未做常驻断言**：触发路径存在性目前是一次性校验。若要防止再次出现「触发路径指向已删除目录」这类
  静默失效，可另开票据把它做成 T0 断言（用 PyYAML 之外的解析路径）；本票未引入新依赖，故未做。
- **豁免语义依赖调用方**：workflow 固定传 `--skip-deployment-check`；若将来有人在 CI 改传
  `--allow-stale-deployment`，陈旧部署位会被静默豁免——README 已写明两者语义边界。
