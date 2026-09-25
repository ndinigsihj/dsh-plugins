/**
 * 真实组合运行期渲染的单测（票据 04；票据 07 补载体迁移面）：路径替换、插件名收集、
 * 根解析、旧目录 preset 行摘除，以及一次隔离的端到端渲染（假 home / 假 checkout，
 * 不碰真实 `~/.dsh`）。
 *
 * 真实 tui-dev profile 的端到端行为由 `scripts/regression-gate.sh --composition real`
 * 的实跑举证；这里钉住换 checkout / 换机器时最容易改坏的判定。
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LEGACY_PRESET_PACKAGE,
  PRESET_BUNDLE_REQUIREMENTS,
  RenderRealError,
  collectModuleNames,
  renderRealComposition,
  resolveRepoRoots,
  rewriteRepoRoots,
  stripLegacyPresetRow,
} from "./render-real.mjs";
import { writePresetSource, writeTree } from "./render-real.fixtures.mjs";
import { BUNDLE_PACKAGE_NAME, generatePresetBundle } from "../../scripts/agent-preset-bundle.mjs";

const REAL_PATCH = [
  "- insert:",
  "    - id: tui-startup",
  "      name: '/src/checkout/dsh-plugins/lib/startup.ts'",
  "    - id: relay-client",
  "      name: '/src/checkout/dsh-relay/src/client.ts'",
  "    - id: endless-tools",
  "      name: '/src/checkout/dsh-endless/src/tools.ts'",
  "    - id: agent-presets",
  `      name: '${LEGACY_PRESET_PACKAGE}'`,
  "      config:",
  "        default: standard",
  "",
].join("\n");

test("rewriteRepoRoots: 三类仓库根按 marker 替换，裸包名与无关绝对路径不动", () => {
  const roots = [
    { id: "plugins", marker: "dsh-plugins", env: "DSH_PLUGINS_ROOT", path: "/target/plugins" },
    { id: "relay", marker: "dsh-relay", env: "DSH_RELAY_ROOT", path: "/target/relay" },
    { id: "endless", marker: "dsh-endless", env: "DSH_ENDLESS_ROOT", path: "/target/endless" },
  ];
  const source = [
    "- insert:",
    "    - id: tui-startup",
    "      name: '/old/src/dsh-plugins/lib/startup.ts'",
    "    - id: relay-client",
    '      name: "/old/src/dsh-relay/src/client.ts"',
    "    - id: endless-tools",
    "      name: '/old/src/dsh-endless/src/tools.ts'",
    "    - id: official",
    "      name: '@deepseek-ai/dsh-tool-ask-user'",
    "# 注释里的 -dsh-plugins 子串与 ~/.dsh 路径不误伤",
    "",
  ].join("\n");
  const rendered = rewriteRepoRoots(source, roots);
  assert.ok(rendered.includes("name: '/target/plugins/lib/startup.ts'"));
  assert.ok(rendered.includes('name: "/target/relay/src/client.ts"'));
  assert.ok(rendered.includes("name: '/target/endless/src/tools.ts'"));
  assert.ok(rendered.includes("@deepseek-ai/dsh-tool-ask-user"));
  assert.ok(rendered.includes("-dsh-plugins 子串"));
  assert.ok(!rendered.includes("/old/src/"));
});

test("stripLegacyPresetRow: 摘掉旧目录 preset 行并保留后续条目", () => {
  const stripped = stripLegacyPresetRow(REAL_PATCH);
  assert.ok(!stripped.includes(LEGACY_PRESET_PACKAGE));
  assert.ok(!/id:\s*agent-presets/u.test(stripped));
  assert.ok(stripped.includes("id: tui-startup"));
  assert.ok(stripped.includes("id: endless-tools"));
  assert.equal(stripLegacyPresetRow("- insert:\n    - id: a\n      name: '@x'\n"), "- insert:\n    - id: a\n      name: '@x'\n");
});

test("collectModuleNames: 只收带 id 的条目名，config 里的同名键不算", () => {
  const names = collectModuleNames([
    { insert: [{ id: "a", name: "./a.mjs" }, { id: "b", name: "@scope/pkg" }] },
    { id: "c", name: "@scope/other", config: { name: "not-a-module" } },
  ]);
  assert.deepEqual(names, ["./a.mjs", "@scope/pkg", "@scope/other"]);
});

test("resolveRepoRoots: 默认本 checkout + 相邻 checkout，env 覆盖优先", () => {
  const roots = resolveRepoRoots("/dev/work/dsh-plugins", { DSH_RELAY_ROOT: "/opt/relay" });
  const byId = Object.fromEntries(roots.map((root) => [root.id, root.path]));
  assert.deepEqual(byId, { plugins: "/dev/work/dsh-plugins", relay: "/opt/relay", endless: "/dev/work/dsh-endless" });
});

test("renderRealComposition: 渲染到临时 home、源只读、preset 取自部署位真源并生成 bundle", () => {
  const root = mkdtempSync(join(tmpdir(), "render-real-"));
  try {
    const fakeHome = join(root, "home");
    const sourceDir = join(fakeHome, ".dsh", "profiles", "tui-dev");
    writeTree(fakeHome, {
      ".dsh/profiles/tui-dev/cordis.patch.yml": REAL_PATCH,
      ".dsh/profiles/tui-dev/package.json": '{"name":"dsh-profile-tui-dev","private":true}\n',
      ".dsh/profiles/tui-dev/cordis.yml": "[]\n",
      ".dsh/settings.yaml": "agent-presets:\n  default: minimal-plus\n",
    });
    const checkouts = {
      plugins: join(root, "work/plugins"),
      relay: join(root, "work/relay"),
      endless: join(root, "work/endless"),
    };
    writeTree(checkouts.plugins, { "lib/startup.ts": "// plugins\n" });
    writeTree(checkouts.relay, { "src/client.ts": "// relay\n" });
    writeTree(checkouts.endless, { "src/tools.ts": "// endless\n" });
    const deploymentRoot = join(root, "deployed/minimal-plus-preset");
    const presetSource = join(root, "preset-src/minimal-plus");
    writePresetSource(presetSource, { name: "Fixture" });
    generatePresetBundle({ sourceDir: presetSource, outDir: deploymentRoot, packageName: BUNDLE_PACKAGE_NAME, sourceLabel: "fixture" });
    const repoRoot = join(root, "repo");
    writeTree(repoRoot, { "presets/unused/preset.yml": "name: unused\n" });

    const tempHome = join(root, "temp-home");
    mkdirSync(tempHome, { recursive: true });
    const result = renderRealComposition({
      repoRoot,
      tempHome,
      presetName: "minimal-plus",
      deploymentRoot,
      installAnchor: import.meta.url,
      env: { DSH_PLUGINS_ROOT: checkouts.plugins, DSH_RELAY_ROOT: checkouts.relay, DSH_ENDLESS_ROOT: checkouts.endless },
      homeDir: fakeHome,
    });

    const rendered = readFileSync(result.renderedPath, "utf8");
    assert.ok(rendered.includes(`${checkouts.plugins}/lib/startup.ts`));
    assert.ok(rendered.includes(`${checkouts.relay}/src/client.ts`));
    assert.ok(rendered.includes(`${checkouts.endless}/src/tools.ts`));
    assert.ok(!rendered.includes("/src/checkout/"));
    assert.ok(!rendered.includes(LEGACY_PRESET_PACKAGE), "legacy preset service must be stripped from the rendered copy");
    assert.equal(readFileSync(join(sourceDir, "cordis.patch.yml"), "utf8"), REAL_PATCH, "source profile must stay read-only");
    assert.notEqual(result.sourceSha, result.renderedSha);
    assert.equal(result.renderedPath, join(tempHome, "profiles/tui-dev/cordis.patch.yml"));
    assert.equal(result.preset.source, "deployed");
    assert.equal(result.preset.root, join(root, "deployed"));
    assert.equal(result.preset.legacyRowStripped, true);
    assert.equal(result.preset.deployedFallback, undefined);

    // 部署位 bundle 逐字节装进渲染 profile（不现场再生）：声明行 + package 子路径 +
    // bundles 选择 + node_modules 链接。
    const generated = readFileSync(join(result.preset.bundleDir, "cordis.patch.yml"), "utf8");
    assert.equal(generated, readFileSync(join(deploymentRoot, "cordis.patch.yml"), "utf8"), "staged bundle must be the deployed artifact");
    assert.ok(generated.includes(`${BUNDLE_PACKAGE_NAME}/tool-bootstrap.mjs`));
    const profileManifest = JSON.parse(readFileSync(join(result.profileDir, "package.json"), "utf8"));
    assert.ok(profileManifest.dsh.profile.bundles.includes(BUNDLE_PACKAGE_NAME));
    assert.ok(existsSync(join(result.profileDir, "node_modules", BUNDLE_PACKAGE_NAME, "cordis.patch.yml")));
    assert.equal(result.settings.copied, true);
    assert.deepEqual(Object.fromEntries(result.roots.map((entry) => [entry.id, entry.path])), checkouts);
    assert.ok(readFileSync(join(result.profileDir, "cordis.yml"), "utf8").includes("[]"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderRealComposition: 部署位缺席时回落仓库 preset 真源并标注 source=repo", () => {
  const root = mkdtempSync(join(tmpdir(), "render-real-repo-"));
  try {
    const fakeHome = join(root, "home");
    writeTree(fakeHome, {
      ".dsh/profiles/tui-dev/cordis.patch.yml": "- insert:\n    - id: endless-tools\n      name: '/src/checkout/dsh-endless/src/tools.ts'\n",
      ".dsh/profiles/tui-dev/package.json": "{}\n",
    });
    const checkout = join(root, "checkout/dsh-endless");
    writeTree(checkout, { "src/tools.ts": "// endless\n" });
    const repoRoot = join(root, "repo");
    writePresetSource(join(repoRoot, "presets", "minimal-plus"), { name: "Fixture" });
    const tempHome = join(root, "temp-home");
    mkdirSync(tempHome, { recursive: true });

    const result = renderRealComposition({
      repoRoot,
      tempHome,
      presetName: "minimal-plus",
      deploymentRoot: join(root, "no-such-deployment"),
      installAnchor: import.meta.url,
      env: { DSH_PLUGINS_ROOT: checkout, DSH_RELAY_ROOT: checkout, DSH_ENDLESS_ROOT: checkout },
      homeDir: fakeHome,
    });
    assert.equal(result.preset.source, "repo");
    assert.equal(result.preset.root, join(repoRoot, "presets"));
    assert.ok(existsSync(join(result.preset.bundleDir, "cordis.patch.yml")));
    assert.equal(result.preset.legacyRowStripped, false);
    assert.deepEqual(result.preset.deployedFallback, { path: join(root, "no-such-deployment"), missing: PRESET_BUNDLE_REQUIREMENTS });
    assert.equal(result.settings.copied, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderRealComposition: 部署位 bundle 不完整时回落仓库真源并记录缺件", () => {
  const root = mkdtempSync(join(tmpdir(), "render-real-partial-"));
  try {
    const fakeHome = join(root, "home");
    writeTree(fakeHome, {
      ".dsh/profiles/tui-dev/cordis.patch.yml": "- insert:\n    - id: endless-tools\n      name: '/src/checkout/dsh-endless/src/tools.ts'\n",
      ".dsh/profiles/tui-dev/package.json": "{}\n",
    });
    const checkout = join(root, "checkout/dsh-endless");
    writeTree(checkout, { "src/tools.ts": "// endless\n" });
    const repoRoot = join(root, "repo");
    writePresetSource(join(repoRoot, "presets", "minimal-plus"), { name: "Fixture" });
    const deploymentRoot = join(root, "deployed/minimal-plus-preset");
    writeTree(deploymentRoot, { "package.json": "{}\n" });
    const tempHome = join(root, "temp-home");
    mkdirSync(tempHome, { recursive: true });

    const result = renderRealComposition({
      repoRoot,
      tempHome,
      presetName: "minimal-plus",
      deploymentRoot,
      installAnchor: import.meta.url,
      env: { DSH_PLUGINS_ROOT: checkout, DSH_RELAY_ROOT: checkout, DSH_ENDLESS_ROOT: checkout },
      homeDir: fakeHome,
    });
    assert.equal(result.preset.source, "repo");
    assert.equal(result.preset.deployedFallback.path, deploymentRoot);
    assert.ok(result.preset.deployedFallback.missing.includes("plugin-teardown.mjs"));
    assert.ok(result.preset.deployedFallback.missing.includes("cordis.patch.yml"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderRealComposition: 缺源 profile / 缺 checkout / 插件路径不可解析都是 RenderRealError", () => {
  const root = mkdtempSync(join(tmpdir(), "render-real-neg-"));
  try {
    const tempHome = join(root, "temp-home");
    mkdirSync(tempHome, { recursive: true });
    const fakeHome = join(root, "home");
    const env = {
      DSH_PLUGINS_ROOT: join(root, "plugins"),
      DSH_RELAY_ROOT: join(root, "relay"),
      DSH_ENDLESS_ROOT: join(root, "endless"),
    };
    writeTree(join(root, "plugins"), { "lib/startup.ts": "// plugins\n" });
    writeTree(join(root, "relay"), { "src/client.ts": "// relay\n" });
    writeTree(join(root, "endless"), { "src/tools.ts": "// endless\n" });
    const common = { repoRoot: join(root, "repo"), tempHome, presetName: "unused", installAnchor: import.meta.url, env, homeDir: fakeHome };

    assert.throws(() => renderRealComposition(common), (error) => error instanceof RenderRealError && error.message.includes("source profile not found"));

    writeTree(fakeHome, {
      ".dsh/profiles/tui-dev/cordis.patch.yml": "- insert:\n    - id: relay\n      name: '/src/checkout/dsh-relay/src/client.ts'\n",
      ".dsh/profiles/tui-dev/package.json": "{}\n",
    });
    assert.throws(
      () => renderRealComposition({ ...common, env: { ...env, DSH_RELAY_ROOT: join(root, "missing-relay") } }),
      (error) => error instanceof RenderRealError && error.message.includes("missing repo checkout"),
    );

    mkdirSync(join(root, "empty-relay"), { recursive: true });
    assert.throws(
      () => renderRealComposition({ ...common, env: { ...env, DSH_RELAY_ROOT: join(root, "empty-relay") } }),
      (error) => error instanceof RenderRealError && error.message.includes("unresolvable dependencies"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
