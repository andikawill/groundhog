import type { EnvDef, Guard, TestCase } from './types'
import { collectEnvRefs } from './template'

export type ResolvedEnv = {
  vars: Record<string, string>
  secrets: string[]
  guard: Guard
  name: string
}

export function resolveEnv(shared: EnvDef | undefined, active: EnvDef): ResolvedEnv {
  const vars: Record<string, string> = {}
  const secrets: string[] = []
  for (const source of [shared, active]) {
    for (const item of source?.vars ?? []) {
      vars[item.key] = item.value
      if (item.secret && item.value) secrets.push(item.value)
    }
  }
  return { vars, secrets, guard: active.guard ?? 'none', name: active.name }
}

export function preflight(input: {
  case: TestCase
  env: ResolvedEnv
  confirmed?: boolean
}): string[] {
  if (!Array.isArray(input.case.steps)) {
    return ['case has no steps array']
  }

  const errors: string[] = []

  for (const key of collectEnvRefs(input.case.steps)) {
    if (!input.env.vars[key]) {
      errors.push(`variable "${key}" is empty in env "${input.env.name}"`)
    }
  }

  if (input.env.guard === 'readonly') {
    for (const step of input.case.steps) {
      if (step.method !== 'GET') {
        errors.push(
          `env "${input.env.name}" is readonly; step "${step.id}" uses ${step.method}`,
        )
      }
    }
  }

  if (input.env.guard === 'confirm' && input.confirmed !== true) {
    errors.push(`env "${input.env.name}" requires confirmation before running`)
  }

  return errors
}
