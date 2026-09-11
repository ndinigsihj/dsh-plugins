/**
 * 回归闸门共用助手（票据 03）：报告骨架、子进程与临时 home。
 *
 * 设计约束（计划 §2.2 / Q2）：
 *   - 闸门只写临时 home（`$GATE_TEMP`），真实 `~/.dsh` 零写入；
 *   - 每条断言自带证据（退出码 / 文件 sha / 会话事件），不引用模型自述；
 *   - 断言失败不抛异常：`push` 返回布尔，由调用方决定是否继续。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** 报告 schema 版本（计划 §5.2）。 */
export const GATE_VERSION = 1;

/** 退出码：全过 / 断言失败 / 环境前置不满足。 */
export const EXIT = { pass: 0, fail: 1, precondition: 2 };

/** 一条断言的记录；`status` 三态，`evidence` 必须可核对。 */
export function createAssertions() {
  const assertions = [];
  const push = (id, status, evidence, detail) => {
    assertions.push({ id, status, evidence, ...(detail === undefined ? {} : { detail }) });
    return status === "pass";
  };
  return {
    assertions,
    pass: (id, evidence, detail) => push(id, "pass", evidence, detail),
    fail: (id, evidence, detail) => push(id, "fail", evidence, detail),
    skip: (id, evidence, detail) => push(id, "skip", evidence, detail),
  };
}

/** 跑一个子进程并汇总 { command, status, signal, error, stdout, stderr }。 */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    command: [command, ...args].join(" "),
    status: result.status,
    signal: result.signal,
    error: result.error === undefined ? undefined : String(result.error.message ?? result.error),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** 从 `node --test` 的输出里取统计行（spec 用 `ℹ`，TAP / npm 透传用 `#`）。 */
export function parseTestCounts(stdout) {
  const counts = {};
  for (const rawLine of stdout.split("\n")) {
    const match = /^[ℹ#]\s*(tests|pass|fail|skipped|cancelled)\s+(\d+)\s*$/u.exec(rawLine.trim());
    if (match !== null) counts[match[1]] = Number(match[2]);
  }
  return counts;
}

/**
 * 落盘结构化报告（目录不存在则建），返回写入路径。
 */
export function writeReport(path, report) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

/** 文件内容 sha256；不存在返回 undefined。 */
export function sha256File(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * 真实 home 指纹差异：任何一条都表示闸门写进了用户目录。
 * 指纹项形如 `{ exists, entries, signature }`（由调用方扫描产出）。
 */
export function diffRealHome(before, after) {
  const diffs = [];
  for (const zone of Object.keys(before)) {
    const left = before[zone];
    const right = after[zone];
    if (right === undefined) diffs.push({ zone, change: "gone" });
    else if (left.entries !== right.entries || left.signature !== right.signature) {
      diffs.push({ zone, change: "changed", before: left.entries, after: right.entries });
    }
  }
  return diffs;
}

/** 稳定 JSON 的 sha256（组合渲染哈希用）。 */
export function sha256Json(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

/**
 * 键序稳定的 JSON 序列化（对象键排序、数组保序）。
 *
 * 组合条目随时可能带 `undefined` 字段（patch 只覆盖部分键），模板串会把
 * `undefined` 渲染成字面量并与 `null` 混淆——这里显式转为 `null`，哈希才稳定。
 */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
