import { NextResponse } from 'next/server'
import { CASE_ROOT, ENV_ROOT } from '../../../lib/service/config'
import { listSelectableFiles } from '../../../lib/service/files'

export async function GET() {
  const [cases, envs] = await Promise.all([
    listSelectableFiles(CASE_ROOT, '.case.json'),
    listSelectableFiles(ENV_ROOT, '.env.json'),
  ])
  return NextResponse.json({ cases, envs })
}
