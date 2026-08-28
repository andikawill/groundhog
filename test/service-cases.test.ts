import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileRequestError } from '../lib/service/files'
import { createCase, readCase, validateCase, writeCase } from '../lib/service/cases'
import type { TestCase } from '../lib/engine/index'

const CASE: TestCase = {
  name: 'demo',
  steps: [
    { id: 'one', method: 'GET', url: '{{env.API}}/one' },
    { id: 'two', method: 'POST', url: '{{env.API}}/two', needs: ['one'] },
  ],
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'groundhog-cases-'))
  await writeFile(
    join(dir, 'demo.case.json'),
    `${JSON.stringify(
      {
        name: 'demo',
        note: 'a field this code does not model',
        steps: [
          { id: 'one', method: 'GET', url: '{{env.API}}/one', pause: true, 'x-note': 'keep me' },
          { id: 'two', method: 'POST', url: '{{env.API}}/two', needs: ['one'] },
        ],
      },
      null,
      2,
    )}\n`,
  )
})

const onDisk = async () =>
  JSON.parse(await readFile(join(dir, 'demo.case.json'), 'utf8')) as Record<string, unknown>

const withStep = (patch: Record<string, unknown>): TestCase => ({
  ...CASE,
  steps: [{ ...CASE.steps[0], ...patch } as TestCase['steps'][0], CASE.steps[1]],
})

describe('validateCase', () => {
  it('accepts a case it can write', () => {
    expect(validateCase(CASE)).toEqual([])
  })

  it('refuses a case with no name and one with no steps', () => {
    expect(validateCase({ ...CASE, name: '' }).join(' ')).toContain('name')
    expect(validateCase({ ...CASE, steps: [] }).join(' ')).toContain('step')
  })

  it('refuses an id that is empty, spaced or dotted', () => {
    expect(validateCase(withStep({ id: '' })).join(' ')).toContain('id')
    expect(validateCase(withStep({ id: 'a b' })).join(' ')).toContain('id')
    expect(validateCase(withStep({ id: 'a.b' })).join(' ')).toContain('id')
  })

  it('refuses two steps sharing an id', () => {
    const twins: TestCase = { ...CASE, steps: [CASE.steps[0], { ...CASE.steps[0] }] }
    expect(validateCase(twins).join(' ')).toContain('share')
  })

  it('refuses an unknown method and a missing url', () => {
    expect(validateCase(withStep({ method: 'FETCH' })).join(' ')).toContain('method')
    expect(validateCase(withStep({ url: '' })).join(' ')).toContain('url')
  })

  it('refuses a needs that names a step which does not exist', () => {
    expect(validateCase(withStep({ needs: ['nope'] })).join(' ')).toContain('nope')
  })

  it('refuses a duration pre-flight would refuse, and accepts the ones it takes', () => {
    expect(validateCase(withStep({ every: '1min' })).join(' ')).toContain('every')
    expect(validateCase(withStep({ timeout: '30sec' })).join(' ')).toContain('timeout')
    expect(validateCase(withStep({ delay: '250ms', timeout: '2m', every: '3s' }))).toEqual([])
  })

  it('checks each body variant for the field that variant needs', () => {
    expect(validateCase(withStep({ body: { type: 'raw', value: 'x' } })).join(' ')).toContain(
      'contentType',
    )
    expect(validateCase(withStep({ body: { type: 'file' } })).join(' ')).toContain('path')
    expect(validateCase(withStep({ body: { type: 'nope', value: 1 } })).join(' ')).toContain(
      'body type',
    )
    expect(validateCase(withStep({ body: { type: 'json', value: { a: 1 } } }))).toEqual([])
    expect(
      validateCase(withStep({ body: { type: 'multipart', value: { a: { file: 'x.jpg' } } } })),
    ).toEqual([])
  })

  it('accepts an assert with an expr and one with a semantic, refuses an empty one', () => {
    expect(validateCase(withStep({ assert: [{ expr: 'status == 200' }] }))).toEqual([])
    expect(validateCase(withStep({ assert: [{ semantic: 'reads like an error' }] }))).toEqual([])
    expect(validateCase(withStep({ assert: [{ expr: '' }] })).join(' ')).toContain('assert')
  })

  it('refuses an extract key the path reader would split', () => {
    expect(validateCase(withStep({ extract: { 'a.b': '$.id' } })).join(' ')).toContain('extract')
  })

  it('refuses a pool with no values and a redact that is not a list', () => {
    expect(validateCase({ ...CASE, pools: { meals: [] } }).join(' ')).toContain('meals')
    expect(validateCase({ ...CASE, redact: 'token' }).join(' ')).toContain('redact')
  })
})

describe('writeCase', () => {
  it('writes the case and returns it', async () => {
    const written = await writeCase(dir, 'demo.case.json', { ...CASE, name: 'renamed' })
    expect(written.name).toBe('renamed')
    expect((await onDisk()).name).toBe('renamed')
  })

  it('keeps a top-level field it does not model', async () => {
    await writeCase(dir, 'demo.case.json', CASE)
    expect((await onDisk()).note).toBe('a field this code does not model')
  })

  it('keeps an unmodelled key on the step that still exists', async () => {
    await writeCase(dir, 'demo.case.json', CASE)
    const steps = (await onDisk()).steps as Record<string, unknown>[]
    expect(steps[0]['x-note']).toBe('keep me')
  })

  it('removes a modelled field the editor dropped', async () => {
    await writeCase(dir, 'demo.case.json', CASE)
    const steps = (await onDisk()).steps as Record<string, unknown>[]
    expect(steps[0].pause).toBeUndefined()
  })

  it('refuses to write a case that does not validate, leaving the file alone', async () => {
    await expect(writeCase(dir, 'demo.case.json', { ...CASE, steps: [] })).rejects.toBeInstanceOf(
      FileRequestError,
    )
    expect(((await onDisk()).steps as unknown[]).length).toBe(2)
  })

  it('refuses a path that climbs out of the root', async () => {
    await expect(writeCase(dir, '../escaped.case.json', CASE)).rejects.toBeInstanceOf(
      FileRequestError,
    )
  })

  it('writes two-space JSON ending in a newline', async () => {
    await writeCase(dir, 'demo.case.json', CASE)
    const text = await readFile(join(dir, 'demo.case.json'), 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "steps": [')
  })
})

describe('createCase', () => {
  it('creates a case with one step and reads back', async () => {
    const made = await createCase(dir, 'fresh.case.json', 'fresh')
    expect(made.name).toBe('fresh')
    expect(made.steps).toHaveLength(1)
    expect((await readCase(dir, 'fresh.case.json')).name).toBe('fresh')
  })

  it('refuses to overwrite a case that exists', async () => {
    await expect(createCase(dir, 'demo.case.json', 'demo')).rejects.toBeInstanceOf(
      FileRequestError,
    )
  })
})
