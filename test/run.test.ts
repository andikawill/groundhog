import { afterEach, describe, expect, it } from 'vitest'
import { PreflightError, runCase } from '../lib/engine/run'
import { resolveEnv } from '../lib/engine/preflight'
import { startMock, type MockHandle } from './mock-server'
import type { TestCase } from '../lib/engine/types'

let mock: MockHandle
const ANCHOR = Date.parse('2026-08-20T00:00:00.000Z')

afterEach(async () => {
  await mock?.close()
})

function env(url: string) {
  return resolveEnv(undefined, {
    name: 'test',
    vars: [
      { key: 'API', value: url },
      { key: 'TOKEN', value: 'tok_secret_value', secret: true },
    ],
  })
}

function run(testCase: TestCase, url: string) {
  return runCase({
    case: testCase,
    env: env(url),
    seed: 'run-seed',
    anchorAt: ANCHOR,
    assetsDir: 'test/assets',
  })
}

describe('runCase', () => {
  it('runs steps in order and chains ctx between them', async () => {
    mock = await startMock({
      'POST /login': () => ({ body: '{"data":{"token":"t_abc","userId":"u_1"}}' }),
      'GET /me': (req) => ({
        body: JSON.stringify({ data: { auth: req.headers.authorization } }),
      }),
    })
    const result = await run(
      {
        name: 'chain',
        steps: [
          {
            id: 'login',
            method: 'POST',
            url: '{{env.API}}/login',
            body: { type: 'json', value: { email: '{{auto.email}}' } },
            extract: { token: '$.data.token' },
            assert: [{ expr: 'status == 200' }],
          },
          {
            id: 'me',
            method: 'GET',
            url: '{{env.API}}/me',
            needs: ['login'],
            headers: { Authorization: 'Bearer {{ctx.token}}' },
            assert: [{ expr: '$.data.auth == "Bearer t_abc"' }],
          },
        ],
      },
      mock.url,
    )
    expect(result.status).toBe('passed')
    expect(result.steps.map((s) => s.status)).toEqual(['passed', 'passed'])
  })

  it('skips a dependent step when its dependency fails', async () => {
    mock = await startMock({ 'POST /login': () => ({ status: 500, body: '{}' }) })
    const result = await run(
      {
        name: 'skip',
        steps: [
          { id: 'login', method: 'POST', url: '{{env.API}}/login', assert: [{ expr: 'status == 200' }] },
          { id: 'me', method: 'GET', url: '{{env.API}}/me', needs: ['login'] },
        ],
      },
      mock.url,
    )
    expect(result.steps.map((s) => s.status)).toEqual(['failed', 'skipped'])
    expect(result.steps[1].reason).toContain('login')
    expect(result.status).toBe('failed')
  })

  it('runs an always step even when its dependency failed', async () => {
    mock = await startMock({
      'POST /save': () => ({ status: 500, body: '{}' }),
      'DELETE /cleanup': () => ({ body: '{}' }),
    })
    const result = await run(
      {
        name: 'cleanup',
        steps: [
          { id: 'save', method: 'POST', url: '{{env.API}}/save', assert: [{ expr: 'status == 200' }] },
          { id: 'cleanup', method: 'DELETE', url: '{{env.API}}/cleanup', needs: ['save'], always: true },
        ],
      },
      mock.url,
    )
    expect(result.steps[1].status).toBe('passed')
    expect(mock.hits['DELETE /cleanup']).toBe(1)
  })

  it('skips a step whose template references an unfilled ctx var, without sending', async () => {
    mock = await startMock({
      'POST /save': () => ({ status: 500, body: '{}' }),
      'DELETE /items': () => ({ body: '{}' }),
    })
    const result = await run(
      {
        name: 'guarded cleanup',
        steps: [
          {
            id: 'save',
            method: 'POST',
            url: '{{env.API}}/save',
            extract: { journalId: '$.data.id' },
            assert: [{ expr: 'status == 200' }],
          },
          {
            id: 'cleanup',
            method: 'DELETE',
            url: '{{env.API}}/items/{{ctx.journalId}}',
            always: true,
          },
        ],
      },
      mock.url,
    )
    expect(result.steps[1].status).toBe('skipped')
    expect(result.steps[1].reason).toContain('ctx.journalId')
    expect(mock.hits['DELETE /items']).toBeUndefined()
  })

  it('marks a step failed when an extract selector finds nothing', async () => {
    mock = await startMock({ 'GET /x': () => ({ body: '{"data":{}}' }) })
    const result = await run(
      {
        name: 'bad extract',
        steps: [{ id: 'x', method: 'GET', url: '{{env.API}}/x', extract: { id: '$.data.id' } }],
      },
      mock.url,
    )
    expect(result.steps[0].status).toBe('failed')
    expect(result.steps[0].asserts.some((a) => a.detail?.includes('$.data.id'))).toBe(true)
  })

  it('extracts from a response header', async () => {
    mock = await startMock({
      'PUT /upload': () => ({ headers: { etag: 'W/"e1"' }, body: '' }),
      'GET /check': (req) => ({ body: JSON.stringify({ tag: req.query.get('tag') }) }),
    })
    const result = await run(
      {
        name: 'header extract',
        steps: [
          { id: 'up', method: 'PUT', url: '{{env.API}}/upload', extract: { tag: '$header.etag' } },
          { id: 'check', method: 'GET', url: '{{env.API}}/check?tag={{ctx.tag}}', needs: ['up'], assert: [{ expr: '$.tag exists' }] },
        ],
      },
      mock.url,
    )
    expect(result.status).toBe('passed')
  })

  it('stores a snapshot of the steps it ran', async () => {
    mock = await startMock({ 'GET /x': () => ({ body: '{}' }) })
    const testCase: TestCase = {
      name: 'snap',
      steps: [{ id: 'x', method: 'GET', url: '{{env.API}}/x' }],
    }
    const result = await run(testCase, mock.url)
    testCase.steps.push({ id: 'y', method: 'GET', url: '{{env.API}}/y' })
    expect(result.stepsSnapshot).toHaveLength(1)
  })

  it('redacts an env secret from the stored request', async () => {
    mock = await startMock({ 'GET /x': () => ({ body: '{}' }) })
    const result = await run(
      {
        name: 'redact env',
        steps: [
          {
            id: 'x',
            method: 'GET',
            url: '{{env.API}}/x',
            headers: { Authorization: 'Bearer {{env.TOKEN}}' },
          },
        ],
      },
      mock.url,
    )
    expect(result.steps[0].request?.headers.authorization).toBe('Bearer ***')
  })

  it('redacts a ctx value listed in case.redact, including in the response it came from', async () => {
    mock = await startMock({
      'POST /login': () => ({ body: '{"data":{"token":"tok_from_response"}}' }),
      'GET /me': () => ({ body: '{}' }),
    })
    const result = await run(
      {
        name: 'redact ctx',
        redact: ['token'],
        steps: [
          { id: 'login', method: 'POST', url: '{{env.API}}/login', extract: { token: '$.data.token' } },
          {
            id: 'me',
            method: 'GET',
            url: '{{env.API}}/me',
            needs: ['login'],
            headers: { Authorization: 'Bearer {{ctx.token}}' },
          },
        ],
      },
      mock.url,
    )
    expect(result.steps[0].response?.text).not.toContain('tok_from_response')
    expect(result.steps[1].request?.headers.authorization).toBe('Bearer ***')
  })

  it('captures correlation headers into trace', async () => {
    mock = await startMock({
      'GET /x': () => ({ headers: { 'x-request-id': 'req-9' }, body: '{}' }),
    })
    const result = await run(
      { name: 'trace', steps: [{ id: 'x', method: 'GET', url: '{{env.API}}/x' }] },
      mock.url,
    )
    expect(result.steps[0].trace).toEqual({ 'x-request-id': 'req-9' })
  })

  it('emits onStep for every step', async () => {
    mock = await startMock({ 'GET /x': () => ({ body: '{}' }) })
    const seen: string[] = []
    await runCase({
      case: { name: 'cb', steps: [{ id: 'x', method: 'GET', url: '{{env.API}}/x' }] },
      env: env(mock.url),
      seed: 'run-seed',
      anchorAt: ANCHOR,
      assetsDir: 'test/assets',
      onStep: (step) => seen.push(step.id),
    })
    expect(seen).toEqual(['x'])
  })

  it('fails a step that declares a body on a GET, and keeps running', async () => {
    mock = await startMock({ 'GET /ok': () => ({ body: '{}' }) })
    const result = await run(
      {
        name: 'bad step',
        steps: [
          { id: 'bad', method: 'GET', url: '{{env.API}}/x', body: { type: 'json', value: {} } },
          { id: 'ok', method: 'GET', url: '{{env.API}}/ok' },
        ],
      },
      mock.url,
    )
    expect(result.steps[0].status).toBe('failed')
    expect(result.steps[0].reason).toContain('GET')
    expect(result.steps[1].status).toBe('passed')
  })

  it('throws PreflightError before sending anything when a variable is missing', async () => {
    mock = await startMock({ 'GET /x': () => ({ body: '{}' }) })
    await expect(
      runCase({
        case: { name: 'pf', steps: [{ id: 'x', method: 'GET', url: '{{env.NOPE}}/x' }] },
        env: env(mock.url),
        seed: 'run-seed',
        anchorAt: ANCHOR,
        assetsDir: 'test/assets',
      }),
    ).rejects.toBeInstanceOf(PreflightError)
    expect(mock.hits['GET /x']).toBeUndefined()
  })

  it('produces an identical request on replay with the same seed and anchor', async () => {
    mock = await startMock({ 'POST /x': () => ({ body: '{}' }) })
    const testCase: TestCase = {
      name: 'replay',
      steps: [
        {
          id: 'x',
          method: 'POST',
          url: '{{env.API}}/x',
          body: { type: 'json', value: { email: '{{auto.email}}', when: '{{auto.pastDate(7)}}' } },
        },
      ],
    }
    const first = await run(testCase, mock.url)
    const second = await run(testCase, mock.url)
    expect(second.steps[0].request?.body).toBe(first.steps[0].request?.body)
  })

  it('records a failed step instead of rejecting when the server is unreachable', async () => {
    mock = await startMock({ 'GET /ok': () => ({ body: '{}' }) })
    const result = await run(
      {
        name: 'unreachable',
        steps: [
          { id: 'ok', method: 'GET', url: '{{env.API}}/ok' },
          { id: 'down', method: 'GET', url: 'http://127.0.0.1:1/nope' },
        ],
      },
      mock.url,
    )
    expect(result.steps[0].status).toBe('passed')
    expect(result.steps[1].status).toBe('failed')
    expect(result.steps[1].reason).toBeTruthy()
    expect(result.steps[1].request?.url).toBe('http://127.0.0.1:1/nope')
    expect(result.status).toBe('failed')
  })

  it('fails the step when the very first attempt outlives its timeout', async () => {
    mock = await startMock({
      'GET /slow': async () => {
        await new Promise((resolve) => setTimeout(resolve, 500))
        return { body: '{"data":{"status":"pending"}}' }
      },
    })
    const started = Date.now()
    const result = await run(
      {
        name: 'first attempt times out',
        steps: [
          {
            id: 'slow',
            method: 'GET',
            url: '{{env.API}}/slow',
            retryUntil: '$.data.status == "done"',
            every: '10ms',
            timeout: '150ms',
          },
        ],
      },
      mock.url,
    )
    expect(result.steps[0].status).toBe('failed')
    expect(result.steps[0].attempts).toBe(1)
    expect(Date.now() - started).toBeLessThan(400)
  })

  it('shrinks a late retry to the time left instead of granting a fresh timeout', async () => {
    // Hits 1 and 2 answer instantly, so the retry loop genuinely runs; from hit 3 the
    // server takes 250ms, which fits inside the nominal 300ms timeout but not inside
    // what is left of the deadline by then. Clamped, the run ends around 300ms. Without
    // the clamp, the fourth attempt gets a fresh 300ms budget, completes at ~250ms, and
    // the run ends around 540ms — which is what this bound separates.
    mock = await startMock({
      'GET /job': async (req) => {
        if (req.hit >= 3) await new Promise((resolve) => setTimeout(resolve, 250))
        return { body: '{"data":{"status":"pending"}}' }
      },
    })
    const started = Date.now()
    const result = await run(
      {
        name: 'clamp',
        steps: [
          {
            id: 'job',
            method: 'GET',
            url: '{{env.API}}/job',
            retryUntil: '$.data.status == "done"',
            every: '10ms',
            timeout: '300ms',
          },
        ],
      },
      mock.url,
    )
    expect(result.steps[0].status).toBe('failed')
    expect(result.steps[0].attempts).toBeGreaterThan(2)
    expect(Date.now() - started).toBeLessThan(430)
  })
})
