// 16-color SGR palette. Per the archived TUI presentation notes: one table of
// SGR open/close pairs, every close resets every group its open set, and
// `color: false` disables styling entirely.

const ESC = "[";
const RESET = `${ESC}0m`;

export interface Palette {
  /** Wrap text in a foreground color (standard 16). */
  fg(text: string, name: ColorName): string;
  bold(text: string): string;
  dim(text: string): string;
  underline(text: string): string;
  reverse(text: string): string;
}

export type ColorName =
  | "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white"
  | "brightBlack" | "brightRed" | "brightGreen" | "brightYellow"
  | "brightBlue" | "brightMagenta" | "brightCyan" | "brightWhite";

const SGR: Record<ColorName, string> = {
  black: "30", red: "31", green: "32", yellow: "33",
  blue: "34", magenta: "35", cyan: "36", white: "37",
  brightBlack: "90", brightRed: "91", brightGreen: "92", brightYellow: "93",
  brightBlue: "94", brightMagenta: "95", brightCyan: "96", brightWhite: "97",
};

/** Attributes are composed separately so a nested color reset cannot discard the outer attribute. */
const ATTR = {
  bold: "1", dim: "2", underline: "4", reverse: "7",
  boldClose: "22", dimClose: "22", underlineClose: "24", reverseClose: "27",
};

export function createPalette(enabled = true): Palette {
  if (!enabled) {
    return {
      fg: (text) => text,
      bold: (text) => text,
      dim: (text) => text,
      underline: (text) => text,
      reverse: (text) => text,
    };
  }
  const wrap = (open: string, close: string) => (text: string) =>
    `${ESC}${open}m${text}${ESC}${close}m`;
  return {
    fg: (text, name) => wrap(SGR[name], "39")(text),
    bold: wrap(ATTR.bold, ATTR.boldClose),
    dim: wrap(`${ATTR.dim};39`, `${ATTR.dimClose};39`),
    underline: wrap(ATTR.underline, ATTR.underlineClose),
    reverse: wrap(ATTR.reverse, ATTR.reverseClose),
  };
}

export { RESET };
