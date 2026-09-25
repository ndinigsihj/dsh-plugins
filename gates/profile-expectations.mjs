/**
 * Profile 维度的工具面期望（票据 09；施工图 `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`
 * 「闸门基准」）。
 *
 * 数据只有一份：`gates/expectations.json` 的 `profiles` 段。每个 profile 用
 * `basedOn`（指向 `presets.<id>.<round>.tools` 或另一个 profile）+ `changes` 行级
 * 差异表达，**禁止整文件再生成**——新增/移除工具只改那一行并附 reason。
 *
 * 本模块是纯解析/求值与集合 diff，不读真实 home、不写盘；T2 进程内对照臂与
 * `scripts/tui-pty-smoke.mjs` 的真实 profile 臂共用同一份期望。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./paths.mjs";

/** 期望文件路径（唯一数据源，模块内固定）。 */
const EXPECTATIONS_PATH = join(REPO_ROOT, "gates", "expectations.json");

const DIRECTIONS = new Set(["added", "removed"]);

/**
 * 读期望文件并核对 `profiles` 段存在。缺文件/坏 JSON/缺段一律抛错——
 * 期望缺失必须红，不能静默退化成空集。
 */
export function readExpectations() {
  const parsed = JSON.parse(readFileSync(EXPECTATIONS_PATH, "utf8"));
  const profiles = parsed?.profiles;
  if (profiles === null || typeof profiles !== "object") throw new Error(`expectations: missing profiles section in ${EXPECTATIONS_PATH}`);
  return parsed;
}

/** 校验变更行：tool/direction/reason 缺一即错（理由与方向是人工审阅面）。 */
function validateChanges(changes) {
  if (!Array.isArray(changes)) throw new Error("expectations: changes must be an array");
  return changes.map((change, index) => {
    const label = `changes[${String(index)}] (${String(change?.tool ?? "?")})`;
    if (typeof change?.tool !== "string" || change.tool.length === 0) throw new Error(`${label}: tool must be a non-empty string`);
    if (!DIRECTIONS.has(change?.direction)) throw new Error(`${label}: direction must be added|removed`);
    if (typeof change?.reason !== "string" || change.reason.length === 0) throw new Error(`${label}: reason must be a non-empty string`);
    return change;
  });
}

/**
 * 把行级差异应用到工具清单。重复添加 / 删除不存在的行都报错：期望数据与基线
 * 漂移时必须显式暴露，而不是算出一个看似正常的集合。
 */
export function applyToolChanges(tools, changes) {
  const next = [...tools];
  for (const change of validateChanges(changes)) {
    const at = next.indexOf(change.tool);
    if (change.direction === "added") {
      if (at !== -1) throw new Error(`expectations: ${change.tool} already present (duplicate added line)`);
      next.push(change.tool);
    } else {
      if (at === -1) throw new Error(`expectations: ${change.tool} not present (removed line does not match the baseline)`);
      next.splice(at, 1);
    }
  }
  return next;
}

/** 解析 `basedOn` 引用：数组、`{tools}` 节点，或另一个带 `basedOn` 的 profile 节点。 */
function resolveToolsRef(expectations, ref) {
  const node = ref
    .split(".")
    .reduce((value, key) => (value === null || typeof value !== "object" ? undefined : value[key]), expectations);
  if (Array.isArray(node)) return [...node];
  if (node !== null && typeof node === "object" && Array.isArray(node.tools)) return [...node.tools];
  if (node !== null && typeof node === "object" && typeof node.basedOn === "string") {
    return applyToolChanges(resolveToolsRef(expectations, node.basedOn), node.changes ?? []);
  }
  throw new Error(`expectations: cannot resolve tools ref "${ref}"`);
}

/**
 * 求值一个 profile 的完整期望：`{name, tools(排序去重), changes, ...declared}`。
 * 未声明的 profile 返回 undefined（调用方决定是跳过还是报错）。
 */
export function resolveProfileExpectation(expectations, name) {
  const node = expectations.profiles?.[name];
  if (node === undefined) return undefined;
  const raw = resolveToolsRef(expectations, `profiles.${name}`);
  const tools = [...raw].sort();
  if (tools.length !== new Set(tools).size) throw new Error(`expectations: profiles.${name} contains duplicate tools`);
  return { ...node, name, changes: validateChanges(node.changes ?? []), tools };
}

/** 期望集合与实际集合的差异（集合语义；两边都排序去重）。 */
export function diffToolSets(expected, actual) {
  const want = new Set(expected);
  const got = new Set(actual);
  const missing = [...want].filter((tool) => !got.has(tool)).sort();
  const unexpected = [...got].filter((tool) => !want.has(tool)).sort();
  return { ok: missing.length === 0 && unexpected.length === 0, missing, unexpected, expectedCount: want.size, actualCount: got.size };
}

/** 行级差异文本：缺失用 `-`、多出用 `+`（证据字符串与报告 detail 共用）。 */
export function formatToolDiff(diff) {
  return [...diff.missing.map((tool) => `- ${tool}`), ...diff.unexpected.map((tool) => `+ ${tool}`)];
}

/**
 * 回退口径核对（spec「Team Profile 不让自研 Preset 下沉」）：只核对 Team 组合面，
 * 不对 measured（40 工具）做声称。返回违规项列表，空数组即回退口径成立。
 */
export function fallbackProblems(expectation, actualTools) {
  const fallback = expectation?.fallback;
  if (fallback === null || typeof fallback !== "object") return ["no fallback convention declared"];
  const got = new Set(actualTools);
  const problems = [];
  for (const tool of fallback.requiredPresent ?? []) if (!got.has(tool)) problems.push(`missing ${tool}`);
  for (const tool of fallback.requiredAbsent ?? []) if (got.has(tool)) problems.push(`unexpected ${tool}`);
  return problems;
}
