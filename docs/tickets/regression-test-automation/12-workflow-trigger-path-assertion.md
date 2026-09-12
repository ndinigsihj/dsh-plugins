# 12 — 工作流触发路径的常驻断言

**What to build:** 把「工作流触发路径必须指向仓库中仍然存在的路径」做成常驻断言，让「触发器指向已删除目录 → 工作流永不触发」这类静默失效在闸门里变红，而不是靠人工复查（09 修正的 `presets/liangshen-bash/**` 即是此案例）。断言在 T0 面内跑：解析仓库内全部工作流 YAML，逐个事件校验 `paths` / `paths-ignore` 的每条模式——目录 glob 断言其 base 目录存在，精确路径断言文件存在；红时报告给出「工作流文件 + 事件名 + 失效模式」。解析优先复用仓库或宿主依赖树里已有的 YAML 解析路径；若必须新增依赖，需在票内记录裁决理由，并验证 `npm ci` 与 CI 零密钥前提不受影响。只校验「可解析 + 路径存在」，不模拟 GitHub 实际触发（本地无法验证）。

**Blocked by:** 03 — 回归闸门脚本（09 已完成，工作流文件已就位）

**Status:** done — 2026-09-12（本地：新增断言 10/10、`npm test` 154/154、`--tier 0` 负控红→绿 exit 1→0；未提交，证据 `evidence/12-workflow-trigger-path-assertion.md`）

**施工图:** `docs/regression-test-automation-plan.md` §6-1、§5.4（T0 断言面）

- [x] 仓库内全部工作流 YAML 可解析，`on.<event>.paths` 与 `paths-ignore` 逐条断言在仓库中存在（目录 glob 的 base 必须存在）— `gates/workflow-triggers.mjs`；真仓 0 findings；YAML 解析失败 / 非映射根 / `paths` 非列表也有专门用例
- [x] 解析处理 GitHub 特有形态：裸 `on:` 键在 YAML 1.1 下会被解析成布尔键、事件没有 paths、只有 branches/tags 的事件不误判 — 字符串/数组/映射/布尔键 `on` 均归一到 `[{event, config}]`；`!` 取反前缀剥离
- [x] 不新增运行时依赖（优先复用既有解析路径）；若必须新增 devDependency，记录裁决理由并验证闸门仍零网络可跑、CI 零密钥前提不变 — 复用 `gates/dump-parse.mjs` 的 js-yaml 入口（`loadYaml` 改为导出），无新增依赖、未改工作流
- [x] 负控：把一条触发路径人为改成不存在的目录 → T0 变红且报告含「文件 + 事件 + 模式」；恢复后复绿 — `push.paths` 的 `gates/**` → `gates-renamed/**`：直跑断言 exit 1（消息含 `.github/workflows/regression-gate.yml [push] paths "gates-renamed/**"`），`--tier 0` 红；恢复 sha 后复绿
- [x] 断言进 `npm test`（T0 面）；README 的分层描述若涉及则同步更新 — `package.json` 测试文件 14 个；README T0 行 + CI 段补「触发路径常驻断言」

**范围外（本票不做）:** `branches` / `tags` 的模式合法性、cron 表达式、工作流权限与 job 依赖图校验——这些不是本次静默失效的成因。
