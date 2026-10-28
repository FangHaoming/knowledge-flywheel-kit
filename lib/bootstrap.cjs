'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const SOURCE = path.resolve(__dirname, '..')
const META = '.knowledge-flywheel'
const STATE = `${META}/state.json`
const CANONICAL = '.cursor/skills/knowledge-flywheel'
const ALIAS = '.agents/skills/knowledge-flywheel'
const BEGIN = '<!-- knowledge-flywheel:begin -->'
const END = '<!-- knowledge-flywheel:end -->'
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
const fail = (message) => { throw new Error(message) }
const timestamp = () => new Date().toISOString()

function stat(file) {
  try { return fs.lstatSync(file) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

function relative(rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.includes('\\') || rel.includes('\0') || rel.split('/').some((part) => !part || part === '.' || part === '..')) fail(`Invalid project-relative path: ${rel}`)
  return rel
}

function within(root, target) {
  const rel = path.relative(root, target)
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) fail(`Path escapes project: ${target}`)
  return target
}

function safePath(root, rel) {
  const target = within(root, path.resolve(root, relative(rel)))
  let existing = target
  while (!stat(existing)) existing = path.dirname(existing)
  try { within(root, fs.realpathSync(existing)) } catch (error) { fail(`Unsafe or dangling path ${rel}: ${error.message}`) }
  return target
}

function futurePath(root, rel) {
  const full = safePath(root, rel)
  let parent = full
  const tail = []
  while (!stat(parent)) { tail.unshift(path.basename(parent)); parent = path.dirname(parent) }
  return path.join(fs.realpathSync(parent), ...tail)
}

function projectRoot(value, source = SOURCE) {
  const directory = fs.realpathSync(path.resolve(value || process.cwd()))
  let root
  try { root = fs.realpathSync(execFileSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) } catch (_) { fail('Target B must be an existing Git repository; pass --project /absolute/path/to/B') }
  if (root === fs.realpathSync(source)) fail('A is the method source repository; choose a separate business repository B')
  return root
}

function disk(root, rel) {
  const full = safePath(root, rel)
  const info = stat(full)
  if (!info) return { kind: 'missing' }
  if (info.isSymbolicLink()) return { kind: 'symlink', target: fs.readlinkSync(full) }
  if (!info.isFile()) return { kind: 'directory' }
  const bytes = fs.readFileSync(full)
  return { kind: 'file', bytes, sha: hash(bytes) }
}

function same(a, b) {
  return a.kind === b.kind && (a.kind === 'file' ? a.sha === b.sha : a.kind === 'symlink' ? a.target === b.target : true)
}

function loadState(root) {
  const entry = disk(root, STATE)
  if (entry.kind === 'missing') return null
  if (entry.kind !== 'file') fail('Version state must be a regular project-local file')
  const state = JSON.parse(entry.bytes.toString('utf8'))
  if (state.schema_version !== 1 || state.tool !== 'knowledge-flywheel-kit' || !state.files || !state.agents || !state.alias) fail('Unknown or invalid knowledge-flywheel version state; inspect it before continuing')
  for (const [rel, digest] of Object.entries(state.files)) {
    if (!(rel.startsWith(`${CANONICAL}/`) || ['.cursor/rules/knowledge-flywheel.mdc', 'docs/knowledge/WORKFLOW.md'].includes(rel)) || !/^[0-9a-f]{64}$/.test(digest)) fail(`Invalid managed state entry: ${rel}`)
    relative(rel)
  }
  if (state.alias.path !== ALIAS) fail('Unknown skill alias in version state')
  return state
}

function walk(directory) {
  const files = []
  for (const name of fs.readdirSync(directory).sort()) {
    const full = path.join(directory, name)
    const info = fs.lstatSync(full)
    if (info.isSymbolicLink()) fail(`Template symlinks are not supported: ${full}`)
    if (info.isDirectory()) for (const child of walk(full)) files.push(`${name}/${child}`)
    else if (info.isFile()) files.push(name)
  }
  return files
}

function sourceData(source = SOURCE) {
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
  const files = {}
  for (const rel of walk(path.join(source, 'templates/skill'))) {
    const name = rel === 'SKILL.template.md' ? 'SKILL.md' : rel
    files[`${CANONICAL}/${name}`] = fs.readFileSync(path.join(source, 'templates/skill', rel))
  }
  files['.cursor/rules/knowledge-flywheel.mdc'] = fs.readFileSync(path.join(source, 'templates/cursor-rule.mdc'))
  files['docs/knowledge/WORKFLOW.md'] = fs.readFileSync(path.join(source, 'templates/workflow.md'))
  const agents = fs.readFileSync(path.join(source, 'templates/agents-block.md'), 'utf8').trim()
  const fingerprint = [pkg.version, agents, ...Object.entries(files).map(([rel, bytes]) => `${rel}:${hash(bytes)}`)].join('\n')
  return { version: pkg.version, digest: hash(fingerprint), files, agents }
}

function extractBlock(text) {
  const starts = text.split(BEGIN).length - 1
  const ends = text.split(END).length - 1
  if (!starts && !ends) return null
  if (starts !== 1 || ends !== 1 || text.indexOf(BEGIN) > text.indexOf(END)) fail('AGENTS.md has duplicate, broken or unpaired managed markers')
  const start = text.indexOf(BEGIN)
  const end = text.indexOf(END) + END.length
  return { start, end, text: text.slice(start, end) }
}

function plan(root, options = {}, source = SOURCE) {
  const data = sourceData(source)
  const state = loadState(root)
  if (state && options.command !== 'update' && (state.source_digest !== data.digest || state.version !== data.version)) fail(`B pins ${state.version}; use update to adopt A's current method version`)
  const changes = []
  function put(rel, bytes, expected) {
    const current = disk(root, rel)
    if (current.kind !== 'file' && current.kind !== 'missing') fail(`Managed file collides with a directory or symlink: ${rel}`)
    const desired = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    const sha = hash(desired)
    if (current.kind === 'file' && current.sha !== sha && current.sha !== expected) fail(`Local content conflict: ${rel}; preserve the project change and merge it before updating`)
    if (current.kind === 'missing' || current.sha !== sha) changes.push({ rel, kind: 'write', before: current, bytes: desired })
    return sha
  }

  const managed = {}
  for (const [rel, bytes] of Object.entries(data.files)) managed[rel] = put(rel, bytes, state && state.files[rel])
  if (state) for (const [rel, expected] of Object.entries(state.files)) {
    if (managed[rel]) continue
    const current = disk(root, rel)
    if (current.kind === 'missing') continue
    if (current.kind !== 'file' || current.sha !== expected) fail(`Removed upstream file has local edits: ${rel}`)
    changes.push({ rel, kind: 'delete', before: current })
  }

  const agentEntry = disk(root, 'AGENTS.md')
  if (!['file', 'missing'].includes(agentEntry.kind)) fail('AGENTS.md must be a regular file; refusing to replace a symlink or directory')
  let agentText = agentEntry.kind === 'file' ? agentEntry.bytes.toString('utf8') : ''
  const newline = agentText.includes('\r\n') ? '\r\n' : '\n'
  const desiredBlock = [BEGIN, data.agents.replace(/\r?\n/g, newline), END].join(newline)
  const block = extractBlock(agentText)
  if (block) {
    if (block.text !== desiredBlock && (!state || hash(block.text) !== state.agents.sha256)) fail('Local content conflict inside the AGENTS.md managed block')
    agentText = agentText.slice(0, block.start) + desiredBlock + agentText.slice(block.end)
  } else {
    if (state) fail('Previously managed AGENTS.md block is missing; inspect project instructions before reinstalling')
    const gap = !agentText || agentText.endsWith(newline + newline) ? '' : agentText.endsWith(newline) ? newline : newline + newline
    agentText += gap + desiredBlock + newline
  }
  if (agentEntry.kind === 'missing' || !agentEntry.bytes.equals(Buffer.from(agentText))) changes.push({ rel: 'AGENTS.md', kind: 'write', before: agentEntry, bytes: Buffer.from(agentText) })

  let alias
  if (state && state.alias.mode === 'relative-symlink') {
    const previousAlias = disk(root, ALIAS)
    if (previousAlias.kind !== 'missing' && (previousAlias.kind !== 'symlink' || previousAlias.target !== state.alias.target)) fail(`Local alias change: ${ALIAS}`)
  }
  const canonicalFuture = futurePath(root, CANONICAL)
  const aliasFuture = futurePath(root, ALIAS)
  if (canonicalFuture === aliasFuture) alias = { path: ALIAS, mode: 'existing-shared-path' }
  else {
    const current = disk(root, ALIAS)
    if (current.kind !== 'missing') fail(`Skill discovery path already belongs to other content: ${ALIAS}`)
    const target = path.relative(path.dirname(path.join(root, ALIAS)), path.join(root, CANONICAL)).split(path.sep).join('/')
    alias = { path: ALIAS, mode: 'relative-symlink', target }
    changes.push({ rel: ALIAS, kind: 'symlink', before: current, target })
  }
  // Preserve an already installed relative alias's recorded type on repeated runs.
  if (state && state.alias.mode === 'relative-symlink' && disk(root, ALIAS).kind === 'symlink') alias = state.alias

  for (const [rel, content] of [['docs/knowledge/README.md', fs.readFileSync(path.join(source, 'templates/project-readme.md'))], ['docs/knowledge/cards/.gitkeep', Buffer.alloc(0)]]) {
    const current = disk(root, rel)
    if (current.kind === 'missing') changes.push({ rel, kind: 'write', before: current, bytes: content })
    else if (current.kind !== 'file') fail(`Project knowledge scaffold collides with a non-file: ${rel}`)
  }
  const ignoreEntry = disk(root, `${META}/.gitignore`)
  if (!['file', 'missing'].includes(ignoreEntry.kind)) fail('Invalid local metadata .gitignore')
  let ignore = ignoreEntry.kind === 'file' ? ignoreEntry.bytes.toString('utf8') : ''
  for (const line of ['backups/', 'install.lock']) if (!ignore.split(/\r?\n/).includes(line)) ignore += `${ignore && !ignore.endsWith('\n') ? '\n' : ''}${line}\n`
  if (ignoreEntry.kind === 'missing' || !ignoreEntry.bytes.equals(Buffer.from(ignore))) changes.push({ rel: `${META}/.gitignore`, kind: 'write', before: ignoreEntry, bytes: Buffer.from(ignore) })

  const next = { schema_version: 1, tool: 'knowledge-flywheel-kit', version: data.version, source_digest: data.digest, files: managed, agents: { sha256: hash(desiredBlock) }, alias, installed_at: state ? state.installed_at : timestamp() }
  const previous = state && { ...state }
  if (previous) delete previous.updated_at
  const unchanged = previous && JSON.stringify(previous) === JSON.stringify(next) && changes.length === 0
  next.updated_at = unchanged ? state.updated_at : timestamp()
  const nextBytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`)
  const stateEntry = disk(root, STATE)
  if (stateEntry.kind === 'missing' || !stateEntry.bytes.equals(nextBytes)) changes.push({ rel: STATE, kind: 'write', before: stateEntry, bytes: nextBytes })
  return { root, version: data.version, changes, state: next }
}

function writeFile(root, rel, bytes) {
  const full = safePath(root, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  const temporary = `${full}.kf-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`
  try { fs.writeFileSync(temporary, bytes, { flag: 'wx' }); fs.renameSync(temporary, full) } finally { if (stat(temporary)) fs.unlinkSync(temporary) }
}

function apply(root, options = {}, source = SOURCE) {
  let proposed = plan(root, options, source)
  const report = (value) => ({ version: value.version, changed: value.changes.map(({ rel, kind }) => ({ path: rel, action: kind })), dry_run: !!options.dryRun })
  if (options.dryRun || !proposed.changes.length) return report(proposed)
  const lock = safePath(root, `${META}/install.lock`)
  fs.mkdirSync(path.dirname(lock), { recursive: true })
  let fd
  try { fd = fs.openSync(lock, 'wx') } catch (error) { if (error.code === 'EEXIST') fail('Another installation is running, or its lock needs inspection'); throw error }
  const applied = []
  try {
    proposed = plan(root, options, source)
    if (!proposed.changes.length) return report(proposed)
    const backupRel = `${META}/backups/${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    const backupDir = safePath(root, backupRel)
    fs.mkdirSync(backupDir, { recursive: true })
    const manifest = []
    for (const change of proposed.changes) {
      if (change.before.kind === 'file') {
        const destination = path.join(backupDir, change.rel)
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        fs.writeFileSync(destination, change.before.bytes, { flag: 'wx' })
      }
      manifest.push({ path: change.rel, action: change.kind, before: change.before.kind, before_sha256: change.before.sha || null })
    }
    fs.writeFileSync(path.join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    for (const change of proposed.changes) {
      if (!same(disk(root, change.rel), change.before)) fail(`Concurrent change detected: ${change.rel}`)
      const full = safePath(root, change.rel)
      if (change.kind === 'write') writeFile(root, change.rel, change.bytes)
      else if (change.kind === 'delete') fs.unlinkSync(full)
      else { fs.mkdirSync(path.dirname(full), { recursive: true }); fs.symlinkSync(change.target, full, 'dir') }
      applied.push(change)
    }
    return { ...report(proposed), backup: backupRel }
  } catch (error) {
    const unresolved = []
    for (const change of applied.reverse()) {
      try {
        const current = disk(root, change.rel)
        const expected = change.kind === 'write' ? { kind: 'file', sha: hash(change.bytes) } : change.kind === 'symlink' ? { kind: 'symlink', target: change.target } : { kind: 'missing' }
        if (!same(current, expected)) { unresolved.push(change.rel); continue }
        if (change.before.kind === 'file') writeFile(root, change.rel, change.before.bytes)
        else if (current.kind !== 'missing') fs.unlinkSync(safePath(root, change.rel))
      } catch (_) { unresolved.push(change.rel) }
    }
    if (unresolved.length) error.message += `; inspect backups and concurrent edits: ${unresolved.join(', ')}`
    throw error
  } finally { fs.closeSync(fd); fs.unlinkSync(lock) }
}

function status(root, source = SOURCE) {
  const state = loadState(root)
  const data = sourceData(source)
  if (!state) return { installed: false, available_version: data.version, drift: [] }
  const drift = []
  for (const [rel, expected] of Object.entries(state.files)) {
    const current = disk(root, rel)
    if (current.kind !== 'file' || current.sha !== expected) drift.push(rel)
  }
  const agent = disk(root, 'AGENTS.md')
  const block = agent.kind === 'file' && extractBlock(agent.bytes.toString('utf8'))
  if (!block || hash(block.text) !== state.agents.sha256) drift.push('AGENTS.md (managed block)')
  if (futurePath(root, ALIAS) !== futurePath(root, CANONICAL)) drift.push(ALIAS)
  else if (state.alias.mode === 'relative-symlink') {
    const currentAlias = disk(root, ALIAS)
    if (currentAlias.kind !== 'symlink' || currentAlias.target !== state.alias.target) drift.push(ALIAS)
  }
  return { installed: true, version: state.version, available_version: data.version, update_available: state.source_digest !== data.digest || state.version !== data.version, drift }
}

function use(root, options = {}, source = SOURCE) {
  if ((!options.task || !options.task.trim()) && !(options.paths || []).length) fail('use needs --task or --path before initialization')
  for (const rel of options.paths || []) { relative(rel); if (/[*?\[\]{}]/.test(rel)) fail('use --path requires a concrete project-relative file') }
  let installation = null
  if (!loadState(root)) installation = apply(root, { command: 'init' }, source)
  const current = status(root, source)
  if (current.drift.length) fail(`Installed workflow has local drift: ${current.drift.join(', ')}; inspect before use`)
  const args = [safePath(root, `${CANONICAL}/scripts/knowledge.cjs`), 'recall', '--repo', root, '--json']
  if (options.task) args.push('--task', options.task)
  for (const rel of options.paths || []) args.push('--path', rel)
  const knowledge = JSON.parse(execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 }))
  return { initialization: installation, method: current, knowledge }
}

module.exports = { SOURCE, CANONICAL, ALIAS, STATE, BEGIN, END, hash, safePath, projectRoot, sourceData, extractBlock, loadState, plan, apply, status, use }
