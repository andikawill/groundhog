import { listSelectableFiles, readEnvFile } from './files'
import type { EnvDef } from '../engine/index'

// A filename, not a flag inside the JSON: EnvDef does not change, the engine learns nothing
// new, and resolveEnv(shared, active) keeps working exactly as it does for the CLI.
export const SHARED_FILE = 'shared.env.json'

export type CellView = { key: string; secret: boolean; hasValue: boolean; value?: string }
export type EnvFileView = { file: string; name: string; guard: string; vars: CellView[] }
export type EnvMatrix = { root: string; shared: EnvFileView | null; envs: EnvFileView[] }

export function toEnvFileView(file: string, env: EnvDef): EnvFileView {
  return {
    file,
    name: env.name,
    guard: env.guard ?? 'none',
    vars: env.vars.map((item) => {
      const stored = typeof item.value === 'string' ? item.value : ''
      const cell: CellView = {
        key: item.key,
        secret: item.secret === true,
        // Pre-flight refuses an empty string exactly as it refuses a missing key, so the
        // screen draws both the same way.
        hasValue: stored !== '',
      }
      // The value of a secret is left off entirely. Absent is the only encoding that cannot
      // be mistaken for a value, which null and a mask both can.
      if (!cell.secret) cell.value = stored
      return cell
    }),
  }
}

export async function readEnvMatrix(root: string): Promise<EnvMatrix> {
  const files = await listSelectableFiles(root, '.env.json')
  let shared: EnvFileView | null = null
  const envs: EnvFileView[] = []

  for (const file of files) {
    let env: EnvDef
    try {
      env = await readEnvFile(root, file)
    } catch {
      // One unparseable file should not empty the whole screen. It is simply not a column.
      continue
    }
    const view = toEnvFileView(file, env)
    if (file === SHARED_FILE) shared = view
    else envs.push(view)
  }

  return { root, shared, envs }
}
