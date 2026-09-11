# 01 — 路径可移植性与宿主依赖解析（证据）

日期：2026-09-11。基点 HEAD `de251d5`（文档提交后）。工作区改动：17 文件（16 个目标文件 + README 示例 2 行），
新增 `scripts/host-runtime.mjs`。stable 侧零改动。

## 1. 迁移机制（三选一，按文件性质）

| 机制 | 适用 | 实现 |
| --- | --- | --- |
| 裸包名导入 | 宿主侧包（`@deepseek-ai/*`） | 仓库 `node_modules/@deepseek-ai` 由 `scripts/link-global-dsh.sh` 指向全局宿主依赖树；实测这些包的 `exports` 只暴露入口与 `./src/*`，**深路径导入会被 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝**，裸包名可用 |
| 模块自身位置推导 | 仓库内资产（preset 根、driver 模块、读取器模块） | `new URL(..., import.meta.url)` / `fileURLToPath` |
| 补丁相对 / 环境变量优先 | `.patch.yml` 的 `insert.name` 与 `config` 值 | `./x.mjs`（加载器锚定补丁文件所在目录）；`!!js process.env.X ?? '<默认>'` |

宿主安装锚点（`loadProfile`/`boot` 的 installAnchor）由新增的 `scripts/host-runtime.mjs` 推导：
先 `require.resolve('@deepseek-ai/dsh/package.json')`（宿主被提升到顶层时命中），否则从
`dsh-app-boot` 位置逐级向上找 name 为 `@deepseek-ai/dsh` 的 package.json。

## 2. 每个文件的改动

| 文件 | 原状 | 现写法 |
| --- | --- | --- |
| `presets/minimal-plus-next/test-helpers.mjs` | `DEP = ".../node_modules/@deepseek-ai"` + 4 处模板拼接 | 4 个裸包名 import |
| `presets/minimal-plus-next/phase-swap-bash.test.mjs` | 同上（`DEP/CORDIS/SCOPE` + 2 处拼接 + 注释） | 5 个裸包名 import；注释改述依赖链接 |
| `presets/minimal-plus-next/smoke-boot.mjs` | app-boot 深路径；`INSTALL_ANCHOR`、`SMOKE_DRIVER`、`PRESET_ROOT` 三处绝对路径 | 裸包名 app-boot；`ROOT` 由 `import.meta.url` 推（`../..`）；锚点走 `installAnchor()`；driver 与 preset 根由 `import.meta.url` 推（`PRESET_ROOT` 仍可被 `SMOKE_PRESET_ROOT` 覆盖） |
| `presets/minimal-plus-next/smoke-driver.mjs` | 2 处深路径 | 2 个裸包名 |
| `presets/minimal-plus-next/trajectory-driver.mjs` | 3 处深路径 | 3 个裸包名 |
| `presets/minimal-plus-next/trajectory.patch.yml` | `roots[].path` 与 `insert.name` 写死仓库路径 | `!!js process.env.TRAJECTORY_PRESET_ROOT ?? 'presets'`；`name: ./trajectory-driver.mjs` |
| `experiments/m4/m4-runner.mjs` | 3 处深路径；任务模板写死工作目录 | 3 个裸包名；任务模板改用 `process.cwd()`（与 `agents.create` 的 `meta.cwd` 同源） |
| `experiments/m4/m4.patch.yml` | `insert.name` 写死 | `./m4-runner.mjs` |
| `experiments/model-hot-switch-live-spike.mjs` | 3 处深路径 + app-boot 深路径 + `INSTALL_ANCHOR` | 4 个裸包名 + `installAnchor()` |
| `experiments/session-preview-seeded/probe.mjs` | `READER_MODULE` 写死 `lib/session-preview-log.ts` | `fileURLToPath(new URL("../../lib/session-preview-log.ts", import.meta.url))` |
| `experiments/session-preview-seeded/probe.patch.yml` | `insert.name` 写死 | `./probe.mjs` |
| `experiments/subagent-model-selection/probe.mjs` | 3 处深路径 | 3 个裸包名 |
| `experiments/subagent-model-selection/probe.patch.yml` | `insert.name` 写死 | `./probe.mjs` |
| `experiments/subagent-model-selection/route-probe.mjs` | 3 处深路径 | 3 个裸包名 |
| `experiments/subagent-model-selection/route-probe.patch.yml` | `insert.name` 写死 | `./route-probe.mjs` |
| `plugins/rewind-dsh.ts` | 挂载注释里两个仓库绝对路径 | `<repo>` / `<stable-checkout>` 占位写法 |
| `README.md` | profile 示例两行绝对路径 | `<repo>` 占位写法（示例本就要替换） |

**未改动（有意）**：`scripts/release.sh`（3 处：稳定 worktree 与 stable 运行时的部署默认值，非测试面）；
`experiments/m4/results-*.jsonl` 与 `docs/tickets/**/evidence/*.json`（历史记录内容）；
`lib/index.ts:998` 的 `/^(\/Users\/[^/]+|\/home\/[^/]+)/`（识别 `~/` 的正则，非本机路径）。

## 3. 验收实跑

### 3.1 本机（原 checkout）

```
$ npx tsc --noEmit                      →  exit 0
$ npm test                              →  tests 97 / pass 97 / fail 0
$ node presets/minimal-plus-next/smoke-boot.mjs
  ROUND1 catalog: {"tools":["bash","str_replace_editor"],"bashParams":["command"],...}
  ROUND2 catalog: {...29 工具...,"bashParams":[...,"sandbox_permissions","justification"],...}
  ROUND2 pre-step sources: ["agent-instructions","skill-catalog","instruction-hint"]
  exit 0
```
（唯一警告为 session projection cache 写真实 `~/.dsh/storages` 的 EPERM，属既有沙箱限制，归票据 03 的隔离面。）

### 3.2 另一个路径的副本（本票核心验收）

副本 `/tmp/dsh-portcheck`（工作树 `tar` 复制，**不含任何环境变量覆盖**）：

```
$ npx tsc --noEmit              →  exit 0
$ npm test                      →  tests 97 / pass 97 / fail 0
$ node presets/minimal-plus-next/smoke-boot.mjs  →  与 3.1 逐字相同的 R1/R2 目录，exit 0
```

补丁相对锚定（`./probe.mjs`）在副本上解析到副本自身：

```
$ cd /tmp/dsh-portcheck && DSH_HOME=/tmp/dsh-portcheck-home \
    dsh --profile headless --patch experiments/session-preview-seeded/probe.patch.yml --dump-config
- id: session-preview-seeded-probe
  name: >-
    file:///private/tmp/dsh-portcheck/experiments/session-preview-seeded/probe.mjs
```

`!!js` 配置插值（进程内 boot，读 `agentPresets.roots`）：

```
默认                              → ["…/dsh-agent-presets/presets/","presets","/Users/vito/.dsh/.agent-presets"]
TRAJECTORY_PRESET_ROOT=/tmp/override-presets
                                  → ["…/dsh-agent-presets/presets/","/tmp/override-presets","/Users/vito/.dsh/.agent-presets"]
```

相对根确实参与发现（同一副本内 `agentPresets.list()`）：

```
FOUND=["standard","ptc","minimal","cordis","minimal-plus","minimal-plus-next"]
```

### 3.3 残留绝对路径扫描

```
$ grep -rn "/Users/" --include="*.mjs" --include="*.ts" --include="*.yml" --include="*.sh" --include="*.json" . \
    | grep -v node_modules | grep -v '^./presets/minimal-plus/' | grep -v '^./experiments/m4/results-' | grep -v '^./.dsh/'
```
剩余命中仅三类，均为预期：`docs/tickets/**/evidence/*.json`（历史记录）、`scripts/release.sh`（部署默认值）、
`lib/index.ts:998`（`~/` 识别正则）。目标 16 文件已零残留。

## 4. 结论与留待后续

- 本票验收成立：任意 checkout（配合既有的 `scripts/link-global-dsh.sh`）可跑单测与零 LLM 冒烟，无需改脚本或设环境变量。
- 新增 `scripts/host-runtime.mjs` 为超出计划字面的一处小扩展（计划只写「`import.meta.url` + `DSH_HOST_DEPS_DIR`」）：
  两处需要宿主安装锚点，且票据 03（闸门）与票据 10（PTY 依赖推导）将复用同一推导，故抽为单一来源。
- 真实模型类探针（m4 / subagent / route）本票只做静态与零 LLM 验证；其端到端可用性由后续票据的实跑承接。
