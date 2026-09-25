#!/usr/bin/env node
/**
 * 隔离 home 的 profile 骨架/注入 fixture 预置（票据 07 从 gate-home / stub runner /
 * smoke-boot 的三份重复实现收拢）。
 *
 * 全部写操作只落在调用方给出的隔离 home；真实 `~/.dsh` 只读。骨架与 CLI
 * `prepareProfile` 同构：headless profile 的 package.json bundles + 空 cordis.yml。
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mutateProfileBundles } from "./agent-preset-bundle.mjs";

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
