// Native clipboard + OSC 52 helpers.
//
// pi-tui's selection copy writes only an OSC 52 escape (`ESC ] 52 ; c ; b64
// BEL`). Most terminals honor that for READ but silently drop WRITES, so the
// TUI flashes "Copied!" while nothing lands on the clipboard. Strategy (same
// as pi-coding-agent): on a local session write the native clipboard directly
// (pbcopy / clip / wl-copy / xclip); only a remote session (SSH/MOSH) falls
// back to OSC 52, because there the local terminal client owns the clipboard.

import { execFileSync } from "node:child_process";
import { platform } from "node:os";

export function isRemoteSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.MOSH_CONNECTION);
}

/** Write text to the native clipboard; true on success. */
export function copyTextLocally(text: string): boolean {
  const p = platform();
  try {
    if (p === "darwin") {
      execFileSync("pbcopy", [], { input: text });
      return true;
    }
    if (p === "win32") {
      execFileSync("clip", [], { input: text });
      return true;
    }
    // Linux / other: Wayland then X11.
    if (process.env.WAYLAND_DISPLAY) {
      execFileSync("wl-copy", [], { input: text });
      return true;
    }
    if (process.env.DISPLAY) {
      try {
        execFileSync("xclip", ["-selection", "clipboard"], { input: text });
      } catch {
        execFileSync("xsel", ["--clipboard", "--input"], { input: text });
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Extract the text payload of an OSC 52 set-clipboard write, or null. */
export function parseOsc52Text(data: string): string | null {
  const m = data.match(/^\x1b]52;c;([^\x07\x1b]*)(?:\x07|\x1b\\)$/);
  if (m === null || m[1] === "") return null;
  try {
    const text = Buffer.from(m[1] as string, "base64").toString("utf8");
    return text === "" ? null : text;
  } catch {
    return null;
  }
}
