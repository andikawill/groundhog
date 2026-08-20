import { evalExpr, readRef, type EvalTarget } from './assert'
import { StepDeclarationError, buildRequest, send, traceOf } from './http'
import { preflight, type ResolvedEnv } from './preflight'
import { makeRedactor, redactRequest, redactResponse } from './redact'
import { MissingRefError, makeResolver } from './template'
import type { AssertResult, RawResponse, RunStep, Step, StepStatus, TestCase } from './types'

export class PreflightError extends Error {
  constructor(readonly errors: string[]) {
    super(`preflight failed:\n- ${errors.join('\n- ')}`)
    this.name = 'PreflightError'
  }
}

export type RunOptions = {
  case: TestCase
  env: ResolvedEnv
  seed: string
  anchorAt: number
  assetsDir: string
  confirmed?: boolean
  onStep?: (step: RunStep) => void
  onPause?: (stepId: string) => Promise<'continue' | 'skip'>
}

export type RunResult = {
  status: 'passed' | 'failed'
  steps: RunStep[]
  stepsSnapshot: Step[]
  seed: string
  anchorAt: number
}

export function parseDuration(input: string | undefined, fallbackMs: number): number {
  if (!input) return fallbackMs
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)$/.exec(input.trim())
  if (!match) return fallbackMs
  const value = Number(match[1])
  return match[2] === 'ms' ? value : match[2] === 's' ? value * 1000 : value * 60000
}

function targetOf(response: { status: number; headers: Record<string, string>; text: string }): EvalTarget {
  let json: unknown
  try {
    json = response.text === '' ? undefined : JSON.parse(response.text)
  } catch {
    json = undefined
  }
  return { status: response.status, headers: response.headers, json, text: response.text }
}

export async function runCase(options: RunOptions): Promise<RunResult> {
  const errors = preflight({
    case: options.case,
    env: options.env,
    confirmed: options.confirmed,
  })
  if (errors.length > 0) throw new PreflightError(errors)

  const snapshot: Step[] = structuredClone(options.case.steps)
  const resolver = makeResolver({
    env: options.env.vars,
    seed: options.seed,
    assetsDir: options.assetsDir,
    nowMs: options.anchorAt,
  })

  const secretValues = [...options.env.secrets]
  const statusById = new Map<string, StepStatus>()
  const steps: RunStep[] = []

  const finish = (step: RunStep) => {
    statusById.set(step.id, step.status)
    steps.push(step)
    options.onStep?.(step)
  }

  for (const step of snapshot) {
    const startedAt = Date.now()
    const base = { id: step.id, title: step.title, asserts: [] as AssertResult[], attempts: 0 }

    const blockedBy = (step.needs ?? []).filter((id) => statusById.get(id) !== 'passed')
    if (blockedBy.length > 0 && !step.always) {
      finish({
        ...base,
        status: 'skipped',
        reason: `depends on ${blockedBy.join(', ')}`,
        durationMs: 0,
      })
      continue
    }

    if (step.delay) await new Promise((r) => setTimeout(r, parseDuration(step.delay, 0)))

    if (step.pause && options.onPause) {
      const decision = await options.onPause(step.id)
      if (decision === 'skip') {
        finish({ ...base, status: 'skipped', reason: 'skipped by user', durationMs: 0 })
        continue
      }
    }

    let request
    try {
      request = buildRequest(step, resolver)
    } catch (error) {
      if (error instanceof MissingRefError) {
        finish({
          ...base,
          status: 'skipped',
          reason: `unresolved ${error.ref}`,
          durationMs: Date.now() - startedAt,
        })
        continue
      }
      if (error instanceof StepDeclarationError) {
        finish({
          ...base,
          status: 'failed',
          reason: error.message,
          durationMs: Date.now() - startedAt,
        })
        continue
      }
      throw error
    }

    const timeoutMs = parseDuration(step.timeout, 30000)
    const everyMs = parseDuration(step.every, 2000)
    const deadline = startedAt + timeoutMs
    let attempts = 0

    const attempt = async (): Promise<RawResponse | Error> => {
      attempts += 1
      const remaining = Math.max(1, deadline - Date.now())
      try {
        return await send(request, Math.min(timeoutMs, remaining))
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error))
      }
    }

    let outcome = await attempt()

    while (step.retryUntil && !(outcome instanceof Error)) {
      if (evalExpr(step.retryUntil, targetOf(outcome), resolver).ok) break
      if (Date.now() + everyMs >= deadline) break
      await new Promise((r) => setTimeout(r, everyMs))
      outcome = await attempt()
    }

    if (outcome instanceof Error) {
      finish({
        ...base,
        status: 'failed',
        reason: outcome.message,
        request: redactRequest(request, makeRedactor(secretValues)),
        attempts,
        durationMs: Date.now() - startedAt,
      })
      continue
    }

    const response = outcome

    const target = targetOf(response)
    const asserts: AssertResult[] = []

    for (const [name, selector] of Object.entries(step.extract ?? {})) {
      const value = readRef(selector, target)
      if (value === undefined) {
        asserts.push({ expr: `extract ${name}`, ok: false, detail: `${selector} is undefined` })
        continue
      }
      resolver.ctx[name] = value
      if ((options.case.redact ?? []).includes(name)) secretValues.push(String(value))
    }

    if (step.retryUntil) {
      asserts.push(evalExpr(step.retryUntil, target, resolver))
    }

    for (const item of step.assert ?? []) {
      if ('expr' in item) asserts.push(evalExpr(item.expr, target, resolver))
    }

    // Built here rather than reused from the error branch above: extract may have just
    // added a secret named in case.redact, and it has to mask this step's own response.
    const redact = makeRedactor(secretValues)
    finish({
      ...base,
      status: asserts.every((a) => a.ok) ? 'passed' : 'failed',
      request: redactRequest(request, redact),
      response: redactResponse(
        { status: response.status, headers: response.headers, text: response.text, truncated: response.truncated },
        redact,
      ),
      asserts,
      attempts,
      trace: traceOf(response.headers),
      durationMs: Date.now() - startedAt,
    })
  }

  return {
    status: steps.some((s) => s.status === 'failed') ? 'failed' : 'passed',
    steps,
    stepsSnapshot: snapshot,
    seed: options.seed,
    anchorAt: options.anchorAt,
  }
}
