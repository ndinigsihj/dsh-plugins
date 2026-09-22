/**
 * 场景 bash-first-call —— 锁定 finding 12-2：promotion 在同一 step 内换 bash schema，
 * 让按 persistent schema 产出的首轮调用被沙箱 schema 拒（missing required property "description"）。
 *
 * 不变量：首轮（promotion 前）发出的 bash 调用不得因 schema/registry 不同步被参数校验拒
 * （`ToolArgsError`/`INVALID_ARGS`）——本轮请求的工具目录与 dispatch 时解析到的工具定义
 * 必须来自同一代；promotion 后的下一次请求起才使用沙箱 schema（description 必填）。
 * 执行层结果不算本场景的红线：会话沙箱禁 `posix_openpt` 时 persistent bash 会以
 * 「posix_openpt failed」失败，那是环境限制、不是 12-2（证据里原样记录 isError 与 error code）。
 * 后者「compaction 后回退 persistent」由票据 07 的场景覆盖。
 *
 * 来源：docs/dsh-v0.1.5-rc.1-upgrade-closeout.md §7.2（finding 12-2）；
 *       docs/regression-test-automation-plan.md §3.1、§5.4；实测见 docs/subagent-model-selection.md
 *       的 deepseek-official 行（首次缺 description 被参数校验拒）。
 *
 * 红绿复现（票据 06 / Q26；绿要求 presets/minimal-plus/phase-swap-bash.mjs 的 swap
 * 延后修复在位）：
 *   # 绿
 *   node gates/stub/run.mjs --scenario bash-first-call \
 *     --json experiments/regression-gate/evidence/12-2-green.json
 *   # 临时回退修复（同一份 diff 反向应用；-R 只动插件文件）
 *   git diff -- presets/minimal-plus/phase-swap-bash.mjs \
 *     > experiments/regression-gate/evidence/12-2-fix.patch
 *   git apply -R experiments/regression-gate/evidence/12-2-fix.patch
 *   node gates/stub/run.mjs --scenario bash-first-call \
 *     --json experiments/regression-gate/evidence/12-2-red.json      # 期望 exit 1
 *   # 恢复（随后用 git diff 核对与回退前逐字节一致）
 *   git apply experiments/regression-gate/evidence/12-2-fix.patch
 */
import { toolCallTurn, textTurn } from '../adapter.mjs';
import { routeGuard, turnCompleted } from '../inspect.mjs';

export const id = 'bash-first-call';
export const finding = 'finding 12-2（closeout §7.2）：promotion 时换 bash schema 拒掉首轮调用';
export const invariant = '首轮 bash 调用（无 description）按 persistent schema 校验成功；下一次请求起沙箱 schema 生效';
export const userMessage = '先确认当前目录，然后按沙箱要求再跑一次。';

/** 轮次 → 分块序列：turn1 按 persistent schema 只给 command；turn2 补 description；turn3 收尾。 */
export const turns = [
  toolCallTurn({ id: 'stub-call-1', name: 'bash', arguments: { command: 'pwd' } }),
  toolCallTurn({ id: 'stub-call-2', name: 'bash', arguments: { command: 'pwd', description: '二轮沙箱调用：确认当前目录' } }),
  textTurn('两轮调用都完成了。'),
];

// ── 事件读取助手（只读会话事件，不引用模型自述）────────────────────────────

function safeJson(text) {
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function headers(events) {
  return events.filter((event) => event.type === 'request/header');
}

function bashParamKeys(headerEvent) {
  const tools = headerEvent?.data?.header?.tools ?? [];
  const bash = tools.find((tool) => tool.name === 'bash');
  return Object.keys(bash?.parameters?.properties ?? {});
}

function toolCallIdOf(resultEvent) {
  const block = resultEvent?.data?.message?.content?.find((entry) => entry.type === 'tool-result');
  return block?.toolCallId;
}

function resultIsError(resultEvent) {
  const block = resultEvent?.data?.message?.content?.find((entry) => entry.type === 'tool-result');
  return block?.isError === true;
}

function resultError(resultEvent) {
  const block = resultEvent?.data?.message?.content?.find((entry) => entry.type === 'tool-result');
  if (block?.isError !== true) return undefined;
  return block.content
    ?.map((entry) => (typeof entry?.text === 'string' ? entry.text : undefined))
    .filter((text) => text !== undefined)
    .join(' | ');
}

/** 场景断言：返回 { id, ok, evidence, detail? } 列表；失败信息直接指向被违反的不变量。 */
export function assert(events, { stub } = {}) {
  const out = [];
  const push = (id, ok, evidence, detail) => out.push({ id, ok, evidence, ...(detail === undefined ? {} : { detail }) });

  const requestHeaders = headers(events);
  const toolCalls = events.filter((event) => event.type === 'tool/call');
  const toolResults = events.filter((event) => event.type === 'tool/result');
  const turnEnds = events.filter((event) => event.type === 'turn/end');

  // ① 路由：首个请求头必须落在假模型上（Q25：防「忘改路由 → 打真实 provider」）
  const guard = routeGuard(events);
  push('route.first-request', guard.ok, guard.evidence);

  // ② 首轮调用参数：模型看到的是 persistent schema，只产出 command
  const firstCall = toolCalls[0];
  const firstArgs = safeJson(firstCall?.data?.arguments);
  push(
    'bash.first-call-persistent-args',
    firstCall?.data?.name === 'bash' && firstArgs !== undefined && typeof firstArgs.command === 'string' && firstArgs.description === undefined,
    `tool/call#1 name=${String(firstCall?.data?.name)} arguments=${String(firstCall?.data?.arguments ?? '<none>')}`,
  );

  // ③ 12-2 红绿核心：首轮调用不得因此在 dispatch 时被参数校验拒（无 tool/result 也是拒）。
  //    判据取 ToolArgsError/INVALID_ARGS——本机沙箱禁 PTY 时执行层失败（无 error code）
  //    属环境限制，不算回归；正常环境里该断言即 tool/result.isError === false。
  const firstResult = firstCall === undefined ? undefined : toolResults.find((event) => toolCallIdOf(event) === firstCall.data.callId);
  const errorTurn = turnEnds.find((event) => event.data?.reason?.kind === 'error');
  const firstError = firstResult?.data?.error;
  const firstRejected = firstResult === undefined || firstError?.code === 'INVALID_ARGS';
  const firstOutcome = firstResult === undefined
    ? `no tool/result for ${String(firstCall?.data?.callId ?? '<no call>')}; turn/end=${JSON.stringify(errorTurn?.data?.reason?.error ?? errorTurn?.data?.reason ?? null)}`
    : firstRejected
      ? `tool/result rejected: ${String(firstError?.name ?? '')}/${String(firstError?.code ?? '')} content=${String(resultError(firstResult) ?? '')}`
      : `no argument rejection; tool/result isError=${String(resultIsError(firstResult))}`
        + `${firstError === undefined ? ` content=${String(resultError(firstResult) ?? '')}` : ` error=${String(firstError.name)}/${String(firstError.code)}`}`;
  push('bash.first-call-not-rejected', !firstRejected, firstOutcome);

  // ④ promotion 必须仍然发生，只是延后到结算之后：promotion 后的请求头里 bash 是沙箱 schema
  const afterFirstCall = firstCall?.seq ?? Number.POSITIVE_INFINITY;
  const sandboxHeader = requestHeaders.find((event) => event.seq > afterFirstCall && bashParamKeys(event).includes('sandbox_permissions'));
  push(
    'bash.promoted-sandbox-visible',
    sandboxHeader !== undefined,
    sandboxHeader === undefined
      ? `no request/header after tool/call#1 exposes sandbox_permissions (headers=${String(requestHeaders.length)})`
      : `request/header seq=${String(sandboxHeader.seq)} bash params=${bashParamKeys(sandboxHeader).join(',')}`,
  );

  // ⑤ 二轮调用按沙箱 schema（含 description）应被接受（同样只看参数校验，不看执行层环境）
  const secondCall = toolCalls[1];
  const secondArgs = safeJson(secondCall?.data?.arguments);
  const secondResult = secondCall === undefined ? undefined : toolResults.find((event) => toolCallIdOf(event) === secondCall.data.callId);
  const secondRejected = secondResult === undefined || secondResult.data?.error?.code === 'INVALID_ARGS';
  const secondAccepted = secondCall !== undefined && secondArgs?.description !== undefined && !secondRejected;
  push(
    'bash.second-call-accepted',
    secondAccepted,
    `tool/call#2 arguments=${String(secondCall?.data?.arguments ?? '<none>')} result=${secondResult === undefined ? '<missing>' : `isError=${String(resultIsError(secondResult))} error=${String(secondResult.data?.error?.code ?? '<none>')}`}`,
  );

  // ⑥ 回放按 3 个会话轮次走完，且没有辅助调用打同一路由（overlay 关掉了 session-title-llm）
  const conversationCalls = (stub?.calls ?? []).filter((call) => call.purpose === null);
  const auxCalls = (stub?.calls ?? []).filter((call) => call.purpose !== null);
  push(
    'stub.no-aux-calls',
    conversationCalls.length === turns.length && auxCalls.length === 0,
    `conversation calls=${String(conversationCalls.length)}/${String(turns.length)} aux=${JSON.stringify(auxCalls.map((call) => call.purpose))}`,
  );

  // ⑦ 轮次正常收尾（错误收尾说明 agent loop 没跑完）
  const completed = turnCompleted(events);
  push('session.turn-completed', completed.ok, completed.evidence);

  return out;
}
