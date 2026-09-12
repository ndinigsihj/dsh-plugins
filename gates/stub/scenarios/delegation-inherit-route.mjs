/**
 * 场景 delegation-inherit-route —— 锁定委派策略第一条规则（票据 07 / 票据 11）：
 *
 * 不变量：`subagent` 调用省略 `provider`/`model`/`reasoning_effort` 时，子会话必须继承
 *   调用方路由——子会话首个 `request/header.config` 等于父会话发起委派那次请求的
 *   `request/header.config`（本层 = `stub/stub-model`）。省略路由不得回落到组合默认值
 *   或空路由。
 *
 * 来源：docs/regression-test-automation-plan.md §3.1 场景 5、§5.4；票据 11（省略路由继承父路由）；
 *       dsh-tool-subagent 的 `requestedAgentOptions`（`enabled` 且无模型侧字段时保留
 *       configured/空 → dsh-subagent `resolveChildAgentOptions` 从父请求头继承）。
 *
 * 命令：
 *   node gates/stub/run.mjs --scenario delegation-inherit-route \
 *     --json experiments/regression-gate/evidence/07-delegation-inherit-route-green.json
 */
import { textTurn, toolCallTurn } from '../adapter.mjs';
import {
  callsByName,
  headerConfig,
  requestHeaders,
  resultIsError,
  resultOfCall,
  routeGuard,
  routeLabel,
  safeJson,
} from '../inspect.mjs';

export const id = 'delegation-inherit-route';
export const finding = '委派省略路由时继承父路由（票据 11 / 计划 §3.1 场景 5）';
export const invariant = '省略 provider/model 的 subagent 委派，其子会话首个 request/header 路由等于父会话委托请求的路由';
export const userMessage = '委派一个子任务，由它回复 OK。';

/**
 * turn0 由父会话发出委派（省略路由）；turn1 是子会话的回复；turn2 是父会话收尾。
 * 回放按全局会话轮次编号，顺序确定性来自「父请求 → 子请求 → 父继续请求」。
 */
export const turns = [
  toolCallTurn({
    id: 'stub-subagent-1',
    name: 'subagent',
    arguments: { description: 'route probe', prompt: 'Reply with exactly: OK', run_in_background: false },
  }),
  textTurn('OK'),
  textTurn('委派完成。'),
];

/** 场景断言：委派经真实 agent loop 落成 durable tool/call 与 tool/result，子会话事件从 feed 读。 */
export function assert(events, { harness, stub } = {}) {
  const out = [];
  const push = (id, ok, evidence) => out.push({ id, ok, evidence });
  const call = callsByName(events, 'subagent')[0];
  const args = safeJson(call?.data?.arguments);
  const parentHeader = requestHeaders(events).filter((header) => header.seq < (call?.seq ?? Number.POSITIVE_INFINITY)).at(-1);
  const parentRoute = headerConfig(parentHeader);
  const childIds = harness === undefined ? [] : harness.childIds(harness.primary().id);
  const childId = childIds[0];
  const childEvents = childId === undefined ? [] : harness.events(childId);
  const childHeader = requestHeaders(childEvents)[0];
  const childRoute = headerConfig(childHeader);
  const result = call === undefined ? undefined : resultOfCall(events, call.data.callId);
  const turnEnds = events.filter((event) => event.type === 'turn/end');

  // ① 路由护栏（Q25）。
  const guard = routeGuard(events);
  push('route.first-request', guard.ok, guard.evidence);

  // ② 前提：委派调用确实省略了全部模型侧路由字段。
  push(
    'delegation.omitted-route',
    call?.data?.name === 'subagent' &&
      args !== undefined &&
      args.provider === undefined &&
      args.model === undefined &&
      args.reasoning_effort === undefined,
    `tool/call name=${String(call?.data?.name)} arguments=${String(call?.data?.arguments ?? '<none>')}`,
  );

  // ③ 子会话必须真的被创建（否则 ④ 的「继承」无从谈起）。
  push(
    'delegation.child-created',
    childId !== undefined && childEvents.length > 0 && childHeader !== undefined,
    `childIds=${JSON.stringify(childIds)} child events=${String(childEvents.length)}`,
  );

  // ④ 不变量：子会话首个请求的路由 = 父会话委托请求的路由（且都是 stub/stub-model）。
  push(
    'delegation.child-inherits-route',
    childRoute !== undefined &&
      parentRoute !== undefined &&
      childRoute.provider === parentRoute.provider &&
      childRoute.model === parentRoute.model &&
      childRoute.provider === 'stub' &&
      childRoute.model === 'stub-model',
    `parent=${routeLabel(parentRoute)} child=${routeLabel(childRoute)}`,
  );

  // ⑤ 前台委派正常收口：结果不是错误、轮次 completed。
  const lastTurnEnd = turnEnds.at(-1);
  push(
    'delegation.foreground-result',
    result !== undefined && !resultIsError(result) && lastTurnEnd?.data?.reason?.kind === 'completed',
    `tool/result=${result === undefined ? '<missing>' : `isError=${String(resultIsError(result))}`} turn/end=${JSON.stringify(lastTurnEnd?.data?.reason ?? null)}`,
  );

  // ⑥ 路由事实的适配器侧证据：子会话那次请求确实打在 stub/stub-model 上。
  const childCall = (stub?.calls ?? []).find((entry) => entry.sessionId === childId && entry.purpose === null);
  push(
    'stub.child-route-call',
    childCall !== undefined && childCall.provider === 'stub' && childCall.model === 'stub-model',
    childCall === undefined
      ? `no stub conversation call for child ${String(childId)}`
      : `stub call session=${String(childCall.sessionId)} route=${String(childCall.provider)}/${String(childCall.model)}`,
  );

  // ⑦ 回放脚本消费完整（父 2 + 子 1）。
  const conversationCalls = (stub?.calls ?? []).filter((entry) => entry.purpose === null);
  push(
    'stub.script-consumed',
    conversationCalls.length === turns.length,
    `conversation calls=${String(conversationCalls.length)}/${String(turns.length)}`,
  );

  return out;
}
