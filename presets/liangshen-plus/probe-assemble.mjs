/**
 * probe-assemble — 临时诊断插件：记录每次 system-prompt/assemble 的
 * promotion status + 目录快照，排查 TUI 里 promotion 后目录未放行的问题。
 *
 * 挂载：~/.dsh/.agent-presets/liangshen-plus/agent.cordis.yml 的 tool-bootstrap 之后
 *   - id: probe-assemble
 *     name: '/Users/vito/data/dev/dsh-tui/presets/liangshen-plus/probe-assemble.mjs'
 * 日志：/tmp/liangshen-plus-probe.log（每行一个 JSON）
 */
import { appendFileSync } from "node:fs";
import { createEpochPromotion } from '/Users/vito/.dsh/profiles/endless-tui/node_modules/@deepseek-harness-tui/dsh-tui/presets/liangshen/compaction-epoch.mjs'

export const name = 'probe-assemble'
export const inject = []

export function apply(ctx) {
  const promotion = createEpochPromotion(['tool/call'], { includeSubagents: true })
  ctx.on('session/event', (session, event) => promotion.observe(session, event))

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    try {
      const agent = context.agent
      const status = promotion.status(agent)
      const events = agent?.session?.events ?? []
      appendFileSync(
        '/tmp/liangshen-plus-probe.log',
        JSON.stringify({
          t: new Date().toISOString(),
          agentId: agent?.id,
          sessionId: agent?.session?.id,
          status,
          nTools: assembled.tools.length,
          toolNames: assembled.tools.map((t) => t.name).slice(0, 12),
          nEvents: events.length,
          eventTail: events.slice(-6).map((e) => `${e.seq}:${e.type}`),
          stack: new Error().stack.split('\n').slice(2, 8).map((l) => l.trim().slice(0, 110)),
        }) + '\n',
      )
    } catch (error) {
      appendFileSync('/tmp/liangshen-plus-probe.log', `ERR ${String((error && error.message) || error)}\n`)
    }
    return assembled
  })
}
