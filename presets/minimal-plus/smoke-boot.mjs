/**
 * minimal-plus smoke boot — 用 headless profile 的完整 bundle 组合 + patches 跑 smoke-driver。
 *
 * 运行：SMOKE_PRESET=minimal-plus node presets/minimal-plus/smoke-boot.mjs
 * 可覆盖：
 *   SMOKE_PRESET=minimal-plus      要挂载的 preset id
 *   SMOKE_PRESET_ROOT=<dir>          扫描根目录（默认 repo presets/；设成
 *                                    ~/.dsh/.agent-presets 即可冒烟部署位副本）
 *
 * 设计：
 *   1. 默认 preset 为 minimal-plus（env SMOKE_PRESET 仍可覆盖）。
 *   2. session 持久化 root 改到 /tmp：headless 进程跑在 workspace-write 文件沙箱下
 *      ~/.dsh/sessions 不可写（EPERM）；冒烟不需要跨进程恢复，/tmp 足够。
 * 其余逻辑（bundle 组合、patch 顺序、driver 挂载）与 headless 冒烟通用模式一致。
 */
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  boot,
  loadProfile,
} from "/Users/vito/.dsh/profiles/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js";

// dsh CLI 安装锚点（bundle 解析基准，同 CLI 的 INSTALL_ANCHOR）
const INSTALL_ANCHOR = "/Users/vito/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/package.json";
const SMOKE_DRIVER = "/Users/vito/data/dev/dsh-plugins/presets/minimal-plus/smoke-driver.mjs";
// 冒烟默认直挂 repo 内 preset 目录（自研文件），不依赖 ~/.dsh 部署位；
// 设 SMOKE_PRESET_ROOT 可改扫部署位副本（Phase 4 部署冒烟）。
const PRESET_ROOT = process.env.SMOKE_PRESET_ROOT ?? "/Users/vito/data/dev/dsh-plugins/presets";

const profile = loadProfile("dsh", "headless", INSTALL_ANCHOR);
const bundlePatches = profile.layers.flatMap((layer) => layer.patches);

const smokePatches = [
  // 禁用 stock headless runner（它不挂 preset，会抢跑）
  { id: "headless-runner", disabled: true },
  { id: "headless-startup", disabled: true },
  // dsh-base 的 tool-bash 会与 preset 的 bash 撞名 → 按历史 endless-tui 组合的处置禁用（该 profile 已删除）
  { id: "tool-bash", disabled: true },
  // 沙箱友好：session 根改 /tmp（见文件头注释）
  { id: "session-persistence-jsonl", config: { root: "/tmp/minimal-plus-smoke-sessions" } },
  // 挂 agent-presets 服务（dsh-base 不提供；旧 endless-tui 由第三方 dsh-tui bundle 提供，已删除）
  {
    insert: [
      {
        id: "agent-presets",
        name: "@deepseek-ai/dsh-agent-presets",
        config: {
          default: process.env.SMOKE_PRESET ?? "minimal-plus",
          roots: [{ path: PRESET_ROOT, trust: "system" }],
          includeUserRoot: true,
        },
      },
      {
        id: "minimal-plus-smoke",
        name: SMOKE_DRIVER,
      },
    ],
  },
];

const patches = [...bundlePatches, ...profile.patches, ...smokePatches];
const configPath = join(profile.dir, "cordis.yml");

const ctx = await boot("minimal-plus-smoke", configPath, patches);
await ctx.get("loader")?.await();
