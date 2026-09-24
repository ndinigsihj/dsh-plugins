/**
 * 回归闸门编排器（票据 03；票据 01 拆模块后的薄编排层）。
 *
 * 入口是 `scripts/regression-gate.sh`（单一命令、持仓库本地锁、建临时 home）；
 * 本模块只保留编排与 CLI 接线，各职责见拆分后的模块：
 *   - 前置检查 `gates/preconditions.mjs`、报告骨架与摘要 `gates/report.mjs`；
 *   - T0 `gates/t0.mjs`、T1 `gates/t1/{run,composition,preset}.mjs`、
 *     T2 `gates/t2.mjs`、T3 `gates/t3/run.mjs`；
 *   - 真实 home 指纹 `gates/isolation.mjs`、宿主钉版 `gates/host-pin.mjs`。
 *
 * 退出码三态（由本模块返回，bash 入口透传）：
 *   0 全过 / 1 任一断言失败 / 2 环境前置不满足（清单、宿主钉版、组合渲染缺依赖、
 *   T3 版本/基线来源不符或真实 settings 缺失）。
 *
 * 隔离：全部输入来自 repo 资产与临时 home（`GATE_TEMP`），真实 `~/.dsh` 只读；
 * 跨进程写目标只有报告文件与临时 home（T3 额外按日期归档到
 * `experiments/regression-gate/t3-*`）。
 */
import { mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT, createAssertions, run, sha256File, writeReport } from "./gate-helpers.mjs";
import { buildEnv, prepareProfile } from "./gate-home.mjs";
import { isolationAssertions, scanRealHome } from "./isolation.mjs";
import { installAnchor } from "./host-pin.mjs";
import { resolveDeploymentRoot } from "./manifest.mjs";
import { PRESET, REPO_ROOT } from "./paths.mjs";
import { PreconditionError, evaluatePreconditions } from "./preconditions.mjs";
import { createReport, printSummary, recordTier, summarizeTiers } from "./report.mjs";
import { runT0 } from "./t0.mjs";
import { composeComposition } from "./t1/composition.mjs";
import { runT1 } from "./t1/run.mjs";
import { runT2 } from "./t2.mjs";
import { runT3 } from "./t3/run.mjs";
import { REAL_PROFILE_NAME, RenderRealError, renderRealComposition } from "./composition/render-real.mjs";

/**
 * real 组合（票据 04）：读真实 tui-dev profile、按 env 渲染三类仓库根、物化到临时 home。
 * 缺相邻 checkout / 渲染后依赖不可解析 → 环境前置失败（exit 2），绝不回落自持组合。
 */
function renderRealInto(ctx) {
  const { options, manifest, host, report, pre } = ctx;
  if (options.composition !== "real" || host === undefined || manifest.status !== "ok") return null;
  const deploymentEntry = manifest.manifest.deployment?.[PRESET];
  try {
    const real = renderRealComposition({
      repoRoot: REPO_ROOT,
      tempHome: ctx.tempHome,
      presetName: PRESET,
      deploymentRoot: deploymentEntry === undefined ? undefined : resolveDeploymentRoot(deploymentEntry, homedir()),
      installAnchor: installAnchor(host),
      env: process.env,
      homeDir: homedir(),
    });
    ctx.env.SMOKE_PRESET_ROOT = real.preset.root;
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
    return real;
  } catch (error) {
    ctx.preconditionsOk = false;
    ctx.preconditionDetail = error instanceof RenderRealError ? error.message : `real composition render failed: ${String(error.message ?? error)}`;
    pre.fail("composition.real-render", ctx.preconditionDetail, error.detail);
    return null;
  }
}

/** 进程内组合渲染；前置失败（PreconditionError）与普通异常分别记账。 */
async function composeGateInto(ctx) {
  const { options, host, pre } = ctx;
  if (!ctx.preconditionsOk || host === undefined || !options.tiers.includes(1)) return null;
  try {
    return await composeComposition({ tempHome: ctx.tempHome, host, composition: options.composition });
  } catch (error) {
    ctx.gateError = error;
    if (error instanceof PreconditionError) {
      ctx.preconditionsOk = false;
      ctx.preconditionDetail = error.message;
      pre.fail("composition.render", `${error.message}`, error.detail);
    } else {
      pre.fail("composition.render", String(error.message ?? error));
    }
    return null;
  }
}

/** 层前置不满足时的单条 skip 断言（证据文案与拆分前一致）。 */
function skipTier(id, detail) {
  return [{ id: `tier.${id}`, status: "skip", evidence: `precondition not met: ${String(detail)}` }];
}

function runTier0(ctx) {
  if (!ctx.options.tiers.includes(0)) return;
  if (!ctx.preconditionsOk) {
    ctx.tiers.push(recordTier("T0", skipTier("T0", ctx.preconditionDetail)));
    return;
  }
  const started = Date.now();
  ctx.tiers.push(recordTier("T0", runT0(ctx.env), started));
}

function runTier1(ctx) {
  const { options, report } = ctx;
  if (!options.tiers.includes(1)) return;
  if (ctx.gate === null) {
    ctx.tiers.push(recordTier("T1", skipTier("T1", ctx.gateError?.message ?? ctx.preconditionDetail)));
    return;
  }
  const config = {
    tempHome: ctx.tempHome,
    env: ctx.env,
    gate: ctx.gate,
    composition: options.composition,
    real: ctx.real,
    manifestObj: ctx.manifest.manifest,
    host: ctx.host,
    exemptions: ctx.exemptions,
    exemptionsApplied: ctx.exemptionsApplied,
    realHomeBefore: ctx.realHomeBefore,
  };
  const started = Date.now();
  ctx.tiers.push(recordTier("T1", runT1(config, report), started));
  report.compositionDumpSha = ctx.gate.dumpSha256;
  report.compositionEntriesSha = ctx.gate.composedSha256;
  report.compositionArtifact = ctx.gate.dumpPath;
  if (options.composition === "gate") {
    // gate：渲染产物（dump）即「验的那一份」的 sha 记录面（票据 03 的既有 schema）。
    report.compositionRenderedPath = ctx.gate.dumpPath;
    report.compositionRenderedSha = ctx.gate.dumpSha256;
  }
  report.copies = {
    profileCordisSha: sha256File(join(ctx.tempHome, "profiles", "headless", "cordis.yml")),
    ...(ctx.real === null ? {} : { realProfileCordisSha: sha256File(join(ctx.tempHome, "profiles", REAL_PROFILE_NAME, "cordis.yml")) }),
  };
}

function runTier2(ctx) {
  if (!ctx.options.tiers.includes(2)) return;
  if (!ctx.preconditionsOk) {
    ctx.tiers.push(recordTier("T2", skipTier("T2", ctx.preconditionDetail)));
    return;
  }
  // T2 用自持的 stub 组合（headless + gates/stub/stub.patch.yml + repo preset 根），
  // 与 --composition 无关：它验的是 preset/agent-loop 机制，不是交付态组合内容。
  // 隔离窗口取「运行开始 → T2 结束」累计，覆盖 T2 自身的写入面（票据 12 审查 c1）。
  const started = Date.now();
  const assertions = runT2({ tempHome: ctx.tempHome, env: ctx.env, report: ctx.report, manifestObj: ctx.manifest.manifest });
  assertions.push(...isolationAssertions("t2.isolation.real-home-untouched", ctx.realHomeBefore, scanRealHome(ctx.manifest.manifest)));
  ctx.tiers.push(recordTier("T2", assertions, started));
}

function runTier3(ctx) {
  const { options } = ctx;
  if (!options.tiers.includes(3)) return;
  if (ctx.t3Refusal !== null) {
    ctx.tiers.push(recordTier("T3", [{ id: "tier.T3", status: "skip", evidence: `refused: ${ctx.t3Refusal} — re-capture the baseline, then rerun --tier 3` }]));
    return;
  }
  if (!ctx.preconditionsOk) {
    ctx.tiers.push(recordTier("T3", skipTier("T3", ctx.preconditionDetail)));
    return;
  }
  const started = Date.now();
  let assertions;
  try {
    assertions = runT3({ tempHome: ctx.tempHome, env: ctx.env, report: ctx.report, manifestObj: ctx.manifest.manifest, host: ctx.host });
  } catch (error) {
    assertions = [{ id: "t3.run", status: "fail", evidence: `T3 runner failed: ${String(error?.message ?? error)}` }];
  }
  assertions.push(...isolationAssertions("t3.isolation.real-home-untouched", ctx.realHomeBefore, scanRealHome(ctx.manifest.manifest)));
  ctx.tiers.push(recordTier("T3", assertions, started));
}

/** 收尾：PRE 前置层、汇总、落盘、终端摘要与退出码。 */
function finalizeGate(ctx, startedAt) {
  const { report, pre, options } = ctx;
  if (pre.assertions.length > 0) {
    ctx.tiers.unshift({
      id: "PRE",
      status: pre.assertions.some((assertion) => assertion.status === "fail") ? "fail" : "pass",
      startedAt,
      durationMs: 0,
      assertions: pre.assertions,
    });
  }
  report.tiers = ctx.tiers;
  report.finishedAt = new Date().toISOString();
  report.summary = summarizeTiers(ctx.tiers);
  writeReport(options.reportPath, report);
  printSummary(report, options.reportPath);
  if (!ctx.preconditionsOk) return EXIT.precondition;
  if (ctx.t3Refusal !== null && options.tiers.includes(3)) return EXIT.precondition;
  if (report.summary.failed > 0) return EXIT.fail;
  return EXIT.pass;
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
  const report = createReport(options, startedAt, {
    gitHead: head.status === 0 ? head.stdout.trim() : undefined,
    gitDirty: status.status === 0 ? status.stdout.trim().length > 0 : undefined,
  });
  const pre = createAssertions();
  const { manifest, host, preconditionsOk, preconditionDetail, t3Refusal } = evaluatePreconditions({ options, pre, report });

  const tempHome = options.tempHome;
  const env = buildEnv(tempHome);
  mkdirSync(join(tempHome, "gate"), { recursive: true });
  prepareProfile(tempHome);
  const realHomeBefore = scanRealHome(manifest.status === "ok" ? manifest.manifest : { deployment: {} });

  const ctx = {
    options,
    report,
    pre,
    manifest,
    host,
    preconditionsOk,
    preconditionDetail,
    t3Refusal,
    tempHome,
    env,
    realHomeBefore,
    exemptions: options.exemptions ?? new Set(),
    exemptionsApplied: [],
    tiers: [],
    gate: null,
    gateError: null,
    real: null,
  };
  report.exemptions = ctx.exemptionsApplied;

  ctx.real = renderRealInto(ctx);
  ctx.gate = await composeGateInto(ctx);
  runTier0(ctx);
  runTier1(ctx);
  runTier2(ctx);
  runTier3(ctx);
  return finalizeGate(ctx, startedAt);
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
