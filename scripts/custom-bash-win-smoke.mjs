/**
 * custom-bash 真实 Windows 冒烟（文档 §2.5 / 验收 #9）。
 *
 * 只能在 win32 上跑：
 *  1. resolveWindowsBash 至少命中一个 Git Bash 候选（且非 WSL launcher）；
 *     用 `bash -c echo` 实跑一次，验证输出；
 *  2. 所有候选解析成 WSL launcher 时全部拒绝 → throw；
 *  3. 缺 bash 时 apply 跳过注册 + warn（fail-open）。
 *
 * preset 路径参数化（票据 09；计划 §6-1）：测试对象默认是 dev 侧
 * `presets/minimal-plus`，可用 `CUSTOM_BASH_PRESET_ROOT` 覆盖
 * （绝对路径，或相对仓库根），CI 用同名 env 传入。
 *
 * 运行：node scripts/custom-bash-win-smoke.mjs
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const presetRoot = process.env.CUSTOM_BASH_PRESET_ROOT || join("presets", "minimal-plus");
const presetDir = isAbsolute(presetRoot) ? presetRoot : join(REPO_ROOT, presetRoot);
const customBashPath = join(presetDir, "custom-bash.mjs");
if (!existsSync(customBashPath)) {
  console.error(`custom-bash-win-smoke: no custom-bash.mjs under ${presetDir} (set CUSTOM_BASH_PRESET_ROOT)`);
  process.exit(2);
}
// 先按参数解析模块再判平台：非 win32 上也能验证 preset 路径可用（否则报 win32-only）。
const { apply, isWindowsSubsystemLauncher, resolveWindowsBash } = await import(pathToFileURL(customBashPath).href);

if (process.platform !== "win32") {
  console.error("custom-bash-win-smoke: only runs on win32");
  process.exit(2);
}

console.log(`custom-bash-win-smoke: preset=${presetDir}`);

/** 用真实文件系统 + `where` 解析可执行文件（模拟 harness 的 subprocess.resolveExecutable）。 */
const realResolver = {
  async resolveExecutable(candidate) {
    if (typeof candidate !== "string" || candidate.length === 0) throw new Error(`invalid candidate: ${candidate}`);
    if (candidate.includes("\\") || candidate.includes("/")) {
      if (existsSync(candidate)) return candidate;
      throw new Error(`not found: ${candidate}`);
    }
    const where = spawnSync("where", [candidate], { encoding: "utf8" });
    if (where.status !== 0) throw new Error(`not found on PATH: ${candidate}`);
    const first = where.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
    if (first === undefined) throw new Error(`not found on PATH: ${candidate}`);
    return first;
  },
};

// 1. 真实解析 + 执行
const bashPath = await resolveWindowsBash(realResolver, {}, process.env);
if (isWindowsSubsystemLauncher(bashPath)) {
  throw new Error(`resolved to WSL launcher: ${bashPath}`);
}
const echo = spawnSync(bashPath, ["-c", "echo smoke-ok"], { encoding: "utf8" });
if (echo.status !== 0) {
  throw new Error(`bash -c echo failed (${echo.status}): ${echo.stderr}`);
}
if (!echo.stdout.includes("smoke-ok")) {
  throw new Error(`bash -c echo output missing marker: ${JSON.stringify(echo.stdout)}`);
}
console.log(`OK real bash: ${bashPath}; echo executed`);

// 2. WSL launcher 恒拒绝
const wslOnly = {
  async resolveExecutable() {
    return "C:\\Windows\\System32\\bash.exe";
  },
};
let wslRejected = false;
try {
  await resolveWindowsBash(wslOnly, {}, { ProgramFiles: "C:\\Program Files" });
} catch (error) {
  wslRejected = /WSL launcher|Git Bash executable unavailable/.test(String(error));
  if (!wslRejected) throw new Error(`unexpected WSL rejection error: ${error}`);
}
if (!wslRejected) {
  throw new Error("WSL-only candidates were not rejected");
}
console.log("OK WSL launcher rejected");

// 3. 缺 bash → apply 跳过注册 + warn（fail-open）
const registered = [];
const warnings = [];
const stubCtx = {
  subprocess: {
    async resolveExecutable() {
      throw new Error("no bash anywhere");
    },
  },
  tools: {
    register(definition) {
      registered.push(definition);
      return () => {};
    },
  },
  logger: {
    warn(message) {
      warnings.push(message);
    },
  },
};
await apply(stubCtx, {});
if (registered.length !== 0) {
  throw new Error(`expected no tool registration, got ${registered.length}`);
}
if (warnings.length === 0 || !/custom-bash:/.test(warnings[0])) {
  throw new Error(`expected skip-registration warn, got ${JSON.stringify(warnings)}`);
}
console.log("OK missing bash skips registration with warn");

console.log("custom-bash Windows smoke PASS");
