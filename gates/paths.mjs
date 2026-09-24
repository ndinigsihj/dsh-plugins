/**
 * 闸门路径常量（票据 01 拆模块）。
 *
 * 全部从本模块位置推导，任意 checkout 可用；`REPO_ROOT` 不带尾斜杠，
 * 以便报告与证据里的 `file.slice(REPO_ROOT.length + 1)` 得到仓库相对路径。
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根（`gates/` 的上一级），不带尾斜杠。 */
export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/u, "");

/** 自研 preset 名（闸门各层共同口径）。 */
export const PRESET = "minimal-plus";

/** 零 LLM 组合层叠加的闸门补丁（`gate` 模式的组合来源）。 */
export const GATE_PATCH = join(REPO_ROOT, "gates", "composition", "gate.patch.yml");

/** preset 启动冒烟入口（R1/R2 catalog 断言）。 */
export const SMOKE_BOOT = join(REPO_ROOT, "presets", PRESET, "smoke-boot.mjs");

/** 缺 bootstrap 工具时的降级路径冒烟。 */
export const DEGRADE_SMOKE = join(REPO_ROOT, "scripts", "degrade-smoke.sh");

/** seeded 预览探针（仓库 fixture + 临时 store）。 */
export const SEEDED_RUN = join(REPO_ROOT, "experiments", "session-preview-seeded", "run.sh");

/** T2 假模型 runner（逐场景进程内 driver）。 */
export const STUB_RUN = join(REPO_ROOT, "gates", "stub", "run.mjs");

/** T2 场景目录（按文件名排序枚举）。 */
export const STUB_SCENARIOS_DIR = join(REPO_ROOT, "gates", "stub", "scenarios");

/** 闸门 bash 入口（「不自动同步部署位」断言的扫描面之一）。 */
export const GATE_SCRIPT = join(REPO_ROOT, "scripts", "regression-gate.sh");
