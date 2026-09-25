/**
 * `gates/manifest.mjs` 的三态单测（票 02）：相符 / 不符 / 缺失。
 *
 * 用临时目录伪造「仓库 + 家目录部署位」，覆盖清单本身的 missing/invalid/ok、
 * 部署位逐文件 ok/stale/absent、宿主钉版 ok/mismatch、基线 ok/stale/absent；
 * 最后一条对**真实清单**跑仓库侧比对，防止 preset/基线文件改了而清单没更新。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkBaselines, checkDeployment, checkHostPin, readManifest, resolveDeploymentRoot, resolveDeploymentTargets } from "./manifest.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEPLOYED_TEXT = "plugins: []\n";
const BASELINE_TEXT = "# m4 baseline\nrun\n";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function demoManifest() {
  return {
    gateVersion: 1,
    hostVersion: "0.1.5-rc.1",
    sessionFormatVersion: 3,
    deployment: {
      demo: { path: "~/.dsh/.agent-presets/demo", files: { "agent.cordis.yml": sha256(DEPLOYED_TEXT) } },
    },
    baselines: {
      "m4-demo-2026-09-10": {
        path: "experiments/m4/base.jsonl",
        sha256: sha256(BASELINE_TEXT),
        hostVersion: "0.1.5-rc.1",
        runs: 9,
      },
    },
  };
}

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), "dsh-manifest-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repoRoot = join(root, "repo");
  const homeDir = join(root, "home");
  mkdirSync(join(repoRoot, "presets", "demo"), { recursive: true });
  mkdirSync(join(repoRoot, "experiments", "m4"), { recursive: true });
  mkdirSync(join(homeDir, ".dsh", ".agent-presets", "demo"), { recursive: true });
  return { root, repoRoot, homeDir };
}

const repoFile = (repoRoot) => join(repoRoot, "presets", "demo", "agent.cordis.yml");
const deployedFile = (homeDir) => join(homeDir, ".dsh", ".agent-presets", "demo", "agent.cordis.yml");
const baselineFile = (repoRoot) => join(repoRoot, "experiments", "m4", "base.jsonl");

test("清单文件缺失 → missing", (t) => {
  const { root } = workspace(t);
  assert.deepEqual(readManifest(join(root, "absent.json")), { status: "missing", path: join(root, "absent.json") });
});

test("清单不是合法 JSON → invalid", (t) => {
  const { root } = workspace(t);
  const path = join(root, "manifest.json");
  writeFileSync(path, "{ not json\n");
  const result = readManifest(path);
  assert.equal(result.status, "invalid");
  assert.equal(typeof result.error, "string");
});

test("清单结构缺字段或 sha 非法 → invalid", (t) => {
  const { root } = workspace(t);
  const path = join(root, "manifest.json");
  const broken = demoManifest();
  broken.deployment.demo.files["agent.cordis.yml"] = "not-a-sha";
  writeFileSync(path, JSON.stringify(broken));
  assert.equal(readManifest(path).status, "invalid");
  const missingHost = demoManifest();
  delete missingHost.hostVersion;
  writeFileSync(path, JSON.stringify(missingHost));
  assert.equal(readManifest(path).status, "invalid");
});

test("清单 t3 段（可选）：引用不存在基线或 tolerance 非法 → invalid；合法或缺省 → ok", (t) => {
  const { root } = workspace(t);
  const path = join(root, "manifest.json");
  const noT3 = demoManifest();
  writeFileSync(path, JSON.stringify(noT3));
  assert.equal(readManifest(path).status, "ok", "旧清单没有 t3 段仍应可读");

  const unknownBaseline = demoManifest();
  unknownBaseline.t3 = { baseline: "nope", tolerance: 1 };
  writeFileSync(path, JSON.stringify(unknownBaseline));
  assert.equal(readManifest(path).status, "invalid");

  const badTolerance = demoManifest();
  badTolerance.t3 = { baseline: "m4-demo-2026-09-10", tolerance: -1 };
  writeFileSync(path, JSON.stringify(badTolerance));
  assert.equal(readManifest(path).status, "invalid");

  const ok = demoManifest();
  ok.t3 = { baseline: "m4-demo-2026-09-10", tolerance: 1 };
  writeFileSync(path, JSON.stringify(ok));
  assert.equal(readManifest(path).status, "ok");
});

test("清单可读 → ok 且返回对象", (t) => {
  const { root } = workspace(t);
  const path = join(root, "manifest.json");
  writeFileSync(path, JSON.stringify(demoManifest()));
  const result = readManifest(path);
  assert.equal(result.status, "ok");
  assert.equal(result.manifest.gateVersion, 1);
  assert.equal(result.manifest.hostVersion, "0.1.5-rc.1");
});

test("部署位相符 → 逐文件 ok，仓库侧命中", (t) => {
  const { repoRoot, homeDir } = workspace(t);
  writeFileSync(repoFile(repoRoot), DEPLOYED_TEXT);
  writeFileSync(deployedFile(homeDir), DEPLOYED_TEXT);
  const result = checkDeployment(demoManifest(), { repoRoot, homeDir });
  assert.equal(result.status, "ok");
  assert.equal(result.files[0].state, "ok");
  assert.equal(result.files[0].repoMatches, true);
  assert.equal(resolveDeploymentRoot(demoManifest().deployment.demo, homeDir), join(homeDir, ".dsh", ".agent-presets", "demo"));
});

test("部署位文件不同 → stale（不符）", (t) => {
  const { repoRoot, homeDir } = workspace(t);
  writeFileSync(repoFile(repoRoot), DEPLOYED_TEXT);
  writeFileSync(deployedFile(homeDir), "plugins: [tampered]\n");
  const result = checkDeployment(demoManifest(), { repoRoot, homeDir });
  assert.equal(result.status, "stale");
  assert.equal(result.files[0].state, "stale");
  assert.equal(result.files[0].repoMatches, true);
});

test("仓库侧漂移 → deployed 仍 ok 但 repoMatches=false", (t) => {
  const { repoRoot, homeDir } = workspace(t);
  writeFileSync(repoFile(repoRoot), "plugins: [new]\n");
  writeFileSync(deployedFile(homeDir), DEPLOYED_TEXT);
  const result = checkDeployment(demoManifest(), { repoRoot, homeDir });
  assert.equal(result.status, "ok");
  assert.equal(result.files[0].repoMatches, false);
  assert.equal(result.files[0].state, "ok");
});

test("部署位文件缺失或目录整体缺失 → absent", (t) => {
  const { repoRoot, homeDir } = workspace(t);
  writeFileSync(repoFile(repoRoot), DEPLOYED_TEXT);
  const fileMissing = checkDeployment(demoManifest(), { repoRoot, homeDir });
  assert.equal(fileMissing.status, "absent");
  assert.equal(fileMissing.files[0].state, "absent");
  rmSync(join(homeDir, ".dsh", ".agent-presets"), { recursive: true, force: true });
  const dirMissing = checkDeployment(demoManifest(), { repoRoot, homeDir });
  assert.equal(dirMissing.status, "absent");
  assert.equal(dirMissing.files[0].deployed, undefined);
});

test("repoPath：仓库侧比对改读生成产物目录（0.1.7 载体）", (t) => {
  const { repoRoot, homeDir } = workspace(t);
  const artifactDir = join(repoRoot, "generated", "demo-preset");
  const targetDir = join(homeDir, ".dsh", "profiles", "demo", "preset-bundles", "demo-preset");
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(artifactDir, "cordis.patch.yml"), DEPLOYED_TEXT);
  writeFileSync(join(targetDir, "cordis.patch.yml"), DEPLOYED_TEXT);
  const manifest = demoManifest();
  manifest.deployment.demo = {
    repoPath: "generated/demo-preset",
    path: "~/.dsh/profiles/demo/preset-bundles/demo-preset",
    files: { "cordis.patch.yml": sha256(DEPLOYED_TEXT) },
  };
  const result = checkDeployment(manifest, { repoRoot, homeDir });
  assert.equal(result.status, "ok");
  assert.equal(result.files[0].repoMatches, true, "repo side comes from repoPath, not presets/<key>");
  assert.equal(result.files[0].state, "ok");
});

test("多目标：逐目标判态、聚合取最严重，resolveDeploymentRoot 取首个", (t) => {
  const { repoRoot, homeDir } = workspace(t);
  writeFileSync(repoFile(repoRoot), DEPLOYED_TEXT);
  const first = join(homeDir, "targets", "one");
  const second = join(homeDir, "targets", "two");
  mkdirSync(first, { recursive: true });
  mkdirSync(second, { recursive: true });
  writeFileSync(join(first, "agent.cordis.yml"), DEPLOYED_TEXT);
  writeFileSync(join(second, "agent.cordis.yml"), "plugins: [tampered]\n");
  const manifest = demoManifest();
  manifest.deployment.demo = { targets: [first, second], files: { "agent.cordis.yml": sha256(DEPLOYED_TEXT) } };

  assert.deepEqual(resolveDeploymentTargets(manifest.deployment.demo, homeDir), [first, second]);
  assert.equal(resolveDeploymentRoot(manifest.deployment.demo, homeDir), first, "staging anchor stays the first target");

  const stale = checkDeployment(manifest, { repoRoot, homeDir });
  assert.equal(stale.status, "stale");
  assert.deepEqual(
    stale.files[0].targets.map((target) => [target.path, target.state]),
    [
      [first, "ok"],
      [second, "stale"],
    ],
  );
  assert.equal(stale.files[0].state, "stale", "file state aggregates the worst target");

  const missing = demoManifest();
  missing.deployment.demo = { targets: [first, join(homeDir, "targets", "absent")], files: { "agent.cordis.yml": sha256(DEPLOYED_TEXT) } };
  assert.equal(checkDeployment(missing, { repoRoot, homeDir }).status, "absent");
});

test("清单 deployment 形状：targets 非空字符串数组、repoPath 为字符串、path/targets 至少一个", (t) => {
  const { root } = workspace(t);
  const path = join(root, "manifest.json");
  const noAnchor = demoManifest();
  delete noAnchor.deployment.demo.path;
  writeFileSync(path, JSON.stringify(noAnchor));
  assert.equal(readManifest(path).status, "invalid");

  const emptyTargets = demoManifest();
  emptyTargets.deployment.demo = { targets: [], files: { "agent.cordis.yml": sha256(DEPLOYED_TEXT) } };
  writeFileSync(path, JSON.stringify(emptyTargets));
  assert.equal(readManifest(path).status, "invalid");

  const nonStringTarget = demoManifest();
  nonStringTarget.deployment.demo = { targets: [7], files: { "agent.cordis.yml": sha256(DEPLOYED_TEXT) } };
  writeFileSync(path, JSON.stringify(nonStringTarget));
  assert.equal(readManifest(path).status, "invalid");

  const badRepoPath = demoManifest();
  badRepoPath.deployment.demo.repoPath = 7;
  writeFileSync(path, JSON.stringify(badRepoPath));
  assert.equal(readManifest(path).status, "invalid");

  const okTargets = demoManifest();
  okTargets.deployment.demo = { targets: ["~/a", "~/b"], files: { "agent.cordis.yml": sha256(DEPLOYED_TEXT) } };
  writeFileSync(path, JSON.stringify(okTargets));
  assert.equal(readManifest(path).status, "ok");
});


test("宿主钉版：相符 → ok，任一字段不符 → mismatch", () => {
  const manifest = demoManifest();
  assert.equal(checkHostPin(manifest, { hostVersion: "0.1.5-rc.1", sessionFormatVersion: 3 }).status, "ok");
  const mismatch = checkHostPin(manifest, { hostVersion: "0.1.6", sessionFormatVersion: 3 });
  assert.equal(mismatch.status, "mismatch");
  assert.deepEqual(
    mismatch.checks.map((check) => [check.id, check.status]),
    [["hostVersion", "mismatch"], ["sessionFormatVersion", "ok"]],
  );
});

test("基线文件：相符 ok / 内容变化 stale / 缺失 absent", (t) => {
  const { repoRoot } = workspace(t);
  writeFileSync(baselineFile(repoRoot), BASELINE_TEXT);
  assert.equal(checkBaselines(demoManifest(), { repoRoot }).status, "ok");
  writeFileSync(baselineFile(repoRoot), `${BASELINE_TEXT}extra\n`);
  const stale = checkBaselines(demoManifest(), { repoRoot });
  assert.equal(stale.status, "stale");
  assert.equal(stale.baselines[0].state, "stale");
  rmSync(baselineFile(repoRoot));
  const absent = checkBaselines(demoManifest(), { repoRoot });
  assert.equal(absent.status, "absent");
  assert.equal(absent.baselines[0].state, "absent");
});

test("真实清单：仓库侧生产文件与基线全部与记录一致", () => {
  const loaded = readManifest();
  assert.equal(loaded.status, "ok");
  const deployment = checkDeployment(loaded.manifest, { repoRoot: REPO_ROOT, homeDir: join(REPO_ROOT, ".no-such-home") });
  assert.deepEqual(deployment.files.filter((file) => file.repoMatches !== true), []);
  const baselines = checkBaselines(loaded.manifest, { repoRoot: REPO_ROOT });
  assert.deepEqual(baselines.baselines.filter((baseline) => baseline.state !== "ok"), []);
});
