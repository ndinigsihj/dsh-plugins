/**
 * T2 假模型行为层：脚本化回放适配器（票据 06；计划 §3.1）。
 *
 * 只在补丁覆盖层 `gates/stub/stub.patch.yml` 里注册 provider `stub`：
 *   - 实现 `LlmAdapter` 唯一抽象方法 `stream()`，其余方法走基类默认实现；
 *   - 场景由同进程 runner（gates/stub/run.mjs）写入 `stubState.scenario`，适配器只读；
 *   - 分块顺序照生产适配器的收尾形状：每块 `block-end` → `usage` → `finish`
 *     （`dsh-llm-deepseek/lib/index.js` 的 `translate()` 收尾）。
 *
 * 遏制规则（Q13）：provider 名固定 `stub`，不占用任何真实名；模块路径只允许出现在
 * `gates/stub/*.patch.yml`。组合行 / profile / 部署位出现它 = 回归。
 */
import { readFileSync } from 'node:fs';
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';

export const name = 'gate-stub-adapter';
/** `ctx.llm` 是注册面；声明 inject 才能在该插件的 ctx 上访问服务。 */
export const inject = ['llm'];

/** 假模型路由：首个 `request/header.config` 必须等于它（Q25 防误打真实 provider）。 */
export const STUB_PROVIDER = 'stub';
export const STUB_MODEL = 'stub-model';

/** 同进程共享状态：runner 写场景，适配器写调用记录。 */
export const stubState = { scenario: undefined, calls: [] };

/** 文件化场景的缓存（同一进程只读一次）。 */
let fileScenario;

/**
 * 独立进程（T4b PTY 冒烟）拿不到同进程 `stubState`，改用 `STUB_SCENARIO_FILE`
 * 指向 JSON 场景文件；T2 runner 仍走 `stubState.scenario`，行为不变。
 * @returns 文件场景，或未配置/已由 runner 注入时的 `undefined`。
 */
export function scenarioFromFile() {
  if (fileScenario !== undefined) return fileScenario;
  const path = process.env.STUB_SCENARIO_FILE;
  if (path === undefined || path === '') return undefined;
  fileScenario = JSON.parse(readFileSync(path, 'utf8'));
  return fileScenario;
}

/** 固定 usage，避免每次回放都带随机量。 */
const USAGE = { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };

/** 一个文本轮次：模型只说话，不再调用工具。 */
export function textTurn(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    USAGE,
    { type: 'finish', reason: { kind: 'stop' } },
  ];
}

/**
 * 一个工具调用轮次。`arguments` 以对象传入，按原始 JSON 字符串发出
 * （生产适配器里工具参数就是字符串，装配器不再二次序列化）。
 */
export function toolCallTurn({ id, name, arguments: args }) {
  const argumentsJson = JSON.stringify(args);
  const callId = ToolCallId(id);
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } },
    USAGE,
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ];
}

class ScriptedAdapter extends LlmAdapter {
  /**
   * T4b 的 `/model` 断言需要两条可切换的假路由。T2 不设 `STUB_MODELS`
   * （默认返回空目录，与基线一致），避免影响既有场景的目录形状。
   * 目录元数据必须带 `provider`/`name`：llm runtime 会逐条校验
   * （dsh-llm lib/index.js:2018-2036，缺字段整条目录抛 INVALID_CATALOG）。
   */
  listModels(provider) {
    const ids = (process.env.STUB_MODELS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '');
    return Promise.resolve(ids.map((id) => ({ provider, id, name: id })));
  }

  async *stream(options) {
    const scenario = stubState.scenario ?? scenarioFromFile();
    if (scenario === undefined) {
      throw new Error('gate-stub: scenario not loaded (runner must set stubState.scenario before the agent runs)');
    }
    const isConversation = options.purpose === undefined;
    const call = {
      provider: options.provider,
      model: options.model,
      purpose: options.purpose ?? null,
      sessionId: options.sessionId === undefined ? null : String(options.sessionId),
      toolNames: (options.tools ?? []).map((tool) => tool.name),
      turnIndex: isConversation ? stubState.calls.filter((entry) => entry.purpose === null).length : null,
    };
    stubState.calls.push(call);
    const turn = isConversation ? scenario.turns[call.turnIndex] : undefined;
    if (isConversation && turn === undefined) {
      throw new Error(
        `gate-stub: scenario ${scenario.id} has no script for conversation turn ${String(call.turnIndex + 1)}`,
      );
    }
    // 辅助调用（session-title / compaction）应在覆盖层里关掉；若仍到达，回一个最小
    // 文本收尾，由场景断言把「辅助调用发生了」判红（Q25），而不是让回放序列错位。
    const chunks = turn ?? textTurn('gate-stub auxiliary call');
    for (const chunk of chunks) {
      // T4b 流式量化：`{type:'delay', ms}` 只等待、不产出块，让 TUI 按脚本节奏
      // 逐步渲染，PTY 分块时间戳才有可测的间隔。T2 场景不使用该类型。
      if (chunk.type === 'delay') {
        await new Promise((resolve) => setTimeout(resolve, Number(chunk.ms) || 0));
        continue;
      }
      yield chunk;
    }
  }
}

/** 由补丁覆盖层插入：把脚本化适配器注册成 provider `stub`。 */
export function apply(ctx) {
  ctx.llm.registerAdapter([STUB_PROVIDER], new ScriptedAdapter());
}
