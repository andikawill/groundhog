import { NextResponse } from 'next/server'
import { CASE_ROOT, ENV_ROOT } from '../../../lib/service/config'
import { SHARED_FILE } from '../../../lib/service/envs'
import { listSelectableFiles } from '../../../lib/service/files'

export async function GET() {
  const [cases, envs] = await Promise.all([
    listSelectableFiles(CASE_ROOT, '.case.json'),
    listSelectableFiles(ENV_ROOT, '.env.json'),
  ])
  // The shared file is the base layer every env resolves on top of, not an env you can run
  // against. Offering it in the picker invites a run whose variables are half missing.
  return NextResponse.json({ cases, envs: envs.filter((file) => file !== SHARED_FILE) })
}
