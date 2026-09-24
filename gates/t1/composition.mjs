/**
 * T1 零 LLM 组合层的组合面（票据 01 从 `gates/run.mjs` 拆出）。
 *
 * 职责：组合渲染的唯一入口（`gate` / `real` 两条路径）、CLI dump 复核、
 * loader id 唯一性、反劫持扫描（Q13）与「闸门不含部署位同步动作」扫描。
 * 断言口径与证据文案与拆分前逐字一致。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { composeEntries, healProfilesModuleFallback, loadOverlayPatches, loadProfile, renderConfigDump } from "@deepseek-ai/dsh-app-boot";
import { parseCompositionDump } from "../dump-parse.mjs";
import { sha256File, sha256Json, run, tailLines } from "../gate-helpers.mjs";
import { countEntries, findDuplicateIds } from "../unique-ids.mjs";
import { GATE_PATCH, GATE_SCRIPT, REPO_ROOT } from "../paths.mjs";
import { installAnchor } from "../host-pin.mjs";
import { REAL_PROFILE_NAME } from "../composition/render-real.mjs";
import { PreconditionError } from "../preconditions.mjs";

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
  // 票据 01 拆出的模块与拆出的部分同属闸门源码面，扫描范围随拆分扩展：
  join(REPO_ROOT, "gates", "paths.mjs"),
  join(REPO_ROOT, "gates", "gate-home.mjs"),
  join(REPO_ROOT, "gates", "report.mjs"),
  join(REPO_ROOT, "gates", "isolation.mjs"),
  join(REPO_ROOT, "gates", "host-pin.mjs"),
  join(REPO_ROOT, "gates", "preconditions.mjs"),
  join(REPO_ROOT, "gates", "t0.mjs"),
  join(REPO_ROOT, "gates", "t1", "run.mjs"),
  join(REPO_ROOT, "gates", "t1", "composition.mjs"),
  join(REPO_ROOT, "gates", "t1", "deployment.mjs"),
  join(REPO_ROOT, "gates", "t1", "preset.mjs"),
  join(REPO_ROOT, "gates", "t2.mjs"),
];
/** 反劫持禁用面（Q13）：假模型的 provider 名与模块路径。 */
const STUB_PROVIDER = "stub";
const STUB_PATH_PATTERNS = ["gates/stub", "gates\\stub"];
const STUB_TEXT_PATTERNS = [/provider: ['"]?stub['"]?/u, /name: ['"]?.*gates\/stub/u];

/**
 * 组合渲染的唯一入口（票据 03 的 `gate` + 票据 04 的 `real`）：
 *   - `gate`（默认）：repo preset 根 + 四个生产插件（`gates/composition/gate.patch.yml`），
 *     不读用户层、不依赖相邻仓库；
 *   - `real`（交付前）：票据 04 物化到临时 home 的真实 `tui-dev` profile 渲染副本，
 *     不再叠加闸门补丁（真实组合的内容全在渲染后的 profile 里）。
 * 两条路径都走 app-boot 的 `renderConfigDump`（与 `--dump-config` 同一算法）。
 */
export async function composeComposition({ tempHome, host, composition }) {
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

/** ① 组合导出：真实 `dsh --dump-config` 退出码 0（另一条渲染路径），并与进程内组合对照。 */
export function assertCompositionDump(t, config) {
  const real = config.composition === "real";
  const dumpArgs = real ? ["--profile", REAL_PROFILE_NAME, "--dump-config"] : ["--profile", "headless", "--patch", GATE_PATCH, "--dump-config"];
  const dumpRun = run("dsh", dumpArgs, { cwd: REPO_ROOT, env: config.env });
  const dumpText = dumpRun.stdout;
  const parsed = parseCompositionDump(dumpText);
  const cliCounts = parsed.entries === undefined ? undefined : countEntries(parsed.entries);
  const cliDuplicates = parsed.entries === undefined ? undefined : findDuplicateIds(parsed.entries);
  const dumpOk = dumpRun.status === 0 && cliCounts !== undefined;
  t[dumpOk ? "pass" : "fail"](
    "composition.dump-config",
    `exit ${String(dumpRun.status)} ${parsed.error === undefined ? `entries=${String(cliCounts?.ids)}` : `parse: ${parsed.error}`}`,
    { source: config.gate.patchPath, inProcessEntries: config.gate.composed.length, stderr: tailLines(dumpRun.stderr, 4) },
  );
  return { dumpText, cliCounts, cliDuplicates };
}

/**
 * ② 逐 loader id 递归计数 = 1：导出本身不做重复检测（patch 按 id 覆盖），必须单独断言；
 *    进程内组合与 CLI dump 两条路径分别计数，任一有重复即红。
 */
export function assertLoaderIdsUnique(t, config, cli) {
  const allDuplicates = [
    ...config.gate.duplicates.map((duplicate) => ({ ...duplicate, source: "in-process" })),
    ...(cli.cliDuplicates ?? []).map((duplicate) => ({ ...duplicate, source: "cli-dump" })),
  ];
  t[allDuplicates.length === 0 ? "pass" : "fail"](
    "composition.loader-id-unique",
    allDuplicates.length === 0
      ? `in-process ids=${String(config.gate.counts.ids)} cli ids=${String(cli.cliCounts?.ids)} duplicates=0`
      : `duplicates: ${allDuplicates.map((duplicate) => `${duplicate.path}/${duplicate.id}`).join(", ")}`,
    { inProcess: config.gate.counts, cli: cli.cliCounts, duplicates: allDuplicates },
  );
}

/** ③ 反劫持：组合中不出现假模型的 provider 名 / 模块路径（Q13）。 */
export function assertNoStub(t, config, dumpText) {
  const hits = findStubReferences(config.gate.composed, dumpText);
  t[hits.length === 0 ? "pass" : "fail"]("composition.no-stub", hits.length === 0 ? "no stub provider/module reference" : `stub references: ${hits.join(", ")}`);
}

// ⑪ 闸门自身不含部署位同步动作（同步仍是显式 scripts/sync-agent-presets.sh）。
export function assertNoDeploymentSync(t) {
  const offenders = GATE_SOURCES.filter((file) => hasActiveSyncCall(file));
  t[offenders.length === 0 ? "pass" : "fail"](
    "gate.no-deployment-sync",
    offenders.length === 0 ? `no sync invocation in ${String(GATE_SOURCES.length)} gate sources` : `sync invocation in: ${offenders.join(", ")}`,
  );
}
