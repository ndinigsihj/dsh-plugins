/**
 * Preset 同步工具的单测（票据 07）：dry-run 默认不写、逐文件与仓库产物对上、
 * `--write` 显式落到目标位、目标位漂移时 dry-run 变红且不覆写。
 *
 * 全部在临时 DSH_HOME/目标目录里跑，真实 ~/.dsh 只读。
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { BUNDLE_OUT_DIR, BUNDLE_PACKAGE_NAME, BUNDLE_SOURCE_DIR, sha256File } from "./agent-preset-bundle.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(REPO_ROOT, "scripts", "sync-agent-presets.mjs");
const REPO_ARTIFACT = join(REPO_ROOT, BUNDLE_OUT_DIR);

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "sync-presets-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runSync(args, { dshHome, cwd = REPO_ROOT } = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, DSH_HOME: dshHome, HOME: dshHome },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

test("dry-run 是默认行为：逐文件与仓库产物对上，且完全不写目标位", () => {
  withTemp((dir) => {
    const dest = join(dir, "deployed", "minimal-plus-preset");
    const legacy = join(dir, ".agent-presets", "minimal-plus");
    const result = runSync(["--dest", dest], { dshHome: dir });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\(dry-run\)/u);
    assert.ok(result.stdout.includes(BUNDLE_PACKAGE_NAME), result.stdout);
    for (const file of ["cordis.patch.yml", "package.json", "source-manifest.json", "tool-bootstrap.mjs"]) {
      assert.ok(result.stdout.includes(file), `plan must list ${file}`);
    }
    assert.match(result.stdout, /repo:ok/u);
    assert.ok(!result.stdout.includes("repo:DRIFT"), result.stdout);
    assert.equal(sha256File(join(dest, "cordis.patch.yml")), undefined, "dry-run must not create the destination");
    assert.equal(sha256File(join(legacy, "preset.yml")), undefined, "dry-run must not touch the legacy directory");
  });
});

test("--write 把生成产物逐文件写到目标位；再次运行报告已一致", () => {
  withTemp((dir) => {
    const dest = join(dir, "deployed", "minimal-plus-preset");
    const write = runSync(["--write", "--dest", dest], { dshHome: dir });
    assert.equal(write.status, 0, write.stderr);
    for (const name of ["cordis.patch.yml", "package.json", "source-manifest.json", "tool-bootstrap.mjs", "plugin-teardown.mjs"]) {
      assert.equal(sha256File(join(dest, name)), sha256File(join(REPO_ARTIFACT, name)), `${name} must be written identically`);
    }
    const plan = runSync(["--dest", dest], { dshHome: dir });
    assert.equal(plan.status, 0, plan.stderr);
    assert.match(plan.stdout, /target already matches/u);
  });
});

test("目标位漂移时 dry-run 报 STALE 并退出 1，且不覆写", () => {
  withTemp((dir) => {
    const dest = join(dir, "deployed", "minimal-plus-preset");
    runSync(["--write", "--dest", dest], { dshHome: dir });
    writeFileSync(join(dest, "tool-bootstrap.mjs"), "corrupted\n");
    const before = readFileSync(join(dest, "tool-bootstrap.mjs"), "utf8");
    const plan = runSync(["--dest", dest], { dshHome: dir });
    assert.equal(plan.status, 1, plan.stdout);
    assert.match(plan.stdout, /tool-bootstrap\.mjs\s+repo:ok\s+target:STALE/u);
    assert.match(plan.stdout, /nothing written/u);
    assert.equal(readFileSync(join(dest, "tool-bootstrap.mjs"), "utf8"), before);
  });
});

test("--profile：dry-run 报告 profile 未选择 bundle 并退出 1；--write 落 profile 侧产物", () => {
  withTemp((dir) => {
    const profileDir = join(dir, "profiles", "tui-dev");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "package.json"), `${JSON.stringify({ name: "dsh-profile-tui-dev", private: true, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base"] } } }, null, 2)}\n`);

    const plan = runSync(["--profile", "tui-dev"], { dshHome: dir });
    assert.equal(plan.status, 1, plan.stdout);
    assert.match(plan.stdout, /bundles selection: MISSING/u);
    assert.equal(sha256File(join(profileDir, "preset-bundles", "minimal-plus-preset", "cordis.patch.yml")), undefined, "dry-run must not write the profile");

    const write = runSync(["--write", "--profile", "tui-dev"], { dshHome: dir });
    assert.equal(write.status, 0, write.stderr);
    const manifest = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"));
    assert.ok(manifest.dsh.profile.bundles.includes(BUNDLE_PACKAGE_NAME));
    for (const name of ["cordis.patch.yml", "package.json", "tool-bootstrap.mjs"]) {
      assert.equal(sha256File(join(profileDir, "preset-bundles", "minimal-plus-preset", name)), sha256File(join(REPO_ARTIFACT, name)));
    }
    assert.equal(sha256File(join(profileDir, "node_modules", BUNDLE_PACKAGE_NAME, "cordis.patch.yml")), sha256File(join(REPO_ARTIFACT, "cordis.patch.yml")));

    const verify = runSync(["--profile", "tui-dev"], { dshHome: dir });
    assert.equal(verify.status, 0, verify.stdout);
    assert.match(verify.stdout, /bundles selection: selected/u);
  });
});

test("--profile 指向不存在的 profile 是环境错误（exit 2），不创建目录", () => {
  withTemp((dir) => {
    const result = runSync(["--profile", "no-such-profile"], { dshHome: dir });
    assert.equal(result.status, 2);
    assert.match(result.stdout, /profile not found/u);
    assert.equal(sha256File(join(dir, "profiles", "no-such-profile", "package.json")), undefined);
  });
});

test("源目录缺失是环境错误（exit 2）", () => {
  withTemp((dir) => {
    const result = runSync(["--preset", "no-such-preset", "--dest", join(dir, "dest")], { dshHome: dir });
    assert.equal(result.status, 2);
    assert.match(result.stdout, /source preset not found/u);
    assert.equal(sha256File(join(dir, "dest", "cordis.patch.yml")), undefined);
    // 仓库真源与产物路径的契约（防止 preset 参数推导漂移）。
    assert.equal(BUNDLE_SOURCE_DIR, "presets/minimal-plus");
  });
});
