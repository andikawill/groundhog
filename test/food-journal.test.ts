import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runCase } from '../lib/engine/run'
import { resolveEnv } from '../lib/engine/preflight'
import { startMock, type MockHandle } from './mock-server'
import type { TestCase } from '../lib/engine/types'

let mock: MockHandle
const ANCHOR = Date.parse('2026-08-20T00:00:00.000Z')

afterEach(async () => {
  await mock?.close()
})

describe('food-journal reference case', () => {
  it('runs the whole cycle against a mock backend', async () => {
    mock = await startMock({
      'POST /v1/media/presigned-url': () => ({
        body: JSON.stringify({ data: { uploadUrl: `${mock.url}/upload-target`, key: 'u/3f9c.jpg' } }),
      }),
      'PUT /upload-target': () => ({ headers: { etag: 'W/"e1"' }, body: '' }),
      'GET /v1/food/classification': (req) => ({
        body: JSON.stringify({
          data: {
            status: req.hit < 2 ? 'pending' : 'done',
            items: [{ name: 'nasi lemak', kcal: 400 }],
          },
        }),
      }),
      'POST /v1/food-journal': (req) => ({
        body: JSON.stringify({ data: { id: 'j_1', received: JSON.parse(req.body) } }),
      }),
      'GET /v1/food-journal/j_1': () => ({
        body: JSON.stringify({ data: { imageKey: 'u/3f9c.jpg', items: [{ name: 'nasi lemak' }] } }),
      }),
      'GET /v1/food-journal/j_1/comment': () => ({
        body: JSON.stringify({ data: [{ text: 'nasi lemak sekitar 400 kkal' }] }),
      }),
      'DELETE /v1/food-journal/j_1': () => ({ body: '{}' }),
    })

    const testCase = JSON.parse(
      readFileSync('examples/food-journal.case.json', 'utf8'),
    ) as TestCase

    const result = await runCase({
      case: testCase,
      env: resolveEnv(undefined, {
        name: 'mock',
        vars: [
          { key: 'API', value: mock.url },
          { key: 'TOKEN', value: 'tok_secret_value', secret: true },
        ],
      }),
      seed: 'fj-seed',
      anchorAt: ANCHOR,
      assetsDir: 'test/assets',
    })

    expect(result.steps.map((s) => `${s.id}:${s.status}`)).toEqual([
      'presign:passed',
      'upload:passed',
      'classify:passed',
      'save:passed',
      'journal:passed',
      'comment:passed',
      'cleanup:passed',
    ])
    expect(result.status).toBe('passed')
  })

  it('sends the classification items as an array, not a string', async () => {
    let savedBody = ''
    mock = await startMock({
      'POST /v1/media/presigned-url': () => ({
        body: JSON.stringify({ data: { uploadUrl: `${mock.url}/upload-target`, key: 'u/3f9c.jpg' } }),
      }),
      'PUT /upload-target': () => ({ headers: { etag: 'W/"e1"' }, body: '' }),
      'GET /v1/food/classification': () => ({
        body: JSON.stringify({ data: { status: 'done', items: [{ name: 'nasi lemak' }] } }),
      }),
      'POST /v1/food-journal': (req) => {
        savedBody = req.body
        return { body: JSON.stringify({ data: { id: 'j_1' } }) }
      },
      'GET /v1/food-journal/j_1': () => ({
        body: JSON.stringify({ data: { imageKey: 'u/3f9c.jpg', items: [{ name: 'nasi lemak' }] } }),
      }),
      'GET /v1/food-journal/j_1/comment': () => ({ body: JSON.stringify({ data: [{ text: 'ok' }] }) }),
      'DELETE /v1/food-journal/j_1': () => ({ body: '{}' }),
    })

    const testCase = JSON.parse(
      readFileSync('examples/food-journal.case.json', 'utf8'),
    ) as TestCase

    await runCase({
      case: testCase,
      env: resolveEnv(undefined, {
        name: 'mock',
        vars: [
          { key: 'API', value: mock.url },
          { key: 'TOKEN', value: 'tok_secret_value', secret: true },
        ],
      }),
      seed: 'fj-seed',
      anchorAt: ANCHOR,
      assetsDir: 'test/assets',
    })

    expect(Array.isArray(JSON.parse(savedBody).items)).toBe(true)
  })

  it('skips cleanup instead of deleting a collection when save never produced an id', async () => {
    mock = await startMock({
      'POST /v1/media/presigned-url': () => ({
        body: JSON.stringify({ data: { uploadUrl: `${mock.url}/upload-target`, key: 'u/3f9c.jpg' } }),
      }),
      'PUT /upload-target': () => ({ headers: { etag: 'W/"e1"' }, body: '' }),
      'GET /v1/food/classification': () => ({
        body: JSON.stringify({ data: { status: 'done', items: [] } }),
      }),
      'POST /v1/food-journal': () => ({ status: 500, body: '{}' }),
    })

    const testCase = JSON.parse(
      readFileSync('examples/food-journal.case.json', 'utf8'),
    ) as TestCase

    const result = await runCase({
      case: testCase,
      env: resolveEnv(undefined, {
        name: 'mock',
        vars: [
          { key: 'API', value: mock.url },
          { key: 'TOKEN', value: 'tok_secret_value', secret: true },
        ],
      }),
      seed: 'fj-seed',
      anchorAt: ANCHOR,
      assetsDir: 'test/assets',
    })

    const cleanup = result.steps.find((s) => s.id === 'cleanup')
    expect(cleanup?.status).toBe('skipped')
    expect(cleanup?.reason).toContain('ctx.journalId')
    expect(mock.hits['DELETE /v1/food-journal']).toBeUndefined()
  })
})
