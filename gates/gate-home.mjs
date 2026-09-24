/**
 * 闸门临时 home 的预置（票据 01 从 `gates/run.mjs` 拆出）。
 *
 * 全部写操作只落在 `GATE_TEMP` 指向的临时 home；真实 `~/.dsh` 只读。
 * headless profile 骨架与 CLI `prepareProfile` 同构；fixtures 提供二轮注入来源。
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PRESET, REPO_ROOT } from "./paths.mjs";

/** 临时 home 的子进程环境（键与拆分前一致）。 */
export function buildEnv(tempHome) {
  return {
    ...process.env,
    DSH_HOME: tempHome,
    HOME: tempHome,
    GATE_PRESET_ROOT: join(REPO_ROOT, "presets"),
    SMOKE_PRESET_ROOT: join(REPO_ROOT, "presets"),
    SMOKE_SESSION_ROOT: join(tempHome, "sessions"),
    SMOKE_EXTRA_PATCHES: join(REPO_ROOT, "gates", "composition", "subagent-settings.patch.yml"),
    CC_TUI_PRESET: PRESET,
  };
}

/** 预置临时 home 的 headless profile（与 CLI `prepareProfile` 的同构内容）。 */
export function prepareProfile(home) {
  const profileDir = join(home, "profiles", "headless");
  mkdirSync(profileDir, { recursive: true });
  if (!existsSync(join(profileDir, "package.json"))) {
    const manifest = {
      name: "dsh-profile-headless",
      private: true,
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"], patchReload: "startup" } },
    };
    writeFileSync(join(profileDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  if (!existsSync(join(profileDir, "cordis.yml"))) {
    writeFileSync(join(profileDir, "cordis.yml"), "# dsh profile root — an empty entry list.\n[]\n");
  }
  mkdirSync(join(home, "sessions"), { recursive: true });
  seedHomeFixtures(home);
  return profileDir;
}

/**
 * 把 `gates/fixtures/gate-home/` 的确定性内容复制进临时 home：
 * user-global `AGENTS.md`（第二轮 agent-instructions 注入的来源）与
 * `skills/gate-fixture/`（第二轮 skill-catalog 注入的来源）。
 * 不复制则二轮注入在隔离 home 下恒缺席——那样冒烟断言会退化成「读真实用户家目录」。
 */
function seedHomeFixtures(home) {
  const source = join(REPO_ROOT, "gates", "fixtures", "gate-home");
  if (!existsSync(source)) return;
  cpSync(source, home, { recursive: true });
}
