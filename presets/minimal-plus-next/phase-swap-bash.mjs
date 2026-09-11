/**
 * phase-swap-bash — swap the persistent bash for the sandboxed bash on promotion.
 *
 * liangshen+ 组合 preset 的第三个机制：首轮用 persistent bash（Minimal 锚定对），
 * 首个 durable tool/call 后（promotion），把该 agent 的 bash 换成
 * `dsh-tool-bash`（沙箱 + sandbox_permissions 提权），二轮起生效。
 *
 * 为什么是 per-agent shadow 而不是 dispose+register：
 *  - `dsh-tool-bash-persistent.apply()` 与 `dsh-tool-bash.apply()` 都只调
 *    `ctx.tools.register(...)` 而不返回 disposer，无法从 preset 行拿到注销句柄。
 *  - `ctx.tools.register()` 在 rc.8 里用服务实例自己的 `this.ctx`（root）解析层，
 *    preset 行的 persistent bash 注册在全局层；对全局层 dispose 会波及其他 session。
 *  - 实证（rc.8）：`agent.ctx.tools.register()` 会注册进该 agent 自己的 scope layer，
 *    `view(scopeOf(agent.ctx))` 对该 agent 显示 shadow 后的工具，其他 agent 仍看到
 *    全局 persistent bash。所以 swap 只需对该 agent 的 ctx 调 `dsh-tool-bash.apply()`，
 *    无需 dispose 任何共享实例，天然 per-session 隔离。
 *  - compaction 回 controlled phase 时，用 spy ctx 捕获 `dsh-tool-bash.apply()`
 *    的工具定义后注册进真实 agent scope，从而拿到 disposer，注销该 agent scope
 *    里的沙箱 bash 露出全局 persistent——同一 scope 内不能直接重注册同名工具
 *    （"already registered"）。
 *
 * 失败降级：swap 抛错 → warn once + 保持 persistent bash（目录全开但无提权），
 * 绝不 brick 会话。
 */

import { createEpochPromotion } from './compaction-epoch.mjs'
import * as sandboxBash from '@deepseek-ai/dsh-tool-bash'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'phase-swap-bash'

/**
 * Deliberately NO inject list: the listeners only touch services at event time.
 * Same discipline as tool-bootstrap — an inject would hold `ctx.tools` hostage
 * to every tool plugin behind it.
 */
export const inject = []

/** Config keys this plugin accepts. */
const ALLOWED_KEYS = new Set(['enableRunInBackground', 'timeoutMs', 'backendType', 'maxOutputChars'])

function optionalBoolean(value, field) {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new TypeError(`${name}: ${field} must be a boolean`)
  return value
}

/** Register the per-session swap. */
export function apply(ctx, config) {
  const source = config === undefined ? {} : config
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw new TypeError(`${name}: config must be an object`)
  }
  const unknown = Object.keys(source).filter((key) => !ALLOWED_KEYS.has(key))
  if (unknown.length > 0) {
    throw new TypeError(
      `${name}: unknown config key(s) ${unknown.join(', ')} — allowed keys: ${[...ALLOWED_KEYS].sort().join(', ')}`,
    )
  }
  const enableRunInBackground = optionalBoolean(source.enableRunInBackground, 'enableRunInBackground')
  const swapConfig = {
    ...(enableRunInBackground !== undefined ? { enableRunInBackground } : {}),
    ...(source.timeoutMs !== undefined ? { timeoutMs: source.timeoutMs } : {}),
    ...(source.backendType !== undefined ? { backendType: source.backendType } : {}),
    ...(source.maxOutputChars !== undefined ? { maxOutputChars: source.maxOutputChars } : {}),
  }

  // Same epoch-aware promotion tracker as tool-bootstrap, so compaction falls
  // back to the controlled phase and only a NEW durable tool/call re-promotes.
  const promotion = createEpochPromotion(['tool/call'], { includeSubagents: true })
  ctx.on('session/event', (session, event) => promotion.observe(session, event))

  // 首轮净化：tool-bootstrap 只裁剪 assembled.tools（函数清单），但各工具插件注册的
  // `tool:*` 指引 sections（"Use the read tool..."等）仍渲染进 system 文本，模型会据此
  // 误以为拥有全部工具（TUI 手工会话实证：首轮问"有哪些工具"时模型列出 7-8 个，而
  // request/header 铁证 tools 数组只有 2 个）。与 tool-bootstrap 同源 promotion 状态：
  // 未 promote 时过滤 tool:* sections，promote 后放行。
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    if (promotion.status(context.agent).promoted) return assembled
    const sections = assembled.sections ?? []
    // dsh-tools 的指引 sections 同时存在 `tool:*` 与 `tools:*`（如 tools:sdk、
    // tools:code-only）两种前缀，全部在未 promote 时滤掉。
    const kept = sections.filter((section) => {
      const name = section.name ?? ''
      return !name.startsWith('tool:') && !name.startsWith('tools:')
    })
    return kept.length === sections.length ? assembled : { ...assembled, sections: kept }
  })

  /** Per-session swap memo: sessionId → sandbox-registration disposer. The
   * disposer comes from registering the spy-captured tool definition into the
   * real agent scope, so compaction can actually UNREGISTER the sandbox and
   * return to the controlled (persistent bash) phase — re-registering the
   * same name in the same agent scope would throw ("already registered"). */
  const swapDisposers = new Map()
  let warned = false
  const warnOnce = (message) => {
    if (warned) return
    warned = true
    try {
      ctx.logger.warn(message)
    } catch {
      // Logger unavailable — the guard exists only to avoid spamming.
    }
  }

  ctx.on('session/event', async (session, event) => {
    try {
      const agent = ctx.get('agents')?.get(session.id)
      if (agent === undefined) return

      if (event.type === 'compaction/end') {
        // compaction 后回到 controlled phase：注销该 agent scope 里的沙箱
        // bash，露出全局 persistent bash；下次 promotion 再重新 swap。
        const disposer = swapDisposers.get(session.id)
        if (disposer !== undefined) {
          disposer()
          swapDisposers.delete(session.id)
        }
        return
      }

      if (swapDisposers.has(session.id)) return
      // 不只响应新 tool/call：promotion.status() 会冷扫描 session 日志，
      // 所以 resume 一个已经 promoted 的会话时，任意首个事件都能触发 swap，
      // 不会一直保持 persistent bash 直到再次出现 tool/call（H5 冷启动回归）。
      if (!promotion.status(agent).promoted) return
      // Register sandbox bash into THIS agent's scope layer, shadowing the
      // shared persistent bash for this session only. `dsh-tool-bash.apply`
      // resolves ctx.shell / ctx.sandboxPolicy / ctx.approval / ctx.systemPrompt
      // / ctx.tools up the chain from the agent ctx, exactly like standard.
      // 注意：直接 apply(agent.ctx) 会因 cordis 的 "without inject" 检查失败
      // （属性访问需要 inject 声明）——用 ctx.inject 建立注入子 ctx 再调。
      let sandboxDisposer
      // dsh-tool-bash 的 apply 需要 tools/shell/systemPrompt/shellEnv（另用
      // ctx.get 取 sandboxPolicy/approval，不走 inject）；真实 harness 的 agent
      // ctx 是 fiber 上下文，未注入的属性访问会抛 "without inject"。注入列表必须
      // 与其 `inject` 声明一致，spy ctx 也要基于 injectedCtx 派生以保留声明。
      await agent.ctx.inject(['tools', 'shell', 'systemPrompt', 'shellEnv'], (injectedCtx) => {
        // apply() 本身不返回 disposer；先用一个只捕获 definition 的 spy ctx
        // 跑一遍 apply 拿到工具定义，再注册进真实 agent scope 以捕获注销句柄。
        let definition
        const spyCtx = injectedCtx.extend({
          tools: { register: (d) => { definition = d; return () => {} } },
          // rc.1 dsh-tool-bash registers its guidance section through
          // getSectionOrder; the spy must answer it like the real service.
          systemPrompt: { section() {}, tools() {}, getSectionOrder: () => 0 },
        })
        sandboxBash.apply(spyCtx, swapConfig)
        if (definition?.description !== undefined) {
          definition = {
            ...definition,
            description: definition.description
              + '\n* Network access is not blocked by the sandbox; do not pass sandbox_permissions just for curl/wget.',
          }
        }
        sandboxDisposer = injectedCtx.tools.register(definition)
      })
      // Mark swapped only after the swap actually succeeded: a transient
      // failure must leave the session eligible for a future retry.
      if (sandboxDisposer !== undefined) swapDisposers.set(session.id, sandboxDisposer)
    } catch (error) {
      // Degrade: keep persistent bash (full directory but no escalation).
      warnOnce(
        `${name}: swap to sandboxed bash failed for session ${session.id}, keeping persistent bash: `
        + `${String((error && error.message) || error)}`,
      )
    }
  })
}
