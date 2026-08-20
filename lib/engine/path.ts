export function readPath(root: unknown, path: string): unknown {
  const trimmed = path.trim()
  if (trimmed === '$' || trimmed === '') return root
  const body = trimmed.startsWith('$.') ? trimmed.slice(2) : trimmed
  const segments = body.match(/[^.[\]]+/g)
  if (!segments) return root

  let current: unknown = root
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}
