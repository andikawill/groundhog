import { describe, expect, it } from 'vitest'
import { makeRedactor, redactRequest } from '../lib/engine/redact'
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
})
