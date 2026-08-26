/**
 * liangshen-plus smoke boot — 用 headless profile 的完整 bundle 组合 + patches 跑 smoke-driver。
 *
 * 运行：node presets/liangshen-plus/smoke-boot.mjs
 *
 * 组合方式对齐 dsh CLI：loadProfile 解析 profile 的 bundles（dsh-base + dsh-headless），
 * 把 bundle patches + profile patch + 本脚本的 smoke patches 全量交给 boot()。
 * 本 smoke 不发 LLM 请求，只 assemble + pre-step，因此 provider 只需能解析 selection。
 */
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  boot,
  loadProfile,
} from "/Users/vito/.dsh/profiles/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js";

// dsh CLI 安装锚点（bundle 解析基准，同 CLI 的 INSTALL_ANCHOR）
const INSTALL_ANCHOR = "/Users/vito/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/package.json";
const SMOKE_DRIVER = "/Users/vito/data/dev/dsh-plugins/presets/liangshen-plus/smoke-driver.mjs";

const profile = loadProfile("dsh", "headless", INSTALL_ANCHOR);
const bundlePatches = profile.layers.flatMap((layer) => layer.patches);

const smokePatches = [
  // 禁用 stock headless runner（它不挂 preset，会抢跑）
  { id: "headless-runner", disabled: true },
  { id: "headless-startup", disabled: true },
  // dsh-base 的 tool-bash 会与 preset 的 bash 撞名 → 按 endless-tui 的处置禁用
  { id: "tool-bash", disabled: true },
  // 沙箱友好：session 根改 /tmp（headless 进程跑在 workspace-write 沙箱下，
  // ~/.dsh/sessions 不可写；冒烟不需要跨进程恢复，/tmp 足够）
  { id: "session-persistence-jsonl", config: { root: "/tmp/liangshen-plus-smoke-sessions" } },
  // 挂 agent-presets 服务（dsh-base 不提供；endless-tui 由 dsh-tui bundle 提供）
  {
    insert: [
      {
        id: "agent-presets",
        name: "@deepseek-ai/dsh-agent-presets",
        config: {
          default: process.env.SMOKE_PRESET ?? "liangshen-plus",
          roots: [],
          includeUserRoot: true,
        },
      },
      {
        id: "liangshen-plus-smoke",
        name: SMOKE_DRIVER,
      },
    ],
  },
];

const patches = [...bundlePatches, ...profile.patches, ...smokePatches];
const configPath = join(profile.dir, "cordis.yml");

const ctx = await boot("liangshen-plus-smoke", configPath, patches);
await ctx.get("loader")?.await();
