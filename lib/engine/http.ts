import { readFileSync } from 'node:fs'
import type { SentRequest, Step } from './types'
import { renderString, renderValue, type Resolver } from './template'

function lowerHeaders(headers: Record<string, string> | undefined, r: Resolver) {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    out[key.toLowerCase()] = renderString(value, r)
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
    url: renderString(step.url, r),
    headers,
  }
  if (!step.body) return request

  switch (step.body.type) {
    case 'json': {
      request.body = JSON.stringify(renderValue(step.body.value, r))
      defaultContentType(headers, 'application/json')
      break
    }
    case 'file': {
      const path = renderString(step.body.path, r)
      request.bodyBytes = new Uint8Array(readFileSync(`${r.assetsDir}/${path}`))
      defaultContentType(headers, 'application/octet-stream')
      break
    }
    case 'form': {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(step.body.value)) {
        params.set(key, renderString(value, r))
      }
      request.body = params.toString()
      defaultContentType(headers, 'application/x-www-form-urlencoded')
      break
    }
    case 'multipart': {
      const form = new FormData()
      for (const [key, value] of Object.entries(step.body.value)) {
        if (typeof value === 'string') {
          form.set(key, renderString(value, r))
        } else {
          const path = renderString(value.file, r)
          const bytes = new Uint8Array(readFileSync(`${r.assetsDir}/${path}`))
          form.set(key, new Blob([bytes]), path.split('/').pop())
        }
      }
      request.multipart = form
      break
    }
    case 'raw': {
      request.body = renderString(step.body.value, r)
      defaultContentType(headers, step.body.contentType)
      break
    }
  }
  return request
}
