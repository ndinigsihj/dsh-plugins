/**
 * team-preset-overlay 场景的测量机械（票据 08）——与场景契约分开，让
 * `gates/stub/scenarios/team-preset-overlay.mjs` 只保留「测什么/断言什么」。
 *
 * 被测面：在 headless + Team 组合包的隔离 profile 上挂载 minimal-plus preset，读实际工具面，
 * 回答「普通委派工具是否与 Team 创建工具并存、路由发现工具是否出现、teammate 是否继承
 * Lead 的 preset、成员权限的真实形状」。
 *
 * 两条测量纪律（首轮实测踩出来的，见票 08 证据 §4）：
 *   1. 工具面必须在**稳定态**采样：Team 工具与 `subagent`/`list_subagent_models` 在
 *      `agent/created` 之后一个 microtask 才注册；只抓 created 会得到残缺面。
 *   2. teammate 的 Team 工具注册在确切 Agent 作用域，回合一结束 Agent 被处置、工具随之
 *      注销。因此工具面在 `agent/created` 监听里同步抓取（并保留最大面），并用带 delay 的
 *      初始回放让 teammate 在权限探测期间保持在线——否则会偶发测到「只有 preset、没有
 *      Team 工具」的 23 工具面。
 */
import { textTurn } from './adapter.mjs';

/** 与 T2 runner 同一 preset（隔离 profile 只装 minimal-plus）。 */
export const PRESET = 'minimal-plus';
/** host base 不带、仅 preset 注册的哨兵工具（证明 preset 真正生效）。 */
export const SENTINEL = 'ask_user_question';
/** Team 创建/协作工具里抽样的四个（覆盖创建、等待、任务板、消息）。 */
export const TEAM_SAMPLE = ['spawn_teammate', 'wait_agent', 'team_task_list', 'send_message'];
const WAIT_MS = 8000;
const POLL_MS = 100;
/** 让 teammate 的初始回合在权限探测期间保持 running（测量纪律 2）。 */
const TEAMMATE_TURN_DELAY_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const hasTool = (tools, name) => tools.includes(name);

/** teammate 的初始任务脚本：先 delay 再回复（T2 的 adapter 按全局轮次消费）。 */
export function teamOverlayTurns() {
  return [
    [{ type: 'delay', ms: TEAMMATE_TURN_DELAY_MS }, ...textTurn('teammate-ready')],
    textTurn('teammate-ready-2'),
  ];
}

/** 轮询到 predicate 返回真值；超时抛错（runner 的 withTimeout 兜底整个场景）。 */
async function until(label, predicate) {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = predicate();
    if (value !== undefined && value !== false && value !== null) return value;
    if (Date.now() >= deadline) throw new Error(`team-preset-overlay: ${label} timed out after ${String(WAIT_MS)}ms`);
    await sleep(POLL_MS);
  }
}

/** 注册面工具名（含首轮锚定未放行的行，与 02/B1 取证同一 seam）。 */
function registryTools(ctx, agent) {
  return (ctx.tools.schemas(agent) ?? []).map((tool) => tool.name).sort();
}

/** 模型可见工具名（system-prompt 装配后的目录，首轮锚定/promotion 的判定面）。 */
async function visibleTools(agent) {
  const assembled = await agent.ctx.systemPrompt.assemble({ agent, scope: agent, signal: new AbortController().signal });
  return (assembled.tools ?? []).map((tool) => tool.name).sort();
}

/**
 * 触发 promotion 与 bash 换用：事件形状逐字复制
 * `presets/minimal-plus/smoke-driver.mjs` 的 0.1.7 V4 生命周期续写。
 */
async function promote(agent) {
  agent.session.append('turn/start', { turn: 1 });
  agent.session.append('step/start', { turn: 1, step: 1 });
  agent.session.append(
    'assistant/message',
    {
      stream: [],
      message: {
        id: 'team-overlay-assistant-1',
        role: 'assistant',
        source: { kind: 'model' },
        content: [{ type: 'tool-call', id: 'team-overlay-1', name: 'bash', arguments: '{}' }],
      },
    },
    { surfaceOp: 'append' },
  );
  const callSeq = agent.session.append('tool/call', { callId: 'team-overlay-1', name: 'bash', arguments: '{}' }).seq;
  agent.session.append(
    'tool/result',
    {
      message: {
        id: 'team-overlay-result-1',
        role: 'tool',
        toolCallId: 'team-overlay-1',
        source: { kind: 'tool', callId: 'team-overlay-1' },
        content: [],
        isError: false,
      },
    },
    { surfaceOp: 'append', sourceEventSeqs: [callSeq] },
  );
  agent.session.append('step/end', { turn: 1, step: 1 });
  await sleep(300);
}

function spawnRequest(name) {
  return {
    name,
    description: '票据 08 工具面探针（不产生真实模型调用，回合由 stub 回放）',
    prompt: [{ type: 'text', text: 'Reply with exactly: teammate-ready' }],
    context: 'fresh',
    provider: 'spawn',
    signal: new AbortController().signal,
  };
}

/** Lead 资格在 `agent/created` 瞬间可能尚未就绪（03 取证：首调 TEAM_LEAD_REQUIRED，重试成功）。 */
async function spawnLeadTeammate(teams, lead, name) {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      return await teams.spawnTeammate(lead, spawnRequest(name));
    } catch (error) {
      if (error?.code !== 'TEAM_LEAD_REQUIRED' || Date.now() >= deadline) throw error;
      await sleep(POLL_MS);
    }
  }
}

/** 异步/同步调用摘录：把拒绝码与消息留成可断言的事实，而不是直接抛出。 */
async function captureAsync(fn) {
  try {
    return { ok: true, result: JSON.parse(JSON.stringify(await fn())) };
  } catch (error) {
    return { ok: false, code: error?.code, message: String(error?.message ?? error) };
  }
}

function captureSync(fn) {
  try {
    return { ok: true, result: fn() };
  } catch (error) {
    return { ok: false, code: error?.code, message: String(error?.message ?? error) };
  }
}

/** agent → 在线时抓到的最大工具面（测量纪律 1/2）。 */
function createCapture(ctx, teams, agentPresets) {
  const captures = new Map();
  const captureAgent = (agent) => {
    const tools = registryTools(ctx, agent);
    const previous = captures.get(agent);
    if (previous !== undefined && previous.tools.length >= tools.length) return;
    captures.set(agent, {
      tools,
      count: tools.length,
      role: teams.tryMembership(agent)?.role ?? null,
      preset: agentPresets.composedPreset(agent.ctx) ?? null,
      headerPreset: agent.session.header.agentPreset ?? null,
      delegationDepth: agent.session.header.delegationDepth,
      origin: agent.session.header.origin,
      sessionId: String(agent.session.id),
    });
  };
  return { captures, captureAgent };
}

async function capturedWithTeamTools(captures, agent, label) {
  return until(label, () => {
    const captured = captures.get(agent);
    return captured !== undefined && hasTool(captured.tools, 'spawn_teammate') && hasTool(captured.tools, SENTINEL)
      ? captured
      : undefined;
  });
}

/** Lead：建 agent（挂 preset）→ 抓注册面 → R1 与 promotion 后的两个模型可见目录。 */
async function measureLead(harness, ctx, captures) {
  const { agent: lead } = await harness.createAgent({ label: 'lead' });
  const capture = await capturedWithTeamTools(captures, lead, 'lead capture (team+preset tools)');
  const r1 = await visibleTools(lead);
  await promote(lead);
  return { lead, capture, r1, promoted: await visibleTools(lead) };
}

/** teammate：由 Lead 创建 → 用创建的在线瞬间抓到的面（测量纪律 2）。 */
async function measureTeammate(teams, captures, lead) {
  const spawned = await spawnLeadTeammate(teams, lead, 'overlay-probe');
  const teammate = await until('teammate agent/created', () =>
    [...captures.keys()].find((agent) => agent !== lead && agent.session.header.parentSession === lead.session.id),
  );
  const capture = await capturedWithTeamTools(captures, teammate, 'teammate capture (team+preset tools)');
  return { spawned, teammate, capture };
}

function leadFactsOf(capture, r1VisibleTools, promotedVisibleTools) {
  return {
    sessionId: capture.sessionId,
    role: capture.role,
    agentPreset: capture.preset,
    headerPreset: capture.headerPreset,
    registryTools: capture.tools,
    registryCount: capture.count,
    r1VisibleTools,
    promotedVisibleTools,
    hasDelegation: hasTool(capture.tools, 'subagent'),
    hasDelegationFork: hasTool(capture.tools, 'subagent_fork'),
    hasRouteDiscovery: hasTool(capture.tools, 'list_subagent_models'),
    hasTeamCreation: hasTool(capture.tools, 'spawn_teammate'),
  };
}

function teammateFactsOf(capture, liveRoleAtProbe) {
  return {
    sessionId: capture.sessionId,
    role: capture.role,
    liveRoleAtProbe,
    agentPreset: capture.preset,
    headerPreset: capture.headerPreset,
    delegationDepth: capture.delegationDepth,
    origin: capture.origin,
    registryTools: capture.tools,
    registryCount: capture.count,
    hasRouteDiscovery: hasTool(capture.tools, 'list_subagent_models'),
    hasTeamCreation: hasTool(capture.tools, 'spawn_teammate'),
  };
}

/**
 * 场景的测量入口：返回写入 `harness.facts.teamOverlay` 的完整事实。
 * @param harness `gates/stub/harness.mjs` 的 driver（`createAgent` 挂 preset）。
 */
export async function measureTeamOverlay(harness) {
  const { ctx } = harness;
  const agentPresets = ctx.get('agentPresets');
  const teams = ctx.get('agentTeams');
  if (teams === undefined) throw new Error('team-preset-overlay: agentTeams service missing (Team bundle not composed?)');

  const { captures, captureAgent } = createCapture(ctx, teams, agentPresets);
  ctx.on('agent/created', ({ agent }) => {
    captureAgent(agent);
    setImmediate(() => captureAgent(agent));
  });

  const lead = await measureLead(harness, ctx, captures);
  const teammate = await measureTeammate(teams, captures, lead.lead);

  // 成员权限实测：工具可见 ≠ 可用；调用面必须按角色拒绝（teammate 因 delay 仍在线）。
  const liveRoleAtProbe = teams.tryMembership(teammate.teammate)?.role ?? null;
  const memberSpawnDenial = await captureAsync(() => teams.spawnTeammate(teammate.teammate, spawnRequest('overlay-probe-2')));
  const memberInterruptDenial = captureSync(() => teams.interrupt(teammate.teammate, 'lead'));
  const leadFacts = leadFactsOf(lead.capture, lead.r1, lead.promoted);
  const teammateFacts = teammateFactsOf(teammate.capture, liveRoleAtProbe);

  return {
    presetRequested: PRESET,
    spawnedMember: teammate.spawned?.member ?? null,
    lead: leadFacts,
    teammate: teammateFacts,
    memberSpawnDenial,
    memberInterruptDenial,
    relation: {
      delegation: leadFacts.hasDelegation ? 'present' : 'absent',
      routeDiscovery: leadFacts.hasRouteDiscovery ? 'present' : 'absent',
    },
  };
}
