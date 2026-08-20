import { describe, expect, it } from 'vitest'
import { evalExpr, readRef } from '../lib/engine/assert'
import { makeResolver } from '../lib/engine/template'

const target = {
  status: 200,
  headers: { etag: 'W/"abc"', 'content-type': 'application/json' },
  json: { data: { id: 'j_1', imageKey: 'u/3f9c.jpg', items: [{ name: 'nasi' }], status: 'done' } },
  text: '{"data":{"id":"j_1"}}',
}

function resolver() {
  return makeResolver({
    env: { API: 'https://api.test' },
    seed: 'assert-seed',
    assetsDir: 'test/assets',
    nowMs: Date.parse('2026-08-20T00:00:00.000Z'),
  })
}

describe('readRef', () => {
  it('reads the status', () => {
    expect(readRef('status', target)).toBe(200)
  })

  it('reads a response header case-insensitively', () => {
    expect(readRef('$header.ETag', target)).toBe('W/"abc"')
  })

  it('reads a JSON path from the body', () => {
    expect(readRef('$.data.id', target)).toBe('j_1')
  })
})

describe('evalExpr', () => {
  it('passes a numeric equality', () => {
    expect(evalExpr('status == 200', target, resolver()).ok).toBe(true)
  })

  it('fails a numeric equality and reports the actual value', () => {
    const result = evalExpr('status == 404', target, resolver())
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('200')
  })

  it('handles !=', () => {
    expect(evalExpr('status != 500', target, resolver()).ok).toBe(true)
  })

  it('handles > and <', () => {
    expect(evalExpr('$.data.items length > 0', target, resolver()).ok).toBe(true)
    expect(evalExpr('$.data.items length < 1', target, resolver()).ok).toBe(false)
  })

  it('handles exists on a present and an absent field', () => {
    expect(evalExpr('$.data.items[0].name exists', target, resolver()).ok).toBe(true)
    expect(evalExpr('$.data.missing exists', target, resolver()).ok).toBe(false)
  })

  it('compares against a quoted string', () => {
    expect(evalExpr('$.data.status == "done"', target, resolver()).ok).toBe(true)
  })

  it('resolves template tokens on the right-hand side', () => {
    const r = resolver()
    r.ctx.fileKey = 'u/3f9c.jpg'
    expect(evalExpr('$.data.imageKey == "{{ctx.fileKey}}"', target, r).ok).toBe(true)
  })

  it('handles contains', () => {
    expect(evalExpr('$.data.id contains j_', target, resolver()).ok).toBe(true)
  })

  it('handles matches', () => {
    expect(evalExpr('$.data.id matches ^j_\\d+$', target, resolver()).ok).toBe(true)
  })

  it('measures length of a string and of an object', () => {
    expect(evalExpr('$.data.id length == 3', target, resolver()).ok).toBe(true)
    expect(evalExpr('$.data length == 4', target, resolver()).ok).toBe(true)
  })

  it('fails instead of throwing on an unknown operator', () => {
    const result = evalExpr('status ~= 200', target, resolver())
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('unknown operator')
  })

  it('fails instead of throwing when the right-hand side has an unresolved token', () => {
    const result = evalExpr('$.data.id == "{{ctx.nope}}"', target, resolver())
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('ctx.nope')
  })

  it('echoes the original expression back', () => {
    expect(evalExpr('status == 200', target, resolver()).expr).toBe('status == 200')
  })

  it('does not treat an empty string as the number zero', () => {
    const empty = { ...target, json: { data: { count: '' } } }
    expect(evalExpr('$.data.count == 0', empty, resolver()).ok).toBe(false)
    expect(evalExpr('$.data.count != 0', empty, resolver()).ok).toBe(true)
  })

  it('fails instead of throwing on an invalid regular expression', () => {
    const result = evalExpr('$.data.id matches (', target, resolver())
    expect(result.ok).toBe(false)
    expect(result.detail).toBeTruthy()
  })
})
