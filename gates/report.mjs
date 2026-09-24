/**
 * 闸门报告骨架、分层记录与终端摘要（票据 01 从 `gates/run.mjs` 拆出）。
 *
 * 对外行为零变化：报告字段名与键序即 JSON 落盘顺序，拆分时逐字保留；
 * 报告在运行中的增量赋值顺序仍由 `gates/run.mjs` 与各层保持。
 */
import { SESSION_FORMAT_VERSION } from "@deepseek-ai/dsh-session";
import { GATE_VERSION, sha256File } from "./gate-helpers.mjs";
import { GATE_PATCH } from "./paths.mjs";

/**
 * runGate 的初始报告（键序即 JSON 键序，不得调整）。
 * @param options 闸门选项（`composition` 等）。
 * @param startedAt 本次运行的起始 ISO 时间。
 * @param git 预取的 git 事实（`{ gitHead, gitDirty }`）。
 */
export function createReport(options, startedAt, git) {
  return {
    gateVersion: GATE_VERSION,
    startedAt,
    finishedAt: null,
    gitHead: git.gitHead,
    gitDirty: git.gitDirty,
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
}

/** 一层的结果记录（`startedAt`/`durationMs` 是运行事实，不参与断言）。 */
export function recordTier(id, assertions, startedMs = Date.now()) {
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

/** 全报告汇总：逐层断言按状态计数。 */
export function summarizeTiers(tiers) {
  const all = tiers.flatMap((tier) => tier.assertions);
  return {
    passed: all.filter((assertion) => assertion.status === "pass").length,
    failed: all.filter((assertion) => assertion.status === "fail").length,
    skipped: all.filter((assertion) => assertion.status === "skip").length,
  };
}

/** 终端摘要：逐层逐条 + 豁免醒目警告（豁免绝不静默变绿）。 */
export function printSummary(report, reportPath) {
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
