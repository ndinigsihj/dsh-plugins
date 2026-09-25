/**
 * 票据 06 证据探针：0.1.7 启动等待（生命周期事件）语义。
 *
 * 核对点（升级计划 §6 P1「agent/session-start → 异步串行 agent/created」）：
 *   1. `agents.create()` resolve 时根 agent 已发布（startup 事件已走完），
 *      create 本身不发起任何模型请求；TUI 在 `create()` 之后才接管屏幕。
 *   2. 无输入时 `agent.whenIdle()` 立即 resolve（没有首个模型请求要等）。
 *   3. setup 失败（组合/预设挂载一类启动失败）会让 `create()` reject ——
 *      这就是「屏幕接管前的启动失败诊断」路径，TUI run() 的 catch 会写 stderr + appExit(1)。
 *   4. 路由不存在不在 create 时校验：首个请求才失败，属会话内错误而不是启动失败。
 *
 * 运行：node docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/06-startup-wait-probe.mjs
 * 只写临时 home（退出即删），不碰真实 ~/.dsh；不发起真实模型请求。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginPackages, boot, createRuntimeResolution, loadProfile } from "@deepseek-ai/dsh-app-boot";
import { SessionId } from "@deepseek-ai/dsh-session";
import { hostInfo } from "../../../../gates/host-pin.mjs";

const home = mkdtempSync(join(tmpdir(), "t06-startup-probe-"));
function report(fact, detail) {
  console.log(`${fact}: ${JSON.stringify(detail)}`);
}

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
    "t06-startup-probe",
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
  const agents = ctx.get("agents");
  const route = { provider: "commandcode", model: "deepseek/deepseek-v4.1-flash" };

  // 1/2. 正常创建：create resolve 即已发布；无输入时 whenIdle 立即完成。
  let created;
  try {
    const started = Date.now();
    created = await agents.create({
      sessionId: SessionId(`session-t06-startup-ok-${Date.now()}`),
      meta: { cwd: process.cwd() },
      agentOptions: route,
    });
    const createMs = Date.now() - started;
    const idleStarted = Date.now();
    await created.agent.whenIdle();
    report("create-ok", { createMs, whenIdleMs: Date.now() - idleStarted, status: created.agent.status });
  } catch (error) {
    report("create-ok", { rejected: String(error?.message ?? error) });
    process.exitCode = 1;
  }

  // 3. setup 失败：create reject（屏幕接管前的启动失败诊断路径）。
  try {
    await agents.create({
      sessionId: SessionId(`session-t06-startup-bad-setup-${Date.now()}`),
      meta: { cwd: process.cwd() },
      agentOptions: route,
      setup: () => {
        throw new Error("probe setup failure");
      },
    });
    report("setup-failure", { rejected: false });
    process.exitCode = 1;
  } catch (error) {
    report("setup-failure", { rejected: true, message: String(error?.message ?? error) });
  }

  // 4. 路由不存在：create 不校验；首个请求才会失败（不在本探针里打请求）。
  try {
    const createdBadRoute = await agents.create({
      sessionId: SessionId(`session-t06-startup-bad-route-${Date.now()}`),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: "definitely-missing-provider", model: "x" },
    });
    report("missing-route", { createResolved: true, status: createdBadRoute.agent.status });
    await createdBadRoute.dispose?.();
  } catch (error) {
    report("missing-route", { createResolved: false, message: String(error?.message ?? error) });
  }

  await created?.dispose?.();
  await ctx.fiber.dispose();
} finally {
  rmSync(home, { recursive: true, force: true });
}
