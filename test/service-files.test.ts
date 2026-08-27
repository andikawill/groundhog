import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FileRequestError,
  listSelectableFiles,
  readCaseFile,
  readEnvFile,
  writeEnvVar,
} from '../lib/service/files'

describe('listSelectableFiles', () => {
  it('lists only the cases when asked for the case suffix', async () => {
    const files = await listSelectableFiles('examples', '.case.json')
    expect(files).toContain('food-journal.case.json')
    expect(files).not.toContain('staging.env.json')
    expect([...files].sort()).toEqual(files)
  })

  it('lists only the envs when asked for the env suffix', async () => {
    const files = await listSelectableFiles('examples', '.env.json')
    expect(files).toContain('staging.env.json')
    expect(files).not.toContain('food-journal.case.json')
  })

  it('returns an empty list for a directory that is not there', async () => {
    expect(await listSelectableFiles('no-such-dir', '.case.json')).toEqual([])
  })
})

describe('readCaseFile', () => {
  it('reads a case', async () => {
    const testCase = await readCaseFile('examples', 'food-journal.case.json')
    expect(testCase.name).toBe('food-journal')
    expect(testCase.steps.length).toBeGreaterThan(0)
  })

  it('refuses a path that climbs out of the root', async () => {
    await expect(readCaseFile('examples', '../package.json')).rejects.toBeInstanceOf(FileRequestError)
  })

  it('refuses an absolute path', async () => {
    await expect(readCaseFile('examples', '/etc/hosts')).rejects.toBeInstanceOf(FileRequestError)
  })

  it('refuses a file that is not there', async () => {
    await expect(readCaseFile('examples', 'nope.json')).rejects.toBeInstanceOf(FileRequestError)
  })

  it('refuses a case with no steps array', async () => {
    await expect(readCaseFile('examples', 'staging.env.json')).rejects.toBeInstanceOf(
      FileRequestError,
    )
  })
})

describe('readEnvFile', () => {
  it('reads an env', async () => {
    const env = await readEnvFile('examples', 'staging.env.json')
    expect(env.name).toBe('staging')
    expect(Array.isArray(env.vars)).toBe(true)
  })

  it('refuses an env with no vars array', async () => {
    await expect(readEnvFile('examples', 'food-journal.case.json')).rejects.toBeInstanceOf(
      FileRequestError,
    )
  })
})

describe('writeEnvVar', () => {
  let dir: string

  const FILE = 'staging.env.json'

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'groundhog-envs-'))
    await writeFile(
      join(dir, FILE),
      `${JSON.stringify(
        {
          name: 'staging',
          guard: 'readonly',
          note: 'a field this code does not model',
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

  const onDisk = async () =>
    JSON.parse(await readFile(join(dir, FILE), 'utf8')) as {
      name: string
      guard?: string
      note?: string
      vars: { key: string; value: string; secret?: boolean }[]
    }

  const varNamed = async (key: string) => (await onDisk()).vars.find((v) => v.key === key)

  it('updates a variable that already exists', async () => {
    await writeEnvVar(dir, FILE, { key: 'API', value: 'https://y.test' })
    expect((await varNamed('API'))?.value).toBe('https://y.test')
  })

  it('appends a variable that was absent', async () => {
    await writeEnvVar(dir, FILE, { key: 'TENANT', value: 'naluri-my' })
    expect((await varNamed('TENANT'))?.value).toBe('naluri-my')
  })

  it('leaves the other variables alone', async () => {
    await writeEnvVar(dir, FILE, { key: 'API', value: 'https://y.test' })
    expect((await varNamed('TOKEN'))?.value).toBe('tok_secret_value')
    expect((await varNamed('TOKEN'))?.secret).toBe(true)
  })

  it('preserves fields it does not model', async () => {
    await writeEnvVar(dir, FILE, { key: 'API', value: 'https://y.test' })
    const file = await onDisk()
    expect(file.guard).toBe('readonly')
    expect(file.note).toBe('a field this code does not model')
  })

  it('marks a variable secret without being given its value', async () => {
    await writeEnvVar(dir, FILE, { key: 'API', secret: true })
    expect(await varNamed('API')).toEqual({
      key: 'API',
      value: 'https://x.test',
      secret: true,
    })
  })

  it('clears the value when a secret is un-marked', async () => {
    await writeEnvVar(dir, FILE, { key: 'TOKEN', secret: false })
    const stored = await varNamed('TOKEN')
    expect(stored?.value).toBe('')
    expect(stored?.secret).toBeUndefined()
  })

  it('keeps a new plaintext value when un-marking in the same request', async () => {
    await writeEnvVar(dir, FILE, { key: 'TOKEN', secret: false, value: 'now-public' })
    expect((await varNamed('TOKEN'))?.value).toBe('now-public')
  })

  it('stores an empty string as a declared-but-empty value', async () => {
    await writeEnvVar(dir, FILE, { key: 'API', value: '' })
    expect((await varNamed('API'))?.value).toBe('')
  })

  it('refuses a key containing a dot, because {{env.KEY}} splits on dots', async () => {
    await expect(writeEnvVar(dir, FILE, { key: 'API.URL', value: 'x' })).rejects.toBeInstanceOf(
      FileRequestError,
    )
  })

  it('refuses an empty key and one with a space', async () => {
    await expect(writeEnvVar(dir, FILE, { key: '', value: 'x' })).rejects.toBeInstanceOf(
      FileRequestError,
    )
    await expect(writeEnvVar(dir, FILE, { key: 'A B', value: 'x' })).rejects.toBeInstanceOf(
      FileRequestError,
    )
  })

  it('refuses a path that climbs out of the root', async () => {
    await expect(
      writeEnvVar(dir, '../escaped.env.json', { key: 'API', value: 'x' }),
    ).rejects.toBeInstanceOf(FileRequestError)
  })

  it('refuses a file that is not an env', async () => {
    await writeFile(join(dir, 'broken.env.json'), '{"name":"broken"}\n')
    await expect(
      writeEnvVar(dir, 'broken.env.json', { key: 'API', value: 'x' }),
    ).rejects.toBeInstanceOf(FileRequestError)
  })

  it('writes two-space JSON ending in a newline', async () => {
    await writeEnvVar(dir, FILE, { key: 'API', value: 'https://y.test' })
    const text = await readFile(join(dir, FILE), 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "vars": [')
  })

  it('returns the file as it now stands', async () => {
    const env = await writeEnvVar(dir, FILE, { key: 'TENANT', value: 'naluri-my' })
    expect(env.vars.map((v) => v.key)).toEqual(['API', 'TOKEN', 'TENANT'])
  })
})
