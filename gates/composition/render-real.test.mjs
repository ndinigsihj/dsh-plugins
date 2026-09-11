/**
 * 真实组合运行期渲染的单测（票据 04）：路径替换、插件名收集、根解析，
 * 以及一次隔离的端到端渲染（假 home / 假 checkout，不碰真实 `~/.dsh`）。
 *
 * 真实 tui-dev profile 的端到端行为由 `scripts/regression-gate.sh --composition real`
 * 的实跑举证；这里钉住换 checkout / 换机器时最容易改坏的判定。
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { RenderRealError, collectModuleNames, renderRealComposition, resolveRepoRoots, rewriteRepoRoots } from "./render-real.mjs";

function writeTree(root, files) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
}

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

test("renderRealComposition: 渲染到临时 home、源只读、preset 取自部署位副本", () => {
  const root = mkdtempSync(join(tmpdir(), "render-real-"));
  try {
    const fakeHome = join(root, "home");
    const sourceDir = join(fakeHome, ".dsh", "profiles", "tui-dev");
    const sourceText = [
      "- insert:",
      "    - id: tui-startup",
      "      name: '/src/checkout/dsh-plugins/lib/startup.ts'",
      "    - id: relay-client",
      "      name: '/src/checkout/dsh-relay/src/client.ts'",
      "    - id: endless-tools",
      "      name: '/src/checkout/dsh-endless/src/tools.ts'",
      "",
    ].join("\n");
    writeTree(fakeHome, {
      ".dsh/profiles/tui-dev/cordis.patch.yml": sourceText,
      ".dsh/profiles/tui-dev/package.json": '{"name":"dsh-profile-tui-dev","private":true}\n',
      ".dsh/profiles/tui-dev/cordis.yml": "[]\n",
      ".dsh/settings.yaml": "agent-presets:\n  default: minimal-plus-next\n",
    });
    const checkouts = {
      plugins: join(root, "work/plugins"),
      relay: join(root, "work/relay"),
      endless: join(root, "work/endless"),
    };
    writeTree(checkouts.plugins, { "lib/startup.ts": "// plugins\n" });
    writeTree(checkouts.relay, { "src/client.ts": "// relay\n" });
    writeTree(checkouts.endless, { "src/tools.ts": "// endless\n" });
    const deploymentRoot = join(root, "deployed/minimal-plus-next");
    writeTree(deploymentRoot, { "preset.yml": "name: fixture\n", "agent.cordis.yml": "[]\n" });
    const repoRoot = join(root, "repo");
    writeTree(repoRoot, { "presets/unused/preset.yml": "name: unused\n" });

    const tempHome = join(root, "temp-home");
    mkdirSync(tempHome, { recursive: true });
    const result = renderRealComposition({
      repoRoot,
      tempHome,
      presetName: "minimal-plus-next",
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
    assert.equal(readFileSync(join(sourceDir, "cordis.patch.yml"), "utf8"), sourceText);
    assert.notEqual(result.sourceSha, result.renderedSha);
    assert.equal(result.renderedPath, join(tempHome, "profiles/tui-dev/cordis.patch.yml"));
    assert.equal(result.preset.source, "deployed");
    assert.ok(readFileSync(join(result.preset.stagedPath, "preset.yml"), "utf8").includes("fixture"));
    assert.equal(result.settings.copied, true);
    assert.deepEqual(Object.fromEntries(result.roots.map((entry) => [entry.id, entry.path])), checkouts);
    assert.ok(readFileSync(join(result.profileDir, "cordis.yml"), "utf8").includes("[]"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderRealComposition: 部署位缺席时回落仓库 preset 副本并标注 source=repo", () => {
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
    writeTree(repoRoot, { "presets/minimal-plus-next/preset.yml": "name: fixture\n" });
    const tempHome = join(root, "temp-home");
    mkdirSync(tempHome, { recursive: true });

    const result = renderRealComposition({
      repoRoot,
      tempHome,
      presetName: "minimal-plus-next",
      deploymentRoot: join(root, "no-such-deployment"),
      installAnchor: import.meta.url,
      env: { DSH_PLUGINS_ROOT: checkout, DSH_RELAY_ROOT: checkout, DSH_ENDLESS_ROOT: checkout },
      homeDir: fakeHome,
    });
    assert.equal(result.preset.source, "repo");
    assert.ok(readFileSync(join(result.preset.stagedPath, "preset.yml"), "utf8").includes("fixture"));
    assert.equal(result.settings.copied, false);
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
