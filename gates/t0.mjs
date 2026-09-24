/**
 * T0 静态层（票据 01 从 `gates/run.mjs` 拆出）：类型检查、全量单测、测试文件清单一致性。
 *
 * 只跑子进程并读 package.json；不写仓库、不碰真实 home。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createAssertions, parseTestCounts, run, tailLines } from "./gate-helpers.mjs";
import { REPO_ROOT } from "./paths.mjs";

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

export function runT0(env) {
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
