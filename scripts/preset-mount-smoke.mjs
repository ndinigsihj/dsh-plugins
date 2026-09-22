#!/usr/bin/env node
/**
 * preset 部署位挂载冒烟（2026-09-22 事故补检；v0.2.1 起随发版序列执行）。
 *
 * 用途：在**真 PTY** 里启动一个**真实 profile**（默认 `tui`，即 `1mdsh` 那条路径），
 * 加载**部署位** preset（`~/.dsh/.agent-presets/<preset>`），断言 preset 真的挂上了。
 *
 * 为什么需要（2026-09-22 实测）：仓库侧可以全绿而 stable 通道照样挂不起来——回归闸门
 * 只渲染 `tui-dev` 组合，而预设收敛后统一 `minimal-plus` 声明了
 * `modelSelectionSettings: true`，stable `tui` profile 缺宿主作用域单例，启动即
 * `preset "minimal-plus" failed to mount: … in the Host scope`。这类故障只有真起
 * stable profile + 部署位副本才看得见，因此本脚本进 release.sh 的收尾序列。
 *
 * 用法：
 *   node scripts/preset-mount-smoke.mjs                         # profile tui + minimal-plus
 *   node scripts/preset-mount-smoke.mjs --profile tui-dev
 *   node scripts/preset-mount-smoke.mjs --launcher <path>       # 稳定通道启动器（如 tui-stable）
 *   node scripts/preset-mount-smoke.mjs --json /tmp/x.json --keep-temp
 *
 * 启动方式：默认按宿主锚点（scripts/host-runtime.mjs）直接起 CLI，并带
 * `--expose-internals`——0.1.5-rc.2 起自定义 profile 默认 `patchReload: live`，CLI 会挂
 * `@deepseek-ai/cordis-plugin-hmr`，而该插件要求 node 带此标志，否则启动即
 * `--expose-internals is required for HMR service`。`--launcher` 传外部启动器时，
 * 标志由该启动器自己负责（稳定通道的 `tui-stable` 已带）。
 * 退出码：0 全过 / 1 断言失败 / 2 环境前置不满足（node-pty 缺失、PTY 打不开、profile
 * 或部署位 preset 缺失）。
 *
 * 隔离：HOME/DSH_HOME 都指向临时 home（profile / settings / 部署位 preset 都是副本），
 * 真实 `~/.dsh` 只读；不切会话、不提交消息，因此不产生任何 provider 请求。
 *
 * 断言：
 *   boot.rendered        界面真的画出来了（输出含清屏序列）
 *   mount.no-error       没有挂载失败 / 缺宿主单例 / 已移除事件接口的报错行
 *   mount.preset-visible 界面里出现该 preset id（证明挂的是它，而不是被悄悄跳过）
 */
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT, createAssertions, writeReport } from "../gates/gate-helpers.mjs";
import { installAnchor } from "./host-runtime.mjs";

const HOST_ANCHOR = installAnchor();
/** 宿主 CLI 入口（`<dsh>/lib/bin.js`）：`--expose-internals` 要挂在它前面。 */
const HOST_BIN = join(dirname(HOST_ANCHOR), "lib", "bin.js");
const HOME_DIR = homedir();
const DSH_DIR = join(HOME_DIR, ".dsh");
const PROFILE_FILES = ["cordis.patch.yml", "package.json", "cordis.yml"];
const DEFAULT_TIMEOUT_MS = 15_000;
const COLS = 120;
const ROWS = 30;
/**
 * 已知的「preset 没挂上」签名。任何一个出现即判红——这些字符串是宿主/preset 的真实
 * 报错文本，不是本仓库的推断（2026-09-22 两条实测：rc.1 已移除的 `session.events`
 * getter、缺失的宿主作用域 `modelSelectionSettings` 单例）。
 */
const FAILURE_PATTERNS = [
  /failed to mount/u,
  /in the Host scope/u,
  /is not iterable/u,
  /UNKNOWN:/u,
];

function parseArgs(argv) {
  const options = {
    profile: "tui",
    preset: "minimal-plus",
    launcher: undefined,
    reportPath: undefined,
    keepTemp: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return argv[i];
    };
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--profile") {
      options.profile = next();
    } else if (arg === "--preset") {
      options.preset = next();
    } else if (arg === "--launcher") {
      options.launcher = next();
    } else if (arg === "--json") {
      options.reportPath = next();
    } else if (arg === "--keep-temp") {
      options.keepTemp = true;
    } else if (arg === "--print-output") {
      options.printOutput = true;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(next());
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }
  return options;
}

function usage() {
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
  return source
    .split("\n")
    .filter((line, index) => index > 0 && line.startsWith(" *"))
    .map((line) => line.replace(/^ \* ?/u, ""))
    .join("\n");
}

/** 把真实 home 的 profile / settings / 部署位 preset 复制进临时 home（真实 ~/.dsh 只读）。 */
function stageHome({ tempHome, profile, preset, onMissing }) {
  const sourceProfile = join(DSH_DIR, "profiles", profile);
  if (!existsSync(join(sourceProfile, "cordis.patch.yml"))) {
    onMissing(`profile not found: ${sourceProfile}`);
  }
  const targetProfile = join(tempHome, "profiles", profile);
  mkdirSync(targetProfile, { recursive: true });
  for (const file of PROFILE_FILES) {
    if (existsSync(join(sourceProfile, file))) {
      cpSync(join(sourceProfile, file), join(targetProfile, file));
    }
  }
  const profileDeps = join(sourceProfile, "node_modules");
  if (existsSync(profileDeps)) symlinkSync(profileDeps, join(targetProfile, "node_modules"), "dir");

  const sourceSettings = join(DSH_DIR, "settings.yaml");
  if (existsSync(sourceSettings)) cpSync(sourceSettings, join(tempHome, "settings.yaml"));

  const sourcePreset = join(DSH_DIR, ".agent-presets", preset);
  if (!existsSync(join(sourcePreset, "agent.cordis.yml"))) {
    onMissing(`deployed preset not found: ${sourcePreset}`);
  }
  const targetPreset = join(tempHome, ".agent-presets", preset);
  mkdirSync(join(tempHome, ".agent-presets"), { recursive: true });
  // 整树复制（含相对路径插件与 node_modules symlink）：验的就是部署位那 8 个文件。
  cpSync(sourcePreset, targetPreset, { recursive: true });
  return { sourceProfile, sourcePreset, targetPreset };
}

const options = parseArgs(process.argv.slice(2));
if (options.help === true) {
  process.stdout.write(`${usage()}\n`);
  process.exit(EXIT.pass);
}

const startedAt = new Date().toISOString();
const t = createAssertions();
const summarize = () => ({
  passed: t.assertions.filter((assertion) => assertion.status === "pass").length,
  failed: t.assertions.filter((assertion) => assertion.status === "fail").length,
  skipped: t.assertions.filter((assertion) => assertion.status === "skip").length,
});
const tempHome = mkdtempSync(join(tmpdir(), "dsh-preset-mount-"));
let tempKept = false;
const finish = (report) => {
  const summary = summarize();
  const full = { ...report, assertions: t.assertions, summary, finishedAt: new Date().toISOString() };
  if (options.reportPath !== undefined) writeReport(options.reportPath, full);
  process.stdout.write(
    `preset-mount-smoke: ${String(summary.passed)}/${String(t.assertions.length)} passed (${options.profile} + ${options.preset})\n`,
  );
  for (const assertion of t.assertions) {
    if (assertion.status !== "pass") {
      process.stdout.write(`  ${assertion.status.toUpperCase()} ${assertion.id}: ${String(assertion.evidence)}\n`);
    }
  }
  if (!options.keepTemp && !tempKept) rmSync(tempHome, { recursive: true, force: true });
  return summary.failed > 0 ? EXIT.fail : EXIT.pass;
};

/** 前置不满足：记录 precondition 断言后 exit 2（T4b 同款处置）。 */
const precondition = (message) => {
  process.stderr.write(`preset-mount-smoke: ${message}\n`);
  t.fail("precondition", message);
  process.exit(finish({ kind: "preset-mount-smoke", version: 1, startedAt, precondition: message }));
};

let staged;
try {
  staged = stageHome({
    tempHome,
    profile: options.profile,
    preset: options.preset,
    onMissing: precondition,
  });
} catch (error) {
  precondition(`staging failed: ${error.message}`);
}

let pty;
try {
  pty = createRequire(HOST_ANCHOR)("node-pty");
} catch (error) {
  precondition(`node-pty unavailable from the host tree: ${error.message}`);
}

if (options.keepTemp) {
  tempKept = true;
  process.stdout.write(`preset-mount-smoke: keeping temp home ${tempHome}\n`);
}

const args = [];
let command = options.launcher;
if (options.launcher === undefined) {
  command = process.execPath;
  args.push("--expose-internals", HOST_BIN, "--profile", options.profile);
} else if (basename(options.launcher) === "dsh") {
  args.push("--profile", options.profile);
}
const spawnEnv = {
  ...process.env,
  HOME: tempHome,
  DSH_HOME: tempHome,
  TERM: "xterm-256color",
  COLORTERM: "truecolor",
  CC_TUI_PRESET: options.preset,
};
delete spawnEnv.DSH_CC_RESUME_SESSION;
const child = (() => {
  try {
    return pty.spawn(command, args, {
      name: "xterm-256color",
      cols: COLS,
      rows: ROWS,
      cwd: tempHome,
      env: spawnEnv,
    });
  } catch (error) {
    precondition(`PTY spawn failed: ${error.message}`);
    return undefined;
  }
})();

let raw = "";
child.onData((data) => {
  raw += data;
});

const finishRun = () => {
  const stripper = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/gu;
  const text = raw.replace(stripper, "");
  const failureLines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => FAILURE_PATTERNS.some((pattern) => pattern.test(line)));
  if (failureLines.length === 0) {
    t.pass("mount.no-error", `no failure signature in ${String(raw.length)} bytes`);
  } else {
    t.fail("mount.no-error", failureLines.slice(0, 3).join(" | "));
  }
  const clears = (raw.match(/\u001b\[2J/gu) ?? []).length;
  if (clears > 0) t.pass("boot.rendered", `screen clears=${String(clears)}`);
  else t.fail("boot.rendered", `no screen clear in ${String(raw.length)} bytes of output`);

  if (text.toLowerCase().includes(options.preset.toLowerCase())) {
    t.pass("mount.preset-visible", `output names ${options.preset}`);
  } else {
    t.fail("mount.preset-visible", `output never names ${options.preset}`);
  }

  if (options.printOutput === true) {
    process.stdout.write(`---- captured output (${String(raw.length)} bytes, ANSI stripped) ----\n`);
    process.stdout.write(
      text
        .split(/\r?\n/u)
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0)
        .join("\n"),
    );
    process.stdout.write("\n---- end captured output ----\n");
  }

  process.exit(
    finish({
      kind: "preset-mount-smoke",
      version: 1,
      startedAt,
      profile: options.profile,
      preset: options.preset,
      launcher: options.launcher,
      presetSource: staged.sourcePreset,
      profileSource: staged.sourceProfile,
      tempHome: options.keepTemp ? tempHome : undefined,
      capturedBytes: raw.length,
    }),
  );
};

setTimeout(() => {
  try {
    child.kill();
  } catch {
    /* already exited */
  }
  finishRun();
}, options.timeoutMs);
