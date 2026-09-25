#!/usr/bin/env node
/**
 * Preset 同步工具 —— 「生成 Profile 侧产物 + dry-run 核对」（票据 07；计划 §3.5、§7 第 11 步）。
 *
 * 旧行为（0.1.5 时代）：把 `presets/<id>/` 整目录复制到 `~/.dsh/.agent-presets/<id>/`。
 * C0 ④ 已核实 0.1.7 **不再读取该目录形态**，载体改为插件组合包里的声明行；本工具因此改成：
 *
 *   1. 用 `scripts/agent-preset-bundle.mjs` 从仓库真源生成自包含 bundle；
 *   2. dry-run（默认）：逐文件比对「新生成产物 ↔ 仓库生成产物 ↔ 目标位」，打印结果，
 *      **不写任何真实路径**；仓库产物漂移或目标位内容不符时退出码 1；
 *   3. `--write`：把产物写到目标位（部署写入，需显式开关与批准；票据 12 执行）。
 *
 * 两种目标位：
 *   - `--dest <dir>`（默认 `$DSH_HOME/agent-presets/<id>-preset`）：bundle staging，
 *     供 `dsh plugin --profile <name> add <dir>` 安装；
 *   - `--profile <name>`：真 profile 侧 —— bundle 落 `<profile>/preset-bundles/`、
 *     `node_modules` 链接、`dsh.profile.bundles` 选择（与闸门/smoke 同一接线）。
 *
 * 旧目录 `~/.dsh/.agent-presets/<id>/` 只做只读探测并提示退场，绝不删除（删除需用户确认）。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLE_OUT_DIR, BUNDLE_PACKAGE_NAME, BUNDLE_SOURCE_DIR, copyBundle, generatePresetBundle, sha256File, stagePresetBundle } from "./agent-preset-bundle.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HELP = [
  "Usage: node scripts/sync-agent-presets.mjs [--dry-run] [--write] [--preset <id>] [--source <dir>] [--dest <dir> | --profile <name>]",
  "",
  "  --dry-run   print the per-file plan and write nothing (default)",
  "  --write     materialize the generated bundle at the selected target (explicit deployment write)",
  "  --preset    preset id (default minimal-plus)",
  "  --source    preset source directory (default presets/<id>)",
  "  --dest      bundle staging directory (default $DSH_HOME/agent-presets/<id>-preset)",
  "  --profile   write into $DSH_HOME/profiles/<name> instead (bundle + node_modules link + bundles selection)",
].join("\n");

export function parseSyncArgs(argv, env = process.env) {
  const dshHome = env.DSH_HOME ?? join(env.HOME ?? REPO_ROOT, ".dsh");
  const options = { preset: "minimal-plus", write: false, source: undefined, dest: undefined, profile: undefined, dshHome };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") options.write = false;
    else if (token === "--write") options.write = true;
    else if (token === "--preset") options.preset = argv[++index];
    else if (token === "--source") options.source = argv[++index];
    else if (token === "--dest") options.dest = argv[++index];
    else if (token === "--profile") options.profile = argv[++index];
    else if (token === "-h" || token === "--help") options.help = true;
    else throw new Error(`sync-agent-presets: unknown argument ${token}`);
  }
  options.sourceDir = resolve(REPO_ROOT, options.source ?? (options.preset === "minimal-plus" ? BUNDLE_SOURCE_DIR : join("presets", options.preset)));
  options.repoArtifactDir = resolve(REPO_ROOT, options.preset === "minimal-plus" ? BUNDLE_OUT_DIR : join("generated", `${options.preset}-preset`));
  options.packageName = options.preset === "minimal-plus" ? BUNDLE_PACKAGE_NAME : `@dsh-plugins/${options.preset}-preset`;
  options.profileDir = options.profile === undefined ? undefined : join(dshHome, "profiles", options.profile);
  options.targetDir = options.profileDir === undefined
    ? resolve(options.dest ?? join(dshHome, "agent-presets", `${options.preset}-preset`))
    : join(options.profileDir, "preset-bundles", basename(options.packageName));
  options.legacyDir = join(dshHome, ".agent-presets", options.preset);
  // 产物里的真源标注用「相对路径」：换 checkout 后同一真源仍生成同一指纹。
  options.sourceLabel = relative(REPO_ROOT, options.sourceDir) || ".";
  return options;
}

/** 目录内相对文件名（只取普通文件；bundle 是扁平目录）。 */
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

/**
 * 逐文件比对三个面：fresh（新生成）/ repo（仓库产物）/ target（目标位，staging 或 profile 内 bundle）。
 * @returns `{files, repoOk, targetState}`；targetState ∈ absent | drift | match。
 */
export function planSync({ sourceDir, repoArtifactDir, targetDir, packageName, sourceLabel, tempDir }) {
  const freshDir = mkdtempSync(join(tempDir, "preset-sync-"));
  try {
    generatePresetBundle({ sourceDir, outDir: freshDir, packageName, sourceLabel });
    const names = [...new Set([...listFiles(freshDir), ...listFiles(repoArtifactDir), ...listFiles(targetDir)])].sort();
    const files = names.map((name) => {
      const fresh = sha256File(join(freshDir, name));
      const repo = sha256File(join(repoArtifactDir, name));
      const target = sha256File(join(targetDir, name));
      const repoStatus = repo === undefined ? "missing" : repo === fresh ? "match" : "drift";
      const targetStatus = target === undefined ? "absent" : target === fresh ? "match" : "stale";
      return { path: name, fresh, repo, target, repoStatus, targetStatus };
    });
    const repoOk = files.length > 0 && files.every((file) => file.repoStatus === "match");
    const targetState = files.some((file) => file.targetStatus === "stale") ? "drift" : files.length > 0 && files.every((file) => file.targetStatus === "match") ? "match" : "absent";
    return { freshDir, files, repoOk, targetState };
  } catch (error) {
    rmSync(freshDir, { recursive: true, force: true });
    throw error;
  }
}

/** profile 的 `dsh.profile.bundles` 是否已选择该 bundle。 */
function bundleSelected(profileDir, packageName) {
  const manifestPath = join(profileDir, "package.json");
  if (!existsSync(manifestPath)) return false;
  try {
    return (JSON.parse(readFileSync(manifestPath, "utf8")).dsh?.profile?.bundles ?? []).includes(packageName);
  } catch {
    return false;
  }
}

/** 打印逐文件计划与结论；返回进程退出码。 */
function reportPlan(options, plan, stdout) {
  stdout.write(`sync-agent-presets: ${options.preset} (bundle ${options.packageName}) → ${options.targetDir}${options.write ? " (write)" : " (dry-run)"}\n`);
  for (const file of plan.files) {
    const repo = file.repoStatus === "match" ? "ok" : file.repoStatus.toUpperCase();
    const target = file.targetStatus === "match" ? "ok" : file.targetStatus === "absent" ? "-" : file.targetStatus.toUpperCase();
    stdout.write(`  ${file.path.padEnd(24)} repo:${repo.padEnd(4)} target:${target.padEnd(6)} sha256=${String(file.fresh ?? "missing").slice(0, 12)}\n`);
  }
  if (!plan.repoOk) {
    stdout.write("sync-agent-presets: repository artifact drift (regenerate with: node scripts/agent-preset-bundle-cli.mjs)\n");
    return 1;
  }
  if (options.profileDir !== undefined) {
    const selected = bundleSelected(options.profileDir, options.packageName);
    stdout.write(`sync-agent-presets: profile ${options.profile} bundles selection: ${selected ? "selected" : "MISSING"}${options.write && !selected ? " (before write)" : ""}\n`);
    if (!options.write && !selected) {
      stdout.write("sync-agent-presets: dry-run — profile does not select the bundle; rerun with --write to wire it\n");
      return 1;
    }
  }
  if (!options.write) {
    stdout.write(
      plan.targetState === "match"
        ? `sync-agent-presets: dry-run — target already matches (${String(plan.files.length)} files)\n`
        : `sync-agent-presets: dry-run — target ${plan.targetState === "absent" ? "absent" : "differs"}; nothing written (rerun with --write to deploy)\n`,
    );
  }
  return plan.targetState === "drift" && !options.write ? 1 : 0;
}

/** 执行写入：profile 模式走 stagePresetBundle（bundle + 链接 + bundles 选择），否则复制到 staging。 */
function applyPlan(options, plan, stdout) {
  if (options.profileDir !== undefined) {
    stagePresetBundle({ sourceDir: options.sourceDir, profileDir: options.profileDir, packageName: options.packageName, sourceLabel: options.sourceLabel });
    stdout.write(`sync-agent-presets: wired bundle into profile ${options.profile} (${options.targetDir})\n`);
    return;
  }
  copyBundle(plan.freshDir, options.targetDir);
  stdout.write(`sync-agent-presets: wrote ${String(plan.files.length)} files to ${options.targetDir}\n`);
}

/** 打印旧目录退场提示（只读探测，不删除）。 */
function legacyNotice(options, stdout) {
  if (existsSync(options.legacyDir)) {
    stdout.write(`sync-agent-presets: legacy directory ${options.legacyDir} is no longer read by 0.1.7; removal is deferred to the deployment ticket (needs approval)\n`);
  }
}

export function runSyncCli(argv, { env = process.env, stdout = process.stdout } = {}) {
  let options;
  try {
    options = parseSyncArgs(argv, env);
  } catch (error) {
    stdout.write(`${String(error.message ?? error)}\n${HELP}\n`);
    return 2;
  }
  if (options.help === true) {
    stdout.write(`${HELP}\n`);
    return 0;
  }
  if (!existsSync(options.sourceDir)) {
    stdout.write(`sync-agent-presets: source preset not found: ${options.sourceDir}\n`);
    return 2;
  }
  if (options.profileDir !== undefined && !existsSync(join(options.profileDir, "package.json"))) {
    stdout.write(`sync-agent-presets: profile not found: ${options.profileDir}\n`);
    return 2;
  }
  const tempRoot = mkdtempSync(join(env.TMPDIR ?? tmpdir(), "preset-sync-plan-"));
  let plan;
  try {
    plan = planSync({ sourceDir: options.sourceDir, repoArtifactDir: options.repoArtifactDir, targetDir: options.targetDir, packageName: options.packageName, sourceLabel: options.sourceLabel, tempDir: tempRoot });
    const code = reportPlan(options, plan, stdout);
    if (code === 0 && options.write) applyPlan(options, plan, stdout);
    if (code === 0) legacyNotice(options, stdout);
    return code;
  } finally {
    if (plan?.freshDir !== undefined) rmSync(plan.freshDir, { recursive: true, force: true });
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  process.exit(runSyncCli(process.argv.slice(2)));
}
