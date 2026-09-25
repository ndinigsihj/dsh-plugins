/**
 * 派生 profile 渲染的单测（票据 08）：真实 `tui-dev` 作为只读源、目标 profile 名可不同、
 * `extraBundles` 追加进临时副本的 `dsh.profile.bundles`——源清单保持逐字节只读。
 *
 * 端到端实跑（真实 home、真实 checkout）由 `scripts/tui-pty-smoke.mjs --profile tui-team` 的
 * 票据 08 证据举证；这里钉住派生语义与「只写临时副本」的边界。
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderRealComposition } from "./render-real.mjs";
import { writePresetSource, writeTree } from "./render-real.fixtures.mjs";
import { TEAM_BUNDLE } from "../team-bundle.mjs";
import { BUNDLE_PACKAGE_NAME } from "../../scripts/agent-preset-bundle.mjs";

test("renderRealComposition: 派生 profile 名 + 附加 bundle 只写临时副本，真实源只读", () => {
  const root = mkdtempSync(join(tmpdir(), "render-real-derived-"));
  try {
    const fakeHome = join(root, "home");
    const sourceDir = join(fakeHome, ".dsh", "profiles", "tui-dev");
    writeTree(fakeHome, {
      ".dsh/profiles/tui-dev/cordis.patch.yml": "- insert:\n    - id: endless-tools\n      name: '/src/checkout/dsh-endless/src/tools.ts'\n",
      ".dsh/profiles/tui-dev/package.json": '{"name":"dsh-profile-tui-dev","private":true,"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base"]}}}\n',
      ".dsh/profiles/tui-dev/cordis.yml": "[]\n",
    });
    const checkout = join(root, "checkout/dsh-endless");
    writeTree(checkout, { "src/tools.ts": "// endless\n" });
    const repoRoot = join(root, "repo");
    writePresetSource(join(repoRoot, "presets", "minimal-plus"), { name: "Fixture" });
    const tempHome = join(root, "temp-home");

    const result = renderRealComposition({
      repoRoot,
      tempHome,
      presetName: "minimal-plus",
      deploymentRoot: join(root, "no-such-deployment"),
      profileName: "tui-team",
      extraBundles: [TEAM_BUNDLE],
      installAnchor: import.meta.url,
      env: { DSH_PLUGINS_ROOT: checkout, DSH_RELAY_ROOT: checkout, DSH_ENDLESS_ROOT: checkout },
      homeDir: fakeHome,
    });

    assert.equal(result.profileName, "tui-team");
    assert.equal(result.profileDir, join(tempHome, "profiles", "tui-team"));
    assert.equal(result.renderedPath, join(tempHome, "profiles", "tui-team", "cordis.patch.yml"));
    const copied = JSON.parse(readFileSync(join(result.profileDir, "package.json"), "utf8"));
    assert.deepEqual(copied.dsh.profile.bundles, ["@deepseek-ai/dsh-base", TEAM_BUNDLE, BUNDLE_PACKAGE_NAME]);
    const sourceManifest = JSON.parse(readFileSync(join(sourceDir, "package.json"), "utf8"));
    assert.deepEqual(
      sourceManifest.dsh.profile.bundles,
      ["@deepseek-ai/dsh-base"],
      "source profile manifest must stay read-only",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
