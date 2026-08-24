import { describe, expect, it } from 'vitest'
import { makeRedactor, redactRequest, redactResponse } from '../lib/engine/redact'
import { preflight, resolveEnv } from '../lib/engine/preflight'
import type { EnvDef, TestCase } from '../lib/engine/types'

const shared: EnvDef = {
  name: 'shared',
  vars: [
    { key: 'TENANT_ID', value: 'naluri-my' },
    { key: 'API', value: 'https://shared.test' },
  ],
}

const staging: EnvDef = {
  name: 'staging',
  guard: 'none',
  vars: [
    { key: 'API', value: 'https://stg.test' },
    { key: 'TOKEN', value: 'tok_secret_value', secret: true },
  ],
}

const simpleCase: TestCase = {
  name: 'c',
  steps: [
    {
      id: 'a',
      method: 'POST',
      url: '{{env.API}}/v1/x',
      headers: { Authorization: 'Bearer {{env.TOKEN}}' },
      body: { type: 'json', value: { tenant: '{{env.TENANT_ID}}' } },
    },
  ],
}

describe('resolveEnv', () => {
  it('merges shared under active', () => {
    const env = resolveEnv(shared, staging)
    expect(env.vars.TENANT_ID).toBe('naluri-my')
    expect(env.vars.TOKEN).toBe('tok_secret_value')
  })

  it('lets the active env win on a key present in both', () => {
    expect(resolveEnv(shared, staging).vars.API).toBe('https://stg.test')
  })

  it('collects only values marked secret', () => {
    expect(resolveEnv(shared, staging).secrets).toEqual(['tok_secret_value'])
  })

  it('works with no shared env', () => {
    expect(resolveEnv(undefined, staging).vars.API).toBe('https://stg.test')
  })
})

describe('preflight', () => {
  it('returns no errors when every referenced variable is set', () => {
    expect(preflight({ case: simpleCase, env: resolveEnv(shared, staging) })).toEqual([])
  })

  it('names a missing variable and the env it is missing from', () => {
    const env = resolveEnv(undefined, { name: 'dev', vars: [{ key: 'API', value: 'x' }] })
    const errors = preflight({ case: simpleCase, env })
    expect(errors).toHaveLength(2)
    expect(errors.join(' ')).toContain('TOKEN')
    expect(errors.join(' ')).toContain('dev')
  })

  it('treats an empty string as missing', () => {
    const env = resolveEnv(undefined, {
      name: 'dev',
      vars: [{ key: 'API', value: '' }, { key: 'TOKEN', value: 't' }, { key: 'TENANT_ID', value: 'x' }],
    })
    expect(preflight({ case: simpleCase, env }).join(' ')).toContain('API')
  })

  it('blocks a non-GET step on a readonly env and names the step', () => {
    const env = resolveEnv(shared, { ...staging, name: 'prod', guard: 'readonly' })
    const errors = preflight({ case: simpleCase, env })
    expect(errors.join(' ')).toMatch(/readonly/)
    expect(errors.join(' ')).toContain('a')
  })

  it('allows a GET-only case on a readonly env', () => {
    const readOnlyCase: TestCase = {
      name: 'c',
      steps: [{ id: 'g', method: 'GET', url: '{{env.API}}/x' }],
    }
    const env = resolveEnv(shared, { name: 'prod', guard: 'readonly', vars: staging.vars })
    expect(preflight({ case: readOnlyCase, env })).toEqual([])
  })

  it('blocks a confirm env until confirmed is true', () => {
    const env = resolveEnv(shared, { ...staging, name: 'prod', guard: 'confirm' })
    expect(preflight({ case: simpleCase, env }).join(' ')).toMatch(/confirm/)
    expect(preflight({ case: simpleCase, env, confirmed: true })).toEqual([])
  })

  it('rejects a duration it cannot parse instead of falling back', () => {
    const bad: TestCase = {
      name: 'typo',
      steps: [{ id: 'a', method: 'GET', url: '{{env.API}}/x', every: '1min', timeout: '30sec' }],
    }
    const errors = preflight({ case: bad, env: resolveEnv(shared, staging) })
    expect(errors.join(' ')).toContain('every')
    expect(errors.join(' ')).toContain('1min')
    expect(errors.join(' ')).toContain('timeout')
  })

  it('accepts the durations it does understand', () => {
    const good: TestCase = {
      name: 'fine',
      steps: [
        { id: 'a', method: 'GET', url: '{{env.API}}/x', every: '250ms', timeout: '2m', delay: '3s' },
      ],
    }
    expect(preflight({ case: good, env: resolveEnv(shared, staging) })).toEqual([])
  })
})

describe('makeRedactor', () => {
  it('replaces a secret anywhere in a string', () => {
    expect(makeRedactor(['tok_secret_value'])('Bearer tok_secret_value here')).toBe(
      'Bearer *** here',
    )
  })

  it('ignores values shorter than four characters', () => {
    expect(makeRedactor(['ab'])('ab cd')).toBe('ab cd')
  })

  it('replaces the longest secret first when one contains the other', () => {
    expect(makeRedactor(['abcd', 'abcdefgh'])('abcdefgh')).toBe('***')
  })

  it('redacts request headers and body', () => {
    const redacted = redactRequest(
      {
        method: 'POST',
        url: 'https://x.test',
        headers: { authorization: 'Bearer tok_secret_value' },
        body: '{"t":"tok_secret_value"}',
      },
      makeRedactor(['tok_secret_value']),
    )
    expect(redacted.headers.authorization).toBe('Bearer ***')
    expect(redacted.body).toBe('{"t":"***"}')
  })

  it('redacts response headers and text, preserving status and truncated', () => {
    const redacted = redactResponse(
      {
        status: 200,
        headers: { 'x-echo': 'tok_secret_value' },
        text: '{"token":"tok_secret_value"}',
        truncated: true,
      },
      makeRedactor(['tok_secret_value']),
    )
    expect(redacted.headers['x-echo']).toBe('***')
    expect(redacted.text).toBe('{"token":"***"}')
    expect(redacted.status).toBe(200)
    expect(redacted.truncated).toBe(true)
  })

  it('never passes a binary body through to the record', () => {
    const redacted = redactRequest(
      {
        method: 'PUT',
        url: 'https://x.test/upload',
        headers: {},
        bodyBytes: new TextEncoder().encode('secret file contents'),
      },
      makeRedactor(['tok_secret_value']),
    )
    expect(redacted.body).toBe('<binary, 20 bytes>')
    expect(JSON.stringify(redacted)).not.toContain('secret file contents')
  })

  it('summarises a multipart body instead of storing it', () => {
    const form = new FormData()
    form.set('caption', 'lunch')
    const redacted = redactRequest(
      { method: 'POST', url: 'https://x.test/form', headers: {}, multipart: form },
      makeRedactor([]),
    )
    expect(redacted.body).toBe('<multipart form>')
    expect(redacted.multipart).toBeUndefined()
  })
})
