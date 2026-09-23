/**
 * 场景 bash-first-step-batch —— 锁定 finding 12-2 的多调用残留。
 *
 * 首轮一条 assistant 消息携带两条 bash（persistent schema，均无 description）时，swap 必须
 * 等该 step 结算（`step/end`，同步注册）之后才生效，不能被第一个 tool/result 提前触发——
 * 否则同 step 尚未 dispatch 的调用会被沙箱 schema 拒（missing required property "description"）。
 *
 * 与 `bash-first-call` 的分工：后者每轮只有一条调用；本场景把触发 step 扩到一条消息 N 条
 * 调用，是 2026-09-23 TUI 实测残留（session-291c37fa：首轮两条 bash，第二条
 * ToolArgsError/INVALID_ARGS）的回归锁。执行层结果不算红线：会话沙箱禁 `posix_openpt` 时
 * persistent bash 会以「posix_openpt failed」失败，那是环境限制；证据里原样记录 isError
 * 与 error code。
 *
 * 来源：docs/dsh-v0.1.5-rc.1-upgrade-closeout.md §7.2（finding 12-2）；
 *       presets/minimal-plus/phase-swap-bash.mjs 的 assemble 触发注释；
 *       docs/regression-test-automation-plan.md §3.1（场景清单）、§5.4（断言表）。
 *
 * 红绿复现（绿要求 swap 在触发 step 结算（step/end）时同步执行）：
 *   # 绿
 *   node gates/stub/run.mjs --scenario bash-first-step-batch \
 *     --json experiments/regression-gate/evidence/12-3-green.json
 *   # 临时回退修复（同一份 diff 反向应用；-R 只动插件文件）
 *   git diff -- presets/minimal-plus/phase-swap-bash.mjs \
 *     > experiments/regression-gate/evidence/12-3-fix.patch
 *   git apply -R experiments/regression-gate/evidence/12-3-fix.patch
 *   node gates/stub/run.mjs --scenario bash-first-step-batch \
 *     --json experiments/regression-gate/evidence/12-3-red.json      # 期望 exit 1
 *   # 恢复（随后用 git apply 原 patch）
 *   git apply experiments/regression-gate/evidence/12-3-fix.patch
 */
import { textTurn, toolCallsTurn } from '../adapter.mjs';
import { bashParamKeys, requestHeaders, resultOfCall, routeGuard, turnCompleted } from '../inspect.mjs';

export const id = 'bash-first-step-batch';
export const finding = 'finding 12-2 多调用残留：批量 bash 的 step 内 swap 提前到首个 tool/result';
export const invariant = '触发 step 的两条 bash 调用全部按 persistent schema 校验通过；沙箱 schema 自该 step 之后的下一次请求才可见';
export const userMessage = '先确认当前目录，再按沙箱要求跑一次。';

/**
 * turn0：一条 assistant 消息两条 bash（persistent schema，无 description）；
 * turn1：沙箱 schema 下补 description；turn2：收尾。
 */
export const turns = [
  toolCallsTurn([
    { id: 'stub-call-1', name: 'bash', arguments: { command: 'pwd' } },
    { id: 'stub-call-2', name: 'bash', arguments: { command: 'echo batch-2' } },
  ]),
  toolCallsTurn([
    { id: 'stub-call-3', name: 'bash', arguments: { command: 'pwd', description: '二轮沙箱调用：确认当前目录' } },
  ]),
  textTurn('两轮调用都完成了。'),
];

/** `tool/call.arguments` 是原始 JSON 字符串；解析失败返回 undefined（拒绝原因可见）。 */
function safeJson(text) {
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** 场景断言：返回 { id, ok, evidence } 列表；失败信息直接指向被违反的不变量。 */
export function assert(events, { stub } = {}) {
  const out = [];
  const push = (id, ok, evidence) => out.push({ id, ok, evidence });
  const headers = requestHeaders(events);
  const firstStepEnd = events.find((event) => event.type === 'step/end');
  const bashCalls = events.filter((event) => event.type === 'tool/call' && event.data?.name === 'bash');
  const triggeringCalls = bashCalls.filter((event) => firstStepEnd === undefined || event.seq < firstStepEnd.seq);

  // ① 路由：首个请求头必须落在假模型上（Q25：防「忘改路由 → 打真实 provider」）
  const guard = routeGuard(events);
  push('route.first-request', guard.ok, guard.evidence);

  // ② 触发 step 的请求暴露 persistent schema（有 command、无 sandbox_permissions）
  const firstHeaderParams = headers[0] === undefined ? [] : bashParamKeys(headers[0]);
  push(
    'bash.step1-request-persistent',
    firstHeaderParams.includes('command') && !firstHeaderParams.includes('sandbox_permissions'),
    `request/header#1 bash params=${firstHeaderParams.join(',')}`,
  );

  // ③ 触发 step 确实携带两条调用，且都按 persistent schema 产出（无 description）
  const batchArgsOk = triggeringCalls.length === 2 && triggeringCalls.every((event) => {
    const args = safeJson(event.data?.arguments);
    return args !== undefined && typeof args.command === 'string' && args.description === undefined;
  });
  push(
    'bash.step1-batch-two-calls',
    batchArgsOk,
    `step1 bash calls=${String(triggeringCalls.length)} args=${triggeringCalls.map((event) => String(event.data?.arguments)).join(' || ') || '<none>'}`,
  );

  // ④ 12-2 多调用残留核心：触发 step 的每条调用都不得因此在 dispatch 时被参数校验拒
  //    （无 tool/result 也是拒；判据取 ToolArgsError/INVALID_ARGS，执行层失败不算回归）。
  const rejected = triggeringCalls
    .map((event) => ({ callId: event.data?.callId, result: resultOfCall(events, event.data?.callId) }))
    .filter((entry) => entry.result === undefined || entry.result.data?.error?.code === 'INVALID_ARGS');
  push(
    'bash.step1-no-arg-rejection',
    triggeringCalls.length === 2 && rejected.length === 0,
    rejected.length === 0
      ? `all ${String(triggeringCalls.length)} step1 calls dispatched without argument rejection`
      : `rejected calls=${JSON.stringify(rejected.map((entry) => ({ callId: entry.callId, error: entry.result?.data?.error?.code ?? '<no result>' })))}`,
  );

  // ⑤ swap 与请求快照同代：触发 step 结束之前不得出现沙箱 schema，之后的下一次请求必须出现
  const beforeStepEnd = headers.filter(
    (header) => firstStepEnd !== undefined && header.seq < firstStepEnd.seq && bashParamKeys(header).includes('sandbox_permissions'),
  );
  const sandboxHeader = headers.find((header) => bashParamKeys(header).includes('sandbox_permissions'));
  const swappedAfterStep = firstStepEnd !== undefined && sandboxHeader !== undefined && sandboxHeader.seq > firstStepEnd.seq;
  push(
    'bash.swap-only-after-step-end',
    swappedAfterStep && beforeStepEnd.length === 0,
    `step/end seq=${String(firstStepEnd?.seq ?? '<none>')} sandbox header seq=${String(sandboxHeader?.seq ?? '<none>')} `
      + `headers before step/end with sandbox=${String(beforeStepEnd.length)}`,
  );

  // ⑥ 该 step 之后的下一次请求按沙箱 schema（含 description）应被接受
  const secondCall = firstStepEnd === undefined ? undefined : bashCalls.find((event) => event.seq > firstStepEnd.seq);
  const secondArgs = safeJson(secondCall?.data?.arguments);
  const secondResult = secondCall === undefined ? undefined : resultOfCall(events, secondCall.data.callId);
  const secondRejected = secondResult === undefined || secondResult.data?.error?.code === 'INVALID_ARGS';
  push(
    'bash.second-call-accepted',
    secondCall !== undefined && secondArgs?.description !== undefined && !secondRejected,
    `tool/call after step/end arguments=${String(secondCall?.data?.arguments ?? '<none>')} `
      + `result=${secondResult === undefined ? '<missing>' : `isError=${String(secondResult.data?.isError)} error=${String(secondResult.data?.error?.code ?? '<none>')}`}`,
  );

  // ⑦ 回放脚本消费：3 个会话轮次 + 无辅助调用（overlay 关掉了 session-title-llm）
  const conversationCalls = (stub?.calls ?? []).filter((call) => call.purpose === null);
  const auxCalls = (stub?.calls ?? []).filter((call) => call.purpose !== null);
  push(
    'stub.no-aux-calls',
    conversationCalls.length === turns.length && auxCalls.length === 0,
    `conversation calls=${String(conversationCalls.length)}/${String(turns.length)} aux=${JSON.stringify(auxCalls.map((call) => call.purpose))}`,
  );

  // ⑧ 轮次正常收尾（错误收尾说明 agent loop 没跑完）
  const completed = turnCompleted(events);
  push('session.turn-completed', completed.ok, completed.evidence);

  return out;
}
