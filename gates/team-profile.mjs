#!/usr/bin/env node
/**
 * tui-team Profile 建立检查（票据 09）。
 *
 * 在隔离 home 里从真实 `tui-dev` profile **派生** `tui-team`（源只读 + 追加 Team
 * bundle）、装入 0.1.7 preset 载体，再跑 `dsh --profile tui-team --dump-config`，
 * 核对 exit 0 与逐 loader id 递归计数为 1（验收：组合无重复 id、可启动）。
 *
 * 两个入口共用 {@link checkTeamProfile}：
 *   - 闸门 T1 real（`gates/t1/team-profile.mjs` 的 `composition.team-profile`）；
 *   - 命令行留证：`node gates/team-profile.mjs --json <path>`。
 *
 * 真实 `~/.dsh` 只读；全部写入落在调用方给的临时 home。真实 `~/.dsh/profiles/tui-team`
 * 的物化与 preset 落位归收口票 12（本模块只证明组合与导出在隔离环境成立）。
 *
 * 退出码：0 全过 / 1 断言失败（dump 或 id 计数红）/ 2 环境前置不满足（缺源 profile、
 * 缺相邻 checkout、渲染依赖不可解析）。
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT, run, tailLines, writeReport } from "./gate-helpers.mjs";
import { MANIFEST_PATH, readManifest, resolveDeploymentRoot } from "./manifest.mjs";
import { PRESET, REPO_ROOT } from "./paths.mjs";
import { RenderRealError, renderRealComposition } from "./composition/render-real.mjs";
import { parseCompositionDump } from "./dump-parse.mjs";
import { countEntries, findDuplicateIds } from "./unique-ids.mjs";
import { TEAM_BUNDLE, TEAM_PROFILE, TEAM_PROFILE_SOURCE } from "./team-bundle.mjs";
import { installAnchor } from "../scripts/host-runtime.mjs";

function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** 渲染副本 profile 清单里的 bundle 选择（报告证据面）；清单不可读即抛错，不静默空集。 */
function profileBundles(profileDir) {
  return JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8")).dsh?.profile?.bundles ?? [];
}

/**
 * 派生 tui-team、跑配置导出、复核 loader id。
 *
 * @param options.tempHome 隔离临时 home（调用方创建；本函数只写这里）。
 * @param options.deploymentRoot 部署位 preset 目录（缺省/不完整时回落仓库真源）。
 * @param options.installAnchor 宿主包 `package.json` 绝对路径。
 * @param options.env / options.homeDir repo 根解析与真实 home（测试可注入）。
 * @returns `{ok, rendered, bundles, dump}`；渲染前置失败抛 {@link RenderRealError}。
 */
export function checkTeamProfile({ tempHome, deploymentRoot, installAnchor: anchor, env = process.env, homeDir = homedir() }) {
  const rendered = renderRealComposition({
    repoRoot: REPO_ROOT,
    tempHome,
    presetName: PRESET,
    profileName: TEAM_PROFILE,
    sourceProfileName: TEAM_PROFILE_SOURCE,
    extraBundles: [TEAM_BUNDLE],
    deploymentRoot,
    installAnchor: anchor,
    env,
    homeDir,
  });
  mkdirSync(join(tempHome, "sessions"), { recursive: true });
  const dump = run("dsh", ["--profile", TEAM_PROFILE, "--dump-config"], {
    cwd: REPO_ROOT,
    env: { ...env, DSH_HOME: tempHome, HOME: tempHome },
  });
  const parsed = parseCompositionDump(dump.stdout);
  const counts = parsed.entries === undefined ? undefined : countEntries(parsed.entries);
  const duplicates = parsed.entries === undefined ? undefined : findDuplicateIds(parsed.entries);
  const ok = dump.status === 0 && parsed.error === undefined && counts !== undefined && (duplicates?.length ?? Number.POSITIVE_INFINITY) === 0;
  return {
    ok,
    rendered,
    bundles: profileBundles(rendered.profileDir),
    dump: {
      exit: dump.status,
      parseError: parsed.error ?? null,
      ids: counts?.ids ?? null,
      duplicates: duplicates ?? [],
      stdoutSha: sha256Text(dump.stdout),
      stderrTail: tailLines(dump.stderr, 4),
    },
  };
}

/** 报告骨架（证据归档；不含 settings 内容，只有来源 sha）。 */
export function teamProfileReport(check, { startedAt, finishedAt, hostVersion }) {
  const { rendered } = check;
  return {
    kind: "team-profile",
    version: 1,
    startedAt,
    finishedAt,
    hostVersion,
    target: { profile: TEAM_PROFILE, sourceProfile: TEAM_PROFILE_SOURCE, extraBundles: [TEAM_BUNDLE], preset: PRESET },
    composition: {
      sourcePath: rendered.sourcePath,
      sourceSha: rendered.sourceSha,
      renderedPath: rendered.renderedPath,
      renderedSha: rendered.renderedSha,
      bundles: check.bundles,
      presetSource: rendered.preset.source,
      presetRoot: rendered.preset.root,
      presetBundleDir: rendered.preset.bundleDir,
      legacyRowStripped: rendered.preset.legacyRowStripped,
      settings: rendered.settings,
    },
    dump: check.dump,
    ok: check.ok,
  };
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

const HELP = [
  "Usage: node gates/team-profile.mjs [--json <path>] [--keep-temp]",
  "",
  "  Derives tui-team from the real tui-dev profile in an isolated home, stages the",
  "  0.1.7 preset carrier, runs `dsh --profile tui-team --dump-config` and checks",
  "  exit 0 + unique loader ids. Real ~/.dsh stays read-only; the real profile",
  "  materialization belongs to ticket 12.",
].join("\n");

function parseArgs(argv) {
  const options = { json: undefined, keepTemp: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") options.json = argv[++index];
    else if (token === "--keep-temp") options.keepTemp = true;
    else if (token === "-h" || token === "--help") options.help = true;
    else throw new Error(`team-profile: unknown argument ${token}`);
  }
  return options;
}

function hostVersion() {
  try {
    return JSON.parse(readFileSync(installAnchor(), "utf8")).version;
  } catch {
    return undefined;
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stdout.write(`${String(error.message ?? error)}\n${HELP}\n`);
    return EXIT.precondition;
  }
  if (options.help === true) {
    process.stdout.write(`${HELP}\n`);
    return EXIT.pass;
  }
  const manifest = readManifest(MANIFEST_PATH);
  const deploymentEntry = manifest.status === "ok" ? manifest.manifest.deployment?.[PRESET] : undefined;
  const tempRoot = mkdtempSync(join(tmpdir(), "dsh-team-profile-"));
  const tempHome = join(tempRoot, "home");
  mkdirSync(tempHome, { recursive: true });
  const startedAt = new Date().toISOString();
  try {
    const check = checkTeamProfile({
      tempHome,
      deploymentRoot: deploymentEntry === undefined ? undefined : resolveDeploymentRoot(deploymentEntry, homedir()),
      installAnchor: installAnchor(),
    });
    const report = teamProfileReport(check, { startedAt, finishedAt: new Date().toISOString(), hostVersion: hostVersion() });
    if (options.json !== undefined) writeReport(options.json, report);
    process.stdout.write(
      `team-profile: profile=${TEAM_PROFILE} source=${TEAM_PROFILE_SOURCE} dump exit=${String(check.dump.exit)} ids=${String(check.dump.ids)} duplicates=${String(check.dump.duplicates.length)} ok=${String(check.ok)}\n`,
    );
    if (!check.ok) {
      process.stdout.write(`team-profile: stderr tail: ${check.dump.stderrTail.join(" | ")}\n`);
      return EXIT.fail;
    }
    return EXIT.pass;
  } catch (error) {
    const message = error instanceof RenderRealError ? error.message : `team-profile failed: ${String(error?.message ?? error)}`;
    process.stdout.write(`team-profile: ${message}\n`);
    return EXIT.precondition;
  } finally {
    if (options.keepTemp) process.stderr.write(`team-profile: kept temp home at ${tempHome}\n`);
    else rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  process.exit(main());
}
