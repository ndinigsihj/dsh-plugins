/**
 * liangshen-plus live smoke — 真实 LLM 三轮回合，复刻 TUI 路径。
 *
 * 用 headless profile 完整组合 + agent-presets 挂载 liangshen-plus，
 * 通过 agent-loop 真实驱动：
 *   R1. 禁止调工具，文字回答工具清单（期望：2 个）
 *   R2. 用 bash 执行命令（触发 promotion + swap）
 *   R3. 禁止调工具，文字回答工具清单（期望：完整目录；bash 带提权）
 *
 * 运行：DEEPSEEK_API_KEY=$(grep DEEPSEEK_API_KEY ~/.dsh/.credentials.yaml | cut -d' ' -f2) \
 *       node presets/liangshen-plus/smoke-live.mjs
 * 或直接运行（脚本内自动读 credentials）。
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { installModelSelection } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-agent/lib/index.js";
import { createUserMessage } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-llm/lib/index.js";
import { SessionId } from "/Users/vito/data/dev/dsh-plugins/node_modules/@deepseek-ai/dsh-session/lib/index.js";
import { boot, loadProfile } from "/Users/vito/.dsh/profiles/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js";

// 自动注入 credentials（与 dsh CLI 相同的解析来源）
try {
  const creds = readFileSync(`${process.env.HOME}/.dsh/.credentials.yaml`, "utf8");
  for (const line of creds.split("\n")) {
    const m = /^([A-Z_]+):\s*(\S+)/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {}

const INSTALL_ANCHOR = "/Users/vito/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/package.json";
const SMOKE_DRIVER = "/Users/vito/data/dev/dsh-plugins/presets/liangshen-plus/smoke-live-driver.mjs";

const profile = loadProfile("dsh", "headless", INSTALL_ANCHOR);
const bundlePatches = profile.layers.flatMap((layer) => layer.patches);
const smokePatches = [
  { id: "headless-runner", disabled: true },
  { id: "headless-startup", disabled: true },
  { id: "tool-bash", disabled: true },
  {
    insert: [
      {
        id: "agent-presets",
        name: "@deepseek-ai/dsh-agent-presets",
        config: { default: "liangshen-plus", roots: [], includeUserRoot: true },
      },
      { id: "liangshen-plus-live-smoke", name: SMOKE_DRIVER },
    ],
  },
];

const ctx = await boot("liangshen-plus-live-smoke", join(profile.dir, "cordis.yml"), [
  ...bundlePatches,
  ...profile.patches,
  ...smokePatches,
]);
await ctx.get("loader")?.await();

// 总超时保护（LLM 可能慢）
setTimeout(() => {
  console.error("LIVE SMOKE TIMEOUT");
  process.exit(2);
}, 300000).unref();

// 由 driver 插件内的 run() 驱动并退出
export const name = "liangshen-plus-live-smoke";
