// rules.mjs — parse & apply scripts/mattpocock/adapt-rules.yaml (tiny, dependency-free)
import { readFile } from 'node:fs/promises'

export function parseRulesText(text) {
  const lines = text.split(/\r?\n/)
  const rules = {
    version: null,
    frontmatter: { allowedFields: [], removeFields: [] },
    files: { remove: [] },
    aliases: {},
    text: { rewrites: [] },
  }

  let section = null // 'version' | 'frontmatter' | 'files' | 'aliases' | 'text'
  let sub = null     // e.g. 'allowedFields', 'remove', 'rewrites'
  let current = null // current rewrite object

  const unquote = (s) => {
    s = s.trim()
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
      return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n')
    }
    if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
      return s.slice(1, -1).replace(/''/g, "'")
    }
    return s
  }
  const parseScalar = (s) => {
    s = s.trim()
    if (s === 'true') return true
    if (s === 'false') return false
    if (s === 'null') return null
    if (/^-?\d+$/.test(s)) return Number(s)
    return unquote(s)
  }
  const parseInlineList = (s) => {
    const m = /^\s*\[(.*)\]\s*$/.exec(s)
    if (!m) return null
    return m[1].split(',').map((x) => unquote(x.trim())).filter(Boolean)
  }

  const isTopLevelKey = (key) => ['version', 'frontmatter', 'files', 'aliases', 'text'].includes(key)
  const beginRewrite = (id) => {
    if (current) rules.text.rewrites.push(current)
    current = { id: unquote(id), skills: [], onlyFiles: [], global: false, kind: 'manual' }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    // Top-level section header
    const top = /^([a-zA-Z]+):\s*(.*)$/.exec(line)
    if (top && isTopLevelKey(top[1])) {
      section = top[1]
      sub = null
      current = null
      if (section === 'version') rules.version = parseScalar(top[2])
      continue
    }

    // Nested subsection header (e.g. "allowedFields:", "remove:", "rewrites:")
    const subMatch = /^([a-zA-Z0-9_-]+):\s*$/.exec(line)
    if (subMatch && !line.startsWith('- ')) {
      if (section === 'frontmatter' && ['allowedFields', 'removeFields'].includes(subMatch[1])) {
        sub = subMatch[1]
      } else if (section === 'files' && subMatch[1] === 'remove') {
        sub = 'remove'
      } else if (section === 'text' && subMatch[1] === 'rewrites') {
        sub = 'rewrites'
      }
      continue
    }

    // List item
    if (line.startsWith('- ')) {
      const item = line.slice(2)
      if (section === 'frontmatter' && sub) {
        rules.frontmatter[sub].push(unquote(item))
        continue
      }
      if (section === 'files' && sub === 'remove') {
        const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(item)
        if (kv) {
          const obj = {}
          obj[kv[1]] = parseScalar(kv[2])
          rules.files.remove.push(obj)
        }
        continue
      }
      if (section === 'text' && sub === 'rewrites') {
        const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(item)
        if (kv && kv[1] === 'id') {
          beginRewrite(kv[2])
        } else if (current && kv) {
          if (kv[1] === 'skills' || kv[1] === 'files' || kv[1] === 'onlyFiles') {
            current[kv[1] === 'onlyFiles' ? 'onlyFiles' : kv[1]] = parseInlineList(kv[2]) ?? []
          } else {
            current[kv[1]] = parseScalar(kv[2])
          }
        }
        continue
      }
      continue
    }

    // key: value at section level (aliases map, rewrite fields on continuation lines)
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (kv) {
      if (section === 'aliases') {
        rules.aliases[kv[1]] = parseScalar(kv[2])
      } else if (section === 'text' && sub === 'rewrites' && current) {
        if (kv[1] === 'skills' || kv[1] === 'files' || kv[1] === 'onlyFiles') {
          current[kv[1] === 'onlyFiles' ? 'onlyFiles' : kv[1]] = parseInlineList(kv[2]) ?? []
        } else {
          current[kv[1]] = parseScalar(kv[2])
        }
      }
    }
  }
  if (current) rules.text.rewrites.push(current)
  return rules
}

export async function loadRules(path) {
  return parseRulesText(await readFile(path, 'utf8'))
}

/**
 * Apply text rewrites to one skill's files.
 * files: [{ path, content }] where path is relative to the skill directory (e.g. "SKILL.md").
 * Patterns are LITERAL strings (not regex); `global` is ignored for literal matching.
 * Returns { files: [{ path, before, after, matched }], matched: Set<ruleId>, missed: Set<ruleId> }
 */
export function applyRulesToSkill(rules, skillName, files) {
  const matched = new Set()
  const missed = new Set()
  const resultFiles = []

  const applicable = rules.text.rewrites.filter((r) => {
    if (r.skills?.length && !r.skills.includes(skillName)) return false
    if (r.onlyFiles?.length) {
      const hits = r.onlyFiles.some((f) => {
        const [fileSkill] = f.includes('/') ? f.split('/') : [skillName]
        return fileSkill === skillName
      })
      if (!hits) return false
    }
    return true
  })

  for (const file of files) {
    let content = file.content
    const fileMatched = new Set()
    for (const r of applicable) {
      if (r.onlyFiles?.length) {
        const targets = r.onlyFiles
          .filter((f) => {
            const [fileSkill] = f.includes('/') ? f.split('/') : [skillName]
            return fileSkill === skillName
          })
          .map((f) => (f.includes('/') ? f.split('/')[1] : f))
        if (!targets.includes(file.path)) continue
      }
      const count = file.content.split(r.pattern).length - 1
      if (count > 0) {
        content = content.replaceAll(r.pattern, r.replacement)
        fileMatched.add(r.id)
        matched.add(r.id)
      }
    }
    resultFiles.push({ path: file.path, before: file.content, after: content, matched: [...fileMatched] })
  }

  for (const r of applicable) {
    if (!matched.has(r.id) && !(!r.skills?.length && !r.onlyFiles?.length)) missed.add(r.id)
  }

  return { files: resultFiles, matched, missed }
}