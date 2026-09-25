#!/usr/bin/env node
/**
 * `deploy-preset-carrier` 的命令行入口（票据 12）：参数解析、计划摘要与 `--json` 证据落档。
 * 计划/执行逻辑见 `deploy-preset-carrier.mjs`；默认 dry-run，真实写入要显式 `--write`。
 *
 * Usage: node scripts/deploy-preset-carrier-cli.mjs [--dry-run | --write] [--json <path>]
 *        [--preset <id>] [--timestamp <YYYYMMDD-HHMMSS>] [--dsh-home <dir>]
 * 退出码：0 计划/执行成功；1 前置或一致性失败；2 参数错误。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeReport } from "../gates/gate-helpers.mjs";
import { installAnchor } from "./host-runtime.mjs";
import { applyPresetCarrier, planPresetCarrier } from "./deploy-preset-carrier.mjs";

export const HELP = [
  "Usage: node scripts/deploy-preset-carrier-cli.mjs [--dry-run | --check | --write] [--json <path>]",
  "       [--preset <id>] [--timestamp <YYYYMMDD-HHMMSS>] [--dsh-home <dir>]",
  "",
  "  --dry-run   print the plan and write nothing (default; exit 0)",
  "  --check     print the plan; exit 1 when the deployment is absent/stale (release pre-check)",
  "  --write     execute the plan (explicit real-profile deployment; needs approval)",
  "  --json      archive the plan/result as JSON (evidence)",
  "  --preset    preset id (default minimal-plus)",
  "  --dsh-home  dsh home holding profiles/ (default $DSH_HOME or ~/.dsh)",
].join("\n");

/** 解析 CLI 参数（导出供单测注入 env）。 */
export function parsePresetCarrierArgs(argv, env = process.env) {
  const options = { write: false, check: false, json: undefined, preset: "minimal-plus", timestamp: undefined, dshHome: env.DSH_HOME ?? join(env.HOME ?? homedir(), ".dsh") };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") options.write = false;
    else if (token === "--write") options.write = true;
    else if (token === "--check") options.check = true;
    else if (token === "--json") options.json = argv[++index];
    else if (token === "--preset") options.preset = argv[++index];
    else if (token === "--timestamp") options.timestamp = argv[++index];
    else if (token === "--dsh-home") options.dshHome = argv[++index];
    else if (token === "-h" || token === "--help") options.help = true;
    else throw new Error(`deploy-preset-carrier: unknown argument ${token}`);
  }
  return options;
}

/** 计划的人类可读摘要（stdout 证据）。 */
export function describePlan(plan) {
  const lines = [`deploy-preset-carrier: preset ${plan.preset.id} (${plan.preset.packageName})`, `  artifact: ${plan.preset.artifactDir}`];
  for (const profile of plan.profiles) {
    const legacy = profile.patch === undefined ? "-" : profile.patch.legacyRowStrip ? "strip+backup" : "already-clean";
    lines.push(`  ${profile.name.padEnd(9)} dir=${profile.dir}`);
    lines.push(
      `    bundle target=${String(profile.bundleTarget?.state ?? "?")} repo=${profile.bundleTarget?.repoOk === true ? "ok" : "DRIFT"} selection=${String(profile.selection)} legacyRow=${legacy}${profile.exists ? " (exists)" : ""}`,
    );
    lines.push(`    bundles → ${profile.plannedBundles.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

function hostVersion() {
  try {
    return JSON.parse(readFileSync(installAnchor(), "utf8")).version;
  } catch {
    return undefined;
  }
}

/** CLI 入口；返回进程退出码。`repoRoot` 仅供单测注入（默认本 checkout）。 */
export function runPresetCarrierCli(argv, { env = process.env, stdout = process.stdout, repoRoot } = {}) {
  let options;
  try {
    options = parsePresetCarrierArgs(argv, env);
  } catch (error) {
    stdout.write(`${String(error.message ?? error)}\n${HELP}\n`);
    return 2;
  }
  if (options.help === true) {
    stdout.write(`${HELP}\n`);
    return 0;
  }
  let plan;
  try {
    plan = planPresetCarrier({ dshHome: options.dshHome, preset: options.preset, repoRoot });
  } catch (error) {
    stdout.write(`deploy-preset-carrier: plan failed: ${String(error.message ?? error)}\n`);
    return 1;
  }
  const report = { kind: "deploy-preset-carrier", version: 1, hostVersion: hostVersion(), mode: options.write ? "write" : "dry-run", startedAt: new Date().toISOString(), plan };
  if (!plan.ok) {
    stdout.write(`deploy-preset-carrier: plan not ok\n${plan.problems.map((problem) => `  - ${problem}`).join("\n")}\n`);
    if (options.json !== undefined) writeReport(options.json, { ...report, ok: false });
    return 1;
  }
  if (!options.write) {
    stdout.write(describePlan(plan));
    if (options.check === true) {
      const current = plan.needsWrite ? "NOT current (rerun with --write after approval)" : "current";
      stdout.write(`deploy-preset-carrier: deployment is ${current}\n`);
      if (options.json !== undefined) writeReport(options.json, { ...report, mode: "check", ok: true, needsWrite: plan.needsWrite });
      return plan.needsWrite ? 1 : 0;
    }
    stdout.write(`deploy-preset-carrier: dry-run${plan.needsWrite ? " (deployment is NOT current)" : ""} — nothing written (rerun with --write to deploy)\n`);
    if (options.json !== undefined) writeReport(options.json, { ...report, ok: true });
    return 0;
  }
  try {
    const result = applyPresetCarrier(plan, { timestamp: options.timestamp });
    stdout.write(describePlan(plan));
    stdout.write(`deploy-preset-carrier: wrote ${result.team.dir}${result.backup === undefined ? "" : `; backup ${result.backup}`}\n`);
    if (options.json !== undefined) writeReport(options.json, { ...report, ok: true, result });
    return 0;
  } catch (error) {
    stdout.write(`deploy-preset-carrier: ${String(error.message ?? error)}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  process.exit(runPresetCarrierCli(process.argv.slice(2)));
}
