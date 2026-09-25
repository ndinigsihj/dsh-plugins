#!/usr/bin/env node
/**
 * 0.1.7 preset 载体真实落位（票据 12；计划 §7 第 11 步）——计划与执行库，CLI 见
 * `deploy-preset-carrier-cli.mjs`。
 *
 * `scripts/sync-agent-presets.mjs` 是「生成 + 写入单个 profile 侧产物」的通用工具；
 * 本模块负责收口票里那次多 profile 迁移与 Team profile 物化，默认只出计划：
 *
 *   tui-dev   摘掉 0.1.7 已移除的旧目录 preset 服务行（写前先备份原 patch），再把生成
 *             bundle 接进 profile（`preset-bundles/` + node_modules 链接 +
 *             `dsh.profile.bundles` 选择）。
 *   tui-team  从 tui-dev 派生（复制 patch / cordis.yml / package.json / node_modules），
 *             追加 Team bundle，再接同一份 preset bundle；已存在即拒绝覆盖（不静默替换
 *             真实 profile），中途失败时清掉本次新建的目录。
 *
 * 全部写操作只落在调用方给出的 `dshHome`（默认 `~/.dsh`）；dry-run 计划为纯只读。
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, sha256Text } from "../gates/gate-helpers.mjs";
import { stripLegacyPresetRow } from "../gates/composition/render-real.mjs";
import { TEAM_BUNDLE, TEAM_PROFILE, TEAM_PROFILE_SOURCE } from "../gates/team-bundle.mjs";
import { BUNDLE_PACKAGE_NAME, mutateProfileBundles, stagePresetBundle } from "./agent-preset-bundle.mjs";
import { planSync } from "./sync-agent-presets.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_PRESET = "minimal-plus";

function unique(items) {
  return items.filter((item, index) => items.indexOf(item) === index);
}

/** 清单里的 bundle 选择（缺失/坏 JSON 都按空集处理）。 */
function profileBundles(manifest) {
  return manifest?.dsh?.profile?.bundles ?? [];
}

function readBundles(profileDir) {
  return profileBundles(readJson(join(profileDir, "package.json")));
}

function formatStamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** 逐文件比对「现场再生 ↔ 仓库产物 ↔ 目标位」（复用同步工具；临时目录用完即删）。 */
function inspectBundle({ sourceDir, artifactDir, targetDir, packageName, sourceLabel }) {
  const tempRoot = mkdtempSync(join(tmpdir(), "preset-deploy-"));
  try {
    const plan = planSync({ sourceDir, repoArtifactDir: artifactDir, targetDir, packageName, sourceLabel, tempDir: tempRoot });
    return {
      state: plan.targetState,
      repoOk: plan.repoOk,
      files: plan.files.map((file) => ({ path: file.path, sha256: file.fresh, repoStatus: file.repoStatus, targetStatus: file.targetStatus })),
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

/** 目标位 bundle 状态 + 仓库产物漂移问题（两个 profile 面共用；`common` 为共享输入）。 */
function inspectTarget({ dir, common }) {
  if (!common.sourceOk) return { target: undefined, problems: [] };
  const target = inspectBundle({ sourceDir: common.sourceDir, artifactDir: common.artifactDir, targetDir: join(dir, "preset-bundles", basename(common.packageName)), packageName: common.packageName, sourceLabel: common.sourceLabel });
  const problems = target.repoOk ? [] : [`repository artifact drift: regenerate ${common.artifactDir} (node scripts/agent-preset-bundle-cli.mjs)`];
  return { target, problems };
}

/** tui-dev 面：旧行摘除判定 + bundle 目标位状态。`common` 由 planPresetCarrier 组装。 */
function planDevProfile({ dir, common }) {
  const problems = [];
  const patchPath = join(dir, "cordis.patch.yml");
  const manifestPath = join(dir, "package.json");
  let patch;
  let manifest;
  if (!existsSync(patchPath) || !existsSync(manifestPath)) {
    problems.push(`source profile not found: ${dir} (need cordis.patch.yml + package.json)`);
  } else {
    const text = readFileSync(patchPath, "utf8");
    const strippedText = stripLegacyPresetRow(text);
    patch = { path: patchPath, sha256: sha256Text(text), legacyRowStrip: strippedText !== text, strippedText };
    const parsed = readJson(manifestPath);
    if (parsed?.error !== undefined) problems.push(`source profile manifest is not valid JSON: ${manifestPath} (${parsed.error})`);
    else manifest = parsed;
  }
  const bundles = profileBundles(manifest);
  const inspected = inspectTarget({ dir, common });
  problems.push(...inspected.problems);
  return {
    dev: {
      kind: "dev",
      name: TEAM_PROFILE_SOURCE,
      dir,
      exists: manifest !== undefined,
      bundles,
      plannedBundles: unique([...bundles, common.packageName]),
      selection: bundles.includes(common.packageName),
      patch,
      bundleTarget: inspected.target,
    },
    manifest,
    problems,
  };
}

/** tui-team 面：派生计划（含待写 manifest）；已存在时只核对一致性。 */
function planTeamProfile({ dir, dev, devManifest, common }) {
  const problems = [];
  const manifestPath = join(dir, "package.json");
  const exists = existsSync(manifestPath);
  const parsed = exists ? readJson(manifestPath) : undefined;
  if (parsed?.error !== undefined) problems.push(`${TEAM_PROFILE} manifest is not valid JSON: ${manifestPath} (${parsed.error})`);
  const manifest = parsed?.error === undefined ? parsed : undefined;
  const bundles = profileBundles(manifest);
  const inherited = dev.bundles.filter((bundle) => bundle !== common.packageName);
  const plannedBundles = unique([...inherited, TEAM_BUNDLE, common.packageName]);
  const inspected = inspectTarget({ dir, common });
  problems.push(...inspected.problems);
  if (exists) {
    const missing = plannedBundles.filter((bundle) => !bundles.includes(bundle));
    if (missing.length > 0) problems.push(`${TEAM_PROFILE} exists but is missing bundles: ${missing.join(", ")}`);
    if (inspected.target?.state !== "match") problems.push(`${TEAM_PROFILE} exists but its preset bundle is ${String(inspected.target?.state ?? "absent")}`);
  }
  const manifestPlan =
    devManifest === undefined
      ? undefined
      : { ...devManifest, name: `dsh-profile-${TEAM_PROFILE}`, dsh: { ...(devManifest.dsh ?? {}), profile: { ...(devManifest.dsh?.profile ?? {}), bundles: inherited } } };
  return {
    team: { kind: "team", name: TEAM_PROFILE, dir, exists, source: TEAM_PROFILE_SOURCE, bundles, plannedBundles, selection: bundles.includes(common.packageName), manifest: manifestPlan, bundleTarget: inspected.target },
    problems,
  };
}

/**
 * 出部署计划（dry-run / `--check` / write 共用）：只读真实 home，不写任何文件。
 * @param options.dshHome dsh home（`profiles/` 的父目录）。
 * @param options.repoRoot 本 checkout 根（测试注入）。
 * @returns `{ok, needsWrite, problems, preset, profilesRoot, profiles}`；`ok` 表示计划可执行，
 *   `needsWrite` 表示部署位尚未处于目标态（`--check` 用它决定退出码）。
 */
export function planPresetCarrier({ dshHome = join(homedir(), ".dsh"), repoRoot = REPO_ROOT, preset = DEFAULT_PRESET } = {}) {
  const sourceDir = join(repoRoot, "presets", preset);
  const artifactDir = join(repoRoot, "generated", `${preset}-preset`);
  const packageName = BUNDLE_PACKAGE_NAME;
  const sourceLabel = `presets/${preset}`;
  const profilesRoot = join(dshHome, "profiles");
  const sourceOk = existsSync(join(sourceDir, "agent.cordis.yml"));
  const common = { sourceDir, artifactDir, packageName, sourceLabel, sourceOk };
  const devPlan = planDevProfile({ dir: join(profilesRoot, TEAM_PROFILE_SOURCE), common });
  const teamPlan = planTeamProfile({ dir: join(profilesRoot, TEAM_PROFILE), dev: devPlan.dev, devManifest: devPlan.manifest, common });
  const problems = sourceOk ? [] : [`preset source not found: ${sourceDir}`];
  problems.push(...devPlan.problems, ...teamPlan.problems);
  const devCurrent = devPlan.dev.bundleTarget?.state === "match" && devPlan.dev.selection;
  const teamCurrent = teamPlan.team.exists && teamPlan.team.bundleTarget?.state === "match" && teamPlan.team.selection;
  return {
    ok: problems.length === 0,
    needsWrite: !(devCurrent && teamCurrent),
    problems,
    preset: { id: preset, packageName, sourceDir, artifactDir, sourceLabel },
    profilesRoot,
    profiles: [devPlan.dev, teamPlan.team],
  };
}

/**
 * 执行计划（显式 write 路径）：
 * 1. tui-dev 备份原 patch（有旧行时）→ 摘行；
 * 2. 从 tui-dev 派生 tui-team（在装配 bundle 前复制 node_modules，避免带上 dev 的链接）；
 * 3. 两个 profile 的 bundle 选择都走 `mutateProfileBundles`（唯一写入点）：Team bundle 显式
 *    追加，preset bundle 由 `stagePresetBundle` 追加；失败时清掉本次新建的目录。
 * @returns `{backup, dev, team}`（写入后的 bundle 选择）。
 */
export function applyPresetCarrier(plan, { timestamp = formatStamp(new Date()) } = {}) {
  const dev = plan.profiles.find((profile) => profile.kind === "dev");
  const team = plan.profiles.find((profile) => profile.kind === "team");
  if (team.exists) throw new Error(`${team.name} already exists; refusing to overwrite ${team.dir}`);
  if (!plan.ok) throw new Error(`deployment plan is not ok: ${plan.problems.join("; ")}`);
  if (dev.patch === undefined || team.manifest === undefined) throw new Error("deployment plan is incomplete");

  let backup;
  if (dev.patch.legacyRowStrip) {
    backup = `${dev.patch.path}.bak-${timestamp}`;
    cpSync(dev.patch.path, backup);
    writeFileSync(dev.patch.path, dev.patch.strippedText);
  }
  const teamCreated = !existsSync(team.dir);
  try {
    mkdirSync(team.dir, { recursive: true });
    writeFileSync(join(team.dir, "cordis.patch.yml"), dev.patch.strippedText);
    writeFileSync(join(team.dir, "package.json"), `${JSON.stringify(team.manifest, null, 2)}\n`);
    const cordis = join(dev.dir, "cordis.yml");
    if (existsSync(cordis)) cpSync(cordis, join(team.dir, "cordis.yml"));
    const deps = join(dev.dir, "node_modules");
    if (existsSync(deps)) cpSync(deps, join(team.dir, "node_modules"), { recursive: true });
  } catch (error) {
    if (teamCreated) rmSync(team.dir, { recursive: true, force: true });
    throw error;
  }

  const wire = (profileDir) => stagePresetBundle({ sourceDir: plan.preset.sourceDir, profileDir, packageName: plan.preset.packageName, sourceLabel: plan.preset.sourceLabel });
  wire(dev.dir);
  try {
    mutateProfileBundles(team.dir, (bundles) => unique([...bundles, TEAM_BUNDLE]));
    wire(team.dir);
  } catch (error) {
    if (teamCreated) rmSync(team.dir, { recursive: true, force: true });
    throw error;
  }
  return { backup, dev: { dir: dev.dir, bundles: readBundles(dev.dir) }, team: { dir: team.dir, bundles: readBundles(team.dir) } };
}
