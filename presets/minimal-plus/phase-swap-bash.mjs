/**
 * phase-swap-bash — swap the persistent bash for the sandboxed bash on promotion.
 *
 * liangshen+ 组合 preset 的第三个机制：首轮用 persistent bash（Minimal 锚定对），
 * 首个 durable tool/call 触发 promotion，但 swap 只在该 step 结算（`step/end`）后执行：
 * 一个 step 可以携带多条 tool/call（模型在一条 assistant 消息里批量发出独立调用），
 * dsh-agent-loop 逐条 appendToolCall → prepare/dispatch → appendToolResult，全部结算
 * 后才 append step/end。换 schema 的边界因此与「一个请求一个工具快照」同粒度，无论该
 * step 携带几条调用（finding 12-2 及其多调用残留），下一次请求起换成
 * `dsh-tool-bash`（沙箱 + sandbox_permissions 提权）生效。
 *
 * 关键实现约束：swap 必须在「下一次请求的工具快照」之前完成，而快照发生在
 * `system-prompt/assemble` 内部（工具 provider 先收集、waterfall 后跑——在 assemble
 * 监听器里注册已经太晚），因此换 schema 只能在 step/end 事件里 **同步** 完成：
 * 用 root 服务一次性捕获沙箱工具定义（spy 吞掉 guidance section 注册），再用
 * `agent.ctx.tools.register(definition)` 直接注册进该 agent 的 scope layer。
 * 早期的 `agent.ctx.inject([...])` 路线是异步 fiber，会与下一次装配赛跑（实测漏 swap）。
 * `step/start` → `step/end` 的开合状态是守卫：step 中途（含 tool/call、tool/result）
 * 一律不换 schema，避免 dispatch 用 live registry 解析工具时被换掉本 step 已产出的参数。
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
   * disposer comes from registering the captured tool definition into the real
   * agent scope, so compaction can actually UNREGISTER the sandbox and return
   * to the controlled (persistent bash) phase — re-registering the same name
   * in the same agent scope would throw ("already registered"). */
  const swapDisposers = new Map()
  /** Per-session open-step flag: true between `step/start` and `step/end`. */
  const openSteps = new Set()
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

  /**
   * 沙箱 bash 的工具定义：用 root 服务跑一次 `dsh-tool-bash.apply()`，spy 吞掉
   * guidance section 注册并捕获 definition。定义只随 composition 的 shell
   * sandboxMode 变化（全局），因此捕获一次即可；捕获与注册全程同步，才能保证
   * step/end 之后的下一次请求装配看到新 schema。
   */
  let sandboxDefinition
  const captureSandboxDefinition = () => {
    if (sandboxDefinition !== undefined) return sandboxDefinition
    let captured
    const spyCtx = {
      shell: ctx.get('shell'),
      get: (service) => ctx.get(service),
      // dsh-tool-bash 的 guidance section 经 getSectionOrder 注册；spy 按真实服务应答。
      systemPrompt: { section() {}, tools() {}, getSectionOrder: () => 0 },
      tools: { register: (definition) => { captured = definition; return () => {} } },
    }
    sandboxBash.apply(spyCtx, swapConfig)
    if (captured?.description !== undefined) {
      captured = {
        ...captured,
        description: captured.description
          + '\n* Network access is not blocked by the sandbox; do not pass sandbox_permissions just for curl/wget.',
      }
    }
    sandboxDefinition = captured
    return sandboxDefinition
  }

  ctx.on('session/event', (session, event) => {
    if (event.type === 'compaction/end') {
      openSteps.delete(session.id)
      // compaction 后回到 controlled phase：注销该 agent scope 里的沙箱
      // bash，露出全局 persistent bash；下次 promotion 再重新 swap。
      const disposer = swapDisposers.get(session.id)
      if (disposer !== undefined) {
        disposer()
        swapDisposers.delete(session.id)
      }
      return
    }
    if (event.type === 'step/start') {
      openSteps.add(session.id)
      return
    }
    if (event.type === 'step/end') openSteps.delete(session.id)
    // 只在两个已知安全点换相：step/end（触发 step 已结算，下一 step 尚未
    // step/start）与 turn/start（resume 的第一次请求之前）。同步注册保证 loop 在
    // preStep 里 await 的工具装配看得到新 schema；step 中途（含 tool/call、
    // tool/result）一律跳过，避免 dispatch 用 live registry 解析工具时把本 step
    // 已产出的参数换到新 schema 上（finding 12-2 原形）。
    if (event.type !== 'step/end' && event.type !== 'turn/start') return
    if (openSteps.has(session.id) || swapDisposers.has(session.id)) return
    const agent = ctx.get('agents')?.get(session.id)
    if (agent === undefined) return
    // 冷启动/resume：promotion.status() 冷扫描 session 日志，恢复会话在首个
    // step 已结算的事件即换相，不必等新的 tool/call（H5 冷启动回归）。
    if (!promotion.status(agent).promoted) return
    try {
      // 直接访问 agent.ctx.tools（服务解析沿 fiber 链找到 tools 实现，无需 inject），
      // register 落在该 agent 的 scope layer：shadow 全局 persistent bash，
      // 其他 session/子代理不受影响；失败保留 persistent（目录全开但无提权）。
      const disposer = agent.ctx.tools.register(captureSandboxDefinition())
      // Mark swapped only after the swap actually succeeded: a transient failure
      // must leave the session eligible for a future retry.
      if (disposer !== undefined) swapDisposers.set(session.id, disposer)
    } catch (error) {
      warnOnce(
        `${name}: swap to sandboxed bash failed for session ${String(session.id)}, keeping persistent bash: `
        + `${String((error && error.message) || error)}`,
      )
    }
  })
}
