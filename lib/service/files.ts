import { readFile, readdir } from 'node:fs/promises'
import { AssetPathError, resolveWithin } from '../engine/index'
import type { EnvDef, TestCase } from '../engine/index'

export class FileRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileRequestError'
  }
}

export async function listSelectableFiles(root: string, suffix: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(suffix))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

async function readJson(root: string, relative: string): Promise<unknown> {
  let path: string
  try {
    path = resolveWithin(root, relative)
  } catch (error) {
    if (error instanceof AssetPathError) {
      throw new FileRequestError(`path "${relative}" is outside "${root}"`)
    }
    throw error
  }
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new FileRequestError(`cannot read "${relative}": ${(error as Error).message}`)
  }
}

export async function readCaseFile(root: string, relative: string): Promise<TestCase> {
  const parsed = (await readJson(root, relative)) as TestCase
  if (!parsed || !Array.isArray(parsed.steps)) {
    throw new FileRequestError(`"${relative}" has no steps array`)
  }
  return parsed
}

export async function readEnvFile(root: string, relative: string): Promise<EnvDef> {
  const parsed = (await readJson(root, relative)) as EnvDef
  if (!parsed || !Array.isArray(parsed.vars)) {
    throw new FileRequestError(`"${relative}" has no vars array`)
  }
  return parsed
}
