#!/usr/bin/env node
// sync.mjs — turn vendor/upstream snapshot into a dsh-ready adapted skill pack.
// Usage:
//   node scripts/mattpocock/sync.mjs                       # regenerate from local vendor
//   node scripts/mattpocock/sync.mjs --upstream v1.2.4     # fetch upstream tag into vendor first
// Options: --vendor, --out, --rules, --manifest, --provenance, --report
import { readFile, writeFile, mkdir, readdir, rm, cp, access } from 'node:fs/promises'
import { join, dirname, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { loadRules, applyRulesToSkill } from './rules.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const UPSTREAM_REPO = 'https://github.com/mattpocock/skills'

function parseArgs(argv) {
  const args = {
    vendor: resolve(HERE, '../../vendor/upstream'),
    out: resolve(HERE, '../../generated/skills'),
    rules: resolve(HERE, './adapt-rules.yaml'),
    manifest: resolve(HERE, '../../manifest.json'),
    provenance: resolve(HERE, '../../PROVENANCE.md'),
    report: resolve(HERE, '../../sync-report.md'),
    upstream: null,
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--vendor' && argv[i + 1]) args.vendor = resolve(argv[++i])
    else if (argv[i] === '--out' && argv[i + 1]) args.out = resolve(argv[++i])
    else if (argv[i] === '--rules' && argv[i + 1]) args.rules = resolve(argv[++i])
    else if (argv[i] === '--manifest' && argv[i + 1]) args.manifest = resolve(argv[++i])
    else if (argv[i] === '--provenance' && argv[i + 1]) args.provenance = resolve(argv[++i])
    else if (argv[i] === '--report' && argv[i + 1]) args.report = resolve(argv[++i])
    else if (argv[i] === '--upstream' && argv[i + 1]) args.upstream = argv[++i]
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
    if (!m) return null
    fields[m[1]] = m[2]
  }
  if (i >= lines.length) return null
  return { fields, body: lines.slice(i + 1).join('\n') }
}

function renderFrontmatter(fields, body) {
  const header = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')
  return `---\n${header}\n---\n${body}`
}

async function collectFiles(dir, base = '') {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (e.name === 'agents' || e.name === '.git') continue
    const rel = base ? `${base}/${e.name}` : e.name
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...await collectFiles(full, rel))
    else out.push({ path: rel, content: await readFile(full, 'utf8') })
  }
  return out
}

async function fetchUpstream(ref, vendorDir) {
  const tmp = join(process.env.TMPDIR || '/tmp', `mattpocock-sync-${Date.now()}`)
  execFileSync('git', ['-c', `http.proxy=${process.env.HTTPS_PROXY || 'http://127.0.0.1:7890'}`, 'clone', '--depth', '1', '--branch', ref, UPSTREAM_REPO, tmp], { stdio: 'inherit' })
  const commit = execFileSync('git', ['-C', tmp, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  await rm(vendorDir, { recursive: true, force: true })
  await mkdir(vendorDir, { recursive: true })
  await cp(join(tmp, 'skills/engineering'), join(vendorDir, 'skills-engineering'), { recursive: true })
  await cp(join(tmp, 'skills/productivity'), join(vendorDir, 'skills-productivity'), { recursive: true })
  await mkdir(join(vendorDir, '.meta'), { recursive: true })
  await cp(join(tmp, '.claude-plugin/plugin.json'), join(vendorDir, '.meta/plugin.json'))
  await cp(join(tmp, 'LICENSE'), join(vendorDir, '.meta/LICENSE'))
  await rm(tmp, { recursive: true, force: true })
  return commit
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const rules = await loadRules(args.rules)
  const manifest = JSON.parse(await readFile(args.manifest, 'utf8'))

  let commit = manifest.upstream.commit
  let ref = manifest.upstream.ref
  if (args.upstream) {
    ref = args.upstream
    commit = await fetchUpstream(args.upstream, args.vendor)
  }

  const expected = new Set(manifest.upstream.scope.map((p) => basename(p)))
  const buckets = ['skills-engineering', 'skills-productivity']
  const perSkill = []
  const ruleMatched = new Set()

  await rm(args.out, { recursive: true, force: true })
  await mkdir(args.out, { recursive: true })

  for (const bucket of buckets) {
    const bucketDir = join(args.vendor, bucket)
    const entries = await readdir(bucketDir, { withFileTypes: true }).catch(() => [])
    const names = []
    for (const e of entries) {
      if (!e.isDirectory() || !expected.has(e.name)) continue
      const ok = await access(join(bucketDir, e.name, 'SKILL.md')).then(() => true).catch(() => false)
      if (ok) names.push(e.name)
    }
    for (const name of names) {
      const files = await collectFiles(join(bucketDir, name))
      // Strip forbidden frontmatter fields first
      const skillFileIdx = files.findIndex((f) => f.path === 'SKILL.md')
      if (skillFileIdx >= 0) {
        const parsed = parseFrontmatter(files[skillFileIdx].content)
        if (parsed) {
          for (const f of rules.frontmatter.removeFields) delete parsed.fields[f]
          files[skillFileIdx] = { path: 'SKILL.md', content: renderFrontmatter(parsed.fields, parsed.body) }
        }
      }
      const result = applyRulesToSkill(rules, name, files)
      for (const id of result.matched) ruleMatched.add(id)

      const changed = result.files.filter((f) => f.before !== f.after)
      for (const f of result.files) {
        const outPath = join(args.out, name, f.path)
        await mkdir(dirname(outPath), { recursive: true })
        await writeFile(outPath, f.after)
      }
      perSkill.push({ name, changed: changed.map((f) => ({ path: f.path, matched: f.matched })), matched: [...result.matched], missed: [...result.missed] })
    }
  }

  const neverMatched = rules.text.rewrites.filter((r) => !ruleMatched.has(r.id)).map((r) => r.id)

  // Copy authored skills (source: skills-matt/) into the generated pack
  const authoredDir = resolve(HERE, '../../skills-matt')
  const authored = []
  if (await access(authoredDir).then(() => true).catch(() => false)) {
    const entries = await readdir(authoredDir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      await cp(join(authoredDir, e.name), join(args.out, e.name), { recursive: true })
      authored.push(e.name)
    }
  }

  // Validation gate
  const lintOut = execFileSync(process.execPath, [join(HERE, 'lint-skills.mjs'), '--skills', args.out, '--rules', args.rules, '--manifest', args.manifest], { encoding: 'utf8' })
  const lintFailed = process.env.DSH_MATT_SYNC_SKIP_LINT !== '1' && /^error:/m.test(lintOut)

  // Report
  const reportLines = []
  reportLines.push('# Matt Pocock skills sync report')
  reportLines.push('')
  reportLines.push(`- Date: ${new Date().toISOString().slice(0, 10)}`)
  reportLines.push(`- Upstream ref: ${ref}`)
  reportLines.push(`- Upstream commit: ${commit}`)
  reportLines.push(`- Rules version: ${rules.version}`)
  reportLines.push('')
  reportLines.push(`## Skills (${perSkill.length} upstream${authored.length ? ` + ${authored.length} authored` : ''})`)
  for (const s of perSkill.sort((a, b) => a.name.localeCompare(b.name))) {
    reportLines.push(`- **${s.name}** — changed ${s.changed.length} file(s)`)
    for (const c of s.changed) reportLines.push(`  - ${c.path} [rules: ${c.matched.join(', ') || '—'}]`)
    if (s.missed.length) reportLines.push(`  - ⚠️ rules with no hit: ${s.missed.join(', ')}`)
  }
  if (authored.length) {
    reportLines.push('')
    reportLines.push(`## Authored skills (not from upstream): ${authored.sort().join(', ')}`)
  }
  reportLines.push('')
  reportLines.push('## Rule application')
  reportLines.push(`- Matched: ${[...ruleMatched].sort().join(', ') || '—'}`)
  reportLines.push(`- Missed (needs review): ${neverMatched.join(', ') || '—'}`)
  reportLines.push('')
  reportLines.push('## Lint')
  reportLines.push('```')
  reportLines.push(lintOut.trim())
  reportLines.push('```')
  await writeFile(args.report, reportLines.join('\n') + '\n')

  // Provenance
  const provenance = [
    '# dsh-mattpocock-skills provenance & sync log',
    '',
    `- Upstream: ${UPSTREAM_REPO}`,
    `- Ref: ${ref}`,
    `- Commit: ${commit}`,
    `- Last sync: ${new Date().toISOString().slice(0, 10)}`,
    `- Scope: ${manifest.upstream.scope.length} promoted skills (engineering + productivity)${authored.length ? ` + authored: ${authored.sort().join(', ')}` : ''}`,
    '',
    '## Adaptation rules',
    `See scripts/mattpocock/adapt-rules.yaml (version ${rules.version}).`,
    '',
    '## Latest sync per-skill changes',
    ...perSkill.sort((a, b) => a.name.localeCompare(b.name)).map((s) => `- ${s.name}: ${s.changed.length} file(s) changed${s.missed.length ? `; ⚠️ rules with no hit: ${s.missed.join(', ')}` : ''}`),
    '',
  ].join('\n')
  await writeFile(args.provenance, provenance)

  // Manifest update
  manifest.upstream.ref = ref
  manifest.upstream.commit = commit
  manifest.generatedAt = new Date().toISOString()
  manifest.rulesVersion = rules.version
  manifest.lastSync = { date: new Date().toISOString().slice(0, 10), ref, commit, upstreamSkillCount: perSkill.length, authoredSkills: authored.length ? authored : [], lintErrors: lintOut.match(/^error:.*$/gm)?.length ?? 0 }
  await writeFile(args.manifest, JSON.stringify(manifest, null, 2) + '\n')

  console.log(reportLines.join('\n'))
  if (lintFailed) {
    console.error('\nSYNC COMPLETE BUT LINT FOUND ERRORS — see sync-report.md')
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})