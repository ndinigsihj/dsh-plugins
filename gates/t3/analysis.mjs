/**
 * T3 真实模型层的纯判定与归纳（票据 11；计划 §3.4/§4.3/§5.4/§7 P4）。
 *
 * 本模块不含 IO 与子进程：只回答三件事——
 *   1. 前置是否满足（宿主/会话格式/基线来源与清单一致；真实 settings 存在）；
 *   2. 一批 M4 记录在「行为锚定」口径下是否达标（口径类措辞统计只进 advisory）；
 *   3. 模型选择探针 / 允许路由探针的报告是否可判 pass。
 *
 * 判定纪律：只认可核对的结构化证据（记录字段、退出码、check id），不引用模型自述；
 * 措辞统计（anchorRate 等）永不作为硬指标（计划 §8「真实模型批次波动」）。
 */

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * T3 拒绝运行的条件（runGate 把它翻成 exit 2；调用方必须先跑该层前置检查）。
 * @returns `[{ id, detail }]`，空数组表示可运行。
 */
export function t3ProvenanceProblems(manifest, { hostVersion, sessionFormatVersion, settingsPresent } = {}) {
  const problems = [];
  if (!isRecord(manifest?.t3)) {
    problems.push({ id: "manifest.t3", detail: "gates/manifest.json has no t3 section" });
    return problems;
  }
  const baselineId = manifest.t3.baseline;
  if (typeof baselineId !== "string" || baselineId.length === 0) {
    problems.push({ id: "t3.baseline", detail: "t3.baseline must name a manifest baseline" });
  }
  const baseline = typeof baselineId === "string" ? manifest.baselines?.[baselineId] : undefined;
  if (typeof baselineId === "string" && baselineId.length > 0 && !isRecord(baseline)) {
    problems.push({ id: "t3.baseline", detail: `t3.baseline "${baselineId}" is not in manifest.baselines` });
  }
  if (isRecord(baseline)) {
    if (baseline.hostVersion !== manifest.hostVersion) {
      problems.push({
        id: "t3.baseline-host",
        detail: `baseline ${baselineId} was captured on host ${String(baseline.hostVersion)}, manifest pins ${String(manifest.hostVersion)} — re-capture the baseline on the pinned host`,
      });
    }
    if (typeof baseline.model !== "string" || baseline.model.length === 0) {
      problems.push({ id: "t3.baseline-model", detail: `baseline ${baselineId} has no model recorded — re-capture the baseline` });
    }
    if (!Number.isSafeInteger(baseline.runs) || baseline.runs < 1) {
      problems.push({ id: "t3.baseline-runs", detail: `baseline ${baselineId} has no positive runs recorded — re-capture the baseline` });
    }
  }
  if (hostVersion !== undefined && hostVersion !== manifest.hostVersion) {
    problems.push({
      id: "t3.host",
      detail: `runtime host ${String(hostVersion)} != manifest ${String(manifest.hostVersion)} — re-capture the baseline (or switch back to the pinned host)`,
    });
  }
  if (sessionFormatVersion !== undefined && sessionFormatVersion !== manifest.sessionFormatVersion) {
    problems.push({
      id: "t3.session-format",
      detail: `runtime session format ${String(sessionFormatVersion)} != manifest ${String(manifest.sessionFormatVersion)} — re-capture the baseline`,
    });
  }
  if (settingsPresent === false) {
    problems.push({ id: "t3.settings", detail: "real ~/.dsh/settings.yaml not found; T3 needs real provider credentials" });
  }
  return problems;
}

/**
 * M4 批次的行为锚定判定。
 *
 * 硬指标（同一容忍度）：首响应含工具调用且首工具为 bash、agent-instructions 注入、
 * promotion 后 bash 为沙箱版。口径措辞统计（we need / let me / anchorRate）只进 advisory。
 *
 * @param records 解析后的 JSONL 记录数组。
 * @param options.runs 期望样本量（清单基线）。
 * @param options.tolerance 允许的偏离跑数（清单 t3.tolerance）。
 */
export function m4Outcome(records, { runs, tolerance }) {
  const list = Array.isArray(records) ? records : [];
  const threshold = Math.max(0, runs - tolerance);
  const toolOf = (record) => record?.firstToolCall ?? null;
  const anchored = list.filter((record) => toolOf(record)?.name === "bash").length;
  const withToolCall = list.filter((record) => toolOf(record) !== null).length;
  const check3 = list.filter((record) => record?.r2?.hasAgentInstructions === true).length;
  const check4 = list.filter((record) => record?.r2?.bashHasSandbox === true).length;
  return {
    expectedRuns: runs,
    tolerance,
    threshold,
    records: list.length,
    errors: list
      .map((record, index) => ({ run: record?.run ?? index + 1, error: record?.error }))
      .filter((entry) => typeof entry.error === "string" && entry.error.length > 0),
    providerErrors: list.flatMap((record, index) =>
      (Array.isArray(record?.turnErrors) ? record.turnErrors : []).map((entry) => ({
        run: record?.run ?? index + 1,
        code: entry?.code ?? null,
        message: typeof entry?.message === "string" ? entry.message.slice(0, 200) : null,
      })),
    ),
    anchored,
    withToolCall,
    nonBashFirstTools: list.filter((record) => toolOf(record) !== null && toolOf(record).name !== "bash").map((record) => String(toolOf(record).name)),
    check3,
    check4,
    recordsOk: list.length === runs,
    behaviourOk: anchored >= threshold,
    check3Ok: check3 >= threshold,
    check4Ok: check4 >= threshold,
  };
}

/** 模型选择探针报告 → 判定（退出码 + 全部 check + 关键 id 白名单）。 */
export function probeOutcome(report, whitelist) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const ids = checks.map((check) => check.id);
  const missing = (whitelist ?? []).filter((id) => !ids.includes(id));
  const failed = checks.filter((check) => check.pass !== true).map((check) => check.id);
  return {
    total: checks.length,
    passed: checks.filter((check) => check.pass === true).length,
    failed,
    missing: missing.map(String),
    allPass: checks.length > 0 && failed.length === 0 && missing.length === 0,
  };
}

/** 允许路由探针报告 → 判定 + 每条路由的失败种类/错误码（报告用，不参与容忍度）。 */
export function routeOutcome(report) {
  const routes = (Array.isArray(report?.routes) ? report.routes : []).map((entry) => {
    const attempts = Array.isArray(entry.attempts) ? entry.attempts : [];
    return {
      route: `${String(entry.route?.provider)}/${String(entry.route?.model)}`,
      pass: entry.pass === true,
      failureKinds: [...new Set(attempts.map((attempt) => attempt.failureKind).filter((kind) => typeof kind === "string"))],
      turnErrorCodes: [...new Set(attempts.flatMap((attempt) => (attempt.turnErrors ?? []).map((error) => error?.code ?? error?.status).filter(Boolean)))],
      markerSeen: attempts.some((attempt) => attempt.markerSeen === true),
      durationMs: attempts.reduce((sum, attempt) => sum + (Number.isFinite(attempt.durationMs) ? attempt.durationMs : 0), 0),
    };
  });
  return {
    total: routes.length,
    passed: routes.filter((route) => route.pass).length,
    routes,
    allPass: routes.length > 0 && routes.every((route) => route.pass),
  };
}
