/**
 * M4 §5 实验 runner — A/B/C/D 锚定复测（真实 LLM，N 跑/组，全新 session/跑）。
 *
 * 组合 headless profile 完整 bundle + agent-presets（默认 preset 无所谓，driver
 * 按组显式 mount），由 m4-driver 驱动全部组别并写 JSONL + 汇总。
 *
 * 运行：node presets/liangshen-plus/m4-runner.mjs
 * env 见 m4-driver.mjs 头注释（M4_GROUPS / M4_RUNS / M4_TASK / M4_OUT ...）。
 * 示例（先验 1 跑/组）：
 *   M4_GROUPS=A,C M4_RUNS=1 node presets/liangshen-plus/m4-runner.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
const M4_DRIVER = process.env.M4_DRIVER_PATH ?? "/Users/vito/data/dev/dsh-plugins/presets/liangshen-plus/m4-driver.mjs";

const groups = (process.env.M4_GROUPS ?? "A,B,C,D").split(",").map((s) => s.trim()).filter(Boolean);
const runs = Number(process.env.M4_RUNS ?? 9);
// 总超时保护：每跑 240s + 余量；LLM 慢时由 driver 的 per-run race 兜底
setTimeout(() => {
  console.error("M4 RUNNER TIMEOUT");
  process.exit(2);
}, groups.length * runs * 240000 + 120000).unref();

const profile = loadProfile("dsh", "headless", INSTALL_ANCHOR);
const bundlePatches = profile.layers.flatMap((layer) => layer.patches);
const m4Patches = [
  { id: "headless-runner", disabled: true },
  { id: "headless-startup", disabled: true },
  { id: "tool-bash", disabled: true },
  // session 持久化 root 从 ~/.dsh/sessions 改到 /tmp：headless 进程跑在本机文件
  // 沙箱（workspace-write）下，~/.dsh 不可写（EPERM）；实验不需要跨进程恢复，
  // /tmp 足够（干净、不进 git）。
  { id: "session-persistence-jsonl", config: { root: "/tmp/liangshen-plus-m4-sessions" } },
  {
    insert: [
      {
        id: "agent-presets",
        name: "@deepseek-ai/dsh-agent-presets",
        config: {
          default: "liangshen-plus",
          roots: (process.env.M4_PRESET_ROOTS ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((path) => ({ path, trust: "user" })),
          includeUserRoot: true,
        },
      },
      { id: "m4-driver", name: M4_DRIVER },
    ],
  },
];

const ctx = await boot("m4-runner", join(profile.dir, "cordis.yml"), [
  ...bundlePatches,
  ...profile.patches,
  ...m4Patches,
]);
await ctx.get("loader")?.await();

export const name = "m4-runner";
