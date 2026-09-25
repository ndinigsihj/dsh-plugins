/**
 * spill 通知渲染契约测试（票据 06）。
 *
 * dsh 0.1.7 的 spill-policy 只改了预算配置名（maxInlineBytes → maxInlineTokens），
 * 通知拼写未变：'(Omitted N bytes. Full formatted result stored at: <locator>.
 * <hint>)'。这里用宿主 format 产出的真实拼写钉住正则匹配与徽标渲染，避免换宿主
 * 后通知静默退回 prose。
 *
 * 运行：node --test lib/spill-notice.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { styleSpillNotices } from "./app.ts";
import { createPalette } from "./palette.ts";

test("spill 通知渲染：0.1.7 真拼写仍渲染为 ⤓ 定位徽标", () => {
  const p = createPalette(false);
  const output =
    "head line\n\n(Omitted 12345 bytes. Full formatted result stored at: /tmp/dsh-spill/session-abc/result.txt. Read the full result with the read tool.)";
  const rendered = styleSpillNotices(output, p);
  assert.ok(rendered.includes("(…omitted) "), "应保留省略标记");
  assert.ok(
    rendered.includes("⤓ full result /tmp/dsh-spill/session-abc/result.txt"),
    `应把 locator 渲染成徽标，实际: ${rendered}`,
  );
  assert.ok(!rendered.includes("Full formatted result stored at:"), "prose 通知句应被替换");
  assert.ok(rendered.startsWith("head line\n\n"), "通知之前的正文不应受影响");
});

test("spill 通知渲染：含图片省略的变体同样匹配", () => {
  const p = createPalette(false);
  const output =
    "tail\n\n(Omitted 4096 bytes. Omitted 2 images. Full formatted result stored at: /tmp/dsh-spill/img.txt. Use the read tool.)";
  const rendered = styleSpillNotices(output, p);
  assert.ok(rendered.includes("⤓ full result /tmp/dsh-spill/img.txt"), rendered);
});
