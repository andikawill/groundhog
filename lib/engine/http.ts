import { Buffer } from 'node:buffer'
import { readAsset } from './assets'
import { MAX_BODY_BYTES, TRACE_HEADERS } from './types'
import type { RawResponse, SentRequest, Step } from './types'
import { renderString, renderValue, type Resolver } from './template'

export class StepDeclarationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StepDeclarationError'
  }
}

function lowerHeaders(headers: Record<string, string> | undefined, r: Resolver) {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    out[key.toLowerCase()] = renderString(value, r, `headers.${key.toLowerCase()}`)
  }
  return out
}

function defaultContentType(headers: Record<string, string>, value: string) {
  if (headers['content-type'] === undefined) headers['content-type'] = value
}

export function buildRequest(step: Step, r: Resolver): SentRequest {
  const headers = lowerHeaders(step.headers, r)
  const request: SentRequest = {
    method: step.method,
    url: renderString(step.url, r, 'url'),
    headers,
  }
  if (!step.body) return request

  if (step.method === 'GET') {
    throw new StepDeclarationError(`step "${step.id}" is a GET but declares a body`)
  }

  switch (step.body.type) {
    case 'json': {
      request.body = JSON.stringify(renderValue(step.body.value, r, 'body'))
      defaultContentType(headers, 'application/json')
      break
    }
    case 'file': {
      const path = renderString(step.body.path, r, 'body.file')
      request.bodyBytes = readAsset(r.assetsDir, path)
      defaultContentType(headers, 'application/octet-stream')
      break
    }
    case 'form': {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(step.body.value)) {
        params.set(key, renderString(value, r, `body.${key}`))
      }
      request.body = params.toString()
      defaultContentType(headers, 'application/x-www-form-urlencoded')
      break
    }
    case 'multipart': {
      const form = new FormData()
      for (const [key, value] of Object.entries(step.body.value)) {
        if (typeof value === 'string') {
          form.set(key, renderString(value, r, `body.${key}`))
        } else {
          const path = renderString(value.file, r, `body.${key}`)
          const bytes = readAsset(r.assetsDir, path)
          form.set(key, new Blob([bytes]), path.split('/').pop())
        }
      }
      // send strips this from the wire so fetch can supply its own boundary. Strip it from
      // the record too: a stored request that names a header nobody sent describes a request
      // that never happened.
      delete headers['content-type']
      request.multipart = form
      break
    }
    case 'raw': {
      request.body = renderString(step.body.value, r, 'body')
      defaultContentType(headers, step.body.contentType)
      break
    }
  }
  return request
}

export function traceOf(headers: Record<string, string>): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const name of TRACE_HEADERS) {
    if (headers[name] !== undefined) out[name] = headers[name]
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function cutAtCharBoundary(buffer: Buffer, limit: number): Buffer {
  if (buffer.byteLength <= limit) return buffer
  let end = limit
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1
  return buffer.subarray(0, end)
}

export async function send(request: SentRequest, timeoutMs: number): Promise<RawResponse> {
  const body =
    request.multipart ?? request.bodyBytes ?? request.body ?? undefined

  const response = await fetch(request.url, {
    method: request.method,
    headers: request.multipart
      ? Object.fromEntries(Object.entries(request.headers).filter(([k]) => k !== 'content-type'))
      : request.headers,
    body: body as BodyInit | undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  })

  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })

  const buffer = Buffer.from(await response.arrayBuffer())
  const truncated = buffer.byteLength > MAX_BODY_BYTES
  const text = cutAtCharBoundary(buffer, MAX_BODY_BYTES).toString('utf8')

  const setCookie = response.headers.getSetCookie()

  return {
    status: response.status,
    headers,
    setCookie: setCookie.length > 0 ? setCookie : undefined,
    text,
    truncated,
  }
}
