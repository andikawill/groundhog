export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type Guard = 'none' | 'confirm' | 'readonly'

export type Body =
  | { type: 'json'; value: unknown }
  | { type: 'file'; path: string }
  | { type: 'form'; value: Record<string, string> }
  | { type: 'multipart'; value: Record<string, string | { file: string }> }
  | { type: 'raw'; value: string; contentType: string }

export type Assert = { expr: string } | { semantic: string }

export type Step = {
  id: string
  title?: string
  method: Method
  url: string
  headers?: Record<string, string>
  body?: Body
  extract?: Record<string, string>
  assert?: Assert[]
  needs?: string[]
  always?: boolean
  pause?: boolean
  delay?: string
  retryUntil?: string
  every?: string
  timeout?: string
}

export type TestCase = {
  name: string
  steps: Step[]
  redact?: string[]
}

export type EnvVar = { key: string; value: string; secret?: boolean }
export type EnvDef = { name: string; guard?: Guard; vars: EnvVar[] }

export type StepStatus = 'passed' | 'failed' | 'skipped'
export type AssertResult = { expr: string; ok: boolean; detail?: string }

export type SentRequest = {
  method: Method
  url: string
  headers: Record<string, string>
  body?: string
  bodyBytes?: Uint8Array
}

export type RawResponse = {
  status: number
  headers: Record<string, string>
  text: string
  truncated: boolean
  durationMs: number
}

export type RunStep = {
  id: string
  title?: string
  status: StepStatus
  reason?: string
  request?: SentRequest
  response?: Omit<RawResponse, 'durationMs'>
  asserts: AssertResult[]
  attempts: number
  durationMs: number
  trace?: Record<string, string>
}

export const MAX_BODY_BYTES = 262144
export const TRACE_HEADERS = [
  'x-request-id',
  'x-correlation-id',
  'x-amzn-requestid',
  'traceparent',
]
