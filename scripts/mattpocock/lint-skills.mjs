#!/usr/bin/env node
// lint-skills.mjs — validate adapted skill packs against dsh format + reference integrity.
// Usage: node scripts/mattpocock/lint-skills.mjs [--skills <dir>] [--rules <yaml>] [--manifest <json>]
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRules } from './rules.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = { skills: resolve(HERE, '../../generated/skills'), rules: resolve(HERE, './adapt-rules.yaml'), manifest: resolve(HERE, '../../manifest.json') }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--skills' && argv[i + 1]) args.skills = resolve(argv[++i])
    else if (argv[i] === '--rules' && argv[i + 1]) args.rules = resolve(argv[++i])
    else if (argv[i] === '--manifest' && argv[i + 1]) args.manifest = resolve(argv[++i])
  }
  return args
}

function parseFrontmatter(raw) {
  const lines = raw.split(/\r?\n/)
  if (lines[0] !== '---') return null
  const fields = {}
  let i = 1
  for (; i < lines.length && lines[i] !== '---'; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i])
    if (!m) throw new Error(`unparseable frontmatter line: ${lines[i]}`)
    fields[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  if (i >= lines.length) return null
  return { fields, body: lines.slice(i + 1).join('\n') }
}

async function collectFiles(dir) {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (e.isDirectory() && e.name === 'agents') continue
    if (e.isFile()) out.push({ path: e.name, content: await readFile(join(dir, e.name), 'utf8') })
    else if (e.isDirectory()) out.push(...await collectFiles(join(dir, e.name)))
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const rules = await loadRules(args.rules)
  const manifest = JSON.parse(await readFile(args.manifest, 'utf8'))

  const errors = []
  const warnings = []
  const skillNames = new Set()
  const expected = manifest.upstream.scope.map((p) => basename(p))

  const entries = await readdir(args.skills, { withFileTypes: true }).catch((e) => {
    errors.push(`cannot read skills dir ${args.skills}: ${e.message}`)
    return []
  })
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const name = e.name
    skillNames.add(name)
    const dir = join(args.skills, name)
    const files = await collectFiles(dir)
    const skillFile = files.find((f) => f.path === 'SKILL.md')
    if (!skillFile) {
      errors.push(`${name}: missing SKILL.md`)
      continue
    }
    let parsed
    try {
      parsed = parseFrontmatter(skillFile.content)
    } catch (err) {
      errors.push(`${name}/SKILL.md: ${err.message}`)
      continue
    }
    if (!parsed) {
      errors.push(`${name}/SKILL.md: missing or unclosed frontmatter`)
      continue
    }
    const { fields } = parsed
    if (fields.name !== name) errors.push(`${name}/SKILL.md: frontmatter name "${fields.name}" != directory "${name}"`)
    if (!/^[a-z][a-z0-9-]*$/.test(name)) errors.push(`${name}: name is not kebab-case`)
    if (!fields.description) errors.push(`${name}/SKILL.md: missing description`)
    for (const f of Object.keys(fields)) {
      if (!rules.frontmatter.allowedFields.includes(f)) errors.push(`${name}/SKILL.md: unsupported frontmatter field "${f}"`)
    }
    for (const f of rules.frontmatter.removeFields) {
      if (f in fields) errors.push(`${name}/SKILL.md: forbidden frontmatter field "${f}" still present`)
    }
    if (fields['disable-model-invocation'] && !['true', 'false'].includes(fields['disable-model-invocation'])) {
      errors.push(`${name}/SKILL.md: disable-model-invocation must be true/false`)
    }
    if (fields['user-invocable'] && !['true', 'false'].includes(fields['user-invocable'])) {
      errors.push(`${name}/SKILL.md: user-invocable must be true/false`)
    }
    if (files.some((f) => f.path.startsWith('agents/'))) {
      errors.push(`${name}: agents/ directory was not stripped`)
    }
  }

  for (const name of expected) {
    if (!skillNames.has(name)) errors.push(`missing expected skill: ${name}`)
  }

  // Second pass: slash-token reference integrity (all skill names known now)
  const known = new Set([...skillNames, ...Object.keys(rules.aliases), ...Object.values(rules.aliases), 'clear', 'compact'])
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const name = e.name
    const dir = join(args.skills, name)
    const files = await collectFiles(dir)
    for (const f of files) {
      for (const m of f.content.matchAll(/`\/([a-z][a-z0-9-]*)`/g)) {
        const token = m[1]
        if (!known.has(token) && !['settings', 'tmp'].includes(token)) {
          warnings.push(`${name}/${f.path}: unknown slash reference "/${token}" (check rename/aliases)`)
        }
      }
    }
  }

  const out = []
  out.push(`skills dir: ${args.skills}`)
  out.push(`skills found: ${skillNames.size} (expected ${expected.length})`)
  out.push(`errors: ${errors.length}, warnings: ${warnings.length}`)
  for (const w of warnings) out.push(`warning: ${w}`)
  for (const e of errors) out.push(`error: ${e}`)
  console.log(out.join('\n'))

  process.exitCode = errors.length > 0 ? 1 : 0
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})