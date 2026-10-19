# 03–06 执行记录 — stable 通道迁 0.1.7-rc.1（2026-10-19）

## 03 宿主升级 + 镜像/farm

- 备份：`dsh-runtime/stable/node_modules` → `node_modules.pre-0.1.7-rc.1.bak`（289M，回滚即改名切回）；
  `package.json` / `package-lock.json` 各留 `.pre-0.1.7-rc.1.bak`。
- pin：`dependencies = {"@deepseek-ai/dsh": "0.1.7-rc.1"}`，删除 0.1.5 线的 5 条 `overrides`。
- `npm i`（`npm_config_cache=/tmp/dsh-recon-npm-cache`、fetch-timeout 30min、retries 5、maxsockets 4、
  `--prefer-offline`）**exit 0**；install-scripts 审批只涉及 `@google/genai`/`protobufjs`
  （与 TUI 无关），node-pty 的 `spawn-helper` 两架构均 `-rwxr-xr-x` ✔。
- 扁平镜像重放（`04-stable-flat-mirror.sh`）：**created=0 / top-level=277**（0.1.7 的本地安装布局本身扁平，
  不再需要补链接；脚本跳过的 7 条是 chokidar/readdirp/koffi 等非 `@deepseek-ai` 嵌套包）。
- farm 重链：**linked=234、removed=6**（`cordis-plugin-hmr` 更名、`dsh-agent-presets` 移除、
  `dsh-code-runtime`、`dsh-code-runtime-worker-thread`、`dsh-settings-file`、
  `dsh-workflow-worker-thread`）；`dangling=0`。
- 校验：`tui-stable --version` = **0.1.7-rc.1**；六处解析面（三棵 stable 树 / 旧载体 / farm / 启动器）
  全部指向 `dsh-runtime/stable` 且版本 0.1.7-rc.1。

## 04 header 补丁移植

- 目标文件：`dsh-runtime/stable/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js`（唯一副本）。
- 手法：以全局 v24 已打补丁文件为基准，**逐字取 3 处行**（insert 8 行 / headers 合并行 / `resolveSessionCwd` 行）
  拼接到 pristine 副本；原件留 `*.pre-header-patch.bak`。
- 结果：与全局补丁文件 **逐字节相同**；两处 sha256 = `bd66963d2b634437ae43a77cf3ebca92e3ec55091c54def1994e66f99c558838`
  （与 commandcode 文档记录的「应用后 sha256 bd66963d…」一致）；`node --check` 通过；标记 grep = 5；
  8/8 mock 用例（预演阶段同一份代码跑出）。
- 配置面：stable profile 迁移后不含任何静态 `x-session-id` / `x-project-slug` / `x-opencode-session`
  （动态补丁独家生成）；`tui-dev` 维持无静态 header。

## 05 `tui` profile 迁移

- 备份：`cordis.patch.yml.bak-20261019-193150`、`cordis.yml.bak-…`、`package.json.bak-…`（在 profile 目录内），
  外加 `settings.stable.yaml.bak-…`。
- 迁移内容：以 `tui-dev` 的行集为模板（0.1.7 已验证）→ 路径换回三棵 stable 树 →
  `agent-default-model` / `llm-pi-ai` 两段内容换成 `settings.stable.yaml` 同段；`settings` 覆盖行与
  `agent-presets` 旧行不再存在；`ui-onboarding` / `llm-deepseek: {}` / `agent-presets` 三个 settings 段
  在 0.1.7 组合里无对应条目，按宿主导入语义跳过（不落行）。
- 载体：`generated/minimal-plus-preset/` → `~/.dsh/profiles/tui/preset-bundles/minimal-plus-preset/`（10 文件）
  + `node_modules/@dsh-plugins/minimal-plus-preset` 链接；`package.json` bundles =
  `[@deepseek-ai/dsh-base, @dsh-plugins/minimal-plus-preset]`。
- `dsh-antigravity-auth` 裁决：**不带**（stable `settings.stable.yaml` 无 antigravity provider；
  带则 +4 loader ids）。
- 旧目录载体 `~/.dsh/.agent-presets/minimal-plus` **保留未动**（只作回滚资产，0.1.7 不再读取）。
- 校验：`tui-stable --dump-config` **exit 0**、756 行、stderr 0B、**108 ids / 0 duplicates**；
  `preset-minimal-plus` / `minimal-plus-agent-preset-registry` 在、`agent-presets` 不在。

## 06 验收

| 项 | 结果 |
| --- | --- |
| `tui-stable --version` | 0.1.7-rc.1 |
| 解析面矩阵（6 处） | 全部 0.1.7-rc.1、同一部署位置 |
| scope 顶层实体 / farm dangling | 277 / 0 |
| 补丁 sha256（runtime vs 全局） | 一致 `bd66963d…` |
| `tui-stable --dump-config` | exit 0；108 ids；duplicates 0 |
| stable 通道 PTY 冒烟（真 launcher + 真 profile + 部署位载体） | **3/3**（mount.no-error / boot.rendered / mount.preset-visible） |
| dev 组合 real 闸门 | **85 passed / 0 failed / 0 skipped**（host 0.1.7-rc.1） |

报告：`experiments/regression-gate/preset-mount-2026-10-19-stable-migration.json`、
`experiments/regression-gate/results-2026-10-19-stable-migration.json`。

**两次环境性红（已解释，非迁移缺陷）**：
① 首次冒烟 `posix_openpt failed: Operation not permitted`（沙箱不给 PTY）→ 提权后 3/3；
② 首次闸门 `isolation.real-home-untouched` 红（`sessions` 8211→8220）——同一窗口内
`~/data/dev/mumu` 的活会话在写 `~/.dsh/sessions/--Users-vito-data-dev-mumu--/`（30 分钟 130 个文件），
复跑即绿。

## 回滚

`mv ~/data/dev/dsh-runtime/stable/node_modules{,.pre-0.1.7-rc.1.bak}` 反向改名 + 还原
`~/.dsh/profiles/tui/{cordis.patch.yml,package.json}` 的 `.bak-20261019-193150` 副本即可回到 0.1.5 通道
（会话 V4 已由 0.1.7 写过，旧宿主读不了——既存边界）。
