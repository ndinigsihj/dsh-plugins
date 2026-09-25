/**
 * 0.1.7 preset 载体真实落位命令的单测（票据 12）：默认 dry-run 不写真实 home、
 * tui-dev 摘旧行 + 装 bundle、tui-team 从 tui-dev 派生，已存在则拒绝覆盖。
 * 全部写入落在临时 home；真实 `~/.dsh` 不参与。
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyPresetCarrier, planPresetCarrier } from "./deploy-preset-carrier.mjs";
import { runPresetCarrierCli } from "./deploy-preset-carrier-cli.mjs";
import { BUNDLE_PACKAGE_NAME, generatePresetBundle } from "./agent-preset-bundle.mjs";
import { TEAM_BUNDLE } from "../gates/team-bundle.mjs";
import { PRESET_BUNDLE_REQUIREMENTS } from "../gates/composition/render-real.mjs";
import { writePresetSource } from "../gates/composition/render-real.fixtures.mjs";

const LEGACY_PATCH = [
  "- insert:",
  "    - id: tui-runner",
  "      name: '/x/lib/index.ts'",
  "    - id: agent-presets",
  "      name: '@deepseek-ai/dsh-agent-presets'",
  "      config:",
  "        default: standard",
  "    - id: relay-client",
  "      name: '/x/src/client.ts'",
  "",
].join("\n");

const DEV_MANIFEST = {
  name: "dsh-profile-tui-dev",
  private: true,
  dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "dsh-antigravity-auth"] } },
  dependencies: { "dsh-antigravity-auth": "0.1.4-rc.1" },
};

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), "deploy-carrier-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repoRoot = join(root, "repo");
  const dshHome = join(root, "home", ".dsh");
  const presetSource = join(repoRoot, "presets", "minimal-plus");
  writePresetSource(presetSource, { name: "Fixture" });
  const artifactDir = join(repoRoot, "generated", "minimal-plus-preset");
  generatePresetBundle({ sourceDir: presetSource, outDir: artifactDir, packageName: BUNDLE_PACKAGE_NAME, sourceLabel: "presets/minimal-plus" });
  const devDir = join(dshHome, "profiles", "tui-dev");
  mkdirSync(devDir, { recursive: true });
  writeFileSync(join(devDir, "cordis.patch.yml"), LEGACY_PATCH);
  writeFileSync(join(devDir, "cordis.yml"), "[]\n");
  writeFileSync(join(devDir, "package.json"), `${JSON.stringify(DEV_MANIFEST, null, 2)}\n`);
  mkdirSync(join(devDir, "node_modules", "dsh-antigravity-auth"), { recursive: true });
  writeFileSync(join(devDir, "node_modules", "dsh-antigravity-auth", "index.js"), "// dep\n");
  return { root, repoRoot, dshHome, devDir, artifactDir };
}

const profileOf = (plan, kind) => plan.profiles.find((profile) => profile.kind === kind);

test("planPresetCarrier: dry-run 出计划且不写任何真实路径", (t) => {
  const { repoRoot, dshHome, devDir } = workspace(t);
  const patchBefore = readFileSync(join(devDir, "cordis.patch.yml"), "utf8");

  const plan = planPresetCarrier({ repoRoot, dshHome });
  assert.equal(plan.ok, true, JSON.stringify(plan.problems));
  assert.equal(plan.needsWrite, true, "absent bundle + missing tui-team must report needsWrite");
  const dev = profileOf(plan, "dev");
  assert.equal(dev.patch.legacyRowStrip, true);
  assert.ok(dev.patch.strippedText.includes("tui-runner"));
  assert.ok(!dev.patch.strippedText.includes("@deepseek-ai/dsh-agent-presets"));
  assert.deepEqual(dev.plannedBundles, ["@deepseek-ai/dsh-base", "dsh-antigravity-auth", BUNDLE_PACKAGE_NAME]);
  assert.equal(dev.bundleTarget.state, "absent");
  assert.equal(dev.bundleTarget.repoOk, true);

  const team = profileOf(plan, "team");
  assert.equal(team.exists, false);
  assert.deepEqual(team.plannedBundles, ["@deepseek-ai/dsh-base", "dsh-antigravity-auth", TEAM_BUNDLE, BUNDLE_PACKAGE_NAME]);

  assert.equal(readFileSync(join(devDir, "cordis.patch.yml"), "utf8"), patchBefore);
  assert.equal(existsSync(join(devDir, "preset-bundles")), false);
  assert.equal(existsSync(join(dshHome, "profiles", "tui-team")), false);
});

test("applyPresetCarrier: 摘旧行 + 装 bundle，并从 tui-dev 派生 tui-team", (t) => {
  const { repoRoot, dshHome, devDir, artifactDir } = workspace(t);
  const result = applyPresetCarrier(planPresetCarrier({ repoRoot, dshHome }), { timestamp: "20260925-120000" });

  assert.equal(result.backup, join(devDir, "cordis.patch.yml.bak-20260925-120000"));
  assert.equal(readFileSync(result.backup, "utf8"), LEGACY_PATCH, "backup keeps the pre-strip patch");
  const devPatch = readFileSync(join(devDir, "cordis.patch.yml"), "utf8");
  assert.ok(!devPatch.includes("@deepseek-ai/dsh-agent-presets"));
  assert.ok(devPatch.includes("tui-runner") && devPatch.includes("relay-client"));

  const devManifest = JSON.parse(readFileSync(join(devDir, "package.json"), "utf8"));
  assert.deepEqual(devManifest.dsh.profile.bundles, ["@deepseek-ai/dsh-base", "dsh-antigravity-auth", BUNDLE_PACKAGE_NAME]);
  for (const name of PRESET_BUNDLE_REQUIREMENTS) {
    assert.equal(
      readFileSync(join(devDir, "preset-bundles", "minimal-plus-preset", name), "utf8"),
      readFileSync(join(artifactDir, name), "utf8"),
      `${name} must be deployed byte-identical to the repo artifact`,
    );
  }
  assert.ok(existsSync(join(devDir, "node_modules", BUNDLE_PACKAGE_NAME, "cordis.patch.yml")));

  const teamDir = join(dshHome, "profiles", "tui-team");
  const teamManifest = JSON.parse(readFileSync(join(teamDir, "package.json"), "utf8"));
  assert.equal(teamManifest.name, "dsh-profile-tui-team");
  assert.deepEqual(teamManifest.dsh.profile.bundles, ["@deepseek-ai/dsh-base", "dsh-antigravity-auth", TEAM_BUNDLE, BUNDLE_PACKAGE_NAME]);
  assert.ok(!readFileSync(join(teamDir, "cordis.patch.yml"), "utf8").includes("@deepseek-ai/dsh-agent-presets"));
  assert.ok(existsSync(join(teamDir, "cordis.yml")));
  assert.ok(existsSync(join(teamDir, "node_modules", "dsh-antigravity-auth", "index.js")), "profile deps are copied");
  assert.equal(
    readFileSync(join(teamDir, "preset-bundles", "minimal-plus-preset", "cordis.patch.yml"), "utf8"),
    readFileSync(join(artifactDir, "cordis.patch.yml"), "utf8"),
  );
  assert.ok(existsSync(join(teamDir, "node_modules", BUNDLE_PACKAGE_NAME, "cordis.patch.yml")));
});

test("applyPresetCarrier: 已迁移后再 dry-run 报一致；tui-team 已存在时拒绝覆盖", (t) => {
  const { repoRoot, dshHome } = workspace(t);
  applyPresetCarrier(planPresetCarrier({ repoRoot, dshHome }), { timestamp: "20260925-120000" });

  const again = planPresetCarrier({ repoRoot, dshHome });
  assert.equal(again.ok, true, JSON.stringify(again.problems));
  assert.equal(again.needsWrite, false, "deployed+selected bundle and existing tui-team must report current");
  const dev = profileOf(again, "dev");
  assert.equal(dev.patch.legacyRowStrip, false);
  assert.equal(dev.bundleTarget.state, "match");
  assert.equal(dev.selection, true);
  const team = profileOf(again, "team");
  assert.equal(team.exists, true);
  assert.equal(team.bundleTarget.state, "match");
  assert.equal(team.selection, true);
  assert.deepEqual(team.bundles, ["@deepseek-ai/dsh-base", "dsh-antigravity-auth", TEAM_BUNDLE, BUNDLE_PACKAGE_NAME]);

  assert.throws(() => applyPresetCarrier(again), /already exists/u);
});

test("planPresetCarrier: 缺源 profile / 仓库产物漂移都判不 ok", (t) => {
  const { repoRoot, dshHome, devDir, artifactDir } = workspace(t);
  rmSync(devDir, { recursive: true, force: true });
  const missing = planPresetCarrier({ repoRoot, dshHome });
  assert.equal(missing.ok, false);
  assert.ok(missing.problems.some((problem) => problem.includes("tui-dev")));

  // 恢复源 profile，但改坏仓库产物 → repoOk=false
  mkdirSync(devDir, { recursive: true });
  writeFileSync(join(devDir, "cordis.patch.yml"), LEGACY_PATCH);
  writeFileSync(join(devDir, "package.json"), `${JSON.stringify(DEV_MANIFEST, null, 2)}\n`);
  writeFileSync(join(artifactDir, "cordis.patch.yml"), "# tampered\n");
  const drift = planPresetCarrier({ repoRoot, dshHome });
  assert.equal(drift.ok, false);
  assert.ok(drift.problems.some((problem) => problem.includes("artifact") || problem.includes("drift")));
});

test("CLI: 默认 dry-run exit 0 且只写 --json 报告；缺源 profile exit 1", (t) => {
  const { repoRoot, dshHome, devDir } = workspace(t);
  const out = [];
  const stdout = { write: (chunk) => out.push(chunk) };
  const reportPath = join(repoRoot, "plan.json");
  const env = { ...process.env, HOME: join(dshHome, ".."), DSH_HOME: dshHome };

  const code = runPresetCarrierCli(["--json", reportPath], { env, stdout, repoRoot });
  assert.equal(code, 0);
  assert.equal(existsSync(reportPath), true);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.mode, "dry-run");
  assert.equal(report.plan.ok, true);
  assert.equal(existsSync(join(devDir, "preset-bundles")), false);

  // --check：部署位缺席/滞后 → exit 1（release 预检口径）。
  assert.equal(runPresetCarrierCli(["--check"], { env, stdout, repoRoot }), 1);

  rmSync(devDir, { recursive: true, force: true });
  const failed = runPresetCarrierCli([], { env, stdout, repoRoot });
  assert.equal(failed, 1);
  assert.equal(runPresetCarrierCli(["--bogus"], { env, stdout, repoRoot }), 2);
});

test("CLI --check: 部署完成后 exit 0", (t) => {
  const { repoRoot, dshHome } = workspace(t);
  applyPresetCarrier(planPresetCarrier({ repoRoot, dshHome }), { timestamp: "20260925-120000" });
  const out = [];
  const code = runPresetCarrierCli(["--check"], { env: { ...process.env, DSH_HOME: dshHome }, stdout: { write: (chunk) => out.push(chunk) }, repoRoot });
  assert.equal(code, 0, out.join(""));
  assert.ok(out.join("").includes("deployment is current"));
});
