/**
 * `gates/manifest.json` 的读取与三态比对（票 02）。
 *
 * 闸门（票据 03）只消费本模块的结果，不自己解析清单：
 *   - 清单本身：`ok` / `missing` / `invalid`
 *   - 部署位逐文件：`ok`（相符）/ `stale`（不符）/ `absent`（缺失）
 *   - 宿主钉版（宿主版本 + 会话格式版本）：逐字段 `ok` / `mismatch`
 *   - 真实模型基线文件：`ok` / `stale` / `absent`
 *
 * 全部是纯函数 + 只读 fs：不写任何文件，不抛「缺失」类异常（缺失是一种状态）。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库内清单的绝对路径（由本模块位置推导，任意 checkout 可用）。 */
export const MANIFEST_PATH = fileURLToPath(new URL("./manifest.json", import.meta.url));

const SHA256_HEX = /^[0-9a-f]{64}$/;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failureText(error) {
  return error instanceof Error ? error.message : String(error);
}

/** 文件 sha256；文件不存在返回 `undefined`（缺失由调用方判态，不在此抛错）。 */
function sha256File(path) {
  let data;
  try {
    data = readFileSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  return createHash("sha256").update(data).digest("hex");
}

/**
 * 读取清单并做结构校验。
 * @returns `{status:"ok",manifest}` / `{status:"missing"}` / `{status:"invalid",error}`
 */
export function readManifest(path = MANIFEST_PATH) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing", path };
    return { status: "invalid", path, error: failureText(error) };
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    return { status: "invalid", path, error: failureText(error) };
  }
  const error = shapeProblem(manifest);
  if (error !== undefined) return { status: "invalid", path, error };
  return { status: "ok", path, manifest };
}

/** 只校验比对会依赖的字段；比这更深的 schema 由清单作者负责。 */
function shapeProblem(manifest) {
  if (!isRecord(manifest)) return "manifest must be a JSON object";
  if (!Number.isSafeInteger(manifest.gateVersion)) return "gateVersion must be an integer";
  if (typeof manifest.hostVersion !== "string" || manifest.hostVersion.length === 0) {
    return "hostVersion must be a non-empty string";
  }
  if (!Number.isSafeInteger(manifest.sessionFormatVersion)) return "sessionFormatVersion must be an integer";
  const deploymentProblem = deploymentShapeProblem(manifest.deployment);
  if (deploymentProblem !== undefined) return deploymentProblem;
  const baselinesProblem = baselinesShapeProblem(manifest.baselines);
  if (baselinesProblem !== undefined) return baselinesProblem;
  return undefined;
}

function deploymentShapeProblem(deployment) {
  if (!isRecord(deployment)) return "deployment must be an object";
  for (const [preset, entry] of Object.entries(deployment)) {
    if (!isRecord(entry)) return `deployment["${preset}"] must be an object`;
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      return `deployment["${preset}"].path must be a non-empty string`;
    }
    if (!isRecord(entry.files)) return `deployment["${preset}"].files must be an object`;
    for (const [name, sha] of Object.entries(entry.files)) {
      if (typeof sha !== "string" || !SHA256_HEX.test(sha)) {
        return `deployment["${preset}"].files["${name}"] must be a sha256 hex string`;
      }
    }
  }
  return undefined;
}

function baselinesShapeProblem(baselines) {
  if (!isRecord(baselines)) return "baselines must be an object";
  for (const [id, entry] of Object.entries(baselines)) {
    if (!isRecord(entry)) return `baselines["${id}"] must be an object`;
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      return `baselines["${id}"].path must be a non-empty string`;
    }
    if (typeof entry.sha256 !== "string" || !SHA256_HEX.test(entry.sha256)) {
      return `baselines["${id}"].sha256 must be a sha256 hex string`;
    }
    if (!Number.isSafeInteger(entry.runs) || entry.runs < 1) {
      return `baselines["${id}"].runs must be a positive integer`;
    }
  }
  return undefined;
}

/** 部署位 `path` 展开：`~` / `~/x` 用 homeDir，其余按原样。 */
export function resolveDeploymentRoot(entry, homeDir = homedir()) {
  if (entry.path === "~") return homeDir;
  if (entry.path.startsWith("~/")) return join(homeDir, entry.path.slice(2));
  return entry.path;
}

/** 实际值 vs 期望 sha：缺失 / 不符 / 相符。 */
function fileState(actual, expected) {
  if (actual === undefined) return "absent";
  return actual === expected ? "ok" : "stale";
}

/** 汇总只保留最严重状态：absent > stale > ok。 */
function aggregate(states) {
  if (states.includes("absent")) return "absent";
  return states.includes("stale") ? "stale" : "ok";
}

/**
 * 逐 preset、逐生产文件比对「仓库 ↔ 清单 ↔ 部署位」。
 * @param options.repoRoot 仓库根（用于 `presets/<preset>/<name>`）；省略则不比对仓库侧。
 * @param options.homeDir 部署位 `~` 的展开基准。
 */
export function checkDeployment(manifest, { repoRoot, homeDir = homedir() } = {}) {
  const files = [];
  for (const [preset, entry] of Object.entries(manifest.deployment)) {
    const deployedRoot = resolveDeploymentRoot(entry, homeDir);
    for (const [name, expected] of Object.entries(entry.files)) {
      const repo = repoRoot === undefined ? undefined : sha256File(join(repoRoot, "presets", preset, name));
      const deployed = sha256File(join(deployedRoot, name));
      files.push({
        preset,
        name,
        expected,
        repo,
        deployed,
        state: fileState(deployed, expected),
        repoMatches: repo === expected,
      });
    }
  }
  return { status: aggregate(files.map((file) => file.state)), files };
}

/** 宿主钉版比对（清单记录 vs 运行环境实测）。 */
export function checkHostPin(manifest, { hostVersion, sessionFormatVersion }) {
  const checks = [
    pinCheck("hostVersion", manifest.hostVersion, hostVersion),
    pinCheck("sessionFormatVersion", manifest.sessionFormatVersion, sessionFormatVersion),
  ];
  return { status: checks.every((check) => check.status === "ok") ? "ok" : "mismatch", checks };
}

function pinCheck(id, expected, actual) {
  return { id, expected, actual, status: expected === actual ? "ok" : "mismatch" };
}

/** 逐真实模型基线文件比对入库记录的 sha256。 */
export function checkBaselines(manifest, { repoRoot } = {}) {
  const baselines = [];
  for (const [id, entry] of Object.entries(manifest.baselines)) {
    const actual = repoRoot === undefined ? undefined : sha256File(join(repoRoot, entry.path));
    baselines.push({
      id,
      path: entry.path,
      expected: entry.sha256,
      actual,
      runs: entry.runs,
      hostVersion: entry.hostVersion,
      state: fileState(actual, entry.sha256),
    });
  }
  return { status: aggregate(baselines.map((baseline) => baseline.state)), baselines };
}
