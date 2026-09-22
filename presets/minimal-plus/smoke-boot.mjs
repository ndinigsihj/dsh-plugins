/**
 * minimal-plus smoke boot — 用 headless profile 的完整 bundle 组合 + patches 跑 smoke-driver。
 *
 * 运行：SMOKE_PRESET=minimal-plus node presets/minimal-plus/smoke-boot.mjs
 * 可覆盖：
 *   SMOKE_PRESET=minimal-plus  要挂载的 preset id
 *   SMOKE_PRESET_ROOT=<dir>          扫描根目录（默认 repo presets/；设成
 *                                    ~/.dsh/.agent-presets 即可冒烟部署位副本）
 *   SMOKE_SESSION_ROOT=<dir>         会话根（默认 /tmp/minimal-plus-smoke-sessions）
 *   SMOKE_EXTRA_PATCHES=<paths>      追加 overlay（逗号分隔；闸门 03 用它在 repo 原位
 *                                    加载宿主侧 subagent-model-selection-settings）
 *
 * 设计：
 *   1. 默认 preset 为 minimal-plus（env SMOKE_PRESET 仍可覆盖）。
 *   2. session 持久化 root 改到 /tmp：headless 进程跑在 workspace-write 文件沙箱下
 *      ~/.dsh/sessions 不可写（EPERM）；冒烟不需要跨进程恢复，/tmp 足够。
 * 其余逻辑（bundle 组合、patch 顺序、driver 挂载）与 headless 冒烟通用模式一致。
 */
import { fileURLToPath } from "node:url";
import { join } from "node:path";
// 用 repo 的 dev 依赖树（link-global-dsh.sh → 全局 rc.1），而不是
// ~/.dsh/profiles/node_modules 共享 farm——该 farm 由最近一次 boot 的宿主代
// 自愈（2026-09-10 实测：当时代 stable 侧启动后指回 rc.2），冒烟就会挂在
// 与构建它的宿主代不符的字段上。
import { boot, loadOverlayPatches, loadProfile } from "@deepseek-ai/dsh-app-boot";
import { installAnchor } from "../../scripts/host-runtime.mjs";

// 仓库根由本模块位置推导（presets/minimal-plus/ → repo 根），换 checkout/CI 无需改脚本。
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
// dsh CLI 安装锚点（bundle 解析基准，同 CLI 的 INSTALL_ANCHOR）
const INSTALL_ANCHOR = installAnchor();
const SMOKE_DRIVER = fileURLToPath(new URL("./smoke-driver.mjs", import.meta.url));
// 冒烟默认直挂 repo 内 preset 目录（自研文件），不依赖 ~/.dsh 部署位；
// 设 SMOKE_PRESET_ROOT 可改扫部署位副本（Phase 4 部署冒烟）。
const PRESET_ROOT = process.env.SMOKE_PRESET_ROOT ?? join(ROOT, "presets");

const profile = loadProfile("dsh", "headless", INSTALL_ANCHOR);
const bundlePatches = profile.layers.flatMap((layer) => layer.patches);

const smokePatches = [
  // 禁用 stock headless runner（它不挂 preset，会抢跑）
  { id: "headless-runner", disabled: true },
  { id: "headless-startup", disabled: true },
  // dsh-base 的 tool-bash 会与 preset 的 bash 撞名 → 按历史 endless-tui 组合的处置禁用（该 profile 已删除）
  { id: "tool-bash", disabled: true },
  // 沙箱友好：session 根改 /tmp（见文件头注释）；闸门（票据 03）用
  // SMOKE_SESSION_ROOT 落临时 home，跑完随该 home 一起删除，真实目录零写。
  {
    id: "session-persistence-jsonl",
    config: { root: process.env.SMOKE_SESSION_ROOT ?? "/tmp/minimal-plus-smoke-sessions" },
  },
  // 挂 agent-presets 服务（dsh-base 不提供；旧 endless-tui 由第三方 dsh-tui bundle 提供，已删除）
  {
    insert: [
      {
        id: "agent-presets",
        name: "@deepseek-ai/dsh-agent-presets",
        config: {
          default: process.env.SMOKE_PRESET ?? "minimal-plus",
          // 只扫显式传入的根：默认 repo presets/，部署位冒烟传 ~/.dsh/.agent-presets。
          // includeUserRoot=false 让冒烟不读用户的 ~/.dsh/.agent-presets 副本（票据 03 隔离面）。
          roots: [{ path: PRESET_ROOT, trust: "system" }],
          includeUserRoot: false,
        },
      },
      {
        id: "minimal-plus-smoke",
        name: SMOKE_DRIVER,
      },
    ],
  },
];

// 追加 overlay（闸门 03）：在 repo 原位经 loadOverlayPatches 加载，相对名字锚定正确；
// 缺文件直接抛（显式命名的东西缺失是误配，不是「没有」）。
const extraPatches = (process.env.SMOKE_EXTRA_PATCHES ?? "")
  .split(",")
  .map((file) => file.trim())
  .filter((file) => file.length > 0)
  .flatMap((file) => loadOverlayPatches("minimal-plus-smoke", file));

const patches = [...bundlePatches, ...profile.patches, ...smokePatches, ...extraPatches];
const configPath = join(profile.dir, "cordis.yml");

const ctx = await boot("minimal-plus-smoke", configPath, patches);
await ctx.get("loader")?.await();
