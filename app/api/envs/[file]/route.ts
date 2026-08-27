import { NextResponse } from 'next/server'
import { ENV_ROOT } from '../../../../lib/service/config'
import { FileRequestError, writeEnvVar } from '../../../../lib/service/files'
import { toEnvFileView } from '../../../../lib/service/envs'

export async function PATCH(request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params

  let body: { key?: unknown; value?: unknown; secret?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'body is not JSON' }, { status: 400 })
  }

  if (typeof body.key !== 'string') {
    return NextResponse.json({ error: 'key is required' }, { status: 400 })
  }
  if (body.value !== undefined && typeof body.value !== 'string') {
    return NextResponse.json({ error: 'value must be a string' }, { status: 400 })
  }
  if (body.secret !== undefined && typeof body.secret !== 'boolean') {
    return NextResponse.json({ error: 'secret must be a boolean' }, { status: 400 })
  }

  try {
    const env = await writeEnvVar(ENV_ROOT, file, {
      key: body.key,
      value: body.value,
      secret: body.secret,
    })
    // Projected on the way out, so the response cannot carry the secret the write just stored.
    return NextResponse.json(toEnvFileView(file, env))
  } catch (error) {
    if (error instanceof FileRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }
}
