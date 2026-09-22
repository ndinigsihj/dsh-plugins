/**
 * T4a 进程内 app 层单测：注入 FakeTerminal 驱动 TuiApp，不碰真实 TTY
 * （docs/regression-test-automation-plan.md §3.2、用户决策 D7/Q19a）。
 *
 * 覆盖：冷启动首帧 banner、状态行字段、按键语义（Ctrl+C 单/双、运行中打断、
 * 双 Esc）、选择器流程、退出路径的终端恢复契约、复制走远程会话分支。
 * 不覆盖（属 lib/index.ts 闭包，须 T4b）：/model、/effort、/sessions、/rm、
 * /resume、/exit、/rewind。
 *
 * 运行：node --test lib/app.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { basename } from "node:path";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { TuiApp, type AgentSurface } from "./app.ts";
import { FakeTerminal } from "./testing/fake-terminal.ts";
import type { ToolPresenters } from "./transcript.ts";

const MODEL = "opencode-go/deepseek-v4-flash";
const PRESET = "minimal-plus";

const presenters: ToolPresenters = {
  presentCall: () => undefined,
  presentResult: () => undefined,
};

function makeAgent(): AgentSurface {
  return {
    id: "sess-t4a",
    status: "idle",
    followup: () => {},
    steer: () => {},
    cancel: () => {},
    whenIdle: async () => {},
  };
}

interface Harness {
  app: TuiApp;
  terminal: FakeTerminal;
  agent: AgentSurface;
  dispose(): void;
}

function makeApp(
  hooks: {
    onExit?: () => Promise<void>;
    onCancel?: () => void;
    onDoubleEscape?: () => void;
  } = {},
): Harness {
  const terminal = new FakeTerminal(120, 30);
  const agent = makeAgent();
  const app = new TuiApp({
    agent,
    modelLabel: MODEL,
    presenters,
    onPrompt: () => {},
    onCancel: hooks.onCancel ?? (() => {}),
    onExit: hooks.onExit ?? (async () => {}),
    onDoubleEscape: hooks.onDoubleEscape,
    terminal,
  });
  return {
    app,
    terminal,
    agent,
    dispose() {
      // showNotice 的 8s 定时器没有 unref：不清掉会吊住 node --test 的事件循环。
      app.clearNotice();
      app.stopTerminal();
    },
  };
}

/** 去掉 CSI/OSC 控制序列与 \r 后的可见文本。 */
function plain(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
}

/**
 * 在已渲染屏幕上定位一段文字，返回 0 基行号与该文字首列的可见列号。
 * 鼠标断言要按屏幕坐标注入，但写死行号会在布局一变就假红——与 app.ts 的
 * enableShiftClickExtend 一样按结构访问 TuiAltScreen 的屏幕缓冲；取不到时
 * 明确抛错，不静默跳过。
 */
function locateOnScreen(tui: TUI, needle: string): { row: number; col: number } {
  const screen = (tui as unknown as { previousScreen?: string[] }).previousScreen ?? [];
  for (let row = 0; row < screen.length; row += 1) {
    const line = screen[row] ?? "";
    const index = line.indexOf(needle);
    if (index >= 0) return { row, col: visibleWidth(line.slice(0, index)) };
  }
  throw new Error(`FakeTerminal screen does not contain ${needle}`);
}

test("冷启动首帧：banner 含路由与组合标识", () => {
  const h = makeApp();
  try {
    h.app.appendBanner(`✻ dsh-tui · deepseek harness\n${MODEL} · preset ${PRESET}`);
    h.app.start();
    h.app.tuiHandle.renderNow(true);
    const frame = plain(h.terminal.text);
    assert.ok(frame.includes(MODEL), `首帧应含路由标识，实际:\n${frame}`);
    assert.ok(frame.includes(`preset ${PRESET}`), `首帧应含组合标识，实际:\n${frame}`);
    assert.ok(h.terminal.text.includes("\x1b[?1049h"), "首帧应含进入备用屏序列");
  } finally {
    h.dispose();
  }
});

test("状态行：模型、工作区与上下文占用字段在位", () => {
  const h = makeApp();
  try {
    h.app.setContextOccupancy({ pct: 42, usedTokens: 12_000, windowTokens: 30_000 });
    h.app.start();
    h.app.tuiHandle.renderNow(true);
    const frame = plain(h.terminal.text);
    assert.ok(frame.includes(MODEL), "状态行应含模型标识");
    assert.ok(frame.includes(basename(process.cwd())), "状态行应含工作区名");
    assert.ok(frame.includes("ctx 42% (12k/30k)"), "状态行应含上下文占用槽");
  } finally {
    h.dispose();
  }
});

test("Ctrl+C 单次：提示再按一次，不退出", () => {
  let exits = 0;
  const h = makeApp({
    onExit: async () => {
      exits += 1;
    },
  });
  try {
    h.app.start();
    h.app.tuiHandle.renderNow(true);
    const mark = h.terminal.mark();
    h.terminal.send("\x03");
    h.app.tuiHandle.renderNow(true);
    assert.equal(exits, 0);
    assert.ok(
      plain(h.terminal.writtenSince(mark)).includes("Press Ctrl+C again to exit."),
      "单次 Ctrl+C 应给出提示",
    );
  } finally {
    h.dispose();
  }
});

test("Ctrl+C 双次：调用退出回调", () => {
  let exits = 0;
  const h = makeApp({
    onExit: async () => {
      exits += 1;
    },
  });
  try {
    h.app.start();
    h.terminal.send("\x03");
    h.terminal.send("\x03");
    assert.equal(exits, 1);
  } finally {
    h.dispose();
  }
});

test("Ctrl+C 单次（运行中）：走打断而非退出", () => {
  let exits = 0;
  let cancels = 0;
  const h = makeApp({
    onExit: async () => {
      exits += 1;
    },
    onCancel: () => {
      cancels += 1;
    },
  });
  try {
    h.app.start();
    h.agent.status = "running";
    h.terminal.send("\x03");
    assert.equal(cancels, 1);
    assert.equal(exits, 0);
  } finally {
    h.dispose();
  }
});

test("双 Esc：触发 rewind 手势回调", () => {
  let fired = 0;
  const h = makeApp({
    onDoubleEscape: () => {
      fired += 1;
    },
  });
  try {
    h.app.start();
    // 终端会把快速双击批成一段 "\x1b\x1b"，pi-tui 命名为 ctrl+alt+[
    // （app.ts handleGlobalInput 的 PRE-GLUED 分支）。
    h.terminal.send("\x1b\x1b");
    assert.equal(fired, 1);
  } finally {
    h.dispose();
  }
});

test("选择器流程：可被按键驱动并返回选中值", async () => {
  const h = makeApp();
  try {
    h.app.start();
    const picked = h.app.pickSession([
      { value: "sess-a", label: "alpha" },
      { value: "sess-b", label: "beta" },
    ]);
    h.app.tuiHandle.renderNow(true);
    assert.ok(h.terminal.text.includes("alpha"), "选择器应渲染候选项");
    h.terminal.send("\x1b[B"); // down
    h.terminal.send("\r"); // enter
    assert.equal(await picked, "sess-b");
  } finally {
    h.dispose();
  }
});

test("退出路径：写出终端恢复契约", async () => {
  const h = makeApp();
  try {
    h.app.start();
    h.app.tuiHandle.renderNow(true);
    assert.ok(h.terminal.text.includes("\x1b[?1049h"), "启动应进入备用屏");
    let code: number | undefined;
    const mark = h.terminal.mark();
    await h.app.stopAndExit((c) => {
      code = c;
    });
    const tail = h.terminal.writtenSince(mark);
    assert.ok(tail.includes("\x1b[?1049l"), "退出应离开备用屏");
    assert.ok(tail.includes("\x1b[?25h"), "退出应恢复光标");
    assert.equal(code, 0);
  } finally {
    h.dispose();
  }
});

// 复制断言必须走远程会话分支（SSH_CONNECTION）：本地分支会执行 pbcopy/clip
// 等真实剪贴板命令——测试若走本地分支，要么污染用户剪贴板，要么因为 OSC 52
// 被 ClipboardTerminal 吞掉而断言恒绿。远程会话下 pi-tui 的拖选释放应把
// OSC 52 经 App 的终端链原样写到终端上。
test("复制：远程会话下拖选释放把 OSC 52 写入终端", () => {
  const h = makeApp();
  const previous = process.env.SSH_CONNECTION;
  process.env.SSH_CONNECTION = "10.0.0.1 50000 10.0.0.2 22";
  try {
    h.app.appendBanner("XCOPY-MARKER line one");
    h.app.start();
    h.app.tuiHandle.renderNow(true);
    const at = locateOnScreen(h.app.tuiHandle, "XCOPY");
    const mark = h.terminal.mark();
    h.terminal.send(`\x1b[<0;${at.col + 1};${at.row + 1}M`); // 按下：选区起点
    h.terminal.send(`\x1b[<32;${at.col + 5};${at.row + 1}M`); // 拖动（按住按钮）
    h.terminal.send(`\x1b[<0;${at.col + 5};${at.row + 1}m`); // 释放 → 复制选区
    const osc = [...h.terminal.writtenSince(mark).matchAll(/\x1b\]52;c;([^\x07]*)\x07/g)];
    assert.equal(osc.length, 1, "拖选释放应写一次 OSC 52");
    assert.equal(Buffer.from(osc[0]![1]!, "base64").toString("utf8"), "XCOPY");
  } finally {
    if (previous === undefined) delete process.env.SSH_CONNECTION;
    else process.env.SSH_CONNECTION = previous;
    h.dispose();
  }
});
