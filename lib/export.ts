// Transcript → Markdown serializer for /export. Pure: rows in, one string
// out. Tool bodies are bounded (exports are for reading, not replaying).

import { lineDiff } from "./diff.ts";
import { sanitizeDisplay } from "./sanitize.ts";
import type { TranscriptRow } from "./transcript.ts";

/** Max rendered lines per tool card body in an export. */
const TOOL_BODY_CAP = 60;

/**
 * Render the transcript as a readable Markdown document: user/assistant turns
 * as sections (reasoning folded into <details>), tool calls as bounded cards.
 */
export function renderTranscriptMarkdown(rows: ReadonlyArray<TranscriptRow>): string {
  const out: string[] = [
    "# dsh session export",
    "",
    `_generated ${new Date().toISOString()}_`,
  ];
  for (const row of rows) {
    switch (row.kind) {
      case "user":
        out.push("", "## User", "", row.text.trim(), "");
        if (row.images !== undefined && row.images.length > 0) {
          out.push(`attachments: ${row.images.join(" ")}`, "");
        }
        break;
      case "assistant": {
        out.push("", "## Assistant", "");
        if (row.reasoning.trim() !== "") {
          out.push("<details>", "<summary>thinking</summary>", "");
          for (const line of row.reasoning.split("\n")) out.push(`> ${line}`);
          out.push("", "</details>", "");
        }
        if (row.text.trim() !== "") out.push(row.text, "");
        break;
      }
      case "tool":
        out.push(...renderToolCard(row));
        break;
      case "notice":
        if (row.text.trim() !== "") out.push("", `> ${row.text}`, "");
        break;
      case "error":
        out.push("", `> ⚠ ${row.text}`, "");
        break;
      case "context":
        break; // resume/context markers carry no conversational content
      case "banner":
        break; // boot-time welcome block is UI chrome, not conversation
    }
  }
  return `${out.join("\n").trimEnd()}\n`;
}

function renderToolCard(row: Extract<TranscriptRow, { kind: "tool" }>): string[] {
  const title = row.resultView?.title ?? row.callView?.title ?? row.name;
  const lines = ["", `### Tool · ${sanitizeDisplay(title)}`];
  const body = renderToolBody(row);
  if (body.length > 0) {
    lines.push("");
    lines.push(...body.slice(0, TOOL_BODY_CAP));
    if (body.length > TOOL_BODY_CAP) lines.push(`… ${body.length - TOOL_BODY_CAP} more lines`);
  }
  lines.push("");
  return lines;
}

function renderToolBody(row: Extract<TranscriptRow, { kind: "tool" }>): string[] {
  const view = row.resultView ?? row.callView;
  if (view === undefined) return [];
  if (view.card === "terminal") {
    const result = row.resultView !== undefined && row.resultView.card === "terminal" ? row.resultView : undefined;
    const status =
      result?.exitCode !== undefined
        ? `exit ${result.exitCode}`
        : result?.signal !== undefined
          ? `signal ${result.signal}`
          : undefined;
    const output = result?.output ?? "";
    const fenced = ["```console", ...output.replace(/\n$/, "").split("\n"), "```"];
    if (status !== undefined) fenced.push(`_${status}_`);
    return fenced;
  }
  if (view.card === "diff") {
    const lines: string[] = [];
    for (const d of view.diffs) {
      lines.push(sanitizeDisplay(d.path), "```diff");
      for (const part of lineDiff(d.oldText, d.newText)) {
        lines.push(`${part.kind === "add" ? "+" : part.kind === "del" ? "-" : " "}${part.text}`);
      }
      lines.push("```");
    }
    return lines;
  }
  if (view.card === "search") {
    if (view.shape === "paths") return view.paths.slice(0, 12).map((p) => `- ${sanitizeDisplay(p)}`);
    const lines: string[] = [];
    for (const file of view.files.slice(0, 6)) {
      lines.push(`**${sanitizeDisplay(file.path)}**`);
      for (const m of file.matches.slice(0, 8)) lines.push(`- \`${m.lineNumber}\` ${sanitizeDisplay(m.line)}`);
    }
    if (view.truncated) lines.push(`_(truncated; ${view.total} matches total)_`);
    return lines;
  }
  // generic / read / web: keep only a salient scalar input if present
  if ("rawInput" in view && typeof view.rawInput === "string") {
    const text = sanitizeDisplay(view.rawInput);
    return text.split("\n").slice(0, 8);
  }
  return [];
}

