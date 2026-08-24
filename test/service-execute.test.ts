import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { db } from '../lib/store/db'
import { getRun } from '../lib/store/runs'
import { redactEnvSnapshot, resumeRun, startRun } from '../lib/service/execute'
import { startMock, type MockHandle } from './mock-server'

let mock: MockHandle
let dir: string

beforeEach(async () => {
  await db.run.deleteMany()
  dir = await mkdtemp(join(tmpdir(), 'groundhog-'))
})

afterEach(async () => {
  await mock?.close()
  await db.run.deleteMany()
})

async function fixtures(steps: unknown[]) {
  await writeFile(join(dir, 'c.json'), JSON.stringify({ name: 'demo', steps }))
  await writeFile(
    join(dir, 'e.json'),
    JSON.stringify({
      name: 'test',
      vars: [
        { key: 'API', value: mock.url },
        { key: 'TOKEN', value: 'tok_secret_value', secret: true },
      ],
    }),
  )
}

const settle = () => new Promise((r) => setTimeout(r, 400))

describe('startRun', () => {
  it('returns an id immediately and finishes the run in the background', async () => {
    mock = await startMock({ 'GET /a': () => ({ body: '{}' }) })
    await fixtures([{ id: 'a', method: 'GET', url: '{{env.API}}/a' }])

    const id = await startRun({
      caseRoot: dir,
      casePath: 'c.json',
      envRoot: dir,
      envPath: 'e.json',
      assetsDir: 'test/assets',
      seed: 'abc',
      anchorAt: new Date('2026-08-20T00:00:00.000Z'),
    })
    expect(await getRun(id)).not.toBeNull()

    await settle()
    const run = await getRun(id)
    expect(run?.status).toBe('passed')
    expect(run?.results.map((s) => s.id)).toEqual(['a'])
  })

  it('stops at a pause, leaving the run awaiting', async () => {
    mock = await startMock({ 'GET /a': () => ({ body: '{}' }) })
    await fixtures([{ id: 'a', method: 'GET', url: '{{env.API}}/a', pause: true }])

    const id = await startRun({
      caseRoot: dir,
      casePath: 'c.json',
      envRoot: dir,
      envPath: 'e.json',
      assetsDir: 'test/assets',
    })
    await settle()
    expect((await getRun(id))?.status).toBe('awaiting')
    expect(mock.hits['GET /a']).toBeUndefined()
  })

  it('marks the run failed when the case cannot pass pre-flight', async () => {
    mock = await startMock({ 'GET /a': () => ({ body: '{}' }) })
    await fixtures([{ id: 'a', method: 'GET', url: '{{env.MISSING}}/a' }])

    const id = await startRun({
      caseRoot: dir,
      casePath: 'c.json',
      envRoot: dir,
      envPath: 'e.json',
      assetsDir: 'test/assets',
    })
    await settle()
    const run = await getRun(id)
    expect(run?.status).toBe('failed')
    expect(JSON.stringify(run?.results)).toContain('MISSING')
  })

  it('stores the env snapshot with secrets masked', async () => {
    mock = await startMock({ 'GET /a': () => ({ body: '{}' }) })
    await fixtures([{ id: 'a', method: 'GET', url: '{{env.API}}/a' }])

    const id = await startRun({
      caseRoot: dir,
      casePath: 'c.json',
      envRoot: dir,
      envPath: 'e.json',
      assetsDir: 'test/assets',
    })
    await settle()
    const run = await getRun(id)
    expect(run?.envSnapshot.vars.TOKEN).toBe('***')
    expect(run?.envSnapshot.vars.API).toBe(mock.url)
  })
})

describe('resumeRun', () => {
  it('continues an awaiting run to completion', async () => {
    mock = await startMock({ 'GET /a': () => ({ body: '{}' }), 'GET /b': () => ({ body: '{}' }) })
    await fixtures([
      { id: 'a', method: 'GET', url: '{{env.API}}/a' },
      { id: 'b', method: 'GET', url: '{{env.API}}/b', pause: true },
    ])
    const id = await startRun({
      caseRoot: dir,
      casePath: 'c.json',
      envRoot: dir,
      envPath: 'e.json',
      assetsDir: 'test/assets',
    })
    await settle()
    expect(await resumeRun(id, 'continue')).toBe(true)
    await settle()
    const run = await getRun(id)
    expect(run?.status).toBe('passed')
    expect(run?.results.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('refuses a second resume of the same run', async () => {
    mock = await startMock({ 'GET /a': () => ({ body: '{}' }) })
    await fixtures([{ id: 'a', method: 'GET', url: '{{env.API}}/a', pause: true }])
    const id = await startRun({
      caseRoot: dir,
      casePath: 'c.json',
      envRoot: dir,
      envPath: 'e.json',
      assetsDir: 'test/assets',
    })
    await settle()
    const first = resumeRun(id, 'continue')
    const second = resumeRun(id, 'continue')
    expect([await first, await second].filter(Boolean)).toHaveLength(1)
  })

  it('refuses to resume a run that never paused', async () => {
    mock = await startMock({ 'GET /a': () => ({ body: '{}' }) })
    await fixtures([{ id: 'a', method: 'GET', url: '{{env.API}}/a' }])
    const id = await startRun({
      caseRoot: dir,
      casePath: 'c.json',
      envRoot: dir,
      envPath: 'e.json',
      assetsDir: 'test/assets',
    })
    await settle()
    expect(await resumeRun(id, 'continue')).toBe(false)
  })
})

describe('redactEnvSnapshot', () => {
  it('masks only the vars marked secret', () => {
    const snap = redactEnvSnapshot({
      name: 'staging',
      vars: [
        { key: 'API', value: 'https://x.test' },
        { key: 'TOKEN', value: 'sk_live_secret', secret: true },
      ],
    })
    expect(snap).toEqual({ name: 'staging', vars: { API: 'https://x.test', TOKEN: '***' } })
  })
})
