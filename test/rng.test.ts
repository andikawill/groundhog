import { describe, expect, it } from 'vitest'
import { generate, makeRng } from '../lib/engine/rng'

const NOW = Date.parse('2026-08-20T00:00:00.000Z')

describe('makeRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = makeRng('8f2a1c')
    const b = makeRng('8f2a1c')
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()])
  })

  it('produces a different sequence for a different seed', () => {
    expect(makeRng('aaa').next()).not.toEqual(makeRng('bbb').next())
  })

  it('stays within [0, 1)', () => {
    const rng = makeRng('range')
    for (let i = 0; i < 500; i++) {
      const n = rng.next()
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(1)
    }
  })

  it('reports a position that advances as values are drawn', () => {
    const rng = makeRng('pos')
    const start = rng.state()
    rng.next()
    expect(rng.state()).not.toBe(start)
  })

  it('resumes an identical stream from a reported position', () => {
    const first = makeRng('pos')
    first.next()
    first.next()
    const saved = first.state()
    const expected = [first.next(), first.next(), first.next()]

    const resumed = makeRng('pos', saved)
    expect([resumed.next(), resumed.next(), resumed.next()]).toEqual(expected)
  })

  it('ignores the seed when a position is supplied', () => {
    const source = makeRng('one')
    source.next()
    const saved = source.state()
    expect(makeRng('one', saved).next()).toBe(makeRng('different', saved).next())
  })
})

describe('generate', () => {
  it('is deterministic for the same seed', () => {
    expect(generate('email', makeRng('s1').next, NOW)).toEqual(
      generate('email', makeRng('s1').next, NOW),
    )
  })

  it('honours an email domain argument', () => {
    expect(generate("email('@naluri.life')", makeRng('s1').next, NOW)).toMatch(
      /@naluri\.life$/,
    )
  })

  it('emits a well-formed uuid', () => {
    expect(generate('uuid', makeRng('s2').next, NOW)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('keeps int within bounds', () => {
    const rng = makeRng('s3')
    for (let i = 0; i < 100; i++) {
      const n = Number(generate('int(5,9)', rng.next, NOW))
      expect(n).toBeGreaterThanOrEqual(5)
      expect(n).toBeLessThanOrEqual(9)
    }
  })

  it('derives pastDate from the injected now, not the system clock', () => {
    const value = generate('pastDate(7)', makeRng('s4').next, NOW)
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const diffDays = (NOW - Date.parse(value)) / 86400000
    expect(diffDays).toBeGreaterThanOrEqual(0)
    expect(diffDays).toBeLessThan(7)
  })

  it('picks from a pipe-separated list', () => {
    expect(['a', 'b', 'c']).toContain(generate('pick(a|b|c)', makeRng('s5').next, NOW))
  })

  it('rejects an unknown generator by name', () => {
    expect(() => generate('nope', makeRng('s6').next, NOW)).toThrow(/unknown generator: nope/)
  })

  it('fills a format mask by character class', () => {
    const value = generate('format(01########)', makeRng('f1').next, NOW)
    expect(value).toMatch(/^01\d{8}$/)
  })

  it('fills letters and alphanumerics in a mask', () => {
    expect(generate('format(AAA-###)', makeRng('f2').next, NOW)).toMatch(/^[A-Z]{3}-\d{3}$/)
    expect(generate('format(aa)', makeRng('f3').next, NOW)).toMatch(/^[a-z]{2}$/)
    expect(generate('format(**)', makeRng('f4').next, NOW)).toMatch(/^[a-z0-9]{2}$/)
  })

  it('passes unrecognised mask characters through untouched', () => {
    expect(generate('format(IC:###/##)', makeRng('f5').next, NOW)).toMatch(/^IC:\d{3}\/\d{2}$/)
  })

  it('emits a mask character literally when escaped', () => {
    expect(generate('format(\\#\\A#)', makeRng('f6').next, NOW)).toMatch(/^#A\d$/)
  })

  it('is deterministic for the same seed', () => {
    expect(generate('format(####)', makeRng('f7').next, NOW)).toBe(
      generate('format(####)', makeRng('f7').next, NOW),
    )
  })
})
