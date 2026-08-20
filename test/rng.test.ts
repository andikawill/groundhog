import { describe, expect, it } from 'vitest'
import { generate, makeRng } from '../lib/engine/rng'

const NOW = Date.parse('2026-08-20T00:00:00.000Z')

describe('makeRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = makeRng('8f2a1c')
    const b = makeRng('8f2a1c')
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('produces a different sequence for a different seed', () => {
    expect(makeRng('aaa')()).not.toEqual(makeRng('bbb')())
  })

  it('stays within [0, 1)', () => {
    const rng = makeRng('range')
    for (let i = 0; i < 500; i++) {
      const n = rng()
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(1)
    }
  })
})

describe('generate', () => {
  it('is deterministic for the same seed', () => {
    expect(generate('email', makeRng('s1'), NOW)).toEqual(
      generate('email', makeRng('s1'), NOW),
    )
  })

  it('honours an email domain argument', () => {
    expect(generate("email('@naluri.life')", makeRng('s1'), NOW)).toMatch(
      /@naluri\.life$/,
    )
  })

  it('emits a well-formed uuid', () => {
    expect(generate('uuid', makeRng('s2'), NOW)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('keeps int within bounds', () => {
    const rng = makeRng('s3')
    for (let i = 0; i < 100; i++) {
      const n = Number(generate('int(5,9)', rng, NOW))
      expect(n).toBeGreaterThanOrEqual(5)
      expect(n).toBeLessThanOrEqual(9)
    }
  })

  it('derives pastDate from the injected now, not the system clock', () => {
    const value = generate('pastDate(7)', makeRng('s4'), NOW)
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const diffDays = (NOW - Date.parse(value)) / 86400000
    expect(diffDays).toBeGreaterThanOrEqual(0)
    expect(diffDays).toBeLessThan(7)
  })

  it('picks from a pipe-separated list', () => {
    expect(['a', 'b', 'c']).toContain(generate('pick(a|b|c)', makeRng('s5'), NOW))
  })

  it('rejects an unknown generator by name', () => {
    expect(() => generate('nope', makeRng('s6'), NOW)).toThrow(/unknown generator: nope/)
  })
})
