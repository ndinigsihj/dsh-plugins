#!/usr/bin/env node
/**
 * T4b 真实 PTY 冒烟（票据 10；计划 §3.3 + 用户决策 D8/Q10/Q20/Q23）。
 *
 * 用途：在伪终端里启动「渲染后的真实 tui-dev 组合」，把输出喂给 @xterm/headless
 * 得到屏幕缓冲，对只有真进程才有的路径做结构化断言：
 *   启动/banner、/sessions、/rm（确认后存储变化）、/model（下一次请求头路由变化）、
 *   /rewind（文件恢复 + fork 子会话落盘 + execve 重启）、/exit（退出码与终端恢复）。
 *
 * 独立入口（D8/Q10）：`scripts/regression-gate.sh` 与 `scripts/release.sh` 都不引用本脚本；
 * 依赖真 PTY 环境，按需手跑。推荐经薄壳入口跑（它带仓库本地锁与临时 home 清理）：
 *
 *   scripts/tui-pty-smoke.sh                                    # 正常跑
 *   scripts/tui-pty-smoke.sh --json /tmp/pty-smoke.json         # 指定报告路径
 *   scripts/tui-pty-smoke.sh --negative-control route           # 红路径：跳过 /model 切换
 *   scripts/tui-pty-smoke.sh --negative-control drop-assertion  # 红路径：模拟断言被删
 *   scripts/tui-pty-smoke.sh --keep-temp                        # 保留临时 home 排查
 *   node scripts/tui-pty-smoke.mjs                              # 直跑（自带临时 home 与锁）
 *
 * 退出码：0 全过 / 1 任一断言失败 / 2 环境前置不满足（PTY 或宿主内嵌依赖不可用、
 * 真实组合渲染失败）。报告 JSON 默认落
 * `experiments/regression-gate/pty-smoke-<UTC 日期>.json`。
 *
 * 依赖加载（计划 §3.3）：node-pty / @xterm/headless 不在本仓库 package.json，按宿主安装锚点
 * （scripts/host-runtime.mjs 的 installAnchor）推导 createRequire 加载；缺失时给明确报错。
 *
 * 隔离（Q2/Q20）：DSH_HOME与HOME都指向临时 home，cwd 是临时 workspace；真实 `~/.dsh`
 * 只读渲染（profile/settings 副本落临时 home，跑完删除；--keep-temp 保留——注意副本含明文密钥）。
 * 组合里 tui-runner 路由钉到假模型（gates/stub/pty-smoke.patch.yml），不产生真实 provider 请求。
 *
 * 断言口径（计划 §3.3）：取归一化后的结构与副作用（屏幕缓冲/磁盘/会话日志），不做整屏
 * 像素 golden；等待一律轮询 + 超时，唯一的时间输入是 stub 场景脚本里的 `delay` 块
 * （用于「分块间隔」量化）。
 */
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { visibleWidth } from "@earendil-works/pi-tui/dist/utils.js";
import { SESSION_FORMAT_VERSION } from "@deepseek-ai/dsh-session";
import { EXIT, createAssertions, run, writeReport } from "../gates/gate-helpers.mjs";
import { RenderRealError, renderRealComposition } from "../gates/composition/render-real.mjs";
import { MANIFEST_PATH, readManifest, resolveDeploymentRoot } from "../gates/manifest.mjs";
import { installAnchor } from "./host-runtime.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/u, "");
const OVERLAY = join(REPO_ROOT, "gates", "stub", "pty-smoke.patch.yml");
const PRESET = "minimal-plus-next";
const PROFILE = "tui-dev";
const COLS = 120;
const ROWS = 30;
const TERM = "xterm-256color";
/** 假模型契约（与 gates/stub/{pty-smoke.patch.yml,adapter.mjs} 同源）。 */
const STUB_PROVIDER = "stub";
const STUB_MODEL = "stub-model";
const STUB_MODEL_ALT = "stub-model-alt";
const STREAM_GAP_MS = 120;
/** 连续 PTY 写间隔小于它视为同一次渲染 burst（见 statsSince）。 */
const STREAM_BURST_GAP_MS = 40;
const POLL_MS = 100;
/** 单次进程启动的清屏序列（`\x1b[2J`）上界；超出视为重绘失控。 */
const MAX_CLEARS_PER_START = 6;
/** 声明式断言清单：少了任何一条都判红（防「悄悄删断言」）。 */
const EXPECTED_ASSERTIONS = [
  "boot.banner",
  "screen.normalized",
  "sessions.visible",
  "model.switched",
  "route.pinned",
  "route.header.changed",
  "rm.confirm-visible",
  "rm.store-changed",
  "rewind.file-restored",
  "rewind.child-persisted",
  "exit.code-zero",
  "exit.terminal-restore",
  "quant.clear-bound",
  "assertions.coverage",
];
const NEGATIVE_CONTROLS = new Set(["route", "drop-assertion"]);

/** 驱动脚本里的致命错误（前置已满足但路径跑不下去）→ 记 fail + 退出码 1。 */
class SmokeError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "SmokeError";
    this.detail = detail;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseCli(argv) {
  const options = {
    reportPath: process.env.PTY_SMOKE_REPORT,
    negativeControl: process.env.PTY_SMOKE_NEGATIVE_CONTROL || undefined,
    keepTemp: process.env.PTY_SMOKE_KEEP === "1",
    tempRoot: process.env.PTY_SMOKE_TEMP,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json" || arg === "--report") {
      options.reportPath = argv[index + 1];
      index += 1;
    } else if (arg === "--negative-control") {
      options.negativeControl = argv[index + 1];
      index += 1;
    } else if (arg === "--keep-temp") {
      options.keepTemp = true;
    } else if (arg === "-h" || arg === "--help") {
      process.stdout.write(`${readHelp()}\n`);
      process.exit(EXIT.pass);
    } else {
      throw new SmokeError(`unknown flag: ${arg}`);
    }
  }
  if (options.reportPath === undefined || options.reportPath === "") {
    options.reportPath = join(
      REPO_ROOT,
      "experiments",
      "regression-gate",
      `pty-smoke-${new Date().toISOString().slice(0, 10)}.json`,
    );
  }
  if (options.negativeControl !== undefined && !NEGATIVE_CONTROLS.has(options.negativeControl)) {
    throw new SmokeError(`--negative-control expects route|drop-assertion (got '${options.negativeControl}')`);
  }
  return options;
}

function readHelp() {
  const text = readFileSync(fileURLToPath(import.meta.url), "utf8");
  return text
    .split("\n")
    .filter((line) => line.startsWith(" *"))
    .map((line) => line.replace(/^ \* ?/u, ""))
    .join("\n");
}

/* ── 会话日志读取（多帧 zstd + JSONL） ───────────────────────────────────────
 * rc.1 的 JSONL 后端把日志写成「多个独立 zstd frame 顺序拼接」的容器
 * （dsh-session-persistence-jsonl/lib/index.js 的 scanZstdFrames/compressZstdFrame）；
 * node:zlib 的一次性 API 只解第一帧，所以这里按宿主同款算法先定位帧边界再逐帧解。
 */
const ZSTD_MAGIC = 4247762216;

function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      return { frames, tornStart: start, corrupt: `invalid frame magic at byte ${offset}` };
    }
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

function readSessionLog(file) {
  const buffer = readFileSync(file);
  const { frames, tornStart, corrupt } = scanZstdFrames(buffer);
  const text = Buffer.concat(frames.map((frame) => zstdDecompressSync(buffer.subarray(frame.start, frame.end)))).toString("utf8");
  const records = text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
  const header = records.find((record) => record.type === "session");
  return { header, events: records.filter((record) => record.type !== "session"), tornStart, corrupt };
}

/** 临时 home 下所有 `session-*` 会话日志（含 header 与事件）。 */
function listSessionLogs(home) {
  const root = join(home, "sessions");
  if (!existsSync(root)) return [];
  const out = [];
  for (const slug of readdirSync(root)) {
    const slugDir = join(root, slug);
    if (!statSync(slugDir).isDirectory()) continue;
    for (const entry of readdirSync(slugDir)) {
      if (!entry.startsWith("session-")) continue;
      const file = join(slugDir, entry, "session.v3.jsonl.zstd");
      if (!existsSync(file)) continue;
      out.push({ id: entry, dir: join(slugDir, entry), file, ...readSessionLog(file) });
    }
  }
  return out;
}

const requestHeaderRoutes = (log) =>
  log.events
    .filter((event) => event.type === "request/header")
    .map((event) => event.data?.header?.config)
    .map((config) => (config === undefined ? undefined : `${config.provider}/${config.model}`));

function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}

/* ── PTY 驱动 ───────────────────────────────────────────────────────────── */

class PtyDriver {
  constructor({ pty, TerminalCtor, home, ws, scenarioPath, label }) {
    this.label = label;
    this.term = new TerminalCtor({ cols: COLS, rows: ROWS, allowProposedApi: true, scrollback: 2000 });
    this.started = Date.now();
    this.chunks = [];
    this.raw = "";
    this.exited = undefined;
    this.marks = new Map();
    const env = { ...process.env };
    delete env.DSH_CC_RESUME_SESSION;
    this.child = pty.spawn(
      "dsh",
      ["--profile", PROFILE, "--patch", OVERLAY],
      {
        name: TERM,
        cols: COLS,
        rows: ROWS,
        cwd: ws,
        env: {
          ...env,
          HOME: home,
          DSH_HOME: home,
          TERM,
          COLORTERM: "truecolor",
          CC_TUI_PRESET: PRESET,
          STUB_SCENARIO_FILE: scenarioPath,
          STUB_MODELS: `${STUB_MODEL},${STUB_MODEL_ALT}`,
        },
      },
    );
    this.exitedPromise = new Promise((resolve) => {
      this.child.onExit((event) => {
        this.exited = event;
        resolve(event);
      });
    });
    this.child.onData((data) => {
      this.raw += data;
      this.chunks.push({ at: Date.now() - this.started, bytes: data.length });
      this.term.write(data);
    });
  }

  screen() {
    const buffer = this.term.buffer.active;
    const lines = [];
    for (let row = 0; row < this.term.rows; row += 1) {
      const line = buffer.getLine(row);
      lines.push(line === undefined ? "" : line.translateToString(true).replace(/\s+$/u, ""));
    }
    return lines.join("\n");
  }

  type(text) {
    this.child.write(text);
  }

  mark(name) {
    this.marks.set(name, { chunk: this.chunks.length, raw: this.raw.length, at: Date.now() - this.started });
  }

  rawSince(name) {
    const mark = this.marks.get(name);
    return mark === undefined ? "" : this.raw.slice(mark.raw);
  }

  statsSince(name) {
    const mark = this.marks.get(name);
    const times = this.chunks.slice(mark?.chunk ?? 0).map((chunk) => chunk.at);
    const intervals = times.slice(1).map((at, index) => at - times[index]);
    // 分块间隔按「burst」再聚合一次：连续渲染会把一次 delta 拆成多个 PTY 写，
    // 间隔小于阈值的写归为同一 burst，burst 之间的间隔才反映脚本化流式节奏。
    const burstStarts = times.length === 0 ? [] : [times[0]];
    for (let index = 1; index < times.length; index += 1) {
      if (times[index] - times[index - 1] > STREAM_BURST_GAP_MS) burstStarts.push(times[index]);
    }
    const burstIntervals = burstStarts.slice(1).map((at, index) => at - burstStarts[index]);
    return {
      chunks: times.length,
      intervals: intervals.length,
      p50: quantile(intervals, 0.5),
      p95: quantile(intervals, 0.95),
      firstMs: times[0] ?? null,
      lastMs: times.at(-1) ?? null,
      bursts: burstStarts.length,
      burstP50: quantile(burstIntervals, 0.5),
      burstP95: quantile(burstIntervals, 0.95),
    };
  }

  /** 轮询屏幕直到满足谓词；进程退出或超时都算失败（不隐藏失败原因）。 */
  async waitScreen(label, predicate, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = this.screen();
      if (predicate(value, this.raw)) return { ok: true, atMs: Date.now() - this.started, value };
      if (this.exited !== undefined) {
        return { ok: false, reason: `${label}: process exited: ${JSON.stringify(this.exited)}`, value };
      }
      if (Date.now() >= deadline) return { ok: false, reason: `${label}: timeout after ${String(timeoutMs)}ms`, value };
      await sleep(POLL_MS);
    }
  }

  /** 轮询「某 mark 之后的原始输出」直到满足谓词。 */
  async waitRaw(label, predicate, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = this.raw;
      if (predicate(value, this)) return { ok: true, atMs: Date.now() - this.started, value };
      if (this.exited !== undefined) {
        return { ok: false, reason: `${label}: process exited: ${JSON.stringify(this.exited)}`, value };
      }
      if (Date.now() >= deadline) return { ok: false, reason: `${label}: timeout after ${String(timeoutMs)}ms`, value };
      await sleep(POLL_MS);
    }
  }

  async waitExit(timeoutMs = 30000) {
    const result = await Promise.race([this.exitedPromise, sleep(timeoutMs).then(() => undefined)]);
    return result;
  }

  stop() {
    if (this.exited === undefined) {
      try {
        this.child.kill();
      } catch {
        /* 已退出 */
      }
    }
  }
}

/* ── stub 场景（JSON，经 STUB_SCENARIO_FILE 注入子进程） ──────────────────── */

const USAGE = { type: "usage", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };

function textTurn(text) {
  return [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text },
    { type: "block-end", index: 0, block: { type: "text", text } },
    USAGE,
    { type: "finish", reason: { kind: "stop" } },
  ];
}

/** 按 `delay` 块逐步吐字的文本轮次（T4b 流式分块量化专用）。 */
function streamingTurn(words, gapMs) {
  const chunks = [{ type: "block-start", index: 0, blockType: "text" }];
  words.forEach((word, index) => {
    if (index > 0) chunks.push({ type: "delay", ms: gapMs });
    chunks.push({ type: "text-delta", index: 0, text: word });
  });
  chunks.push({ type: "block-end", index: 0, block: { type: "text", text: words.join("") } });
  chunks.push(USAGE, { type: "finish", reason: { kind: "stop" } });
  return chunks;
}

function toolTurn({ id, name, args }) {
  const argumentsJson = JSON.stringify(args);
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "tool-call-delta", index: 0, id, name, argumentsDelta: argumentsJson },
    { type: "block-end", index: 0, block: { type: "tool-call", id, name, arguments: argumentsJson } },
    USAGE,
    { type: "finish", reason: { kind: "tool-calls" } },
  ];
}

/* ── 前置与渲染 ─────────────────────────────────────────────────────────── */

function loadHostDeps() {
  const anchor = installAnchor();
  const requireFromHost = createRequire(anchor);
  const pty = requireFromHost("node-pty");
  const { Terminal } = requireFromHost("@xterm/headless");
  return { anchor, pty, Terminal };
}

function renderComposition({ tempHome, anchor }) {
  const manifest = existsSync(MANIFEST_PATH) ? readManifest(MANIFEST_PATH) : { status: "missing" };
  const deploymentEntry = manifest.manifest?.deployment?.[PRESET];
  return renderRealComposition({
    repoRoot: REPO_ROOT,
    tempHome,
    presetName: PRESET,
    deploymentRoot: deploymentEntry === undefined ? undefined : resolveDeploymentRoot(deploymentEntry, homedir()),
    installAnchor: anchor,
    env: process.env,
    homeDir: homedir(),
  });
}

/* ── 两个 boot 段 ───────────────────────────────────────────────────────── */

/** boot 1：banner → 会话列表 → 两条消息 → /model 切换 → /exit。 */
async function runBoot1(ctx) {
  const { options } = ctx;
  const driver = new PtyDriver({
    pty: ctx.pty,
    TerminalCtor: ctx.Terminal,
    home: ctx.home,
    ws: ctx.wsReal,
    scenarioPath: ctx.scenario1,
    label: "boot1",
  });
  ctx.drivers.push(driver);

  const banner = await driver.waitScreen("banner", (screen) =>
    screen.includes("dsh-tui v") && screen.includes(`${STUB_PROVIDER}/${STUB_MODEL}`) && screen.includes(`preset ${PRESET}`),
  );
  ctx.snapshots.push({ label: "boot1.banner", text: driver.screen() });
  if (!banner.ok) throw new SmokeError("boot1: banner not reached", banner);
  ctx.metrics.boot1.bannerMs = banner.atMs;
  ctx.metrics.boot1.firstDataMs = driver.chunks[0]?.at ?? null;

  // 消息 1 → 回复 1（同时确认假模型真的在跑）。
  driver.type("first message\r");
  const reply1 = await driver.waitScreen("reply1", (screen) => screen.includes("stub reply one"));
  if (!reply1.ok) throw new SmokeError("boot1: first stub reply missing", reply1);

  // /sessions：列表可见，当前会话标 live。
  driver.type("/sessions\r");
  const sessions = await driver.waitScreen("sessions", (screen) => screen.includes("Sessions in") && screen.includes("live (current)"));
  ctx.snapshots.push({ label: "boot1.sessions", text: driver.screen() });
  if (!sessions.ok) throw new SmokeError("boot1: /sessions list missing", sessions);
  // 证据取「列表行 + 条目行」两段（live 标记在条目行上，不在表头）。
  const sessionsLine = sessions.value
    .split("\n")
    .filter((line) => line.includes("Sessions in") || line.includes("live (current)"))
    .map((line) => line.trim())
    .join(" | ");

  // /model：过滤到假模型目录 → 选中第二条假路由。
  let modelSwitch = { ok: false, reason: "negative control: /model step skipped" };
  if (options.negativeControl !== "route") {
    driver.type("/model\r");
    const picker = await driver.waitScreen("picker", (screen) => screen.includes("search>"));
    if (!picker.ok) throw new SmokeError("boot1: /model picker did not open", picker);
    driver.type("stub");
    const filtered = await driver.waitScreen("picker-filter", (screen) => screen.includes(`${STUB_PROVIDER}/${STUB_MODEL_ALT}`));
    if (!filtered.ok) throw new SmokeError("boot1: stub routes not listed by /model", filtered);
    driver.type("\u001b[B"); // ↓ 选第二条（非 current）
    const selected = await driver.waitScreen("picker-select", (screen) => screen.includes(`\u2192 ${STUB_PROVIDER}/${STUB_MODEL_ALT}`));
    if (!selected.ok) throw new SmokeError("boot1: cannot select the alternate stub route", selected);
    driver.type("\r");
    modelSwitch = await driver.waitScreen("switched", (screen) => screen.includes(`Switched to ${STUB_PROVIDER}/${STUB_MODEL_ALT}`));
    ctx.snapshots.push({ label: "boot1.model-switched", text: driver.screen() });
  }

  // 消息 2（流式）→ 回复 2；这一段是「分块间隔」量化的采样窗口。
  driver.mark("reply2");
  driver.type("second message\r");
  const reply2 = await driver.waitScreen("reply2", (screen) => screen.includes("stub reply two"));
  if (!reply2.ok) throw new SmokeError("boot1: second stub reply missing", reply2);
  driver.mark("reply2-end");
  ctx.metrics.streaming = driver.statsSince("reply2");
  ctx.snapshots.push({ label: "boot1.reply2", text: driver.screen() });

  // /exit：退出码 0 + 备用屏退出 + 光标恢复。
  driver.type("/exit\r");
  const exit = await driver.waitExit(30000);
  ctx.metrics.boot1.exit = exit ?? null;
  ctx.metrics.boot1.chunks = driver.chunks.length;
  ctx.metrics.boot1.clears = (driver.raw.match(/\u001b\[2J/gu) ?? []).length;
  ctx.metrics.boot1.altEnter = (driver.raw.match(/\u001b\[\?1049h/gu) ?? []).length;
  ctx.metrics.boot1.altExit = (driver.raw.match(/\u001b\[\?1049l/gu) ?? []).length;
  ctx.metrics.boot1.cursorShow = (driver.raw.match(/\u001b\[\?25h/gu) ?? []).length;
  return { driver, sessionsLine, modelSwitch };
}

/** boot 2：/rm 删除 boot1 的会话 → /rewind（工具写文件 → 恢复 → fork 重启）→ /exit。 */
async function runBoot2(ctx) {
  const { options } = ctx;
  const driver = new PtyDriver({
    pty: ctx.pty,
    TerminalCtor: ctx.Terminal,
    home: ctx.home,
    ws: ctx.wsReal,
    scenarioPath: ctx.scenario2,
    label: "boot2",
  });
  ctx.drivers.push(driver);

  const banner = await driver.waitScreen("banner", (screen) => screen.includes("dsh-tui v") && screen.includes(`${STUB_PROVIDER}/${STUB_MODEL}`));
  if (!banner.ok) throw new SmokeError("boot2: banner not reached", banner);
  ctx.metrics.boot2 = { bannerMs: banner.atMs, firstDataMs: driver.chunks[0]?.at ?? null };

  // /rm：删除 boot1 留下的会话（当前进程未打开它，故非 live）。
  const sessionA = ctx.sessionA;
  const prefix = sessionA.id.replace(/^session-/u, "").slice(0, 8);
  driver.type(`/rm ${prefix}\r`);
  const confirm = await driver.waitScreen(
    "rm-confirm",
    (screen) => screen.includes("删除会话") && screen.includes(sessionA.id),
  );
  ctx.snapshots.push({ label: "boot2.rm-confirm", text: driver.screen() });
  if (!confirm.ok) throw new SmokeError("boot2: /rm confirmation card missing", confirm);
  driver.type("a");
  const deletedNotice = await driver.waitScreen("rm-deleted", (screen) => screen.includes(`Deleted ${sessionA.id}`));
  if (!deletedNotice.ok) throw new SmokeError("boot2: /rm did not report deletion", deletedNotice);
  const rmDeadline = Date.now() + 10000;
  while (existsSync(sessionA.dir) && Date.now() < rmDeadline) await sleep(POLL_MS);
  const rmStoreChanged = !existsSync(sessionA.dir);

  // 记录本进程的根会话（boot2 的 B）——此时 A 已删，按 cwd 唯一。
  const logsAfterRm = listSessionLogs(ctx.home).filter((log) => log.header?.cwd === ctx.wsReal);
  const sessionB = logsAfterRm[0];
  if (sessionB === undefined) throw new SmokeError("boot2: cannot locate the live root session log after /rm");

  // 工具轮：str_replace_editor create 写目标文件（rewind 的恢复对象）。
  driver.type("create the file\r");
  const toolResult = await driver.waitScreen("tool-result", (screen) => screen.includes("created target.txt") || screen.includes("Tool / str_replace_editor"));
  if (!toolResult.ok) throw new SmokeError("boot2: tool turn did not run", toolResult);
  const fileDeadline = Date.now() + 10000;
  while (!existsSync(ctx.target) && Date.now() < fileDeadline) await sleep(POLL_MS);
  const fileCreated = existsSync(ctx.target);

  // /rewind <seq>：先列历史消息取 seq，再执行（fork + 文件恢复 + execve 重启）。
  driver.type("/rewind\r");
  const listed = await driver.waitScreen("rewind-list", (screen) => /\[\d+\] create the file/u.test(screen));
  if (!listed.ok) throw new SmokeError("boot2: /rewind did not list past messages", listed);
  const seq = Number(/\[(\d+)\] create the file/u.exec(listed.value)?.[1] ?? Number.NaN);
  if (!Number.isInteger(seq)) throw new SmokeError("boot2: cannot parse the rewind seq", { screen: listed.value });
  driver.mark("rewind");
  driver.type(`/rewind ${seq}\r`);
  const relaunch = await driver.waitRaw("rewind-relaunch", (_raw, self) => self.rawSince("rewind").includes("dsh-rewind:"));
  const rebanner = await driver.waitScreen("rewind-rebanner", (screen) => screen.includes("dsh-tui v"));
  if (!relaunch.ok || !rebanner.ok) throw new SmokeError("boot2: /rewind did not relaunch", { relaunch, rebanner });
  const restoreDeadline = Date.now() + 10000;
  while (existsSync(ctx.target) && Date.now() < restoreDeadline) await sleep(POLL_MS);
  const fileRestored = !existsSync(ctx.target);
  const rewindSummary = /dsh-rewind:[^\n]*/u.exec(driver.rawSince("rewind"))?.[0] ?? "";

  // 会话列表 + fork 子会话落盘（isSeeded + parentSession）。
  driver.type("/sessions\r");
  const sessions = await driver.waitScreen("sessions-after-rewind", (screen) => screen.includes("Sessions in"));
  if (!sessions.ok) throw new SmokeError("boot2: /sessions after rewind missing", sessions);
  const countMatch = /Sessions in [^\n]*?\((\d+)/u.exec(sessions.value);
  ctx.snapshots.push({ label: "boot2.sessions-after-rewind", text: driver.screen() });
  const logsAfterRewind = listSessionLogs(ctx.home).filter((log) => log.header?.cwd === ctx.wsReal);
  const child = logsAfterRewind.find((log) => log.header?.isSeeded === true && log.header?.parentSession === sessionB.id);

  // /exit（重启后的进程）：退出码 0 + 终端恢复。
  driver.type("/exit\r");
  const exit = await driver.waitExit(30000);
  ctx.metrics.boot2.exit = exit ?? null;
  ctx.metrics.boot2.chunks = driver.chunks.length;
  ctx.metrics.boot2.clears = (driver.raw.match(/\u001b\[2J/gu) ?? []).length;
  ctx.metrics.boot2.altEnter = (driver.raw.match(/\u001b\[\?1049h/gu) ?? []).length;
  ctx.metrics.boot2.altExit = (driver.raw.match(/\u001b\[\?1049l/gu) ?? []).length;
  ctx.metrics.boot2.cursorShow = (driver.raw.match(/\u001b\[\?25h/gu) ?? []).length;

  return {
    driver,
    rm: { confirm: confirm.ok, storeChanged: rmStoreChanged },
    rewind: { fileCreated, fileRestored, seq, summary: rewindSummary, sessionsCount: countMatch === null ? null : Number(countMatch[1]), child, sessionB },
  };
}

/* ── 断言组装 ───────────────────────────────────────────────────────────── */

function pushAssertions(ctx, boot1, boot2) {
  const { t, metrics, snapshots } = ctx;
  const stubRoute = `${STUB_PROVIDER}/${STUB_MODEL}`;
  const altRoute = `${STUB_PROVIDER}/${STUB_MODEL_ALT}`;

  // boot.banner：真实组合 + 钉住的假模型路由都出现在首屏。
  const boot2BannerOk = typeof metrics.boot2?.bannerMs === "number";
  t[boot2BannerOk ? "pass" : "fail"](
    "boot.banner",
    `boot1 banner=${String(metrics.boot1.bannerMs)}ms firstData=${String(metrics.boot1.firstDataMs)}ms; boot2 banner=${String(metrics.boot2?.bannerMs)}ms; workspace=${ctx.wsReal}`,
    { profile: PROFILE, preset: PRESET, stubRoute },
  );

  // screen.normalized：归一化后无 ESC/控制字符残留、无超列宽行。
  const problems = [];
  let maxWidth = 0;
  for (const snapshot of snapshots) {
    for (const line of snapshot.text.split("\n")) {
      if (/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(line)) problems.push(`${snapshot.label}: control char in ${JSON.stringify(line.slice(0, 60))}`);
      const width = visibleWidth(line);
      maxWidth = Math.max(maxWidth, width);
      if (width > COLS) problems.push(`${snapshot.label}: width ${width} > ${COLS}`);
    }
  }
  t[problems.length === 0 ? "pass" : "fail"](
    "screen.normalized",
    `${snapshots.length} snapshots, maxWidth=${maxWidth}/${COLS}, problems=${problems.join("; ") || "none"}`,
    problems.length === 0 ? undefined : { problems },
  );

  // sessions.visible：boot1 /sessions 显示当前会话为 live。
  t[boot1.sessionsLine.includes("live (current)") ? "pass" : "fail"]("sessions.visible", boot1.sessionsLine.trim());

  // model.switched：状态/提示切到备用假路由。
  t[boot1.modelSwitch.ok ? "pass" : "fail"](
    "model.switched",
    boot1.modelSwitch.ok ? `Switched notice + status bar = ${altRoute}` : String(boot1.modelSwitch.reason),
  );

  // 会话日志：首条请求必须已经钉在假模型上（防忘挂 overlay 打真实 provider）。
  const routes = requestHeaderRoutes(ctx.sessionA);
  t[routes[0] === stubRoute ? "pass" : "fail"](
    "route.pinned",
    `session ${ctx.sessionA.id} first request/header=${routes[0] ?? "(none)"}`,
  );
  // route.header.changed：/model 之后的下一条请求头路由变化。
  const expectedRoutes = [stubRoute, altRoute];
  const changed = routes.length === 2 && routes[0] === expectedRoutes[0] && routes[1] === expectedRoutes[1];
  t[changed ? "pass" : "fail"](
    "route.header.changed",
    `session ${ctx.sessionA.id} request/header routes = [${routes.join(", ")}]`,
  );

  // rm：确认卡可见 + 存储发生变化。
  t[boot2.rm.confirm ? "pass" : "fail"](
    "rm.confirm-visible",
    boot2.rm.confirm ? `/rm confirm card showed ${ctx.sessionA.id}` : "confirm card not observed",
  );
  t[boot2.rm.storeChanged ? "pass" : "fail"](
    "rm.store-changed",
    `session dir ${boot2.rm.storeChanged ? "removed" : "still present"}: ${ctx.sessionA.dir}`,
  );

  // rewind：文件创建 → 恢复（删除）→ fork 子会话落盘。
  const rewindEvidence = `seq=${String(boot2.rewind.seq)} created=${String(boot2.rewind.fileCreated)} restored=${String(boot2.rewind.fileRestored)}; stderr=${boot2.rewind.summary || "(none)"}`;
  t[boot2.rewind.fileCreated && boot2.rewind.fileRestored ? "pass" : "fail"]("rewind.file-restored", rewindEvidence);
  const childOk = boot2.rewind.child !== undefined && boot2.rewind.sessionsCount === 2;
  t[childOk ? "pass" : "fail"](
    "rewind.child-persisted",
    `child=${boot2.rewind.child?.id ?? "(none)"} isSeeded=${String(boot2.rewind.child?.header?.isSeeded)} parent=${String(boot2.rewind.child?.header?.parentSession)}; sessions count=${String(boot2.rewind.sessionsCount)}`,
  );

  // 退出码与终端恢复（两次 boot 各一份证据）。
  const exits = [metrics.boot1.exit, metrics.boot2.exit];
  const exitOk = exits.every((event) => event !== undefined && event !== null && event.exitCode === 0);
  t[exitOk ? "pass" : "fail"]("exit.code-zero", `exit events = ${exits.map((event) => (event === null || event === undefined ? "timeout" : String(event.exitCode))).join(", ")}`);
  const restores = [metrics.boot1, metrics.boot2].map(
    (entry) => `altExit=${String(entry.altExit)} cursor=${String(entry.cursorShow)}`,
  );
  const restoreOk = [metrics.boot1, metrics.boot2].every((entry) => entry.altExit >= 1 && entry.cursorShow >= 1);
  t[restoreOk ? "pass" : "fail"]("exit.terminal-restore", restores.join("; "));
  const starts = 3; // boot1 + boot2 首启 + /rewind 的 execve 重启
  const clears = metrics.boot1.clears + metrics.boot2.clears;
  const clearOk = metrics.boot1.clears <= MAX_CLEARS_PER_START && metrics.boot2.clears <= MAX_CLEARS_PER_START * 2;
  t[clearOk ? "pass" : "fail"](
    "quant.clear-bound",
    `clears boot1=${String(metrics.boot1.clears)} boot2=${String(metrics.boot2.clears)} total=${String(clears)} (bound ${String(MAX_CLEARS_PER_START)}/start, ${String(starts)} starts)`,
  );
}

/* ── 主流程 ─────────────────────────────────────────────────────────────── */

async function main() {
  const options = parseCli(process.argv.slice(2));
  const t = createAssertions();
  const startedAt = new Date().toISOString();
  const metrics = { boot1: {}, boot2: undefined, streaming: undefined };
  const drivers = [];
  const snapshots = [];
  let tempRoot;
  let tempCreated = false;

  const finishReport = (extra) => {
    const head = run("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT });
    const status = run("git", ["status", "--porcelain"], { cwd: REPO_ROOT });
    const failed = t.assertions.filter((assertion) => assertion.status === "fail").length;
    const report = {
      kind: "pty-smoke",
      version: 1,
      startedAt,
      finishedAt: new Date().toISOString(),
      gitHead: head.status === 0 ? head.stdout.trim() : undefined,
      gitDirty: status.status === 0 ? status.stdout.trim() !== "" : undefined,
      hostVersion: extra.hostVersion,
      sessionFormatVersion: SESSION_FORMAT_VERSION,
      negativeControl: options.negativeControl ?? null,
      pty: { cols: COLS, rows: ROWS, term: TERM },
      composition: extra.composition,
      metrics,
      assertions: t.assertions,
      summary: { passed: t.assertions.length - failed, failed },
    };
    writeReport(options.reportPath, report);
    process.stdout.write(`pty-smoke: report ${options.reportPath}\n`);
    process.stdout.write(`pty-smoke: assertions ${String(report.summary.passed)}/${String(t.assertions.length)} passed\n`);
    return failed;
  };

  /** 环境前置不满足 → exit 2（无论前面是否已记录失败断言）。 */
  const precondition = (message, detail) => {
    process.stderr.write(`pty-smoke: ${message}\n`);
    t.fail("precondition", message, detail);
    metrics.precondition = message;
    finishReport({ composition: undefined });
    if (tempCreated && !options.keepTemp) rmSync(tempRoot, { recursive: true, force: true });
    process.exit(EXIT.precondition);
  };

  let deps;
  try {
    deps = loadHostDeps();
  } catch (error) {
    precondition(`host PTY deps unavailable: ${String(error.message ?? error)} — run scripts/link-global-dsh.sh`, {
      error: String(error.message ?? error),
    });
    return;
  }
  let hostVersion;
  try {
    hostVersion = JSON.parse(readFileSync(deps.anchor, "utf8")).version;
  } catch {
    hostVersion = undefined;
  }

  tempRoot = options.tempRoot ?? mkdtempSync(join(tmpdir(), "dsh-pty-smoke-XXXXXX"));
  tempCreated = true;
  const home = join(tempRoot, "home");
  const ws = join(tempRoot, "ws");
  mkdirSync(home, { recursive: true });
  mkdirSync(ws, { recursive: true });
  const wsReal = realpathSync(ws);
  const target = join(wsReal, "target.txt");

  let composition;
  try {
    composition = renderComposition({ tempHome: home, anchor: deps.anchor });
  } catch (error) {
    const message = error instanceof RenderRealError ? error.message : `real composition render failed: ${String(error.message ?? error)}`;
    precondition(message, error.detail);
    return;
  }

  // 两个场景：boot1 对话（回复 2 流式），boot2 rewind（工具写文件 → 文本收尾）。
  const scenario1 = join(tempRoot, "scenario-boot1.json");
  const scenario2 = join(tempRoot, "scenario-boot2.json");
  writeFileSync(
    scenario1,
    JSON.stringify({
      id: "pty-smoke-boot1",
      turns: [textTurn("stub reply one"), streamingTurn(["stub ", "reply ", "two"], STREAM_GAP_MS), textTurn("unused")],
    }),
  );
  writeFileSync(
    scenario2,
    JSON.stringify({
      id: "pty-smoke-boot2",
      turns: [
        toolTurn({
          id: "call-rewind-1",
          name: "str_replace_editor",
          args: { command: "create", path: target, file_text: "v1\n" },
        }),
        textTurn("created target.txt"),
        textTurn("unused"),
      ],
    }),
  );

  const ctx = { t, options, pty: deps.pty, Terminal: deps.Terminal, home, wsReal, target, drivers, metrics, snapshots, scenario1, scenario2 };

  let boot1;
  let boot2;
  try {
    boot1 = await runBoot1(ctx);
    ctx.sessionA = listSessionLogs(home).filter((log) => log.header?.cwd === wsReal)[0];
    if (ctx.sessionA === undefined) throw new SmokeError("boot1: no persisted session log found", { home });
    boot2 = await runBoot2(ctx);
  } catch (error) {
    t.fail("runner.aborted", error instanceof SmokeError ? error.message : String(error?.message ?? error), error?.detail);
  } finally {
    for (const driver of drivers) driver.stop();
    if (options.keepTemp) process.stderr.write(`pty-smoke: kept temp home at ${tempRoot}\n`);
    else rmSync(tempRoot, { recursive: true, force: true });
  }

  if (boot1 !== undefined && ctx.sessionA !== undefined && boot2 !== undefined) {
    pushAssertions(ctx, boot1, boot2);
  } else {
    // 路径中断时把未跑到的断言显式标红，不留给上限覆盖率兜底。
    for (const id of EXPECTED_ASSERTIONS) {
      if (!t.assertions.some((assertion) => assertion.id === id)) t.fail(id, "not reached (runner aborted)");
    }
  }

  // 负路径（验收可复现）：模拟「断言被删」——覆盖检查必须抓住。
  if (options.negativeControl === "drop-assertion") {
    const dropId = "rewind.file-restored";
    const index = t.assertions.findIndex((assertion) => assertion.id === dropId);
    if (index !== -1) t.assertions.splice(index, 1);
  }
  const ran = new Set(t.assertions.map((assertion) => assertion.id));
  // 覆盖检查自身不参与「是否存在」判断（它正在被写入）。
  const required = EXPECTED_ASSERTIONS.filter((id) => id !== "assertions.coverage");
  const missing = required.filter((id) => !ran.has(id));
  t[missing.length === 0 ? "pass" : "fail"](
    "assertions.coverage",
    missing.length === 0 ? `all ${String(required.length)} declared assertions ran` : `missing: ${missing.join(", ")}`,
    missing.length === 0 ? undefined : { missing },
  );

  const failed = finishReport({
    hostVersion,
    composition: {
      profile: PROFILE,
      sourcePath: composition.sourcePath,
      sourceSha: composition.sourceSha,
      renderedPath: composition.renderedPath,
      renderedSha: composition.renderedSha,
      preset: composition.preset,
      settings: composition.settings,
    },
  });
  process.exit(failed === 0 ? EXIT.pass : EXIT.fail);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`pty-smoke: ${error instanceof SmokeError ? error.message : String(error?.stack ?? error)}\n`);
  process.exit(EXIT.precondition);
}
