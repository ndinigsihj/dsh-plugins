/**
 * T2 假模型行为层 driver harness（票据 07）。
 *
 * 把「建/恢复 agent、发消息并等空闲、触发 compaction、读某会话事件」收成一组显式原语：
 * 默认流程（`turns` + `userMessage`）与需要多 agent 的场景（compaction 回退、V3 resume、
 * 委派）共用同一套真实 agent loop，断言仍只读会话事件。
 *
 * 路由一律由 driver 显式传入（per-agent `agentOptions` + `installModelSelection`），
 * 不依赖组合行默认值（settings 用户层会覆盖它）。
 */
import { randomUUID } from 'node:crypto';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { STUB_MODEL, STUB_PROVIDER } from './adapter.mjs';

/**
 * `session/event` 订阅台账：父子会话事件都从根 ctx 流出（票据 11 探针同款 seam），
 * 场景据此读取子会话（委派）事件。
 */
export function createSessionFeed(ctx) {
  const logs = new Map();
  ctx.on('session/event', (session, event) => {
    const id = String(session.id);
    const list = logs.get(id) ?? [];
    list.push(event);
    logs.set(id, list);
  });
  return {
    eventsOf: (id) => logs.get(String(id)) ?? [],
    ids: () => [...logs.keys()],
  };
}

/**
 * @param options.ctx 已 boot 的根 ctx
 * @param options.agents / options.agentPresets 组合里的宿主服务
 * @param options.preset 挂载的 preset id（minimal-plus-next）
 * @param options.wait (promise, label) => promise 的超时包装（runner 的 withTimeout）
 * @param options.scenarioId 用于生成可辨认的 session id
 */
export function createHarness({ ctx, agents, agentPresets, preset, wait, scenarioId }) {
  const feed = createSessionFeed(ctx);
  const selection = { provider: STUB_PROVIDER, model: STUB_MODEL };
  const records = [];
  const facts = {};
  let primary;

  const adopt = (handle, label, role) => {
    const record = { id: String(handle.agent.session.id), label, role, handle, agent: handle.agent };
    records.push(record);
    if (primary === undefined) primary = record;
    return record;
  };

  const setup = async (agentCtx) => {
    installModelSelection(agentCtx, { current: selection, assembled: undefined });
    await agentPresets.mount(agentCtx, preset);
  };

  return {
    ctx,
    feed,
    facts,
    events: (id) => feed.eventsOf(id),
    records: () => records.map((record) => ({ id: record.id, label: record.label, role: record.role })),
    primary: () => primary,

    /** 新建一个挂在 preset 上的顶层 agent（票 07 的 driver 侧入口之一）。 */
    async createAgent({ label = 'main', sessionId } = {}) {
      const id = sessionId ?? SessionId(`session-stub-${scenarioId}-${randomUUID()}`);
      const handle = await agents.create({
        sessionId: id,
        meta: { cwd: process.cwd() },
        agentOptions: { ...selection },
        setup,
      });
      return adopt(handle, label, 'created');
    },

    /** 在已持久化的会话上恢复 agent（V3 恢复路径）；恢复后的记录成为 primary。 */
    async resumeAgent({ record, label = 'resumed' }) {
      const handle = await agents.resume({
        resumeSessionId: SessionId(record.id),
        agentOptions: { ...selection },
        setup,
      });
      const resumed = adopt(handle, label, 'resumed');
      primary = resumed;
      return resumed;
    },

    /** 发一条用户消息并等到该 agent 空闲（一轮会消费若干回放轮次）。 */
    async followup(agent, text) {
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
      await wait(agent.whenIdle(), `agent ${String(agent.session.id)} idle`);
    },

    /** 显式空闲压缩（宿主 `ctx.compaction.compactNow`，即 `/compact` 的同一 seam）。 */
    async compact(agent) {
      const compaction = ctx.get('compaction');
      if (compaction === undefined) throw new Error('gate-stub: ctx.compaction missing (host compaction-basic not composed)');
      return wait(compaction.compactNow(agent, new AbortController().signal), 'manual compaction');
    },

    /** 把会话日志刷进持久层（resume 前调用，保证恢复读得到完整历史）。 */
    async flush(record) {
      const sessions = ctx.get('sessions');
      if (typeof sessions?.flush === 'function') await sessions.flush(record.agent.session);
    },

    async dispose(record) {
      await wait(record.handle.dispose(), `dispose ${record.id}`);
    },

    /** 父会话 `subagent/catalog` 事件登记的 childId 列表（创建顺序）。 */
    childIds(parentSessionId) {
      return feed
        .eventsOf(parentSessionId)
        .filter((event) => event.type === 'subagent/catalog')
        .map((event) => event.data?.childId)
        .filter((id) => typeof id === 'string');
    },
  };
}
