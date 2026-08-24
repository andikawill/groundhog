'use client'

import { useEffect, useState } from 'react'
import type { RunStep } from '../lib/engine/index'

type Status = 'running' | 'awaiting' | 'interrupted' | 'passed' | 'failed'

export default function RunView() {
  const [files, setFiles] = useState<{ cases: string[]; envs: string[] }>({ cases: [], envs: [] })
  const [casePath, setCasePath] = useState('')
  const [envPath, setEnvPath] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [steps, setSteps] = useState<RunStep[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/files')
      .then((r) => r.json())
      .then((f) => {
        setFiles(f)
        setCasePath(f.cases[0] ?? '')
        setEnvPath(f.envs[0] ?? '')
      })
  }, [])

  useEffect(() => {
    if (!runId || status === 'awaiting' || status === 'passed' || status === 'failed') return
    const source = new EventSource(`/api/runs/${runId}/events`)
    source.addEventListener('step', (e) => {
      // A reopened stream replays the whole row from its first step, so a step already on
      // screen arrives again after a resume. Replace by id rather than append: the replayed
      // copy is also the newer one, which is how a skipped step loses its awaiting look.
      const incoming = JSON.parse(e.data) as RunStep
      setSteps((prev) => {
        const at = prev.findIndex((s) => s.id === incoming.id)
        if (at === -1) return [...prev, incoming]
        const next = [...prev]
        next[at] = incoming
        return next
      })
    })
    source.addEventListener('status', (e) => setStatus(JSON.parse(e.data).status))
    return () => source.close()
  }, [runId, status])

  async function start() {
    setError(null)
    setSteps([])
    // runId goes too, not just the steps. Clearing status alone leaves the previous run
    // current with a status the stream effect does not bail on, so it subscribes to the
    // finished run and replays every one of its steps onto the new run's empty list.
    setRunId(null)
    setStatus(null)
    setSelected(null)
    const res = await fetch('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ casePath, envPath }),
    })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error)
      return
    }
    setRunId(body.id)
    setStatus('running')
  }

  async function resume(decision: 'continue' | 'skip') {
    if (!runId) return
    const res = await fetch(`/api/runs/${runId}/resume`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    })
    if (res.ok) setStatus('running')
    else setError('this run was already resumed elsewhere')
  }

  async function replay() {
    if (!runId) return
    setError(null)
    const res = await fetch(`/api/runs/${runId}/replay`, { method: 'POST' })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error)
      return
    }
    setSteps([])
    setSelected(null)
    setRunId(body.id)
    setStatus('running')
  }

  const step = steps.find((s) => s.id === selected) ?? steps[steps.length - 1]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, padding: 24 }}>
      <div>
        <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
          <select value={casePath} onChange={(e) => setCasePath(e.target.value)}>
            {files.cases.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select value={envPath} onChange={(e) => setEnvPath(e.target.value)}>
            {files.envs.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <button onClick={start} disabled={status === 'running'}>
            run
          </button>
        </div>

        {status && (
          <p style={{ fontSize: 13 }}>
            status: <strong>{status}</strong>
          </p>
        )}
        {error && <p style={{ fontSize: 13, color: '#a32d2d' }}>{error}</p>}

        {status === 'awaiting' && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onClick={() => resume('continue')}>continue</button>
            <button onClick={() => resume('skip')}>skip</button>
          </div>
        )}

        {(status === 'passed' || status === 'failed' || status === 'interrupted') && (
          <div style={{ marginBottom: 16 }}>
            <button onClick={replay}>replay with the same seed</button>
          </div>
        )}

        <ol style={{ listStyle: 'none', padding: 0, fontSize: 13 }}>
          {steps.map((s) => (
            <li key={s.id} style={{ padding: '4px 0' }}>
              <button
                onClick={() => setSelected(s.id)}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  fontWeight: s.id === step?.id ? 600 : 400,
                }}
              >
                {s.status === 'passed' ? 'ok' : s.status === 'failed' ? 'FAIL' : 'skip'} {s.id}{' '}
                <span style={{ opacity: 0.6 }}>{s.durationMs}ms</span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div>
        {step ? (
          <StepDetail step={step} />
        ) : (
          <p style={{ fontSize: 13, opacity: 0.6 }}>no steps yet</p>
        )}
      </div>
    </div>
  )
}

function StepDetail({ step }: { step: RunStep }) {
  return (
    <div style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace' }}>
      {step.request && (
        <p>
          {step.request.method} {step.request.url}
        </p>
      )}
      {step.reason && <p style={{ color: '#a32d2d' }}>{step.reason}</p>}

      {step.request?.body && (
        <>
          <p style={{ opacity: 0.6 }}>body sent</p>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{pretty(step.request.body)}</pre>
        </>
      )}

      {step.origins && Object.keys(step.origins).length > 0 && (
        <>
          <p style={{ opacity: 0.6, marginTop: 16 }}>where each value came from</p>
          <ul style={{ paddingLeft: 16 }}>
            {Object.entries(step.origins).map(([path, tokens]) => (
              <li key={path}>
                {path} ← {tokens.join(', ')}
              </li>
            ))}
          </ul>
        </>
      )}

      {step.asserts.length > 0 && (
        <>
          <p style={{ opacity: 0.6, marginTop: 16 }}>assertions</p>
          <ul style={{ paddingLeft: 16 }}>
            {step.asserts.map((a, i) => (
              <li key={i} style={{ color: a.ok ? undefined : '#a32d2d' }}>
                {a.ok ? 'ok' : 'FAIL'} {a.expr} {a.detail ? `— ${a.detail}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function pretty(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}
