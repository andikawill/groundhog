import { parseDurationStrict } from '../engine/index'
import type { Body, Method, Step, TestCase } from '../engine/index'
import { FileRequestError, isUsableName, readCaseFile, writeJsonFile } from './files'

const METHODS: Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

// The fields the editor owns. Anything else on a step is somebody's hand-written note and is
// carried through untouched; these are replaced by exactly what the editor sent, which is what
// makes removing a flag remove it.
const MODELLED = new Set([
  'id',
  'title',
  'method',
  'url',
  'headers',
  'body',
  'extract',
  'assert',
  'needs',
  'always',
  'pause',
  'delay',
  'retryUntil',
  'every',
  'timeout',
])

const filled = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== ''

function bodyErrors(where: string, body: unknown): string[] {
  if (!body || typeof body !== 'object') return [`${where} has a body that is not an object`]
  const shape = body as Body
  switch (shape.type) {
    case 'json':
      // The document arrived as JSON, so the value parsed by definition. Only its presence is
      // in question here; the editor is what refuses text that will not parse.
      return 'value' in shape ? [] : [`${where} has a json body with no value`]
    case 'file':
      return filled(shape.path) ? [] : [`${where} has a file body with no path`]
    case 'raw':
      return [
        ...(typeof shape.value === 'string' ? [] : [`${where} has a raw body with no value`]),
        ...(filled(shape.contentType) ? [] : [`${where} has a raw body with no contentType`]),
      ]
    case 'form':
      return Object.values(shape.value ?? {}).every((v) => typeof v === 'string')
        ? []
        : [`${where} has a form body with a value that is not text`]
    case 'multipart':
      return Object.values(shape.value ?? {}).every(
        (v) => typeof v === 'string' || (!!v && typeof v === 'object' && filled(v.file)),
      )
        ? []
        : [`${where} has a multipart body with an entry that is neither text nor a file`]
    default:
      return [`${where} has an unknown body type`]
  }
}

function assertErrors(where: string, asserts: unknown): string[] {
  if (!Array.isArray(asserts)) return [`${where} has an assert list that is not a list`]
  // Either variant is acceptable here even though the editor only authors expressions: a file
  // may already hold a semantic assert, and refusing it would make that file unsavable.
  const ok = asserts.every((entry: { expr?: unknown; semantic?: unknown }) =>
    filled(entry?.expr) || filled(entry?.semantic),
  )
  return ok ? [] : [`${where} has an assert with neither an expression nor a semantic`]
}

function durationErrors(where: string, step: Step): string[] {
  const errors: string[] = []
  for (const field of ['delay', 'retryUntil', 'every', 'timeout'] as const) {
    const raw = step[field]
    if (raw !== undefined && (typeof raw !== 'string' || parseDurationStrict(raw) === null)) {
      errors.push(`${where} has an unparseable ${field}: "${String(raw)}"`)
    }
  }
  return errors
}

export function validateCase(input: unknown): string[] {
  if (!input || typeof input !== 'object') return ['a case must be an object']
  const testCase = input as TestCase
  const errors: string[] = []

  if (!filled(testCase.name)) errors.push('the case needs a name')
  if (!Array.isArray(testCase.steps) || testCase.steps.length === 0) {
    errors.push('a case needs at least one step')
    return errors
  }

  const ids = new Set<string>()
  testCase.steps.forEach((step, index) => {
    const where = filled(step?.id) ? `step "${step.id}"` : `step ${index + 1}`
    if (!step || typeof step !== 'object') {
      errors.push(`${where} is not an object`)
      return
    }
    if (!filled(step.id) || !isUsableName(step.id)) {
      errors.push(`${where} needs an id without spaces, dots or braces`)
    } else if (ids.has(step.id)) {
      errors.push(`two steps share the id "${step.id}"`)
    } else {
      ids.add(step.id)
    }
    if (!METHODS.includes(step.method)) errors.push(`${where} has an unknown method`)
    if (!filled(step.url)) errors.push(`${where} needs a url`)
    if (step.headers && Object.values(step.headers).some((v) => typeof v !== 'string')) {
      errors.push(`${where} has a header whose value is not text`)
    }
    if (step.body !== undefined) errors.push(...bodyErrors(where, step.body))
    if (step.assert !== undefined) errors.push(...assertErrors(where, step.assert))
    for (const key of Object.keys(step.extract ?? {})) {
      if (!isUsableName(key)) {
        errors.push(`${where} has an extract name "${key}" the path reader would split`)
      } else if (!filled(step.extract?.[key])) {
        errors.push(`${where} has an empty extract for "${key}"`)
      }
    }
    errors.push(...durationErrors(where, step))
  })

  for (const step of testCase.steps) {
    for (const need of step?.needs ?? []) {
      if (!ids.has(need)) {
        errors.push(`step "${step.id}" needs "${need}", which is not a step in this case`)
      }
    }
  }

  for (const [name, values] of Object.entries(testCase.pools ?? {})) {
    if (!isUsableName(name)) {
      errors.push(`pool "${name}" needs a name without spaces, dots or braces`)
    }
    if (!Array.isArray(values) || values.length === 0) {
      errors.push(`pool "${name}" has no values`)
    } else if (values.some((v) => typeof v !== 'string')) {
      errors.push(`pool "${name}" has a value that is not text`)
    }
  }

  if (testCase.redact !== undefined && !Array.isArray(testCase.redact)) {
    errors.push('redact must be a list of names')
  }

  return errors
}

export async function readCase(root: string, relative: string): Promise<TestCase> {
  return readCaseFile(root, relative)
}

export async function writeCase(
  root: string,
  relative: string,
  next: TestCase,
): Promise<TestCase> {
  const errors = validateCase(next)
  if (errors.length > 0) throw new FileRequestError(errors.join('; '))

  // The browser sends a whole document, so a plain write would drop whatever the form does not
  // model. Merge instead: unknown top-level keys survive, and so do unknown keys on a step that
  // still exists, matched by id.
  const current = (await readCase(root, relative)) as unknown as Record<string, unknown>
  const before = new Map(
    ((current.steps as Record<string, unknown>[]) ?? []).map((step) => [
      step.id as string,
      step,
    ]),
  )

  const merged: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(next as unknown as Record<string, unknown>)) {
    merged[key] = value
  }
  merged.steps = next.steps.map((step) => {
    const kept = Object.fromEntries(
      Object.entries(before.get(step.id) ?? {}).filter(([key]) => !MODELLED.has(key)),
    )
    return { ...kept, ...step }
  })

  await writeJsonFile(root, relative, merged)
  return merged as unknown as TestCase
}

export async function createCase(
  root: string,
  relative: string,
  name: string,
): Promise<TestCase> {
  // Existence is decided by a failed read on purpose: the reader already maps a missing file,
  // an unreadable one and a path outside the root onto one error class, and a separate stat
  // would answer a different question than the one that matters — whether this service can
  // read it.
  let exists = true
  try {
    await readCase(root, relative)
  } catch {
    exists = false
  }
  if (exists) throw new FileRequestError(`"${relative}" already exists`)

  const fresh: TestCase = {
    name,
    steps: [{ id: 'first', method: 'GET', url: '{{env.API}}/' }],
  }
  const errors = validateCase(fresh)
  if (errors.length > 0) throw new FileRequestError(errors.join('; '))

  await writeJsonFile(root, relative, fresh)
  return fresh
}
