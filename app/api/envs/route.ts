import { NextResponse } from 'next/server'
import { ENV_ROOT } from '../../../lib/service/config'
import { readEnvMatrix } from '../../../lib/service/envs'

export async function GET() {
  return NextResponse.json(await readEnvMatrix(ENV_ROOT))
}
