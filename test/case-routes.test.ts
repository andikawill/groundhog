import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestCase } from '../lib/engine/index'

// The routes read GROUNDHOG_CASES and GROUNDHOG_ENVS through lib/service/config, which captures
// them at import time. Importing dynamically, after both point at temporary directories, is
// what keeps these tests out of examples/.
let listCases: () => Promise<Response>
let postCase: (request: Request) => Promise<Response>
let getCase: (r: Request, c: { params: Promise<{ file: string }> }) => Promise<Response>
let putCase: (r: Request, c: { params: Promise<{ file: string }> }) => Promise<Response>
let cases: string
let envs: string

const CASE: TestCase = {
  name: 'demo',
  steps: [{ id: 'one', method: 'GET', url: '{{env.API}}/one' }],
}

beforeAll(async () => {
  cases = await mkdtemp(join(tmpdir(), 'groundhog-case-routes-'))
  envs = await mkdtemp(join(tmpdir(), 'groundhog-case-envs-'))
  process.env.GROUNDHOG_CASES = cases
  process.env.GROUNDHOG_ENVS = envs
  const list = await import('../app/api/cases/route')
  listCases = list.GET
  postCase = list.POST
  const one = await import('../app/api/cases/[file]/route')
  getCase = one.GET
  putCase = one.PUT
})

beforeEach(async () => {
  await writeFile(join(cases, 'demo.case.json'), `${JSON.stringify(CASE, null, 2)}\n`)
  await writeFile(
    join(envs, 'staging.env.json'),
    `${JSON.stringify(
      { name: 'staging', vars: [{ key: 'API', value: 'https://x.test' }] },
      null,
      2,
    )}\n`,
  )
})

const put = (file: string, body: unknown) =>
  putCase(
    new Request(`http://local/api/cases/${file}`, { method: 'PUT', body: JSON.stringify(body) }),
    { params: Promise.resolve({ file }) },
  )

const onDisk = async () =>
  JSON.parse(await readFile(join(cases, 'demo.case.json'), 'utf8')) as TestCase

describe('GET /api/cases', () => {
  it('lists the file, the case name and the step count', async () => {
    const body = await (await listCases()).json()
    expect(body.cases).toContainEqual({ file: 'demo.case.json', name: 'demo', steps: 1 })
  })
})

describe('GET /api/cases/:file', () => {
  it('returns the case', async () => {
    const res = await getCase(new Request('http://local/x'), {
      params: Promise.resolve({ file: 'demo.case.json' }),
    })
    expect((await res.json()).name).toBe('demo')
  })

  it('refuses a path outside the root', async () => {
    const res = await getCase(new Request('http://local/x'), {
      params: Promise.resolve({ file: '../escaped.case.json' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/cases/:file', () => {
  it('writes the case and returns it', async () => {
    const next = { ...CASE, name: 'renamed' }
    const res = await put('demo.case.json', { case: next })
    expect(res.status).toBe(200)
    expect((await res.json()).case.name).toBe('renamed')
    expect((await onDisk()).name).toBe('renamed')
  })

  it('returns pre-flight findings as warnings without refusing the write', async () => {
    const next: TestCase = {
      ...CASE,
      steps: [{ id: 'one', method: 'GET', url: '{{env.MISSING}}/one' }],
    }
    const res = await put('demo.case.json', { case: next, envPath: 'staging.env.json' })
    expect(res.status).toBe(200)
    expect((await res.json()).warnings.join(' ')).toContain('MISSING')
    expect((await onDisk()).steps[0].url).toContain('MISSING')
  })

  it('writes nothing on a dry run but still warns', async () => {
    const next: TestCase = {
      ...CASE,
      name: 'not written',
      steps: [{ id: 'one', method: 'GET', url: '{{env.MISSING}}/one' }],
    }
    const res = await put('demo.case.json', {
      case: next,
      envPath: 'staging.env.json',
      dryRun: true,
    })
    expect(res.status).toBe(200)
    expect((await res.json()).warnings.join(' ')).toContain('MISSING')
    expect((await onDisk()).name).toBe('demo')
  })

  it('refuses a shape error with a 400 and leaves the file alone', async () => {
    const res = await put('demo.case.json', { case: { ...CASE, steps: [] } })
    expect(res.status).toBe(400)
    expect((await res.json()).errors.join(' ')).toContain('step')
    expect((await onDisk()).steps).toHaveLength(1)
  })

  it('refuses a body that is not JSON', async () => {
    const res = await putCase(
      new Request('http://local/api/cases/demo.case.json', { method: 'PUT', body: 'nope' }),
      { params: Promise.resolve({ file: 'demo.case.json' }) },
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/cases', () => {
  it('creates a case and refuses to overwrite one', async () => {
    const made = await postCase(
      new Request('http://local/api/cases', {
        method: 'POST',
        body: JSON.stringify({ file: 'fresh.case.json', name: 'fresh' }),
      }),
    )
    expect(made.status).toBe(201)
    expect((await made.json()).case.name).toBe('fresh')

    const again = await postCase(
      new Request('http://local/api/cases', {
        method: 'POST',
        body: JSON.stringify({ file: 'demo.case.json', name: 'demo' }),
      }),
    )
    expect(again.status).toBe(400)
  })
})
