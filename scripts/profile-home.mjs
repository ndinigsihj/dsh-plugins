#!/usr/bin/env node
/**
 * 隔离 home 的 profile 骨架/注入 fixture 预置（票据 07 从 gate-home / stub runner /
 * smoke-boot 的三份重复实现收拢；票据 11 增加 0.1.7 preset 载体预置）。
 *
 * 全部写操作只落在调用方给出的隔离 home；真实 `~/.dsh` 只读。骨架与 CLI
 * `prepareProfile` 同构：headless profile 的 package.json bundles + 空 cordis.yml。
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mutateProfileBundles, stagePresetBundle } from "./agent-preset-bundle.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** headless profile 的默认 bundle 栈。 */
export const HEADLESS_BUNDLES = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"];

/** 预置 profile 骨架（已存在则保留既有内容；总是确保 sessions/ 存在）。 */
export function seedHeadlessProfile(home, { name = "headless", bundles = HEADLESS_BUNDLES } = {}) {
  const profileDir = join(home, "profiles", name);
  mkdirSync(profileDir, { recursive: true });
  const manifestPath = join(profileDir, "package.json");
  if (!existsSync(manifestPath)) {
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ name: `dsh-profile-${name}`, private: true, dsh: { profile: { bundles: [...bundles], patchReload: "startup" } } }, null, 2)}\n`,
    );
  }
  const cordisPath = join(profileDir, "cordis.yml");
  if (!existsSync(cordisPath)) writeFileSync(cordisPath, "# dsh profile root — an empty entry list.\n[]\n");
  mkdirSync(join(home, "sessions"), { recursive: true });
  return profileDir;
}

/**
 * 精确设置隔离 profile 的 `dsh.profile.bundles`（保留清单其它字段；缺清单则建骨架）。
 *
 * 闸门的 T2 场景共享同一个临时 home：每个场景进程按自己的组合面重设 bundles，
 * 才不会被上一个场景的选择残留影响（预设 bundle 由 stagePresetBundle 随后追加）。
 */
export function setProfileBundles(home, bundles, name = "headless") {
  const profileDir = join(home, "profiles", name);
  mutateProfileBundles(profileDir, () => bundles);
  return profileDir;
}

/**
 * 把 `gates/fixtures/gate-home/` 的确定性内容复制进临时 home：
 * user-global `AGENTS.md`（第二轮 agent-instructions 注入的来源）与
 * `skills/gate-fixture/`（第二轮 skill-catalog 注入的来源）。
 * 不复制则二轮注入在隔离 home 下恒缺席——断言会退化成「读真实用户家目录」。
 */
export function seedHomeFixtures(home) {
  const source = join(REPO_ROOT, "gates", "fixtures", "gate-home");
  if (existsSync(source)) cpSync(source, home, { recursive: true });
}

/**
 * 宿主侧子代理模型选择单例的插入行（0.1.7 preset 的 delegation 行开了
 * `modelSelectionSettings: true`，profile 缺这行时组合直接抛错）。
 * 配置放在 profile 层而不是 `--patch` overlay：settings 编辑器拒绝写入被命令行
 * overlay 覆盖的条目，探针的「事后编辑设置」检查需要 user 层可写。
 * config 省略时为插件默认（enabled=false），传对象则作为 profile 基线。
 */
export function modelSelectionSingletonPatch(config) {
  const lines = [
    "# Isolated profile: host-scope model-selection singleton (baseline config; settings UI may override).",
    "- insert:",
    "    - id: subagent-model-selection-settings",
    "      name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'",
  ];
  // JSON 是合法 YAML flow mapping，省一个序列化依赖。
  if (config !== undefined) lines.push(`      config: ${JSON.stringify(config)}`);
  lines.push("");
  return lines.join("\n");
}

/**
 * 0.1.7 隔离 home 的完整预置（票据 11）：headless 骨架 + 确定性 fixture + 从真源
 * 现场生成的 preset 载体（bundle 落 profile、bundles 选择、node_modules 链接）。
 * T3 runner 与 `experiments/*` 的独立探针脚本共用，保证两条路径的组合面同构。
 *
 * @param options.home 隔离 home（写面）。
 * @param options.name profile 名（默认 headless）。
 * @param options.sourceDir preset 真源目录（载体由它生成，不读旧目录形态）。
 * @param options.sourceLabel 载体里的真源标注（默认 sourceDir）。
 * @param options.settingsSingleton 是否写 profile patch 挂宿主侧模型选择单例（默认 false）。
 * @param options.settingsConfig 单例 config；省略 = 插件默认（enabled=false），对象 = profile 基线。
 */
export function prepareHeadlessPresetProfile({ home, name = "headless", sourceDir, sourceLabel, settingsSingleton = false, settingsConfig }) {
  const profileDir = seedHeadlessProfile(home, { name });
  seedHomeFixtures(home);
  const staged = stagePresetBundle({ sourceDir, profileDir, sourceLabel });
  let patchPath;
  if (settingsSingleton) {
    patchPath = join(profileDir, "cordis.patch.yml");
    writeFileSync(patchPath, modelSelectionSingletonPatch(settingsConfig));
  }
  return { profileDir, patchPath, ...staged };
}

/** 取下一个参数值；缺失时报明确错误，而不是把 undefined 传进 resolve/JSON.parse。 */
function nextValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined) throw new Error(`profile-home: ${flag} requires a value`);
  return value;
}

/** CLI 参数：只接受显式命名的路径；默认挂单例（minimal-plus 缺它无法组合）。 */
function parseCliArgs(argv) {
  const options = { name: "headless", settingsSingleton: true };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--home") options.home = nextValue(argv, index++, token);
    else if (token === "--profile") options.name = nextValue(argv, index++, token);
    else if (token === "--source") options.sourceDir = resolve(nextValue(argv, index++, token));
    else if (token === "--settings-singleton") options.settingsSingleton = true;
    else if (token === "--settings-config") {
      options.settingsConfig = JSON.parse(nextValue(argv, index++, token));
      options.settingsSingleton = true;
    } else throw new Error(`profile-home: unknown argument ${token}`);
  }
  if (options.home === undefined || options.sourceDir === undefined) {
    throw new Error("profile-home: --home <dir> and --source <dir> are required");
  }
  options.home = resolve(options.home);
  return options;
}

if (process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const options = parseCliArgs(process.argv.slice(2));
  const result = prepareHeadlessPresetProfile(options);
  process.stdout.write(`${JSON.stringify({ home: options.home, profile: options.name, profileDir: result.profileDir, bundleDir: result.bundleDir, patchPath: result.patchPath })}\n`);
}
