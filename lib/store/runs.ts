import { Prisma } from '@prisma/client'
import { db } from './db'
import type { RunState, RunStep, Step } from '../engine/index'

// A nullable Json column takes Prisma.DbNull, not null: `null` is reserved for "leave it
// alone" in a Prisma update, so the client refuses it as a value.
const CLEARED = Prisma.DbNull

export type RunStatus = 'running' | 'awaiting' | 'interrupted' | 'passed' | 'failed'

export type CaseSnapshot = {
  steps: Step[]
  pools?: Record<string, string[]>
  redact?: string[]
}

export type EnvSnapshot = { name: string; vars: Record<string, string> }

export type StoredRun = {
  id: string
  caseName: string
  caseRoot: string
  casePath: string
  envName: string
  envRoot: string
  envPath: string
  sharedPath: string | null
  status: RunStatus
  seed: string
  anchorAt: Date
  caseSnapshot: CaseSnapshot
  envSnapshot: EnvSnapshot
  results: RunStep[]
  startedAt: Date
  endedAt: Date | null
}

export async function createRun(input: {
  caseName: string
  caseRoot: string
  casePath: string
  envName: string
  envRoot: string
  envPath: string
  sharedPath: string | null
  assetsDir: string
  seed: string
  anchorAt: Date
  caseSnapshot: CaseSnapshot
  envSnapshot: EnvSnapshot
}): Promise<string> {
  const row = await db.run.create({
    data: {
      caseName: input.caseName,
      caseRoot: input.caseRoot,
      casePath: input.casePath,
      envName: input.envName,
      envRoot: input.envRoot,
      envPath: input.envPath,
      sharedPath: input.sharedPath,
      assetsDir: input.assetsDir,
      seed: input.seed,
      anchorAt: input.anchorAt,
      status: 'running',
      caseSnapshot: input.caseSnapshot as object,
      envSnapshot: input.envSnapshot as object,
      results: [],
    },
    select: { id: true },
  })
  return row.id
}

export async function getRun(id: string): Promise<StoredRun | null> {
  const row = await db.run.findUnique({
    where: { id },
    select: {
      id: true,
      caseName: true,
      caseRoot: true,
      casePath: true,
      envName: true,
      envRoot: true,
      envPath: true,
      sharedPath: true,
      status: true,
      seed: true,
      anchorAt: true,
      caseSnapshot: true,
      envSnapshot: true,
      results: true,
      startedAt: true,
      endedAt: true,
    },
  })
  if (!row) return null
  return {
    ...row,
    status: row.status as RunStatus,
    caseSnapshot: row.caseSnapshot as unknown as CaseSnapshot,
    envSnapshot: row.envSnapshot as unknown as EnvSnapshot,
    results: row.results as unknown as RunStep[],
  }
}

// No step count and no results: counting them means reading every stored body, and a body is
// capped at 256 KB, so a page of fifty runs would move tens of megabytes to render a number.
// If the count turns out to be worth having, it wants a column of its own.
export type RunSummary = {
  id: string
  caseName: string
  envName: string
  status: RunStatus
  startedAt: Date
  endedAt: Date | null
}

export async function listRuns(limit = 50): Promise<RunSummary[]> {
  const rows = await db.run.findMany({
    // startedAt alone is not a total order: two runs started in the same millisecond tie, and
    // the list then reorders itself between refreshes. cuid sorts by creation within a
    // process, so the id breaks the tie the way a reader expects.
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(Math.trunc(limit), 1), 200),
    select: {
      id: true,
      caseName: true,
      envName: true,
      status: true,
      startedAt: true,
      endedAt: true,
    },
  })
  return rows.map((row) => ({ ...row, status: row.status as RunStatus }))
}

const appendQueues = new Map<string, Promise<void>>()

export async function appendStep(id: string, step: RunStep): Promise<void> {
  const previous = appendQueues.get(id) ?? Promise.resolve()
  const next = previous.then(async () => {
    const row = await db.run.findUnique({ where: { id }, select: { results: true } })
    const results = [...((row?.results ?? []) as unknown as RunStep[]), step]
    await db.run.update({ where: { id }, data: { results: results as object[] } })
  })
  appendQueues.set(id, next.catch(() => undefined))
  await next
}

export async function finishRun(id: string, status: 'passed' | 'failed'): Promise<void> {
  await db.run.update({
    where: { id },
    data: { status, endedAt: new Date(), pauseState: CLEARED },
  })
}

export async function pauseRun(id: string, state: RunState): Promise<void> {
  await db.run.update({
    where: { id },
    data: { status: 'awaiting', pauseState: state as object },
  })
}

export async function claimResume(id: string): Promise<{
  state: RunState
  steps: RunStep[]
  envRoot: string
  envPath: string
  sharedPath: string | null
  assetsDir: string
  caseSnapshot: CaseSnapshot
  seed: string
  anchorAt: Date
  caseName: string
} | null> {
  const claimed = await db.run.updateMany({
    where: { id, status: 'awaiting' },
    data: { status: 'running' },
  })
  if (claimed.count !== 1) return null

  const row = await db.run.findUnique({ where: { id } })
  if (!row || row.pauseState === null) return null

  await db.run.update({ where: { id }, data: { pauseState: CLEARED } })

  return {
    state: row.pauseState as unknown as RunState,
    steps: row.results as unknown as RunStep[],
    envRoot: row.envRoot,
    envPath: row.envPath,
    sharedPath: row.sharedPath,
    assetsDir: row.assetsDir,
    caseSnapshot: row.caseSnapshot as unknown as CaseSnapshot,
    seed: row.seed,
    anchorAt: row.anchorAt,
    caseName: row.caseName,
  }
}

export async function markOrphansInterrupted(): Promise<number> {
  const result = await db.run.updateMany({
    where: { status: 'running' },
    data: { status: 'interrupted', endedAt: new Date(), pauseState: CLEARED },
  })
  return result.count
}
