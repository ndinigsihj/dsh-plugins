# 01 — 路径可移植性与宿主依赖解析

**What to build:** 让仓库里所有开发侧脚本与补丁不再依赖本机绝对路径，从而在任意 checkout（换目录、开 worktree、CI 检出）上都能跑。做法是把 16 个文件里的 38 处硬编码仓库路径改为「由模块自身位置推导」或「由补丁文件位置相对解析」或「环境变量优先 + 内置默认兜底」；宿主侧的包改为按裸包名导入（实测其 `exports` 映射只暴露入口与 `./src/*`，深路径导入被拒绝）。发行脚本里指向稳定运行时的那两处属部署配置，不在本票范围内。

**Blocked by:** None — can start immediately.

**Status:** done — 2026-09-11

**Evidence:** `evidence/01-portable-paths.md`

- [x] 仓库内资产路径（preset 根、driver 模块、探针模块、报告输出）一律由模块自身位置推导，不再写死本机路径 — preset 根与 driver/reader 模块改 `import.meta.url` 推导；报告输出本就用 env 或 /tmp（证据 §2）
- [x] 补丁覆盖层里的插入项改用相对补丁文件的写法；配置值改用「环境变量优先 + 内置默认兜底」表达式 — 5 个 `insert.name` 改 `./x.mjs`；`trajectory.patch.yml` 的 preset 根改 `!!js process.env.TRAJECTORY_PRESET_ROOT ?? 'presets'`（证据 §3.2）
- [x] 宿主侧包改用裸包名导入；不在依赖声明里的传递依赖（PTY、终端模拟器）按宿主安装锚点推导并给出清晰报错，不硬编码解释器路径 — 17 处深路径改裸包名；新增 `scripts/host-runtime.mjs` 推导 installAnchor 并给出报错文案（PTY 侧留给票据 10）
- [x] 开发侧全量 grep 无残留本机绝对路径（发行脚本默认值与历史结果文件除外，后者属记录内容） — 目标 16 文件零残留，仅剩 release.sh / 历史 evidence / `~/` 识别正则（证据 §3.3）
- [x] 在**另一个路径的 checkout 副本**上、不设任何环境变量覆盖，零 LLM 冒烟与既有单测通过（这是本票的核心验收，本地绿不算数） — `/tmp/dsh-portcheck`：tsc 0 错、npm test 97/97、冒烟 R1/R2 与本地逐字一致（证据 §3.2）
- [x] 稳定侧文件名下的任何文件零改动（`git diff` 证明） — `git status --porcelain -- presets/minimal-plus/` 为空
- [x] 既有单测与类型检查仍全绿（97 用例 / 0 类型错误）

**范围外补充（已在证据 §4 记录）**：新增 `scripts/host-runtime.mjs`（宿主安装锚点单一来源，票据 03/10 复用）；
`README.md` 与 `plugins/rewind-dsh.ts` 的示例/注释路径改为占位写法。
