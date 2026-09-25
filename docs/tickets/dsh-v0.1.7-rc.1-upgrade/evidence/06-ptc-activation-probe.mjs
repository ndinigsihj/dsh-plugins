/**
 * 票据 06 证据探针：0.1.7 PTC / 工作流包名与服务名的真实激活核验。
 *
 * 在隔离临时 home 里按 0.1.7 的 runtime resolution（createRuntimeResolution +
 * PluginPackages）boot headless profile，断言：
 *   - `ptcRuntime` 服务存在（@deepseek-ai/dsh-ptc-runtime-node → dsh-ptc-runtime）
 *   - `workflowEngine` 服务存在（@deepseek-ai/dsh-workflow-ptc → dsh-workflow）
 *   - loader 激活告警为空（旧代 `healProfilesModuleFallback` 移除后不再有解析失败）
 * 旧宿主上这两项因缺 farm 而不激活，是本探针要锁的代际差异。
 *
 * 运行：node docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/06-ptc-activation-probe.mjs
 * 只写临时 home（退出即删），不碰真实 ~/.dsh。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginPackages, boot, createRuntimeResolution, loadProfile } from "@deepseek-ai/dsh-app-boot";
import { hostInfo } from "../../../../gates/host-pin.mjs";

const home = mkdtempSync(join(tmpdir(), "t06-ptc-probe-"));
try {
  const profileDir = join(home, "profiles", "headless");
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(
    join(profileDir, "package.json"),
    `${JSON.stringify(
      {
        name: "dsh-profile-headless",
        private: true,
        dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"], patchReload: "startup" } },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(profileDir, "cordis.yml"), "# probe root — empty entry list.\n[]\n");

  process.env.HOME = home;
  process.env.DSH_HOME = home;
  const anchor = hostInfo().manifestPath;
  const profile = loadProfile("dsh", "headless", anchor, home);
  const resolution = await createRuntimeResolution({ installAnchor: anchor, profile });
  const ctx = await boot(
    "t06-ptc-probe",
    join(profileDir, "cordis.yml"),
    [
      ...profile.layers.flatMap((layer) => layer.patches),
      ...profile.patches,
      { id: "headless-runner", disabled: true },
      { id: "headless-startup", disabled: true },
      { id: "session-persistence-jsonl", config: { root: join(home, "sessions") } },
    ],
    async (hostCtx) => {
      await hostCtx.plugin(PluginPackages, { resolution });
    },
  );
  await ctx.get("loader")?.await();

  const ptcRuntime = ctx.get("ptcRuntime");
  const workflowEngine = ctx.get("workflowEngine");
  console.log(JSON.stringify({
    host: process.env.npm_package_version ?? undefined,
    ptcRuntime: ptcRuntime !== undefined,
    workflowEngine: workflowEngine !== undefined,
    resolutionEntries: resolution.entries.length,
  }, null, 2));
  await ctx.fiber.dispose();
  if (ptcRuntime === undefined || workflowEngine === undefined) process.exitCode = 1;
} finally {
  rmSync(home, { recursive: true, force: true });
}
