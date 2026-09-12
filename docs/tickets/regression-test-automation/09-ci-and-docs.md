# 09 — CI 接线与文档

**What to build:** 让闸门在合并前自动跑起来，并把用法与边界写进文档。CI 在托管 macOS runner 上运行静态层、零 LLM 组合层、假模型行为层与进程内 app 层，零密钥（宿主从公共 registry 安装）；部署位检查在 CI 上按「缺席」形式显式记账而非豁免掩盖。同时修正已经失效的 Windows smoke 触发路径（其指向的 preset 目录已不存在，导致该工作流永不触发），并把脚本内的 preset 路径参数化。README 写明闸门用法、分层含义、两种豁免的语义，以及稳定侧不在闸门内、改稳定侧文件须在其运行时手验。

**Blocked by:** 03 — 回归闸门脚本；06 — 假模型行为层骨架 + 首条回归红绿；08 — 进程内 app 层

**Status:** done — 2026-09-12（本地校验全过 + 真实 CI 绿灯：commit `74adf0f` push 后 `regression-gate` 与 `custom-bash-win-smoke` 两个工作流均在托管 runner 上 `success`，Windows runner 的真实 Git Bash 冒烟一并通过。证据见 `evidence/09-ci-and-docs.md`）

**施工图:** `docs/regression-test-automation-plan.md` §5.3、§6-1、§7；用户决策 Q17（托管 runner、零密钥）、Q16（缺席记账）。

- [x] 新增 CI 工作流：托管 macOS runner、零密钥，安装清单记录的宿主版本后跑静态层 + 零 LLM 组合层 + 假模型层 + 进程内 app 层（`.github/workflows/regression-gate.yml`：`macos-latest`、无 `secrets.*`、`npm ci` → 按 `gates/manifest.json` 装宿主 → `link-global-dsh.sh` → `--tier 0,1,2`；T4a 随 `npm test`）
- [x] CI 中部署位检查按「缺席」显式记账（报告中出现对应豁免条目），不以陈旧豁免掩盖（空 HOME 模拟实测：`deployment.status=absent`、`exemptions=[{layer:"deployment-sha",reason:"absent"}]`、stdout 打印豁免警告）
- [x] 工作流在目标文件变更时可触发（触发路径指向仍然存在的目录）（30 条 `on.*.paths` 全部对真实树校验通过：`push(main)`/`pull_request`/`workflow_dispatch`）
- [x] 失效的 Windows smoke 触发路径修正为现有目录，且脚本内 preset 路径参数化（触发与契约测试改指 `presets/minimal-plus-next/**`；`CUSTOM_BASH_PRESET_ROOT` 参数化 + 动态 import；默认/绝对路径/缺失预设三场景实测）
- [x] 本地校验工作流文件语法与触发器解析通过（真实 CI 绿灯需 push 授权后补，本票不自动 push）（PyYAML 语法解析 + 触发路径存在性 + hosted label + 零密钥扫描：`workflow validation: PASS`，证据 `evidence/09-workflow-validation.txt`；push 后 GitHub Actions 实测 `regression-gate`/`custom-bash-win-smoke` 均 success）
- [x] README 写明：闸门入口与分层、两种豁免语义、报告位置、稳定侧不在闸门内及其手验要求、PTY 冒烟为独立按需入口（新增「Regression gate（回归闸门）」整节）
- [x] 文档写明「仓库绿灯 ≠ 部署位生效」，交付前必须显式同步部署位（README 该节 + `scripts/regression-gate.sh --help` 头注释；交付前序列：显式 `sync-agent-presets.sh` → `--tier 0,1,2 --composition real` → T3 按需 → 人工签收）
