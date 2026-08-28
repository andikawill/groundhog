import { NextResponse } from 'next/server'
import { CASE_ROOT } from '../../../lib/service/config'
import { createCase, readCase } from '../../../lib/service/cases'
import { FileRequestError, listSelectableFiles } from '../../../lib/service/files'

export async function GET() {
  const files = await listSelectableFiles(CASE_ROOT, '.case.json')
  const cases = []
  for (const file of files) {
    try {
      const testCase = await readCase(CASE_ROOT, file)
      cases.push({ file, name: testCase.name, steps: testCase.steps.length })
    } catch {
      // One unreadable file is not a reason to empty the list; it is simply not a row.
      continue
    }
  }
  return NextResponse.json({ cases })
}

export async function POST(request: Request) {
  let body: { file?: unknown; name?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'body is not JSON' }, { status: 400 })
  }
  if (typeof body.file !== 'string' || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'file and name are required' }, { status: 400 })
  }
  try {
    const created = await createCase(CASE_ROOT, body.file, body.name)
    return NextResponse.json({ case: created }, { status: 201 })
  } catch (error) {
    if (error instanceof FileRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }
}
