/**
 * T1 的 preset 行为冒烟断言（票据 01 从 `gates/run.mjs` 拆出）：
 * R1 锚定对 / R2 沙箱 bash 与二轮注入（期望面见 `gates/expectations.json`）、
 * 降级 fail-open 路径、seeded 预览探针（仓库 fixture + 临时 store）。
 */
import { join } from "node:path";
import { readJson, run, tailLines } from "../gate-helpers.mjs";
import { DEGRADE_SMOKE, PRESET, REPO_ROOT, SEEDED_RUN, SMOKE_BOOT } from "../paths.mjs";

/** seeded 预览探针的 id 白名单：红线断言被删掉时闸门必须变红。 */
const SEEDED_PROBE_IDS = [
  "fixture-store-prepared",
  "fixture-copied-byte-identical",
  "seeded-readSession-aligned",
  "listEvents-has-corpus",
  "green-count-and-seq-match",
  "green-inherited-count-recorded",
  "baseline-readSession-fastpath",
];

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

/**
 * ④ 零 LLM 组合冒烟：R1 锚定对 / R2 沙箱 bash / 工具集合与二轮注入
 * （期望面见 gates/expectations.json）。
 */
export function assertPresetSmoke(t, config, report) {
  const expected = readJson(join(REPO_ROOT, "gates", "expectations.json"))?.presets?.[PRESET];
  const smoke = run("node", [SMOKE_BOOT], { cwd: REPO_ROOT, env: config.env });
  const r1 = jsonField(smoke.stdout, "ROUND1 catalog:");
  const r2 = jsonField(smoke.stdout, "ROUND2 catalog:");
  const preStep2 = jsonField(smoke.stdout, "ROUND2 pre-step sources:");
  const roster = jsonField(smoke.stdout, "ROSTER preset:");

  // 载体断言（票据 07）：0.1.7 声明行真的进了 registry roster，且展示名来自 preset.yml。
  const rosterOk = roster?.id === PRESET && typeof roster?.name === "string" && roster.name.length > 0 && roster.broken === undefined;
  t[rosterOk ? "pass" : "fail"](
    "smoke.preset-roster",
    rosterOk ? `id=${PRESET} name=${roster.name}` : `roster=${JSON.stringify(roster ?? null)} exit=${String(smoke.status)}`,
    { stderr: tailLines(smoke.stderr, 4) },
  );

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
  report.smoke = { preset: roster, r1Tools, toolCount: r2Tools.length, tools: r2Tools, preStepSources: r2Sources };
}

/** ⑤ 降级路径冒烟（缺 bootstrap 工具 → fail-open 全量目录）。preset 来源跟随组合模式。 */
export function assertDegradeFailOpen(t, config) {
  const degrade = run("bash", [DEGRADE_SMOKE], {
    cwd: REPO_ROOT,
    env: { ...config.env, DEGRADE_SMOKE_ROOT: join(config.tempHome, "degrade"), DEGRADE_SMOKE_SOURCE_ROOT: config.env.SMOKE_PRESET_ROOT },
  });
  const degradeOut = `${degrade.stdout}\n${degrade.stderr}`;
  const failOpen = degradeOut.includes("bootstrap disabled, full catalog exposed");
  const r1Degraded = jsonField(degrade.stdout, "ROUND1 catalog:");
  t[degrade.status === 0 && failOpen ? "pass" : "fail"](
    "degrade.fail-open",
    `exit ${String(degrade.status)} warning=${String(failOpen)} R1 tools=${String(r1Degraded?.tools?.length ?? "?")}`,
    { stderr: tailLines(degrade.stderr, 3) },
  );
}

/** ⑥ seeded 预览探针（仓库 fixture + 临时 store；红线断言按 id 白名单核对）。 */
export function assertSeededPreview(t, config, report) {
  const seeded = run("bash", [SEEDED_RUN], {
    cwd: REPO_ROOT,
    env: { ...config.env, SEEDED_PREVIEW_ROOT: join(config.tempHome, "seeded"), PROBE_OUT: join(config.tempHome, "seeded", "probe.json") },
  });
  const probe = readJson(join(config.tempHome, "seeded", "probe.json"));
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
}
