/**
 * 场景 bash-promotion-visible —— 锁定 phase-swap-bash 的两个相位边界：
 *
 * 不变量 A（promotion 可见）：首个 durable tool/call 触发 promotion 后，下一次请求头里
 *   bash 必须是沙箱 schema（parameters 含 `sandbox_permissions`）——swap 不能只记账不生效。
 * 不变量 B（compaction 回退）：`compaction/end` 之后的下一次请求头里 bash 必须回到
 *   persistent schema（有 `command`、无 `sandbox_permissions`）——压缩回到 controlled phase
 *   的承诺只有在沙箱注册真的被注销时才成立，否则会话压缩后永久停在沙箱相位。
 * 两条断言互相独立：swap 从未发生 → A 红 B 绿（没有沙箱可回退）；swap 未随 compaction
 *   注销 → A 绿 B 红。
 *
 * 来源：presets/minimal-plus/phase-swap-bash.mjs 头注释（compaction 回 controlled phase）
 *       与其 `compaction/end` 处理；docs/regression-test-automation-plan.md §3.1 场景 2、§5.4；
 *       finding 12-2 同源（promotion 语义，swap 延后修复见票据 06）。
 *
 * 命令（绿）：
 *   node gates/stub/run.mjs --scenario bash-promotion-visible \
 *     --json experiments/regression-gate/evidence/07-bash-promotion-visible-green.json
 * 注入反向断言（把 phase-swap 的 `compaction/end` 注销分支短路）见
 *   docs/tickets/regression-test-automation/evidence/07-stub-model-remaining-scenarios.md
 */
import { textTurn, toolCallTurn } from '../adapter.mjs';
import { bashParamKeys, requestHeaders, routeGuard, turnCompleted } from '../inspect.mjs';

export const id = 'bash-promotion-visible';
export const finding = 'phase-swap-bash 的 promotion 可见性与 compaction 回退（票据 07 / 12-2 同源）';
export const invariant = 'promotion 后下一次请求暴露沙箱 bash schema；compaction/end 后下一次请求回到 persistent schema';

/** turn0 按 persistent schema 产出；turn1/2 为两次 followup 的收尾轮。 */
export const turns = [
  toolCallTurn({ id: 'stub-call-1', name: 'bash', arguments: { command: 'pwd' } }),
  textTurn('沙箱已就位。'),
  textTurn('压缩后继续。'),
];

/**
 * 首条用户消息刻意携带长相位说明：compaction 的收缩判据要求被 shadow 的范围大于
 * framed summary（checkpoint preamble + tags），否则 `compactNow` 以 summary 错误中止。
 * 长首轮节点确定性满足该判据，且不参与任何相位断言。
 */
const PHASE_NOTE = `相位说明：${'bash 的 persistent/sandbox 相位由首个 durable tool/call 触发切换，compaction 回到 controlled phase。'.repeat(80)}`;

/** 一条真实时序：promotion → 观察沙箱 → 显式压缩 → 观察回退。 */
export async function run(harness) {
  const main = await harness.createAgent({ label: 'main' });
  await harness.followup(main.agent, `先跑一条命令，然后确认沙箱相位。${PHASE_NOTE}`);
  const compaction = await harness.compact(main.agent);
  harness.facts.compaction = compaction === null
    ? { result: 'null (no compactable range)' }
    : { summarySeq: compaction.summarySeq, shadowedSeqs: compaction.shadowedSeqs, shadowedTokenCount: compaction.shadowedTokenCount };
  await harness.followup(main.agent, '压缩完成，再走一轮请求。');
}

/** 场景断言：返回 { id, ok, evidence } 列表；失败信息直接指向被违反的不变量。 */
export function assert(events, { stub } = {}) {
  const out = [];
  const push = (id, ok, evidence) => out.push({ id, ok, evidence });
  const headers = requestHeaders(events);
  const toolCalls = events.filter((event) => event.type === 'tool/call');
  const compactionEnds = events.filter((event) => event.type === 'compaction/end');
  const compactionEnd = compactionEnds.at(-1);

  // ① 路由护栏（Q25）：首个请求必须落在假模型上，防止场景误打真实 provider。
  const guard = routeGuard(events);
  push('route.first-request', guard.ok, guard.evidence);

  // ② 不变量 A：promotion（tool/call#1）之后的下一次请求必须暴露沙箱 bash schema。
  const firstCallSeq = toolCalls[0]?.seq ?? Number.POSITIVE_INFINITY;
  const sandboxHeader = headers.find((header) => header.seq > firstCallSeq && bashParamKeys(header).includes('sandbox_permissions'));
  push(
    'bash.promoted-sandbox-visible',
    sandboxHeader !== undefined,
    sandboxHeader === undefined
      ? `no request/header after tool/call#1 exposes sandbox_permissions (headers=${String(headers.length)}) — swap 未生效`
      : `request/header seq=${String(sandboxHeader.seq)} bash params=${bashParamKeys(sandboxHeader).join(',')}`,
  );

  // ③ 隔离 B 的前置：压缩本身必须成功收口（否则 B 的失败原因不明）。
  push(
    'compaction.completed',
    compactionEnd !== undefined && compactionEnd.data?.error === undefined,
    compactionEnd === undefined
      ? 'no compaction/end event — manual compaction aborted before its end marker'
      : `compaction/end seq=${String(compactionEnd.seq)} error=${String(compactionEnd.data?.error ?? '<none>')}`,
  );

  // ④ 不变量 B：compaction 之后的下一次请求必须回到 persistent bash（swap 的注册被注销）。
  const afterCompaction = headers.find((header) => header.seq > (compactionEnd?.seq ?? Number.POSITIVE_INFINITY));
  const afterParams = afterCompaction === undefined ? [] : bashParamKeys(afterCompaction);
  push(
    'bash.compaction-fallback-persistent',
    afterCompaction !== undefined && afterParams.includes('command') && !afterParams.includes('sandbox_permissions'),
    afterCompaction === undefined
      ? `no request/header after compaction/end (headers=${String(headers.length)}) — 压缩后没有新请求`
      : `request/header seq=${String(afterCompaction.seq)} bash params=${afterParams.join(',')}`,
  );

  // ⑤ 回放脚本消费：3 个会话轮次 + 恰好一次 compaction 辅助调用（防序列错位/辅助调用泄漏）。
  const conversationCalls = (stub?.calls ?? []).filter((call) => call.purpose === null);
  const compactionCalls = (stub?.calls ?? []).filter((call) => call.purpose === 'compaction');
  push(
    'stub.script-consumed',
    conversationCalls.length === turns.length && compactionCalls.length >= 1,
    `conversation calls=${String(conversationCalls.length)}/${String(turns.length)} compaction calls=${String(compactionCalls.length)}`,
  );

  // ⑥ 轮次正常收尾。
  const completed = turnCompleted(events);
  push('session.turn-completed', completed.ok, completed.evidence);

  return out;
}
