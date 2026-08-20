import { describe, expect, it } from 'vitest'
import { buildRequest } from '../lib/engine/http'
import { makeResolver } from '../lib/engine/template'
import type { Step } from '../lib/engine/types'

function resolver() {
  return makeResolver({
    env: { API: 'https://api.test', TOKEN: 'tok_123' },
    seed: 'build-seed',
    assetsDir: 'test/assets',
    nowMs: Date.parse('2026-08-20T00:00:00.000Z'),
  })
}

const base: Step = { id: 's', method: 'POST', url: '{{env.API}}/v1/x' }

describe('buildRequest', () => {
  it('renders the url and headers', () => {
    const request = buildRequest(
      { ...base, headers: { Authorization: 'Bearer {{env.TOKEN}}' } },
      resolver(),
    )
    expect(request.url).toBe('https://api.test/v1/x')
    expect(request.headers.authorization).toBe('Bearer tok_123')
  })

  it('serialises a json body and sets content-type', () => {
    const request = buildRequest(
      { ...base, body: { type: 'json', value: { a: 1 } } },
      resolver(),
    )
    expect(request.body).toBe('{"a":1}')
    expect(request.headers['content-type']).toBe('application/json')
  })

  it('does not overwrite an explicit content-type', () => {
    const request = buildRequest(
      {
        ...base,
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: { type: 'json', value: {} },
      },
      resolver(),
    )
    expect(request.headers['content-type']).toBe('application/vnd.api+json')
  })

  it('preserves an injected array in a json body', () => {
    const r = resolver()
    r.ctx.items = [{ name: 'nasi' }]
    const request = buildRequest(
      { ...base, body: { type: 'json', value: { items: '{{ctx.items}}' } } },
      r,
    )
    expect(JSON.parse(request.body!)).toEqual({ items: [{ name: 'nasi' }] })
  })

  it('reads a file body from the assets folder as bytes', () => {
    const request = buildRequest(
      { ...base, method: 'PUT', body: { type: 'file', path: 'meals/a.jpg' } },
      resolver(),
    )
    expect(request.bodyBytes).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(request.bodyBytes)).toBe('a')
    expect(request.body).toBeUndefined()
  })

  it('resolves an asset token in a file body', () => {
    const request = buildRequest(
      { ...base, method: 'PUT', body: { type: 'file', path: '{{asset.pick(meals/)}}' } },
      resolver(),
    )
    expect(request.bodyBytes).toBeInstanceOf(Uint8Array)
  })

  it('encodes a form body', () => {
    const request = buildRequest(
      { ...base, body: { type: 'form', value: { a: '1', b: 'x y' } } },
      resolver(),
    )
    expect(request.body).toBe('a=1&b=x+y')
    expect(request.headers['content-type']).toBe('application/x-www-form-urlencoded')
  })

  it('builds a multipart body with a text field and a file part', () => {
    const request = buildRequest(
      {
        ...base,
        body: {
          type: 'multipart',
          value: { caption: 'lunch {{env.TOKEN}}', photo: { file: 'meals/a.jpg' } },
        },
      },
      resolver(),
    )
    expect(request.multipart).toBeInstanceOf(FormData)
    expect(request.multipart?.get('caption')).toBe('lunch tok_123')
    const photo = request.multipart?.get('photo')
    expect(photo).toBeInstanceOf(Blob)
    expect((photo as File).name).toBe('a.jpg')
    expect(request.body).toBeUndefined()
    expect(request.headers['content-type']).toBeUndefined()
  })

  it('sends a raw body with its declared content type', () => {
    const request = buildRequest(
      { ...base, body: { type: 'raw', value: '<x>{{env.TOKEN}}</x>', contentType: 'application/xml' } },
      resolver(),
    )
    expect(request.body).toBe('<x>tok_123</x>')
    expect(request.headers['content-type']).toBe('application/xml')
  })

  it('lowercases every header name', () => {
    const request = buildRequest({ ...base, headers: { 'X-Tenant-Id': 'my' } }, resolver())
    expect(Object.keys(request.headers)).toContain('x-tenant-id')
  })

  it('omits a body when the step declares none', () => {
    const request = buildRequest({ id: 'g', method: 'GET', url: '{{env.API}}/x' }, resolver())
    expect(request.body).toBeUndefined()
    expect(request.bodyBytes).toBeUndefined()
  })
})
