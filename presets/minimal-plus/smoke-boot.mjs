/**
 * minimal-plus smoke boot —— 在隔离 headless profile 上加载 0.1.7 bundle 产物并跑
 * smoke-driver（票据 07 载体迁移后的仓库根冒烟）。
 *
 * 运行：node presets/minimal-plus/smoke-boot.mjs
 * 可覆盖：
 *   SMOKE_PRESET=minimal-plus      要挂载的 preset id
 *   SMOKE_PRESET_ROOT=<dir>        真源扫描根：给出时从 `<dir>/<preset>/` 现场生成 bundle
 *                                  （degrade 冒烟传改坏副本的根；闸门 real 模式传真源副本根）；
 *                                  不给则直接装入库产物 `generated/minimal-plus-preset/`
 *   SMOKE_SESSION_ROOT=<dir>       会话根（默认 /tmp/minimal-plus-smoke-sessions）
 *   SMOKE_HOME=<dir>               隔离 home（默认自建临时目录、退出即删；显式给出则调用方负责清理）
 *   SMOKE_KEEP_HOME=1              保留自建临时 home 供排查
 *   SMOKE_EXTRA_PATCHES=<paths>    追加 overlay（逗号分隔；闸门 03 用它在 repo 原位
 *                                  加载宿主侧 subagent-model-selection-settings）
 *
 * 设计（0.1.7）：
 *   1. 不再挂 `@deepseek-ai/dsh-agent-presets`（0.1.7 已移除）也不再读目录形态 preset；
 *      改为把生成 bundle 接进隔离 profile（`dsh.profile.bundles` 选择 + node_modules 链接）。
 *   2. home 固定为自建临时目录（DSH_HOME/HOME 都指过去）：冒烟绝不读写真实 ~/.dsh，
 *      也不依赖真实 profile 里是否已装载体。
 *   3. session 持久化 root 改到 /tmp（冒烟不需要跨进程恢复）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PluginPackages, boot, createRuntimeResolution, loadOverlayPatches, loadProfile } from "@deepseek-ai/dsh-app-boot";
import { installAnchor } from "../../scripts/host-runtime.mjs";
import { BUNDLE_OUT_DIR, stageBundleArtifact, stagePresetBundle } from "../../scripts/agent-preset-bundle.mjs";
import { seedHeadlessProfile, seedHomeFixtures } from "../../scripts/profile-home.mjs";

// 仓库根由本模块位置推导（presets/minimal-plus/ → repo 根），换 checkout/CI 无需改脚本。
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const INSTALL_ANCHOR = installAnchor();
const SMOKE_DRIVER = fileURLToPath(new URL("./smoke-driver.mjs", import.meta.url));
const PRESET = process.env.SMOKE_PRESET ?? "minimal-plus";
const PRESET_ROOT = process.env.SMOKE_PRESET_ROOT;
const KEEP_HOME = process.env.SMOKE_KEEP_HOME === "1";

/** 自建隔离 home；SMOKE_HOME 显式给出时沿用且由调用方负责清理，不自动删除。 */
const ownedHome = process.env.SMOKE_HOME === undefined;
const home = ownedHome ? mkdtempSync(join(tmpdir(), "minimal-plus-smoke-")) : resolve(process.env.SMOKE_HOME);
process.env.HOME = home;
process.env.DSH_HOME = home;
if (ownedHome && !KEEP_HOME) process.on("exit", () => rmSync(home, { recursive: true, force: true }));

// 隔离 home 预置：headless 骨架 + 二轮注入 fixture + 0.1.7 载体。
const profileDir = seedHeadlessProfile(home);
seedHomeFixtures(home);
const staged = PRESET_ROOT === undefined
  ? stageBundleArtifact({ artifactDir: join(ROOT, BUNDLE_OUT_DIR), profileDir })
  : stagePresetBundle({ sourceDir: join(PRESET_ROOT, PRESET), profileDir });
console.log(`SMOKE bundle: ${staged.bundleDir}${PRESET_ROOT === undefined ? " (committed artifact)" : ` (generated from ${PRESET_ROOT})`}`);

const profile = loadProfile("dsh", "headless", INSTALL_ANCHOR, home);
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
  {
    insert: [
      {
        id: "minimal-plus-smoke",
        name: SMOKE_DRIVER,
      },
    ],
  },
];

// 追加 overlay（闸门 03）：在 repo 原位经 loadOverlayPatches 加载，相对名字锚定正确；
// 缺文件直接抛（显式命名的东西缺失是误配，不是「没有」）。
const extraPatchFiles = (process.env.SMOKE_EXTRA_PATCHES ?? "")
  .split(",")
  .map((file) => file.trim())
  .filter((file) => file.length > 0);

// 独立运行时补宿主侧子代理模型选择单例（minimal-plus 的 delegation 开了
// `modelSelectionSettings: true`，缺这行 preset 挂不起来）；闸门经 SMOKE_EXTRA_PATCHES
// 传同一行时不再重复（重复 loader id 会破坏隔离 home 的组合）。
if (extraPatchFiles.length === 0) {
  smokePatches.push({
    insert: [{ id: "subagent-model-selection-settings", name: "@deepseek-ai/dsh-tool-subagent/model-selection-settings" }],
  });
}

const extraPatches = extraPatchFiles.flatMap((file) => loadOverlayPatches("minimal-plus-smoke", file));

const patches = [...bundlePatches, ...profile.patches, ...smokePatches, ...extraPatches];
const configPath = join(profile.dir, "cordis.yml");
const resolution = await createRuntimeResolution({ installAnchor: INSTALL_ANCHOR, profile });

const ctx = await boot("minimal-plus-smoke", configPath, patches, async (hostCtx) => {
  await hostCtx.plugin(PluginPackages, { resolution });
});
await ctx.get("loader")?.await();
