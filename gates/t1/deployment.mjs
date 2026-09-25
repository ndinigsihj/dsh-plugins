/**
 * T1 部署位一致性断言（票据 01 从 `gates/run.mjs` 拆出；纯比对见 `../manifest.mjs`）。
 *
 * 三态语义与豁免映射与拆分前逐字一致：`repo-matches-manifest` 不可豁免；
 * absent 只能由 `--skip-deployment-check` 豁免、stale 只能由 `--allow-stale-deployment` 豁免，
 * 豁免时报告写 `exemptions[]`，绝不静默变绿。0.1.7 载体下每项可声明多个 `targets`
 * （票据 12）：文件态取全部目标的最严重值，报告展开逐目标判态。
 */
import { homedir } from "node:os";
import { checkDeployment, MANIFEST_PATH } from "../manifest.mjs";
import { REPO_ROOT } from "../paths.mjs";

/** 部署位一致性（前置断言；absent / stale 分别表达、各自可豁免）。 */
export function assertDeployment(t, config, report) {
  const deployment = checkDeployment(config.manifestObj, { repoRoot: REPO_ROOT, homeDir: homedir() });
  const drift = deployment.files.filter((file) => file.repoMatches === false);
  report.deployment = {
    status: deployment.status,
    manifestMatchesRepo: drift.length === 0,
    files: Object.fromEntries(
      deployment.files.map((file) => [
        file.name,
        {
          repo: file.repo,
          deployed: file.deployed,
          expected: file.expected,
          state: file.state,
          targets: file.targets.map((target) => ({ path: target.path, state: target.state })),
        },
      ]),
    ),
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
}
