import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// lib/service/config captures GROUNDHOG_ENVS at import time, and these tests must not write
// to examples/ — it is tracked in git. Importing the routes dynamically, after the variable
// points at a temporary directory, is what buys that.
let getEnvs: () => Promise<Response>
let patchEnv: (
  request: Request,
  ctx: { params: Promise<{ file: string }> },
) => Promise<Response>
let getFiles: () => Promise<Response>
let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'groundhog-env-routes-'))
  process.env.GROUNDHOG_ENVS = dir
  getEnvs = (await import('../app/api/envs/route')).GET
  patchEnv = (await import('../app/api/envs/[file]/route')).PATCH
  getFiles = (await import('../app/api/files/route')).GET
})

beforeEach(async () => {
  await writeFile(
    join(dir, 'shared.env.json'),
    `${JSON.stringify({ name: 'shared', vars: [{ key: 'TENANT', value: 'naluri-my' }] }, null, 2)}\n`,
  )
  await writeFile(
    join(dir, 'staging.env.json'),
    `${JSON.stringify(
      {
        name: 'staging',
        guard: 'confirm',
        vars: [
          { key: 'API', value: 'https://x.test' },
          { key: 'TOKEN', value: 'tok_secret_value', secret: true },
        ],
      },
      null,
      2,
    )}\n`,
  )
})

const patch = (file: string, body: unknown) =>
  patchEnv(
    new Request(`http://local/api/envs/${file}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ file }) },
  )

const stagingOnDisk = async () =>
  JSON.parse(await readFile(join(dir, 'staging.env.json'), 'utf8')) as {
    vars: { key: string; value: string; secret?: boolean }[]
  }

describe('GET /api/envs', () => {
  it('separates the shared file from the rest and reports the root', async () => {
    const body = await (await getEnvs()).json()
    expect(body.root).toBe(dir)
    expect(body.shared.file).toBe('shared.env.json')
    expect(body.envs.map((e: { file: string }) => e.file)).toEqual(['staging.env.json'])
  })

  it('carries the guard and the plain values', async () => {
    const body = await (await getEnvs()).json()
    const staging = body.envs[0]
    expect(staging.guard).toBe('confirm')
    expect(staging.vars.find((v: { key: string }) => v.key === 'API').value).toBe('https://x.test')
  })

  it('sends no value for a secret, only that it is set', async () => {
    const body = await (await getEnvs()).json()
    const token = body.envs[0].vars.find((v: { key: string }) => v.key === 'TOKEN')
    expect(token.secret).toBe(true)
    expect(token.hasValue).toBe(true)
    expect('value' in token).toBe(false)
    expect(JSON.stringify(body)).not.toContain('tok_secret_value')
  })

  it('reports an empty value as not set', async () => {
    await writeFile(
      join(dir, 'staging.env.json'),
      `${JSON.stringify({ name: 'staging', vars: [{ key: 'API', value: '' }] }, null, 2)}\n`,
    )
    const body = await (await getEnvs()).json()
    expect(body.envs[0].vars[0].hasValue).toBe(false)
  })
})

describe('GET /api/files', () => {
  it('leaves the shared file out of the selectable envs', async () => {
    const body = await (await getFiles()).json()
    expect(body.envs).toContain('staging.env.json')
    expect(body.envs).not.toContain('shared.env.json')
  })
})

describe('PATCH /api/envs/:file', () => {
  it('writes the value and returns the updated column', async () => {
    const res = await patch('staging.env.json', { key: 'API', value: 'https://y.test' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.vars.find((v: { key: string }) => v.key === 'API').value).toBe('https://y.test')
    expect((await stagingOnDisk()).vars[0].value).toBe('https://y.test')
  })

  it('never returns the value of a variable it just made secret', async () => {
    const body = await (await patch('staging.env.json', { key: 'API', secret: true })).json()
    const api = body.vars.find((v: { key: string }) => v.key === 'API')
    expect(api.secret).toBe(true)
    expect('value' in api).toBe(false)
    expect((await stagingOnDisk()).vars[0].value).toBe('https://x.test')
  })

  it('clears the stored value when a secret is un-marked', async () => {
    await patch('staging.env.json', { key: 'TOKEN', secret: false })
    const token = (await stagingOnDisk()).vars.find((v) => v.key === 'TOKEN')
    expect(token?.value).toBe('')
  })

  it('refuses an unusable key and leaves the file alone', async () => {
    const res = await patch('staging.env.json', { key: 'API.URL', value: 'x' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBeTruthy()
    expect((await stagingOnDisk()).vars).toHaveLength(2)
  })

  it('refuses a path that climbs out of the root', async () => {
    const res = await patch('../escaped.env.json', { key: 'API', value: 'x' })
    expect(res.status).toBe(400)
  })

  it('refuses a body that is not JSON', async () => {
    const res = await patchEnv(
      new Request('http://local/api/envs/staging.env.json', { method: 'PATCH', body: 'nope' }),
      { params: Promise.resolve({ file: 'staging.env.json' }) },
    )
    expect(res.status).toBe(400)
  })

  it('refuses a value that is not a string', async () => {
    const res = await patch('staging.env.json', { key: 'API', value: 7 })
    expect(res.status).toBe(400)
  })
})
