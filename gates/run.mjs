/**
 * 回归闸门编排器（票据 03；计划 §2.1、§2.2、§5.1、§5.2、§5.4）。
 *
 * 入口是 `scripts/regression-gate.sh`（单一命令、持仓库本地锁、建临时 home）；
 * 本模块负责跑完静态层（T0）与零 LLM 组合层（T1）、假模型行为层（T2）、
 * 按需真实模型层（T3，见 `gates/t3/run.mjs`）、收集断言证据、写报告。
 *
 * 退出码三态（由本模块返回，bash 入口透传）：
 *   0 全过 / 1 任一断言失败 / 2 环境前置不满足（清单、宿主钉版、组合渲染缺依赖、
 *   T3 版本/基线来源不符或真实 settings 缺失）。
 *
 * 隔离：全部输入来自 repo 资产与临时 home（`GATE_TEMP`），真实 `~/.dsh` 只读；
 * 跨进程写目标只有报告文件与临时 home（T3 额外按日期归档到
 * `experiments/regression-gate/t3-*`）。
 */
import { createRequire } from "node:module";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { composeEntries, healProfilesModuleFallback, loadOverlayPatches, loadProfile, renderConfigDump } from "@deepseek-ai/dsh-app-boot";
import { SESSION_FORMAT_VERSION } from "@deepseek-ai/dsh-session";
import { MANIFEST_PATH, checkDeployment, checkHostPin, readManifest, resolveDeploymentRoot } from "./manifest.mjs";
import { EXIT, GATE_VERSION, createAssertions, diffRealHome, parseTestCounts, run, sha256File, sha256Json, stableJson, writeReport } from "./gate-helpers.mjs";
import { parseCompositionDump } from "./dump-parse.mjs";
import { RenderRealError, REAL_PROFILE_NAME, renderRealComposition } from "./composition/render-real.mjs";
import { countEntries, findDuplicateIds } from "./unique-ids.mjs";
import { runT3 } from "./t3/run.mjs";
import { t3ProvenanceProblems } from "./t3/analysis.mjs";

// `new URL("..")` 带尾斜杠；去掉它，路径显示（`file.slice(REPO_ROOT.length + 1)`）才正确。
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/u, "");
const PRESET = "minimal-plus";
const GATE_PATCH = join(REPO_ROOT, "gates", "composition", "gate.patch.yml");
const SMOKE_BOOT = join(REPO_ROOT, "presets", PRESET, "smoke-boot.mjs");
const DEGRADE_SMOKE = join(REPO_ROOT, "scripts", "degrade-smoke.sh");
const SEEDED_RUN = join(REPO_ROOT, "experiments", "session-preview-seeded", "run.sh");
const STUB_RUN = join(REPO_ROOT, "gates", "stub", "run.mjs");
const STUB_SCENARIOS_DIR = join(REPO_ROOT, "gates", "stub", "scenarios");
const GATE_SCRIPT = join(REPO_ROOT, "scripts", "regression-gate.sh");
/** 闸门自身的源码面（「不自动同步部署位」断言的扫描范围）。 */
const GATE_SOURCES = [
  GATE_SCRIPT,
  join(REPO_ROOT, "gates", "run.mjs"),
  join(REPO_ROOT, "gates", "gate-helpers.mjs"),
  join(REPO_ROOT, "gates", "manifest.mjs"),
  join(REPO_ROOT, "gates", "unique-ids.mjs"),
  join(REPO_ROOT, "gates", "dump-parse.mjs"),
  join(REPO_ROOT, "gates", "composition", "render-real.mjs"),
  join(REPO_ROOT, "gates", "t3", "run.mjs"),
];
/** seeded 预览探针的 id 白名单：红线断言被删掉时闸门必须变红。 */
const SEEDED_PROBE_IDS = [
  "fixture-store-prepared",
  "fixture-copied-byte-identical",
  "red-readSession-rejects-seeded",
  "listEvents-has-corpus",
  "green-count-and-seq-match",
  "green-inherited-count-recorded",
  "baseline-readSession-fastpath",
];
/** 反劫持禁用面（Q13）：假模型的 provider 名与模块路径。 */
const STUB_PROVIDER = "stub";
const STUB_PATH_PATTERNS = ["gates/stub", "gates\\stub"];
const STUB_TEXT_PATTERNS = [/provider: ['"]?stub['"]?/u, /name: ['"]?.*gates\/stub/u];
/** 遏制扫描面：配置类文件里出现这些即命中（注释里的普通 "stub" 词不算）。 */
const STUB_CONFIG_PATTERNS = [/provider:\s*['"]?stub['"]?/u, /gate-stub/u, /gates[/\\]stub/u, /stub-model/u];

/** 环境前置不满足：退出码 2（清单坏 / 宿主代不符 / 组合渲染缺依赖）。 */
export class PreconditionError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "PreconditionError";
    this.detail = detail;
  }
}

function requireJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** T0 的测试文件清单（package.json test 脚本）。 */
function testFileList() {
  const script = requireJson(join(REPO_ROOT, "package.json")).scripts?.test ?? "";
  return script
    .split(/\s+/u)
    .filter((token) => token.endsWith(".test.ts") || token.endsWith(".test.mjs"))
    .map((token) => join(REPO_ROOT, token));
}

/** 宿主安装代：包路径、真实路径、版本（farm 代断言的证据面）。 */
function hostInfo() {
  const appBoot = createRequire(import.meta.url).resolve("@deepseek-ai/dsh-app-boot/package.json");
  const app = createRequire(appBoot);
  const manifestPath = app.resolve("@deepseek-ai/dsh/package.json");
  return {
    manifestPath,
    realPath: realpathSync(manifestPath),
    version: JSON.parse(readFileSync(manifestPath, "utf8")).version,
  };
}

/** `loadProfile` 的 installAnchor 参数：宿主包自身的位置。 */
function installAnchor(host) {
  return host.manifestPath;
}

// ── 真实 home 零写入指纹 ─────────────────────────────────────────────────────

/** 路径指纹：目录递归记「相对路径 + 大小」，普通文件记「大小」。 */
function scanTree(path) {
  if (!existsSync(path)) return { exists: false, entries: 0 };
  if (!statSync(path).isDirectory()) return { exists: true, entries: 1, signature: sha256Json([String(statSync(path).size)]) };
  const lines = [];
  let files = 0;
  const walk = (current, prefix) => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const dirent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(current, dirent.name);
      const rel = `${prefix}${dirent.name}`;
      if (dirent.isDirectory()) walk(child, `${rel}/`);
      else {
        files += 1;
        // lstat: 真实 home 的 .dsh-module-fallback 常用指向 node_modules 的符号链接，
        // 目标树可能缺失（悬空链接）；指纹只关心链接本身，不跟随目标。
        lines.push(`${rel}\t${String(lstatSync(child).size)}`);
      }
    }
  };
  walk(path, "");
  return { exists: true, entries: files, signature: sha256Json(lines) };
}

function scanRealHome(manifest) {
  const realHome = homedir();
  // 只读指纹：`strict: false` 的区是「活跃会话会合法写入」的位置（当前会话的投影缓存
  // 就在 storages 下），只记录变化、不判红——否则在另一个终端跑 TUI 时闸门会假红。
  const paths = {
    profiles: join(realHome, ".dsh", "profiles"),
    storages: { path: join(realHome, ".dsh", "storages"), strict: false, reason: "live sessions write projection cache here" },
    "root:settings.yaml": join(realHome, ".dsh", "settings.yaml"),
    "root:.credentials.yaml": join(realHome, ".dsh", ".credentials.yaml"),
  };
  for (const [preset, entry] of Object.entries(manifest.deployment)) {
    paths[`deployment:${preset}`] = resolveDeploymentRoot(entry, realHome);
  }
  const snapshot = {};
  for (const [label, spec] of Object.entries(paths)) {
    const entry = typeof spec === "string" ? { path: spec } : spec;
    snapshot[label] = { ...scanTree(entry.path), ...(entry.strict === false ? { strict: false, reason: entry.reason } : {}) };
  }
  const sessions = join(realHome, ".dsh", "sessions");
  // 会话区只数条目：会话追加不改条目数，新建会话才改；比深指纹安全，仍能抓住「闸门写进真实 store」。
  snapshot.sessions = { exists: existsSync(sessions), entries: countTree(sessions), signature: `count:${String(countTree(sessions))}` };
  return snapshot;
}

/**
 * 严格区的隔离差异：`strict: false` 的区（活跃会话合法写入）只记录不判红。
 * 判定依据取「before」快照——区集合以运行前扫描为准。
 */
export function strictIsolationDiffs(before, diffs) {
  return diffs.filter((diff) => before[diff.zone]?.strict !== false);
}

/**
 * 单次窗口的真实 home 零写入断言（与 T1 第 ⑨ 条同口径：严格区零变化；活跃写入区只记录）。
 * 每层各取一次「运行开始 → 本层结束」的累计窗口：最后一个跑到的层天然覆盖全程，
 * 因此 `--tier 0,1,2`（无 T3）也不会漏掉 T1/T2 自身的写入窗口。
 */
function isolationAssertions(id, before, after) {
  const t = createAssertions();
  const diffs = diffRealHome(before, after);
  const strict = strictIsolationDiffs(before, diffs);
  t[strict.length === 0 ? "pass" : "fail"](
    id,
    strict.length === 0
      ? `signature identical before/after (strict zones; ${String(diffs.length)} observed-only changes)`
      : JSON.stringify(strict),
    { observedChanges: diffs },
  );
  return t.assertions;
}

function countTree(dir) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const walk = (current) => {
    for (const dirent of readdirSync(current, { withFileTypes: true })) {
      count += 1;
      if (dirent.isDirectory()) walk(join(current, dirent.name));
    }
  };
  walk(dir);
  return count;
}

// ── T0 静态层 ────────────────────────────────────────────────────────────────

function runT0(env) {
  const t = createAssertions();

  const tsc = run("npx", ["tsc", "--noEmit"], { cwd: REPO_ROOT, env });
  t[tsc.status === 0 ? "pass" : "fail"]("tsc.noEmit", `exit ${String(tsc.status)}`, {
    stderr: tailLines(tsc.stderr, 4),
  });

  const test = run("npm", ["test"], { cwd: REPO_ROOT, env });
  const counts = parseTestCounts(test.stdout);
  const green = test.status === 0 && (counts.fail ?? 0) === 0 && (counts.tests ?? 0) > 0;
  t[green ? "pass" : "fail"](
    "npm.test",
    `exit ${String(test.status)} tests=${String(counts.tests ?? "?")} pass=${String(counts.pass ?? "?")} fail=${String(counts.fail ?? "?")}`,
    { skipped: counts.skipped },
  );

  const declared = testFileList();
  const missing = declared.filter((file) => !existsSync(file));
  t[missing.length === 0 ? "pass" : "fail"](
    "testfile.list-consistency",
    missing.length === 0 ? `${String(declared.length)} files present` : `missing: ${missing.map((file) => file.slice(REPO_ROOT.length + 1)).join(", ")}`,
    { declared: declared.length },
  );

  return t.assertions;
}

// ── T1 零 LLM 组合层 ─────────────────────────────────────────────────────────

/**
 * 组合渲染的唯一入口（票据 03 的 `gate` + 票据 04 的 `real`）：
 *   - `gate`（默认）：repo preset 根 + 四个生产插件（`gates/composition/gate.patch.yml`），
 *     不读用户层、不依赖相邻仓库；
 *   - `real`（交付前）：票据 04 物化到临时 home 的真实 `tui-dev` profile 渲染副本，
 *     不再叠加闸门补丁（真实组合的内容全在渲染后的 profile 里）。
 * 两条路径都走 app-boot 的 `renderConfigDump`（与 `--dump-config` 同一算法）。
 */
async function composeComposition({ tempHome, host, composition }) {
  const real = composition === "real";
  await healProfilesModuleFallback({ installAnchor: installAnchor(host), home: tempHome });
  let profile;
  try {
    profile = loadProfile("dsh", real ? REAL_PROFILE_NAME : "headless", installAnchor(host), tempHome);
  } catch (error) {
    throw new PreconditionError(`loadProfile failed: ${String(error.message ?? error)}`, { error: String(error) });
  }
  let overlay = [];
  if (!real) {
    try {
      overlay = loadOverlayPatches("dsh", GATE_PATCH);
    } catch (error) {
      throw new PreconditionError(`gate patch failed to load: ${String(error.message ?? error)}`, { patch: GATE_PATCH });
    }
  }
  const layers = [
    ...profile.layers.map((layer) => ({ label: layer.packageName, patches: layer.patches })),
    ...(profile.patches.length > 0 ? [{ label: profile.patchPath, patches: profile.patches }] : []),
    ...(real ? [] : [{ label: "gates/composition/gate.patch.yml", patches: overlay }]),
  ];
  let dump;
  try {
    dump = renderConfigDump("dsh", join(profile.dir, "cordis.yml"), layers, () => {});
  } catch (error) {
    throw new PreconditionError(`composition render failed: ${String(error.message ?? error)}`, { error: String(error) });
  }
  const composed = composeEntries(layers.flatMap((layer) => layer.patches));
  const dumpPath = join(tempHome, real ? "tui-dev-composition.yml" : "gate-composition.yml");
  writeFileSync(dumpPath, dump);
  return {
    composed,
    dumpPath,
    dumpSha256: sha256File(dumpPath),
    composedSha256: sha256Json(composed),
    counts: countEntries(composed),
    duplicates: findDuplicateIds(composed),
    /** T1 真正加载的那份补丁（gate：仓库补丁；real：临时 home 渲染副本）。 */
    patchPath: real ? profile.patchPath : GATE_PATCH,
  };
}

/** 期望集合与实际集合的差（两边都排序去重；用于工具集合断言）。 */
function setDiff(expected, actual) {
  const want = [...new Set(expected)].sort();
  const got = [...new Set(actual)].sort();
  return {
    missing: want.filter((item) => !got.includes(item)),
    unexpected: got.filter((item) => !want.includes(item)),
  };
}

function jsonField(text, label) {
  const line = text.split("\n").find((candidate) => candidate.startsWith(label));
  if (line === undefined) return undefined;
  try {
    return JSON.parse(line.slice(label.length).trim());
  } catch {
    return undefined;
  }
}

function tailLines(text, count) {
  return text.trim().split("\n").slice(-count);
}

function readJson(path) {
  try {
    return requireJson(path);
  } catch (error) {
    return error?.code === "ENOENT" ? undefined : { error: String(error.message ?? error) };
  }
}

/**
 * 源码里是否有「真实的同步调用」：剥掉注释行后找部署同步脚本的名字。
 * 命中即红——闸门绝不能在跑回归时顺手同步部署位。
 *
 * 名字拆开拼：本函数所在的源码也是扫描对象，整串字面量会让扫描器命中自己。
 */
function hasActiveSyncCall(file) {
  const needle = ["sync-agent", "presets.sh"].join("-");
  const active = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("#");
    })
    .join("\n");
  return active.includes(needle);
}

/**
 * 反劫持扫描（Q13）：组合条目里出现 provider 名为 `stub` 的配置、或任何指向
 * `gates/stub` 的模块路径 / dump 文本，都算命中。
 *
 * 结构化扫描看的是「真的会成为路由配置的值」；文本扫描兜底 dump 里的路径与 provider。
 * stub 行为层（票据 06/07）只允许出现在 `gates/stub/*.patch.yml`，绝不能进闸门组合。
 */
function findStubReferences(entries, dumpText) {
  const hits = [];
  const walk = (nodes, path) => {
    if (!Array.isArray(nodes)) return;
    for (const [index, node] of nodes.entries()) {
      if (node === null || typeof node !== "object") continue;
      for (const [key, value] of Object.entries(node)) {
        if (key === "provider" && value === STUB_PROVIDER) hits.push(`${path}[${String(index)}].provider=stub`);
        if (typeof value === "string" && STUB_PATH_PATTERNS.some((needle) => value.includes(needle))) {
          hits.push(`${path}[${String(index)}].${key}=${value}`);
        }
        if (Array.isArray(value)) walk(value, `${path}[${String(index)}].${key}`);
      }
    }
  };
  walk(entries, "composed");
  for (const [index, line] of dumpText.split("\n").entries()) {
    if (STUB_TEXT_PATTERNS.some((pattern) => pattern.test(line))) hits.push(`dump:${String(index + 1)}`);
  }
  return hits;
}

function runT1(config, report) {
  const t = createAssertions();
  const { tempHome, env, gate } = config;
  const real = config.composition === "real";

  // ① 组合导出：真实 `dsh --dump-config` 退出码 0（另一条渲染路径），并与进程内组合对照
  const dumpArgs = real ? ["--profile", REAL_PROFILE_NAME, "--dump-config"] : ["--profile", "headless", "--patch", GATE_PATCH, "--dump-config"];
  const dumpRun = run("dsh", dumpArgs, { cwd: REPO_ROOT, env });
  const dumpText = dumpRun.stdout;
  const parsed = parseCompositionDump(dumpText);
  const cliCounts = parsed.entries === undefined ? undefined : countEntries(parsed.entries);
  const cliDuplicates = parsed.entries === undefined ? undefined : findDuplicateIds(parsed.entries);
  const dumpOk = dumpRun.status === 0 && cliCounts !== undefined;
  t[dumpOk ? "pass" : "fail"](
    "composition.dump-config",
    `exit ${String(dumpRun.status)} ${parsed.error === undefined ? `entries=${String(cliCounts?.ids)}` : `parse: ${parsed.error}`}`,
    { source: gate.patchPath, inProcessEntries: gate.composed.length, stderr: tailLines(dumpRun.stderr, 4) },
  );

  // ② 逐 loader id 递归计数 = 1：导出本身不做重复检测（patch 按 id 覆盖），必须单独断言；
  //    进程内组合与 CLI dump 两条路径分别计数，任一有重复即红。
  const allDuplicates = [
    ...gate.duplicates.map((duplicate) => ({ ...duplicate, source: "in-process" })),
    ...(cliDuplicates ?? []).map((duplicate) => ({ ...duplicate, source: "cli-dump" })),
  ];
  t[allDuplicates.length === 0 ? "pass" : "fail"](
    "composition.loader-id-unique",
    allDuplicates.length === 0
      ? `in-process ids=${String(gate.counts.ids)} cli ids=${String(cliCounts?.ids)} duplicates=0`
      : `duplicates: ${allDuplicates.map((d) => `${d.path}/${d.id}`).join(", ")}`,
    { inProcess: gate.counts, cli: cliCounts, duplicates: allDuplicates },
  );

  // ③ 反劫持：组合中不出现假模型的 provider 名 / 模块路径（Q13）
  const hits = findStubReferences(gate.composed, dumpText);
  t[hits.length === 0 ? "pass" : "fail"]("composition.no-stub", hits.length === 0 ? "no stub provider/module reference" : `stub references: ${hits.join(", ")}`);

  // ④ 零 LLM 组合冒烟：R1 锚定对 / R2 沙箱 bash / 工具集合与二轮注入（期望面见 gates/expectations.json）
  const expected = readJson(join(REPO_ROOT, "gates", "expectations.json"))?.presets?.[PRESET];
  const smoke = run("node", [SMOKE_BOOT], { cwd: REPO_ROOT, env });
  const r1 = jsonField(smoke.stdout, "ROUND1 catalog:");
  const r2 = jsonField(smoke.stdout, "ROUND2 catalog:");
  const preStep2 = jsonField(smoke.stdout, "ROUND2 pre-step sources:");
  const r1Tools = r1?.tools ?? [];
  const r1Diff = expected === undefined ? { missing: ["<expectations.json>"], unexpected: [] } : setDiff(expected.round1.tools, r1Tools);
  const r1BashBad = (r1?.bashParams ?? []).filter((param) => (expected?.round1?.bashParamsExcludes ?? []).includes(param));
  const anchored = smoke.status === 0 && r1Diff.missing.length === 0 && r1Diff.unexpected.length === 0 && r1BashBad.length === 0;
  t[anchored ? "pass" : "fail"](
    "smoke.anchored-first-turn",
    `exit ${String(smoke.status)} R1=${JSON.stringify(r1Tools)}${anchored ? "" : ` missing=${JSON.stringify(r1Diff.missing)} unexpected=${JSON.stringify(r1Diff.unexpected)}`}`,
    { stderr: tailLines(smoke.stderr, 4) },
  );

  const r2Tools = r2?.tools ?? [];
  const r2Diff = expected === undefined ? { missing: ["<expectations.json>"], unexpected: [] } : setDiff(expected.round2.tools, r2Tools);
  const r2BashMissing = (expected?.round2?.bashParamsIncludes ?? []).filter((param) => !(r2?.bashParams ?? []).includes(param));
  const r2Sources = preStep2 ?? [];
  const r2SourcesMissing = (expected?.round2?.preStepSources ?? []).filter((source) => !r2Sources.includes(source));
  const promoted =
    smoke.status === 0 && r2Diff.missing.length === 0 && r2Diff.unexpected.length === 0 && r2BashMissing.length === 0 && r2SourcesMissing.length === 0;
  t[promoted ? "pass" : "fail"](
    "smoke.promoted-catalog",
    r2 === undefined
      ? `exit ${String(smoke.status)} no ROUND2 catalog`
      : `tools=${String(r2Tools.length)} missing=${JSON.stringify(r2Diff.missing)} unexpected=${JSON.stringify(r2Diff.unexpected)} bashParamsMissing=${JSON.stringify(r2BashMissing)} preStepMissing=${JSON.stringify(r2SourcesMissing)}`,
    { preset: PRESET },
  );
  report.smoke = { r1Tools, toolCount: r2Tools.length, tools: r2Tools, preStepSources: r2Sources };

  // ⑤ 降级路径冒烟（缺 bootstrap 工具 → fail-open 全量目录）。
  // preset 来源跟随组合模式：real 用物化副本（部署位），gate 用仓库根。
  const degrade = run("bash", [DEGRADE_SMOKE], {
    cwd: REPO_ROOT,
    env: { ...env, DEGRADE_SMOKE_ROOT: join(tempHome, "degrade"), DEGRADE_SMOKE_SOURCE_ROOT: env.SMOKE_PRESET_ROOT },
  });
  const degradeOut = `${degrade.stdout}\n${degrade.stderr}`;
  const failOpen = degradeOut.includes("bootstrap disabled, full catalog exposed");
  const r1Degraded = jsonField(degrade.stdout, "ROUND1 catalog:");
  t[degrade.status === 0 && failOpen ? "pass" : "fail"](
    "degrade.fail-open",
    `exit ${String(degrade.status)} warning=${String(failOpen)} R1 tools=${String(r1Degraded?.tools?.length ?? "?")}`,
    { stderr: tailLines(degrade.stderr, 3) },
  );

  // ⑥ seeded 预览探针（仓库 fixture + 临时 store；红线断言按 id 白名单核对）
  const seeded = run("bash", [SEEDED_RUN], {
    cwd: REPO_ROOT,
    env: { ...env, SEEDED_PREVIEW_ROOT: join(tempHome, "seeded"), PROBE_OUT: join(tempHome, "seeded", "probe.json") },
  });
  const probe = readJson(join(tempHome, "seeded", "probe.json"));
  const checks = probe?.checks ?? [];
  const ids = checks.map((check) => check.id);
  const missingIds = SEEDED_PROBE_IDS.filter((id) => !ids.includes(id));
  const probeGreen = seeded.status === 0 && checks.length > 0 && checks.every((check) => check.pass) && missingIds.length === 0;
  t[probeGreen ? "pass" : "fail"](
    "seeded-preview.probe",
    `exit ${String(seeded.status)} ${String(checks.filter((check) => check.pass).length)}/${String(checks.length)} pass missing=${missingIds.length}`,
    { summary: probe?.summary, missing: missingIds, stderr: tailLines(seeded.stderr, 3) },
  );
  report.seededPreview = { checks: checks.length, ids };

  // ⑦ 部署位一致性（前置断言；absent / stale 分别表达、各自可豁免）
  const deployment = checkDeployment(config.manifestObj, { repoRoot: REPO_ROOT, homeDir: homedir() });
  const drift = deployment.files.filter((file) => file.repoMatches === false);
  report.deployment = {
    status: deployment.status,
    manifestMatchesRepo: drift.length === 0,
    files: Object.fromEntries(deployment.files.map((file) => [file.name, { repo: file.repo, deployed: file.deployed, expected: file.expected, state: file.state }])),
  };
  t[drift.length === 0 ? "pass" : "fail"](
    "deployment.repo-matches-manifest",
    drift.length === 0 ? `${String(deployment.files.length)} files match` : `drift: ${drift.map((file) => file.name).join(", ")}`,
    { manifest: MANIFEST_PATH },
  );
  const exemptKey = deployment.status === "absent" ? "skip-deployment-check" : "allow-stale-deployment";
  const bad = deployment.files.filter((file) => file.state !== "ok");
  if (deployment.status === "ok") {
    t.pass("deployment.repo-vs-deployed", `${String(deployment.files.length)} files ok`);
  } else if (config.exemptions.has(exemptKey)) {
    t.pass("deployment.repo-vs-deployed", `exempted (${deployment.status}) by --${exemptKey}: ${bad.map((file) => `${file.name}:${file.state}`).join(", ") || "n/a"}`);
    config.exemptionsApplied.push({ layer: "deployment-sha", reason: deployment.status, detail: bad.map((file) => `${file.name}:${file.state}`).join(", ") });
  } else {
    t.fail("deployment.repo-vs-deployed", `${deployment.status}: ${bad.map((file) => `${file.name}:${file.state}`).join(", ") || "n/a"}`, { hint: `exempt once with --${exemptKey}` });
  }

  // ⑧ 依赖树宿主代（installAnchor + 临时 farm 解析到哪个 @deepseek-ai/dsh）+ 会话格式
  const farmManifest = join(tempHome, "profiles", "node_modules", "@deepseek-ai", "dsh", "package.json");
  const farmVersion = existsSync(farmManifest) ? JSON.parse(readFileSync(farmManifest, "utf8")).version : undefined;
  const expectedHost = config.manifestObj.hostVersion;
  const farmOk = config.host.version === expectedHost && farmVersion === expectedHost;
  report.host = {
    expected: expectedHost,
    installAnchor: { path: config.host.realPath, version: config.host.version },
    farm: { path: farmManifest, version: farmVersion, healed: farmVersion !== undefined },
  };
  t[farmOk ? "pass" : "fail"](
    "host.pin",
    `anchor=${config.host.version} farm=${String(farmVersion)} expected=${expectedHost}`,
    { farmManifest },
  );
  t[String(SESSION_FORMAT_VERSION) === String(config.manifestObj.sessionFormatVersion) ? "pass" : "fail"](
    "session.format-version",
    `runtime=${String(SESSION_FORMAT_VERSION)} manifest=${String(config.manifestObj.sessionFormatVersion)}`,
  );

  // ⑨ 真实 home 零写入（前快照在闸门启动时、后快照在本层子进程全部跑完后取；
  //    storages 等活跃写入区只记录）
  const realHomeAfter = scanRealHome(config.manifestObj);
  const diffs = diffRealHome(config.realHomeBefore, realHomeAfter);
  const strictDiffs = strictIsolationDiffs(config.realHomeBefore, diffs);
  report.isolation = {
    strictZones: Object.entries(config.realHomeBefore)
      .filter(([, zone]) => zone.strict !== false)
      .map(([label]) => label),
    observedChanges: diffs,
    strictChanges: strictDiffs,
  };
  t[strictDiffs.length === 0 ? "pass" : "fail"](
    "isolation.real-home-untouched",
    strictDiffs.length === 0
      ? `signature identical before/after (strict zones; ${String(diffs.length)} observed-only changes)`
      : JSON.stringify(strictDiffs),
    { strictZones: report.isolation.strictZones, observedChanges: diffs },
  );

  // ⑩ 副本侧被回写文件的 sha（宿主规范化回写落临时副本即接受；real 另记真实 profile 副本）
  const copyCordis = sha256File(join(tempHome, "profiles", "headless", "cordis.yml"));
  const realCopyCordis = real ? sha256File(join(tempHome, "profiles", REAL_PROFILE_NAME, "cordis.yml")) : undefined;
  const copyEvidence = real
    ? `headless cordis.yml sha256=${String(copyCordis).slice(0, 12)} ${REAL_PROFILE_NAME} cordis.yml sha256=${String(realCopyCordis).slice(0, 12)}`
    : `cordis.yml sha256=${String(copyCordis).slice(0, 12)}`;
  t.pass("isolation.copy-rewrite-sha", copyEvidence, {
    paths: [join(tempHome, "profiles", "headless", "cordis.yml"), ...(real ? [join(tempHome, "profiles", REAL_PROFILE_NAME, "cordis.yml")] : [])],
  });

  // ⑪ 闸门自身不含部署位同步动作（同步仍是显式 scripts/sync-agent-presets.sh）
  const offenders = GATE_SOURCES.filter((file) => hasActiveSyncCall(file));
  t[offenders.length === 0 ? "pass" : "fail"](
    "gate.no-deployment-sync",
    offenders.length === 0 ? `no sync invocation in ${String(GATE_SOURCES.length)} gate sources` : `sync invocation in: ${offenders.join(", ")}`,
  );

  // ⑫ real：源 profile 只读（渲染前后 sha 一致）；报告记源 sha 与渲染后 sha 供追溯
  if (real && config.real !== null) {
    const afterSha = sha256File(config.real.sourcePath);
    const unchanged = afterSha === config.real.sourceSha;
    t[unchanged ? "pass" : "fail"](
      "composition.source-profile-unchanged",
      `source ${config.real.sourcePath} before=${String(config.real.sourceSha).slice(0, 12)} after=${String(afterSha).slice(0, 12)}`,
      { sourcePath: config.real.sourcePath, sourceSha: config.real.sourceSha, afterSha },
    );
  }

  return t.assertions;
}

// ── T2 假模型行为层（票据 06 / 07）────────────────────────────────────────────

/** 递归列出某目录下指定后缀的文件。 */
function listConfigFiles(root, suffixes, out = []) {
  if (!existsSync(root)) return out;
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    const child = join(root, dirent.name);
    if (dirent.isDirectory()) listConfigFiles(child, suffixes, out);
    else if (suffixes.some((suffix) => dirent.name.endsWith(suffix))) out.push(child);
  }
  return out;
}

/**
 * 遏制断言（Q13 的闸门侧）：假模型只能出现在 `gates/stub/**`。
 * 扫描组合层、preset / 部署位副本与临时 home profile 的配置面；注释里的普通
 * "stub" 词不算，只有 provider 路由、插件 id、模块路径、模型名四种形态命中。
 */
function stubContainmentHits(config) {
  const deploymentEntry = config.manifestObj?.deployment?.[PRESET];
  const deploymentRoot = deploymentEntry === undefined ? undefined : resolveDeploymentRoot(deploymentEntry, homedir());
  const roots = [
    { label: "gates/composition", dir: join(REPO_ROOT, "gates", "composition") },
    { label: `presets/${PRESET}`, dir: join(REPO_ROOT, "presets", PRESET) },
    { label: "presets/minimal-plus", dir: join(REPO_ROOT, "presets", "minimal-plus") },
    { label: "temp-home-profiles", dir: join(config.tempHome, "profiles") },
    ...(deploymentRoot === undefined ? [] : [{ label: "deployment", dir: deploymentRoot }]),
  ];
  const hits = [];
  for (const { label, dir } of roots) {
    for (const file of listConfigFiles(dir, [".yml", ".yaml", ".json"])) {
      const text = readFileSync(file, "utf8");
      for (const pattern of STUB_CONFIG_PATTERNS) {
        if (pattern.test(text)) hits.push(`${label}:${file.startsWith(REPO_ROOT) ? file.slice(REPO_ROOT.length + 1) : file}`);
      }
    }
  }
  return hits;
}

/** 逐场景跑 T2 runner，把场景断言并入闸门报告；零网络、零额度、全程临时 home。 */
function runT2(config) {
  const t = createAssertions();
  const { tempHome, env } = config;
  const stubRoot = join(tempHome, "stub");
  mkdirSync(stubRoot, { recursive: true });

  const hits = stubContainmentHits(config);
  t[hits.length === 0 ? "pass" : "fail"](
    "stub.overlay-only",
    hits.length === 0
      ? "no stub provider/module/model reference outside gates/stub/**"
      : `stub references outside gates/stub: ${hits.join(", ")}`,
  );

  const scenarios = existsSync(STUB_SCENARIOS_DIR)
    ? readdirSync(STUB_SCENARIOS_DIR).filter((file) => file.endsWith(".mjs")).sort().map((file) => file.slice(0, -".mjs".length))
    : [];
  const summary = [];
  for (const scenario of scenarios) {
    const jsonPath = join(stubRoot, `${scenario}.json`);
    const result = run("node", [STUB_RUN, "--scenario", scenario, "--json", jsonPath], {
      cwd: REPO_ROOT,
      env: {
        ...env,
        STUB_HOME: tempHome,
        STUB_SESSION_ROOT: join(stubRoot, scenario, "sessions"),
        STUB_PRESET_ROOT: join(REPO_ROOT, "presets"),
      },
    });
    const report = readJson(jsonPath);
    const assertions = Array.isArray(report?.assertions) ? report.assertions : [];
    if (assertions.length === 0) {
      t.fail(`stub.${scenario}`, `exit ${String(result.status)} no scenario report at ${jsonPath}`, { stderr: tailLines(result.stderr, 4) });
      summary.push({ scenario, passed: 0, failed: 1, exit: result.status });
      continue;
    }
    for (const assertion of assertions) {
      t[assertion.status === "pass" ? "pass" : "fail"](`stub.${scenario}.${assertion.id}`, assertion.evidence, assertion.detail);
    }
    const allPass = assertions.every((assertion) => assertion.status === "pass");
    t[(result.status === 0) === allPass ? "pass" : "fail"](
      `stub.${scenario}.process-exit`,
      `exit ${String(result.status)} report=${String(assertions.filter((assertion) => assertion.status === "pass").length)}/${String(assertions.length)} pass`,
    );
    summary.push({ scenario, passed: assertions.filter((assertion) => assertion.status === "pass").length, failed: assertions.filter((assertion) => assertion.status === "fail").length, exit: result.status, report: jsonPath });
  }
  if (scenarios.length === 0) t.fail("stub.scenarios", `no scenario files under ${STUB_SCENARIOS_DIR}`);
  config.report.stub = { scenarios: summary };
  return t.assertions;
}

// ── 入口 ────────────────────────────────────────────────────────────────────

function recordTier(id, assertions, startedMs = Date.now()) {
  const failed = assertions.some((assertion) => assertion.status === "fail");
  const allSkipped = assertions.length > 0 && assertions.every((assertion) => assertion.status === "skip");
  return {
    id,
    status: failed ? "fail" : allSkipped ? "skip" : "pass",
    startedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    assertions,
  };
}

/**
 * 跑闸门并返回退出码。
 * @param options.tiers 要跑的层（`[0,1,2]` 子集；T2 见 gates/stub/run.mjs）。
 * @param options.composition `gate`（默认）/ `real`（票据 04）。
 * @param options.exemptions 已显式声明的豁免键集合（`--skip-deployment-check` 等）。
 * @param options.reportPath 报告落点。
 * @param options.tempHome 临时 home（脚本已建）。
 */
export async function runGate(options) {
  const startedAt = new Date().toISOString();
  const head = run("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT });
  const status = run("git", ["status", "--porcelain"], { cwd: REPO_ROOT });
  const report = {
    gateVersion: GATE_VERSION,
    startedAt,
    finishedAt: null,
    gitHead: head.status === 0 ? head.stdout.trim() : undefined,
    gitDirty: status.status === 0 ? status.stdout.trim().length > 0 : undefined,
    hostVersion: null,
    sessionFormatVersion: SESSION_FORMAT_VERSION,
    composition: options.composition,
    compositionVerified: options.composition === "real" ? null : "repo-patch",
    compositionSourcePath: options.composition === "real" ? null : GATE_PATCH,
    compositionSourceSha: options.composition === "real" ? null : sha256File(GATE_PATCH),
    compositionRenderedPath: null,
    compositionRenderedSha: null,
    compositionDumpSha: null,
    compositionReal: null,
    deployment: null,
    tiers: [],
    exemptions: [],
    summary: { passed: 0, failed: 0, skipped: 0 },
  };

  const pre = createAssertions();
  let preconditionsOk = true;
  let preconditionDetail = null;

  const manifest = readManifest();
  if (manifest.status !== "ok") {
    preconditionsOk = false;
    preconditionDetail = `${manifest.status}: ${manifest.error ?? MANIFEST_PATH}`;
    pre.fail("manifest.read", preconditionDetail);
  }
  let host;
  try {
    host = hostInfo();
    report.hostVersion = host.version;
  } catch (error) {
    preconditionsOk = false;
    preconditionDetail = `host install anchor not resolvable: ${String(error.message ?? error)} — run scripts/link-global-dsh.sh`;
    pre.fail("host.anchor", preconditionDetail);
  }
  const dshCli = run("dsh", ["--version"], { cwd: REPO_ROOT });
  if (dshCli.status !== 0) {
    preconditionsOk = false;
    preconditionDetail = "dsh CLI not runnable (not on PATH?): install the pinned host @deepseek-ai/dsh";
    pre.fail("host.cli", `exit ${String(dshCli.status)} ${dshCli.error ?? ""}`.trim());
  } else {
    pre.pass("host.cli", `dsh --version -> ${dshCli.stdout.trim()}`);
  }
  if (host !== undefined && manifest.status === "ok") {
    const pin = checkHostPin(manifest.manifest, { hostVersion: host.version, sessionFormatVersion: SESSION_FORMAT_VERSION });
    for (const check of pin.checks) {
      const ok = check.status === "ok";
      pre[ok ? "pass" : "fail"](`host.pin.${check.id}`, `expected=${String(check.expected)} actual=${String(check.actual)}`, ok ? undefined : { hint: "re-capture the baseline: update gates/manifest.json (or switch back to the pinned host)" });
      if (!ok) {
        preconditionsOk = false;
        preconditionDetail = "host/session format does not match the manifest: re-capture the baseline";
      }
    }
  }
  // T3 版本闸门（用户决策 Q3）：宿主/会话格式/基线来源或真实 settings 不符时该层拒绝运行
  // （exit 2，T0/T1/T2 不受影响），而不是拿旧数字当结论。
  let t3Refusal = null;
  if (options.tiers.includes(3) && preconditionsOk && manifest.status === "ok" && host !== undefined) {
    const problems = t3ProvenanceProblems(manifest.manifest, {
      hostVersion: host.version,
      sessionFormatVersion: SESSION_FORMAT_VERSION,
      settingsPresent: existsSync(join(homedir(), ".dsh", "settings.yaml")),
    });
    for (const problem of problems) {
      pre.fail(`t3.precondition.${problem.id}`, problem.detail, {
        hint: "re-capture the baseline: update gates/manifest.json (host pin / baseline record) or switch back to the pinned host, then rerun --tier 3",
      });
    }
    if (problems.length > 0) t3Refusal = problems.map((problem) => problem.detail).join("; ");
  }

  const tempHome = options.tempHome;
  const env = {
    ...process.env,
    DSH_HOME: tempHome,
    HOME: tempHome,
    GATE_PRESET_ROOT: join(REPO_ROOT, "presets"),
    SMOKE_PRESET_ROOT: join(REPO_ROOT, "presets"),
    SMOKE_SESSION_ROOT: join(tempHome, "sessions"),
    SMOKE_EXTRA_PATCHES: join(REPO_ROOT, "gates", "composition", "subagent-settings.patch.yml"),
    CC_TUI_PRESET: PRESET,
  };
  mkdirSync(join(tempHome, "gate"), { recursive: true });
  prepareProfile(tempHome);
  const realHomeBefore = scanRealHome(manifest.status === "ok" ? manifest.manifest : { deployment: {} });

  // real 组合（票据 04）：读真实 tui-dev profile、按 env 渲染三类仓库根、物化到临时 home。
  // 缺相邻 checkout / 渲染后依赖不可解析 → 环境前置失败（exit 2），绝不回落自持组合。
  let real = null;
  if (options.composition === "real" && host !== undefined && manifest.status === "ok") {
    const deploymentEntry = manifest.manifest.deployment?.[PRESET];
    try {
      real = renderRealComposition({
        repoRoot: REPO_ROOT,
        tempHome,
        presetName: PRESET,
        deploymentRoot: deploymentEntry === undefined ? undefined : resolveDeploymentRoot(deploymentEntry, homedir()),
        installAnchor: installAnchor(host),
        env: process.env,
        homeDir: homedir(),
      });
      env.SMOKE_PRESET_ROOT = real.preset.root;
      pre.pass(
        "composition.real-render",
        `source=${real.sourcePath} sha256=${real.sourceSha.slice(0, 12)} → rendered=${real.renderedPath} sha256=${real.renderedSha.slice(0, 12)} preset=${real.preset.source}`,
        { roots: real.roots, preset: real.preset, settings: real.settings, loadedBy: "rendered-copy" },
      );
      report.compositionVerified = "rendered-copy";
      report.compositionSourcePath = real.sourcePath;
      report.compositionSourceSha = real.sourceSha;
      report.compositionRenderedPath = real.renderedPath;
      report.compositionRenderedSha = real.renderedSha;
      report.compositionReal = { profile: REAL_PROFILE_NAME, roots: real.roots, preset: real.preset, settings: real.settings };
    } catch (error) {
      preconditionsOk = false;
      preconditionDetail = error instanceof RenderRealError ? error.message : `real composition render failed: ${String(error.message ?? error)}`;
      pre.fail("composition.real-render", preconditionDetail, error.detail);
    }
  }

  const exemptions = options.exemptions ?? new Set();
  const exemptionsApplied = [];
  report.exemptions = exemptionsApplied;

  let gate = null;
  let gateError = null;
  if (preconditionsOk && host !== undefined && options.tiers.includes(1)) {
    try {
      gate = await composeComposition({ tempHome, host, composition: options.composition });
    } catch (error) {
      gateError = error;
      if (error instanceof PreconditionError) {
        preconditionsOk = false;
        preconditionDetail = error.message;
        pre.fail("composition.render", `${error.message}`, error.detail);
      } else {
        pre.fail("composition.render", String(error.message ?? error));
      }
    }
  }

  const tiers = [];
  if (options.tiers.includes(0)) {
    if (preconditionsOk) {
      const t0Started = Date.now();
      tiers.push(recordTier("T0", runT0(env), t0Started));
    } else {
      tiers.push(recordTier("T0", [{ id: "tier.T0", status: "skip", evidence: `precondition not met: ${String(preconditionDetail)}` }]));
    }
  }
  if (options.tiers.includes(1)) {
    if (gate === null) {
      tiers.push(recordTier("T1", [{ id: "tier.T1", status: "skip", evidence: `precondition not met: ${String(gateError?.message ?? preconditionDetail)}` }]));
    } else {
      const config = {
        tempHome,
        env,
        gate,
        composition: options.composition,
        real,
        manifestObj: manifest.manifest,
        host,
        exemptions,
        exemptionsApplied,
        realHomeBefore,
      };
      const t1Started = Date.now();
      tiers.push(recordTier("T1", runT1(config, report), t1Started));
      report.compositionDumpSha = gate.dumpSha256;
      report.compositionEntriesSha = gate.composedSha256;
      report.compositionArtifact = gate.dumpPath;
      if (options.composition === "gate") {
        // gate：渲染产物（dump）即「验的那一份」的 sha 记录面（票据 03 的既有 schema）。
        report.compositionRenderedPath = gate.dumpPath;
        report.compositionRenderedSha = gate.dumpSha256;
      }
      report.copies = {
        profileCordisSha: sha256File(join(tempHome, "profiles", "headless", "cordis.yml")),
        ...(real === null ? {} : { realProfileCordisSha: sha256File(join(tempHome, "profiles", REAL_PROFILE_NAME, "cordis.yml")) }),
      };
    }
  }
  if (options.tiers.includes(2)) {
    if (preconditionsOk) {
      // T2 用自持的 stub 组合（headless + gates/stub/stub.patch.yml + repo preset 根），
      // 与 --composition 无关：它验的是 preset/agent-loop 机制，不是交付态组合内容。
      // 隔离窗口取「运行开始 → T2 结束」累计，覆盖 T2 自身的写入面（票据 12 审查 c1）。
      const t2Started = Date.now();
      const t2Assertions = runT2({ tempHome, env, report, manifestObj: manifest.manifest });
      t2Assertions.push(...isolationAssertions("t2.isolation.real-home-untouched", realHomeBefore, scanRealHome(manifest.manifest)));
      tiers.push(recordTier("T2", t2Assertions, t2Started));
    } else {
      tiers.push(recordTier("T2", [{ id: "tier.T2", status: "skip", evidence: `precondition not met: ${String(preconditionDetail)}` }]));
    }
  }
  if (options.tiers.includes(3)) {
    if (t3Refusal !== null) {
      tiers.push(recordTier("T3", [{ id: "tier.T3", status: "skip", evidence: `refused: ${t3Refusal} — re-capture the baseline, then rerun --tier 3` }]));
    } else if (!preconditionsOk) {
      tiers.push(recordTier("T3", [{ id: "tier.T3", status: "skip", evidence: `precondition not met: ${String(preconditionDetail)}` }]));
    } else {
      const t3Started = Date.now();
      let assertions;
      try {
        assertions = runT3({ tempHome, env, report, manifestObj: manifest.manifest, host });
      } catch (error) {
        assertions = [{ id: "t3.run", status: "fail", evidence: `T3 runner failed: ${String(error?.message ?? error)}` }];
      }
      assertions.push(...isolationAssertions("t3.isolation.real-home-untouched", realHomeBefore, scanRealHome(manifest.manifest)));
      tiers.push(recordTier("T3", assertions, t3Started));
    }
  }

  if (pre.assertions.length > 0) {
    tiers.unshift({
      id: "PRE",
      status: pre.assertions.some((assertion) => assertion.status === "fail") ? "fail" : "pass",
      startedAt,
      durationMs: 0,
      assertions: pre.assertions,
    });
  }
  report.tiers = tiers;
  report.finishedAt = new Date().toISOString();
  const all = tiers.flatMap((tier) => tier.assertions);
  report.summary = {
    passed: all.filter((assertion) => assertion.status === "pass").length,
    failed: all.filter((assertion) => assertion.status === "fail").length,
    skipped: all.filter((assertion) => assertion.status === "skip").length,
  };

  writeReport(options.reportPath, report);
  printSummary(report, options.reportPath);
  const failed = report.summary.failed > 0;
  if (!preconditionsOk) return EXIT.precondition;
  if (t3Refusal !== null && options.tiers.includes(3)) return EXIT.precondition;
  if (failed) return EXIT.fail;
  return EXIT.pass;
}

/** 终端摘要：逐层逐条 + 豁免醒目警告（豁免绝不静默变绿）。 */
function printSummary(report, reportPath) {
  for (const tier of report.tiers) {
    process.stdout.write(`[${tier.id}] ${tier.status}\n`);
    for (const assertion of tier.assertions) {
      process.stdout.write(`  ${assertion.status.toUpperCase().padEnd(4)} ${assertion.id} — ${String(assertion.evidence)}\n`);
    }
  }
  if (report.exemptions.length > 0) {
    process.stdout.write("\n!!! EXEMPTIONS APPLIED (report stays green but this run is NOT a full verification):\n");
    for (const exemption of report.exemptions) {
      process.stdout.write(`!!!   ${exemption.layer}: ${exemption.reason} — ${exemption.detail}\n`);
    }
  }
  process.stdout.write(
    `\nsummary: ${String(report.summary.passed)} passed, ${String(report.summary.failed)} failed, ${String(report.summary.skipped)} skipped — report ${reportPath}\n`,
  );
}

/** 预置临时 home 的 headless profile（与 CLI `prepareProfile` 的同构内容）。 */
function prepareProfile(home) {
  const profileDir = join(home, "profiles", "headless");
  mkdirSync(profileDir, { recursive: true });
  if (!existsSync(join(profileDir, "package.json"))) {
    const manifest = {
      name: "dsh-profile-headless",
      private: true,
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"], patchReload: "startup" } },
    };
    writeFileSync(join(profileDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  if (!existsSync(join(profileDir, "cordis.yml"))) {
    writeFileSync(join(profileDir, "cordis.yml"), "# dsh profile root — an empty entry list.\n[]\n");
  }
  mkdirSync(join(home, "sessions"), { recursive: true });
  seedHomeFixtures(home);
  return profileDir;
}

/**
 * 把 `gates/fixtures/gate-home/` 的确定性内容复制进临时 home：
 * user-global `AGENTS.md`（第二轮 agent-instructions 注入的来源）与
 * `skills/gate-fixture/`（第二轮 skill-catalog 注入的来源）。
 * 不复制则二轮注入在隔离 home 下恒缺席——那样冒烟断言会退化成「读真实用户家目录」。
 */
function seedHomeFixtures(home) {
  const source = join(REPO_ROOT, "gates", "fixtures", "gate-home");
  if (!existsSync(source)) return;
  cpSync(source, home, { recursive: true });
}

/** CLI 接线：`scripts/regression-gate.sh` 通过 GATE_* 环境变量传参。 */
function parseTiers(raw) {
  const tiers = String(raw ?? "0,1")
    .split(",")
    .map((token) => Number(token.trim()))
    .filter((tier) => Number.isSafeInteger(tier) && tier >= 0);
  return tiers.length > 0 ? [...new Set(tiers)].sort((a, b) => a - b) : [0, 1];
}

if (process.argv[1] !== undefined && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const tiers = parseTiers(process.env.GATE_TIERS);
  const code = await runGate({
    tiers,
    composition: process.env.GATE_COMPOSITION ?? "gate",
    exemptions: new Set(String(process.env.GATE_EXEMPTIONS ?? "").split(",").filter(Boolean)),
    reportPath: process.env.GATE_REPORT ?? join(REPO_ROOT, "experiments", "regression-gate", "results-manual.json"),
    tempHome: process.env.GATE_TEMP ?? join(REPO_ROOT, ".tmp-regression-gate-home"),
  });
  process.exit(code);
}
