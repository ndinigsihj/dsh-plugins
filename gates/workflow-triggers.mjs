/**
 * 工作流触发路径的常驻断言（票据 12；计划 §6-1、§5.4 的 T0 断言面）。
 *
 * 为什么需要：`.github/workflows/custom-bash-win-smoke.yml` 的触发路径曾写成
 * `presets/liangshen-bash/**`（目录已不存在），工作流因此永不触发，而任何本地
 * 测试都不会变红——票据 09 做过一次性校验，本模块把它固化成每次 `npm test`
 * 都跑的断言（T0）。
 *
 * 校验范围（有意收紧）：只解析仓库内全部工作流 YAML，逐个事件检查
 * `paths` / `paths-ignore` 的每条模式——含通配符的模式断言「第一个通配段之前
 * 的 base 目录」存在且是目录，精确路径断言文件存在；`!` 取反前缀先剥离。
 * 不模拟 GitHub 的实际触发（本地无法验证），也不校验 branches / tags 模式、
 * cron 表达式、权限与 job 依赖图——它们不是本次静默失效的成因。
 *
 * YAML 解析复用 `gates/dump-parse.mjs` 的 js-yaml 入口（app-boot 的传递依赖，
 * 不在本仓库依赖声明里），不新增依赖。YAML 1.1 解析器会把裸 `on:` 键解析成
 * 布尔键（JS 侧即 `"true"`），两种形态都认。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { loadYaml } from "./dump-parse.mjs";

/** 本模块只校验这两个 GitHub 路径过滤器键。 */
const PATH_FILTERS = ["paths", "paths-ignore"];
const WORKFLOW_DIR = join(".github", "workflows");
const WORKFLOW_EXTENSIONS = [".yml", ".yaml"];

/** `.github/workflows` 下的工作流文件（绝对路径、按名排序；目录不存在返回空）。 */
export function workflowFiles(repoRoot) {
  const dir = join(repoRoot, WORKFLOW_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => WORKFLOW_EXTENSIONS.some((ext) => name.endsWith(ext)))
    .sort()
    .map((name) => join(dir, name));
}

/**
 * 归一化 `on` 为 `[{ event, config }]`：认字符串、字符串数组、事件映射，
 * 以及 YAML 1.1 下的布尔键（`on` → `"true"`）。无 `on` 或 `on:` 为空 → 空数组。
 */
export function workflowTriggers(doc) {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return [];
  const trigger = doc["on"] ?? doc["true"];
  if (trigger === undefined || trigger === null) return [];
  if (typeof trigger === "string") return [{ event: trigger, config: null }];
  if (Array.isArray(trigger)) {
    return trigger
      .filter((event) => typeof event === "string")
      .map((event) => ({ event, config: null }));
  }
  if (typeof trigger !== "object") return [];
  return Object.entries(trigger).map(([event, config]) => ({ event, config: config ?? null }));
}

/**
 * 模式 → 校验目标：第一个含通配符的段之前是 base 目录；无通配符按精确路径。
 * `!` 取反前缀先剥离（GitHub 的 paths 过滤器支持取反）。
 */
export function patternTarget(pattern) {
  const trimmed = pattern.trim();
  const negated = trimmed.startsWith("!");
  const body = (negated ? trimmed.slice(1) : trimmed).replace(/^\/+/u, "");
  const segments = body.split("/").filter((segment) => segment.length > 0);
  const wildcardAt = segments.findIndex((segment) => /[*?[\]]/u.test(segment));
  if (wildcardAt === -1) return { negated, kind: "file", path: segments.join("/") };
  return { negated, kind: "dir", path: segments.slice(0, wildcardAt).join("/") };
}

function finding(workflow, event, filter, pattern, reason) {
  return { workflow, event, filter, pattern, reason };
}

/** 人读形式：工作流文件 + 事件 + 过滤器键 + 模式 + 原因（负控报告靠它定位）。 */
export function formatFinding(entry) {
  return `${entry.workflow} [${entry.event}] ${entry.filter} "${entry.pattern}": ${entry.reason}`;
}

function checkPattern({ repoRoot, workflow, event, filter, pattern }) {
  const target = patternTarget(pattern);
  if (target.kind === "file" && target.path === "") {
    return [finding(workflow, event, filter, pattern, "empty path pattern")];
  }
  const absolute = target.path === "" ? repoRoot : join(repoRoot, target.path);
  if (!existsSync(absolute)) {
    const what = target.kind === "dir" ? "base directory" : "file";
    return [finding(workflow, event, filter, pattern, `${what} ${target.path} does not exist`)];
  }
  if (target.kind === "dir" && target.path !== "" && !statSync(absolute).isDirectory()) {
    return [finding(workflow, event, filter, pattern, `base ${target.path} is not a directory`)];
  }
  return [];
}

/** 单份工作流文档的触发路径问题清单（不读盘；存在性检查打 repoRoot）。 */
export function triggerPathFindings({ repoRoot, workflow, doc }) {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return [finding(workflow, "*", "-", "<root>", "workflow YAML is not a mapping")];
  }
  const findings = [];
  for (const { event, config } of workflowTriggers(doc)) {
    if (config === null || typeof config !== "object" || Array.isArray(config)) continue;
    for (const filter of PATH_FILTERS) {
      const value = config[filter];
      if (value === undefined || value === null) continue;
      const patterns = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
      if (patterns === null) {
        findings.push(finding(workflow, event, filter, JSON.stringify(value), "must be a list of path patterns"));
        continue;
      }
      for (const pattern of patterns) {
        if (typeof pattern !== "string") {
          findings.push(finding(workflow, event, filter, JSON.stringify(pattern), "pattern is not a string"));
          continue;
        }
        findings.push(...checkPattern({ repoRoot, workflow, event, filter, pattern }));
      }
    }
  }
  return findings;
}

/** 全仓扫描：解析每个工作流 YAML 并汇总问题；返回 `{ workflows, findings }`。 */
export function checkWorkflowTriggers(repoRoot) {
  const yaml = loadYaml();
  const workflows = [];
  const findings = [];
  for (const file of workflowFiles(repoRoot)) {
    const workflow = relative(repoRoot, file).split(sep).join("/");
    workflows.push(workflow);
    let doc;
    try {
      doc = yaml.load(readFileSync(file, "utf8"));
    } catch (error) {
      findings.push(finding(workflow, "*", "-", "<yaml>", `YAML parse failed: ${String(error.message ?? error)}`));
      continue;
    }
    findings.push(...triggerPathFindings({ repoRoot, workflow, doc }));
  }
  return { workflows, findings };
}
