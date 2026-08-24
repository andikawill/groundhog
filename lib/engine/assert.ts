import type { AssertResult } from './types'
import { readPath } from './path'
import { renderString, type Resolver } from './template'

export type EvalTarget = {
  status: number
  headers: Record<string, string>
  json: unknown
  text: string
}

export function readRef(ref: string, target: EvalTarget): unknown {
  if (ref === 'status') return target.status
  if (ref.startsWith('$header.')) return target.headers[ref.slice(8).toLowerCase()]
  if (ref.startsWith('$')) return readPath(target.json, ref)
  return undefined
}

function lengthOf(value: unknown): number | undefined {
  if (Array.isArray(value) || typeof value === 'string') return value.length
  if (value !== null && typeof value === 'object') return Object.keys(value).length
  return undefined
}

function coerce(raw: string): string | number {
  const trimmed = raw.replace(/^['"]|['"]$/g, '')
  return trimmed !== '' && !Number.isNaN(Number(trimmed)) ? Number(trimmed) : trimmed
}

function compare(op: string, left: unknown, right: string | number): boolean | undefined {
  const bothNumeric =
    typeof right === 'number' &&
    left !== null &&
    left !== '' &&
    !Number.isNaN(Number(left))
  const leftValue = bothNumeric ? Number(left) : left
  switch (op) {
    case '==':
      return bothNumeric ? leftValue === right : String(left) === String(right)
    case '!=':
      return bothNumeric ? leftValue !== right : String(left) !== String(right)
    case '>':
      return Number(left) > Number(right)
    case '<':
      return Number(left) < Number(right)
    case 'contains':
      // An element that is an object stringifies to [object Object], so every such array
      // answered false whatever it held. A primitive element still has to match exactly —
      // `contains nasi` over ['nasi lemak'] is a question about membership, not substrings —
      // while an object is matched against its JSON, which is the only text it has.
      return Array.isArray(left)
        ? left.some((item) =>
            item !== null && typeof item === 'object'
              ? JSON.stringify(item).includes(String(right))
              : String(item) === String(right),
          )
        : String(left).includes(String(right))
    case 'matches':
      return new RegExp(String(right)).test(String(left))
    default:
      return undefined
  }
}

export function evalExpr(expr: string, target: EvalTarget, r: Resolver): AssertResult {
  const parts = expr.trim().split(/\s+/)
  const ref = parts[0]
  let value = readRef(ref, target)
  let index = 1

  const measured = parts[index] === 'length'
  if (measured) {
    value = lengthOf(value)
    index += 1
  }

  const op = parts[index]
  if (op === 'exists') {
    const ok = value !== undefined
    return { expr, ok, detail: ok ? undefined : `${ref} is undefined` }
  }

  // A reference that cannot be read fails every comparison. String(undefined) != "error"
  // was true, so a misspelled path reported success — the one thing an assertion must never
  // do. exists is left as the only operator that asks about absence.
  if (value === undefined) {
    return { expr, ok: false, detail: `${measured ? `${ref} length` : ref} is undefined` }
  }

  let right: string | number
  try {
    right = coerce(renderString(parts.slice(index + 1).join(' '), r))
  } catch (error) {
    return { expr, ok: false, detail: (error as Error).message }
  }

  let ok: boolean | undefined
  try {
    ok = compare(op, value, right)
  } catch (error) {
    return { expr, ok: false, detail: (error as Error).message }
  }

  if (ok === undefined) return { expr, ok: false, detail: `unknown operator: ${op}` }
  return { expr, ok, detail: ok ? undefined : `actual: ${JSON.stringify(value)}` }
}
