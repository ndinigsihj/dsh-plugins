// Terminal wrapper that routes pi-tui's OSC 52 clipboard writes to the native
// clipboard on a local session. See clipboard.ts for the rationale.

import type { Terminal } from "@earendil-works/pi-tui";
import { copyTextLocally, isRemoteSession, parseOsc52Text } from "./clipboard.ts";

export class ClipboardTerminal implements Terminal {
  private readonly inner: Terminal;

  constructor(inner: Terminal) {
    this.inner = inner;
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inner.start(onInput, onResize);
  }

  stop(): void {
    this.inner.stop();
  }

  drainInput(maxMs?: number, idleMs?: number): Promise<void> {
    return this.inner.drainInput(maxMs, idleMs);
  }

  write(data: string): void {
    const text = parseOsc52Text(data);
    if (text !== null && !isRemoteSession() && copyTextLocally(text)) {
      return; // native clipboard write succeeded — suppress the OSC 52
    }
    this.inner.write(data);
  }

  get columns(): number {
    return this.inner.columns;
  }

  get rows(): number {
    return this.inner.rows;
  }

  get kittyProtocolActive(): boolean {
    return this.inner.kittyProtocolActive;
  }

  moveBy(lines: number): void {
    this.inner.moveBy(lines);
  }

  hideCursor(): void {
    this.inner.hideCursor();
  }

  showCursor(): void {
    this.inner.showCursor();
  }

  clearLine(): void {
    this.inner.clearLine();
  }

  clearFromCursor(): void {
    this.inner.clearFromCursor();
  }

  clearScreen(): void {
    this.inner.clearScreen();
  }

  setTitle(title: string): void {
    this.inner.setTitle(title);
  }

  setProgress(active: boolean): void {
    this.inner.setProgress(active);
  }
}
