#!/usr/bin/env node
/**
 * 生成器 CLI（`scripts/agent-preset-bundle.mjs` 的薄入口；票据 07）。
 *
 *   node scripts/agent-preset-bundle-cli.mjs             # 从真源重生成入库产物
 *   node scripts/agent-preset-bundle-cli.mjs --check     # 逐文件核对入库产物与真源再生
 *   --source <dir> / --out <dir>                         # 换真源 / 换产物目录
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLE_OUT_DIR, BUNDLE_SOURCE_DIR, checkPresetBundle, generatePresetBundle } from "./agent-preset-bundle.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv) {
  const options = { source: BUNDLE_SOURCE_DIR, out: BUNDLE_OUT_DIR, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--source") options.source = argv[++index];
    else if (token === "--out") options.out = argv[++index];
    else if (token === "--check") options.check = true;
    else throw new Error(`agent-preset-bundle: unknown argument ${token}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.check) {
  const result = checkPresetBundle({
    sourceDir: resolve(REPO_ROOT, options.source),
    bundleDir: resolve(REPO_ROOT, options.out),
    sourceLabel: options.source,
    tempDir: process.env.TMPDIR ?? "/tmp",
  });
  for (const file of result.comparison.files) {
    process.stdout.write(`${file.status === "match" ? "ok   " : "DRIFT"} ${file.path} ${String(file.b ?? "missing").slice(0, 12)}\n`);
  }
  process.stdout.write(
    result.ok ? `agent-preset-bundle: ${String(result.comparison.files.length)} files match ${options.out}\n` : `agent-preset-bundle: drift in ${options.out}\n`,
  );
  process.exit(result.ok ? 0 : 1);
}
const result = generatePresetBundle({
  sourceDir: resolve(REPO_ROOT, options.source),
  outDir: resolve(REPO_ROOT, options.out),
  sourceLabel: options.source,
});
for (const file of result.files) process.stdout.write(`${file.kind.padEnd(9)} ${file.path} sha256=${file.sha256}\n`);
process.stdout.write(`agent-preset-bundle: wrote ${String(result.files.length)} files to ${options.out}\n`);
