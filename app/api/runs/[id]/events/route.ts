import { getRun } from '../../../../../lib/store/runs'

const TERMINAL = new Set(['passed', 'failed', 'interrupted', 'awaiting'])

const MAX_STREAM_MS = 10 * 60 * 1000

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))

      let sent = 0
      let lastStatus = ''
      const deadline = Date.now() + MAX_STREAM_MS

      while (!request.signal.aborted && Date.now() < deadline) {
        const run = await getRun(id)
        if (!run) {
          send('error', { error: 'no such run' })
          break
        }
        for (const step of run.results.slice(sent)) send('step', step)
        sent = run.results.length
        if (run.status !== lastStatus) {
          lastStatus = run.status
          send('status', { status: run.status })
        }
        if (TERMINAL.has(run.status)) break
        await new Promise((r) => setTimeout(r, 250))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    },
  })
}
