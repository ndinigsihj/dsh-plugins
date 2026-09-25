#!/usr/bin/env node
/**
 * T3 真实模型层 runner（票据 11；计划 §3.4、§4.3、§5.4、§7 P4）。
 *
 * 只在显式 `--tier 3` 时运行（按需层，不进 release、不进 CI）：把仓库里既有的真实
 * 模型资产重跑到隔离临时 home，并把原始产物按 UTC 时间戳归档到仓库实验目录：
 *   1. M4 行为批次（`experiments/m4/m4-runner.mjs`，E 组 N=清单值）→ 行为锚定判定；
 *   2. 子代理模型选择探针（`experiments/subagent-model-selection/probe.mjs`）→ 全部 check；
 *   3. 允许路由探针（`experiments/subagent-model-selection/route-probe.mjs`）→ 逐路由。
 *
 * 隔离（计划 §2.2/Q2）：DSH_HOME 与 HOME 都指向闸门临时 home；真实扫描源（`~/.dsh/settings.yaml`、
 * credentials）只读复制进临时 home；settings 副本 600、报告只记 sha；探针的
 * settings/session root 由 env 参数化（patch 内默认值不变，单独运行 run.sh 不受影响）。
 * 0.1.7 载体（票据 11）：preset 不再读 `~/.dsh/.agent-presets/<id>/` 目录形态，改为从仓库真源
 * 现场生成 bundle 接进 T3 隔离 profile；部署位落位（票据 12）后再评估切 deployed bundle。
 *
 * 版本闸门（用户决策 Q3）：宿主版本或会话格式与清单不符、基线来源宿主不符、真实 settings
 * 缺失 → 本层拒绝运行。runGate 在分层前用 `t3ProvenanceProblems` 判定并返回 exit 2；
 * 本模块内的同类检查是防御性兜底（避免被直接调用时拿旧数字当结论）。
 */
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SESSION_FORMAT_VERSION } from "@deepseek-ai/dsh-session";
import { createAssertions, sha256File } from "../gate-helpers.mjs";
import { checkBaselines, checkDeployment } from "../manifest.mjs";
import { prepareHeadlessPresetProfile } from "../../scripts/profile-home.mjs";
import { summarize } from "../../experiments/m4/summarize.mjs";
import { SETTINGS_BASELINE } from "../../experiments/subagent-model-selection/allowed-routes.mjs";
import { m4Outcome, probeOutcome, routeOutcome, t3ProvenanceProblems } from "./analysis.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PRESET = "minimal-plus";
/** T3 专用隔离 profile：headless 骨架 + 宿主作用域模型选择单例（默认 disabled）。 */
const T3_PROFILE = "t3-headless";
const M4_GROUP = "E";
const M4_PATCH = join(REPO_ROOT, "experiments", "m4", "m4.patch.yml");
const MODEL_SELECTION_PATCH = join(REPO_ROOT, "experiments", "subagent-model-selection", "probe.patch.yml");
const ROUTE_PROBE_PATCH = join(REPO_ROOT, "experiments", "subagent-model-selection", "route-probe.patch.yml");
/** 探针关键 check 白名单：被悄悄删掉时必须变红（同 T1 seeded 探针的处置）。 */
const PROBE_CHECK_IDS = [
  "a1-host-service-mounted",
  "a2-preset-model-selection-schema",
  "a3-discovery-tool-visible",
  "a5-explicit-route-used",
  "a7-omitted-route-inherits",
  "a10-old-session-stays-off",
  "a14-whitelist-route-compliance",
];
const DEFAULT_TIMEOUT_MS = 900_000;

export class T3PreconditionError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "T3PreconditionError";
    this.detail = detail;
  }
}

function failureText(error) {
  return error instanceof Error ? error.message : String(error);
}

function tailLines(text, count) {
  return String(text).trim().split("\n").slice(-count);
}

function runProcess(command, args, { env, timeoutMs }) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return {
    status: result.status,
    signal: result.signal,
    error: result.error === undefined ? undefined : failureText(result.error),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** UTC 时间戳目录名（日期在内、秒级，跨轮次不覆盖）。 */
function createArchiveDir() {
  const base = join(REPO_ROOT, "experiments", "regression-gate");
  const stamp = `t3-${new Date().toISOString().replace(/[:.]/gu, "-")}`;
  let candidate = join(base, stamp);
  let suffix = 1;
  while (existsSync(candidate)) {
    candidate = join(base, `${stamp}-${String(suffix)}`);
    suffix += 1;
  }
  mkdirSync(candidate, { recursive: true });
  return candidate;
}

/**
 * T3 专用隔离 profile（0.1.7 载体）：headless 骨架 + 从仓库真源现场生成的 preset bundle，
 * 另挂宿主作用域 `subagent-model-selection-settings`（插件默认 enabled=false）。
 *
 * 为什么需要：minimal-plus 的 delegation/tool-subagent 声明了
 * `modelSelectionSettings: true`，宿主缺单例时 preset 直接挂载失败；真实运行态里这行
 * 由 profile patch 提供（tui-dev enabled=true；headless 机器上为 enabled=false）。
 * 每个资产用独立 profile 名：模型选择探针的 a9 会编辑所在 profile 的用户配置层，共享
 * profile 会把编辑后的设置污染给后面的路由探针（0.1.7 设置面按 profile 条目存放）；
 * 且被 `--patch` overlay 覆盖的条目会被 settings 编辑器拒写，所以探针的部署基线
 * （允许路由集合）放在 profile 层 `settingsConfig`，不放进 overlay。
 * preset 载体从仓库真源生成：部署位当前仍是旧目录形态（票据 12 落位），不参与本层加载。
 */
function prepareT3Profile(tempHome, name, settingsConfig) {
  const presetSourceDir = join(REPO_ROOT, "presets", PRESET);
  const prepared = prepareHeadlessPresetProfile({
    home: tempHome,
    name,
    sourceDir: presetSourceDir,
    sourceLabel: join("presets", PRESET),
    settingsSingleton: true,
    ...(settingsConfig === undefined ? {} : { settingsConfig }),
  });
  return {
    name,
    patchSha256: sha256File(prepared.patchPath),
    presetSourceDir,
    presetBundleDir: prepared.bundleDir,
    presetBundlePatchSha256: sha256File(join(prepared.bundleDir, "cordis.patch.yml")),
  };
}

/** 复制只读源到隔离 home 并收紧权限（settings/credentials 副本统一 600）。 */
function materializeSecret(source, target) {
  copyFileSync(source, target);
  chmodSync(target, 0o600);
}

/**
 * 每次新 profile 首次启动会从默认 `$DSH_HOME/settings.yaml` 导入插件段（llm 适配器等）并把
 * 文档改名；M4 启动后该文档已不在，探针 profile 看不到 provider。探针进程前重新物化默认文档。
 */
function restageDefaultSettings(tempHome, settingsSource) {
  materializeSecret(settingsSource, join(tempHome, "settings.yaml"));
}

/**
 * 真实扫描源物化到临时 home：真实 `~/.dsh/settings.yaml` 副本（每资产一份，600）与
 * provider 凭据副本。只读源，绝不写真实 home。preset 已由 `prepareT3Profile` 从仓库
 * 真源生成载体，不再走 `.agent-presets` 目录形态。
 */
function stageRealInputs({ tempHome, homeDir }) {
  const settingsSource = join(homeDir, ".dsh", "settings.yaml");
  if (!existsSync(settingsSource)) {
    throw new T3PreconditionError(`real settings not found: ${settingsSource}; T3 needs real provider credentials`);
  }
  // 每个资产一份 settings 副本：M4 用默认 `$DSH_HOME/settings.yaml`，两个探针各用一份。
  // 模型选择探针的 a9「设置编辑」会写自己的 settings（这正是它的断言面），共享文件会把
  // 编辑后的集合污染给后面的路由探针——票据 12 的 run.sh 用各自独立 root 已隐含这点。
  const settingsTargets = {
    m4: join(tempHome, "settings.yaml"),
    modelSelection: join(tempHome, "t3", "settings-model-selection.yaml"),
    routeProbe: join(tempHome, "t3", "settings-route-probe.yaml"),
  };
  for (const target of Object.values(settingsTargets)) {
    mkdirSync(dirname(target), { recursive: true });
    materializeSecret(settingsSource, target);
  }
  // provider 凭据走 `$DSH_HOME/.credentials.yaml`（dsh-credentials-local）：复制副本让隔离
  // home 内能真实认证；报告只记 sha，绝不记内容。缺失不拒绝（密钥也可能由 env 提供）。
  const credentialsSource = join(homeDir, ".dsh", ".credentials.yaml");
  const credentialsCopied = existsSync(credentialsSource);
  if (credentialsCopied) {
    materializeSecret(credentialsSource, join(tempHome, ".credentials.yaml"));
  }
  return {
    settingsSource,
    settingsSha256: sha256File(settingsTargets.m4),
    settingsPaths: settingsTargets,
    credentialsCopied,
    credentialsSha256: credentialsCopied ? sha256File(join(tempHome, ".credentials.yaml")) : undefined,
  };
}

/** 从 M4 隔离会话根里找一条无策略事件的旧会话（优先 E1），供探针 resume。 */function findM4Session(m4SessionsRoot) {
  if (!existsSync(m4SessionsRoot)) return null;
  for (const slug of readdirSync(m4SessionsRoot, { withFileTypes: true })) {
    if (!slug.isDirectory()) continue;
    const slugDir = join(m4SessionsRoot, slug.name);
    const sessions = readdirSync(slugDir, { withFileTypes: true }).filter((item) => item.isDirectory() && item.name.startsWith("session-m4-"));
    const picked = sessions.find((item) => item.name.startsWith("session-m4-E1-")) ?? sessions[0];
    if (picked !== undefined) return { slug: slug.name, id: picked.name, path: join(slugDir, picked.name) };
  }
  return null;
}

/** 读 JSONL 批次（跳过 `#` 注释行；坏行只记录不中断）。 */
function readJsonl(path) {
  if (!existsSync(path)) return { records: [], broken: [] };
  const records = [];
  const broken = [];
  for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch (error) {
      broken.push({ line: index + 1, error: failureText(error) });
    }
  }
  return { records, broken };
}

/**
 * M4 任务按历史口径在仓库 cwd 生成 `m4-probe-<group><run>.txt`（跨轮次残留由人工清理）。
 * T3 跑完后只删除内容与本次任务模板一致的文件，避免留下仓库脏文件。
 */
function cleanupM4ProbeFiles(group, runs) {
  for (let run = 1; run <= runs; run += 1) {
    const file = join(REPO_ROOT, `m4-probe-${group}${String(run)}.txt`);
    if (!existsSync(file)) continue;
    if (readFileSync(file, "utf8").trim() === `M4 probe ${group}-${String(run)}`) unlinkSync(file);
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { error: failureText(error), code: error?.code };
  }
}

/** 新增归档文件记录（路径 + sha）；文件不存在返回 undefined。 */
function archiveEntry(name, path) {
  const sha256 = sha256File(path);
  return sha256 === undefined ? undefined : { name, path, sha256 };
}

function assertionEvidence(outcome) {
  return `records=${String(outcome.records)}/${String(outcome.expectedRuns)} anchored=${String(outcome.anchored)}/${String(outcome.threshold)} (tolerance ${String(outcome.tolerance)}) check3=${String(outcome.check3)} check4=${String(outcome.check4)} errors=${String(outcome.errors.length)}`;
}

/**
 * 跑 T3 并把断言与 `report.t3` 填好。调用方保证前置（host/format/基线/settings）已过；
 * 内部仍做防御性检查，前置不满足时该层整体 skip。
 */
export function runT3({ tempHome, env, report, manifestObj, host }) {
  const t = createAssertions();
  const homeDir = homedir();
  const timeoutMs = Number(process.env.GATE_T3_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const capturedAt = new Date().toISOString();
  const problems = t3ProvenanceProblems(manifestObj, {
    hostVersion: host.version,
    sessionFormatVersion: SESSION_FORMAT_VERSION,
    settingsPresent: existsSync(join(homeDir, ".dsh", "settings.yaml")),
  });
  if (problems.length > 0) {
    t.skip("tier.T3", `refused: ${problems.map((problem) => problem.detail).join("; ")} — re-capture the baseline, then rerun --tier 3`);
    return t.assertions;
  }

  const t3Config = manifestObj.t3;
  const baselineId = t3Config.baseline;
  const baseline = manifestObj.baselines[baselineId];
  const runs = baseline.runs;
  const tolerance = t3Config.tolerance ?? 0;
  const model = String(process.env.GATE_T3_MODEL ?? baseline.model).trim();
  const archiveDir = createArchiveDir();
  const childEnv = { ...env, DSH_HOME: tempHome, HOME: tempHome };

  const staged = stageRealInputs({ tempHome, homeDir });
  // M4 测量保持单例默认（enabled=false，与真实 headless 测量口径一致）；两个探针用部署基线。
  const m4Profile = prepareT3Profile(tempHome, T3_PROFILE);
  const probeProfile = prepareT3Profile(tempHome, `${T3_PROFILE}-probe`, SETTINGS_BASELINE);
  const routeProfile = prepareT3Profile(tempHome, `${T3_PROFILE}-route`, SETTINGS_BASELINE);
  const deployment = checkDeployment(manifestObj, { repoRoot: REPO_ROOT, homeDir });
  const baselineFiles = checkBaselines(manifestObj, { repoRoot: REPO_ROOT });
  const baselineState = baselineFiles.baselines.find((entry) => entry.id === baselineId);
  t[baselineState?.state === "ok" ? "pass" : "fail"](
    "t3.baseline.file-intact",
    `baseline ${baselineId} state=${String(baselineState?.state)} sha256=${String(baselineState?.expected ?? "").slice(0, 12)}`,
    { path: baseline.path, hint: "re-capture the baseline and update gates/manifest.json if the batch file changed" },
  );
  const modelMatchesBaseline = model === baseline.model;
  t[modelMatchesBaseline ? "pass" : "fail"](
    "t3.model.baseline-match",
    `model=${model} baseline=${baseline.model}`,
    { hint: "GATE_T3_MODEL override recorded; re-capture the baseline (manifest) if the route intentionally changed" },
  );

  // ── ① M4 行为批次 ────────────────────────────────────────────────────────
  const m4Out = join(archiveDir, `m4-${M4_GROUP}.jsonl`);
  const m4SessionsRoot = join(tempHome, "t3", "m4-sessions");
  const m4Started = Date.now();
  const m4Run = runProcess("dsh", ["--profile", m4Profile.name, "--patch", M4_PATCH], {
    env: {
      ...childEnv,
      M4_GROUPS: M4_GROUP,
      M4_RUNS: String(runs),
      M4_OUT: m4Out,
      M4_MODEL: model,
      M4_SESSION_ROOT: m4SessionsRoot,
    },
    timeoutMs,
  });
  const m4 = readJsonl(m4Out);
  cleanupM4ProbeFiles(M4_GROUP, runs);
  const outcome = m4Outcome(m4.records, { runs, tolerance });
  const reportM4 = {
    exit: m4Run.status,
    elapsedMs: Date.now() - m4Started,
    model,
    archive: archiveEntry(`m4-${M4_GROUP}.jsonl`, m4Out),
    brokenLines: m4.broken,
    ...outcome,
  };
  t[m4Run.status === 0 ? "pass" : "fail"](
    "t3.m4.batch-exit",
    `exit ${String(m4Run.status)}${m4Run.error === undefined ? "" : ` error=${m4Run.error}`}`,
    { stderr: tailLines(m4Run.stderr, 4) },
  );
  t[outcome.recordsOk ? "pass" : "fail"](
    "t3.m4.records-complete",
    `records=${String(outcome.records)} expected=${String(runs)} broken=${String(m4.broken.length)}`,
    { archive: m4Out },
  );
  t[outcome.behaviourOk ? "pass" : "fail"]("t3.m4.behaviour-anchored", assertionEvidence(outcome), {
    threshold: outcome.threshold,
    nonBashFirstTools: outcome.nonBashFirstTools,
    errors: outcome.errors,
    providerErrors: outcome.providerErrors,
    hint: "behaviour anchoring = first response has a tool call and its first tool is bash",
  });
  t[outcome.check3Ok ? "pass" : "fail"]("t3.m4.agent-instructions", `check3=${String(outcome.check3)}/${String(outcome.threshold)}`, { archive: m4Out });
  t[outcome.check4Ok ? "pass" : "fail"]("t3.m4.sandbox-bash", `check4=${String(outcome.check4)}/${String(outcome.threshold)}`, { archive: m4Out });
  t[reportM4.archive === undefined ? "fail" : "pass"](
    "t3.m4.archive",
    reportM4.archive === undefined
      ? `no batch archive at ${m4Out}`
      : `archive sha256=${reportM4.archive.sha256.slice(0, 12)} runs=${String(runs)} host=${host.version} model=${model} capturedAt=${capturedAt}`,
    { path: m4Out },
  );
  // 口径措辞统计只进报告与 advisory 行，永不判红（计划 §8）。
  let advisory;
  try {
    const [row] = summarize(m4Out);
    advisory = row === undefined ? undefined : { anchorRate: row.anchorRate, weNeed: row.weNeed, letMe: row.letMe, toolCall: row.toolCall, avgTools: row.avgTools };
  } catch (error) {
    advisory = { error: failureText(error) };
  }
  reportM4.advisory = advisory;
  t.pass(
    "t3.m4.advisory-wording",
    advisory === undefined || advisory.error !== undefined
      ? "advisory unavailable (not gated)"
      : `advisory only, not asserted: anchorRate=${String(advisory.anchorRate)} weNeed=${String(advisory.weNeed)} letMe=${String(advisory.letMe)} toolCall=${String(advisory.toolCall)} avgTools=${String(advisory.avgTools)}`,
  );

  // ── ② 模型选择探针（旧会话取本窗口 M4 批次的隔离副本）────────────────────
  restageDefaultSettings(tempHome, staged.settingsSource);
  const probeSessionsRoot = join(tempHome, "t3", "probe-sessions");
  const oldSession = findM4Session(m4SessionsRoot);
  if (oldSession !== null) {
    const target = join(probeSessionsRoot, oldSession.slug, oldSession.id);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(oldSession.path, target, { recursive: true });
  }
  const probeOut = join(archiveDir, "model-selection-probe.json");
  const probeStarted = Date.now();
  const probeRun = runProcess("dsh", ["--profile", probeProfile.name, "--patch", MODEL_SELECTION_PATCH], {
    env: {
      ...childEnv,
      PROBE_OUT: probeOut,
      PROBE_SETTINGS_PATH: staged.settingsPaths.modelSelection,
      PROBE_SESSION_ROOT: probeSessionsRoot,
      ...(oldSession === null ? {} : { PROBE_OLD_SESSION_ID: oldSession.id }),
    },
    timeoutMs,
  });
  const probeReport = readJson(probeOut);
  const probe = probeOutcome(probeReport, PROBE_CHECK_IDS);
  const probeArchive = archiveEntry("model-selection-probe.json", probeOut);
  const reportProbe = {
    exit: probeRun.status,
    elapsedMs: Date.now() - probeStarted,
    oldSession: oldSession === null ? null : { id: oldSession.id, source: `m4-${M4_GROUP}-copy` },
    parent: probeReport?.parent,
    allowed: probeReport?.allowedX,
    archive: probeArchive,
    total: probe.total,
    passed: probe.passed,
    failed: probe.failed,
    missing: probe.missing,
    summary: probeReport?.summary,
  };
  t[probeRun.status === 0 && probe.allPass ? "pass" : "fail"](
    "t3.model-selection-probe.all-checks",
    `exit ${String(probeRun.status)} ${String(probe.passed)}/${String(probe.total)} pass failed=${JSON.stringify(probe.failed)} missing=${JSON.stringify(probe.missing)}`,
    { archive: probeOut, stderr: tailLines(probeRun.stderr, 4) },
  );
  t[probeArchive === undefined ? "fail" : "pass"](
    "t3.model-selection-probe.archive",
    probeArchive === undefined
      ? `no probe report at ${probeOut}`
      : `archive sha256=${probeArchive.sha256.slice(0, 12)} checks=${String(probe.total)} oldSession=${String(oldSession?.id)} capturedAt=${capturedAt}`,
    { oldSession: oldSession?.id },
  );

  // ── ③ 允许路由探针 ──────────────────────────────────────────────────────
  restageDefaultSettings(tempHome, staged.settingsSource);
  const routeOut = join(archiveDir, "route-probe.json");
  const routeSessionsRoot = join(tempHome, "t3", "route-sessions");
  const routeStarted = Date.now();
  const routeRun = runProcess("dsh", ["--profile", routeProfile.name, "--patch", ROUTE_PROBE_PATCH], {
    env: {
      ...childEnv,
      PROBE_OUT: routeOut,
      ROUTE_PROBE_SETTINGS_PATH: staged.settingsPaths.routeProbe,
      ROUTE_PROBE_SESSION_ROOT: routeSessionsRoot,
    },
    timeoutMs,
  });
  const routeReport = readJson(routeOut);
  const route = routeOutcome(routeReport);
  const routeArchive = archiveEntry("route-probe.json", routeOut);
  const reportRoute = {
    exit: routeRun.status,
    elapsedMs: Date.now() - routeStarted,
    parent: routeReport?.parent,
    allowed: routeReport?.allowed,
    archive: routeArchive,
    total: route.total,
    passed: route.passed,
    routes: route.routes,
    summary: routeReport?.summary,
  };
  t[routeRun.status === 0 && route.allPass ? "pass" : "fail"](
    "t3.route-probe.all-routes",
    `exit ${String(routeRun.status)} ${String(route.passed)}/${String(route.total)} pass routes=${JSON.stringify(route.routes.map((item) => `${item.route}:${item.pass ? "pass" : item.failureKinds.join("+") || "fail"}`))}`,
    { archive: routeOut, stderr: tailLines(routeRun.stderr, 4) },
  );
  t[routeArchive === undefined ? "fail" : "pass"](
    "t3.route-probe.archive",
    routeArchive === undefined ? `no route report at ${routeOut}` : `archive sha256=${routeArchive.sha256.slice(0, 12)} routes=${String(route.total)} capturedAt=${capturedAt}`,
    { path: routeOut },
  );

  // ── 报告内嵌溯源面（票面：宿主版本、组合 sha、采集日期、样本量）──────────
  report.t3 = {
    capturedAt,
    hostVersion: host.version,
    sessionFormatVersion: SESSION_FORMAT_VERSION,
    model,
    modelMatchesBaseline,
    runs,
    tolerance,
    timeoutMs,
    baseline: {
      id: baselineId,
      path: baseline.path,
      sha256: baseline.sha256,
      runs: baseline.runs,
      hostVersion: baseline.hostVersion,
      state: baselineState?.state,
    },
    composition: {
      profile: m4Profile.name,
      profilePatchSha256: m4Profile.patchSha256,
      // 三个资产各用独立 profile：a9 的设置编辑只落在模型选择探针自己的 profile 上。
      probeProfiles: {
        modelSelection: { name: probeProfile.name, patchSha256: probeProfile.patchSha256 },
        route: { name: routeProfile.name, patchSha256: routeProfile.patchSha256 },
      },
      preset: PRESET,
      // 0.1.7 载体：preset 从仓库真源现场生成 bundle（部署位仍为旧目录形态，随票据 12 落位）。
      presetSource: "repo",
      presetPath: m4Profile.presetSourceDir,
      presetSha256: sha256File(join(m4Profile.presetSourceDir, "agent.cordis.yml")),
      presetBundleDir: m4Profile.presetBundleDir,
      presetBundlePatchSha256: m4Profile.presetBundlePatchSha256,
      manifestSha256: manifestObj.deployment?.[PRESET]?.files?.["agent.cordis.yml"],
      deploymentStatus: deployment.status,
      deploymentDrift: deployment.files.filter((file) => file.state !== "ok").map((file) => file.name),
      settingsSha256: staged.settingsSha256,
      settingsCopies: Object.values(staged.settingsPaths).length,
      credentialsCopied: staged.credentialsCopied,
      credentialsSha256: staged.credentialsSha256,
    },
    assets: {
      m4PatchSha256: sha256File(M4_PATCH),
      modelSelectionPatchSha256: sha256File(MODEL_SELECTION_PATCH),
      routeProbePatchSha256: sha256File(ROUTE_PROBE_PATCH),
    },
    archive: {
      dir: archiveDir,
      files: [reportM4.archive, probeArchive, routeArchive].filter((entry) => entry !== undefined),
    },
    m4: reportM4,
    modelSelectionProbe: reportProbe,
    routeProbe: reportRoute,
  };
  const provenanceOk =
    report.t3.hostVersion === host.version &&
    report.t3.capturedAt === capturedAt &&
    report.t3.runs === runs &&
    typeof report.t3.composition.presetSha256 === "string" &&
    typeof report.t3.composition.profilePatchSha256 === "string" &&
    report.t3.archive.files.length >= 3;
  t[provenanceOk ? "pass" : "fail"](
    "t3.report.provenance",
    `host=${host.version} sessionFormat=${String(SESSION_FORMAT_VERSION)} profile=${report.t3.composition.profile} presetSha=${String(report.t3.composition.presetSha256).slice(0, 12)} credentials=${staged.credentialsCopied ? String(staged.credentialsSha256).slice(0, 12) : "not-copied"} runs=${String(runs)} capturedAt=${capturedAt} archive=${archiveDir}`,
  );
  return t.assertions;
}
