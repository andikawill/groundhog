'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { RunStep, Step } from '../lib/engine/index'

type Status = 'running' | 'awaiting' | 'interrupted' | 'passed' | 'failed'

// Declared here rather than imported from the store: this is a client component, and the
// store imports Prisma. Over the wire the dates are strings, which is what they are here.
type RunSummary = {
  id: string
  caseName: string
  envName: string
  status: Status
  startedAt: string
}

// Glyph, then shape, then colour — the badge never leans on colour alone. The shapes come
// from the stylesheet: round means the run is still alive, square means it is over, a broken
// border means nothing was sent.
const GLYPH: Record<string, string> = {
  passed: '✓',
  failed: '×',
  skipped: '–',
  awaiting: '‖',
  running: '>',
  interrupted: '!',
}

function Badge({ status, quiet }: { status: string; quiet?: boolean }) {
  return (
    <span className={`st st--${status}`}>
      <span className="st__glyph" aria-hidden="true">
        {GLYPH[status] ?? '?'}
      </span>
      {/* The word stays in the DOM even where the layout hides it: a glyph alone is a shape
          to a sighted reader and nothing at all to a screen reader. */}
      <span className={quiet ? 'st__label visually-hidden' : 'st__label'}>{status}</span>
    </span>
  )
}

const took = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)

export default function RunView() {
  const [files, setFiles] = useState<{ cases: string[]; envs: string[] }>({ cases: [], envs: [] })
  const [casePath, setCasePath] = useState('')
  const [envPath, setEnvPath] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [steps, setSteps] = useState<RunStep[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [meta, setMeta] = useState<{ seed: string; anchorAt: string; envName: string } | null>(null)
  const [declared, setDeclared] = useState<Step[]>([])

  useEffect(() => {
    void fetch('/api/files')
      .then((r) => r.json())
      .then((f) => {
        setFiles(f)
        setCasePath(f.cases[0] ?? '')
        setEnvPath(f.envs[0] ?? '')
      })
  }, [])

  // Reloaded on every status change, which is a handful of times per run: starting one and
  // finishing one are exactly the moments the list is out of date.
  useEffect(() => {
    void fetch('/api/runs')
      .then((r) => r.json())
      .then((body) => setRuns(body.runs))
  }, [status])

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
    // Load the row that was just created rather than setting the state a second way here.
    // It is the only place the seed and the anchor exist, and they are the two values a run
    // is reproducible from.
    await open(body.id)
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
    await open(body.id)
  }

  async function open(id: string) {
    setError(null)
    const res = await fetch(`/api/runs/${id}`)
    const body = await res.json()
    if (!res.ok) {
      setError(body.error)
      return
    }
    // Steps land before the id and status, so the stream effect — which only reopens for a
    // run still going — never sees this run's id beside another run's steps.
    setSteps(body.results)
    setSelected(null)
    setRunId(id)
    setStatus(body.status)
    setMeta({ seed: body.seed, anchorAt: body.anchorAt, envName: body.envName })
    // The declaration the run started from, not the file as it stands now. It is what names
    // the step a paused or running run is sitting on.
    setDeclared(body.caseSnapshot?.steps ?? [])
  }

  const step = steps.find((s) => s.id === selected) ?? steps[steps.length - 1]
  const settled = status === 'passed' || status === 'failed' || status === 'interrupted'

  // The step a live run is on has no record yet, so its row is derived from the run's own
  // status plus the next declared step. StepStatus has no awaiting or running member and
  // should not gain one.
  const pending =
    (status === 'awaiting' || status === 'running') && declared[steps.length]
      ? { id: declared[steps.length].id, status }
      : null

  const origins = Object.entries(step?.origins ?? {})

  return (
    <div className="app">
      <header className="app__header">
        <span className="brand">groundhog</span>

        <div className="picker">
          <select
            className="select"
            aria-label="case"
            value={casePath}
            onChange={(e) => setCasePath(e.target.value)}
          >
            {files.cases.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div className="picker">
          <select
            className="select"
            aria-label="env"
            value={envPath}
            onChange={(e) => setEnvPath(e.target.value)}
          >
            {files.envs.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <button className="btn btn--primary" onClick={start} disabled={status === 'running'}>
          run
        </button>

        <span className="spacer" />

        <nav className="nav">
          <Link href="/" aria-current="page">
            runs
          </Link>
          <Link href="/envs">envs</Link>
        </nav>
      </header>

      <div className="app__body">
        <div className="rail">
          {status && (
            <section className="stack">
              <p className="label">run</p>
              <Badge status={status} />
              {meta && (
                <dl className="kv">
                  <dt className="kv__k">seed</dt>
                  <dd className="kv__v">
                    <span className="seed">{meta.seed}</span>
                  </dd>
                  <dt className="kv__k">anchor</dt>
                  <dd className="kv__v">{meta.anchorAt}</dd>
                  <dt className="kv__k">env</dt>
                  <dd className="kv__v">{meta.envName}</dd>
                </dl>
              )}
              {settled && (
                <>
                  <div className="btn-row">
                    <button className="btn" onClick={replay}>
                      replay with the same seed
                    </button>
                  </div>
                  <p className="hint">
                    A replay reads the case and env files as they are now, not as they were, so
                    it is byte for byte only while both are unchanged. A resume is different: it
                    continues from the case the run started with.
                  </p>
                </>
              )}
            </section>
          )}

          {error && <p className="error">{error}</p>}

          {status === 'awaiting' && (
            <section className="stack">
              <div className="btn-row">
                <button className="btn btn--primary" onClick={() => resume('continue')}>
                  continue
                </button>
                <button className="btn" onClick={() => resume('skip')}>
                  skip
                </button>
              </div>
              <p className="hint">
                This run is holding the values it extracted, including any access token, or it
                could not continue. That state is kept apart from the run&apos;s record, is never
                exported or logged, and is discarded the moment the run continues or ends.
              </p>
            </section>
          )}

          {(steps.length > 0 || pending) && (
            <section className="stack">
              <p className="label">steps</p>
              <ol className="steps">
                {steps.map((s) => (
                  <li key={s.id}>
                    <button
                      className="step"
                      aria-current={s.id === step?.id ? 'true' : undefined}
                      onClick={() => setSelected(s.id)}
                    >
                      <Badge status={s.status} quiet />
                      <span className="step__id">{s.id}</span>
                      <span className="step__meta">
                        {s.attempts > 1 && <span className="step__attempts">{s.attempts}× </span>}
                        {took(s.durationMs)}
                      </span>
                    </button>
                  </li>
                ))}
                {pending && (
                  <li>
                    <span className="step">
                      <Badge status={pending.status} quiet />
                      <span className="step__id">{pending.id}</span>
                      <span className="step__meta">
                        {pending.status === 'awaiting' ? 'waiting' : '…'}
                      </span>
                    </span>
                  </li>
                )}
              </ol>
            </section>
          )}

          {runs.length > 0 && (
            <section className="stack">
              <p className="label">earlier runs</p>
              <ol className="runs">
                {runs.map((r) => (
                  <li key={r.id}>
                    <button
                      className="run"
                      aria-current={r.id === runId ? 'true' : undefined}
                      onClick={() => void open(r.id)}
                    >
                      <Badge status={r.status} quiet />
                      <span className="run__name">{r.caseName}</span>
                      <span className="run__meta">
                        {r.envName} · {new Date(r.startedAt).toLocaleTimeString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <div className="pane">
          {step ? (
            <>
              <div className="pane__head">
                <h2 className="pane__title">{step.id}</h2>
                <Badge status={step.status} />
              </div>
              <div className="pane__body">
                {step.reason && <p className="error">{step.reason}</p>}

                <div className="evidence">
                  <div className="evidence__head">
                    <p className="evidence__req">
                      {step.request
                        ? `${step.request.method} ${step.request.url}`
                        : 'nothing was sent'}
                    </p>
                  </div>

                  {step.request?.body !== undefined && (
                    <pre className="code code--flush">{pretty(step.request.body)}</pre>
                  )}

                  <div className="evidence__section">
                    <span className="label">where each value came from</span>
                    <span className="meta">
                      {origins.length} {origins.length === 1 ? 'value' : 'values'}
                    </span>
                  </div>

                  {origins.length > 0 ? (
                    <ol className="origins">
                      {origins.map(([path, tokens]) => (
                        <li className="origin" key={path}>
                          <span className="origin__path">{path}</span>
                          <span className="origin__arrow" aria-hidden="true" />
                          <span className="origin__token">{tokens.join(', ')}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="evidence__none">
                      no tokens — every value here was written literally.
                    </p>
                  )}
                </div>

                {step.asserts.length > 0 && (
                  <section className="stack">
                    <p className="label">assertions</p>
                    <ol className="asserts">
                      {step.asserts.map((a, i) => (
                        <li className={a.ok ? 'assert' : 'assert assert--failed'} key={i}>
                          <Badge status={a.ok ? 'passed' : 'failed'} quiet />
                          <span className="mono">{a.expr}</span>
                          {a.detail && <span className="assert__detail">{a.detail}</span>}
                        </li>
                      ))}
                    </ol>
                  </section>
                )}

                {step.trace && Object.keys(step.trace).length > 0 && (
                  <section className="stack">
                    <p className="label">correlation</p>
                    <dl className="kv">
                      {Object.entries(step.trace).map(([key, value]) => (
                        <div key={key} style={{ display: 'contents' }}>
                          <dt className="kv__k">{key}</dt>
                          <dd className="kv__v">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}
              </div>
            </>
          ) : (
            <div className="pane__body">
              <p className="empty">
                Nothing has run yet. Pick a case and an env, then press run — steps land here as
                they finish, with the payload that was actually sent and where each value in it
                came from.
              </p>
            </div>
          )}
        </div>
      </div>
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
