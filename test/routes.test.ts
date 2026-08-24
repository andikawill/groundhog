import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../lib/store/db'
import { GET as getFiles } from '../app/api/files/route'
import { GET as listRuns, POST as postRun } from '../app/api/runs/route'
import { GET as getOneRun } from '../app/api/runs/[id]/route'
import { POST as postResume } from '../app/api/runs/[id]/resume/route'

beforeEach(async () => {
  await db.run.deleteMany()
})

afterEach(async () => {
  await db.run.deleteMany()
})

const post = (body: unknown) =>
  new Request('http://local/api/runs', { method: 'POST', body: JSON.stringify(body) })

describe('GET /api/files', () => {
  it('lists the selectable cases and envs', async () => {
    const body = await (await getFiles()).json()
    expect(body.cases).toContain('food-journal.case.json')
    expect(body.envs).toContain('staging.env.json')
  })
})

describe('POST /api/runs', () => {
  it('rejects a path that climbs out of the configured root', async () => {
    const res = await postRun(post({ casePath: '../package.json', envPath: 'staging.env.json' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBeTruthy()
    expect(await db.run.count()).toBe(0)
  })

  it('rejects a missing body field', async () => {
    const res = await postRun(post({ casePath: 'food-journal.case.json' }))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/runs', () => {
  it('lists the runs that exist, newest first', async () => {
    const first = await postRun(post({ casePath: 'food-journal.case.json', envPath: 'staging.env.json' }))
    expect(first.status).toBe(201)
    const second = await postRun(post({ casePath: 'food-journal.case.json', envPath: 'staging.env.json' }))
    const { id } = await second.json()

    const body = await (await listRuns(new Request('http://local/api/runs'))).json()
    expect(body.runs).toHaveLength(2)
    expect(body.runs[0].id).toBe(id)
    expect(body.runs[0].caseName).toBe('food-journal')
  })

  it('honours a limit from the query string', async () => {
    await postRun(post({ casePath: 'food-journal.case.json', envPath: 'staging.env.json' }))
    await postRun(post({ casePath: 'food-journal.case.json', envPath: 'staging.env.json' }))
    const body = await (await listRuns(new Request('http://local/api/runs?limit=1'))).json()
    expect(body.runs).toHaveLength(1)
  })
})

describe('GET /api/runs/:id', () => {
  it('404s an unknown id', async () => {
    const res = await getOneRun(new Request('http://local/x'), {
      params: Promise.resolve({ id: 'nope' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/runs/:id/resume', () => {
  it('409s a run that is not awaiting', async () => {
    const res = await postResume(
      new Request('http://local/x', {
        method: 'POST',
        body: JSON.stringify({ decision: 'continue' }),
      }),
      { params: Promise.resolve({ id: 'nope' }) },
    )
    expect(res.status).toBe(409)
    expect((await res.json()).resumed).toBe(false)
  })

  it('rejects a decision that is neither continue nor skip', async () => {
    const res = await postResume(
      new Request('http://local/x', { method: 'POST', body: JSON.stringify({ decision: 'maybe' }) }),
      { params: Promise.resolve({ id: 'nope' }) },
    )
    expect(res.status).toBe(400)
  })
})
