const FIRST = ['aisyah', 'budi', 'chandra', 'dewi', 'farah', 'gilang', 'hana', 'iqbal']
const LAST = ['pratama', 'wijaya', 'santoso', 'rahman', 'lestari', 'kusuma']
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789'

function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

export function makeRng(seed: string): () => number {
  let a = hashSeed(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hex(rng: () => number, n: number): string {
  let out = ''
  while (out.length < n) out += Math.floor(rng() * 16).toString(16)
  return out.slice(0, n)
}

function digits(rng: () => number, n: number): string {
  let out = ''
  while (out.length < n) out += Math.floor(rng() * 10).toString(10)
  return out
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '')
}

function isoDay(rng: () => number, days: number, nowMs: number): string {
  const span = Math.max(1, Math.abs(days))
  const offset = Math.floor(rng() * span) * 86400000 * Math.sign(days)
  return new Date(nowMs + offset).toISOString().slice(0, 10)
}

export function generate(spec: string, rng: () => number, nowMs: number): string {
  const parsed = /^(\w+)(?:\((.*)\))?$/.exec(spec.trim())
  if (!parsed) throw new Error(`unknown generator: ${spec}`)
  const kind = parsed[1]
  const raw = parsed[2]
  const args = raw === undefined ? [] : raw.split(',').map((s) => stripQuotes(s.trim()))
  const pick = <T>(list: T[]): T => list[Math.floor(rng() * list.length)]

  switch (kind) {
    case 'uuid': {
      const h = hex(rng, 32)
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
    }
    case 'email':
      return `${pick(FIRST)}.${hex(rng, 6)}${args[0] ?? '@example.test'}`
    case 'fullName': {
      const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
      return `${cap(pick(FIRST))} ${cap(pick(LAST))}`
    }
    case 'phone':
      return `+601${digits(rng, 8)}`
    case 'int': {
      const lo = Number(args[0] ?? 0)
      const hi = Number(args[1] ?? 100)
      return String(lo + Math.floor(rng() * (hi - lo + 1)))
    }
    case 'string':
      return hex(rng, Number(args[0] ?? 8))
    case 'pastDate':
      return isoDay(rng, -Number(args[0] ?? 7), nowMs)
    case 'futureDate':
      return isoDay(rng, Number(args[0] ?? 7), nowMs)
    case 'pick':
      return pick((args[0] ?? '').split('|'))
    case 'format': {
      const mask = stripQuotes(raw ?? '')
      let out = ''
      for (let i = 0; i < mask.length; i++) {
        const ch = mask[i]
        if (ch === '\\' && i + 1 < mask.length) {
          out += mask[++i]
          continue
        }
        if (ch === '#') out += digits(rng, 1)
        else if (ch === 'A') out += UPPER[Math.floor(rng() * UPPER.length)]
        else if (ch === 'a') out += ALNUM[Math.floor(rng() * 26)]
        else if (ch === '*') out += ALNUM[Math.floor(rng() * ALNUM.length)]
        else out += ch
      }
      return out
    }
    default:
      throw new Error(`unknown generator: ${kind}`)
  }
}
