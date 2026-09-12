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

import { checkBaselines, checkDeployment, checkHostPin, readManifest, resolveDeploymentRoot } from "./manifest.mjs";

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
