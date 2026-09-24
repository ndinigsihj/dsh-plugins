/**
 * 闸门前置检查（票据 01 从 `gates/run.mjs` 拆出）。
 *
 * 顺序与行为与拆分前逐字一致：清单读取 → 宿主安装锚点 → dsh CLI → 宿主钉版
 * （不可豁免）→ T3 版本/基线来源闸门。任一失败置 `preconditionsOk=false`，
 * 并把最后一次失败原因写进 `preconditionDetail`。
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SESSION_FORMAT_VERSION } from "@deepseek-ai/dsh-session";
import { run } from "./gate-helpers.mjs";
import { hostInfo } from "./host-pin.mjs";
import { checkHostPin, MANIFEST_PATH, readManifest } from "./manifest.mjs";
import { REPO_ROOT } from "./paths.mjs";
import { t3ProvenanceProblems } from "./t3/analysis.mjs";

/** 环境前置不满足：退出码 2（清单坏 / 宿主代不符 / 组合渲染缺依赖）。 */
export class PreconditionError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "PreconditionError";
    this.detail = detail;
  }
}

/** dsh CLI 可运行性（不在 PATH 时是环境前置失败，不是断言失败）。 */
function checkCli(pre) {
  const dshCli = run("dsh", ["--version"], { cwd: REPO_ROOT });
  if (dshCli.status !== 0) {
    pre.fail("host.cli", `exit ${String(dshCli.status)} ${dshCli.error ?? ""}`.trim());
    return false;
  }
  pre.pass("host.cli", `dsh --version -> ${dshCli.stdout.trim()}`);
  return true;
}

/** 宿主钉版逐字段核对；任一不符即环境前置失败（两条都不可豁免）。 */
function checkPinAgainstManifest(pre, { manifest, host }) {
  const pin = checkHostPin(manifest, { hostVersion: host.version, sessionFormatVersion: SESSION_FORMAT_VERSION });
  let ok = true;
  for (const check of pin.checks) {
    const pass = check.status === "ok";
    pre[pass ? "pass" : "fail"](
      `host.pin.${check.id}`,
      `expected=${String(check.expected)} actual=${String(check.actual)}`,
      pass ? undefined : { hint: "re-capture the baseline: update gates/manifest.json (or switch back to the pinned host)" },
    );
    if (!pass) ok = false;
  }
  return ok;
}

/** T3 版本/基线来源闸门（用户决策 Q3）：不符时该层拒绝运行，T0/T1/T2 不受影响。 */
function checkT3(pre, manifest, host) {
  const problems = t3ProvenanceProblems(manifest, {
    hostVersion: host.version,
    sessionFormatVersion: SESSION_FORMAT_VERSION,
    settingsPresent: existsSync(join(homedir(), ".dsh", "settings.yaml")),
  });
  for (const problem of problems) {
    pre.fail(`t3.precondition.${problem.id}`, problem.detail, {
      hint: "re-capture the baseline: update gates/manifest.json (host pin / baseline record) or switch back to the pinned host, then rerun --tier 3",
    });
  }
  return problems.length > 0 ? problems.map((problem) => problem.detail).join("; ") : null;
}

/**
 * 跑完前置检查并返回编排所需的状态。
 * @returns `{ manifest, host, preconditionsOk, preconditionDetail, t3Refusal }`
 */
export function evaluatePreconditions({ options, pre, report }) {
  let preconditionsOk = true;
  let preconditionDetail = null;

  const manifest = readManifest();
  if (manifest.status !== "ok") {
    preconditionsOk = false;
    preconditionDetail = `${manifest.status}: ${manifest.error ?? MANIFEST_PATH}`;
    pre.fail("manifest.read", preconditionDetail);
  }

  let host;
  try {
    host = hostInfo();
    report.hostVersion = host.version;
  } catch (error) {
    preconditionsOk = false;
    preconditionDetail = `host install anchor not resolvable: ${String(error.message ?? error)} — run scripts/link-global-dsh.sh`;
    pre.fail("host.anchor", preconditionDetail);
  }

  if (!checkCli(pre)) {
    preconditionsOk = false;
    preconditionDetail = "dsh CLI not runnable (not on PATH?): install the pinned host @deepseek-ai/dsh";
  }

  if (host !== undefined && manifest.status === "ok" && !checkPinAgainstManifest(pre, { manifest: manifest.manifest, host })) {
    preconditionsOk = false;
    preconditionDetail = "host/session format does not match the manifest: re-capture the baseline";
  }

  let t3Refusal = null;
  if (options.tiers.includes(3) && preconditionsOk && manifest.status === "ok" && host !== undefined) {
    t3Refusal = checkT3(pre, manifest.manifest, host);
  }
  return { manifest, host, preconditionsOk, preconditionDetail, t3Refusal };
}
