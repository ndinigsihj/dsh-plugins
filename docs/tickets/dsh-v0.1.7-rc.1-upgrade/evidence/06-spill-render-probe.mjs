/**
 * 票据 06 证据：0.1.7 超长工具结果渲染冒烟（真实 spill-policy + TUI 渲染函数，无 LLM）。
 *
 * 口径：boot 真实 headless 组合（隔离临时 home），把 spill 预算改成极小值（用
 * 0.1.7 改名后的配置键 `maxInlineTokens`），用 `ctx.waterfall("tools/post-execute", …)`
 * 走一遍真实的 spill-policy transformer，得到「超长结果 → 有定位符的通知」的
 * model-facing content；再把它交给 TUI 的 `styleSpillNotices()`，断言：
 *   - 通知原文命中 0.1.7 的拼写（`Full formatted result stored at:`）；
 *   - 渲染成 '⤓ full result <locator>' 徽标，prose 原句被替换。
 *
 * 运行：node docs/.../evidence/06-spill-render-probe.mjs
 * 只写临时 home（退出即删），不碰真实 ~/.dsh；不发起模型请求。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginPackages, boot, createRuntimeResolution, loadProfile } from "@deepseek-ai/dsh-app-boot";
import { SessionId } from "@deepseek-ai/dsh-session";
import { styleSpillNotices } from "../../../../lib/app.ts";
import { createPalette } from "../../../../lib/palette.ts";
import { hostInfo } from "../../../../gates/host-pin.mjs";

const home = mkdtempSync(join(tmpdir(), "t06-spill-probe-"));
let failed = false;
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
    "t06-spill-probe",
    join(profileDir, "cordis.yml"),
    [
      ...profile.layers.flatMap((layer) => layer.patches),
      ...profile.patches,
      { id: "headless-runner", disabled: true },
      { id: "headless-startup", disabled: true },
      { id: "session-persistence-jsonl", config: { root: join(home, "sessions") } },
      // 0.1.7 的新预算键：压到 64 tokens（小于 20k 字符的结果、大于通知本身），
      // 让结果必然走 spill 且通知不被「notice exceeds maxInlineTokens」拒绝。
      { id: "spill-policy", config: { maxInlineTokens: 64 } },
    ],
    async (hostCtx) => {
      await hostCtx.plugin(PluginPackages, { resolution });
    },
  );
  await ctx.get("loader")?.await();

  const created = await ctx.get("agents").create({
    sessionId: SessionId(`session-t06-spill-${Date.now()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: "commandcode", model: "deepseek/deepseek-v4.1-flash" },
  });
  const bigText = "t06-spill ".repeat(2000);
  const result = { isError: false, content: [{ type: "text", text: bigText }] };
  const exec = { name: "probe_tool", callId: "call-probe", agent: created.agent, parent: undefined };
  const decision = await ctx.waterfall("tools/post-execute", exec, result, async () => ({
    kind: "accept",
    content: result.content,
  }));
  const modelFacing = (decision.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("\n");
  const rendered = styleSpillNotices(modelFacing, createPalette(false));
  const facts = {
    inputChars: bigText.length,
    modelFacingChars: modelFacing.length,
    hasSpillNotice: modelFacing.includes("Full formatted result stored at:"),
    renderedBadge: rendered.includes("⤓ full result "),
    proseReplaced: !rendered.includes("Full formatted result stored at:"),
  };
  console.log(JSON.stringify(facts, null, 2));
  failed = !(facts.hasSpillNotice && facts.renderedBadge && facts.proseReplaced);
  await created.dispose?.();
  await ctx.fiber.dispose();
} finally {
  rmSync(home, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
