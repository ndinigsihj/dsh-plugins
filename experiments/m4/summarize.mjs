/**
 * M4 结果统计器 — 复算历史/新批次的表 5.4 口径。
 *
 * 用法：node experiments/m4/summarize.mjs <results.jsonl> [<results.jsonl> ...]
 * 输入可以是历史 `experiments/m4/results-*.jsonl` 或新批次
 * `experiments/m4/results-liangshen-bash-selfhost-E-C-2026-09-03.jsonl`
 * （自动跳过 `#` 开头的注释行）。
 */
import { readFileSync } from "node:fs";

function classify(text, firstLine, hasToolCall) {
  const line = (firstLine ?? "").trim();
  if (/^我来|^我们/.test(line)) return "let me";
  if (/^(let me\b|i'?ll\b|i will\b|we need\b|we'?ll\b|we will\b)/i.test(line)) return "we need";
  if (hasToolCall) return "tool call";
  return line.length > 0 ? "text" : "none";
}

export function summarize(path) {
  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line && !line.startsWith("#"));
  const records = lines.map((line) => JSON.parse(line));
  const groups = [...new Set(records.map((record) => record.group))].sort();
  const rows = groups.map((group) => {
    const rs = records.filter((record) => record.group === group);
    const cats = rs.map((record) => classify(
      record.firstMessage?.text ?? "",
      record.firstMessage?.firstLine ?? "",
      record.firstToolCall !== null && record.firstToolCall !== undefined,
    ));
    const toolCall = cats.filter((cat) => cat === "tool call").length;
    const weNeed = cats.filter((cat) => cat === "we need").length;
    const letMe = cats.filter((cat) => cat === "let me").length;
    const anchored = rs.length - weNeed - letMe;
    const check3 = rs.filter((record) => record.r2?.hasAgentInstructions === true).length;
    const check4 = rs.filter((record) => record.r2?.bashHasSandbox === true).length;
    const toolCounts = rs.map((record) => record.r2?.assemblyTools?.length ?? 0);
    const avgTools = toolCounts.length === 0 ? 0 : toolCounts.reduce((a, b) => a + b, 0) / toolCounts.length;
    return {
      group,
      n: rs.length,
      toolCall,
      weNeed,
      letMe,
      anchorRate: `${Math.round((anchored / rs.length) * 100)}%`,
      check3,
      check4,
      avgTools: Number(avgTools.toFixed(1)),
    };
  });
  return rows;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  for (const path of process.argv.slice(2)) {
    console.log(`== ${path} ==`);
    console.table(summarize(path));
  }
}