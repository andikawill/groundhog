'use client'

import { useEffect, useState, type ReactNode } from 'react'

// Declared here rather than imported from the store: this is a client component, and that
// module reaches the filesystem. The shapes are small and the wire format is the contract.
type CellView = { key: string; secret: boolean; hasValue: boolean; value?: string }
type EnvFileView = { file: string; name: string; guard: string; vars: CellView[] }
type Matrix = { root: string; shared: EnvFileView | null; envs: EnvFileView[] }

function Guard({ guard }: { guard: string }) {
  const tone = guard === 'confirm' || guard === 'readonly' ? ` guard--${guard}` : ''
  return <span className={`guard${tone}`}>{guard}</span>
}

export default function EnvsView() {
  const [matrix, setMatrix] = useState<Matrix | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')

  useEffect(() => {
    void fetch('/api/envs')
      .then((r) => r.json())
      .then(setMatrix)
  }, [])

  // The head is the same in both branches, so the title does not appear a beat after the
  // screen does. Its right-hand slot is the write target, which is a fact about the matrix
  // and belongs on the matrix's own header row rather than floating above it.
  const shell = (head: ReactNode, body: ReactNode) => (
    <div className="pane">
      <div className="pane__head">
        <h1 className="title">envs</h1>
        <span className="spacer" />
        {head}
      </div>
      <div className="pane__body">{body}</div>
    </div>
  )

  if (!matrix) return shell(null, <p className="empty">loading</p>)

  const columns = [...(matrix.shared ? [matrix.shared] : []), ...matrix.envs]
  const keys = [...new Set(columns.flatMap((c) => c.vars.map((v) => v.key)))].sort()
  const rows = newKey && !keys.includes(newKey) ? [...keys, newKey] : keys

  const sharedKeys = new Set(
    (matrix.shared?.vars ?? []).filter((v) => v.hasValue).map((v) => v.key),
  )
  const cellOf = (column: EnvFileView, key: string) => column.vars.find((v) => v.key === key)
  const isShared = (column: EnvFileView) => column.file === matrix.shared?.file
  const inherits = (column: EnvFileView, key: string) =>
    !isShared(column) && !cellOf(column, key)?.hasValue && sharedKeys.has(key)
  // Only env columns can be empty. A key absent from shared is not a gap — a variable used by
  // one env alone has no business there — and marking it would contradict the count at the
  // foot, which sums the env columns.
  const isEmpty = (column: EnvFileView, key: string) =>
    !isShared(column) && !cellOf(column, key)?.hasValue && !inherits(column, key)

  const emptyCount = matrix.envs.reduce(
    (total, column) => total + rows.filter((key) => isEmpty(column, key)).length,
    0,
  )

  async function save(file: string, key: string, patch: { value?: string; secret?: boolean }) {
    setError(null)
    const res = await fetch(`/api/envs/${file}`, {
      method: 'PATCH',
      body: JSON.stringify({ key, ...patch }),
    })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error)
      return
    }
    setMatrix(
      (current) =>
        current && {
          ...current,
          shared: current.shared?.file === file ? body : current.shared,
          envs: current.envs.map((column) => (column.file === file ? body : column)),
        },
    )
    setNewKey('')
  }

  return shell(
    <p className="meta">
      writing to <span className="mono">{matrix.root}</span>
    </p>,
    <>
      {error && <p className="error">{error}</p>}

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>variable</th>
              {columns.map((column) => (
                <th key={column.file}>
                  <span className="col-head">
                    {column.name}
                    <Guard guard={column.guard} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((key) => (
              <tr key={key}>
                <td className="table__rowhead">{key}</td>
                {columns.map((column) => {
                  const cell = cellOf(column, key)
                  const empty = isEmpty(column, key)
                  const inherited = inherits(column, key)
                  const state = empty ? ' cell--empty' : inherited ? ' cell--inherited' : ''
                  return (
                    <td key={column.file}>
                      <span className={`cell${state}`}>
                        <input
                          className="cell__input"
                          key={`${column.file}:${key}:${cell?.value ?? ''}:${String(cell?.secret)}`}
                          defaultValue={cell?.secret ? '' : (cell?.value ?? '')}
                          aria-label={`${key} in ${column.name}`}
                          aria-invalid={empty ? 'true' : undefined}
                          placeholder={
                            cell?.secret
                              ? cell.hasValue
                                ? '*** set'
                                : 'not set'
                              : inherited
                                ? 'shared'
                                : empty
                                  ? 'empty'
                                  : ''
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur()
                          }}
                          onBlur={(e) => {
                            const next = e.currentTarget.value
                            const unchanged = cell?.secret
                              ? next === ''
                              : next === (cell?.value ?? '')
                            if (unchanged) return
                            void save(column.file, key, { value: next })
                          }}
                        />
                        {empty && (
                          <span className="cell__mark" title="empty" aria-label="empty">
                            !
                          </span>
                        )}
                        <button
                          className="cell__flag"
                          aria-pressed={cell?.secret ? 'true' : 'false'}
                          onClick={() => void save(column.file, key, { secret: !cell?.secret })}
                        >
                          {cell?.secret ? 'secret' : 'plain'}
                        </button>
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={columns.length + 1}>
                <span className={emptyCount > 0 ? 'count count--warn' : 'count'}>
                  {emptyCount} empty {emptyCount === 1 ? 'cell' : 'cells'}
                </span>
                {emptyCount > 0 && ' · marked !'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Field and caveat are one thing, so they sit at the rhythm inside a region rather
          than at the rhythm between regions. */}
      <div className="stack">
        <div className="field field--key">
          <label className="field__label" htmlFor="add-variable">
            add a variable
          </label>
          <input
            id="add-variable"
            className="input input--mono"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
          />
        </div>

        <p className="hint">
          The row is yours until you type a value — nothing is written before that.
        </p>
      </div>
    </>,
  )
}
