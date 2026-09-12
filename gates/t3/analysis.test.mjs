/**
 * `gates/t3/analysis.mjs` 单测（票据 11）。
 *
 * 钉住 T3 的三类判定：
 *   - 版本/基线来源不符 → 拒绝运行（runGate 转 exit 2）；
 *   - M4 行为锚定在容忍度内判绿，口径措辞统计不参与判定；
 *   - 探针/路由报告判定的边界（缺 check、缺路由、失败种类归纳）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { m4Outcome, probeOutcome, routeOutcome, t3ProvenanceProblems } from "./analysis.mjs";

function manifest(overrides = {}) {
  return {
    hostVersion: "0.1.5-rc.1",
    sessionFormatVersion: 3,
    t3: { baseline: "m4-demo", tolerance: 1 },
    baselines: {
      "m4-demo": { path: "experiments/m4/demo.jsonl", sha256: "a".repeat(64), hostVersion: "0.1.5-rc.1", model: "opencode-go/deepseek-v4-flash", runs: 9 },
    },
    ...overrides,
  };
}

test("t3 前置：清单无 t3 段 → 拒绝（问题 id=manifest.t3）", () => {
  const problems = t3ProvenanceProblems({ hostVersion: "0.1.5-rc.1", sessionFormatVersion: 3 }, { hostVersion: "0.1.5-rc.1", sessionFormatVersion: 3 });
  assert.deepEqual(problems.map((problem) => problem.id), ["manifest.t3"]);
});

test("t3 前置：基线引用不存在 / 基线宿主与清单不一致 → 拒绝", () => {
  const missing = t3ProvenanceProblems(manifest({ t3: { baseline: "nope", tolerance: 1 } }), { hostVersion: "0.1.5-rc.1", sessionFormatVersion: 3 });
  assert.deepEqual(missing.map((problem) => problem.id), ["t3.baseline"]);

  const otherHost = manifest();
  otherHost.baselines["m4-demo"].hostVersion = "0.1.4";
  const problems = t3ProvenanceProblems(otherHost, { hostVersion: "0.1.5-rc.1", sessionFormatVersion: 3 });
  assert.deepEqual(problems.map((problem) => problem.id), ["t3.baseline-host"]);
  assert.match(problems[0].detail, /re-capture the baseline/u);
});

test("t3 前置：运行宿主/会话格式不符 → 拒绝并给出重采提示；格式与宿主都对 → 空", () => {
  assert.deepEqual(t3ProvenanceProblems(manifest(), { hostVersion: "0.1.5-rc.1", sessionFormatVersion: 3, settingsPresent: true }), []);
  const host = t3ProvenanceProblems(manifest(), { hostVersion: "0.1.6", sessionFormatVersion: 3 });
  assert.deepEqual(host.map((problem) => problem.id), ["t3.host"]);
  const format = t3ProvenanceProblems(manifest(), { hostVersion: "0.1.5-rc.1", sessionFormatVersion: 4 });
  assert.deepEqual(format.map((problem) => problem.id), ["t3.session-format"]);
  const settings = t3ProvenanceProblems(manifest(), { hostVersion: "0.1.5-rc.1", sessionFormatVersion: 3, settingsPresent: false });
  assert.deepEqual(settings.map((problem) => problem.id), ["t3.settings"]);
});

function m4Record(run, { firstTool, instructions = true, sandbox = true, error = null, turnErrors = [] } = {}) {
  return {
    run,
    error,
    turnErrors,
    firstToolCall: firstTool === null ? null : { name: firstTool },
    firstMessage: { text: "I'll start by listing files.", firstLine: "I'll start by listing files." },
    r2: { hasAgentInstructions: instructions, bashHasSandbox: sandbox },
  };
}

test("M4 判定：9/9 行为锚定 → 绿；口径措辞不参与（记录里只有 advisory 输入）", () => {
  const records = Array.from({ length: 9 }, (_, index) => m4Record(index + 1, { firstTool: "bash" }));
  const outcome = m4Outcome(records, { runs: 9, tolerance: 1 });
  assert.equal(outcome.anchored, 9);
  assert.equal(outcome.behaviourOk, true);
  assert.equal(outcome.recordsOk, true);
  assert.equal(outcome.check3Ok, true);
  assert.equal(outcome.check4Ok, true);
});

test("M4 判定：容忍度 = 1 → 8/9 绿、7/9 红；非 bash 首工具记名", () => {
  const dropOne = Array.from({ length: 9 }, (_, index) => m4Record(index + 1, { firstTool: index === 0 ? null : "bash" }));
  assert.equal(m4Outcome(dropOne, { runs: 9, tolerance: 1 }).behaviourOk, true);
  const dropTwo = Array.from({ length: 9 }, (_, index) => m4Record(index + 1, { firstTool: index < 2 ? null : "bash" }));
  assert.equal(m4Outcome(dropTwo, { runs: 9, tolerance: 1 }).behaviourOk, false);
  const wrongTool = Array.from({ length: 9 }, (_, index) => m4Record(index + 1, { firstTool: index === 3 ? "str_replace_editor" : "bash" }));
  const outcome = m4Outcome(wrongTool, { runs: 9, tolerance: 1 });
  assert.equal(outcome.behaviourOk, true, "8/9 仍应在容忍度内");
  assert.deepEqual(outcome.nonBashFirstTools, ["str_replace_editor"]);
});

test("M4 判定：记录数不足 → recordsOk=false（即使锚定比例高）", () => {
  const short = Array.from({ length: 3 }, (_, index) => m4Record(index + 1, { firstTool: "bash" }));
  const outcome = m4Outcome(short, { runs: 9, tolerance: 1 });
  assert.equal(outcome.recordsOk, false);
  assert.equal(outcome.behaviourOk, false, "期望样本 9、容忍 1 时 3 跑不能判绿");
});

test("M4 判定：check3/check4 同样受容忍度约束，错误记录进 errors", () => {
  const records = Array.from({ length: 9 }, (_, index) =>
    m4Record(index + 1, { firstTool: "bash", instructions: index !== 0, sandbox: index !== 1, error: index === 2 ? "RATE_LIMIT" : null }),
  );
  const outcome = m4Outcome(records, { runs: 9, tolerance: 1 });
  assert.equal(outcome.check3, 8);
  assert.equal(outcome.check4, 8);
  assert.equal(outcome.check3Ok, true);
  assert.equal(outcome.check4Ok, true);
  assert.deepEqual(outcome.errors, [{ run: 3, error: "RATE_LIMIT" }]);
});

test("M4 判定：turn 级 provider 错误单独归纳（额度/传输分类进报告）", () => {
  const records = Array.from({ length: 9 }, (_, index) =>
    m4Record(index + 1, {
      firstTool: index < 9 ? "bash" : null,
      turnErrors: index === 0 ? [{ turn: 1, code: "QUOTA", message: "Monthly usage limit reached" }] : [],
    }),
  );
  const outcome = m4Outcome(records, { runs: 9, tolerance: 1 });
  assert.deepEqual(outcome.providerErrors, [{ run: 1, code: "QUOTA", message: "Monthly usage limit reached" }]);
  assert.equal(outcome.behaviourOk, true, "turn 错误跑也会计入 providerErrors，但是否判红由行为锚定口径决定");
});

test("探针判定：全 pass 且白名单齐全 → 绿；缺 id / 有 fail → 红", () => {
  const checks = [{ id: "a2-x", pass: true }, { id: "a3-y", pass: true }];
  assert.equal(probeOutcome({ checks }, ["a2-x"])?.allPass, true);
  assert.equal(probeOutcome({ checks }, ["a2-x", "a9-missing"]).allPass, false);
  assert.equal(probeOutcome({ checks: [{ id: "a2-x", pass: false }, { id: "a3-y", pass: true }] }, ["a2-x"]).allPass, false);
  assert.equal(probeOutcome({}, ["a2-x"]).allPass, false);
});

test("路由判定：逐条 pass 才算全绿，失败归纳出 failureKind 与 turnErrorCode", () => {
  const report = {
    routes: [
      { route: { provider: "p", model: "m1" }, pass: true, attempts: [{ pass: true, markerSeen: true, durationMs: 10 }] },
      {
        route: { provider: "p", model: "m2" },
        pass: false,
        attempts: [
          { pass: false, failureKind: "no-tool-call", markerSeen: false, durationMs: 20, turnErrors: [] },
          { pass: false, failureKind: "tool-error", markerSeen: false, durationMs: 30, turnErrors: [{ code: "RATE_LIMIT" }] },
        ],
      },
    ],
  };
  const outcome = routeOutcome(report);
  assert.equal(outcome.allPass, false);
  assert.equal(outcome.passed, 1);
  assert.deepEqual(outcome.routes[1].failureKinds, ["no-tool-call", "tool-error"]);
  assert.deepEqual(outcome.routes[1].turnErrorCodes, ["RATE_LIMIT"]);
  assert.equal(outcome.routes[0].markerSeen, true);
  assert.equal(routeOutcome({ routes: [] }).allPass, false);
});
