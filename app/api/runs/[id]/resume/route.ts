import { NextResponse } from 'next/server'
import { resumeRun } from '../../../../../lib/service/execute'

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  let decision: unknown
  try {
    decision = (await request.json()).decision
  } catch {
    decision = undefined
  }
  if (decision !== 'continue' && decision !== 'skip') {
    return NextResponse.json({ error: 'decision must be continue or skip' }, { status: 400 })
  }
  const resumed = await resumeRun(id, decision)
  return NextResponse.json({ resumed }, { status: resumed ? 200 : 409 })
}
