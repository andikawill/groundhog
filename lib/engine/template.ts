import { listAssets } from './assets'
import { generate, makeRng, type Rng } from './rng'
import { readPath } from './path'

export type Resolver = {
  env: Record<string, string>
  ctx: Record<string, unknown>
  pools: Record<string, string[]>
  rng: Rng
  autoCache: Map<string, unknown>
  origins: Map<string, string[]>
  assetsDir: string
  nowMs: number
}

export class MissingRefError extends Error {
  constructor(readonly ref: string) {
    super(`unresolved reference: ${ref}`)
    this.name = 'MissingRefError'
  }
}

const TOKEN = /\{\{\s*(env|ctx|auto|pool|asset)\.(.+?)\s*\}\}/g
const WHOLE = /^\{\{\s*(env|ctx|auto|pool|asset)\.(.+?)\s*\}\}$/

export function makeResolver(input: {
  env: Record<string, string>
  seed: string
  assetsDir: string
  nowMs: number
  pools?: Record<string, string[]>
  restore?: { ctx: Record<string, unknown>; memo: Record<string, string>; rngState: number }
}): Resolver {
  return {
    env: input.env,
    ctx: { ...(input.restore?.ctx ?? {}) },
    pools: input.pools ?? {},
    rng: makeRng(input.seed, input.restore?.rngState),
    autoCache: new Map<string, unknown>(Object.entries(input.restore?.memo ?? {})),
    origins: new Map(),
    assetsDir: input.assetsDir,
    nowMs: input.nowMs,
  }
}

export function snapshotResolver(r: Resolver): {
  ctx: Record<string, unknown>
  memo: Record<string, string>
  rngState: number
} {
  const memo: Record<string, string> = {}
  for (const [key, value] of r.autoCache) memo[key] = String(value)
  return { ctx: { ...r.ctx }, memo, rngState: r.rng.state() }
}

function resolveToken(namespace: string, rest: string, r: Resolver, path: string): unknown {
  const value = resolveTokenValue(namespace, rest, r)
  if (path !== '') {
    const seen = r.origins.get(path)
    if (seen) seen.push(`${namespace}.${rest}`)
    else r.origins.set(path, [`${namespace}.${rest}`])
  }
  return value
}

function resolveTokenValue(namespace: string, rest: string, r: Resolver): unknown {
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

  const name = rest.split('#')[0]
  const produced =
    namespace === 'auto'
      ? generate(name, r.rng.next, r.nowMs)
      : namespace === 'pool'
        ? pickPool(name, r)
        : pickAsset(name, r)

  r.autoCache.set(cacheKey, produced)
  return produced
}

function pickPool(name: string, r: Resolver): string {
  const list = r.pools[name]
  if (!list || list.length === 0) throw new MissingRefError(`pool.${name}`)
  return list[Math.floor(r.rng.next() * list.length)]
}

function pickAsset(rest: string, r: Resolver): string {
  const match = /^pick\((.*)\)$/.exec(rest)
  if (!match) return rest
  const folder = match[1].replace(/^['"]|['"]$/g, '').replace(/\/$/, '')
  const files = listAssets(r.assetsDir, folder)
  if (files.length === 0) throw new MissingRefError(`asset.${rest}`)
  return `${folder}/${files[Math.floor(r.rng.next() * files.length)]}`
}

export function renderString(input: string, r: Resolver, path = ''): string {
  return input.replace(TOKEN, (_match, namespace: string, rest: string) =>
    String(resolveToken(namespace, rest, r, path)),
  )
}

export function renderValue(value: unknown, r: Resolver, path = ''): unknown {
  if (typeof value === 'string') {
    const whole = WHOLE.exec(value)
    if (whole) return resolveToken(whole[1], whole[2], r, path)
    return renderString(value, r, path)
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => renderValue(item, r, path ? `${path}[${index}]` : ''))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = renderValue(item, r, path ? `${path}.${key}` : '')
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
