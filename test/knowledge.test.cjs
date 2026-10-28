'use strict'

// Isolated integration tests for observable data and workflow behavior, Node 16+.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')
const { globMatches, keywordMatches } = require('../templates/skill/scripts/knowledge.cjs')
const cli = path.join(__dirname, '..', 'templates/skill/scripts/knowledge.cjs')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-flywheel-test-'))
const repo = path.join(root, 'repo')
fs.mkdirSync(repo)
execFileSync('git', ['init', repo], { stdio: 'ignore' })
fs.mkdirSync(path.join(repo, 'src'))
fs.writeFileSync(path.join(repo, 'src/rules.ts'), 'export const allowed = [4, 8]\n')
const cards = path.join(repo, 'docs/knowledge/cards')
const file = (id) => path.join(cards, `${id}.json`)
let count = 0

function run(args, input) {
  const result = spawnSync(process.execPath, [cli, ...args, '--repo', repo], { input: input && JSON.stringify(input), encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' }
}
function ok(args, input) {
  const result = run(args, input)
  assert.strictEqual(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}
function rejected(args, input) {
  const result = run(args, input)
  assert.notStrictEqual(result.status, 0, result.stdout)
  return result
}
function candidate(id, overrides = {}) {
  return {
    schema_version: 1, id, title: '克隆来源约束', status: 'candidate',
    scope: { paths: ['src/**/*.ts'], keywords: ['克隆', 'clone'] },
    trigger: '修改克隆来源判断时', lesson: '4 和 8 放行，7 拦截',
    reason: '已明确的接口来源语义', boundaries: '只涉及本项目当前克隆入口',
    evidence: [{ path: 'src/rules.ts', note: '当前项目源码中的来源规则' }], validation: [],
    ...overrides,
  }
}
function capture(card, expected) { return ok(['capture', '--input', '-', ...(expected ? ['--expected', expected] : [])], card) }
function activate(id) {
  const card = JSON.parse(fs.readFileSync(file(id), 'utf8'))
  const etag = require('crypto').createHash('sha256').update(fs.readFileSync(file(id))).digest('hex')
  card.validation = [{ kind: 'source-review', result: 'passed', detail: '核对 src/rules.ts 中的现行来源定义；未运行业务测试', at: new Date().toISOString() }]
  const updated = capture(card, etag)
  return ok(['review', '--id', id, '--status', 'active', '--kind', 'repository-rule', '--basis', '已核对仓库现行规则及适用范围', '--expected', updated.etag])
}
function recall() { return ok(['recall', '--task', '修改克隆判断', '--json']) }
function test(name, body) {
  body()
  count += 1
  console.log(`PASS ${name}`)
}

try {
  test('关键词支持中文与英文词边界，路径 ** 可匹配零层目录', () => {
    assert(keywordMatches('克隆', '修改克隆判断'))
    assert(keywordMatches('clone', 'fix clone request'))
    assert(!keywordMatches('api', 'capital'))
    assert(globMatches('src/**/*.ts', 'src/index.ts'))
    assert(globMatches('src/**/*.ts', 'src/a/b/index.ts'))
    assert(!globMatches('src/*.ts', 'src/a/index.ts'))
  })
  test('空知识库与未命中不生成数据', () => {
    assert.strictEqual(recall().active.length, 0)
    assert(!fs.existsSync(cards))
    rejected(['recall'])
  })
  test('候选会记录证据指纹，但不会把未确认结论注入任务', () => {
    capture(candidate('clone-channel'))
    const result = recall()
    assert.strictEqual(result.active.length, 0)
    assert.strictEqual(result.candidates[0].id, 'clone-channel')
    assert(!run(['recall', '--task', '克隆']).stdout.includes('4 和 8 放行'))
    assert.match(JSON.parse(fs.readFileSync(file('clone-channel'))).evidence[0].sha256, /^[a-f0-9]{64}$/)
  })
  test('无实际验证不能激活，也不执行存储命令', () => {
    const current = recall().candidates[0]
    rejected(['review', '--id', current.id, '--status', 'active', '--kind', 'verified-fix', '--basis', '尚未验证', '--expected', current.etag])
    assert.strictEqual(recall().active.length, 0)
  })
  test('复核后可由另一命令进程读取，recall 只读且区分历史验证', () => {
    activate('clone-channel')
    const before = fs.readFileSync(file('clone-channel'), 'utf8')
    assert.strictEqual(recall().active[0].id, 'clone-channel')
    assert(run(['recall', '--task', '克隆']).stdout.includes('历史验证记录'))
    assert.strictEqual(fs.readFileSync(file('clone-channel'), 'utf8'), before)
  })
  test('重复 ID 不覆盖，capture 不能重写 active 或绕过候选阶段', () => {
    const before = fs.readFileSync(file('clone-channel'), 'utf8')
    rejected(['capture', '--input', '-'], candidate('clone-channel'))
    rejected(['capture', '--input', '-'], candidate('sneaky-active', { status: 'active' }))
    const active = recall().active[0]
    rejected(['capture', '--input', '-', '--expected', active.etag], candidate(active.id))
    assert.strictEqual(fs.readFileSync(file('clone-channel'), 'utf8'), before)
  })
  test('源文件变化只提示复核，不继续注入旧结论或静默改状态', () => {
    fs.writeFileSync(path.join(repo, 'src/rules.ts'), 'export const allowed = [4, 8, 9]\n')
    const result = recall()
    assert.strictEqual(result.active.length, 0)
    assert(result.needs_review[0].warnings.some((warning) => warning.includes('内容变化')))
    assert.strictEqual(JSON.parse(fs.readFileSync(file('clone-channel'))).status, 'active')
    assert.strictEqual(run(['check']).status, 0)
    assert.notStrictEqual(run(['check', '--strict']).status, 0)
    fs.writeFileSync(path.join(repo, 'src/rules.ts'), 'export const allowed = [4, 8]\n')
    assert.strictEqual(recall().active.length, 1)
  })
  test('无关文件变化不使知识失效', () => {
    fs.writeFileSync(path.join(repo, 'src/unrelated.ts'), 'unrelated')
    assert.strictEqual(recall().active.length, 1)
  })
  test('新候选不能通过 supersedes 自动压过或退役现行规则', () => {
    capture(candidate('new-channel', { lesson: '另一条待确认的解释', supersedes: ['clone-channel'] }))
    const result = recall()
    assert(result.active.some((item) => item.id === 'clone-channel'))
    assert(result.candidates.some((item) => item.id === 'new-channel'))
    assert.deepStrictEqual(result.related, [{ replacement: 'new-channel', previous: 'clone-channel' }])
  })
  test('候选更新需最新 etag，旧版本不会覆盖并发修改', () => {
    const current = recall().candidates.find((item) => item.id === 'new-channel')
    const card = JSON.parse(fs.readFileSync(file(current.id)))
    const updated = capture({ ...card, lesson: '已经合并的新内容' }, current.etag)
    assert.notStrictEqual(updated.etag, current.etag)
    rejected(['capture', '--input', '-', '--expected', current.etag], { ...card, lesson: '过时写入' })
    assert.strictEqual(JSON.parse(fs.readFileSync(file(current.id))).lesson, '已经合并的新内容')
  })
  test('显式反馈进入待复核；退役后不再召回', () => {
    const current = recall().active[0]
    const pending = ok(['review', '--id', current.id, '--status', 'review_required', '--basis', '发现协议矛盾', '--expected', current.etag])
    assert.strictEqual(recall().active.length, 0)
    assert(recall().needs_review.some((item) => item.id === current.id))
    ok(['review', '--id', current.id, '--status', 'retired', '--basis', '已确认旧接口废弃', '--expected', pending.etag])
    assert(!JSON.stringify(recall().needs_review).includes(current.id))
  })
  test('超过有效期的 active 需要复核', () => {
    capture(candidate('expired-rule'))
    activate('expired-rule')
    const card = JSON.parse(fs.readFileSync(file('expired-rule')))
    card.valid_until = '2000-01-01T00:00:00.000Z'
    fs.writeFileSync(file(card.id), JSON.stringify(card))
    assert(recall().needs_review.some((item) => item.id === card.id))
    assert(!recall().active.some((item) => item.id === card.id))
  })
  test('没有文件的用户明确纠正可以留作候选，不伪造代码证据', () => {
    capture(candidate('user-correction', { evidence: [{ kind: 'user-correction', note: '用户确认：此来源仅限当前项目克隆入口' }] }))
    assert(recall().candidates.some((item) => item.id === 'user-correction'))
  })
  test('指向外部文件、路径穿越和恶意 ID 均拒绝', () => {
    fs.writeFileSync(path.join(root, 'outside.txt'), 'do not read')
    fs.symlinkSync(path.join(root, 'outside.txt'), path.join(repo, 'src/external.txt'))
    rejected(['capture', '--input', '-'], candidate('escape', { evidence: [{ path: '../outside.txt', note: '外部' }] }))
    rejected(['capture', '--input', '-'], candidate('symlink', { evidence: [{ path: 'src/external.txt', note: '外部软链' }] }))
    rejected(['capture', '--input', '-'], candidate('../escape'))
    assert(!fs.existsSync(file('symlink')))
    assert.strictEqual(fs.readFileSync(path.join(root, 'outside.txt'), 'utf8'), 'do not read')
  })
  test('缺失证据拒绝保存；已经保存的证据缺失则提示复核', () => {
    rejected(['capture', '--input', '-'], candidate('missing', { evidence: [{ path: 'src/not-found.ts', note: '不存在' }] }))
    capture(candidate('missing-later'))
    activate('missing-later')
    fs.renameSync(path.join(repo, 'src/rules.ts'), path.join(repo, 'src/renamed.ts'))
    assert(recall().needs_review.some((item) => item.id === 'missing-later'))
    fs.renameSync(path.join(repo, 'src/renamed.ts'), path.join(repo, 'src/rules.ts'))
  })
  test('检索数量和正文预算受限，大卡片保留完整读取入口', () => {
    capture(candidate('large-card', { lesson: 'x'.repeat(14000) }))
    activate('large-card')
    const result = recall()
    assert(result.deferred.some((item) => item.id === 'large-card'))
    assert(JSON.stringify(result.active).length < 12500)
    const one = ok(['recall', '--task', '克隆', '--limit', '1', '--json'])
    assert(one.active.length <= 1)
    rejected(['recall', '--task', '克隆', '--limit', '0'])
  })
  test('本地写锁阻止两个进程覆盖同一卡片', () => {
    const current = recall().active.find((item) => item.id === 'missing-later')
    fs.writeFileSync(`${file(current.id)}.lock`, '')
    rejected(['review', '--id', current.id, '--status', 'retired', '--basis', '模拟并发', '--expected', current.etag])
    fs.unlinkSync(`${file(current.id)}.lock`)
    assert.strictEqual(JSON.parse(fs.readFileSync(file(current.id))).status, 'active')
  })
  test('从仓库子目录执行也找到同一份共享知识', () => {
    const result = spawnSync(process.execPath, [cli, 'recall', '--task', '克隆', '--json'], { cwd: path.join(repo, 'src'), encoding: 'utf8' })
    assert.strictEqual(result.status, 0, result.stderr)
    assert(JSON.parse(result.stdout).active.some((item) => item.id === 'missing-later'))
  })
  test('未定义参数与错误结构会显式失败', () => {
    rejected(['recall', '--task', '克隆', '--force'])
    rejected(['capture', '--task', '克隆'])
    rejected(['capture', '--input', '-'], candidate('bad-validation', { validation: [{ kind: 'test', result: 'passed', detail: '缺少时间和命令' }] }))
  })
  test('保存和复核不会执行知识卡中的命令', () => {
    const sentinel = path.join(root, 'stored-command-must-not-run')
    const card = candidate('command-as-data', { validation: [{ kind: 'test', result: 'passed', detail: '隔离测试数据；检查脚本不会执行该命令', at: new Date().toISOString(), command: `touch ${sentinel}` }] })
    const saved = capture(card)
    ok(['review', '--id', saved.id, '--status', 'active', '--kind', 'verified-fix', '--basis', '隔离测试中的明确复核动作', '--expected', saved.etag])
    assert(!fs.existsSync(sentinel))
    recall()
    ok(['check'])
    assert(!fs.existsSync(sentinel))
  })
  test('知识目录本身不能通过软链写到仓库以外', () => {
    const other = path.join(root, 'other-repo')
    const outside = path.join(root, 'outside-cards')
    fs.mkdirSync(other)
    fs.mkdirSync(outside)
    execFileSync('git', ['init', other], { stdio: 'ignore' })
    fs.mkdirSync(path.join(other, 'docs/knowledge'), { recursive: true })
    fs.symlinkSync(outside, path.join(other, 'docs/knowledge/cards'))
    const result = spawnSync(process.execPath, [cli, 'capture', '--input', '-', '--repo', other], { input: JSON.stringify(candidate('cannot-escape', { evidence: [{ kind: 'user-correction', note: '用户确认过的最小摘要' }] })), encoding: 'utf8' })
    assert.notStrictEqual(result.status, 0)
    assert.deepStrictEqual(fs.readdirSync(outside), [])
  })
  test('过期来源不能只刷新指纹重新激活，需要新的验证记录', () => {
    capture(candidate('reverify-rule', { scope: { paths: ['src/rules.ts'], keywords: ['重新验证来源'] } }))
    activate('reverify-rule')
    fs.appendFileSync(path.join(repo, 'src/rules.ts'), '// changed after previous verification\n')
    const entry = ok(['recall', '--task', '重新验证来源', '--json']).needs_review[0]
    const args = ['review', '--id', entry.id, '--status', 'active', '--kind', 'repository-rule', '--basis', '重新核对当前源码']
    rejected([...args, '--expected', entry.etag])
    const card = JSON.parse(fs.readFileSync(file(entry.id)))
    card.validation.push({ kind: 'source-review', result: 'passed', detail: '本次已重新核对来源：新增注释不改变来源规则', at: new Date().toISOString() })
    fs.writeFileSync(file(card.id), JSON.stringify(card))
    const etag = require('crypto').createHash('sha256').update(fs.readFileSync(file(card.id))).digest('hex')
    ok([...args, '--expected', etag])
    assert(ok(['recall', '--task', '重新验证来源', '--json']).active.some((item) => item.id === card.id))
  })
  console.log(`\n${count} integration scenarios passed; all files isolated in a temporary repository.`)
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
