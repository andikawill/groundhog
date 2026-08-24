import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../lib/store/db'
import {
  appendStep,
  claimResume,
  createRun,
  finishRun,
  getRun,
  listRuns,
  markOrphansInterrupted,
  pauseRun,
} from '../lib/store/runs'
import type { RunStep } from '../lib/engine/index'

const CASE = { steps: [{ id: 'a', method: 'GET' as const, url: 'https://x.test/a' }] }
const ENV = { name: 'test', vars: { API: 'https://x.test' } }

function newRun() {
  return createRun({
    caseName: 'demo',
    caseRoot: 'examples',
    casePath: 'food-journal.case.json',
    envName: 'test',
    envRoot: 'examples',
    envPath: 'examples/staging.env.json',
    sharedPath: null,
    assetsDir: 'test/assets',
    seed: 'abc123',
    anchorAt: new Date('2026-08-20T00:00:00.000Z'),
    caseSnapshot: CASE,
    envSnapshot: ENV,
  })
}

const step = (id: string, status: RunStep['status'] = 'passed'): RunStep => ({
  id,
  status,
  asserts: [],
  attempts: 1,
  durationMs: 5,
})

beforeEach(async () => {
  await db.run.deleteMany()
})

afterEach(async () => {
  await db.run.deleteMany()
})

describe('createRun and getRun', () => {
  it('starts a run in the running state with no steps', async () => {
    const id = await newRun()
    const run = await getRun(id)
    expect(run?.status).toBe('running')
    expect(run?.results).toEqual([])
    expect(run?.caseSnapshot.steps[0].id).toBe('a')
  })

  it('returns null for an id that does not exist', async () => {
    expect(await getRun('nope')).toBeNull()
  })

  it('never exposes pauseState on a stored run', async () => {
    const id = await newRun()
    await pauseRun(id, { stepIndex: 0, ctx: { token: 'sk_live_secret' }, memo: {}, rngState: 1 })
    const run = await getRun(id)
    expect(JSON.stringify(run)).not.toContain('sk_live_secret')
  })
})

describe('appendStep', () => {
  it('appends in order', async () => {
    const id = await newRun()
    await appendStep(id, step('a'))
    await appendStep(id, step('b'))
    expect((await getRun(id))?.results.map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('finishRun', () => {
  it('records the terminal status and an end time', async () => {
    const id = await newRun()
    await finishRun(id, 'failed')
    const run = await getRun(id)
    expect(run?.status).toBe('failed')
    expect(run?.endedAt).not.toBeNull()
  })

  it('clears pauseState so a finished run holds no secret', async () => {
    const id = await newRun()
    await pauseRun(id, { stepIndex: 0, ctx: { token: 'sk_live_secret' }, memo: {}, rngState: 1 })
    await finishRun(id, 'passed')
    const raw = await db.run.findUnique({ where: { id } })
    expect(raw?.pauseState).toBeNull()
  })
})

describe('claimResume', () => {
  it('returns the state once and flips the run to running', async () => {
    const id = await newRun()
    await appendStep(id, step('a'))
    await pauseRun(id, { stepIndex: 1, ctx: { t: 'x' }, memo: { 'auto.email': 'a@b.c' }, rngState: 42 })

    const claimed = await claimResume(id)
    expect(claimed?.state.rngState).toBe(42)
    expect(claimed?.state.stepIndex).toBe(1)
    expect(claimed?.steps.map((s) => s.id)).toEqual(['a'])
    expect(claimed?.envPath).toBe('examples/staging.env.json')
    expect((await getRun(id))?.status).toBe('running')
  })

  it('refuses a second claim, so two tabs cannot resume the same run', async () => {
    const id = await newRun()
    await pauseRun(id, { stepIndex: 0, ctx: {}, memo: {}, rngState: 1 })
    expect(await claimResume(id)).not.toBeNull()
    expect(await claimResume(id)).toBeNull()
  })

  it('refuses to claim a run that is not awaiting', async () => {
    const id = await newRun()
    expect(await claimResume(id)).toBeNull()
  })

  it('clears pauseState when it hands the state over', async () => {
    const id = await newRun()
    await pauseRun(id, { stepIndex: 0, ctx: { token: 'sk_live_secret' }, memo: {}, rngState: 1 })
    await claimResume(id)
    const raw = await db.run.findUnique({ where: { id } })
    expect(raw?.pauseState).toBeNull()
  })
})

describe('listRuns', () => {
  it('returns the newest run first', async () => {
    const first = await newRun()
    const second = await newRun()
    expect((await listRuns()).map((r) => r.id)).toEqual([second, first])
  })

  it('honours the limit', async () => {
    await newRun()
    await newRun()
    expect(await listRuns(1)).toHaveLength(1)
  })

  it('reports the status a run is in', async () => {
    const id = await newRun()
    await finishRun(id, 'failed')
    expect((await listRuns())[0]?.status).toBe('failed')
  })

  it('carries neither pauseState nor the step bodies', async () => {
    const id = await newRun()
    await appendStep(id, step('a'))
    await pauseRun(id, { stepIndex: 0, ctx: { token: 'sk_live_secret' }, memo: {}, rngState: 1 })
    const listed = JSON.stringify(await listRuns())
    expect(listed).not.toContain('sk_live_secret')
    expect(listed).not.toContain('asserts')
  })

  it('returns an empty list when nothing has run', async () => {
    expect(await listRuns()).toEqual([])
  })
})

describe('markOrphansInterrupted', () => {
  it('interrupts a running run and leaves an awaiting one alone', async () => {
    const running = await newRun()
    const waiting = await newRun()
    await pauseRun(waiting, { stepIndex: 0, ctx: {}, memo: {}, rngState: 1 })

    expect(await markOrphansInterrupted()).toBe(1)
    expect((await getRun(running))?.status).toBe('interrupted')
    expect((await getRun(waiting))?.status).toBe('awaiting')
  })

  it('clears the pauseState of nothing it did not touch', async () => {
    const waiting = await newRun()
    await pauseRun(waiting, { stepIndex: 0, ctx: { token: 'sk_live_secret' }, memo: {}, rngState: 1 })
    await markOrphansInterrupted()
    const raw = await db.run.findUnique({ where: { id: waiting } })
    expect(raw?.pauseState).not.toBeNull()
  })
})
