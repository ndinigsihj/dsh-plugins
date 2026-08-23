// ANSI hygiene for terminal display. Per the archived TUI notes: "displayText()
// renders C0 and C1 controls other than line feeds as visible hexadecimal
// escapes. Only the TUI and pi-tui create ANSI control sequences."
//
// External text (tool output, model text) must never carry raw escape
// sequences into the terminal — strip them first, then make remaining control
// characters visible.

const ESC = String.fromCharCode(0x1b);

// CSI (ESC[…), two-char escapes, and OSC strings (ESC] … BEL / ESC\) — the
// latter can rewrite the terminal title or clipboard (OSC 0/2/52), so they
// must never survive sanitization.
const ANSI_ESCAPE = new RegExp(
  `${ESC}(?:\\][^\\x07${ESC}]*(?:\\x07|${ESC}\\\\)|\\[[0-9;:]*[A-Za-z]|\\([A-Za-z]|[A-Za-z])`,
  "g",
);

/** True for C0 controls other than \n (0x0a) / \t (0x09), and all C1 controls. */
function isStrayControl(code: number): boolean {
  return (
    (code >= 0x00 && code <= 0x08) ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f)
  );
}

/** Strip raw ANSI sequences and render stray C0/C1 controls as `\xNN`. */
export function sanitizeDisplay(text: string): string {
  const stripped = text.replace(ANSI_ESCAPE, "");
  let out = "";
  for (const ch of stripped) {
    const code = ch.codePointAt(0) ?? 0;
    if (isStrayControl(code)) {
      out += `\\x${code.toString(16).padStart(2, "0")}`;
    } else {
      out += ch;
    }
  }
  return out;
}
