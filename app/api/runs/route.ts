import { NextResponse } from 'next/server'
import { ASSETS_DIR, CASE_ROOT, ENV_ROOT } from '../../../lib/service/config'
import { FileRequestError } from '../../../lib/service/files'
import { startRun } from '../../../lib/service/execute'

export async function POST(request: Request) {
  let body: {
    casePath?: string
    envPath?: string
    sharedPath?: string
    seed?: string
    anchor?: string
    confirmed?: boolean
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'body is not JSON' }, { status: 400 })
  }

  if (!body.casePath || !body.envPath) {
    return NextResponse.json({ error: 'casePath and envPath are required' }, { status: 400 })
  }

  const anchorAt = body.anchor ? new Date(body.anchor) : undefined
  if (anchorAt && Number.isNaN(anchorAt.getTime())) {
    return NextResponse.json({ error: `anchor "${body.anchor}" is not a date` }, { status: 400 })
  }

  try {
    const id = await startRun({
      caseRoot: CASE_ROOT,
      casePath: body.casePath,
      envRoot: ENV_ROOT,
      envPath: body.envPath,
      sharedPath: body.sharedPath,
      assetsDir: ASSETS_DIR,
      seed: body.seed,
      anchorAt,
      confirmed: body.confirmed,
    })
    return NextResponse.json({ id }, { status: 201 })
  } catch (error) {
    if (error instanceof FileRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }
}
