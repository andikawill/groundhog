import { readFileSync, readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'

export class AssetPathError extends Error {
  constructor(readonly requested: string) {
    super(`asset path escapes the assets directory: ${requested}`)
    this.name = 'AssetPathError'
  }
}

export function resolveWithin(assetsDir: string, relative: string): string {
  const root = resolve(assetsDir)
  const target = resolve(root, relative)
  if (target !== root && !target.startsWith(root + sep)) throw new AssetPathError(relative)
  return target
}

export function readAsset(assetsDir: string, relative: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(resolveWithin(assetsDir, relative)))
}

export function listAssets(assetsDir: string, folder: string): string[] {
  return readdirSync(resolveWithin(assetsDir, folder)).sort()
}
