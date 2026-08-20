import type { RawResponse, SentRequest } from './types'

export function makeRedactor(secrets: string[]): (input: string) => string {
  const list = [...new Set(secrets.filter((s) => s && s.length >= 4))].sort(
    (a, b) => b.length - a.length,
  )
  return (input) => list.reduce((acc, secret) => acc.split(secret).join('***'), input)
}

export function redactRequest(
  request: SentRequest,
  redact: (input: string) => string,
): SentRequest {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(request.headers)) headers[key] = redact(value)

  return {
    method: request.method,
    url: redact(request.url),
    headers,
    body:
      request.multipart !== undefined
        ? '<multipart form>'
        : request.bodyBytes !== undefined
          ? `<binary, ${request.bodyBytes.byteLength} bytes>`
          : request.body !== undefined
            ? redact(request.body)
            : undefined,
  }
}

export function redactResponse(
  response: Omit<RawResponse, 'durationMs'>,
  redact: (input: string) => string,
): Omit<RawResponse, 'durationMs'> {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(response.headers)) headers[key] = redact(value)
  return {
    status: response.status,
    headers,
    text: redact(response.text),
    truncated: response.truncated,
  }
}
