import { describe, expect, it } from 'vitest'
import {
  MissingRefError,
  collectEnvRefs,
  makeResolver,
  renderString,
  renderValue,
} from '../lib/engine/template'

const NOW = Date.parse('2026-08-20T00:00:00.000Z')

function resolver(
  overrides: Partial<{
    env: Record<string, string>
    seed: string
    pools: Record<string, string[]>
  }> = {},
) {
  return makeResolver({
    env: overrides.env ?? { API: 'https://api.test', TOKEN: 'tok_123' },
    seed: overrides.seed ?? 'seed-1',
    assetsDir: 'test/assets',
    nowMs: NOW,
    pools: overrides.pools,
  })
}

describe('renderString', () => {
  it('substitutes an env variable', () => {
    expect(renderString('{{env.API}}/v1/x', resolver())).toBe('https://api.test/v1/x')
  })

  it('substitutes a ctx value inside a larger string', () => {
    const r = resolver()
    r.ctx.fileKey = 'u/3f9c.jpg'
    expect(renderString('?key={{ctx.fileKey}}', r)).toBe('?key=u/3f9c.jpg')
  })

  it('reads a nested ctx path', () => {
    const r = resolver()
    r.ctx.classification = { items: [{ name: 'nasi' }] }
    expect(renderString('{{ctx.classification.items[0].name}}', r)).toBe('nasi')
  })

  it('throws MissingRefError naming an unset env variable', () => {
    try {
      renderString('{{env.NOPE}}', resolver())
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(MissingRefError)
      expect((error as MissingRefError).ref).toBe('env.NOPE')
    }
  })

  it('throws MissingRefError naming an unset ctx variable', () => {
    try {
      renderString('/items/{{ctx.journalId}}', resolver())
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as MissingRefError).ref).toBe('ctx.journalId')
    }
  })

  it('leaves a string without tokens untouched', () => {
    expect(renderString('plain', resolver())).toBe('plain')
  })
})

describe('auto memoisation', () => {
  it('gives the same value for the same token twice', () => {
    const r = resolver()
    expect(renderString('{{auto.email}}', r)).toBe(renderString('{{auto.email}}', r))
  })

  it('gives a different value for a #-suffixed token', () => {
    const r = resolver()
    expect(renderString('{{auto.email}}', r)).not.toBe(renderString('{{auto.email#2}}', r))
  })

  it('gives the same value across two resolvers built from the same seed', () => {
    expect(renderString('{{auto.uuid}}', resolver())).toBe(
      renderString('{{auto.uuid}}', resolver()),
    )
  })
})

describe('renderValue', () => {
  it('preserves type when a token fills the whole field', () => {
    const r = resolver()
    r.ctx.classification = { items: [{ name: 'nasi' }, { name: 'teh' }] }
    const out = renderValue({ items: '{{ctx.classification.items}}' }, r) as {
      items: unknown[]
    }
    expect(Array.isArray(out.items)).toBe(true)
    expect(out.items).toHaveLength(2)
  })

  it('stringifies a token embedded in a longer string', () => {
    const r = resolver()
    r.ctx.count = 3
    expect(renderValue({ label: 'n={{ctx.count}}' }, r)).toEqual({ label: 'n=3' })
  })

  it('walks nested objects and arrays', () => {
    const r = resolver()
    r.ctx.id = 'x1'
    expect(renderValue({ a: [{ b: '{{ctx.id}}' }] }, r)).toEqual({ a: [{ b: 'x1' }] })
  })

  it('leaves numbers and booleans alone', () => {
    expect(renderValue({ n: 1, ok: true, nil: null }, resolver())).toEqual({
      n: 1,
      ok: true,
      nil: null,
    })
  })
})

describe('asset.pick', () => {
  it('returns a path inside the requested folder', () => {
    expect(renderString('{{asset.pick(meals/)}}', resolver())).toMatch(/^meals\/[ab]\.jpg$/)
  })

  it('picks the same file for the same seed', () => {
    expect(renderString('{{asset.pick(meals/)}}', resolver())).toBe(
      renderString('{{asset.pick(meals/)}}', resolver()),
    )
  })
})

describe('collectEnvRefs', () => {
  it('finds every env token in a nested structure', () => {
    const refs = collectEnvRefs({
      url: '{{env.API}}/x',
      headers: { Authorization: 'Bearer {{env.TOKEN}}' },
      body: { nested: ['{{env.API}}', '{{ctx.other}}'] },
    })
    expect(refs.sort()).toEqual(['API', 'TOKEN'])
  })
})

describe('pool', () => {
  const pools = { mealName: ['nasi lemak', 'roti canai', 'char kway teow'] }

  it('picks a value from the named pool', () => {
    expect(pools.mealName).toContain(renderString('{{pool.mealName}}', resolver({ pools })))
  })

  it('gives the same value for the same token twice in one run', () => {
    const r = resolver({ pools })
    expect(renderString('{{pool.mealName}}', r)).toBe(renderString('{{pool.mealName}}', r))
  })

  it('gives the same value across two resolvers built from the same seed', () => {
    expect(renderString('{{pool.mealName}}', resolver({ pools }))).toBe(
      renderString('{{pool.mealName}}', resolver({ pools })),
    )
  })

  it('throws MissingRefError naming an absent pool', () => {
    try {
      renderString('{{pool.nope}}', resolver({ pools }))
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(MissingRefError)
      expect((error as MissingRefError).ref).toBe('pool.nope')
    }
  })

  it('throws MissingRefError for an empty pool', () => {
    try {
      renderString('{{pool.empty}}', resolver({ pools: { empty: [] } }))
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as MissingRefError).ref).toBe('pool.empty')
    }
  })

  it('keeps the whole-field type rule', () => {
    const out = renderValue({ dish: '{{pool.mealName}}' }, resolver({ pools })) as {
      dish: string
    }
    expect(typeof out.dish).toBe('string')
    expect(pools.mealName).toContain(out.dish)
  })
})

describe('the #n disambiguator', () => {
  it('applies to a pool, not only to auto', () => {
    const pools = { dish: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }
    const r = resolver({ pools })
    const first = renderString('{{pool.dish}}', r)
    const second = renderString('{{pool.dish#2}}', r)
    expect(pools.dish).toContain(first)
    expect(pools.dish).toContain(second)
  })

  it('applies to an asset without producing a literal path', () => {
    const r = resolver()
    expect(renderString('{{asset.pick(meals/)#2}}', r)).toMatch(/^meals\/[ab]\.jpg$/)
  })

  it('keeps the bare token memoised alongside its #n sibling', () => {
    const pools = { dish: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }
    const r = resolver({ pools })
    const first = renderString('{{pool.dish}}', r)
    renderString('{{pool.dish#2}}', r)
    expect(renderString('{{pool.dish}}', r)).toBe(first)
  })
})
