/**
 * 真实开发组合的运行期渲染（票据 04；计划 §2.1、§4.1）。
 *
 * 用途：`--composition real` 时读取真实 `~/.dsh/profiles/tui-dev/cordis.patch.yml`，
 * 把其中的仓库根路径（本仓库 + 相邻 dsh-relay / dsh-endless）替换为运行期解析的
 * checkout，物化到隔离临时 home；源 profile 只读，真实 `~/.dsh` 零写入。
 *
 * 为什么必须运行期渲染（计划 §2.1「已核实」）：真实 profile 有 10 条绝对路径，其中
 * 6 条指向另外两个仓库。闸门不能把这两份 checkout 变成硬依赖（CI/任意 checkout 要能
 * 跑默认的闸门组合），所以 `real` 模式按 env 渲染：
 *   - `DSH_PLUGINS_ROOT`（默认本 checkout）
 *   - `DSH_RELAY_ROOT` / `DSH_ENDLESS_ROOT`（默认相邻 `../dsh-relay`、`../dsh-endless`）
 *
 * 失败语义（计划 §5.1）：缺相邻 checkout、或渲染后的插件路径/裸包名解析不到，
 * 一律抛 {@link RenderRealError}（调用方转成环境前置失败 exit 2）；**绝不**静默
 * 回落到闸门自持组合——那会让「交付前验的是真实组合」变成假绿。
 */
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseCompositionDump } from "../dump-parse.mjs";

/** 真实开发 profile 名（计划 §2.1 的运行态定义）。 */
export const REAL_PROFILE_NAME = "tui-dev";

/**
 * 三类仓库根：profile 文本里的路径标记 / env 覆盖键 / 默认位置。
 * `plugins` 默认本 checkout；`relay`、`endless` 默认相邻 checkout。
 */
const REPO_ROOT_SPECS = [
  { id: "plugins", marker: "dsh-plugins", env: "DSH_PLUGINS_ROOT", sibling: undefined },
  { id: "relay", marker: "dsh-relay", env: "DSH_RELAY_ROOT", sibling: "dsh-relay" },
  { id: "endless", marker: "dsh-endless", env: "DSH_ENDLESS_ROOT", sibling: "dsh-endless" },
];

/** 环境前置不满足：缺源 profile / 缺相邻 checkout / 渲染后依赖不可解析。 */
export class RenderRealError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "RenderRealError";
    this.detail = detail;
  }
}

function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** 三类仓库根的运行期解析结果（env 覆盖优先，默认取本 checkout 与相邻 checkout）。 */
export function resolveRepoRoots(repoRoot, env = {}) {
  const parent = dirname(repoRoot);
  return REPO_ROOT_SPECS.map((spec) => ({
    id: spec.id,
    env: spec.env,
    marker: spec.marker,
    path: resolve(env[spec.env] ?? (spec.sibling === undefined ? repoRoot : join(parent, spec.sibling))),
  }));
}

/**
 * 路径前缀替换：把文本里任意位置的 `<...>/<marker>/` 替换成目标根。
 *
 * 用 marker 而不是「写死的源根」匹配：源 profile 只要仍指向同名 checkout
 * （这是 profile 的固有事实），换 checkout 路径/换机器都能渲染。替换值是字面量，
 * 用 replacer 函数避免 `$` 被当成替换模板。
 */
export function rewriteRepoRoots(text, roots) {
  let rendered = text;
  for (const root of roots) {
    const pattern = new RegExp(`(?:/[^\\s'"]*)?/${root.marker}(?=/)`, "gu");
    rendered = rendered.replace(pattern, () => root.path);
  }
  return rendered;
}

/** 收集 patch 条目里的插件名（`id` + `name` 是条目身份；config 里的同名键不算）。 */
export function collectModuleNames(entries) {
  const names = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (typeof node.name === "string" && node.id !== undefined) names.push(node.name);
    for (const value of Object.values(node)) {
      if (value !== null && typeof value === "object") walk(value);
    }
  };
  walk(entries);
  return names;
}

/** 单个插件名的可解析性：`cordis:` 伪模块跳过、路径名查存在、裸包名走宿主解析。 */
function unresolvableName(name, { profileDir, installAnchor }) {
  if (name.startsWith("cordis:")) return undefined;
  if (name.startsWith("/") || name.startsWith("./") || name.startsWith("../")) {
    const target = name.startsWith("/") ? name : resolve(profileDir, name);
    return existsSync(target) ? undefined : `${target} (missing)`;
  }
  try {
    createRequire(installAnchor).resolve(name);
    return undefined;
  } catch (error) {
    return `${name} (${String(error.code ?? error.message ?? error)})`;
  }
}

/** 渲染后的 patch 必须能解析出条目，且每个插件名可解析到文件/包。 */
function checkDependencies(renderedText, { profileDir, installAnchor }) {
  const parsed = parseCompositionDump(renderedText);
  if (parsed.error !== undefined) {
    throw new RenderRealError(`rendered profile is not a patch array: ${parsed.error}`, { error: parsed.error });
  }
  const bad = collectModuleNames(parsed.entries)
    .map((name) => unresolvableName(name, { profileDir, installAnchor }))
    .filter((problem) => problem !== undefined);
  if (bad.length > 0) {
    throw new RenderRealError(`rendered profile has ${String(bad.length)} unresolvable dependencies: ${bad.slice(0, 5).join("; ")}`, {
      unresolvable: bad,
    });
  }
}

/**
 * 物化真实组合到临时 home，返回「验的是哪一份」的全部证据面。
 *
 * @param options.repoRoot 本 checkout 根（`DSH_PLUGINS_ROOT` 未设时的插件根默认值）。
 * @param options.tempHome 隔离临时 home（DSH_HOME/HOME 的指向）。
 * @param options.presetName 要随组合一起物化的 preset（默认 `minimal-plus`）。
 * @param options.deploymentRoot 部署位 preset 目录（缺省/不完整时回落仓库副本并在结果里标注）。
 * @param options.installAnchor 宿主包 `package.json` 绝对路径（裸包名解析基准）。
 * @param options.homeDir 真实 home（`~` 展开基准；测试可注入假 home）。
 * @returns 源/渲染后 sha、路径、三类仓库根、preset 来源与副本、settings 副本信息。
 */
export function renderRealComposition(options) {
  const { repoRoot, tempHome, deploymentRoot, installAnchor } = options;
  const presetName = options.presetName ?? "minimal-plus";
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const roots = resolveRepoRoots(repoRoot, env);
  const missingRoots = roots.filter((root) => !existsSync(root.path) || !statSync(root.path).isDirectory());
  if (missingRoots.length > 0) {
    const detail = missingRoots.map((root) => `${root.id}: ${root.path}`).join(", ");
    throw new RenderRealError(`missing repo checkout(s): ${detail}; set ${missingRoots.map((root) => root.env).join("/")}`, {
      missingRoots,
    });
  }

  const sourcePath = join(homeDir, ".dsh", "profiles", REAL_PROFILE_NAME, "cordis.patch.yml");
  if (!existsSync(sourcePath)) {
    throw new RenderRealError(`real composition source profile not found: ${sourcePath}`, { sourcePath });
  }
  const sourceText = readFileSync(sourcePath, "utf8");
  const renderedText = rewriteRepoRoots(sourceText, roots);

  const profileDir = join(tempHome, "profiles", REAL_PROFILE_NAME);
  checkDependencies(renderedText, { profileDir, installAnchor });

  const sourceProfileDir = dirname(sourcePath);
  const sourceManifest = join(sourceProfileDir, "package.json");
  if (!existsSync(sourceManifest)) {
    throw new RenderRealError(`real composition profile manifest not found: ${sourceManifest}`, { sourceManifest });
  }
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, "cordis.patch.yml"), renderedText);
  copyFileSync(sourceManifest, join(profileDir, "package.json"));
  const sourceCordis = join(sourceProfileDir, "cordis.yml");
  if (existsSync(sourceCordis)) copyFileSync(sourceCordis, join(profileDir, "cordis.yml"));
  else writeFileSync(join(profileDir, "cordis.yml"), "# rendered by the regression gate\n[]\n");

  // 真实 profile 的 node_modules（pnpm 安装的私有 bundle，如 dsh-antigravity-auth）：
  // 只读符号链接进临时 profile，使 loadProfile 能解析 profile 声明的 bundles。
  // 源目录在真实 home，闸门只读它、零写入（隔离指纹仍按 lstat 记录链接本身）。
  const sourceNodeModules = join(sourceProfileDir, "node_modules");
  const profileNodeModules = join(profileDir, "node_modules");
  if (existsSync(sourceNodeModules) && !existsSync(profileNodeModules)) {
    symlinkSync(sourceNodeModules, profileNodeModules, "dir");
  }

  mkdirSync(join(tempHome, "sessions"), { recursive: true });
  // 真实 settings 的副本（计划 §2.1/Q2）：只落在 700 的临时 home 里，报告只记 sha；
  // `--keep-temp` 会把它留在磁盘上（含明文 provider 密钥），属排查专用、需手工删。
  const settingsSource = join(homeDir, ".dsh", "settings.yaml");
  const settingsCopied = existsSync(settingsSource);
  if (settingsCopied) copyFileSync(settingsSource, join(tempHome, "settings.yaml"));

  // preset 副本：部署位可用则用部署位（真实加载源），否则回落仓库副本并显式标注。
  const presetStaging = join(tempHome, ".agent-presets");
  const deployedPreset = deploymentRoot !== undefined && existsSync(join(deploymentRoot, "preset.yml"));
  const presetSourcePath = deployedPreset ? deploymentRoot : join(repoRoot, "presets", presetName);
  if (!existsSync(join(presetSourcePath, "preset.yml"))) {
    throw new RenderRealError(`preset to stage not found: ${presetSourcePath}`, { presetSourcePath });
  }
  mkdirSync(presetStaging, { recursive: true });
  cpSync(presetSourcePath, join(presetStaging, presetName), { recursive: true });

  return {
    sourcePath,
    sourceSha: sha256Text(sourceText),
    renderedPath: join(profileDir, "cordis.patch.yml"),
    renderedSha: sha256Text(renderedText),
    profileDir,
    roots: roots.map((root) => ({ id: root.id, env: root.env, path: root.path })),
    preset: {
      name: presetName,
      source: deployedPreset ? "deployed" : "repo",
      sourcePath: presetSourcePath,
      stagedPath: join(presetStaging, presetName),
      root: presetStaging,
    },
    settings: settingsCopied ? { copied: true, sourcePath: settingsSource, sha: sha256Text(readFileSync(settingsSource, "utf8")) } : { copied: false },
  };
}
