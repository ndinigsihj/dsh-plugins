/**
 * 场景 v3-resume-route —— 锁定「按用途选择模型」能力面的恢复路径（票据 07 / 票据 11）：
 *
 * 不变量：已 promote 的 V3 会话（含 durable `tool/call`）恢复后，恢复路径必须从会话里
 *   已记录的 `subagent/model-selection-policy` 重建该会话的工具面，因此恢复后
 *   **首个 request/header** 仍含路由发现工具 `list_subagent_models`，且路由仍是假模型。
 *   若恢复只按「新会话 + 当前设置」处理（不回读 durable 策略），发现工具会消失，
 *   子代理模型选择在 resume 后静默失效。
 *
 * 来源：docs/regression-test-automation-plan.md §3.1 场景 3、§5.4；票据 11（官方子代理模型
 *       选择落点：preset `delegation/tool-subagent` + `modelSelectionSettings: true`，
 *       发现工具由按会话捕获的策略注册）；dsh-tool-subagent/lib/index.js 的
 *       `selectForSession`（policy 投影优先，fresh session 才读设置）。
 *
 * 命令：
 *   node gates/stub/run.mjs --scenario v3-resume-route \
 *     --json experiments/regression-gate/evidence/07-v3-resume-route-green.json
 */
import { SessionId } from '@deepseek-ai/dsh-session';
import { textTurn, toolCallTurn } from '../adapter.mjs';
import { headerConfig, headerToolNames, requestHeaders, routeLabel } from '../inspect.mjs';

export const id = 'v3-resume-route';
export const finding = 'V3 会话 resume 后按已记录策略重挂路由发现工具（票据 11）';
export const invariant = '已 promote 的 V3 会话恢复后首个 request/header 含 list_subagent_models，路由仍为 stub/stub-model';

/** turn0 产生 promotion 信号；turn1 收尾第一段生命；turn2 收尾恢复后的首个请求。 */
export const turns = [
  toolCallTurn({ id: 'stub-call-1', name: 'bash', arguments: { command: 'pwd' } }),
  textTurn('第一轮完成。'),
  textTurn('恢复后继续。'),
];

/** 第一段生命：promotion + 落盘；第二段生命：dispose → resume → 首个请求。 */
export async function run(harness) {
  const main = await harness.createAgent({ label: 'main' });
  await harness.followup(main.agent, '先跑一条命令完成 promotion。');
  await harness.flush(main);
  const persistence = harness.ctx.get('sessionPersistence');
  if (persistence !== undefined) {
    const snapshot = await persistence.stat(SessionId(main.id));
    harness.facts.sessionFormatVersion = snapshot?.header?.version;
  }
  harness.facts.resumeBoundary = harness.events(main.id).length;
  await harness.dispose(main);
  const resumed = await harness.resumeAgent({ record: main });
  await harness.followup(resumed.agent, '恢复后继续，报告当前可用工具。');
}

/** 场景断言：恢复窗口 = resumeBoundary 之后的事件；其余事实取自会话事件/持久层元数据。 */
export function assert(events, { harness } = {}) {
  const out = [];
  const push = (id, ok, evidence) => out.push({ id, ok, evidence });
  const facts = harness?.facts ?? {};
  const all = harness === undefined ? events : harness.events(harness.primary().id);
  const resumed = all.slice(facts.resumeBoundary ?? 0);
  const resumedHeader = requestHeaders(resumed)[0];
  const tools = headerToolNames(resumedHeader).sort();

  // ① 路由护栏（Q25）：恢复后首个请求仍落在假模型上。
  push(
    'route.first-request',
    headerConfig(resumedHeader)?.provider === 'stub' && headerConfig(resumedHeader)?.model === 'stub-model',
    `resumed request/header#1 config=${routeLabel(headerConfig(resumedHeader))}`,
  );

  // ② 不变量：恢复后首个请求头含路由发现工具。
  push(
    'resume.discovery-tool-visible',
    tools.includes('list_subagent_models'),
    `resumed request/header tools=${tools.join(',') || '<none>'}`,
  );

  // ③ 诊断前置：恢复后目录必须已越过 bootstrap（否则 ② 的失败原因是 tool-bootstrap 裁剪，
  //    而不是「恢复没重建策略」）。
  push(
    'resume.promoted-catalog',
    tools.length > 2,
    `resumed request/header tool count=${String(tools.length)} (bootstrap=2)`,
  );

  // ④ 策略事实：会话里恰好一条 durable 策略事件，且恢复不改写它。
  const policies = all.filter((event) => event.type === 'subagent/model-selection-policy');
  const routes = (policies.at(-1)?.data?.allowedModels ?? []).map((route) => routeLabel(route));
  push(
    'resume.policy-recorded',
    policies.length === 1 && routes.join(',') === 'stub/stub-model',
    `policy events=${String(policies.length)} routes=${routes.join(',') || '<none>'}`,
  );

  // ⑤ V3 口径：被恢复的持久会话确实是会话格式 3（宿主 manifest 同钉）。
  push(
    'resume.format-v3',
    facts.sessionFormatVersion === 3,
    `persisted session format version=${String(facts.sessionFormatVersion)}`,
  );

  // ⑥ 恢复窗口正常收尾。
  const lastTurnEnd = resumed.filter((event) => event.type === 'turn/end').at(-1);
  push(
    'session.turn-completed',
    lastTurnEnd?.data?.reason?.kind === 'completed',
    `resumed window turn/end reason=${JSON.stringify(lastTurnEnd?.data?.reason ?? null)}`,
  );

  return out;
}
