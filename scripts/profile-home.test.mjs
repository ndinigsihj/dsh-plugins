/**
 * `scripts/profile-home.mjs` 的 `prepareHeadlessPresetProfile` 单测（票据 11）。
 *
 * 钉住 0.1.7 隔离 home 的预置契约：profile 骨架 + fixture + 生成的 preset 载体
 * （bundles 选择、node_modules 链接、bundle 文件）与可选的宿主侧模型选择单例。
 * 只写临时目录，不碰真实 home。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prepareHeadlessPresetProfile } from "./profile-home.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PRESET_SOURCE = join(REPO_ROOT, "presets", "minimal-plus");

function withHome(t) {
  const home = mkdtempSync(join(tmpdir(), "profile-home-test-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

function runCli(args) {
  return spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "profile-home.mjs"), ...args], { cwd: REPO_ROOT, encoding: "utf8" });
}

test("prepareHeadlessPresetProfile：骨架 + fixture + 0.1.7 preset 载体", (t) => {
  const home = withHome(t);
  const result = prepareHeadlessPresetProfile({ home, sourceDir: PRESET_SOURCE });

  const manifest = JSON.parse(readFileSync(join(result.profileDir, "package.json"), "utf8"));
  assert.deepEqual(manifest.dsh.profile.bundles.slice(0, 2), ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"]);
  assert.ok(manifest.dsh.profile.bundles.includes("@dsh-plugins/minimal-plus-preset"), "bundle 必须被 profile 选择");
  assert.ok(existsSync(join(result.bundleDir, "cordis.patch.yml")), "生成的 bundle patch 必须落位");
  assert.ok(
    existsSync(join(result.profileDir, "node_modules", "@dsh-plugins", "minimal-plus-preset", "package.json")),
    "node_modules 链接必须解析到 bundle",
  );
  assert.ok(existsSync(join(home, "AGENTS.md")), "确定性 fixture 必须复制进隔离 home");
  assert.equal(result.patchPath, undefined, "未请求单例时不写 profile patch");
  assert.ok(!existsSync(join(result.profileDir, "cordis.patch.yml")), "未请求单例时不得创建 profile patch");
});

test("prepareHeadlessPresetProfile：settingsSingleton 写入宿主侧单例插入行", (t) => {
  const home = withHome(t);
  const result = prepareHeadlessPresetProfile({ home, sourceDir: PRESET_SOURCE, settingsSingleton: true });

  assert.ok(result.patchPath !== undefined);
  const patch = readFileSync(result.patchPath, "utf8");
  assert.match(patch, /insert:/u);
  assert.match(patch, /id: subagent-model-selection-settings/u);
  assert.match(patch, /@deepseek-ai\/dsh-tool-subagent\/model-selection-settings/u);
  assert.doesNotMatch(patch, /config:/u, "裸单例不带 config");
});

test("prepareHeadlessPresetProfile：对象形式的单例配置作为 profile 基线写入", (t) => {
  const home = withHome(t);
  const baseline = { enabled: true, allowedModels: [{ provider: "p", model: "m" }] };
  const result = prepareHeadlessPresetProfile({ home, sourceDir: PRESET_SOURCE, settingsSingleton: true, settingsConfig: baseline });

  const patch = readFileSync(result.patchPath, "utf8");
  assert.match(patch, /enabled/u);
  assert.match(patch, /allowedModels/u);
  // 配置文件行渲染为 JSON（YAML 1.2 的 flow mapping 子集）；组合能否解析由 dsh 冒烟/闸门覆盖。
  const configLine = patch.split("\n").find((line) => line.trim().startsWith("config: "));
  assert.deepEqual(JSON.parse(configLine.trim().slice("config: ".length)), baseline);
});

test("CLI：--settings-config 生成带基线的隔离 home 并输出路径", (t) => {
  const home = withHome(t);
  const baseline = { enabled: true, allowedModels: [{ provider: "p", model: "m" }] };
  const result = runCli(["--home", home, "--source", PRESET_SOURCE, "--settings-config", JSON.stringify(baseline)]);
  assert.equal(result.status, 0, result.stderr);
  const printed = JSON.parse(result.stdout);
  assert.equal(printed.home, home);
  assert.match(readFileSync(printed.patchPath, "utf8"), /"enabled":true/u);
});

test("CLI：裸调用也挂宿主侧单例（minimal-plus 缺它无法组合）", (t) => {
  const home = withHome(t);
  const result = runCli(["--home", home, "--source", PRESET_SOURCE]);
  assert.equal(result.status, 0, result.stderr);
  const printed = JSON.parse(result.stdout);
  const patch = readFileSync(printed.patchPath, "utf8");
  assert.match(patch, /subagent-model-selection-settings/u);
  assert.doesNotMatch(patch, /config:/u, "默认单例不带 config");
});

test("CLI：显式 flag 缺值 → 报明确错误而不是静默 TypeError", () => {
  const result = runCli(["--source", PRESET_SOURCE, "--home"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--home requires a value/u);
});
