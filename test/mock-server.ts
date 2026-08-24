import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export type MockReq = {
  body: string
  headers: Record<string, string>
  query: URLSearchParams
  hit: number
}
// A repeated header needs an array, and res.writeHead already takes one. A single Set-Cookie
// passes against the broken code; the defect only shows with two.
export type MockRes = {
  status?: number
  headers?: Record<string, string | string[]>
  body?: string
}
export type MockRoutes = Record<string, (req: MockReq) => MockRes | Promise<MockRes>>
export type MockHandle = { url: string; close: () => Promise<void>; hits: Record<string, number> }

export async function startMock(routes: MockRoutes): Promise<MockHandle> {
  const hits: Record<string, number> = {}

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const key = `${req.method} ${url.pathname}`
    hits[key] = (hits[key] ?? 0) + 1

    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const handler = routes[key]
      if (!handler) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: `no mock route for ${key}` }))
        return
      }
      Promise.resolve(
        handler({
          body: Buffer.concat(chunks).toString('utf8'),
          headers: req.headers as Record<string, string>,
          query: url.searchParams,
          hit: hits[key],
        }),
      )
        .then((out) => {
          res.writeHead(out.status ?? 200, {
            'content-type': 'application/json',
            ...(out.headers ?? {}),
          })
          res.end(out.body ?? '')
        })
        .catch((error: unknown) => {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: String(error) }))
        })
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port

  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
