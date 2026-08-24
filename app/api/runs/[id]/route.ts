import { NextResponse } from 'next/server'
import { getRun } from '../../../../lib/store/runs'

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const run = await getRun(id)
  if (!run) return NextResponse.json({ error: 'no such run' }, { status: 404 })
  return NextResponse.json(run)
}
