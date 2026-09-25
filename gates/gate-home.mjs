/**
 * 闸门临时 home 的预置（票据 01 从 `gates/run.mjs` 拆出）。
 *
 * 全部写操作只落在 `GATE_TEMP` 指向的临时 home；真实 `~/.dsh` 只读。
 * headless profile 骨架与 CLI `prepareProfile` 同构；fixtures 提供二轮注入来源。
 */
import { join } from "node:path";
import { stagePresetBundle } from "../scripts/agent-preset-bundle.mjs";
import { seedHeadlessProfile, seedHomeFixtures } from "../scripts/profile-home.mjs";
import { PRESET, REPO_ROOT } from "./paths.mjs";

/** 临时 home 的子进程环境（键与拆分前一致）。 */
export function buildEnv(tempHome) {
  return {
    ...process.env,
    DSH_HOME: tempHome,
    HOME: tempHome,
    SMOKE_PRESET_ROOT: join(REPO_ROOT, "presets"),
    SMOKE_SESSION_ROOT: join(tempHome, "sessions"),
    SMOKE_EXTRA_PATCHES: join(REPO_ROOT, "gates", "composition", "subagent-settings.patch.yml"),
    CC_TUI_PRESET: PRESET,
  };
}

/** 预置临时 home 的 headless profile；0.1.7 载体从真源生成并让 profile 选择。 */
export function prepareProfile(home) {
  const profileDir = seedHeadlessProfile(home);
  stagePresetBundle({ sourceDir: join(REPO_ROOT, "presets", PRESET), profileDir, sourceLabel: join("presets", PRESET) });
  seedHomeFixtures(home);
  return profileDir;
}
