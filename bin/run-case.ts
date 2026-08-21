import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createInterface } from 'node:readline/promises'
import { PreflightError, resolveEnv, runCase } from '../lib/engine/index'
import type { EnvDef, RunStep, TestCase } from '../lib/engine/index'

const { values } = parseArgs({
  options: {
    case: { type: 'string' },
    env: { type: 'string' },
    shared: { type: 'string' },
    seed: { type: 'string' },
    anchor: { type: 'string' },
    assets: { type: 'string', default: 'assets' },
    yes: { type: 'boolean', default: false },
  },
})

if (!values.case || !values.env) {
  console.error('usage: npm run run-case -- --case <file> --env <file> [--shared <file>] [--seed <hex>] [--anchor <iso>] [--assets <dir>] [--yes]')
  process.exit(2)
}

const fail = (message: string): never => {
  console.error(message)
  process.exit(2)
}

const read = <T>(path: string, what: string): T => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (error) {
    return fail(`cannot read ${what} "${path}": ${(error as Error).message}`)
  }
}

const testCase = read<TestCase>(values.case, 'case file')
const active = read<EnvDef>(values.env, 'env file')
const shared = values.shared ? read<EnvDef>(values.shared, 'shared env file') : undefined

const seed = values.seed ?? Math.floor(Math.random() * 0xffffffff).toString(16)
const anchorAt = values.anchor ? Date.parse(values.anchor) : Date.now()
if (Number.isNaN(anchorAt)) {
  fail(`--anchor "${values.anchor}" is not a date this can parse; use an ISO timestamp`)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })

try {
  const common = {
    case: testCase,
    env: resolveEnv(shared, active),
    seed,
    anchorAt,
    assetsDir: values.assets!,
    confirmed: values.yes,
    onStep: (step: RunStep) => {
      const mark = step.status === 'passed' ? 'ok  ' : step.status === 'failed' ? 'FAIL' : 'skip'
      const failed = step.asserts.filter((a) => !a.ok)
      console.log(`${mark} ${step.id} (${step.durationMs}ms, ${step.attempts} attempt(s))`)
      for (const item of failed) console.log(`       ${item.expr} — ${item.detail ?? ''}`)
      if (step.reason) console.log(`       ${step.reason}`)
    },
  }

  let result = await runCase(common)

  while (result.status === 'awaiting') {
    const stepId = result.stepsSnapshot[result.state!.stepIndex].id
    const answer = await rl.question(`paused at "${stepId}" — [c]ontinue or [s]kip? `)
    result = await runCase({
      ...common,
      resumeFrom: {
        state: result.state!,
        steps: result.steps,
        decision: answer.trim().toLowerCase().startsWith('s') ? 'skip' : 'continue',
      },
    })
  }

  console.log(`\n${result.status} — seed ${result.seed} anchor ${new Date(result.anchorAt).toISOString()}`)
  console.log('replay: add --seed ' + result.seed + ' --anchor ' + new Date(result.anchorAt).toISOString())
  process.exitCode = result.status === 'passed' ? 0 : 1
} catch (error) {
  if (error instanceof PreflightError) {
    console.error(error.message)
    process.exitCode = 2
  } else {
    throw error
  }
} finally {
  rl.close()
}
