import { NextResponse } from 'next/server'
import { ASSETS_DIR } from '../../../lib/service/config'
import { listAssetFiles } from '../../../lib/service/files'

export async function GET() {
  return NextResponse.json({ root: ASSETS_DIR, files: await listAssetFiles(ASSETS_DIR) })
}
