// T4a 假终端：让 TuiApp 在进程内被驱动，不碰真实 TTY
// （docs/regression-test-automation-plan.md §3.2）。
//
// 实现 pi-tui Terminal 接口的全部 15 个成员：write 家族把字节按调用顺序
// 追加到 writes（供断言取「这一动作写出的帧」），start() 保存输入回调，
// send() 经它注入按键/鼠标序列。与 ProcessTerminal 的差别：不读写
// process.stdin/stdout、不进 raw mode；drainInput 立即完成——假终端没有真实
// stdin 可排空，等待只会拖慢单测。

import type { Terminal } from "@earendil-works/pi-tui";

export class FakeTerminal implements Terminal {
  readonly columns: number;
  readonly rows: number;
  /** 每次终端写操作的原始字节，按发生顺序保留（不合并，便于取帧区间）。 */
  readonly writes: string[] = [];
  private inputHandler: ((data: string) => void) | undefined;
  private resizeHandler: (() => void) | undefined;

  constructor(columns = 120, rows = 30) {
    this.columns = columns;
    this.rows = rows;
  }

  get kittyProtocolActive(): boolean {
    return false;
  }

  /** 全量输出（含控制序列）。 */
  get text(): string {
    return this.writes.join("");
  }

  /** 当前写计数，用作 writtenSince() 的区间起点。 */
  mark(): number {
    return this.writes.length;
  }

  /** mark() 之后的输出片段——一次动作写出的「帧」。 */
  writtenSince(mark: number): string {
    return this.writes.slice(mark).join("");
  }

  /** 注入按键/鼠标序列；未 start() 时抛错，避免断言静默失效。 */
  send(data: string): void {
    if (this.inputHandler === undefined) {
      throw new Error("FakeTerminal.send() before start()");
    }
    this.inputHandler(data);
  }

  /** 触发 resize 回调（重排路径断言用）。 */
  resize(): void {
    this.resizeHandler?.();
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inputHandler = onInput;
    this.resizeHandler = onResize;
  }

  stop(): void {
    this.inputHandler = undefined;
    this.resizeHandler = undefined;
  }

  drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {
    return Promise.resolve();
  }

  write(data: string): void {
    this.writes.push(data);
  }

  // 以下写序列与 ProcessTerminal 逐字一致：TuiBase 用它们做光标移动与行清理，
  // 落到同一 writes 缓冲里，帧断言才能看到完整屏幕契约。

  moveBy(lines: number): void {
    if (lines > 0) this.write(`\x1b[${lines}B`);
    else if (lines < 0) this.write(`\x1b[${-lines}A`);
  }

  hideCursor(): void {
    this.write("\x1b[?25l");
  }

  showCursor(): void {
    this.write("\x1b[?25h");
  }

  clearLine(): void {
    this.write("\x1b[K");
  }

  clearFromCursor(): void {
    this.write("\x1b[J");
  }

  clearScreen(): void {
    this.write("\x1b[2J\x1b[H");
  }

  setTitle(title: string): void {
    this.write(`\x1b]0;${title}\x07`);
  }

  setProgress(active: boolean): void {
    this.write(active ? "\x1b]9;4;3\x07" : "\x1b]9;4;0\x07");
  }
}
