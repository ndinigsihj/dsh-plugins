/**
 * Preset 0.1.7 载体生成器的单测（票据 07）。
 *
 * 钉住四件事：
 *   1. 真源 → 声明 patch 的搬运（注释与 !!js 保留、相对名改写、自研行与委派行在列）；
 *   2. 生成 bundle 的逐文件内容与可复现性；
 *   3. 仓库内生成产物与真源逐文件一致（漂移即红）；
 *   4. stagePresetBundle 的 profile 侧落位（bundles 选择 + node_modules 链接）。
 */
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { loadOverlayPatches } from "@deepseek-ai/dsh-app-boot";
import {
  BUNDLE_OUT_DIR,
  BUNDLE_PACKAGE_NAME,
  BUNDLE_PLUGIN_FILES,
  BUNDLE_SOURCE_DIR,
  checkPresetBundle,
  generatePresetBundle,
  readPresetMeta,
  renderPresetPatch,
  rewritePluginName,
  sha256File,
  stagePresetBundle,
} from "./agent-preset-bundle.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_DIR = join(REPO_ROOT, BUNDLE_SOURCE_DIR);
const BUNDLE_DIR = join(REPO_ROOT, BUNDLE_OUT_DIR);

/** 临时目录助手；回调结束时删除。 */
function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "preset-bundle-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("rewritePluginName: 只有 ./ 相对名改成 bundle 包子路径", () => {
  assert.equal(rewritePluginName("./tool-bootstrap.mjs"), `${BUNDLE_PACKAGE_NAME}/tool-bootstrap.mjs`);
  assert.equal(rewritePluginName("@deepseek-ai/dsh-persona"), "@deepseek-ai/dsh-persona");
  assert.equal(rewritePluginName("cordis:group"), "cordis:group");
  assert.throws(() => rewritePluginName("../outside.mjs"), /escapes the preset directory/u);
});

test("renderPresetPatch: 元数据、自研行、委派行与 !!js 都按 0.1.7 声明形态搬运", () => {
  const meta = readPresetMeta(SOURCE_DIR);
  const entryListText = readFileSync(join(SOURCE_DIR, "agent.cordis.yml"), "utf8");
  const text = renderPresetPatch({ meta, entryListText });
  assert.match(text, /- id: preset-minimal-plus/u);
  assert.match(text, /name: '@deepseek-ai\/dsh-agent-preset'/u);
  for (const id of ["tool-bootstrap", "phase-swap-bash", "instruction-hint", "skill-search", "custom-bash", "delegation"]) {
    assert.match(text, new RegExp(`^\\s+- id: ${id}$`, "mu"), `missing row ${id}`);
  }
  assert.match(text, new RegExp(`${BUNDLE_PACKAGE_NAME}/tool-bootstrap\\.mjs`, "u"));
  assert.ok(!/name: '\.\//u.test(text), "relative plugin names must be rewritten");
  // 含 !!js 的配置行按原文 + 10 空格缩进搬运（不做语义解析）。
  for (const line of entryListText.split("\n").filter((candidate) => candidate.includes("includeSubagents") || candidate.includes("!!js"))) {
    assert.ok(text.includes(`          ${line}`), `config line must move verbatim: ${line}`);
  }

  withTemp((dir) => {
    const patchPath = join(dir, "cordis.patch.yml");
    writeFileSync(patchPath, text);
    // 生成文本必须是宿主能解析的 patch list（含 !!js 方言）。
    const patches = loadOverlayPatches("test", patchPath);
    const preset = patches[0].insert.find((row) => row.id === "preset-minimal-plus");
    assert.equal(preset.config.id, "minimal-plus");
    assert.equal(preset.config.name, meta.name);
    assert.equal(preset.config.description, meta.description);
    assert.equal(preset.config.order, meta.order);
    const rowIds = preset.config.plugins.map((row) => row.id);
    for (const id of ["tool-bootstrap", "phase-swap-bash", "instruction-hint", "skill-search", "custom-bash", "delegation"]) {
      assert.ok(rowIds.includes(id), `plugins list must include ${id}`);
    }
    const delegation = preset.config.plugins.find((row) => row.id === "delegation");
    assert.equal(delegation.config.find((row) => row.id === "tool-subagent").config.modelSelectionSettings, true);
    const bootstrap = preset.config.plugins.find((row) => row.id === "tool-bootstrap");
    assert.deepEqual(bootstrap.config.bootstrapTools, ["bash", "str_replace_editor"]);
    assert.equal(bootstrap.config.promoteOn, "tool-call");
  });
});

test("generatePresetBundle: 插件文件逐字节复制，生成文件可复现", () => {
  withTemp((dir) => {
    const first = join(dir, "a");
    const second = join(dir, "b");
    const options = { sourceDir: SOURCE_DIR, packageName: BUNDLE_PACKAGE_NAME, sourceLabel: BUNDLE_SOURCE_DIR };
    const a = generatePresetBundle({ ...options, outDir: first });
    const b = generatePresetBundle({ ...options, outDir: second });
    assert.deepEqual(
      a.files.map((file) => [file.path, file.sha256]),
      b.files.map((file) => [file.path, file.sha256]),
    );
    for (const name of BUNDLE_PLUGIN_FILES) {
      assert.equal(sha256File(join(first, name)), sha256File(join(SOURCE_DIR, name)), `${name} must be copied byte-identically`);
    }
    const manifest = JSON.parse(readFileSync(join(first, "source-manifest.json"), "utf8"));
    assert.equal(manifest.sourceDir, BUNDLE_SOURCE_DIR);
    assert.equal(manifest.sourceFiles["agent.cordis.yml"], sha256File(join(SOURCE_DIR, "agent.cordis.yml")));
    assert.equal(manifest.sourceFiles["preset.yml"], sha256File(join(SOURCE_DIR, "preset.yml")));
    assert.equal(new Set(a.files.map((file) => file.path)).size, a.files.length);
  });
});

test("仓库生成产物与真源逐文件一致（漂移即红）", () => {
  const result = checkPresetBundle({ sourceDir: SOURCE_DIR, bundleDir: BUNDLE_DIR, sourceLabel: BUNDLE_SOURCE_DIR, tempDir: tmpdir() });
  assert.ok(result.ok, `generated artifact drift: ${JSON.stringify(result.comparison.files.filter((file) => file.status !== "match"))}`);
  assert.ok(result.comparison.files.length >= BUNDLE_PLUGIN_FILES.length + 3);
});

test("生成器 CLI --check 与文档命令一致（exit 0，逐文件 ok）", () => {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "agent-preset-bundle-cli.mjs"), "--check"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /10 files match generated\/minimal-plus-preset/u);
  assert.ok(!result.stdout.includes("DRIFT"), result.stdout);
});

test("stagePresetBundle: node_modules 是符号链接时物化成真目录，不向链接目标写入", () => {
  withTemp((dir) => {
    const realNodeModules = join(dir, "real-profile", "node_modules");
    mkdirSync(join(realNodeModules, "dsh-antigravity-auth"), { recursive: true });
    writeFileSync(join(realNodeModules, "dsh-antigravity-auth", "package.json"), "{}\n");
    const profileDir = join(dir, "profiles", "tui-dev");
    mkdirSync(profileDir, { recursive: true });
    symlinkSync(realNodeModules, join(profileDir, "node_modules"), "dir");

    stagePresetBundle({ sourceDir: SOURCE_DIR, profileDir, sourceLabel: BUNDLE_SOURCE_DIR });

    const nodeModules = join(profileDir, "node_modules");
    assert.ok(!lstatSync(nodeModules).isSymbolicLink(), "symlink must be materialized into a real directory");
    assert.ok(existsSync(join(nodeModules, "dsh-antigravity-auth", "package.json")), "existing entries stay linked");
    assert.ok(existsSync(join(nodeModules, BUNDLE_PACKAGE_NAME, "cordis.patch.yml")));
    assert.ok(!existsSync(join(realNodeModules, "@dsh-plugins")), "the link target must not be written");
  });
});

test("stagePresetBundle: profile 选择 bundle 并落好 node_modules 链接", () => {
  withTemp((dir) => {
    const profileDir = join(dir, "profiles", "headless");
    const staged = stagePresetBundle({ sourceDir: SOURCE_DIR, profileDir, sourceLabel: BUNDLE_SOURCE_DIR });
    const manifest = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"));
    assert.ok(manifest.dsh.profile.bundles.includes(BUNDLE_PACKAGE_NAME));
    assert.equal(sha256File(join(staged.linkPath, "cordis.patch.yml")), sha256File(join(staged.bundleDir, "cordis.patch.yml")));
    // 幂等：再 stage 一次不重复 bundles 条目。
    stagePresetBundle({ sourceDir: SOURCE_DIR, profileDir, sourceLabel: BUNDLE_SOURCE_DIR });
    const again = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"));
    assert.equal(again.dsh.profile.bundles.filter((name) => name === BUNDLE_PACKAGE_NAME).length, 1);
  });
});
