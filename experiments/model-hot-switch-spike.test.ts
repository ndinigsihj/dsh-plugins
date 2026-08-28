// Spike: /model 热切换可行性 —— installModelSelection 的 provider/model 可变 seam。
//
// 设计稿：docs/model-hot-switch-design.md
// 验证点：
//   1. 改 selection.current 后，下一次 system-prompt/assemble + agent/request 使用新 route；
//   2. assemble 后、request 前改 ref，request 仍用 assemble 时快照（防并发切裂）；
//   3. reasoningEffort: undefined 时清掉继承档（恢复 provider 默认）。
//
// 运行：node --test experiments/model-hot-switch-spike.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { installModelSelection } from "@deepseek-ai/dsh-agent";

type WaterfallNext = () => Promise<unknown>;
type WaterfallListener = (...args: unknown[]) => Promise<unknown>;

interface FakeAgentCtx {
  on(event: string, listener: WaterfallListener): () => void;
  call(event: string, payload: unknown, next: (payload: unknown) => Promise<unknown>): Promise<unknown>;
}

function makeFakeCtx(): FakeAgentCtx {
  const listeners = new Map<string, WaterfallListener[]>();
  return {
    on(event: string, listener: WaterfallListener): () => void {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return () => {
        const current = listeners.get(event) ?? [];
        const index = current.indexOf(listener);
        if (index >= 0) current.splice(index, 1);
      };
    },
    async call(
      event: string,
      payload: unknown,
      next: (payload: unknown) => Promise<unknown>,
    ): Promise<unknown> {
      const chain = listeners.get(event) ?? [];
      let index = 0;
      const run = async (current: unknown): Promise<unknown> => {
        if (index >= chain.length) return next(current);
        const listener = chain[index] as WaterfallListener;
        index += 1;
        const runNext = (): Promise<unknown> => run(current);
        // dsh-agent 的 system-prompt/assemble 监听器签名是 (payload, context, next)，
        // agent/request 是 (payload, next)；多传参数对后者无害。
        return listener.length >= 3
          ? (listener(current, undefined, runNext) as Promise<unknown>)
          : (listener(current, runNext) as Promise<unknown>);
      };
      return run(payload);
    },
  };
}

type Selection = {
  provider: string;
  model: string;
  reasoningEffort?: string;
};

function makeSelection(current: Selection, assembled?: Selection): {
  current: Selection | undefined;
  assembled: Selection | undefined;
} {
  return { current, assembled };
}

test("改 selection.current 后下一次请求使用新 provider/model/effort", async () => {
  const ctx = makeFakeCtx();
  const selection = makeSelection({ provider: "a", model: "m1", reasoningEffort: "low" });
  installModelSelection(ctx as never, selection);

  // 第一轮：route A
  const assembled1 = await ctx.call(
    "system-prompt/assemble",
    { variables: { existing: "v" } },
    async () => ({ variables: { existing: "v" } }),
  );
  assert.deepEqual(
    (assembled1 as { variables: Record<string, string> }).variables,
    { existing: "v", provider: "a", model: "m1" },
  );

  const request1 = await ctx.call(
    "agent/request",
    { provider: "old", model: "old", reasoningEffort: "old" },
    async () => ({ provider: "old", model: "old", reasoningEffort: "old" }),
  );
  assert.deepEqual(request1, { provider: "a", model: "m1", reasoningEffort: "low" });

  // 热切换：下一轮 route B
  selection.current = { provider: "b", model: "m2", reasoningEffort: "high" };

  const assembled2 = await ctx.call(
    "system-prompt/assemble",
    { variables: { existing: "v" } },
    async () => ({ variables: { existing: "v" } }),
  );
  assert.deepEqual(
    (assembled2 as { variables: Record<string, string> }).variables,
    { existing: "v", provider: "b", model: "m2" },
  );
  assert.deepEqual(selection.assembled, { provider: "b", model: "m2", reasoningEffort: "high" });

  const request2 = await ctx.call(
    "agent/request",
    { provider: "old", model: "old", reasoningEffort: "old" },
    async () => ({ provider: "old", model: "old", reasoningEffort: "old" }),
  );
  assert.deepEqual(request2, { provider: "b", model: "m2", reasoningEffort: "high" });
});

test("assemble 后改 ref，request 仍用 assemble 时快照（防并发切裂）", async () => {
  const ctx = makeFakeCtx();
  const selection = makeSelection({ provider: "a", model: "m1" });
  installModelSelection(ctx as never, selection);

  await ctx.call(
    "system-prompt/assemble",
    { variables: {} },
    async () => ({ variables: {} }),
  );

  // assemble 已捕获 route A；此时改 current 不影响本轮 request
  selection.current = { provider: "b", model: "m2" };

  const request = await ctx.call(
    "agent/request",
    { provider: "x", model: "y" },
    async () => ({ provider: "x", model: "y" }),
  );
  assert.deepEqual(request, { provider: "a", model: "m1" });
  assert.deepEqual(selection.assembled, { provider: "a", model: "m1" });
});

test("reasoningEffort undefined 时清掉继承档（恢复 provider 默认）", async () => {
  const ctx = makeFakeCtx();
  const selection = makeSelection({ provider: "a", model: "m1" });
  installModelSelection(ctx as never, selection);

  await ctx.call(
    "system-prompt/assemble",
    { variables: {} },
    async () => ({ variables: {} }),
  );

  const request = await ctx.call(
    "agent/request",
    { provider: "x", model: "y", reasoningEffort: "inherited" },
    async () => ({ provider: "x", model: "y", reasoningEffort: "inherited" }),
  );
  assert.deepEqual(request, { provider: "a", model: "m1" });
  assert.equal("reasoningEffort" in (request as Record<string, unknown>), false);
});