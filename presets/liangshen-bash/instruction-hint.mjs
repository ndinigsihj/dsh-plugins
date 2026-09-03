/**
 * instruction-hint — 自研替换（vendor 语义复刻，文档 §2.3）。
 *
 * promotion 后每会话注入一次短提示：列出探测到的 AGENTS.md/CLAUDE.md 存在
 * （project root 向上探测 + $DSH_HOME/AGENTS.md），并指示模型行动前先读文件，
 * 不嵌入内容。source.kind='instruction-hint' 不在 bootstrap 的 suppressed 集合，
 * promoted 后不会被剥。
 *
 * 降级：任何探测/注入异常 → warn once + 原样返回 decision，绝不影响请求。
 */

import { createEpochPromotion } from './compaction-epoch.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'instruction-hint'

/** Deliberately NO inject list (listeners only touch services at event time). */
export const inject = []

/** Durable session event types that count as a promotion signal per mode. */
const PROMOTE_EVENTS = {
  'tool-call': ['tool/call'],
  'assistant-message': ['assistant/message'],
  either: ['tool/call', 'assistant/message'],
}

/** Candidate file names, in probe order, for the project chain and user-global. */
const PROJECT_CANDIDATES = ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md']
const USER_GLOBAL_CANDIDATE = 'AGENTS.md'

function parsePromoteOn(value) {
  if (value === undefined || value === 'either') return PROMOTE_EVENTS.either
  if (value === 'tool-call' || value === 'assistant-message') return PROMOTE_EVENTS[value]
  throw new TypeError(`${name}: promoteOn must be one of "tool-call", "assistant-message", "either"; got ${JSON.stringify(value)}`)
}

/** Find the project root: first ancestor containing any root marker (e.g. .git). */
async function findProjectRoot(fs, cwd, signal) {
  let current = cwd
  for (;;) {
    for (const marker of ['.git', '.hg', '.svn']) {
      try {
        const target = await fs.resolve(joinPath(current, marker), { cwd, signal })
        const info = await fs.stat(target, signal)
        if (info !== undefined) return current
      } catch {
        // Probe failure = marker absent; continue.
      }
    }
    const parent = parentPath(current)
    if (parent === current || parent.length === 0) return cwd
    current = parent
  }
}

/** List instruction files present in one directory (project candidates). */
async function presentInDir(fs, dir, candidates, signal) {
  const found = []
  for (const candidate of candidates) {
    try {
      const target = await fs.resolve(joinPath(dir, candidate), { cwd: dir, signal })
      const info = await fs.stat(target, signal)
      if (info !== undefined && info.type === 'file') found.push(candidate)
    } catch {
      // Absent or unreadable — skip.
    }
  }
  return found
}

/** Join one path segment onto a directory (platform-agnostic string join). */
function joinPath(dir, segment) {
  if (dir.endsWith('/') || dir.endsWith('\\')) return dir + segment
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir + sep + segment
}

/** Parent of an absolute Windows or POSIX path. */
function parentPath(path) {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (idx <= 0) return path
  const parent = path.slice(0, idx)
  return parent.length === 0 ? path : parent
}

/** Register the post-promotion instruction-hint injector. */
export function apply(ctx, config) {
  const source = config === undefined ? {} : config
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw new TypeError(`${name}: config must be an object`)
  }
  const promoteEvents = parsePromoteOn(source.promoteOn)
  if (source.includeSubagents !== undefined && typeof source.includeSubagents !== 'boolean') {
    throw new TypeError(`${name}: includeSubagents must be a boolean`)
  }
  const promotion = createEpochPromotion(promoteEvents, { includeSubagents: source.includeSubagents === true })
  ctx.on('session/event', (session, event) => promotion.observe(session, event))

  /** Sessions that already received the hint. */
  const hinted = new Set()
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

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    try {
      if (promotion.status(agent).promoted !== true) return decision
      const session = agent.session
      if (session === undefined || hinted.has(session.id)) return decision
      hinted.add(session.id)

      const fs = ctx.get('fs')
      if (fs === undefined) return decision
      const cwd = session.header.cwd ?? process.cwd()

      const projectFiles = []
      const root = await findProjectRoot(fs, cwd, signal)
      projectFiles.push(...await presentInDir(fs, root, PROJECT_CANDIDATES, signal))

      const userGlobalFiles = []
      try {
        const dshHome = process.env.DSH_HOME ?? (process.env.USERPROFILE ? `${process.env.USERPROFILE}\\.dsh` : undefined)
        if (dshHome !== undefined) {
          userGlobalFiles.push(...await presentInDir(fs, dshHome, [USER_GLOBAL_CANDIDATE], signal))
        }
      } catch {
        // Unreadable home probe — ignore.
      }

      const sections = []
      if (projectFiles.length > 0) {
        sections.push(`Workspace instruction files exist: ${projectFiles.join(', ')} (project root: ${root}).`)
      }
      if (userGlobalFiles.length > 0) {
        sections.push(`A user-global instruction file exists: ${USER_GLOBAL_CANDIDATE}.`)
      }
      if (sections.length === 0) return decision

      const text = [
        ...sections,
        'Do NOT assume their content. When a task touches this workspace, read the relevant instruction files first and follow them.',
      ].join(' ')

      return {
        ...decision,
        messages: [...decision.messages, {
          id: `instruction-hint-${session.id}`,
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'instruction-hint', form: 'hint' },
        }],
      }
    } catch (error) {
      warnOnce(`${name}: hint injection failed, skipping: ${String((error && error.message) || error)}`)
      return decision
    }
  }, { prepend: true })
}