import { NextResponse } from 'next/server'
import { ASSETS_DIR } from '../../../../../lib/service/config'
import { startRun } from '../../../../../lib/service/execute'
import { FileRequestError } from '../../../../../lib/service/files'
import { getRun } from '../../../../../lib/store/runs'

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const run = await getRun(id)
  if (!run) return NextResponse.json({ error: 'no such run' }, { status: 404 })

  try {
    const replayed = await startRun({
      caseRoot: run.caseRoot,
      casePath: run.casePath,
      envRoot: run.envRoot,
      envPath: run.envPath,
      sharedPath: run.sharedPath ?? undefined,
      assetsDir: ASSETS_DIR,
      seed: run.seed,
      anchorAt: run.anchorAt,
    })
    return NextResponse.json({ id: replayed }, { status: 201 })
  } catch (error) {
    if (error instanceof FileRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }
}
