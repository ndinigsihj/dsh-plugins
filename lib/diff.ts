// Bounded line diff for edit-shaped changes, shared by the TUI tool cards
// (lib/app.ts) and the Markdown exporter (lib/export.ts). Pure: strings in,
// diff lines out — no UI or I/O here.

/** Lines of unchanged context kept around each edit hunk. */
const DIFF_CONTEXT = 3;

export interface DiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
}

/**
 * Line diff tuned for edit-shaped changes: trim the common prefix/suffix,
 * mark the middle as del/add blocks, keep bounded context around them.
 */
export function lineDiff(oldText: string | null, newText: string): DiffLine[] {
  if (oldText === null) {
    return newText.split("\n").map((text) => ({ kind: "add", text }) as DiffLine);
  }
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start += 1;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  const out: DiffLine[] = [];
  const ctxFrom = Math.max(0, start - DIFF_CONTEXT);
  for (let i = ctxFrom; i < start; i += 1) out.push({ kind: "ctx", text: oldLines[i] ?? "" });
  for (let i = start; i < oldEnd; i += 1) out.push({ kind: "del", text: oldLines[i] ?? "" });
  for (let i = start; i < newEnd; i += 1) out.push({ kind: "add", text: newLines[i] ?? "" });
  const ctxAfter = Math.min(DIFF_CONTEXT, oldLines.length - oldEnd);
  for (let i = 0; i < ctxAfter; i += 1) out.push({ kind: "ctx", text: oldLines[oldEnd + i] ?? "" });
  return out;
}
