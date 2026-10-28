#!/usr/bin/env node
'use strict'

const bootstrap = require('../lib/bootstrap.cjs')

function parse(argv) {
  const command = argv.shift()
  const options = { paths: [] }
  const valueOptions = new Set(['project', 'task', 'path'])
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (['--dry-run', '--adopt-legacy', '--check', '--help'].includes(flag)) options[flag.slice(2)] = true
    else if (flag.startsWith('--') && valueOptions.has(flag.slice(2))) {
      const value = argv[++index]
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value: ${flag}`)
      if (flag === '--path') options.paths.push(value)
      else { const key = flag.slice(2); if (options[key] !== undefined) throw new Error(`Repeated option: ${flag}`); options[key] = value }
    } else throw new Error(`Unknown option: ${flag}`)
  }
  const allowed = {
    init: ['project', 'dry-run', 'adopt-legacy', 'help'],
    update: ['project', 'dry-run', 'help'],
    status: ['project', 'check', 'help'],
    use: ['project', 'task', 'paths', 'adopt-legacy', 'help'],
  }
  if (!allowed[command] && command !== '--help' && command !== 'help' && command !== undefined) throw new Error(`Unknown command: ${command}`)
  if (allowed[command]) for (const key of Object.keys(options)) {
    if (key === 'paths' && !options.paths.length) continue
    if (!allowed[command].includes(key)) throw new Error(`${command} does not support --${key}`)
  }
  return { command, options }
}

try {
  const { command, options } = parse(process.argv.slice(2))
  if (!command || command === 'help' || command === '--help' || options.help) {
    console.log('knowledge-flywheel-kit (A → B)\n\nuse [--project B] --task TEXT [--path RELATIVE_FILE]\n  First use initializes B, then recalls B\'s own knowledge.\ninit [--project B] [--dry-run] [--adopt-legacy]\nupdate [--project B] [--dry-run]\nstatus [--project B] [--check]\n\nProject defaults to the Git root of the current directory. No network or model API required.')
  } else {
    const root = bootstrap.projectRoot(options.project)
    let result
    if (command === 'status') result = bootstrap.status(root)
    else if (command === 'use') result = bootstrap.use(root, { task: options.task, paths: options.paths, adoptLegacy: options['adopt-legacy'] })
    else result = bootstrap.apply(root, { command, dryRun: options['dry-run'], adoptLegacy: options['adopt-legacy'] })
    console.log(JSON.stringify(result, null, 2))
    if (command === 'status' && options.check && (!result.installed || result.drift.length)) process.exitCode = 1
  }
} catch (error) { console.error(`knowledge-flywheel-kit: ${error.message}`); process.exitCode = 1 }
