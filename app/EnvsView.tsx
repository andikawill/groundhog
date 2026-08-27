'use client'

import { useEffect, useState } from 'react'

// Declared here rather than imported from lib/service/envs: this is a client component, and
// that module reaches the filesystem. The shapes are small and the wire format is the
// contract.
type CellView = { key: string; secret: boolean; hasValue: boolean; value?: string }
type EnvFileView = { file: string; name: string; guard: string; vars: CellView[] }
type Matrix = { root: string; shared: EnvFileView | null; envs: EnvFileView[] }

export default function EnvsView() {
  const [matrix, setMatrix] = useState<Matrix | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')

  useEffect(() => {
    void fetch('/api/envs')
      .then((r) => r.json())
      .then(setMatrix)
  }, [])

  if (!matrix) return <p style={{ fontSize: 13, padding: 24 }}>loading</p>

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

  return (
    <div style={{ padding: 24, fontSize: 13 }}>
      <p style={{ opacity: 0.6 }}>
        writing to <code>{matrix.root}</code>
      </p>
      {error && <p style={{ color: '#a32d2d' }}>{error}</p>}

      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>variable</th>
            {columns.map((column) => (
              <th key={column.file} style={{ textAlign: 'left', padding: '4px 8px' }}>
                {column.name} <span style={{ opacity: 0.6, fontWeight: 400 }}>{column.guard}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((key) => (
            <tr key={key}>
              <td style={{ padding: '4px 8px', fontFamily: 'ui-monospace, monospace' }}>{key}</td>
              {columns.map((column) => {
                const cell = cellOf(column, key)
                return (
                  <td key={column.file} style={{ padding: '4px 8px' }}>
                    <input
                      key={`${column.file}:${key}:${cell?.value ?? ''}:${String(cell?.secret)}`}
                      defaultValue={cell?.secret ? '' : (cell?.value ?? '')}
                      placeholder={
                        cell?.secret
                          ? cell.hasValue
                            ? '*** set'
                            : 'not set'
                          : inherits(column, key)
                            ? 'shared'
                            : ''
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                      }}
                      onBlur={(e) => {
                        const next = e.currentTarget.value
                        const unchanged = cell?.secret ? next === '' : next === (cell?.value ?? '')
                        if (unchanged) return
                        void save(column.file, key, { value: next })
                      }}
                      style={{
                        width: 200,
                        font: 'inherit',
                        padding: '2px 4px',
                        border: `1px solid ${isEmpty(column, key) ? '#a32d2d' : '#ccc'}`,
                      }}
                    />{' '}
                    <button
                      onClick={() => void save(column.file, key, { secret: !cell?.secret })}
                      style={{ font: 'inherit', cursor: 'pointer' }}
                    >
                      {cell?.secret ? 'secret' : 'plain'}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={columns.length + 1} style={{ padding: '8px', opacity: 0.7 }}>
              {emptyCount} empty {emptyCount === 1 ? 'cell' : 'cells'}
            </td>
          </tr>
        </tfoot>
      </table>

      <p style={{ marginTop: 16 }}>
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="add a variable"
          style={{ font: 'inherit', padding: '2px 4px' }}
        />{' '}
        <span style={{ opacity: 0.6 }}>
          the row is yours until you type a value — nothing is written before that
        </span>
      </p>
    </div>
  )
}
