import { readdirSync } from 'node:fs'
import { generate, makeRng } from './rng'
import { readPath } from './path'

export type Resolver = {
  env: Record<string, string>
  ctx: Record<string, unknown>
  rng: () => number
  autoCache: Map<string, unknown>
  assetsDir: string
  nowMs: number
}

export class MissingRefError extends Error {
  constructor(readonly ref: string) {
    super(`unresolved reference: ${ref}`)
    this.name = 'MissingRefError'
  }
}

const TOKEN = /\{\{\s*(env|ctx|auto|asset)\.(.+?)\s*\}\}/g
const WHOLE = /^\{\{\s*(env|ctx|auto|asset)\.(.+?)\s*\}\}$/

export function makeResolver(input: {
  env: Record<string, string>
  seed: string
  assetsDir: string
  nowMs: number
}): Resolver {
  return {
    env: input.env,
    ctx: {},
    rng: makeRng(input.seed),
    autoCache: new Map(),
    assetsDir: input.assetsDir,
    nowMs: input.nowMs,
  }
}

function resolveToken(namespace: string, rest: string, r: Resolver): unknown {
  if (namespace === 'env') {
    const value = r.env[rest]
    if (value === undefined || value === '') throw new MissingRefError(`env.${rest}`)
    return value
  }

  if (namespace === 'ctx') {
    const value = readPath(r.ctx, rest)
    if (value === undefined) throw new MissingRefError(`ctx.${rest}`)
    return value
  }

  const cacheKey = `${namespace}.${rest}`
  const cached = r.autoCache.get(cacheKey)
  if (cached !== undefined) return cached

  const produced =
    namespace === 'auto'
      ? generate(rest.split('#')[0], r.rng, r.nowMs)
      : pickAsset(rest, r)

  r.autoCache.set(cacheKey, produced)
  return produced
}

function pickAsset(rest: string, r: Resolver): string {
  const match = /^pick\((.*)\)$/.exec(rest)
  if (!match) return rest
  const folder = match[1].replace(/^['"]|['"]$/g, '').replace(/\/$/, '')
  const files = readdirSync(`${r.assetsDir}/${folder}`).sort()
  if (files.length === 0) throw new MissingRefError(`asset.${rest}`)
  return `${folder}/${files[Math.floor(r.rng() * files.length)]}`
}

export function renderString(input: string, r: Resolver): string {
  return input.replace(TOKEN, (_match, namespace: string, rest: string) =>
    String(resolveToken(namespace, rest, r)),
  )
}

export function renderValue(value: unknown, r: Resolver): unknown {
  if (typeof value === 'string') {
    const whole = WHOLE.exec(value)
    if (whole) return resolveToken(whole[1], whole[2], r)
    return renderString(value, r)
  }
  if (Array.isArray(value)) return value.map((item) => renderValue(item, r))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = renderValue(item, r)
    }
    return out
  }
  return value
}

export function collectEnvRefs(value: unknown): string[] {
  const found = new Set<string>()
  for (const match of JSON.stringify(value ?? null).matchAll(TOKEN)) {
    if (match[1] === 'env') found.add(match[2])
  }
  return [...found]
}
