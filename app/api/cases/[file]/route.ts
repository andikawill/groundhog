import { NextResponse } from 'next/server'
import { preflight, resolveEnv } from '../../../../lib/engine/index'
import type { EnvDef, TestCase } from '../../../../lib/engine/index'
import { CASE_ROOT, ENV_ROOT } from '../../../../lib/service/config'
import { readCase, validateCase, writeCase } from '../../../../lib/service/cases'
import { SHARED_FILE } from '../../../../lib/service/envs'
import { FileRequestError, readEnvFile } from '../../../../lib/service/files'

export async function GET(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params
  try {
    return NextResponse.json(await readCase(CASE_ROOT, file))
  } catch (error) {
    if (error instanceof FileRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }
}

// Pre-flight needs an env, and an env the editor has not chosen is not a reason to say nothing.
async function warningsFor(testCase: TestCase, envPath: unknown): Promise<string[]> {
  if (typeof envPath !== 'string' || envPath === '') return []

  let active: EnvDef
  try {
    active = await readEnvFile(ENV_ROOT, envPath)
  } catch {
    return []
  }

  let shared: EnvDef | undefined
  try {
    shared = await readEnvFile(ENV_ROOT, SHARED_FILE)
  } catch {
    shared = undefined
  }

  // confirmed: true on purpose. A confirm guard is a question asked when a run starts, not a
  // fault in the declaration being edited, and reporting it here would train the reader to
  // ignore warnings.
  return preflight({ case: testCase, env: resolveEnv(shared, active), confirmed: true })
}

export async function PUT(request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params

  let body: { case?: unknown; envPath?: unknown; dryRun?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'body is not JSON' }, { status: 400 })
  }

  const errors = validateCase(body.case)
  if (errors.length > 0) return NextResponse.json({ errors }, { status: 400 })

  const testCase = body.case as TestCase
  const warnings = await warningsFor(testCase, body.envPath)

  // A dry run is the same validation and the same pre-flight with the write left out. One
  // endpoint, so what warned you while typing cannot drift from what accepts the save.
  if (body.dryRun === true) return NextResponse.json({ case: testCase, warnings })

  try {
    return NextResponse.json({ case: await writeCase(CASE_ROOT, file, testCase), warnings })
  } catch (error) {
    if (error instanceof FileRequestError) {
      return NextResponse.json({ errors: [error.message] }, { status: 400 })
    }
    throw error
  }
}
