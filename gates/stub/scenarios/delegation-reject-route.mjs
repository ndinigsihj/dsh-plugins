/**
 * 场景 delegation-reject-route —— 锁定委派策略第二条规则（票据 07 / 票据 11）：
 *
 * 不变量：`subagent` 调用指定集合外路由（`stub/stub-model-forbidden`，不在会话已记录的
 *   `subagent/model-selection-policy` 允许集合内）时，必须在创建子会话之前被拒——
 *   父会话出现 isError 的 `tool/result`，且**不会发出该路由的请求**（任何会话的
 *   `request/header.config` 都不出现该路由，适配器也不收到该路由的调用）。
 *
 * 来源：docs/regression-test-automation-plan.md §3.1 场景 5、§5.4；票据 11（集合外路由无法选定）；
 *       dsh-tool-subagent 的 `assertAllowedModelSelection`（在任何 start/preflight 之前）。
 *
 * 命令：
 *   node gates/stub/run.mjs --scenario delegation-reject-route \
 *     --json experiments/regression-gate/evidence/07-delegation-reject-route-green.json
 */
import { textTurn, toolCallTurn } from '../adapter.mjs';
import { callsByName, headerConfig, requestHeaders, resultError, resultIsError, resultOfCall, routeGuard, routeLabel, safeJson, turnCompleted } from '../inspect.mjs';

export const id = 'delegation-reject-route';
export const finding = '委派指定集合外路由时被拒且不发出请求（票据 11 / 计划 §3.1 场景 5）';
export const invariant = '集合外 child LLM 路由在创建子会话前被拒：tool/result isError，且任何会话都不发出该路由的 request/header';
export const userMessage = '尝试一次集合外路由的委派，然后继续。';

const FORBIDDEN = { provider: 'stub', model: 'stub-model-forbidden' };

/** turn0 由父会话发出「集合外路由」委派；turn1 是父会话在拒绝后继续的收尾轮。 */
export const turns = [
  toolCallTurn({
    id: 'stub-subagent-forbidden',
    name: 'subagent',
    arguments: {
      description: 'forbidden route probe',
      prompt: 'Reply with exactly: OK',
      provider: FORBIDDEN.provider,
      model: FORBIDDEN.model,
      run_in_background: false,
    },
  }),
  textTurn('已记录拒绝结果。'),
];

/** 场景断言：拒绝只落在会话事件与适配器调用记录上（无 `subagent/catalog`、无该路由请求）。 */
export function assert(events, { harness, stub } = {}) {
  const out = [];
  const push = (id, ok, evidence) => out.push({ id, ok, evidence });
  const call = callsByName(events, 'subagent')[0];
  const args = safeJson(call?.data?.arguments);
  const result = call === undefined ? undefined : resultOfCall(events, call.data.callId);
  const errorText = resultError(result);
  const sessionIds = harness === undefined ? [] : harness.feed.ids();
  const forbiddenHeaders = sessionIds.flatMap((id) =>
    requestHeaders(harness.events(id))
      .filter((header) => headerConfig(header)?.model === FORBIDDEN.model)
      .map((header) => `${id}#${String(header.seq)} ${routeLabel(headerConfig(header))}`),
  );
  const forbiddenCalls = (stub?.calls ?? []).filter((entry) => entry.model === FORBIDDEN.model);

  // ① 路由护栏（Q25）。
  const guard = routeGuard(events);
  push('route.first-request', guard.ok, guard.evidence);

  // ② 前提：调用确实指定了集合外路由。
  push(
    'delegation.forbidden-args',
    call?.data?.name === 'subagent' && args?.provider === FORBIDDEN.provider && args?.model === FORBIDDEN.model,
    `tool/call arguments=${String(call?.data?.arguments ?? '<none>')}`,
  );

  // ③ 不变量前半：拒绝落在 durable tool/result 上，错误文本指向路由策略。
  push(
    'delegation.forbidden-rejected',
    result !== undefined && resultIsError(result) === true && typeof errorText === 'string' && errorText.includes('not allowed'),
    result === undefined
      ? `no tool/result for ${String(call?.data?.callId ?? '<no call>')}`
      : `tool/result isError=${String(resultIsError(result))} error=${String(errorText ?? '<none>').slice(0, 200)}`,
  );

  // ④ 不变量后半：拒绝发生在创建子会话之前（无 catalog 事件、无额外会话）。
  const childIds = harness === undefined ? [] : harness.childIds(harness.primary().id);
  push(
    'delegation.no-child-session',
    harness !== undefined && childIds.length === 0 && harness.feed.ids().length === 1,
    `catalog childIds=${JSON.stringify(childIds)} sessions=${JSON.stringify(sessionIds)}`,
  );

  // ⑤ 不变量后半：任何会话都没有发出该路由的请求，适配器也没有收到该路由调用。
  push(
    'delegation.no-forbidden-request',
    forbiddenHeaders.length === 0 && forbiddenCalls.length === 0,
    `forbidden request/header=[${forbiddenHeaders.join('; ')}] adapter calls=${String(forbiddenCalls.length)}`,
  );

  // ⑥ 拒绝后父会话继续正常收尾。
  const completed = turnCompleted(events);
  push('session.turn-completed', completed.ok, completed.evidence);

  return out;
}
