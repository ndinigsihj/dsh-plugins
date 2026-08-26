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
 *
 * 失败降级：swap 抛错 → warn once + 保持 persistent bash（目录全开但无提权），
 * 绝不 brick 会话。
 */

import { createEpochPromotion } from '/Users/vito/.dsh/profiles/endless-tui/node_modules/@deepseek-harness-tui/dsh-tui/presets/liangshen/compaction-epoch.mjs'
import * as sandboxBash from '/Users/vito/.dsh/profiles/endless-tui/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-tool-bash/lib/index.js'

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
    const kept = sections.filter((section) => !(section.name ?? '').startsWith('tool:'))
    return kept.length === sections.length ? assembled : { ...assembled, sections: kept }
  })

  /** Per-session swap memo: each promoted session swaps exactly once. */
  const swapped = new Set()
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
    // Only act on the durable promotion signal itself, not every event.
    if (event.type !== 'tool/call') return
    if (swapped.has(session.id)) return
    try {
      // 事件时解析服务：inject=[] 纪律下不能用属性访问（ctx.agents 会抛
      // "without inject"），显式 ctx.get 不需要 inject（同 dsh-tui rosterOf）。
      const agent = ctx.get('agents')?.get(session.id)
      if (agent === undefined) return
      if (!promotion.status(agent).promoted) return
      // Register sandbox bash into THIS agent's scope layer, shadowing the
      // shared persistent bash for this session only. `dsh-tool-bash.apply`
      // resolves ctx.shell / ctx.sandboxPolicy / ctx.approval / ctx.systemPrompt
      // / ctx.tools up the chain from the agent ctx, exactly like standard.
      // 注意：直接 apply(agent.ctx) 会因 cordis 的 "without inject" 检查失败
      // （属性访问需要 inject 声明）——用 ctx.inject 建立注入子 ctx 再调。
      await agent.ctx.inject(['tools', 'shell', 'systemPrompt', 'shellEnv'], (injectedCtx) => {
        sandboxBash.apply(injectedCtx, swapConfig)
      })
      // Mark swapped only after the swap actually succeeded: a transient
      // failure must leave the session eligible for a future retry.
      swapped.add(session.id)
    } catch (error) {
      // Degrade: keep persistent bash (full directory but no escalation).
      warnOnce(
        `${name}: swap to sandboxed bash failed for session ${session.id}, keeping persistent bash: `
        + `${String((error && error.message) || error)}`,
      )
    }
  })
}
