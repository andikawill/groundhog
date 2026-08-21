import { afterEach, describe, expect, it } from 'vitest'
import { parseDuration, runCase } from '../lib/engine/run'
import { resolveEnv } from '../lib/engine/preflight'
import { startMock, type MockHandle } from './mock-server'
import type { TestCase } from '../lib/engine/types'

let mock: MockHandle
const ANCHOR = Date.parse('2026-08-20T00:00:00.000Z')

afterEach(async () => {
  await mock?.close()
})

function run(testCase: TestCase, url: string, extra: Partial<Parameters<typeof runCase>[0]> = {}) {
  return runCase({
    case: testCase,
    env: resolveEnv(undefined, { name: 'test', vars: [{ key: 'API', value: url }] }),
    seed: 'retry-seed',
    anchorAt: ANCHOR,
    assetsDir: 'test/assets',
    ...extra,
  })
}

describe('parseDuration', () => {
  it('parses ms, s, and m', () => {
    expect(parseDuration('250ms', 0)).toBe(250)
    expect(parseDuration('3s', 0)).toBe(3000)
    expect(parseDuration('2m', 0)).toBe(120000)
  })

  it('falls back on undefined or garbage', () => {
    expect(parseDuration(undefined, 30000)).toBe(30000)
    expect(parseDuration('soon', 30000)).toBe(30000)
  })
})

describe('retryUntil', () => {
  it('retries until the condition holds and records the attempt count', async () => {
    mock = await startMock({
      'GET /job': (req) => ({ body: JSON.stringify({ data: { status: req.hit < 3 ? 'pending' : 'done' } }) }),
    })
    const result = await run(
      {
        name: 'poll',
        steps: [
          {
            id: 'job',
            method: 'GET',
            url: '{{env.API}}/job',
            retryUntil: '$.data.status == "done"',
            every: '10ms',
            timeout: '2s',
          },
        ],
      },
      mock.url,
    )
    expect(result.steps[0].status).toBe('passed')
    expect(result.steps[0].attempts).toBe(3)
  })

  it('fails the step when the condition never holds before the timeout', async () => {
    mock = await startMock({ 'GET /job': () => ({ body: '{"data":{"status":"pending"}}' }) })
    const result = await run(
      {
        name: 'poll timeout',
        steps: [
          {
            id: 'job',
            method: 'GET',
            url: '{{env.API}}/job',
            retryUntil: '$.data.status == "done"',
            every: '10ms',
            timeout: '400ms',
          },
        ],
      },
      mock.url,
    )
    expect(result.steps[0].status).toBe('failed')
    expect(result.steps[0].attempts).toBeGreaterThan(1)
  })

  it('does not retry a step without retryUntil', async () => {
    mock = await startMock({ 'GET /x': () => ({ status: 500, body: '{}' }) })
    const result = await run(
      {
        name: 'no retry',
        steps: [{ id: 'x', method: 'GET', url: '{{env.API}}/x', assert: [{ expr: 'status == 200' }] }],
      },
      mock.url,
    )
    expect(result.steps[0].attempts).toBe(1)
  })
})

describe('delay', () => {
  it('waits before sending', async () => {
    mock = await startMock({ 'GET /x': () => ({ body: '{}' }) })
    const started = Date.now()
    await run(
      { name: 'delay', steps: [{ id: 'x', method: 'GET', url: '{{env.API}}/x', delay: '60ms' }] },
      mock.url,
    )
    expect(Date.now() - started).toBeGreaterThanOrEqual(55)
  })
})
