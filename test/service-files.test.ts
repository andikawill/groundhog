import { describe, expect, it } from 'vitest'
import { FileRequestError, listSelectableFiles, readCaseFile, readEnvFile } from '../lib/service/files'

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
