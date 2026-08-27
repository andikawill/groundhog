import { readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { AssetPathError, resolveWithin } from '../engine/index'
import type { EnvDef, EnvVar, TestCase } from '../engine/index'

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

function resolvePath(root: string, relative: string): string {
  try {
    return resolveWithin(root, relative)
  } catch (error) {
    if (error instanceof AssetPathError) {
      throw new FileRequestError(`path "${relative}" is outside "${root}"`)
    }
    throw error
  }
}

async function readJson(root: string, relative: string): Promise<unknown> {
  const path = resolvePath(root, relative)
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

export type EnvVarPatch = { key: string; value?: string; secret?: boolean }

// {{env.KEY}} is read by a path reader that splits on dots, so a key with a dot resolves to
// nothing and the step is skipped naming a reference nobody can find. Braces and whitespace
// go the same way for the same reason.
const USABLE_KEY = /^[^.\s{}]+$/

export async function writeEnvVar(
  root: string,
  relative: string,
  patch: EnvVarPatch,
): Promise<EnvDef> {
  if (!USABLE_KEY.test(patch.key)) {
    throw new FileRequestError(`"${patch.key}" is not a usable variable key`)
  }
  if (patch.value !== undefined && typeof patch.value !== 'string') {
    throw new FileRequestError(`value for "${patch.key}" must be a string`)
  }

  const path = resolvePath(root, relative)
  const parsed = (await readJson(root, relative)) as Record<string, unknown>
  if (!parsed || !Array.isArray(parsed.vars)) {
    throw new FileRequestError(`"${relative}" has no vars array`)
  }

  const vars = parsed.vars as EnvVar[]
  const at = vars.findIndex((item) => item.key === patch.key)
  const current: EnvVar = at === -1 ? { key: patch.key, value: '' } : vars[at]

  // Un-marking a secret clears the value: otherwise it would be an unmasking, and the next
  // read would hand out a value that was stored as a secret. A request that carries a new
  // value is the exception — the caller supplied that plaintext, so nothing is revealed.
  const unmasked = current.secret === true && patch.secret === false
  const secret = patch.secret ?? current.secret ?? false

  const next: EnvVar = {
    key: patch.key,
    value: unmasked && patch.value === undefined ? '' : (patch.value ?? current.value ?? ''),
  }
  if (secret) next.secret = true

  if (at === -1) vars.push(next)
  else vars[at] = next

  // Rename rather than truncate-and-write: a crash mid-write then leaves the old file intact
  // instead of half a file. Same directory, so the rename cannot cross a device boundary.
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  await rename(temporary, path)

  return parsed as unknown as EnvDef
}
