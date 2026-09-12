/**
 * 工作流触发路径断言的单测（票据 12；T0 面，随 `npm test` 执行）。
 *
 * 覆盖三类：解析形态（YAML 1.1 布尔 `on`、字符串/数组 `on`、无 paths 的事件、
 * 只有 branches/tags 的事件不误判）、路径判定（目录 glob 的 base、精确文件、
 * 取反、base 不是目录、非列表形态）、以及真仓全量断言。负控用临时仓库做，
 * 测试自身不改真实工作流；真仓的「改坏→T0 变红→恢复→复绿」由票据 12 的证据记录。
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkWorkflowTriggers,
  formatFinding,
  patternTarget,
  triggerPathFindings,
  workflowFiles,
  workflowTriggers,
} from "./workflow-triggers.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** 合成仓库：`lib/` 目录 + `package.json` 文件，够覆盖目录/精确两类目标。 */
function withFixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "dsh-workflow-triggers-"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  mkdirSync(join(root, "lib"), { recursive: true });
  writeFileSync(join(root, "package.json"), "{}\n");
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeWorkflow(root, name, text) {
  writeFileSync(join(root, ".github", "workflows", name), text);
}

test("patternTarget: 通配段之前是 base，无通配按精确文件，取反先剥离", () => {
  assert.deepEqual(patternTarget("presets/*/agent.mjs"), { negated: false, kind: "dir", path: "presets" });
  assert.deepEqual(patternTarget("**/*.ts"), { negated: false, kind: "dir", path: "" });
  assert.deepEqual(patternTarget("!docs/**"), { negated: true, kind: "dir", path: "docs" });
  assert.deepEqual(patternTarget("package.json"), { negated: false, kind: "file", path: "package.json" });
});

test("workflowTriggers: 布尔 on 键与字符串/数组形态都读出事件", () => {
  assert.deepEqual(workflowTriggers({ true: { push: { paths: ["lib/**"] } } }), [
    { event: "push", config: { paths: ["lib/**"] } },
  ]);
  assert.deepEqual(workflowTriggers({ on: "push" }), [{ event: "push", config: null }]);
  assert.deepEqual(
    workflowTriggers({ on: ["push", "pull_request"] }).map((entry) => entry.event),
    ["push", "pull_request"],
  );
  assert.deepEqual(workflowTriggers({ on: null }), []);
  assert.deepEqual(workflowTriggers({ on: {} }), []);
  assert.deepEqual(workflowTriggers({}), []);
});

test("无 paths 的事件与只有 branches/tags 的事件不误判", () =>
  withFixture((root) => {
    writeWorkflow(
      root,
      "test.yml",
      "on:\n  workflow_dispatch:\n  push:\n    branches: [main]\n  pull_request:\n    branches-ignore: [legacy]\n",
    );
    const { findings } = checkWorkflowTriggers(root);
    assert.deepEqual(findings, []);
  }));

test("布尔 on 的 YAML 1.1 形态 + 缺失 base：报告含文件、事件、模式", () =>
  withFixture((root) => {
    const findings = triggerPathFindings({
      repoRoot: root,
      workflow: ".github/workflows/test.yml",
      doc: { true: { push: { paths: ["lib/**", "gone/**"] } } },
    });
    assert.equal(findings.length, 1, findings.map(formatFinding).join("\n"));
    assert.equal(
      formatFinding(findings[0]),
      '.github/workflows/test.yml [push] paths "gone/**": base directory gone does not exist',
    );
  }));

test("paths-ignore、取反模式、精确文件与「base 不是目录」都校验", () =>
  withFixture((root) => {
    writeFileSync(join(root, "blocker"), "not a directory\n");
    writeWorkflow(
      root,
      "test.yml",
      [
        "on:",
        "  push:",
        "    paths-ignore:",
        "      - '!tmp/**'",
        "      - 'package.json'",
        "      - 'missing.txt'",
        "      - 'blocker/**'",
        "",
      ].join("\n"),
    );
    const { findings } = checkWorkflowTriggers(root);
    assert.deepEqual(findings.map((entry) => entry.pattern), ["!tmp/**", "missing.txt", "blocker/**"]);
    assert.match(formatFinding(findings[0]), /\[push\] paths-ignore "!tmp\/\*\*": base directory tmp does not exist/);
    assert.match(formatFinding(findings[2]), /base blocker is not a directory/);
  }));

test("负控：触发目录改坏 → 红；目录恢复 → 绿", () =>
  withFixture((root) => {
    writeWorkflow(root, "test.yml", "on:\n  push:\n    paths:\n      - 'gone/**'\n");
    const red = checkWorkflowTriggers(root);
    assert.equal(red.findings.length, 1);
    assert.ok(formatFinding(red.findings[0]).includes("gone/**"), formatFinding(red.findings[0]));
    mkdirSync(join(root, "gone"), { recursive: true });
    const green = checkWorkflowTriggers(root);
    assert.deepEqual(green.findings, []);
  }));

test("YAML 不可解析与非映射根都变红", () =>
  withFixture((root) => {
    writeWorkflow(root, "broken.yml", "on: [push\n");
    writeWorkflow(root, "list.yml", "- just\n- a list\n");
    const { workflows, findings } = checkWorkflowTriggers(root);
    assert.deepEqual(workflows, [".github/workflows/broken.yml", ".github/workflows/list.yml"]);
    assert.equal(findings.length, 2, findings.map(formatFinding).join("\n"));
    assert.ok(formatFinding(findings[0]).includes("broken.yml"), formatFinding(findings[0]));
    assert.ok(formatFinding(findings[0]).includes("YAML parse failed"), formatFinding(findings[0]));
    assert.ok(formatFinding(findings[1]).includes("list.yml"), formatFinding(findings[1]));
    assert.ok(formatFinding(findings[1]).includes("not a mapping"), formatFinding(findings[1]));
  }));

test("paths 非列表形态报为 schema 问题，而不是崩溃", () =>
  withFixture((root) => {
    const findings = triggerPathFindings({
      repoRoot: root,
      workflow: "test.yml",
      doc: { on: { push: { paths: { bad: true } } } },
    });
    assert.equal(findings.length, 1);
    assert.match(formatFinding(findings[0]), /must be a list of path patterns/);
  }));

test("workflowFiles: 只收 .yml/.yaml 且按名排序", () =>
  withFixture((root) => {
    writeWorkflow(root, "b.yml", "on: push\n");
    writeWorkflow(root, "a.yaml", "on: push\n");
    writeWorkflow(root, "notes.txt", "not a workflow\n");
    assert.deepEqual(
      workflowFiles(root).map((file) => file.slice(root.length + 1)),
      [".github/workflows/a.yaml", ".github/workflows/b.yml"],
    );
  }));

test("真仓全部工作流：可解析 + 触发路径存在", () => {
  const { workflows, findings } = checkWorkflowTriggers(REPO_ROOT);
  assert.ok(
    workflows.includes(".github/workflows/regression-gate.yml"),
    `workflows: ${workflows.join(", ")}`,
  );
  assert.ok(
    workflows.includes(".github/workflows/custom-bash-win-smoke.yml"),
    `workflows: ${workflows.join(", ")}`,
  );
  assert.equal(findings.length, 0, findings.map(formatFinding).join("\n"));
});
