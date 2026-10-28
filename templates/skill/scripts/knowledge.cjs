#!/usr/bin/env node
'use strict'

// Node 16+, standard library only. No network, LLM calls or execution of stored commands.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const STATES = ['candidate', 'active', 'review_required', 'retired']
const REVIEW_KINDS = ['user-confirmed', 'repository-rule', 'verified-fix']
const DIRECTORY = 'docs/knowledge/cards'
const MAX_CARD_BYTES = 32768
const fail = (message) => { throw new Error(message) }
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex')
const now = () => new Date().toISOString()
const validId = (id) => typeof id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.length <= 80
const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))

function relative(value, globs = false) {
  if (!nonempty(value) || path.isAbsolute(value) || value.includes('\\') || value.includes('\0')) fail(`需要仓库相对路径: ${value}`)
  if (value.split('/').some((part) => !part || part === '.' || part === '..')) fail(`路径不能包含空段、. 或 ..: ${value}`)
  if (!globs && /[*?\[\]{}]/.test(value)) fail(`证据路径不能包含通配符: ${value}`)
  return value
}

function inside(root, target) {
  const rel = path.relative(root, target)
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) fail('路径越出仓库')
  return target
}

function safePath(root, rel, createParent = false) {
  relative(rel)
  const target = inside(root, path.resolve(root, rel))
  // Validate every existing parent before any mkdir; reject external symlinks.
  let parent = target
  while (!fs.existsSync(parent)) {
    try {
      if (fs.lstatSync(parent).isSymbolicLink()) fail('路径包含悬空符号链接')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    parent = path.dirname(parent)
  }
  inside(root, fs.realpathSync(parent))
  if (createParent) fs.mkdirSync(path.dirname(target), { recursive: true })
  if (fs.existsSync(target)) inside(root, fs.realpathSync(target))
  return target
}

function rootFrom(value) {
  const cwd = fs.realpathSync(path.resolve(value || process.cwd()))
  try {
    return fs.realpathSync(execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim())
  } catch (_) {
    fail('请在 Git 仓库中运行，或传入 --repo <仓库目录>')
  }
}

function revision(root) {
  try { return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch (_) { return null }
}

function validate(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) fail('知识卡必须是 JSON 对象')
  if (card.schema_version !== 1 || !validId(card.id)) fail('schema_version 必须为 1，id 必须是小写连字符名称')
  for (const key of ['title', 'trigger', 'lesson', 'reason', 'boundaries']) if (!nonempty(card[key])) fail(`${card.id}: 缺少 ${key}`)
  if (!STATES.includes(card.status)) fail(`${card.id}: status 无效`)
  if (!card.scope || !Array.isArray(card.scope.paths) || !Array.isArray(card.scope.keywords)) fail(`${card.id}: 缺少 scope.paths / keywords`)
  card.scope.paths.forEach((item) => relative(item, true))
  if (card.scope.keywords.some((item) => !nonempty(item))) fail(`${card.id}: keywords 不能包含空值`)
  if (!card.scope.paths.length && !card.scope.keywords.length) fail(`${card.id}: 至少提供一种匹配条件`)
  if (!Array.isArray(card.evidence) || !card.evidence.length) fail(`${card.id}: 需要证据，不保存无依据结论`)
  for (const evidence of card.evidence) {
    if (!nonempty(evidence.note)) fail(`${card.id}: 每条证据需要 note`)
    if (evidence.path) relative(evidence.path)
    else if (evidence.kind !== 'user-correction') fail(`${card.id}: 只有 user-correction 证据可以不含文件路径`)
    if (evidence.sha256 && !/^[a-f0-9]{64}$/.test(evidence.sha256)) fail(`${card.id}: sha256 无效`)
  }
  if (!Array.isArray(card.validation)) fail(`${card.id}: validation 必须是数组；未验证时使用 []`)
  for (const item of card.validation) {
    if (!['source-review', 'test', 'manual'].includes(item.kind) || !['passed', 'failed', 'not-run'].includes(item.result) || !nonempty(item.detail)) fail(`${card.id}: validation 条目无效`)
    if (item.result !== 'not-run' && !validDate(item.at)) fail(`${card.id}: 已执行验证需要 ISO 时间 at`)
    if (item.kind === 'test' && !nonempty(item.command)) fail(`${card.id}: 测试验证需要 command`)
  }
  if (card.valid_until && !validDate(card.valid_until)) fail(`${card.id}: valid_until 需要 ISO 时间`)
  if (card.supersedes && (!Array.isArray(card.supersedes) || card.supersedes.some((id) => !validId(id) || id === card.id))) fail(`${card.id}: supersedes 无效`)
  if (card.history && !Array.isArray(card.history)) fail(`${card.id}: history 必须为数组`)
  if (card.status === 'active') {
    if (!card.review || !REVIEW_KINDS.includes(card.review.kind) || !nonempty(card.review.basis) || !validDate(card.review.at)) fail(`${card.id}: active 需要复核依据和时间`)
    if (!card.validation.some((item) => item.result === 'passed')) fail(`${card.id}: active 至少需要一项实际验证`)
    for (const evidence of card.evidence) if (evidence.path && !evidence.sha256) fail(`${card.id}: active 文件证据需要指纹`)
  }
  if (Buffer.byteLength(JSON.stringify(card)) > MAX_CARD_BYTES) fail(`${card.id}: 卡片过大，请拆分或引用现有 Spec`)
  return card
}

function readJson(file) {
  if (fs.statSync(file).size > MAX_CARD_BYTES) fail(`知识卡过大: ${file}`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function load(root) {
  const directory = safePath(root, DIRECTORY)
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort().map((name) => {
    const file = safePath(root, `${DIRECTORY}/${name}`)
    const card = validate(readJson(file))
    if (name !== `${card.id}.json`) fail(`文件名与 id 不一致: ${name}`)
    return { card, file, etag: digest(fs.readFileSync(file)) }
  })
}

function inspect(root, card) {
  const warnings = []
  for (const evidence of card.evidence) {
    if (!evidence.path) continue
    const file = safePath(root, evidence.path)
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) warnings.push(`证据文件缺失: ${evidence.path}`)
    else if (!evidence.sha256) warnings.push(`尚未记录证据指纹: ${evidence.path}`)
    else if (digest(fs.readFileSync(file)) !== evidence.sha256) warnings.push(`证据内容变化，需复核: ${evidence.path}`)
  }
  if (card.valid_until && Date.parse(card.valid_until) < Date.now()) warnings.push('超过有效期，需复核')
  return warnings
}

function snapshot(root, card) {
  const copy = JSON.parse(JSON.stringify(card))
  for (const evidence of copy.evidence) {
    if (!evidence.path) continue
    const file = safePath(root, evidence.path)
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`证据文件不存在: ${evidence.path}`)
    evidence.sha256 = digest(fs.readFileSync(file))
  }
  copy.snapshot = { base_commit: revision(root), at: now() }
  return copy
}

function write(root, card, expected) {
  validate(card)
  const file = safePath(root, `${DIRECTORY}/${card.id}.json`, true)
  // A short-lived exclusive lock prevents two agents overwriting the same card.
  const lock = `${file}.lock`
  const fd = fs.openSync(lock, 'wx')
  let temp
  try {
    if (expected === null && fs.existsSync(file)) fail(`已存在 ${card.id}；先读取现有卡片，用 --expected <etag> 更新`)
    if (expected !== null && (!fs.existsSync(file) || digest(fs.readFileSync(file)) !== expected)) fail('知识卡已被其他任务修改；请重新读取，合并后再更新')
    temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
    fs.writeFileSync(temp, `${JSON.stringify(card, null, 2)}\n`, { flag: 'wx' })
    fs.renameSync(temp, file)
    return { id: card.id, status: card.status, path: `${DIRECTORY}/${card.id}.json`, etag: digest(fs.readFileSync(file)) }
  } finally {
    if (temp && fs.existsSync(temp)) fs.unlinkSync(temp)
    fs.closeSync(fd)
    fs.unlinkSync(lock)
  }
}

function globMatches(pattern, value) {
  let expression = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*' && pattern[index + 1] === '*') {
      index += 1
      if (pattern[index + 1] === '/') { index += 1; expression += '(?:.*/)?' } else expression += '.*'
    } else if (char === '*') expression += '[^/]*'
    else if (char === '?') expression += '[^/]'
    else expression += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${expression}$`, 'i').test(value)
}

function keywordMatches(keyword, task) {
  const term = keyword.toLocaleLowerCase()
  const content = task.toLocaleLowerCase()
  if (/^[a-z0-9_-]+$/.test(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^a-z0-9_])${escaped}($|[^a-z0-9_])`, 'i').test(content)
  }
  return content.includes(term)
}

function recall(root, options) {
  const task = options.task || ''
  const paths = options.path || []
  paths.forEach((item) => relative(item))
  if (!nonempty(task) && !paths.length) fail('recall 需要 --task 或 --path；不会全量注入知识库')
  const limit = options.limit === undefined ? 4 : Number(options.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) fail('--limit 必须为 1 到 10')
  const matches = load(root).filter(({ card }) => card.status !== 'retired').map((entry) => {
    const keywords = entry.card.scope.keywords.filter((keyword) => keywordMatches(keyword, task))
    const matchedPaths = paths.filter((file) => entry.card.scope.paths.some((pattern) => globMatches(pattern, file)))
    return { ...entry, score: keywords.length * 2 + matchedPaths.length * 5, matched: { keywords, paths: matchedPaths } }
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id))
  const usable = []
  const needsReview = []
  const candidates = []
  for (const entry of matches) {
    const warnings = inspect(root, entry.card)
    const result = { id: entry.card.id, title: entry.card.title, path: `${DIRECTORY}/${entry.card.id}.json`, etag: entry.etag, matched: entry.matched }
    if (entry.card.status === 'candidate') candidates.push({ ...result, warnings })
    else if (entry.card.status === 'review_required' || warnings.length) needsReview.push({ ...result, warnings })
    else usable.push({ ...result, card: entry.card })
  }
  // A replacement declaration is a relationship, not permission to hide old rules.
  const related = matches.flatMap(({ card }) => (card.supersedes || []).map((id) => ({ replacement: card.id, previous: id })))
  const active = []
  const deferred = []
  let characters = 0
  for (const item of usable) {
    const size = JSON.stringify(item).length
    if (active.length < limit && characters + size <= 12000) { active.push(item); characters += size }
    else deferred.push({ id: item.id, title: item.title, path: item.path })
  }
  return { active, needs_review: needsReview.slice(0, limit), candidates: candidates.slice(0, limit), related: related.slice(0, 10), deferred: deferred.slice(0, limit), omitted_active: deferred.length, omitted_needs_review: Math.max(0, needsReview.length - limit), omitted_candidates: Math.max(0, candidates.length - limit) }
}

function markdown(result) {
  const lines = ['项目经验检索（证据上下文；不替代当前需求和仓库指令）', '']
  for (const item of result.active) {
    const card = item.card
    lines.push(`### ${card.id} · ${card.title}`, `适用：${card.trigger}`, `结论：${card.lesson}`, `原因：${card.reason}`, `边界：${card.boundaries}`)
    lines.push(`证据：${card.evidence.map((entry) => `${entry.path || '用户明确纠正'} — ${entry.note}`).join('；')}`)
    lines.push(`历史验证记录（不代表本次已执行）：${card.validation.map((entry) => `${entry.kind}/${entry.result} @ ${entry.at || '未执行'}：${entry.detail}`).join('；')}`, `卡片：${item.path}`, '')
  }
  if (!result.active.length) lines.push('无可直接采用的相关知识；正常分析当前代码。', '')
  for (const item of result.needs_review) lines.push(`待复核：${item.id}（${item.path}）${item.warnings.join('；') || '已由反馈标记，读取卡片中的 history 原因'}；核对当前证据后使用。`)
  for (const item of result.candidates) lines.push(`候选：${item.id}（${item.path}）仅作调查线索，不作为已确认约束。`)
  for (const item of result.deferred) lines.push(`未展开：${item.id}（${item.path}）可按需读取完整卡片。`)
  for (const item of result.related) lines.push(`替代关系待核对：${item.replacement} → ${item.previous}；不自动选择胜者或停用旧卡片。`)
  if (result.omitted_active) lines.push(`另有 ${result.omitted_active} 条有效匹配未展开，可按路径缩小检索或调整 --limit。`)
  if (result.omitted_needs_review || result.omitted_candidates) lines.push(`另有 ${result.omitted_needs_review} 条待复核、${result.omitted_candidates} 条候选未展开；可细化任务关键词/路径或调整 --limit。`)
  return lines.join('\n')
}

function parse(argv) {
  const command = argv.shift()
  const options = {}
  const flags = new Set(['json', 'strict', 'help'])
  const known = new Set(['repo', 'task', 'path', 'limit', 'input', 'expected', 'id', 'status', 'kind', 'basis', 'json', 'strict', 'help'])
  while (argv.length) {
    const key = argv.shift()
    if (!key.startsWith('--') || !known.has(key.slice(2))) fail(`未知参数: ${key}`)
    const name = key.slice(2)
    if (flags.has(name)) options[name] = true
    else {
      const value = argv.shift()
      if (value === undefined || value.startsWith('--')) fail(`缺少参数值: ${key}`)
      if (name === 'path') (options.path || (options.path = [])).push(value)
      else if (options[name] !== undefined) fail(`参数重复: ${key}`)
      else options[name] = value
    }
  }
  const allowed = {
    recall: ['repo', 'task', 'path', 'limit', 'json', 'help'],
    capture: ['repo', 'input', 'expected', 'help'],
    review: ['repo', 'id', 'status', 'kind', 'basis', 'expected', 'help'],
    check: ['repo', 'strict', 'help'],
  }
  if (!allowed[command] && !['help', '--help', undefined].includes(command)) fail(`未知命令: ${command}`)
  if (allowed[command]) for (const key of Object.keys(options)) if (!allowed[command].includes(key)) fail(`${command} 不支持 --${key}`)
  return { command, options }
}

function main(argv = process.argv.slice(2)) {
  const { command, options } = parse([...argv])
  if (!command || command === 'help' || command === '--help' || options.help) {
    console.log('knowledge.cjs <recall|capture|review|check> [--repo DIR]\nrecall --task TEXT [--path RELATIVE_FILE] [--limit 4] [--json]\ncapture --input JSON_FILE_OR_- [--expected ETAG]\nreview --id ID --status active|review_required|retired --basis TEXT [--kind user-confirmed|repository-rule|verified-fix] --expected ETAG\ncheck [--strict]\n无网络依赖；不会执行知识卡中的测试或其他命令。')
    return
  }
  const root = rootFrom(options.repo)
  if (command === 'recall') {
    const result = recall(root, options)
    console.log(options.json ? JSON.stringify(result, null, 2) : markdown(result))
  } else if (command === 'capture') {
    if (!options.input) fail('capture 需要 --input <JSON 文件或 ->')
    const raw = options.input === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(options.input, 'utf8')
    if (Buffer.byteLength(raw) > MAX_CARD_BYTES) fail('输入卡片过大')
    const input = JSON.parse(raw)
    if (input.status && input.status !== 'candidate') fail('capture 只能保存 candidate；确认结论后使用 review 激活')
    const previous = options.expected ? load(root).find(({ card }) => card.id === input.id) : null
    if (options.expected && !previous) fail('找不到待更新卡片')
    if (previous && previous.card.status !== 'candidate') fail('capture 只更新候选；先通过 review 标记旧结论，另建替代候选')
    const card = snapshot(root, validate({ ...input, status: 'candidate', created_at: previous ? previous.card.created_at : now(), updated_at: now(), history: previous ? previous.card.history : [] }))
    console.log(JSON.stringify(write(root, card, options.expected || null), null, 2))
  } else if (command === 'review') {
    if (!validId(options.id) || !options.expected || !nonempty(options.basis)) fail('review 需要 --id、--expected 和具体 --basis')
    if (!['active', 'review_required', 'retired'].includes(options.status)) fail('review 的 status 无效')
    const entry = load(root).find(({ card }) => card.id === options.id)
    if (!entry) fail('找不到知识卡')
    let card = JSON.parse(JSON.stringify(entry.card))
    if (options.status === 'active') {
      if (!REVIEW_KINDS.includes(options.kind)) fail('激活需要 --kind 和真实复核依据')
      if (!card.validation.some((item) => item.result === 'passed')) fail('请先补充实际验证记录；脚本不会替你运行验证')
      if (card.valid_until && Date.parse(card.valid_until) < Date.now()) fail('有效期已过，先修正后再激活')
      if (card.status === 'review_required' || inspect(root, card).length) {
        const historyTimes = (card.history || []).map((item) => Date.parse(item.at) || 0)
        const previousReview = Math.max(Date.parse((card.snapshot || {}).at) || 0, Date.parse((card.review || {}).at) || 0, ...historyTimes)
        if (!card.validation.some((item) => item.result === 'passed' && Date.parse(item.at) > previousReview)) fail('需要新验证记录后才能重新激活；不能只刷新旧证据指纹')
      }
      card = snapshot(root, card)
      card.review = { kind: options.kind, basis: options.basis, at: now() }
    }
    card.history = [...(card.history || []), { from: card.status, to: options.status, basis: options.basis, at: now() }]
    card.status = options.status
    card.updated_at = now()
    console.log(JSON.stringify(write(root, card, options.expected), null, 2))
  } else if (command === 'check') {
    const entries = load(root)
    const ids = new Set(entries.map(({ card }) => card.id))
    const issues = []
    for (const { card } of entries) {
      if (card.status === 'retired') continue
      const warnings = inspect(root, card)
      if (card.status === 'review_required') warnings.push('状态为 review_required')
      for (const id of card.supersedes || []) if (!ids.has(id)) warnings.push(`替代目标不存在: ${id}`)
      if (warnings.length) issues.push({ id: card.id, status: card.status, warnings })
    }
    console.log(JSON.stringify({ cards: entries.length, issues, note: '只检查结构、文件指纹和状态；不认证复核者身份，不证明业务正确，不执行验证命令。' }, null, 2))
    if (options.strict && issues.length) process.exitCode = 1
  }
}

if (require.main === module) {
  try { main() } catch (error) { console.error(`knowledge: ${error.message}`); process.exitCode = 1 }
}
module.exports = { validate, recall, inspect, snapshot, write, load, globMatches, keywordMatches, safePath, main }
