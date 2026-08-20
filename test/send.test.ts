import { afterEach, describe, expect, it } from 'vitest'
import { send, traceOf } from '../lib/engine/http'
import { startMock, type MockHandle } from './mock-server'
import { MAX_BODY_BYTES } from '../lib/engine/types'

let mock: MockHandle

afterEach(async () => {
  await mock?.close()
})

describe('send', () => {
  it('returns status, lowercased headers, and text', async () => {
    mock = await startMock({
      'GET /ok': () => ({ status: 201, headers: { ETag: 'W/"1"' }, body: '{"a":1}' }),
    })
    const response = await send(
      { method: 'GET', url: `${mock.url}/ok`, headers: {} },
      5000,
    )
    expect(response.status).toBe(201)
    expect(response.headers.etag).toBe('W/"1"')
    expect(response.text).toBe('{"a":1}')
    expect(response.truncated).toBe(false)
  })

  it('sends a string body', async () => {
    let seen = ''
    mock = await startMock({
      'POST /echo': (req) => {
        seen = req.body
        return { body: '{}' }
      },
    })
    await send(
      { method: 'POST', url: `${mock.url}/echo`, headers: { 'content-type': 'application/json' }, body: '{"x":1}' },
      5000,
    )
    expect(seen).toBe('{"x":1}')
  })

  it('sends a byte body', async () => {
    let seen = ''
    mock = await startMock({
      'PUT /upload': (req) => {
        seen = req.body
        return { status: 200, headers: { etag: 'W/"z"' }, body: '' }
      },
    })
    const response = await send(
      { method: 'PUT', url: `${mock.url}/upload`, headers: {}, bodyBytes: new TextEncoder().encode('bytes') },
      5000,
    )
    expect(seen).toBe('bytes')
    expect(response.status).toBe(200)
    expect(response.text).toBe('')
  })

  it('tolerates an empty non-JSON response', async () => {
    mock = await startMock({ 'PUT /s3': () => ({ status: 200, body: '' }) })
    const response = await send({ method: 'PUT', url: `${mock.url}/s3`, headers: {} }, 5000)
    expect(response.text).toBe('')
  })

  it('truncates a body over the limit and flags it', async () => {
    mock = await startMock({
      'GET /big': () => ({ body: 'x'.repeat(MAX_BODY_BYTES + 100) }),
    })
    const response = await send({ method: 'GET', url: `${mock.url}/big`, headers: {} }, 10000)
    expect(response.truncated).toBe(true)
    expect(response.text.length).toBe(MAX_BODY_BYTES)
  })

  it('does not follow redirects', async () => {
    mock = await startMock({
      'GET /go': () => ({ status: 302, headers: { location: '/dest' }, body: '' }),
      'GET /dest': () => ({ body: '{"arrived":true}' }),
    })
    const response = await send({ method: 'GET', url: `${mock.url}/go`, headers: {} }, 5000)
    expect(response.status).toBe(302)
    expect(response.headers.location).toBe('/dest')
    expect(mock.hits['GET /dest']).toBeUndefined()
  })

  it('reports a duration', async () => {
    mock = await startMock({ 'GET /t': () => ({ body: '{}' }) })
    const response = await send({ method: 'GET', url: `${mock.url}/t`, headers: {} }, 5000)
    expect(response.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('traceOf', () => {
  it('picks known correlation headers only', () => {
    expect(
      traceOf({ 'x-request-id': 'r1', traceparent: 't1', 'content-type': 'application/json' }),
    ).toEqual({ 'x-request-id': 'r1', traceparent: 't1' })
  })

  it('returns undefined when none are present', () => {
    expect(traceOf({ 'content-type': 'application/json' })).toBeUndefined()
  })
})
