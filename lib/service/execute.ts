import { PreflightError, resolveEnv, runCase } from '../engine/index'
import type { EnvDef, RunResult, RunState, RunStep } from '../engine/index'
import { readCaseFile, readEnvFile } from './files'
import {
  appendStep,
  claimResume,
  createRun,
  finishRun,
  markOrphansInterrupted,
  pauseRun,
} from '../store/runs'
import type { CaseSnapshot, EnvSnapshot } from '../store/runs'

export function redactEnvSnapshot(env: EnvDef): EnvSnapshot {
  const vars: Record<string, string> = {}
  for (const item of env.vars) vars[item.key] = item.secret ? '***' : item.value
  return { name: env.name, vars }
}

export const settleOrphans = markOrphansInterrupted

// onStep is synchronous, so the write is fired rather than awaited — and a fired promise
// that rejects is an unhandled rejection, which in Node takes the whole server down. A run
// deleted or already finished while its last step was in flight is the ordinary case, and
// losing that step from the record is worth less than the process.
async function record(id: string, step: RunStep): Promise<void> {
  try {
    await appendStep(id, step)
  } catch (error) {
    console.error(`groundhog: dropped step "${step.id}" of run ${id}:`, error)
  }
}

async function drive(id: string, options: Parameters<typeof runCase>[0]): Promise<void> {
  let result: RunResult
  try {
    result = await runCase({ ...options, onStep: (step) => void record(id, step) })
  } catch (error) {
    const reason = error instanceof PreflightError ? error.errors.join('; ') : String(error)
    await appendStep(id, {
      id: 'preflight',
      status: 'failed',
      reason,
      asserts: [],
      attempts: 0,
      durationMs: 0,
    })
    await finishRun(id, 'failed')
    return
  }

  if (result.status === 'awaiting' && result.state) {
    await pauseRun(id, result.state)
    return
  }
  await finishRun(id, result.status === 'passed' ? 'passed' : 'failed')
}

// The last handler on a detached promise. It may not throw: there is no further catch, so a
// rejection here is the unhandled rejection that kills the process.
async function failDetached(id: string, error: unknown): Promise<void> {
  await record(id, {
    id: 'engine',
    status: 'failed',
    reason: error instanceof Error ? error.message : String(error),
    asserts: [],
    attempts: 0,
    durationMs: 0,
  })
  try {
    await finishRun(id, 'failed')
  } catch (cause) {
    console.error(`groundhog: could not fail run ${id}:`, cause)
  }
}

export async function startRun(input: {
  caseRoot: string
  casePath: string
  envRoot: string
  envPath: string
  sharedPath?: string
  assetsDir: string
  seed?: string
  anchorAt?: Date
  confirmed?: boolean
}): Promise<string> {
  const testCase = await readCaseFile(input.caseRoot, input.casePath)
  const active = await readEnvFile(input.envRoot, input.envPath)
  const shared = input.sharedPath ? await readEnvFile(input.envRoot, input.sharedPath) : undefined

  const seed = input.seed ?? Math.floor(Math.random() * 0xffffffff).toString(16)
  const anchorAt = input.anchorAt ?? new Date()

  const caseSnapshot: CaseSnapshot = {
    steps: testCase.steps,
    pools: testCase.pools,
    redact: testCase.redact,
  }

  const id = await createRun({
    caseName: testCase.name,
    caseRoot: input.caseRoot,
    casePath: input.casePath,
    envName: active.name,
    envRoot: input.envRoot,
    envPath: input.envPath,
    sharedPath: input.sharedPath ?? null,
    assetsDir: input.assetsDir,
    seed,
    anchorAt,
    caseSnapshot,
    envSnapshot: redactEnvSnapshot(active),
  })

  void drive(id, {
    case: testCase,
    env: resolveEnv(shared, active),
    seed,
    anchorAt: anchorAt.getTime(),
    assetsDir: input.assetsDir,
    confirmed: input.confirmed,
  }).catch((error: unknown) => failDetached(id, error))

  return id
}

export async function resumeRun(id: string, decision: 'continue' | 'skip'): Promise<boolean> {
  const claimed = await claimResume(id)
  if (!claimed) return false

  const active = await readEnvFile(claimed.envRoot, claimed.envPath)
  const shared = claimed.sharedPath
    ? await readEnvFile(claimed.envRoot, claimed.sharedPath)
    : undefined

  void drive(id, {
    case: {
      name: claimed.caseName,
      steps: claimed.caseSnapshot.steps,
      pools: claimed.caseSnapshot.pools,
      redact: claimed.caseSnapshot.redact,
    },
    env: resolveEnv(shared, active),
    seed: claimed.seed,
    anchorAt: claimed.anchorAt.getTime(),
    assetsDir: claimed.assetsDir,
    resumeFrom: { state: claimed.state as RunState, steps: claimed.steps as RunStep[], decision },
  }).catch((error: unknown) => failDetached(id, error))

  return true
}
